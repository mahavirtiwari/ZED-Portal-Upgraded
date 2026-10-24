using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using Zed.Core.Security;

namespace Zed.Core.Http;

/// <summary>Who is signed in, sign-out, and public client settings for the Angular app.</summary>
[ApiController]
[Route("api")]
public sealed class SessionController(IOptions<RecaptchaOptions> recaptcha, IOptions<PortalOptions> portal, ICaptchaSettings captcha) : ControllerBase
{
    /// <summary>Returns the signed-in user, or 204 when nobody is signed in. Also issues the XSRF cookie.</summary>
    [HttpGet("auth/me")]
    [AllowAnonymous]
    public ActionResult<CurrentUserResponse> Me() =>
        ZedUser.FromPrincipal(User) is { } user ? CurrentUserResponse.From(user) : NoContent();

    [HttpPost("auth/logout")]
    [AllowAnonymous]
    public async Task<IActionResult> Logout()
    {
        await HttpContext.SignOutZedUserAsync();
        return NoContent();
    }

    /// <param name="CaptchaMode">"off", "text" (the portal's 6-character picture, GET api/captcha) or "google".</param>
    public sealed record ClientConfig(bool CaptchaEnabled, string CaptchaMode, string CaptchaSiteKey, string LegacyPortalUrl, string? EnvironmentLabel);

    [HttpGet("config")]
    [AllowAnonymous]
    public async Task<ClientConfig> Config(CancellationToken ct)
    {
        var mode = await captcha.GetAsync(ct);
        return new(mode != Security.CaptchaMode.Off, mode.ToString().ToLowerInvariant(),
            mode == Security.CaptchaMode.Google ? recaptcha.Value.SiteKey : "", portal.Value.LegacyBaseUrl.TrimEnd('/'),
            string.IsNullOrWhiteSpace(portal.Value.EnvironmentLabel) ? null : portal.Value.EnvironmentLabel.Trim());
    }

    /// <summary>A new 6-character captcha picture, when the captcha mode is "text" (404 otherwise).</summary>
    [HttpGet("captcha")]
    [AllowAnonymous]
    [EnableRateLimiting(RateLimitPolicies.Captcha)]
    public async Task<IActionResult> NewCaptcha([FromServices] TextCaptcha text, CancellationToken ct)
    {
        if (await captcha.GetAsync(ct) != Security.CaptchaMode.Text) return NotFound();
        Response.Headers.CacheControl = "no-store";
        return Ok(await text.CreateAsync(ct));
    }
}
