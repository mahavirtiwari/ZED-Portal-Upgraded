using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Msme;
using Zed.Portal.Templates;

namespace Zed.Portal.Features.Account;

/// <summary>Signed-in user's own account. Port of UserController.ChangePassword (used by every role).</summary>
[ApiController]
[Route("api/account")]
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

        var row = (await db.QueryProcMultipleAsync("SP_GET_USER_DETAILS_BY_USER_ID", new { user.UserId }, ct))[0].FirstOrDefault();
        var stored = row?.Text("Password") ?? "";
        if (row is null || !CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(stored), Encoding.UTF8.GetBytes(req.OldPassword)))
            return this.Problem400("Invalid Old Password.");
        if (req.NewPassword == req.OldPassword) return this.Problem400("The new password must be different from the old password.");

        await db.ExecuteSqlAsync("UPDATE Users SET Password = @Password WHERE UserId = @UserId",
            new { Password = req.NewPassword, user.UserId }, ct);

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
}
