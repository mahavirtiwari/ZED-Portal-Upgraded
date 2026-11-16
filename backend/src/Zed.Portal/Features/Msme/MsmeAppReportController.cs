using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Mobile;
using Zed.Portal.Features.Documents;
using Zed.Portal.Features.Staff.Assessment;

namespace Zed.Portal.Features.Msme;

/// <summary>
/// V4 (2026-11-15), for the ZED MSME app's "View Report": <c>GET /Msme/AppReportLink?certification=…[&amp;milestone=n]</c> with
/// the app's sign-in token (<see cref="AppTokens.Header"/>). The report is a page of the portal (docs/designs/reports-html.html),
/// and the app's token is no web sign-in, so this answers <c>{status: "1", url}</c>: the page address with a signed token valid
/// for 10 minutes and bound to the unit's ZED ID, the report kind, the level and the milestone (<see cref="ReportLinks"/>). The
/// app opens it in the system browser, where Download PDF saves it on the phone. The ZED ID is the token's unit, and the rules
/// are the web's (<see cref="MsmeCertificationDocumentsController.ReportPage"/>): {Level} a certified record, {Level}Surveillance
/// the surveillance report, ?milestone=n the handholding milestone report.
/// </summary>
public sealed class MsmeAppReportController(ISqlExecutor db, AppTokens tokens, ReportLinks links) : LegacyMobileController
{
    public const string NotReady = "The report is available once the certification is complete.";

    [HttpGet("/Msme/AppReportLink")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<IActionResult> AppReportLink(string? certification, int? milestone, CancellationToken ct)
    {
        var (unit, check) = await MsmeAppToken.UnitAsync(Request, tokens, ct);
        if (unit is not { } zedId) return MsmeAppToken.Refused(this, check);

        var surveillanceLevel = DocumentLevels.SurveillanceLevel(certification);
        if ((surveillanceLevel ?? DocumentLevels.Level(certification)) is not { } level) return Fail("Invalid certification.");

        if (milestone is not null)
        {
            if (surveillanceLevel is not null || Zed.Core.Data.LevelRegistry.HandholdingLevel(level) is null || milestone is < 1 or > DocumentLevels.Milestones) return Fail("Invalid milestone.");
            if (SystemDatabases.Open(HttpContext.RequestServices, PortalSystem.Consultancy) is not { } consultancyDb) return Fail(NotReady);
            var record = await AssessmentRecords.CertificationAsync(consultancyDb, zedId, level, ct);
            var ready = record is not null && milestone <= record.Nc &&
                (milestone < record.Nc || DocumentLevels.IsMilestoneCompleted(record.CertificationStatus) || record.CertificationStatus == DocumentLevels.Rejected);
            return ready ? Link(ReportLinks.Milestone, zedId, level, milestone) : Fail(NotReady);
        }

        if (surveillanceLevel is not null)
        {
            if (SystemDatabases.Open(HttpContext.RequestServices, PortalSystem.Surveillance) is not { } surveillanceDb) return Fail(NotReady);
            var surveillanceRow = await AssessmentRecords.CertificationAsync(surveillanceDb, zedId, level, ct);
            return CertificationDownloads.HasReport(level, surveillanceRow) ? Link(ReportLinks.Surveillance, zedId, level, null) : Fail(NotReady);
        }

        var row = await AssessmentRecords.CertificationAsync(db, zedId, level, ct);
        return CertificationDownloads.HasReport(level, row) ? Link(ReportLinks.Assessment, zedId, level, null) : Fail(NotReady);
    }

    private IActionResult Link(string kind, string zedId, string level, int? milestone)
    {
        Response.Headers.CacheControl = "no-store";
        return LegacyJson(new { status = "1", url = links.PageUrl(new ReportLinkTarget(kind, zedId, level, milestone)) });
    }
}
