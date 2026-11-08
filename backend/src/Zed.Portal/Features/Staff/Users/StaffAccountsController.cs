using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.Dashboard;
using Zed.Portal.Features.Staff.SubUsers;
using Zed.Portal.Templates;

namespace Zed.Portal.Features.Staff.Users;

/// <summary>
/// New in V4: Admin → User Management. The Admin creates and maintains the logins nobody could create on the old portals
/// (they were inserted in the database): Master Admins, Ministry, MSME DFOs (StateCoordinator, per state: the NEFT lists
/// show that state) and the dashboard logins (SuperAdmin, CitizenFeedback, QC). Plain Users rows, so the legacy login and
/// procedures treat them as before; the password is generated and hashed (PasswordStore). A new login is mailed a one-time
/// link to set its password; Master Admin and Super Admin logins get the generated password (<see cref="StaffWelcomeLogin"/>).
/// Block, unblock, an edit or a password reset ends the user's sessions (<see cref="SessionStamps"/>).
/// </summary>
[Route("api/staff/accounts")]
[StaffRoles(UserRole.Admin)]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed class StaffAccountsController(
    ISqlExecutor db,
    PortalHost host,
    IEmailSender email,
    IHtmlTemplateRenderer templates,
    IOptions<PortalOptions> portal,
    EmailAddresses addresses,
    ILogger<StaffAccountsController> log) : StaffApiController
{
    /// <param name="HasScope">Master Admin and Ministry (2026-11-07): MSME category and certification levels.</param>
    /// <param name="HasStateScope">Master Admin: also the applicable states.</param>
    /// <param name="HasScreens">Dashboard Admin (2026-11-07): the screens the Admin ticks per portal (<see cref="DashboardScreens"/>).</param>
    /// <param name="CanAdd">False where existing logins are only listed (a Dashboard Admin is created on the main portal).</param>
    /// <param name="HasLevels">False for the MSME DFO (its scope is category, states and districts).</param>
    /// <param name="HasDistricts">MSME DFO (2026-11-07): the districts among its states.</param>
    /// <param name="HasNeftLists">MSME DFO: Financial Assistance (main) and / or Handholding (Technology Upgradation).</param>
    public sealed record AccountType(int RoleId, string Label, bool NeedsState, PortalSystem[] Systems, bool HasScope = false, bool HasStateScope = false,
        bool HasScreens = false, bool CanAdd = true, bool HasLevels = true, bool HasDistricts = false, bool HasNeftLists = false);

    private static readonly PortalSystem[] All = [PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance];

    /// <summary>The logins the Admin creates; MSME DFOs only where the NEFT screens are (main and consultancy).</summary>
    public static readonly IReadOnlyList<AccountType> Types =
    [
        new((int)UserRole.MasterAdmin, "Master Admin", false, All, HasScope: true, HasStateScope: true),
        new((int)UserRole.Ministry, "Ministry", false, All, HasScope: true),
        // One MSME DFO for Financial Assistance and Handholding (2026-11-07): category, states and districts; added on main.
        new((int)UserRole.StateCoordinator, "MSME DFO", false, [PortalSystem.Main, PortalSystem.Consultancy],
            HasScope: true, HasStateScope: true, HasLevels: false, HasDistricts: true, HasNeftLists: true),
        // One Dashboard Admin (2026-11-07) instead of Super Admin, Citizen Feedback and QC (migration 0058 turned those into it).
        new((int)UserRole.SuperAdmin, "Dashboard Admin", false, All, HasScope: true, HasStateScope: true, HasScreens: true),
    ];

    public sealed record StateOption(string Code, string Name);

    public sealed record AccountRow(
        string UserId, string? UserName, int RoleId, string? Email, string? MobileNo, string? StateCode, bool? IsActive, string? CreatedBy, DateTime? CreatedDate)
    {
        /// <summary>The scope (migration 0057): Manufacturing / Services / Both, level codes, state codes; empty = no limit.</summary>
        public string? SectorActivity { get; init; }
        public IReadOnlyList<string> Levels { get; init; } = [];
        public IReadOnlyList<string> States { get; init; } = [];
        /// <summary>MSME DFO: the district codes among its states; empty = every district.</summary>
        public IReadOnlyList<string> Districts { get; init; } = [];
        /// <summary>Dashboard Admin: the ticked "{portal}:{key}" screens; MSME DFO: its NEFT lists ("main:neft", ...); null = every one.</summary>
        public IReadOnlyList<string>? Screens { get; init; }
    }

    public sealed record LevelOption(string Code, string Name);

    /// <summary>A screen a Dashboard Admin can be given on a portal.</summary>
    public sealed record ScreenOption(string Portal, string PortalName, string Key, string Label, string Group, string? Hint);

    public sealed record AccountsResponse(IReadOnlyList<AccountType> Types, IReadOnlyList<StateOption> States, IReadOnlyList<AccountRow> Accounts)
    {
        public IReadOnlyList<LevelOption> Levels { get; init; } = [];
        public IReadOnlyList<ScreenOption> Screens { get; init; } = [];
    }

    /// <param name="SectorActivity">Master Admin / Ministry: Manufacturing, Services or Both (empty = Both).</param>
    /// <param name="Levels">Master Admin / Ministry: the level codes; empty = every level.</param>
    /// <param name="States">Master Admin: the state codes; empty = every state.</param>
    /// <param name="Screens">Dashboard Admin: the ticked "{portal}:{key}" screens.</param>
    /// <param name="Districts">MSME DFO: district codes among its states.</param>
    /// <param name="NeftLists">MSME DFO: "main" (Financial Assistance) and / or "consultancy" (Handholding).</param>
    public sealed record AccountRequest(string? UserId, int RoleId, string? UserName, string? Email, string? MobileNo, string? StateCode,
        string? SectorActivity = null, List<string>? Levels = null, List<string>? States = null, List<string>? Screens = null,
        List<string>? Districts = null, List<string>? NeftLists = null);

    public sealed record CreatedAccountResponse(string Message, string UserId);

    /// <summary>This portal's login types; a Dashboard Admin is added only on main (it opens the other portals from there).</summary>
    private IReadOnlyList<AccountType> Mine =>
        Types.Where(t => t.Systems.Contains(host.System))
            .Select(t => (t.HasScreens || t.HasNeftLists) && host.System != PortalSystem.Main ? t with { CanAdd = false } : t).ToList();

    private int[] MyRoles => Mine.Select(t => t.RoleId).ToArray();

    [HttpGet]
    public async Task<AccountsResponse> List(CancellationToken ct)
    {
        var rows = await db.QuerySqlAsync<AccountRow>(
            "SELECT UserId, UserName, RoleId, Email, MobileNo, StateCode, IsActive, CreatedBy, CreatedDate FROM Users " +
            // NEFT Admins (state ALL) are managed by the Master Admin (Neft/NeftAdminsController, 2026-11-07).
            "WHERE RoleId IN @Roles AND NOT (RoleId = 6 AND ISNULL(StateCode, '') = 'ALL') ORDER BY RoleId, UserId;", new { Roles = MyRoles }, ct);
        var scopes = await ScopesAsync(ct);
        var screens = await ScreensAsync(ct);
        return new AccountsResponse(Mine, States, rows.Select(r => WithScope(r, scopes) with
        {
            Screens = r.RoleId is (int)UserRole.SuperAdmin or (int)UserRole.StateCoordinator && screens.TryGetValue(r.UserId, out var sc) ? DashboardScreens.Parse(sc)!.ToList() : null,
            Districts = r.RoleId == (int)UserRole.StateCoordinator && scopes.TryGetValue(r.UserId, out var sd) ? LoginScope.Split(sd.ScopeDistricts) : [],
        }).ToList()) { Levels = LevelOptions, Screens = ScreenOptions };
    }

    // ---- Dashboard Admin screens (migration 0058) --------------------------------------------------

    internal const string ScreensListSql = "SELECT UserId, ScreenAccess FROM Users WHERE RoleId IN (6, 10) AND ScreenAccess IS NOT NULL;";
    internal const string SaveScreensSql = "UPDATE Users SET ScreenAccess = @ScreenAccess WHERE UserId = @UserId AND RoleId IN (6, 10);";

    public sealed record ScreenRow(string UserId, string? ScreenAccess);

    private static readonly IReadOnlyDictionary<PortalSystem, string> PortalNames = new Dictionary<PortalSystem, string>
    {
        [PortalSystem.Main] = "ZED Certification", [PortalSystem.Consultancy] = "Handholding", [PortalSystem.Surveillance] = "Surveillance",
    };

    /// <summary>The screens of the portals a Dashboard Admin of this portal opens (main: all three; the others: their own).</summary>
    private IReadOnlyList<ScreenOption> ScreenOptions =>
        (host.System == PortalSystem.Main ? [PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance] : new[] { host.System })
        .SelectMany(p => DashboardScreens.Screens.Where(s => s.Systems.Contains(p))
            .Select(s => new ScreenOption(DashboardScreens.KeyOf(p), PortalNames[p], s.Key, s.Label, s.Group, s.Hint)))
        .ToList();

    private async Task<Dictionary<string, string?>> ScreensAsync(CancellationToken ct)
    {
        try
        {
            return (await db.QuerySqlAsync<ScreenRow>(ScreensListSql, null, ct))
                .GroupBy(r => r.UserId, StringComparer.OrdinalIgnoreCase).ToDictionary(g => g.Key, g => g.First().ScreenAccess, StringComparer.OrdinalIgnoreCase);
        }
        catch (System.Data.Common.DbException ex)
        {
            log.LogWarning(ex, "Dashboard Admin screens not read (is migration 0058 applied?)");
            return [];
        }
    }

    /// <summary>The ticked screens as stored ("{portal}:{key}", only screens this portal offers); null when not a Dashboard Admin.</summary>
    private (string? Value, string? Error) ValidateScreens(AccountType type, AccountRequest req)
    {
        if (!type.HasScreens) return (null, null);
        var offered = ScreenOptions.Select(o => o.Portal + ":" + o.Key).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var chosen = new List<string>();
        foreach (var raw in req.Screens ?? [])
        {
            var key = raw?.Trim().ToLowerInvariant() ?? "";
            if (!offered.Contains(key)) return (null, "Please choose the screens from the list.");
            if (!chosen.Contains(key)) chosen.Add(key);
        }
        if (!chosen.Any(c => !DashboardScreens.IsSetting(c[(c.IndexOf(':') + 1)..])))
            return (null, "Please tick at least one screen for the Dashboard Admin.");
        return (string.Join(',', chosen), null);
    }

    private async Task SaveScreensAsync(string userId, string? screens, CancellationToken ct)
    {
        await db.ExecuteSqlAsync(SaveScreensSql, new { UserId = userId, ScreenAccess = screens }, ct);
    }

    // ---- scope (migration 0057) ------------------------------------------------------------------

    internal const string ScopesSql =
        "SELECT UserId, SectorActivity, ScopeLevels, ScopeStates, ScopeDistricts FROM Users WHERE RoleId IN (6, 7, 8, 10) " +
        "AND (SectorActivity IS NOT NULL OR ScopeLevels IS NOT NULL OR ScopeStates IS NOT NULL OR ScopeDistricts IS NOT NULL);";
    internal const string SaveScopeSql =
        "UPDATE Users SET SectorActivity = @SectorActivity, ScopeLevels = @ScopeLevels, ScopeStates = @ScopeStates, ScopeDistricts = @ScopeDistricts " +
        "WHERE UserId = @UserId AND RoleId = @RoleId;";

    public sealed record ScopeRow(string UserId, string? SectorActivity, string? ScopeLevels, string? ScopeStates, string? ScopeDistricts = null);

    private static readonly IReadOnlyList<LevelOption> AllLevelOptions =
        [new("Bronze", "Bronze"), new("Silver", "Silver"), new("Gold", "Gold"), new("ZEDX", "ZED-X")];

    /// <summary>This portal's levels: the Consultancy portal's handholding is for Silver and Gold (2026-11-07).</summary>
    private IReadOnlyList<LevelOption> LevelOptions =>
        host.System == PortalSystem.Consultancy ? [.. AllLevelOptions.Where(l => l.Code is "Silver" or "Gold")] : AllLevelOptions;

    // ---- MSME DFO districts and NEFT lists (2026-11-07) -------------------------------------------

    public sealed record DistrictOption(string Code, string Name);

    public sealed record StateDistricts(string StateCode, string StateName, IReadOnlyList<DistrictOption> Districts);

    internal const string DistrictsSql =
        "SELECT StateCode, DistrictCode, DistrictName FROM Districts WHERE StateCode IN @States AND ISNULL(IsActive, 1) = 1 ORDER BY DistrictName;";

    public sealed record DistrictRow(string? StateCode, string? DistrictCode, string? DistrictName);

    /// <summary>GET api/staff/accounts/districts?states=9,10: the districts of the chosen states (an MSME DFO's).</summary>
    [HttpGet("districts")]
    public async Task<IReadOnlyList<StateDistricts>> Districts(string? states, CancellationToken ct)
    {
        var codes = (states ?? "").Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
            .Where(DashboardFilters.States.ContainsKey).Distinct().ToList();
        if (codes.Count == 0) return [];
        var rows = await DistrictsOfAsync(codes, ct);
        return codes.Select(c => new StateDistricts(c, DashboardFilters.States[c],
            rows.Where(r => SameState(r.StateCode, c)).Select(r => new DistrictOption(r.DistrictCode!.Trim(), r.DistrictName?.Trim() ?? r.DistrictCode!.Trim())).ToList())).ToList();
    }

    private async Task<IReadOnlyList<DistrictRow>> DistrictsOfAsync(IReadOnlyCollection<string> states, CancellationToken ct)
    {
        // Districts.StateCode may be "9" or "09".
        var keys = states.SelectMany(c => new[] { c, c.PadLeft(2, '0') }).Distinct().ToArray();
        return (await db.QuerySqlAsync<DistrictRow>(DistrictsSql, new { States = keys }, ct))
            .Where(r => !string.IsNullOrWhiteSpace(r.DistrictCode) && states.Any(st => SameState(r.StateCode, st))).ToList();
    }

    private static bool SameState(string? a, string b) => Neft.NeftController.NormaliseState(a) == Neft.NeftController.NormaliseState(b);

    /// <summary>An MSME DFO: its districts (among its states) and its NEFT lists, as stored.</summary>
    private async Task<(string? Districts, string? Lists, string? Error)> ValidateDfoAsync(AccountType type, AccountRequest req, IReadOnlyList<string> states, CancellationToken ct)
    {
        if (!type.HasNeftLists) return (null, null, null);
        if (states.Count == 0) return (null, null, "Please choose the MSME DFO's states.");
        var known = await DistrictsOfAsync(states, ct);
        var districts = new List<string>();
        foreach (var d in req.Districts ?? [])
        {
            var code = d?.Trim() ?? "";
            if (!known.Any(k => string.Equals(k.DistrictCode!.Trim(), code, StringComparison.OrdinalIgnoreCase)))
                return (null, null, "Please choose the districts of the chosen states.");
            if (!districts.Contains(code, StringComparer.OrdinalIgnoreCase)) districts.Add(code);
        }
        var lists = (req.NeftLists ?? []).Select(l => l?.Trim().ToLowerInvariant()).Where(l => l is "main" or "consultancy").Distinct().ToList();
        if (lists.Count == 0) return (null, null, "Please tick Financial Assistance and / or Handholding.");
        return (LoginScope.Join(districts), string.Join(',', lists.Select(l => l + ":neft")), null);
    }

    private async Task<Dictionary<string, ScopeRow>> ScopesAsync(CancellationToken ct)
    {
        try
        {
            return (await db.QuerySqlAsync<ScopeRow>(ScopesSql, null, ct))
                .GroupBy(r => r.UserId, StringComparer.OrdinalIgnoreCase).ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);
        }
        catch (System.Data.Common.DbException ex)
        {
            log.LogWarning(ex, "Login scopes not read (is migration 0057 applied?)");
            return [];
        }
    }

    private static AccountRow WithScope(AccountRow r, Dictionary<string, ScopeRow> scopes) =>
        LoginScopes.CanHaveScope(r.RoleId) && scopes.TryGetValue(r.UserId, out var s)
            ? r with { SectorActivity = s.SectorActivity, Levels = LoginScope.Split(s.ScopeLevels), States = LoginScope.Split(s.ScopeStates) }
            : r;

    private sealed record ScopeValues(string? SectorActivity, string? Levels, string? States, string? Districts = null);

    private (ScopeValues? Values, string? Error) ValidateScope(AccountType type, AccountRequest req)
    {
        if (!type.HasScope) return (new ScopeValues(null, null, null), null);
        string? sector = null;
        if (!string.IsNullOrWhiteSpace(req.SectorActivity))
        {
            sector = UserSectorActivity.Canonical(req.SectorActivity);
            if (sector is null) return (null, "Please choose Manufacturing, Services or Both.");
        }
        var levels = new List<string>();
        foreach (var l in type.HasLevels ? req.Levels ?? [] : [])
        {
            var code = LevelOptions.FirstOrDefault(o => string.Equals(o.Code, l?.Trim(), StringComparison.OrdinalIgnoreCase))?.Code;
            if (code is null) return (null, "Please choose the certification levels from the list.");
            if (!levels.Contains(code)) levels.Add(code);
        }
        var states = new List<string>();
        if (type.HasStateScope)
        {
            foreach (var st in req.States ?? [])
            {
                var code = st?.Trim() ?? "";
                if (!DashboardFilters.States.ContainsKey(code)) return (null, "Please choose the applicable states from the list.");
                if (!states.Contains(code, StringComparer.OrdinalIgnoreCase)) states.Add(code);
            }
        }
        // Every level / every state = no limit (stored as NULL), so a level or state added later is included.
        if (levels.Count == LevelOptions.Count) levels.Clear();
        // An MSME DFO keeps its states as chosen (its first one is also its Users.StateCode).
        if (states.Count == DashboardFilters.States.Count && !type.HasNeftLists) states.Clear();
        return (new ScopeValues(sector == UserSectorActivity.Both ? null : sector, LoginScope.Join(levels), LoginScope.Join(states)), null);
    }

    private async Task SaveScopeAsync(string userId, AccountType type, ScopeValues scope, CancellationToken ct)
    {
        if (!type.HasScope) return;
        try
        {
            await db.ExecuteSqlAsync(SaveScopeSql, new { UserId = userId, type.RoleId, scope.SectorActivity, ScopeLevels = scope.Levels, ScopeStates = scope.States, ScopeDistricts = scope.Districts }, ct);
        }
        catch (System.Data.Common.DbException ex) when (scope.SectorActivity is null && scope.Levels is null && scope.States is null)
        {
            log.LogWarning(ex, "Login scope of {UserId} not saved (is migration 0057 applied?)", userId);
        }
        HttpContext.RequestServices.GetRequiredService<LoginScopes>().Forget(userId);
    }

    [HttpPost]
    public async Task<ActionResult<CreatedAccountResponse>> Create(AccountRequest req, CancellationToken ct)
    {
        var userId = req.UserId?.Trim() ?? "";
        if (userId.Length < 4 || !StaffUserRules.IsUserId(userId)) return this.Problem400("Please enter a User ID of 4 to 50 letters and digits.");
        var (type, values, error) = Validate(req, req.RoleId);
        if (error is not null) return this.Problem400(error);
        if (!type!.CanAdd) return this.Problem400("A Dashboard Admin is created on the main ZED portal: it opens this portal from there.");
        var (scope, scopeError) = ValidateScope(type!, req);
        if (scopeError is not null) return this.Problem400(scopeError);
        var (screens, screensError) = ValidateScreens(type!, req);
        if (screensError is not null) return this.Problem400(screensError);
        var (districts, lists, dfoError) = await ValidateDfoAsync(type!, req, LoginScope.Split(scope!.States), ct);
        if (dfoError is not null) return this.Problem400(dfoError);
        if (type!.HasNeftLists) { scope = scope! with { Districts = districts }; screens = lists; values = values! with { StateCode = LoginScope.Split(scope.States)[0] }; }
        var store = HttpContext.RequestServices.GetRequiredService<SubUserStore>();
        if (await store.IdTakenAsync(userId, ct)) return this.Problem400("This User ID is already in use. Please choose another.");

        var password = SecureRandom.Password();
        var passwords = PasswordStore.For(db, HttpContext.RequestServices);
        await db.ExecuteSqlAsync(
            "INSERT INTO Users (UserId, Password, UserName, RoleId, IsActive, Email, MobileNo, StateCode, CreatedBy, CreatedDate) " +
            "VALUES (@UserId, @Password, @UserName, @RoleId, 1, @Email, @MobileNo, @StateCode, @CreatedBy, GETDATE());",
            new { UserId = userId, Password = passwords.StoredValueFor(password), values!.UserName, type!.RoleId, values.Email, values.MobileNo, values.StateCode, CreatedBy = UserId }, ct);
        await passwords.SetAsync(userId, password, ct);
        await SaveScopeAsync(userId, type, scope!, ct);
        if (type.HasScreens || type.HasNeftLists) await SaveScreensAsync(userId, screens, ct);
        log.LogInformation("{Type} login {NewUserId} created by {Actor}", type.Label, userId, UserId);

        // A one-time link to set the password; Master Admin and Super Admin logins still get the password (StaffWelcomeLogin).
        var login = await StaffWelcomeLogin.ForAsync(HttpContext, userId, type.RoleId, password, UserId, ct);
        var sent = await SendLoginAsync(userId, values.UserName, values.Email, type.Label, login, reset: false, ct);
        return new CreatedAccountResponse(sent
            ? $"{type.Label} login {userId} created. The login details have been sent to {values.Email}."
            : $"{type.Label} login {userId} created, but the e-mail with the login details could not be sent. Please use Reset Password to send them again.", userId);
    }

    [HttpPut("{userId}")]
    public async Task<ActionResult<MessageResponse>> Update(string userId, AccountRequest req, CancellationToken ct)
    {
        if (await FindAsync(userId, ct) is not { } row) return NotFound();
        var (type, values, error) = Validate(req, row.RoleId);
        if (error is not null) return this.Problem400(error);
        var (scope, scopeError) = ValidateScope(type!, req);
        if (scopeError is not null) return this.Problem400(scopeError);
        var (screens, screensError) = ValidateScreens(type!, req);
        if (screensError is not null) return this.Problem400(screensError);
        var (districts, lists, dfoError) = await ValidateDfoAsync(type!, req, LoginScope.Split(scope!.States), ct);
        if (dfoError is not null) return this.Problem400(dfoError);
        if (type!.HasNeftLists) { scope = scope! with { Districts = districts }; screens = lists; values = values! with { StateCode = LoginScope.Split(scope.States)[0] }; }
        await db.ExecuteSqlAsync(
            "UPDATE Users SET UserName = @UserName, Email = @Email, MobileNo = @MobileNo, StateCode = @StateCode WHERE UserId = @UserId AND RoleId = @RoleId;",
            new { row.UserId, values!.UserName, values.Email, values.MobileNo, values.StateCode, row.RoleId }, ct);
        await SaveScopeAsync(row.UserId, type!, scope!, ct);
        if (type!.HasScreens || type.HasNeftLists) await SaveScreensAsync(row.UserId, screens, ct);
        log.LogInformation("{Type} login {UserId} updated by {Actor}", type!.Label, row.UserId, UserId);
        // M12: the state (an MSME DFO's lists) is in the sign-in cookie: the user's sessions end and the next sign-in has the new one.
        await SessionStamps.EndSessionsAsync(db, host.System, row.UserId, log, ct);
        return new MessageResponse("Login updated. The user is signed out and the change applies at the next sign-in.");
    }

    [HttpPost("{userId}/block")]
    public Task<ActionResult<MessageResponse>> Block(string userId, CancellationToken ct) => SetActiveAsync(userId, false, ct);

    [HttpPost("{userId}/unblock")]
    public Task<ActionResult<MessageResponse>> Unblock(string userId, CancellationToken ct) => SetActiveAsync(userId, true, ct);

    /// <summary>A new password, mailed to the login's e-mail address.</summary>
    [HttpPost("{userId}/reset-password")]
    public async Task<ActionResult<MessageResponse>> ResetPassword(string userId, CancellationToken ct)
    {
        if (await FindAsync(userId, ct) is not { } row) return NotFound();
        if (row.Email is not { Length: > 0 } to) return this.Problem400("Please add the e-mail address first.");
        var passwords = PasswordStore.For(db, HttpContext.RequestServices);
        if (await passwords.IsManagedByMainAsync(row.UserId, ct))
            return this.Problem400("This login's password is managed on the main ZED portal. Please reset it there.");
        var password = SecureRandom.Password();
        await passwords.SetAsync(row.UserId, password, ct);
        await db.ExecuteSqlAsync("UPDATE Users SET Password = @Password WHERE UserId = @UserId AND RoleId = @RoleId;",
            new { Password = passwords.StoredValueFor(password), row.UserId, row.RoleId }, ct);
        log.LogInformation("Password of {UserId} reset by {Actor}", row.UserId, UserId);
        await SessionStamps.EndSessionsAsync(db, host.System, row.UserId, log, ct);
        var label = Types.FirstOrDefault(t => t.RoleId == row.RoleId)?.Label ?? "Dashboard Admin";
        return await SendLoginAsync(row.UserId, row.UserName ?? row.UserId, to, label, new StaffWelcomeLogin(password, null), reset: true, ct)
            ? new MessageResponse($"A new password has been sent to {to}.")
            : this.Problem400("The password was reset, but the e-mail could not be sent. Please try again.");
    }

    private static IReadOnlyList<StateOption> States =>
        DashboardFilters.States.OrderBy(s => s.Value, StringComparer.Ordinal).Select(s => new StateOption(s.Key, s.Value)).ToList();

    private async Task<AccountRow?> FindAsync(string userId, CancellationToken ct)
    {
        if (!StaffUserRules.IsUserId(userId)) return null;
        var rows = await db.QuerySqlAsync<AccountRow>(
            "SELECT TOP (1) UserId, UserName, RoleId, Email, MobileNo, StateCode, IsActive, CreatedBy, CreatedDate FROM Users " +
            "WHERE UserId = @UserId AND RoleId IN @Roles AND NOT (RoleId = 6 AND ISNULL(StateCode, '') = 'ALL') ORDER BY CASE WHEN IsActive = 1 THEN 0 ELSE 1 END, Id DESC;",
            new { UserId = userId, Roles = MyRoles }, ct);
        return rows.Count > 0 ? rows[0] : null;
    }

    private async Task<ActionResult<MessageResponse>> SetActiveAsync(string userId, bool active, CancellationToken ct)
    {
        if (await FindAsync(userId, ct) is not { } row) return NotFound();
        await db.ExecuteSqlAsync("UPDATE Users SET IsActive = @IsActive WHERE UserId = @UserId AND RoleId = @RoleId;",
            new { IsActive = active, row.UserId, row.RoleId }, ct);
        log.LogInformation("Login {UserId} {Action} by {Actor}", row.UserId, active ? "unblocked" : "blocked", UserId);
        await SessionStamps.EndSessionsAsync(db, host.System, row.UserId, log, ct);
        return new MessageResponse(active ? "Login unblocked." : "Login blocked.");
    }

    private sealed record Values(string UserName, string Email, string MobileNo, string? StateCode);

    private (AccountType? Type, Values? Values, string? Error) Validate(AccountRequest req, int roleId)
    {
        var type = Mine.FirstOrDefault(t => t.RoleId == roleId);
        if (type is null) return (null, null, "Please select the login type.");
        if (!StaffUserRules.TryText(req.UserName, 100, required: true, multiline: false, out var name)) return (null, null, "Please enter the name (up to 100 characters).");
        var mail = req.Email?.Trim();
        if (!StaffUserRules.IsEmail(mail)) return (null, null, "Please enter a valid e-mail address.");
        var mobile = req.MobileNo?.Trim() ?? "";
        if (!StaffUserRules.MobilePattern().IsMatch(mobile)) return (null, null, "Please enter a valid 10 digit mobile number.");
        string? state = null;
        if (type.NeedsState)
        {
            state = req.StateCode?.Trim();
            if (state is null || !DashboardFilters.States.ContainsKey(state)) return (null, null, "Please select the state of the MSME DFO.");
        }
        return (type, new Values(name!, mail!, mobile, state), null);
    }

    private async Task<bool> SendLoginAsync(string userId, string name, string to, string label, StaffWelcomeLogin login, bool reset, CancellationToken ct)
    {
        // No office copy: the mail carries a password or a set-password link.
        var mail = new StaffUserMail(email, templates, portal, addresses, log);
        return await mail.SendAsync<StaffLoginDetailsEmail>(to,
            (reset ? "New Password" : "Login Details") + " for “MSME Sustainable (ZED) Certification” - " + userId, login.AddTo(new()
            {
                [nameof(StaffLoginDetailsEmail.UserName)] = name,
                [nameof(StaffLoginDetailsEmail.UserId)] = userId,
                [nameof(StaffLoginDetailsEmail.AccountType)] = label,
                [nameof(StaffLoginDetailsEmail.Reset)] = reset,
                [nameof(StaffLoginDetailsEmail.LoginUrl)] = mail.LoginUrl,
            }), ct, copyOffice: false);
    }
}
