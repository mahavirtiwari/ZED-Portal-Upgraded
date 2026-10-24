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
/// procedures treat them as before; the password is generated, mailed once and hashed (PasswordStore).
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
    public sealed record AccountType(int RoleId, string Label, bool NeedsState, PortalSystem[] Systems);

    private static readonly PortalSystem[] All = [PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance];

    /// <summary>The logins the Admin creates; MSME DFOs only where the NEFT screens are (main and consultancy).</summary>
    public static readonly IReadOnlyList<AccountType> Types =
    [
        new((int)UserRole.MasterAdmin, "Master Admin", false, All),
        new((int)UserRole.Ministry, "Ministry", false, All),
        new((int)UserRole.StateCoordinator, "MSME DFO", true, [PortalSystem.Main, PortalSystem.Consultancy]),
        new((int)UserRole.SuperAdmin, "Dashboard - Super Admin", false, All),
        new((int)UserRole.CitizenFeedback, "Dashboard - Citizen Feedback", false, All),
        new((int)UserRole.QC, "Dashboard - QC", false, All),
    ];

    public sealed record StateOption(string Code, string Name);

    public sealed record AccountRow(
        string UserId, string? UserName, int RoleId, string? Email, string? MobileNo, string? StateCode, bool? IsActive, string? CreatedBy, DateTime? CreatedDate);

    public sealed record AccountsResponse(IReadOnlyList<AccountType> Types, IReadOnlyList<StateOption> States, IReadOnlyList<AccountRow> Accounts);

    public sealed record AccountRequest(string? UserId, int RoleId, string? UserName, string? Email, string? MobileNo, string? StateCode);

    public sealed record CreatedAccountResponse(string Message, string UserId);

    private IReadOnlyList<AccountType> Mine => Types.Where(t => t.Systems.Contains(host.System)).ToList();

    private int[] MyRoles => Mine.Select(t => t.RoleId).ToArray();

    [HttpGet]
    public async Task<AccountsResponse> List(CancellationToken ct)
    {
        var rows = await db.QuerySqlAsync<AccountRow>(
            "SELECT UserId, UserName, RoleId, Email, MobileNo, StateCode, IsActive, CreatedBy, CreatedDate FROM Users " +
            "WHERE RoleId IN @Roles ORDER BY RoleId, UserId;", new { Roles = MyRoles }, ct);
        return new AccountsResponse(Mine, States, rows);
    }

    [HttpPost]
    public async Task<ActionResult<CreatedAccountResponse>> Create(AccountRequest req, CancellationToken ct)
    {
        var userId = req.UserId?.Trim() ?? "";
        if (userId.Length < 4 || !StaffUserRules.IsUserId(userId)) return this.Problem400("Please enter a User ID of 4 to 50 letters and digits.");
        var (type, values, error) = Validate(req, req.RoleId);
        if (error is not null) return this.Problem400(error);
        var store = HttpContext.RequestServices.GetRequiredService<SubUserStore>();
        if (await store.IdTakenAsync(userId, ct)) return this.Problem400("This User ID is already in use. Please choose another.");

        var password = SecureRandom.Password();
        var passwords = PasswordStore.For(db, HttpContext.RequestServices);
        await db.ExecuteSqlAsync(
            "INSERT INTO Users (UserId, Password, UserName, RoleId, IsActive, Email, MobileNo, StateCode, CreatedBy, CreatedDate) " +
            "VALUES (@UserId, @Password, @UserName, @RoleId, 1, @Email, @MobileNo, @StateCode, @CreatedBy, GETDATE());",
            new { UserId = userId, Password = passwords.StoredValueFor(password), values!.UserName, type!.RoleId, values.Email, values.MobileNo, values.StateCode, CreatedBy = UserId }, ct);
        await passwords.SetAsync(userId, password, ct);
        log.LogInformation("{Type} login {NewUserId} created by {Actor}", type.Label, userId, UserId);

        var sent = await SendLoginAsync(userId, values.UserName, values.Email, type.Label, password, reset: false, ct);
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
        await db.ExecuteSqlAsync(
            "UPDATE Users SET UserName = @UserName, Email = @Email, MobileNo = @MobileNo, StateCode = @StateCode WHERE UserId = @UserId AND RoleId = @RoleId;",
            new { row.UserId, values!.UserName, values.Email, values.MobileNo, values.StateCode, row.RoleId }, ct);
        log.LogInformation("{Type} login {UserId} updated by {Actor}", type!.Label, row.UserId, UserId);
        return new MessageResponse("Login updated. A change of state applies at the user's next sign-in.");
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
        var label = Types.First(t => t.RoleId == row.RoleId).Label;
        return await SendLoginAsync(row.UserId, row.UserName ?? row.UserId, to, label, password, reset: true, ct)
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

    private async Task<bool> SendLoginAsync(string userId, string name, string to, string label, string password, bool reset, CancellationToken ct)
    {
        // No office copy: the mail carries a password.
        var mail = new StaffUserMail(email, templates, portal, addresses, log);
        return await mail.SendAsync<StaffLoginDetailsEmail>(to,
            (reset ? "New Password" : "Login Details") + " for “MSME Sustainable (ZED) Certification” - " + userId, new()
            {
                [nameof(StaffLoginDetailsEmail.UserName)] = name,
                [nameof(StaffLoginDetailsEmail.UserId)] = userId,
                [nameof(StaffLoginDetailsEmail.Password)] = password,
                [nameof(StaffLoginDetailsEmail.AccountType)] = label,
                [nameof(StaffLoginDetailsEmail.Reset)] = reset,
                [nameof(StaffLoginDetailsEmail.LoginUrl)] = mail.LoginUrl,
            }, ct, copyOffice: false);
    }
}
