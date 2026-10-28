using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Settings;

/// <summary>
/// Admin → Links (new in V4): where "Contact ZED" goes (the ZED website's contact page by default). Per system, in its own
/// database (dbo.V4Settings, migration 0011); an empty box goes back to the server configuration (Portal:ContactUrl).
/// </summary>
[Route("api/staff/settings/links")]
[StaffRoles(UserRole.Admin)]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed class PortalLinksController(IPortalSettings settings, IOptions<PortalOptions> portal, ILogger<PortalLinksController> log) : StaffApiController
{
    /// <param name="ContactUrl">The address saved here, or null.</param>
    /// <param name="DefaultContactUrl">The server configuration's address, used while none is saved.</param>
    public sealed record LinksResponse(string? ContactUrl, string DefaultContactUrl);

    public sealed record LinksRequest(string? ContactUrl);

    [HttpGet]
    public async Task<LinksResponse> Get(CancellationToken ct) =>
        new(await settings.GetAsync(PortalLinks.ContactUrlKey, ct), portal.Value.ContactUrl);

    [HttpPut]
    public async Task<IActionResult> Save(LinksRequest req, CancellationToken ct)
    {
        if (PortalLinks.Problem(req.ContactUrl) is { } problem) return this.Problem400($"Contact ZED: {problem}");
        var value = string.IsNullOrWhiteSpace(req.ContactUrl) ? null : req.ContactUrl.Trim();
        try
        {
            await settings.SetAsync(PortalLinks.ContactUrlKey, value, UserId, ct);
        }
        catch (SqlException ex)
        {
            log.LogError(ex, "Could not save the links (is migration 0011 applied?)");
            return this.Problem400("The links could not be saved. Please ask the administrator to apply database migration 0011.");
        }
        log.LogInformation("Contact ZED link {Action} by {UserId}", value is null ? "reset to the configuration" : "set", UserId);
        return Ok(new MessageResponse("Links saved. Pages opened from now on use them."));
    }
}
