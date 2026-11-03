using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Zed.Core.Assessment;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Settings;

/// <summary>
/// Admin → Site Tour Sections (new in V4): the sections the site assessor app files the site tour photos under, the photos
/// each needs (minimum) and takes (maximum), and the certification levels and NIC sectors each is asked of (none = all).
/// Per system, in the system's own database (dbo.V4Settings, migration 0011; <see cref="SiteTourSections"/>). The mobile API
/// gives each unit its sections, refuses photos beyond a maximum and the closing meeting before every minimum is met.
/// </summary>
[Route("api/staff/settings/site-tour-sections")]
[StaffRoles(UserRole.Admin)]
[PortalSystems(PortalSystem.Main, PortalSystem.Surveillance)]
public sealed class SiteTourSectionsController(IPortalSettings settings, ISqlExecutor db, ILogger<SiteTourSectionsController> log) : StaffApiController
{
    public sealed record LevelOption(string Code, string Name);

    /// <param name="Customised">False while the defaults of the redesigned app are in use (nothing saved yet).</param>
    public sealed record SectionsResponse(IReadOnlyList<SiteTourSection> Sections, IReadOnlyList<LevelOption> Levels, bool Customised);

    public sealed record SectionsRequest(IReadOnlyList<SiteTourSection>? Sections);

    [HttpGet]
    public async Task<SectionsResponse> Get(CancellationToken ct)
    {
        var levels = (await CertLevels.CertificationLevels.AllAsync(db, log, ct))
            .Where(l => !string.Equals(l.Code, "Bronze", StringComparison.OrdinalIgnoreCase))
            .Select(l => new LevelOption(l.Code, l.Name)).ToList();
        return new SectionsResponse(await SiteTourSections.LoadAsync(settings, ct), levels, !string.IsNullOrWhiteSpace(await settings.GetAsync(SiteTourSections.Key, ct)));
    }

    /// <summary>The whole list, in order (new sections with a key the page made up).</summary>
    [HttpPut]
    public async Task<ActionResult<MessageResponse>> Save(SectionsRequest req, CancellationToken ct)
    {
        if (SiteTourSections.Problem(req.Sections) is { } problem) return this.Problem400(problem);
        try
        {
            await SiteTourSections.SaveAsync(settings, req.Sections!, UserId, ct);
        }
        catch (SqlException ex)
        {
            log.LogError(ex, "Could not save the site tour sections (is migration 0011 applied?)");
            return this.Problem400("The sections could not be saved. Please ask the administrator to apply database migration 0011.");
        }
        log.LogInformation("Site tour sections saved by {UserId}: {Count} sections, {Active} in use", UserId, req.Sections!.Count, req.Sections.Count(s => s.Active));
        return new MessageResponse("Site tour sections saved. The app uses them when an assessment is next opened.");
    }

    /// <summary>Back to the ten sections of the redesigned app.</summary>
    [HttpDelete]
    public async Task<ActionResult<MessageResponse>> Reset(CancellationToken ct)
    {
        await settings.SetAsync(SiteTourSections.Key, null, UserId, ct);
        log.LogInformation("Site tour sections reset to the defaults by {UserId}", UserId);
        return new MessageResponse("Site tour sections reset to the standard ten sections.");
    }
}
