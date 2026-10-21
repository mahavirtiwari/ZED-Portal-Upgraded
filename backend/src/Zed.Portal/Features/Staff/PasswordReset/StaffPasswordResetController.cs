using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.PasswordReset;

/// <summary>"Forgot password?" on the staff login of each portal (see <see cref="StaffPasswordResets"/>).</summary>
[ApiController]
[Route("api/staff/auth/password-reset")]
[AllowAnonymous]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed class StaffPasswordResetController(StaffPasswordResets resets, ICaptchaVerifier captcha, IBackgroundWork background) : ControllerBase
{
    public const string RequestAnswer =
        "If the User ID belongs to an active account with a registered e-mail address, a link to set a new password has been sent to that address. " +
        "Administrator accounts are reset by another administrator.";

    public sealed record ResetRequest(string? UserId, string? CaptchaToken);

    /// <summary>
    /// Always the same answer, sent before any account lookup: the lookup, the link and the mail run in the background,
    /// so neither the answer nor its timing tells whether the account exists.
    /// </summary>
    [HttpPost("request")]
    [EnableRateLimiting(RateLimitPolicies.PasswordReset)]
    public async Task<ActionResult<MessageResponse>> RequestLink(ResetRequest req, CancellationToken ct)
    {
        if (!resets.Options.Enabled)
            return this.Problem400("Password reset is not available on this portal. Please contact the ZED team.");
        var userId = req.UserId?.Trim();
        if (string.IsNullOrEmpty(userId) || userId.Length > 50) return this.Problem400("Please enter your User ID.");
        var ip = HttpContext.Connection.RemoteIpAddress?.ToString();
        if (!await captcha.VerifyAsync(req.CaptchaToken, ip, ct)) return this.Problem400("Invalid Captcha.");

        background.Enqueue("Staff password reset request", (sp, stop) => sp.GetRequiredService<StaffPasswordResets>().RequestAsync(userId, ip, stop));
        return new MessageResponse(RequestAnswer);
    }

    public sealed record TokenRequest(string? Token);

    /// <summary>Whether a link can still be used (the reset page asks before showing the form). The token travels in the body.</summary>
    [HttpPost("check")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<ActionResult<MessageResponse>> Check(TokenRequest req, CancellationToken ct) =>
        await resets.FindByTokenAsync(req.Token, ct) is null
            ? this.Problem400(StaffPasswordResets.InvalidLink)
            : new ActionResult<MessageResponse>(new MessageResponse("Valid"));

    public sealed record NewPasswordRequest(string? Token, string? NewPassword, string? ConfirmPassword);

    [HttpPost("reset")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<ActionResult<MessageResponse>> Reset(NewPasswordRequest req, CancellationToken ct)
    {
        if (req.NewPassword != req.ConfirmPassword) return this.Problem400("NewPassword and ConfirmPassword should be same.");
        if (PasswordPolicy.Validate(req.NewPassword) is { } policyError) return this.Problem400(policyError);
        var error = await resets.ResetAsync(req.Token, req.NewPassword!, HttpContext.Connection.RemoteIpAddress?.ToString(), ct);
        if (error is not null) return this.Problem400(error);
        return new MessageResponse("Your password has been changed. Please log in with your new password.");
    }
}

/// <summary>
/// MasterAdmin: sends a reset link to any staff account of this portal (also MasterAdmin / SuperAdmin accounts, which
/// cannot use "Forgot password?"). The user screens offer the same for the users each role manages.
/// </summary>
[Route("api/staff/password-reset")]
[StaffRoles(UserRole.MasterAdmin)]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed class StaffPasswordResetAdminController(StaffPasswordResets resets) : StaffApiController
{
    [HttpPost("{userId}")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<ActionResult<MessageResponse>> Send(string userId, CancellationToken ct) =>
        this.ToResponse(await resets.SendByAdminAsync(userId, CurrentUser, HttpContext.Connection.RemoteIpAddress?.ToString(), ct));
}

public static class StaffPasswordResetResults
{
    public static ActionResult<MessageResponse> ToResponse(this ControllerBase c, StaffPasswordResets.AdminResult r) =>
        r.Error is null ? new ActionResult<MessageResponse>(new MessageResponse(r.Message!)) : r.NotFound ? new ActionResult<MessageResponse>(c.NotFound()) : new ActionResult<MessageResponse>(c.Problem400(r.Error));
}
