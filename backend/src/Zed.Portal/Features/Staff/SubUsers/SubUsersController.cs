using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
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
/// time. Sub-users cannot manage sub-users. Logins are generated ("&lt;owner ID&gt;S01", …) and mailed with a password.
/// </summary>
[Route("api/staff/sub-users")]
[StaffRoles(UserRole.MasterAdmin, UserRole.Agency)]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed class SubUsersController(
    SubUserStore store,
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
        DateTime CreatedAt, DateTime? LastLoginAt, bool Locked);

    public sealed record SubUsersResponse(string AccountType, IReadOnlyList<PermissionOption> Permissions, IReadOnlyList<SubUserItem> Users);

    public sealed record SubUserRequest(string? UserName, string? Email, string? MobileNo, List<string>? Permissions, bool IsActive = true);

    public sealed record CreatedSubUserResponse(string Message, string UserId);

    private string AccountType => RoleId == (int)UserRole.MasterAdmin ? "Operation Admin" : "Sub-User";

    private IReadOnlyList<SubUserPermission> Available => SubUserPermissions.For(RoleId, CurrentUser.SubRoles ?? [], host.System);

    [HttpGet]
    public async Task<ActionResult<SubUsersResponse>> List(CancellationToken ct)
    {
        if (CurrentUser.IsSubUser) return Forbidden();
        var available = Available;
        var rows = await store.ListAsync(UserId, ct);
        return new SubUsersResponse(AccountType, available.Select(p => new PermissionOption(p.Key, p.Label)).ToList(),
            rows.Select(r => Item(r, available)).ToList());
    }

    [HttpPost]
    public async Task<ActionResult<CreatedSubUserResponse>> Create(SubUserRequest req, CancellationToken ct)
    {
        if (CurrentUser.IsSubUser) return Forbidden();
        var (values, error) = Validate(req);
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
            PasswordStore.Hash(password), 0, null, null, UserId, DateTime.UtcNow), ct);
        log.LogInformation("Sub-user {NewUserId} created by {Owner} with {Permissions}", newId, UserId, values.Permissions);

        var sent = await SendLoginAsync(newId, values.UserName, values.Email, password, reset: false, ct);
        return new CreatedSubUserResponse(sent
            ? $"{AccountType} {newId} created. The login details have been sent to {values.Email}."
            : $"{AccountType} {newId} created, but the e-mail with the login details could not be sent. Please use Reset Password to send them again.", newId);
    }

    [HttpPut("{userId}")]
    public async Task<ActionResult<MessageResponse>> Update(string userId, SubUserRequest req, CancellationToken ct)
    {
        if (CurrentUser.IsSubUser) return Forbidden();
        if (await MineAsync(userId, ct) is not { } row) return NotFound();
        var (values, error) = Validate(req);
        if (error is not null) return this.Problem400(error);
        await store.UpdateAsync(row.UserId, values!.UserName, values.Email, values.MobileNo, values.Permissions, req.IsActive, UserId, ct);
        log.LogInformation("Sub-user {SubUserId} updated by {Owner}: active {Active}, {Permissions}", row.UserId, UserId, req.IsActive, values.Permissions);
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
        return await SendLoginAsync(row.UserId, row.UserName, to, password, reset: true, ct)
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
            r.IsActive, r.CreatedAt, r.LastLoginAt, r.LockedUntil is { } u && u > DateTime.UtcNow);
    }

    private sealed record Values(string UserName, string Email, string? MobileNo, string Permissions);

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

    private async Task<bool> SendLoginAsync(string subUserId, string name, string to, string password, bool reset, CancellationToken ct)
    {
        // No office copy: the mail carries a password.
        var mail = new StaffUserMail(email, templates, portal, addresses, log);
        return await mail.SendAsync<StaffLoginDetailsEmail>(to,
            (reset ? "New Password" : "Login Details") + " for “MSME Sustainable (ZED) Certification” - " + subUserId, new()
            {
                [nameof(StaffLoginDetailsEmail.UserName)] = name,
                [nameof(StaffLoginDetailsEmail.UserId)] = subUserId,
                [nameof(StaffLoginDetailsEmail.Password)] = password,
                [nameof(StaffLoginDetailsEmail.AccountType)] = AccountType,
                [nameof(StaffLoginDetailsEmail.WorksFor)] = $"{CurrentUser.UserName} ({UserId})",
                [nameof(StaffLoginDetailsEmail.Reset)] = reset,
                [nameof(StaffLoginDetailsEmail.LoginUrl)] = mail.LoginUrl,
            }, ct, copyOffice: false);
    }
}
