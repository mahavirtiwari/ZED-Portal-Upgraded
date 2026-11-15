using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using SkiaSharp;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Portal.Features.Staff.Assessment;

namespace Zed.Portal.Features.Documents;

/// <summary>
/// The report page's signed addresses (2026-11-15, <see cref="ReportLinks"/>), on each portal:
/// <list type="bullet">
/// <item><c>GET api/report-pages/link?t=…</c>: the report of a link an app handed out (Msme/AppReportLink, SA/AppReportLink),
/// read-only, for 10 minutes, under the rules of the readers it was issued to (final reports only, no drafts).</item>
/// <item><c>GET api/report-pages/pdf?t=…</c>: the stored PDF of an earlier handholding milestone of such a link.</item>
/// <item><c>GET api/report-pages/photo?t=…</c>: a photo of a report page (downscaled JPEG), only from the record's own folders.</item>
/// </list>
/// No cookie is needed: the token is the permission.
/// </summary>
[ApiController]
[AllowAnonymous]
[Route("api/report-pages")]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed class ReportPagesController(
    ISqlExecutor db,
    PortalHost host,
    ReportLinks links,
    ReportPages pages,
    IWebHostEnvironment env,
    IOptions<PortalOptions> portal,
    ILogger<ReportPagesController> log) : ControllerBase
{
    private const int PhotoPixels = 1400;

    [HttpGet("link")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<ActionResult<ReportPageView>> Link(string? t, CancellationToken ct)
    {
        if (links.ReadLink(t) is not { } target || Database(target) is not { } database) return NotFound();
        var record = await AssessmentRecords.CertificationAsync(database, target.ZedId, target.Level, ct);
        return target.Kind == ReportLinks.Milestone
            ? await ReportPageAccess.MilestoneAsync(this, pages, new DocumentStorage(env, portal), database, record, target.ZedId, target.Level,
                target.Milestone!.Value, staff: false, "/api/report-pages/pdf?t=" + Uri.EscapeDataString(t!), ct)
            : await ReportPageAccess.AssessmentAsync(this, pages, database, record, target.ZedId, target.Level,
                surveillance: target.Kind == ReportLinks.Surveillance, staff: false, ct);
    }

    /// <summary>The stored PDF of an earlier milestone (the only stored report a link can name).</summary>
    [HttpGet("pdf")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<IActionResult> Pdf(string? t, CancellationToken ct)
    {
        if (links.ReadLink(t) is not { Kind: ReportLinks.Milestone } target || Database(target) is not { } database) return NotFound();
        var record = await AssessmentRecords.CertificationAsync(database, target.ZedId, target.Level, ct);
        if (record is null || target.Milestone >= record.Nc) return NotFound();
        return new DocumentStorage(env, portal).Find(DocumentLevels.MilestoneReportPath(target.ZedId, target.Level, target.Milestone!.Value, rejected: false)) is { } path
            ? DocumentResults.PhysicalFile(this, path)
            : NotFound();
    }

    [HttpGet("photo")]
    public IActionResult Photo(string? t)
    {
        var storage = new DocumentStorage(env, portal);
        if (links.OpenPhoto(t, storage.Root, storage.Find) is not { } path) return NotFound();
        using var image = ReportPhotos.Downscale(path, PhotoPixels);
        if (image is null)
        {
            log.LogInformation("Report photo could not be read: {File}", Path.GetFileName(path));
            return NotFound();
        }
        using var data = image.EncodedData ?? image.Encode(SKEncodedImageFormat.Jpeg, 80);
        Response.Headers.XContentTypeOptions = "nosniff";
        // The address carries its own permission; the browser may keep the picture while the page is open.
        Response.Headers.CacheControl = "private, max-age=3600";
        return File(data.ToArray(), "image/jpeg");
    }

    /// <summary>The database of the link's report: main's own (assessment), ZED_SURVEILLANCE or ZED_CONSULTANT (this host's or read-only).</summary>
    private ISqlExecutor? Database(ReportLinkTarget target)
    {
        if (DocumentLevels.Level(target.Level) is not { } level || level != target.Level) return null;
        return target.Kind switch
        {
            ReportLinks.Assessment => host.System == PortalSystem.Main ? db : null,
            ReportLinks.Surveillance => SystemDatabases.Open(HttpContext.RequestServices, PortalSystem.Surveillance),
            ReportLinks.Milestone => SystemDatabases.Open(HttpContext.RequestServices, PortalSystem.Consultancy),
            _ => null,
        };
    }
}
