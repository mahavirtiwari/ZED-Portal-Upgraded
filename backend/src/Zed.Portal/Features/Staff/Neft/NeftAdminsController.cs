using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.SubUsers;
using Zed.Portal.Features.Staff.Users;
using Zed.Portal.Templates;

namespace Zed.Portal.Features.Staff.Neft;

/// <summary>
/// New (2026-11-07): the Master Admin creates and assigns the NEFT Admin logins, the national NEFT desk that sees the NEFT
/// transactions and reports of every state (<see cref="NeftController.SeesAllStates"/>). A NEFT Admin is a Users row with the
/// MSME DFO role (6, which the NEFT procedures use) and the state <see cref="NeftController.AllStates"/>; the Admin's
/// User Management keeps the state-wise MSME DFOs and does not list these. Same list and pop-up as User Management
/// (Staff/user-management/accounts.ts in its NEFT Admins mode): add, edit, block, unblock, reset password. Main only: one
/// NEFT Admin signs in there for financial assistance and opens the Consultancy portal's Technology Upgradation
/// reimbursements from there (AdminPortalsController hand-over), instead of a second login on the Consultancy portal.
/// </summary>
[Route("api/staff/neft-admins")]
[StaffRoles(UserRole.MasterAdmin)]
[PortalSystems(PortalSystem.Main)]
public sealed class NeftAdminsController(
    ISqlExecutor db,
    PortalHost host,
    IEmailSender email,
    IHtmlTemplateRenderer templates,
    IOptions<PortalOptions> portal,
    EmailAddresses addresses,
    ILogger<NeftAdminsController> log) : StaffApiController
{
    public const string Label = "NEFT Admin";
    private const int Role = (int)UserRole.StateCoordinator;

    public sealed record NeftAdminRow(
        string UserId, string? UserName, int RoleId, string? Email, string? MobileNo, string? StateCode, bool? IsActive, string? CreatedBy, DateTime? CreatedDate);

    public sealed record LoginType(int RoleId, string Label, bool NeedsState);

    /// <summary>The shape of User Management's list, with this one login type.</summary>
    public sealed record NeftAdminsResponse(IReadOnlyList<LoginType> Types, IReadOnlyList<object> States, IReadOnlyList<NeftAdminRow> Accounts);

    public sealed record NeftAdminRequest(string? UserId, string? UserName, string? Email, string? MobileNo);

    public sealed record CreatedResponse(string Message, string UserId);

    internal const string ListSql =
        "SELECT UserId, UserName, RoleId, Email, MobileNo, StateCode, IsActive, CreatedBy, CreatedDate FROM Users " +
        "WHERE RoleId = 6 AND StateCode = 'ALL' ORDER BY UserId;";
    internal const string FindSql =
        "SELECT TOP (1) UserId, UserName, RoleId, Email, MobileNo, StateCode, IsActive, CreatedBy, CreatedDate FROM Users " +
        "WHERE UserId = @UserId AND RoleId = 6 AND StateCode = 'ALL' ORDER BY CASE WHEN IsActive = 1 THEN 0 ELSE 1 END, Id DESC;";
    internal const string InsertSql =
        "INSERT INTO Users (UserId, Password, UserName, RoleId, IsActive, Email, MobileNo, StateCode, CreatedBy, CreatedDate) " +
        "VALUES (@UserId, @Password, @UserName, 6, 1, @Email, @MobileNo, 'ALL', @CreatedBy, GETDATE());";
    internal const string UpdateSql =
        "UPDATE Users SET UserName = @UserName, Email = @Email, MobileNo = @MobileNo WHERE UserId = @UserId AND RoleId = 6 AND StateCode = 'ALL';";

    [HttpGet]
    public async Task<NeftAdminsResponse> List(CancellationToken ct) =>
        new([new LoginType(Role, Label, false)], [], await db.QuerySqlAsync<NeftAdminRow>(ListSql, null, ct));

    [HttpPost]
    public async Task<ActionResult<CreatedResponse>> Create(NeftAdminRequest req, CancellationToken ct)
    {
        var userId = req.UserId?.Trim() ?? "";
        if (userId.Length < 4 || !StaffUserRules.IsUserId(userId)) return this.Problem400("Please enter a User ID of 4 to 50 letters and digits.");
        if (Validate(req, out var name, out var mail, out var mobile) is { } error) return this.Problem400(error);
        if (await HttpContext.RequestServices.GetRequiredService<SubUserStore>().IdTakenAsync(userId, ct))
            return this.Problem400("This User ID is already in use. Please choose another.");

        var password = SecureRandom.Password();
        var passwords = PasswordStore.For(db, HttpContext.RequestServices);
        await db.ExecuteSqlAsync(InsertSql, new { UserId = userId, Password = passwords.StoredValueFor(password), UserName = name, Email = mail, MobileNo = mobile, CreatedBy = UserId }, ct);
        await passwords.SetAsync(userId, password, ct);
        log.LogInformation("NEFT Admin login {NewUserId} created by {Actor}", userId, UserId);

        var login = await StaffWelcomeLogin.ForAsync(HttpContext, userId, Role, password, UserId, ct);
        var sent = await SendLoginAsync(userId, name!, mail!, login, reset: false, ct);
        return new CreatedResponse(sent
            ? $"NEFT Admin login {userId} created. The login details have been sent to {mail}."
            : $"NEFT Admin login {userId} created, but the e-mail with the login details could not be sent. Please use Reset Password to send them again.", userId);
    }

    [HttpPut("{userId}")]
    public async Task<ActionResult<MessageResponse>> Update(string userId, NeftAdminRequest req, CancellationToken ct)
    {
        if (await FindAsync(userId, ct) is not { } row) return NotFound();
        if (Validate(req, out var name, out var mail, out var mobile) is { } error) return this.Problem400(error);
        await db.ExecuteSqlAsync(UpdateSql, new { row.UserId, UserName = name, Email = mail, MobileNo = mobile }, ct);
        log.LogInformation("NEFT Admin login {UserId} updated by {Actor}", row.UserId, UserId);
        await SessionStamps.EndSessionsAsync(db, host.System, row.UserId, log, ct);
        return new MessageResponse("Login updated. The user is signed out and the change applies at the next sign-in.");
    }

    [HttpPost("{userId}/block")]
    public Task<ActionResult<MessageResponse>> Block(string userId, CancellationToken ct) => SetActiveAsync(userId, false, ct);

    [HttpPost("{userId}/unblock")]
    public Task<ActionResult<MessageResponse>> Unblock(string userId, CancellationToken ct) => SetActiveAsync(userId, true, ct);

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
        await db.ExecuteSqlAsync("UPDATE Users SET Password = @Password WHERE UserId = @UserId AND RoleId = 6 AND StateCode = 'ALL';",
            new { Password = passwords.StoredValueFor(password), row.UserId }, ct);
        log.LogInformation("Password of NEFT Admin {UserId} reset by {Actor}", row.UserId, UserId);
        await SessionStamps.EndSessionsAsync(db, host.System, row.UserId, log, ct);
        return await SendLoginAsync(row.UserId, row.UserName ?? row.UserId, to, new StaffWelcomeLogin(password, null), reset: true, ct)
            ? new MessageResponse($"A new password has been sent to {to}.")
            : this.Problem400("The password was reset, but the e-mail could not be sent. Please try again.");
    }

    private async Task<NeftAdminRow?> FindAsync(string userId, CancellationToken ct) =>
        StaffUserRules.IsUserId(userId) ? (await db.QuerySqlAsync<NeftAdminRow>(FindSql, new { UserId = userId }, ct)).FirstOrDefault() : null;

    private async Task<ActionResult<MessageResponse>> SetActiveAsync(string userId, bool active, CancellationToken ct)
    {
        if (await FindAsync(userId, ct) is not { } row) return NotFound();
        await db.ExecuteSqlAsync("UPDATE Users SET IsActive = @IsActive WHERE UserId = @UserId AND RoleId = 6 AND StateCode = 'ALL';",
            new { IsActive = active, row.UserId }, ct);
        log.LogInformation("NEFT Admin {UserId} {Action} by {Actor}", row.UserId, active ? "unblocked" : "blocked", UserId);
        await SessionStamps.EndSessionsAsync(db, host.System, row.UserId, log, ct);
        return new MessageResponse(active ? "Login unblocked." : "Login blocked.");
    }

    private static string? Validate(NeftAdminRequest req, out string? name, out string? mail, out string? mobile)
    {
        mail = req.Email?.Trim();
        mobile = req.MobileNo?.Trim() ?? "";
        if (!StaffUserRules.TryText(req.UserName, 100, required: true, multiline: false, out name)) return "Please enter the name (up to 100 characters).";
        if (!StaffUserRules.IsEmail(mail)) return "Please enter a valid e-mail address.";
        if (!StaffUserRules.MobilePattern().IsMatch(mobile)) return "Please enter a valid 10 digit mobile number.";
        return null;
    }

    private async Task<bool> SendLoginAsync(string userId, string name, string to, StaffWelcomeLogin login, bool reset, CancellationToken ct)
    {
        var mail = new StaffUserMail(email, templates, portal, addresses, log);
        return await mail.SendAsync<StaffLoginDetailsEmail>(to,
            (reset ? "New Password" : "Login Details") + " for “MSME Sustainable (ZED) Certification” - " + userId, login.AddTo(new()
            {
                [nameof(StaffLoginDetailsEmail.UserName)] = name,
                [nameof(StaffLoginDetailsEmail.UserId)] = userId,
                [nameof(StaffLoginDetailsEmail.AccountType)] = Label,
                [nameof(StaffLoginDetailsEmail.Reset)] = reset,
                [nameof(StaffLoginDetailsEmail.LoginUrl)] = mail.LoginUrl,
            }), ct, copyOffice: false);
    }
}
