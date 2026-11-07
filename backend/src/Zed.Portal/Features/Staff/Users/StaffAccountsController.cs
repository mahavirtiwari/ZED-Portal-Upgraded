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
    public sealed record AccountType(int RoleId, string Label, bool NeedsState, PortalSystem[] Systems, bool HasScope = false, bool HasStateScope = false);

    private static readonly PortalSystem[] All = [PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance];

    /// <summary>The logins the Admin creates; MSME DFOs only where the NEFT screens are (main and consultancy).</summary>
    public static readonly IReadOnlyList<AccountType> Types =
    [
        new((int)UserRole.MasterAdmin, "Master Admin", false, All, HasScope: true, HasStateScope: true),
        new((int)UserRole.Ministry, "Ministry", false, All, HasScope: true),
        new((int)UserRole.StateCoordinator, "MSME DFO", true, [PortalSystem.Main, PortalSystem.Consultancy]),
        new((int)UserRole.SuperAdmin, "Dashboard - Super Admin", false, All),
        new((int)UserRole.CitizenFeedback, "Dashboard - Citizen Feedback", false, All),
        new((int)UserRole.QC, "Dashboard - QC", false, All),
    ];

    public sealed record StateOption(string Code, string Name);

    public sealed record AccountRow(
        string UserId, string? UserName, int RoleId, string? Email, string? MobileNo, string? StateCode, bool? IsActive, string? CreatedBy, DateTime? CreatedDate)
    {
        /// <summary>The scope (migration 0057): Manufacturing / Services / Both, level codes, state codes; empty = no limit.</summary>
        public string? SectorActivity { get; init; }
        public IReadOnlyList<string> Levels { get; init; } = [];
        public IReadOnlyList<string> States { get; init; } = [];
    }

    public sealed record LevelOption(string Code, string Name);

    public sealed record AccountsResponse(IReadOnlyList<AccountType> Types, IReadOnlyList<StateOption> States, IReadOnlyList<AccountRow> Accounts)
    {
        public IReadOnlyList<LevelOption> Levels { get; init; } = [];
    }

    /// <param name="SectorActivity">Master Admin / Ministry: Manufacturing, Services or Both (empty = Both).</param>
    /// <param name="Levels">Master Admin / Ministry: the level codes; empty = every level.</param>
    /// <param name="States">Master Admin: the state codes; empty = every state.</param>
    public sealed record AccountRequest(string? UserId, int RoleId, string? UserName, string? Email, string? MobileNo, string? StateCode,
        string? SectorActivity = null, List<string>? Levels = null, List<string>? States = null);

    public sealed record CreatedAccountResponse(string Message, string UserId);

    private IReadOnlyList<AccountType> Mine => Types.Where(t => t.Systems.Contains(host.System)).ToList();

    private int[] MyRoles => Mine.Select(t => t.RoleId).ToArray();

    [HttpGet]
    public async Task<AccountsResponse> List(CancellationToken ct)
    {
        var rows = await db.QuerySqlAsync<AccountRow>(
            "SELECT UserId, UserName, RoleId, Email, MobileNo, StateCode, IsActive, CreatedBy, CreatedDate FROM Users " +
            "WHERE RoleId IN @Roles ORDER BY RoleId, UserId;", new { Roles = MyRoles }, ct);
        var scopes = await ScopesAsync(ct);
        return new AccountsResponse(Mine, States, rows.Select(r => WithScope(r, scopes)).ToList()) { Levels = LevelOptions };
    }

    // ---- scope (migration 0057) ------------------------------------------------------------------

    internal const string ScopesSql =
        "SELECT UserId, SectorActivity, ScopeLevels, ScopeStates FROM Users WHERE RoleId IN (7, 8) AND (SectorActivity IS NOT NULL OR ScopeLevels IS NOT NULL OR ScopeStates IS NOT NULL);";
    internal const string SaveScopeSql =
        "UPDATE Users SET SectorActivity = @SectorActivity, ScopeLevels = @ScopeLevels, ScopeStates = @ScopeStates WHERE UserId = @UserId AND RoleId = @RoleId;";

    public sealed record ScopeRow(string UserId, string? SectorActivity, string? ScopeLevels, string? ScopeStates);

    private static readonly IReadOnlyList<LevelOption> LevelOptions =
        [new("Bronze", "Bronze"), new("Silver", "Silver"), new("Gold", "Gold"), new("ZEDX", "ZED-X")];

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

    private sealed record ScopeValues(string? SectorActivity, string? Levels, string? States);

    private static (ScopeValues? Values, string? Error) ValidateScope(AccountType type, AccountRequest req)
    {
        if (!type.HasScope) return (new ScopeValues(null, null, null), null);
        string? sector = null;
        if (!string.IsNullOrWhiteSpace(req.SectorActivity))
        {
            sector = UserSectorActivity.Canonical(req.SectorActivity);
            if (sector is null) return (null, "Please choose Manufacturing, Services or Both.");
        }
        var levels = new List<string>();
        foreach (var l in req.Levels ?? [])
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
        if (states.Count == DashboardFilters.States.Count) states.Clear();
        return (new ScopeValues(sector == UserSectorActivity.Both ? null : sector, LoginScope.Join(levels), LoginScope.Join(states)), null);
    }

    private async Task SaveScopeAsync(string userId, AccountType type, ScopeValues scope, CancellationToken ct)
    {
        if (!type.HasScope) return;
        try
        {
            await db.ExecuteSqlAsync(SaveScopeSql, new { UserId = userId, type.RoleId, scope.SectorActivity, ScopeLevels = scope.Levels, ScopeStates = scope.States }, ct);
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
        var (scope, scopeError) = ValidateScope(type!, req);
        if (scopeError is not null) return this.Problem400(scopeError);
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
        await db.ExecuteSqlAsync(
            "UPDATE Users SET UserName = @UserName, Email = @Email, MobileNo = @MobileNo, StateCode = @StateCode WHERE UserId = @UserId AND RoleId = @RoleId;",
            new { row.UserId, values!.UserName, values.Email, values.MobileNo, values.StateCode, row.RoleId }, ct);
        await SaveScopeAsync(row.UserId, type!, scope!, ct);
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
        var label = Types.First(t => t.RoleId == row.RoleId).Label;
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
            "WHERE UserId = @UserId AND RoleId IN @Roles ORDER BY CASE WHEN IsActive = 1 THEN 0 ELSE 1 END, Id DESC;", new { UserId = userId, Roles = MyRoles }, ct);
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
