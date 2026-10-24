using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Msme;
using Zed.Portal.Features.Staff.SubUsers;
using Zed.Portal.Templates;

namespace Zed.Portal.Features.Account;

/// <summary>Signed-in user's own account. Port of UserController.ChangePassword (used by every role).</summary>
[ApiController]
[Route("api/account")]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
[Authorize]
public sealed class AccountController(
    ISqlExecutor db,
    IEmailSender email,
    IHtmlTemplateRenderer templates,
    IOptions<PortalOptions> portal,
    ILogger<AccountController> log) : ControllerBase
{
    public sealed record ChangePasswordRequest(string OldPassword, string NewPassword, string ConfirmPassword);

    /// <summary>
    /// Changes the password after checking the current one, mails a confirmation (without the password,
    /// unlike the old mail) and signs the user out, as the old page did.
    /// </summary>
    [HttpPost("change-password")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<ActionResult<MessageResponse>> ChangePassword(ChangePasswordRequest req, CancellationToken ct)
    {
        var user = ZedUser.FromPrincipal(User)!;
        if (string.IsNullOrEmpty(req.OldPassword)) return this.Problem400("Please enter valid data.");
        if (req.NewPassword != req.ConfirmPassword) return this.Problem400("NewPassword and ConfirmPassword should be same.");
        if (PasswordPolicy.Validate(req.NewPassword) is { } policyError) return this.Problem400(policyError);
        if (user.IsSubUser) return await ChangeSubUserPasswordAsync(user, req, ct);

        var passwords = PasswordStore.For(db, HttpContext.RequestServices);
        if (await passwords.IsManagedByMainAsync(user.UserId, ct))
            return this.Problem400("This account's password is managed on the main ZED portal. Please change it there.");

        var row = (await db.QueryProcMultipleAsync("SP_GET_USER_DETAILS_BY_USER_ID", new { user.UserId }, ct))[0].FirstOrDefault();
        var stored = row?.Text("Password") ?? "";
        var legacyMatch = row is not null && !PasswordStore.IsReplacement(stored) &&
            CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(stored), Encoding.UTF8.GetBytes(req.OldPassword));
        if (row is null || !await passwords.VerifyCurrentAsync(user.UserId, req.OldPassword, legacyMatch, ct))
            return this.Problem400("Invalid Old Password.");
        if (req.NewPassword == req.OldPassword) return this.Problem400("The new password must be different from the old password.");

        await passwords.SetAsync(user.UserId, req.NewPassword, ct);
        await db.ExecuteSqlAsync("UPDATE Users SET Password = @Password WHERE UserId = @UserId",
            new { Password = passwords.StoredValueFor(req.NewPassword), user.UserId }, ct);

        if (row.Text("Email") is { Length: > 0 } to)
        {
            var html = await templates.RenderAsync<PasswordChangedEmail>(new Dictionary<string, object?>
            {
                [nameof(PasswordChangedEmail.UserName)] = row.Text("UserName"),
                [nameof(PasswordChangedEmail.UserId)] = user.UserId,
                [nameof(PasswordChangedEmail.IsMsme)] = user.RoleId == (int)UserRole.Msme,
                [nameof(PasswordChangedEmail.PublicBaseUrl)] = portal.Value.PublicBaseUrl,
            });
            try { await email.SendAsync(new EmailMessage(to, "New Login Details - " + row.Text("UserName"), html), ct); }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogWarning(ex, "Password changed but confirmation mail to {UserId} failed", user.UserId);
            }
        }

        await HttpContext.SignOutZedUserAsync();
        return new MessageResponse("Password changed successful. Please login with your new password.");
    }

    /// <summary>A sub-user changes its own password (dbo.V4SubUsers), never its owner's.</summary>
    private async Task<ActionResult<MessageResponse>> ChangeSubUserPasswordAsync(ZedUser user, ChangePasswordRequest req, CancellationToken ct)
    {
        var store = HttpContext.RequestServices.GetRequiredService<SubUserStore>();
        var sub = await store.FindAsync(user.ActingUserId!, ct);
        if (sub?.PasswordHash is not { Length: > 0 } hash || PasswordStore.Verify(hash, req.OldPassword) == PasswordVerificationResult.Failed)
            return this.Problem400("Invalid Old Password.");
        if (req.NewPassword == req.OldPassword) return this.Problem400("The new password must be different from the old password.");

        await store.SetPasswordAsync(sub.UserId, PasswordStore.Hash(req.NewPassword), sub.UserId, ct);
        log.LogInformation("Sub-user {UserId} changed its password", sub.UserId);
        if (sub.Email is { Length: > 0 } to)
        {
            var html = await templates.RenderAsync<PasswordChangedEmail>(new Dictionary<string, object?>
            {
                [nameof(PasswordChangedEmail.UserName)] = sub.UserName,
                [nameof(PasswordChangedEmail.UserId)] = sub.UserId,
                [nameof(PasswordChangedEmail.IsMsme)] = false,
                [nameof(PasswordChangedEmail.PublicBaseUrl)] = portal.Value.PublicBaseUrl,
            });
            try { await email.SendAsync(new EmailMessage(to, "New Login Details - " + sub.UserName, html), ct); }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogWarning(ex, "Password changed but confirmation mail to sub-user {UserId} failed", sub.UserId);
            }
        }
        await HttpContext.SignOutZedUserAsync();
        return new MessageResponse("Password changed successful. Please login with your new password.");
    }
}
