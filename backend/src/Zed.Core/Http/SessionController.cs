using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Zed.Core.Security;

namespace Zed.Core.Http;

/// <summary>Who is signed in, sign-out, and public client settings for the Angular app.</summary>
[ApiController]
[Route("api")]
public sealed class SessionController(IOptions<RecaptchaOptions> recaptcha, IOptions<PortalOptions> portal) : ControllerBase
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

    public sealed record ClientConfig(bool CaptchaEnabled, string CaptchaSiteKey, string LegacyPortalUrl, string? EnvironmentLabel);

    [HttpGet("config")]
    [AllowAnonymous]
    public ClientConfig Config() =>
        new(recaptcha.Value.Enabled, recaptcha.Value.SiteKey, portal.Value.LegacyBaseUrl.TrimEnd('/'),
            string.IsNullOrWhiteSpace(portal.Value.EnvironmentLabel) ? null : portal.Value.EnvironmentLabel.Trim());
}
