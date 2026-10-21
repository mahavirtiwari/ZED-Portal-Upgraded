using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Templates;

namespace Zed.Portal.Features.Msme;

/// <summary>MSME login and password reset. Port of MsmeController Login / ResetPassword / ChangePassword.</summary>
[ApiController]
[Route("api/msme/auth")]
public sealed class MsmeAuthController(
    ISqlExecutor db,
    ICaptchaVerifier captcha,
    IEmailSender email,
    IHtmlTemplateRenderer templates,
    IOptions<PortalOptions> portal,
    ILogger<MsmeAuthController> log) : ControllerBase
{
    public sealed record LoginRequest(string UserId, string Password, string? CaptchaToken);

    [HttpPost("login")]
    [AllowAnonymous]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<ActionResult<CurrentUserResponse>> Login(LoginRequest req, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.UserId) || string.IsNullOrEmpty(req.Password))
            return this.Problem400("Please enter your ZED ID and password.");
        if (!await captcha.VerifyAsync(req.CaptchaToken, HttpContext.Connection.RemoteIpAddress?.ToString(), ct))
            return this.Problem400("Invalid Captcha.");
        var userId = req.UserId.Trim();
        var sets = await db.QueryProcMultipleAsync("SP_GET_USER_DETAILS", new { UserId = userId, req.Password }, ct);
        var row = sets[0].FirstOrDefault();
        if (row is null)
            return this.Problem400(sets.Scalar(1) ?? "Invalid credentials.");
        if (!LegacyPasswords.MatchesStored(row, req.Password))
        {
            log.LogWarning("Blocked login with a procedure master password for {UserId}", userId);
            return this.Problem400("Invalid credentials.");
        }

        var roleId = int.TryParse(row.Text("RoleId"), out var r) ? r : 0;
        // This page is for MSME users only, as before; other roles sign in on the staff login.
        if (roleId != (int)UserRole.Msme)
            return this.Problem400("This login is for MSME users. Please use the staff login page.");

        await db.ExecuteProcAsync("SP_UPDATE_LOGIN",
            new { UserId = row.Text("UserId"), IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString(), RoleId = roleId.ToString() }, ct);

        var user = new ZedUser(row.Text("UserId"), row.Text("UserName"), roleId, row.Text("Email"),
            row.Text("MobileNo"), row.Text("StateCode"), row.Text("DistrictCode"));
        await HttpContext.SignInZedUserAsync(user);
        return CurrentUserResponse.From(user);
    }

    public sealed record BannerResponse(string? ImageUrl);

    /// <summary>Banner image shown on the login page (SP_MASTER_GET_HOME_PAGE_SETTINGS, as before).</summary>
    [HttpGet("banner")]
    [AllowAnonymous]
    public async Task<BannerResponse> Banner(CancellationToken ct)
    {
        var row = (await db.QueryProcMultipleAsync("SP_MASTER_GET_HOME_PAGE_SETTINGS", new { FileName = "HomePageBanner" }, ct))[0].FirstOrDefault();
        var path = row?.Text("FilePath");
        return new BannerResponse(string.IsNullOrEmpty(path) ? null : path.Replace('\\', '/'));
    }

    public sealed record ForgotPasswordRequest(string UserId);

    /// <summary>Sends a reset link to the pledge e-mail. Always answers the same way so ZED IDs cannot be probed.</summary>
    [HttpPost("forgot-password")]
    [AllowAnonymous]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<ActionResult<MessageResponse>> ForgotPassword(ForgotPasswordRequest req, CancellationToken ct)
    {
        const string message = "If the ZED ID is registered, a reset link has been sent to the registered Email ID.";
        if (string.IsNullOrWhiteSpace(req.UserId)) return this.Problem400("Please enter your ZED ID.");

        var zedId = req.UserId.Trim();
        var msme = (await db.QueryProcMultipleAsync("SP_MSME_GET_DETAILS", new { ZedId = zedId }, ct))[0].FirstOrDefault();
        var to = msme?.Text("PledgeEmailId");
        if (msme is null || string.IsNullOrEmpty(to)) return new MessageResponse(message);

        var code = SecureRandom.Token();
        await db.ExecuteProcAsync("SP_MSME_PWD_UPDATE_TOKEN", new { UserId = zedId, PwdCode = code }, ct);

        var html = await templates.RenderAsync<ResetPasswordEmail>(new Dictionary<string, object?>
        {
            [nameof(ResetPasswordEmail.EnterpriseName)] = msme.Text("EnterpriseName"),
            [nameof(ResetPasswordEmail.ZedId)] = zedId,
            [nameof(ResetPasswordEmail.ResetUrl)] = $"{portal.Value.PublicBaseUrl.TrimEnd('/')}/msme/reset-password?code={Uri.EscapeDataString(code)}",
            [nameof(ResetPasswordEmail.PublicBaseUrl)] = portal.Value.PublicBaseUrl,
        });
        await email.SendAsync(new EmailMessage(to, "MSME Reset Password Details - " + zedId, html), ct);
        return new MessageResponse(message);
    }

    [HttpGet("reset-password/{code}")]
    [AllowAnonymous]
    public async Task<ActionResult<MessageResponse>> ValidateResetCode(string code, CancellationToken ct) =>
        await FindUserByResetCode(code, ct) is null
            ? this.Problem400("This reset link is invalid or has already been used.")
            : new MessageResponse("Valid");

    public sealed record ResetPasswordRequest(string Code, string NewPassword, string ConfirmPassword);

    [HttpPost("reset-password")]
    [AllowAnonymous]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<ActionResult<MessageResponse>> ResetPassword(ResetPasswordRequest req, CancellationToken ct)
    {
        if (req.NewPassword != req.ConfirmPassword)
            return this.Problem400("NewPassword and ConfirmPassword should be same.");
        if (PasswordPolicy.Validate(req.NewPassword) is { } policyError)
            return this.Problem400(policyError);

        var user = await FindUserByResetCode(req.Code, ct);
        if (user is null) return this.Problem400("This reset link is invalid or has already been used.");

        var userId = user.Text("UserId");
        // Legacy UserHelper.UpdateResetPassword used this inline UPDATE. The reset code is now
        // cleared as well so a link cannot be reused.
        await db.ExecuteSqlAsync("UPDATE Users SET Password = @Password, PwdCode = NULL WHERE UserId = @UserId AND PwdCode = @PwdCode",
            new { Password = req.NewPassword, UserId = userId, PwdCode = req.Code }, ct);

        if (user.Text("Email") is { Length: > 0 } to)
        {
            var html = await templates.RenderAsync<PasswordChangedEmail>(new Dictionary<string, object?>
            {
                [nameof(PasswordChangedEmail.UserName)] = user.Text("UserName"),
                [nameof(PasswordChangedEmail.UserId)] = userId,
                [nameof(PasswordChangedEmail.IsMsme)] = user.Text("RoleId") == ((int)UserRole.Msme).ToString(),
                [nameof(PasswordChangedEmail.PublicBaseUrl)] = portal.Value.PublicBaseUrl,
            });
            try { await email.SendAsync(new EmailMessage(to, "New Login Details - " + user.Text("UserName"), html), ct); }
            catch (Exception ex) { log.LogWarning(ex, "Password changed but confirmation mail to {UserId} failed", userId); }
        }
        return new MessageResponse("Password reset successful.");
    }

    private async Task<IDictionary<string, object?>?> FindUserByResetCode(string? code, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(code) || code.Length > 100) return null;
        return (await db.QueryProcMultipleAsync("SP_MSME_PWD_VALIDATE_CODE", new { PwdCode = code }, ct))[0].FirstOrDefault();
    }
}
