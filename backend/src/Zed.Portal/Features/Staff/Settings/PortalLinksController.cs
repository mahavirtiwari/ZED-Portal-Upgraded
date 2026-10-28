using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Settings;

/// <summary>
/// Admin → Links (new in V4): the links to pages outside the portal (<see cref="PortalLinks.All"/>: Contact ZED, the
/// Ministry's logo, the app stores, MSME KAWACH, the LGD Directory) - where each goes and whether the pages show it
/// (enabled unless the Admin switches it off). Per system, in its own database (dbo.V4Settings, migration 0011); an empty
/// address goes back to the default.
/// </summary>
[Route("api/staff/settings/links")]
[StaffRoles(UserRole.Admin)]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed class PortalLinksController(IPortalSettings settings, IOptions<PortalOptions> portal, ILogger<PortalLinksController> log) : StaffApiController
{
    /// <param name="Url">The address saved here, or null (the default applies).</param>
    /// <param name="DefaultUrl">Used while none is saved.</param>
    /// <param name="Enabled">Whether the pages show the link.</param>
    public sealed record LinkItem(string Key, string Name, string ShownOn, string? Url, string DefaultUrl, bool Enabled);

    public sealed record LinksResponse(IReadOnlyList<LinkItem> Links);

    /// <param name="Enabled">Null keeps it as it is.</param>
    public sealed record LinkRequest(string? Url, bool? Enabled = null);

    [HttpGet]
    public async Task<LinksResponse> Get(CancellationToken ct)
    {
        var items = new List<LinkItem>();
        foreach (var l in PortalLinks.All)
            items.Add(new(l.Key, l.Name, l.ShownOn, await settings.GetAsync(l.UrlKey, ct), PortalLinks.DefaultUrl(l, portal.Value),
                await settings.GetAsync(l.EnabledKey, ct) != "0"));
        return new(items);
    }

    [HttpPut("{key}")]
    public async Task<IActionResult> Save(string key, LinkRequest req, CancellationToken ct)
    {
        if (PortalLinks.Find(key) is not { } link) return NotFound();
        if (PortalLinks.Problem(req.Url) is { } problem) return this.Problem400($"{link.Name}: {problem}");
        var value = string.IsNullOrWhiteSpace(req.Url) ? null : req.Url.Trim();
        try
        {
            await settings.SetAsync(link.UrlKey, value, UserId, ct);
            // Enabled is the default: no row. Disabled: "0".
            if (req.Enabled is { } enabled) await settings.SetAsync(link.EnabledKey, enabled ? null : "0", UserId, ct);
        }
        catch (SqlException ex)
        {
            log.LogError(ex, "Could not save the link {Key} (is migration 0011 applied?)", link.Key);
            return this.Problem400("The link could not be saved. Please ask the administrator to apply database migration 0011.");
        }
        log.LogInformation("Link {Key} {Action}{Switch} by {UserId}", link.Key, value is null ? "reset to the default" : "set",
            req.Enabled switch { true => ", enabled", false => ", disabled", null => "" }, UserId);
        return Ok(new MessageResponse($"{link.Name} saved. Pages opened from now on use it."));
    }
}
