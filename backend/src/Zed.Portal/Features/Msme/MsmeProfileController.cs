using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Portal.Features.Msme;

/// <summary>
/// The signed-in MSME's profile. Port of Views/Msme/ViewProfile.cshtml and the MsmeController actions it
/// used: GetDetails (SP_MSME_GET_DETAILS), GetUdyam (Ministry Udyam service), ValidatePlantAndActivity
/// (SP_MSME_VALIDATE_UDYAM_DETAILS) and UpdateUdyamDetails (SP_MSME_UPDATE_UDYAM_DETAILS); since 2026-11-07 also the
/// change of the registered e-mail with an OTP to the new address. The work is in <see cref="MsmeProfileService"/>
/// (shared with the ZED MSME app). MsmeController.UpdateProfile / DisablePlant are super-admin features (their
/// procedures only act for RoleId 10) and move with the admin pages.
/// The ZED ID, Udyam number and mobile number always come from the sign-in cookie and the database;
/// the legacy actions took them (and the activity text) from the browser.
/// </summary>
[Route("api/msme/profile")]
public sealed class MsmeProfileController(MsmeProfileService profiles) : MsmeApiController
{
    private string? ClientIp => HttpContext.Connection.RemoteIpAddress?.ToString();

    public sealed record ProfileResponse(Dictionary<string, object?> Msme, Dictionary<string, object?> BasicInfo, string? RegisteredEmail);

    /// <summary>Basic information, selected unit and unit activity (SP_MSME_GET_DETAILS sets 0 and 1), registered e-mail.</summary>
    [HttpGet]
    public async Task<ActionResult<ProfileResponse>> Get(CancellationToken ct)
    {
        var r = await profiles.GetAsync(ZedId, ct);
        if (r.Value is not { } p) return Problem(r);
        return new ProfileResponse(p.Msme, p.BasicInfo, p.RegisteredEmail);
    }

    /// <summary>"Edit Activity": the activities of the MSME's own Udyam record, read from the Ministry service.</summary>
    [HttpGet("activities")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<ActionResult<List<Dictionary<string, string>>>> Activities(CancellationToken ct)
    {
        var r = await profiles.ActivitiesAsync(ZedId, ct);
        return r.Value is { } list ? list : Problem(r);
    }

    public sealed record UpdateActivityRequest(string FiveDigitActivity);

    /// <summary>"Update": the chosen activity, checked against the Udyam record and the scheme's sectors.</summary>
    [HttpPost("activity")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    [MsmeEditAudit("Profile: activity updated")]
    public async Task<ActionResult<MessageResponse>> UpdateActivity(UpdateActivityRequest req, CancellationToken ct)
    {
        var r = await profiles.UpdateActivityAsync(ZedId, req.FiveDigitActivity, ClientIp, ct);
        return r.Value is { } message ? new MessageResponse(message) : Problem(r);
    }

    public sealed record EmailOtpRequest(string? Email);
    public sealed record EmailVerifyRequest(string? Otp);
    public sealed record EmailChangedResponse(string Message, string Email);

    /// <summary>"Change e-mail", step 1: an OTP to the new address.</summary>
    [HttpPost("email/otp")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<ActionResult<MessageResponse>> SendEmailOtp(EmailOtpRequest req, CancellationToken ct)
    {
        var r = await profiles.SendEmailOtpAsync(ZedId, req.Email, ct);
        return r.Value is { } to ? new MessageResponse($"An OTP has been sent to {to}. It is valid for 10 minutes.") : Problem(r);
    }

    /// <summary>"Change e-mail", step 2: the OTP makes the new address the registered e-mail.</summary>
    [HttpPost("email/verify")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<ActionResult<EmailChangedResponse>> VerifyEmailOtp(EmailVerifyRequest req, CancellationToken ct)
    {
        var r = await profiles.VerifyEmailOtpAsync(ZedId, req.Otp, LoginChannels.Web, ClientIp, ct);
        return r.Value is { } address ? new EmailChangedResponse("Your registered e-mail has been changed.", address) : Problem(r);
    }

    private ActionResult Problem<T>(MsmeProfileService.Result<T> r) =>
        r.NotFound ? NotFound()
        : r.Unavailable ? Problem(title: r.Error, statusCode: StatusCodes.Status502BadGateway)
        : this.Problem400(r.Error ?? "Something went wrong. Please try again.");
}
