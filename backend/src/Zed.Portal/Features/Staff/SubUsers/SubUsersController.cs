using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.Users;
using Zed.Portal.Templates;

namespace Zed.Portal.Features.Staff.SubUsers;

/// <summary>
/// New in V4: a MasterAdmin's "operation admins" and an agency's (assessment agency, consultant organisation, surveillance
/// agency) sub-users. A sub-user signs in with its own ID and password and works as its owner on the screens the owner
/// ticks (<see cref="SubUserPermissions"/>); the owner can change them, block the sub-user or reset its password at any
/// time. Sub-users cannot manage sub-users. Logins are generated ("&lt;owner ID&gt;S01", …); a new one is mailed a one-time
/// link to set its password (<see cref="StaffWelcomeLogin"/>), a reset mails a new password. A new password or other screens
/// end the sub-user's sessions (<see cref="SubUserStore.SessionStamp"/>).
/// </summary>
[Route("api/staff/sub-users")]
[StaffRoles(UserRole.MasterAdmin, UserRole.Agency)]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed class SubUsersController(
    SubUserStore store,
    ISqlExecutor db,
    PortalHost host,
    IEmailSender email,
    IHtmlTemplateRenderer templates,
    IOptions<PortalOptions> portal,
    EmailAddresses addresses,
    ILogger<SubUsersController> log) : StaffApiController
{
    public const int MaxPerOwner = 50;

    public sealed record PermissionOption(string Key, string Label);

    public sealed record SubUserItem(
        string UserId, string UserName, string? Email, string? MobileNo, IReadOnlyList<string> Permissions, bool IsActive,
        DateTime CreatedAt, DateTime? LastLoginAt, bool Locked)
    {
        /// <summary>2026-11-16: the state codes the sub-user may see; empty = every state (of the owner's).</summary>
        public IReadOnlyList<string> States { get; init; } = [];

        /// <summary>2026-11-16, operation admins: the assessment agencies (user IDs) it may see; empty = every agency.</summary>
        public IReadOnlyList<string> Agencies { get; init; } = [];
    }

    public sealed record Option(string Code, string Name);

    public sealed record SubUsersResponse(string AccountType, IReadOnlyList<PermissionOption> Permissions, IReadOnlyList<SubUserItem> Users)
    {
        /// <summary>2026-11-16: the states that can be chosen (the owner's own, when its login is limited to some).</summary>
        public IReadOnlyList<Option> States { get; init; } = [];

        /// <summary>2026-11-16, Master Admin only: the assessment agencies (consultant organisations on the consultancy portal).</summary>
        public IReadOnlyList<Option>? Agencies { get; init; }
    }

    /// <param name="States">2026-11-16: state codes; empty = every state.</param>
    /// <param name="Agencies">2026-11-16, Master Admin: agency user IDs; empty = every agency.</param>
    public sealed record SubUserRequest(string? UserName, string? Email, string? MobileNo, List<string>? Permissions, bool IsActive = true,
        List<string>? States = null, List<string>? Agencies = null);

    internal const string AgenciesSql = "SELECT UserId AS Code, UserName AS Name FROM dbo.Users WHERE RoleId = 2 AND IsActive = 1 AND UserId IS NOT NULL ORDER BY UserName;";

    private bool ForMasterAdmin => RoleId == (int)UserRole.MasterAdmin;

    /// <summary>2026-11-25: the scope's assessment agencies, for the main Master Admin's Operation Admins only (not the Incentives Master Admin's).</summary>
    private bool AgencyScope => ForMasterAdmin && !Users.IncentivesAdmins.Is(CurrentUser);

    public sealed record CreatedSubUserResponse(string Message, string UserId);

    private string AccountType => RoleId == (int)UserRole.MasterAdmin ? "Operation Admin" : "Sub-User";

    private IReadOnlyList<SubUserPermission> Available => SubUserPermissions.For(RoleId, CurrentUser.SubRoles ?? [], host.System);

    [HttpGet]
    public async Task<ActionResult<SubUsersResponse>> List(CancellationToken ct)
    {
        if (CurrentUser.IsSubUser) return Forbidden();
        var available = Available;
        var rows = await store.ListAsync(UserId, ct);
        return new SubUsersResponse(AccountType, available.Select(p => new PermissionOption(p.Key, p.LabelFor(host.System))).ToList(),
            rows.Select(r => Item(r, available)).ToList())
        {
            States = await StateOptionsAsync(ct),
            Agencies = AgencyScope ? await AgencyOptionsAsync(ct) : null,
        };
    }

    [HttpPost]
    public async Task<ActionResult<CreatedSubUserResponse>> Create(SubUserRequest req, CancellationToken ct)
    {
        if (CurrentUser.IsSubUser) return Forbidden();
        var (values, error) = await ValidateAsync(req, ct);
        if (error is not null) return this.Problem400(error);

        var existing = await store.ListAsync(UserId, ct);
        if (existing.Count >= MaxPerOwner) return this.Problem400($"You can create at most {MaxPerOwner} {AccountType.ToLowerInvariant()}s.");
        string? newId = null;
        for (var n = existing.Count + 1; n <= existing.Count + 200 && newId is null; n++)
        {
            var candidate = UserId + "S" + n.ToString("00", CultureInfo.InvariantCulture);
            if (candidate.Length <= 50 && !await store.IdTakenAsync(candidate, ct)) newId = candidate;
        }
        if (newId is null) return this.Problem400("A login ID could not be generated. Please contact the ZED support team.");

        var password = SecureRandom.Password();
        await store.CreateAsync(new SubUserRow(newId, UserId, RoleId, values!.UserName, values.Email, values.MobileNo, values.Permissions, true,
            PasswordStore.Hash(password), 0, null, null, UserId, DateTime.UtcNow, values.States, values.Agencies), ct);
        log.LogInformation("Sub-user {NewUserId} created by {Owner} with {Permissions}, states {States}, agencies {Agencies}",
            newId, UserId, values.Permissions, values.States ?? "all", values.Agencies ?? "all");

        // A one-time link to set the password (StaffWelcomeLogin; sub-users' links set the dbo.V4SubUsers hash).
        var login = await StaffWelcomeLogin.ForAsync(HttpContext, newId, roleId: 0, password, UserId, ct);
        var sent = await SendLoginAsync(newId, values.UserName, values.Email, login, reset: false, ct);
        return new CreatedSubUserResponse(sent
            ? $"{AccountType} {newId} created. The login details have been sent to {values.Email}."
            : $"{AccountType} {newId} created, but the e-mail with the login details could not be sent. Please use Reset Password to send them again.", newId);
    }

    [HttpPut("{userId}")]
    public async Task<ActionResult<MessageResponse>> Update(string userId, SubUserRequest req, CancellationToken ct)
    {
        if (CurrentUser.IsSubUser) return Forbidden();
        if (await MineAsync(userId, ct) is not { } row) return NotFound();
        var (values, error) = await ValidateAsync(req, ct);
        if (error is not null) return this.Problem400(error);
        await store.UpdateAsync(row.UserId, values!.UserName, values.Email, values.MobileNo, values.Permissions, req.IsActive, UserId, ct,
            values.States, values.Agencies);
        log.LogInformation("Sub-user {SubUserId} updated by {Owner}: active {Active}, {Permissions}, states {States}, agencies {Agencies}",
            row.UserId, UserId, req.IsActive, values.Permissions, values.States ?? "all", values.Agencies ?? "all");
        return new MessageResponse($"{AccountType} {row.UserId} updated.");
    }

    /// <summary>A new password, mailed to the sub-user (it also unlocks a locked sub-user).</summary>
    [HttpPost("{userId}/reset-password")]
    public async Task<ActionResult<MessageResponse>> ResetPassword(string userId, CancellationToken ct)
    {
        if (CurrentUser.IsSubUser) return Forbidden();
        if (await MineAsync(userId, ct) is not { } row) return NotFound();
        if (row.Email is not { Length: > 0 } to) return this.Problem400("Please add the e-mail address first.");
        var password = SecureRandom.Password();
        await store.SetPasswordAsync(row.UserId, PasswordStore.Hash(password), UserId, ct);
        log.LogInformation("Password of sub-user {SubUserId} reset by {Owner}", row.UserId, UserId);
        return await SendLoginAsync(row.UserId, row.UserName, to, new StaffWelcomeLogin(password, null), reset: true, ct)
            ? new MessageResponse($"A new password has been sent to {to}.")
            : this.Problem400("The password was reset, but the e-mail could not be sent. Please try again.");
    }

    private ObjectResult Forbidden() =>
        Problem(title: "Only the account owner can manage these logins.", statusCode: StatusCodes.Status403Forbidden);

    private async Task<SubUserRow?> MineAsync(string userId, CancellationToken ct) =>
        StaffUserRules.IsUserId(userId) && await store.FindAsync(userId, ct) is { } row
        && string.Equals(row.OwnerUserId, UserId, StringComparison.OrdinalIgnoreCase) ? row : null;

    private static SubUserItem Item(SubUserRow r, IReadOnlyList<SubUserPermission> available)
    {
        var keys = SubUserPermissions.Split(r.Permissions).ToHashSet(StringComparer.OrdinalIgnoreCase);
        return new SubUserItem(r.UserId, r.UserName, r.Email, r.MobileNo, available.Where(p => keys.Contains(p.Key)).Select(p => p.Key).ToList(),
            r.IsActive, r.CreatedAt, r.LastLoginAt, r.LockedUntil is { } u && u > DateTime.UtcNow)
        {
            States = LoginScope.Split(r.ScopeStates),
            Agencies = LoginScope.Split(r.ScopeAgencies),
        };
    }

    private sealed record Values(string UserName, string Email, string? MobileNo, string Permissions, string? States = null, string? Agencies = null);

    /// <summary>The states that can be chosen: every state, or only the owner's when its own login is limited to some.</summary>
    private async Task<IReadOnlyList<Option>> StateOptionsAsync(CancellationToken ct)
    {
        var own = (await HttpContext.LoginScopeAsync(ct)).StateCodes;
        return Dashboard.DashboardFilters.States
            .Where(s => own.Count == 0 || own.Contains(s.Key, StringComparer.OrdinalIgnoreCase))
            .OrderBy(s => s.Value, StringComparer.Ordinal).Select(s => new Option(s.Key, s.Value)).ToList();
    }

    private async Task<IReadOnlyList<Option>> AgencyOptionsAsync(CancellationToken ct) =>
        (await db.QuerySqlAsync<Option>(AgenciesSql, null, ct)).Where(a => !string.IsNullOrWhiteSpace(a.Code))
            .Select(a => a with { Code = a.Code.Trim(), Name = (a.Name ?? a.Code).Trim() }).ToList();

    /// <summary>The fields, then the states (known ones, within the owner's) and the agencies (Master Admin; active agencies).</summary>
    private async Task<(Values? Values, string? Error)> ValidateAsync(SubUserRequest req, CancellationToken ct)
    {
        var (values, error) = Validate(req);
        if (error is not null) return (null, error);
        static List<string> Clean(List<string>? list) =>
            (list ?? []).Select(v => v?.Trim() ?? "").Where(v => v.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();

        var states = Clean(req.States);
        if (states.Count > 0)
        {
            var allowed = (await StateOptionsAsync(ct)).Select(o => o.Code).ToHashSet(StringComparer.OrdinalIgnoreCase);
            if (states.Any(s => !allowed.Contains(s))) return (null, "Please select only the states shown.");
        }
        var agencies = Clean(req.Agencies);
        if (agencies.Count > 0)
        {
            if (!AgencyScope) return (null, "Only an operation admin can be limited to assessment agencies.");
            var known = (await AgencyOptionsAsync(ct)).Select(o => o.Code).ToHashSet(StringComparer.OrdinalIgnoreCase);
            if (agencies.Any(a => !known.Contains(a))) return (null, "Please select only the assessment agencies shown.");
        }
        return (values! with { States = LoginScope.Join(states), Agencies = LoginScope.Join(agencies) }, null);
    }

    private (Values? Values, string? Error) Validate(SubUserRequest req)
    {
        if (!StaffUserRules.TryText(req.UserName, 100, required: true, multiline: false, out var name)) return (null, "Please enter the name (up to 100 characters).");
        var mail = req.Email?.Trim();
        if (!StaffUserRules.IsEmail(mail)) return (null, "Please enter a valid e-mail address.");
        var mobile = string.IsNullOrWhiteSpace(req.MobileNo) ? null : req.MobileNo.Trim();
        if (mobile is not null && !StaffUserRules.MobilePattern().IsMatch(mobile)) return (null, "Please enter a valid 10 digit mobile number.");
        var available = Available;
        var asked = (req.Permissions ?? []).Select(p => p?.Trim() ?? "").Where(p => p.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (asked.Count == 0) return (null, "Please select at least one screen.");
        var unknown = asked.FirstOrDefault(a => !available.Any(p => string.Equals(p.Key, a, StringComparison.OrdinalIgnoreCase)));
        if (unknown is not null) return (null, "Please select only the screens of your own login.");
        var keys = string.Join(",", available.Where(p => asked.Contains(p.Key, StringComparer.OrdinalIgnoreCase)).Select(p => p.Key));
        return (new Values(name!, mail!, mobile, keys), null);
    }

    private async Task<bool> SendLoginAsync(string subUserId, string name, string to, StaffWelcomeLogin login, bool reset, CancellationToken ct)
    {
        // No office copy: the mail carries a password or a set-password link.
        var mail = new StaffUserMail(email, templates, portal, addresses, log);
        return await mail.SendAsync<StaffLoginDetailsEmail>(to,
            (reset ? "New Password" : "Login Details") + " for “MSME Sustainable (ZED) Certification” - " + subUserId, login.AddTo(new()
            {
                [nameof(StaffLoginDetailsEmail.UserName)] = name,
                [nameof(StaffLoginDetailsEmail.UserId)] = subUserId,
                [nameof(StaffLoginDetailsEmail.AccountType)] = AccountType,
                [nameof(StaffLoginDetailsEmail.WorksFor)] = $"{CurrentUser.UserName} ({UserId})",
                [nameof(StaffLoginDetailsEmail.Reset)] = reset,
                [nameof(StaffLoginDetailsEmail.LoginUrl)] = mail.LoginUrl,
            }), ct, copyOffice: false, key: EmailTemplateVariants.LoginDetails(reset, subUser: true));
    }
}
