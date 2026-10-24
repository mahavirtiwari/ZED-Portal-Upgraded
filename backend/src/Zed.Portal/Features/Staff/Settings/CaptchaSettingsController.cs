using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Settings;

/// <summary>
/// Admin → Captcha Settings (new in V4): turns the captcha of the login, registration, contact and staff password reset
/// forms off, or chooses the portal's own 6-character captcha or Google reCAPTCHA (only when its keys are configured).
/// Per system, in the system's own database (dbo.V4Settings, migration 0011). The MSME app's captcha is not affected.
/// </summary>
[Route("api/staff/settings/captcha")]
[StaffRoles(UserRole.Admin)]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed class CaptchaSettingsController(ICaptchaSettings settings, ILogger<CaptchaSettingsController> log) : StaffApiController
{
    /// <param name="Mode">"off", "text" or "google".</param>
    public sealed record CaptchaSettingsResponse(string Mode, bool GoogleAvailable);

    public sealed record CaptchaSettingsRequest(string? Mode);

    [HttpGet]
    public async Task<CaptchaSettingsResponse> Get(CancellationToken ct) =>
        new((await settings.GetAsync(ct)).ToString().ToLowerInvariant(), settings.GoogleConfigured);

    [HttpPut]
    public async Task<IActionResult> Save(CaptchaSettingsRequest req, CancellationToken ct)
    {
        if (!Enum.TryParse<CaptchaMode>(req.Mode, ignoreCase: true, out var mode) || !Enum.IsDefined(mode) || int.TryParse(req.Mode, out _))
            return this.Problem400("Please select a captcha option.");
        if (mode == CaptchaMode.Google && !settings.GoogleConfigured)
            return this.Problem400("Google reCAPTCHA keys are not configured on this server.");
        try
        {
            await settings.SetAsync(mode, UserId, ct);
        }
        catch (SqlException ex)
        {
            log.LogError(ex, "Could not save the captcha setting (is migration 0011 applied?)");
            return this.Problem400("The setting could not be saved. Please ask the administrator to apply database migration 0011.");
        }
        log.LogInformation("Captcha mode set to {Mode} by {UserId}", mode, UserId);
        return Ok(new MessageResponse("Captcha setting saved."));
    }
}
