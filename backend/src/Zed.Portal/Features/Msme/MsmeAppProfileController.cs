using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Zed.Core.Http;
using Zed.Core.Mobile;
using Zed.Core.Security;

namespace Zed.Portal.Features.Msme;

/// <summary>
/// New (2026-11-07), for the ZED MSME app 2.0: the Enterprise Profile as on the web (<see cref="MsmeProfileService"/>:
/// details, activity change, change of the registered e-mail with an OTP to the new address) and the Edit History, on
/// the main portal with the app's sign-in token (<see cref="AppTokens.Header"/>), as <see cref="MsmeAppFilesController"/>.
/// The ZED ID is always the token's unit. Answers <c>{status, errorMessage, ...}</c>; 401 when the token is not accepted
/// (the app then signs out).
/// </summary>
public sealed class MsmeAppProfileController(MsmeProfileService profiles, IMsmeEditHistory history, AppTokens tokens) : LegacyMobileController
{
    private string? ClientIp => HttpContext.Connection.RemoteIpAddress?.ToString();

    /// <summary>The unit of a valid ZED MSME app token, else null.</summary>
    private async Task<string?> UnitAsync(CancellationToken ct)
    {
        var token = Request.Headers[AppTokens.Header].ToString();
        if (tokens.Read(token) is not { } t || (t.Unit ?? t.User) is not { Length: > 0 } zedId) return null;
        return await tokens.CheckAsync(token, MobileApps.Msme, null, zedId, ct) == AppTokenCheck.Valid ? zedId : null;
    }

    private IActionResult Answer<T>(MsmeProfileService.Result<T> r, Func<T, object> ok) =>
        r.Value is { } v ? LegacyJson(ok(v)) : Fail(r.Error ?? "Something went wrong. Please try again.");

    [HttpGet("/Msme/AppProfile")]
    public async Task<IActionResult> Profile(CancellationToken ct)
    {
        if (await UnitAsync(ct) is not { } zedId) return Unauthorized();
        return Answer(await profiles.GetAsync(zedId, ct), p => new { status = "1", p.Msme, p.BasicInfo, p.RegisteredEmail });
    }

    [HttpGet("/Msme/AppActivities")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<IActionResult> Activities(CancellationToken ct)
    {
        if (await UnitAsync(ct) is not { } zedId) return Unauthorized();
        return Answer(await profiles.ActivitiesAsync(zedId, ct), list => new { status = "1", Activities = list });
    }

    [HttpPost("/Msme/AppActivity")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<IActionResult> UpdateActivity(string? fiveDigitActivity, CancellationToken ct)
    {
        if (await UnitAsync(ct) is not { } zedId) return Unauthorized();
        var r = await profiles.UpdateActivityAsync(zedId, fiveDigitActivity, ClientIp, ct);
        await history.RecordAsync(new MsmeEdit
        {
            Channel = LoginChannels.Mobile, ZedId = zedId, Action = "Profile: activity updated", Path = Request.Path.Value,
            Success = r.Value is not null, Message = r.Error, IpAddress = ClientIp,
            Data = System.Text.Json.JsonSerializer.Serialize(new { req = new { FiveDigitActivity = fiveDigitActivity } }),
        }, ct);
        return Answer(r, message => new { status = "1", errorMessage = message });
    }

    [HttpPost("/Msme/AppEmailOtp")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<IActionResult> SendEmailOtp(string? email, CancellationToken ct)
    {
        if (await UnitAsync(ct) is not { } zedId) return Unauthorized();
        return Answer(await profiles.SendEmailOtpAsync(zedId, email, ct), to => new { status = "1", SentTo = to });
    }

    [HttpPost("/Msme/AppEmailVerify")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<IActionResult> VerifyEmailOtp(string? otp, CancellationToken ct)
    {
        if (await UnitAsync(ct) is not { } zedId) return Unauthorized();
        return Answer(await profiles.VerifyEmailOtpAsync(zedId, otp, LoginChannels.Mobile, ClientIp, ct), address => new { status = "1", Email = address });
    }

    [HttpGet("/Msme/AppEditHistory")]
    public async Task<IActionResult> EditHistory(int pageNo = 1, int pageSize = 20, CancellationToken ct = default)
    {
        if (await UnitAsync(ct) is not { } zedId) return Unauthorized();
        var page = await MsmeEditHistoryResponses.PageAsync(history, zedId, pageNo, pageSize, ct);
        return LegacyJson(new
        {
            status = "1",
            page.Total,
            page.PageNo,
            page.PageSize,
            // No IP address or device in the app; what was submitted, as on the web (secrets are already masked).
            Rows = page.Rows.Select(r => new { r.Id, r.At, r.Channel, r.Action, r.Result, r.Message, r.Data }),
        });
    }
}
