using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Msme;
using Zed.Portal.Features.Staff.Assessment;

namespace Zed.Portal.Features.Documents;

/// <summary>
/// The signed-in MSME's certificates and assessment reports ("Download Certificate" / "Download Report" on
/// Certification details). On the old site the certificate was a public static file
/// (<c>/Certificates/DA/{ZedId}/Bronze.pdf</c>) and the report a public page (<c>/SA/ReportSummary/{ZedId}</c>),
/// readable by anyone with a ZED ID (SECURITY-FINDINGS #18). Here the ZED ID comes from the sign-in cookie.
/// <para>
/// Surveillance certificates and reports ("{Level}Surveillance") and handholding milestone reports (<c>?milestone=n</c>)
/// were public pages of the ZEDCS_SURVEILLANCE and ZEDCS_CONSULTANCY applications
/// (<c>/surveillance/SA/ReportSummary/{ZedId}</c>, <c>/consultancy/SA/ReportSummary/{ZedId}?milestone=n</c>). Main
/// serves them to the owning MSME from those databases through read-only connections (<see cref="SystemDatabases"/>);
/// without the connection they answer 404.
/// </para>
/// </summary>
[Route("api/msme/certification-documents")]
public sealed class MsmeCertificationDocumentsController(
    ISqlExecutor db,
    IAssessmentDocuments documents,
    IWebHostEnvironment env,
    IOptions<PortalOptions> portal,
    ILogger<DocumentRenderer> log) : MsmeApiController
{
    /// <summary>
    /// GET api/msme/certification-documents/{Bronze|Silver|Gold}/certificate: the stored certificate, or a
    /// newly drawn one when the record is certified but the file is missing (as RegenerateCertificate did).
    /// {Level}Surveillance: the certificate the surveillance host stored, or drawn from ZED_SURVEILLANCE when the
    /// surveillance record is certified and the file is missing.
    /// </summary>
    [HttpGet("{certification}/certificate")]
    public async Task<IActionResult> Certificate(string certification, CancellationToken ct)
    {
        var renderer = new DocumentRenderer(env, portal, log);
        if (DocumentLevels.SurveillanceLevel(certification) is { } surveillanceLevel)
        {
            if (renderer.Storage.Find(DocumentLevels.SurveillanceCertificatePath(ZedId, surveillanceLevel)) is { } path)
                return DocumentResults.PhysicalFile(this, path);
            if (SystemDatabases.Open(HttpContext.RequestServices, PortalSystem.Surveillance) is not { } surveillanceDb) return NotFound();
            var surveillanceRecord = await AssessmentRecords.CertificationAsync(surveillanceDb, ZedId, surveillanceLevel, ct);
            if (surveillanceRecord is null || !DocumentLevels.IsCertified(surveillanceLevel, surveillanceRecord.CertificationStatus)) return NotFound();
            return await CertificationDownloads.PdfAsync(this, () => renderer.IssueSurveillanceCertificateAsync(surveillanceDb, ZedId, surveillanceLevel, ct));
        }

        if (DocumentLevels.Level(certification) is not { } lvl) return this.Problem400("Invalid certification.");
        var record = await AssessmentRecords.CertificationAsync(db, ZedId, lvl, ct);
        return await CertificationDownloads.CertificateAsync(this, renderer.Storage, documents, record, ZedId, lvl, ct);
    }

    /// <summary>
    /// GET api/msme/certification-documents/{Bronze|Silver|Gold}/report[?record=ZEDMSME000123_D_45]: the
    /// assessment report of the MSME's certified record, or of one of its rejected records (the rejection
    /// e-mail links to it). Drawn from the current data each time, as the old page was.
    /// {Level}Surveillance/report: the surveillance report (ZED_SURVEILLANCE), same rules.
    /// {Silver|Gold}/report?milestone=1..3: the handholding milestone report (ZED_CONSULTANT).
    /// </summary>
    [HttpGet("{certification}/report")]
    public async Task<IActionResult> Report(string certification, string? record, int? milestone, CancellationToken ct)
    {
        var surveillanceLevel = DocumentLevels.SurveillanceLevel(certification);
        if ((surveillanceLevel ?? DocumentLevels.Level(certification)) is not { } level) return this.Problem400("Invalid certification.");
        var renderer = new DocumentRenderer(env, portal, log);

        if (milestone is not null)
        {
            if (surveillanceLevel is not null || level == "Bronze" || milestone is < 1 or > DocumentLevels.Milestones || !string.IsNullOrEmpty(record))
                return this.Problem400("Invalid milestone.");
            if (SystemDatabases.Open(HttpContext.RequestServices, PortalSystem.Consultancy) is not { } consultancyDb) return NotFound();
            var milestoneRecord = await AssessmentRecords.CertificationAsync(consultancyDb, ZedId, level, ct);
            return await MilestoneDownloads.ReportAsync(this, renderer, consultancyDb, milestoneRecord, ZedId, level, milestone.Value, preview: false, ct);
        }

        var recordId = string.IsNullOrEmpty(record) ? ZedId : record;
        // Another MSME's record answers 404 like a missing one.
        if (!AssessmentInput.IsId(recordId) ||
            !string.Equals(AssessmentInput.BaseZedId(recordId), ZedId, StringComparison.OrdinalIgnoreCase))
            return NotFound();

        if (surveillanceLevel is not null)
        {
            if (SystemDatabases.Open(HttpContext.RequestServices, PortalSystem.Surveillance) is not { } surveillanceDb) return NotFound();
            var surveillanceRow = await AssessmentRecords.CertificationAsync(surveillanceDb, recordId, level, ct);
            if (!CertificationDownloads.HasReport(level, surveillanceRow)) return NotFound();
            return await CertificationDownloads.PdfAsync(this, () => renderer.RenderSurveillanceReportAsync(surveillanceDb, recordId, level, ct));
        }

        var row = await AssessmentRecords.CertificationAsync(db, recordId, level, ct);
        return await CertificationDownloads.ReportAsync(this, documents, row, recordId, level, ct);
    }
}

/// <summary>
/// Certificates and reports for staff, with the visibility rule of the desktop-assessment review page
/// (<see cref="CertificationRecord.CanView"/>: master admin, super admin, ministry, citizen feedback and QC
/// see every record; an agency its allotted records; an assessor the records it assessed). Replaces the
/// public links of Assessment/Completed ("Download Pledge Certificate / Certificate / Report").
/// </summary>
[Route("api/staff/certification-documents/{zedId}")]
[StaffRoles(UserRole.MasterAdmin, UserRole.Agency, UserRole.DesktopAssessor, UserRole.SuperAdmin, UserRole.Ministry, UserRole.CitizenFeedback, UserRole.QC)]
public sealed class StaffCertificationDocumentsController(
    ISqlExecutor db,
    IAssessmentDocuments documents,
    IWebHostEnvironment env,
    IOptions<PortalOptions> portal) : StaffApiController
{
    [HttpGet("{certification}/certificate")]
    public async Task<IActionResult> Certificate(string zedId, string certification, CancellationToken ct)
    {
        if (!AssessmentInput.IsId(zedId) || DocumentLevels.Level(certification) is not { } level) return this.Problem400("Invalid request.");
        var record = await AssessmentRecords.CertificationAsync(db, zedId, level, ct);
        if (record is null || !record.CanView(CurrentUser)) return NotFound();
        return await CertificationDownloads.CertificateAsync(this, new DocumentStorage(env, portal), documents, record, zedId, level, ct);
    }

    /// <summary>Report of a certified record or of a rejected one (zedId may be the rejected copy, ZEDMSME000123_D_45).</summary>
    [HttpGet("{certification}/report")]
    public async Task<IActionResult> Report(string zedId, string certification, CancellationToken ct)
    {
        if (!AssessmentInput.IsId(zedId) || DocumentLevels.Level(certification) is not { } level) return this.Problem400("Invalid request.");
        var record = await AssessmentRecords.CertificationAsync(db, zedId, level, ct);
        if (record is null || !record.CanView(CurrentUser)) return NotFound();
        return await CertificationDownloads.ReportAsync(this, documents, record, zedId, level, ct);
    }

    /// <summary>The MSME's pledge certificate, for users who may see at least one of its certification records.</summary>
    [HttpGet("pledge-certificate")]
    public async Task<IActionResult> Pledge(string zedId, CancellationToken ct)
    {
        if (!AssessmentInput.IsId(zedId) || zedId.Contains('_')) return this.Problem400("Invalid request.");
        var user = CurrentUser;
        var visible = false;
        foreach (var level in AssessmentInput.Levels)
        {
            if (await AssessmentRecords.CertificationAsync(db, zedId, level, ct) is { } r && r.CanView(user)) { visible = true; break; }
        }
        if (!visible) return NotFound();
        return new DocumentStorage(env, portal).Find(DocumentLevels.PledgePath(zedId)) is { } path
            ? DocumentResults.PhysicalFile(this, path)
            : NotFound();
    }
}

/// <summary>
/// Port of MonitoringController.RegenerateCertificate (a maintenance address, not in any menu): draws the
/// missing certificates of SP_GET_RE_GENERATE_CERTIFICATE_LIST (Bronze records certified since the
/// cut-over date without a CertificateGenerationStatus row). The old GET action was open to any signed-in
/// user; here it is a master-admin POST.
/// </summary>
[Route("api/staff/certification-documents")]
[StaffRoles(UserRole.MasterAdmin)]
public sealed class StaffCertificateRegenerationController(
    ISqlExecutor db,
    IAssessmentDocuments documents,
    IWebHostEnvironment env,
    IOptions<PortalOptions> portal,
    ILogger<StaffCertificateRegenerationController> log) : StaffApiController
{
    public sealed record RegenerateResponse(IReadOnlyList<string> Generated, IReadOnlyList<string> Failed);

    [HttpPost("regenerate")]
    public async Task<RegenerateResponse> Regenerate(CancellationToken ct)
    {
        var storage = new DocumentStorage(env, portal);
        var list = await db.QueryProcMultipleAsync("SP_GET_RE_GENERATE_CERTIFICATE_LIST",
            new { UserId, RoleId = RoleId.ToString(System.Globalization.CultureInfo.InvariantCulture) }, ct);
        var generated = new List<string>();
        var failed = new List<string>();
        foreach (var row in list[0].Take(200))
        {
            var zedId = row.Text("ZedId");
            if (!AssessmentInput.IsId(zedId) || DocumentLevels.Level(row.Text("Certification")) is not { } level) continue;
            if (storage.Find(DocumentLevels.CertificatePath(zedId, level)) is not null) continue;
            try
            {
                await documents.IssueCertificateAsync(zedId, level, ct);
                generated.Add($"{zedId}_{level}");
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogWarning(ex, "Regeneration of {ZedId} {Level} failed", zedId, level);
                failed.Add($"{zedId}_{level}");
            }
        }
        return new RegenerateResponse(generated, failed);
    }
}

/// <summary>
/// Staff downloads on the surveillance and consultancy hosts, with the same roles and visibility rule as main's
/// <see cref="StaffCertificationDocumentsController"/> (the record of the host's own database).
/// <list type="bullet">
/// <item>Surveillance: GET .../{Level}/certificate (the stored surveillance certificate, drawn when missing) and
/// .../{Level}/report (the surveillance report), for certified records and rejected copies.</item>
/// <item>Consultancy: GET .../{Silver|Gold}/report?milestone=1..3 (default: the current milestone), the handholding
/// milestone report the milestone review page links to; also while the milestone waits for the CO's review (status 15,
/// not stored then). Milestones have no certificate.</item>
/// </list>
/// </summary>
[Route("api/staff/certification-documents/{zedId}")]
[PortalSystems(PortalSystem.Consultancy, PortalSystem.Surveillance)]
[StaffRoles(UserRole.MasterAdmin, UserRole.Agency, UserRole.DesktopAssessor, UserRole.SuperAdmin, UserRole.Ministry, UserRole.CitizenFeedback, UserRole.QC)]
public sealed class StaffSystemDocumentsController(
    ISqlExecutor db,
    PortalHost host,
    IAssessmentDocuments documents,
    IWebHostEnvironment env,
    IOptions<PortalOptions> portal,
    ILogger<DocumentRenderer> log) : StaffApiController
{
    [HttpGet("{certification}/certificate")]
    public async Task<IActionResult> Certificate(string zedId, string certification, CancellationToken ct)
    {
        if (!AssessmentInput.IsId(zedId) || Level(certification) is not { } level) return this.Problem400("Invalid request.");
        if (host.System != PortalSystem.Surveillance) return NotFound();
        var record = await AssessmentRecords.CertificationAsync(db, zedId, level, ct);
        if (record is null || !record.CanView(CurrentUser) || !DocumentLevels.IsCertified(level, record.CertificationStatus)) return NotFound();
        var storage = new DocumentStorage(env, portal);
        if (storage.Find(DocumentLevels.SurveillanceCertificatePath(zedId, level)) is { } path) return DocumentResults.PhysicalFile(this, path);
        return await CertificationDownloads.PdfAsync(this, () => documents.IssueCertificateAsync(zedId, level, ct));
    }

    [HttpGet("{certification}/report")]
    public async Task<IActionResult> Report(string zedId, string certification, int? milestone, CancellationToken ct)
    {
        if (!AssessmentInput.IsId(zedId) || Level(certification) is not { } level) return this.Problem400("Invalid request.");
        if (host.System == PortalSystem.Surveillance)
        {
            if (milestone is not null) return this.Problem400("Invalid request.");
            var record = await AssessmentRecords.CertificationAsync(db, zedId, level, ct);
            if (record is null || !record.CanView(CurrentUser)) return NotFound();
            return await CertificationDownloads.ReportAsync(this, documents, record, zedId, level, ct);
        }

        if (level == "Bronze" || milestone is < 1 or > DocumentLevels.Milestones) return this.Problem400("Invalid milestone.");
        var unit = await AssessmentRecords.CertificationAsync(db, zedId, level, ct);
        if (unit is null || !unit.CanView(CurrentUser)) return NotFound();
        return await MilestoneDownloads.ReportAsync(this, new DocumentRenderer(env, portal, log), db, unit, zedId, level,
            milestone ?? unit.Nc, preview: true, ct);
    }

    /// <summary>"Gold", or "GoldSurveillance" as main names it.</summary>
    private static string? Level(string certification) =>
        DocumentLevels.Level(certification) ?? DocumentLevels.SurveillanceLevel(certification);
}

internal static class CertificationDownloads
{
    public static async Task<IActionResult> CertificateAsync(ControllerBase c, DocumentStorage storage, IAssessmentDocuments documents,
        CertificationRecord? record, string zedId, string level, CancellationToken ct)
    {
        if (record is null || !DocumentLevels.IsCertified(level, record.CertificationStatus)) return c.NotFound();
        if (storage.Find(DocumentLevels.CertificatePath(zedId, level)) is { } path) return DocumentResults.PhysicalFile(c, path);
        return await PdfAsync(c, () => documents.IssueCertificateAsync(zedId, level, ct));
    }

    /// <summary>A certified record, or a rejected one (the rejection e-mail links to its report).</summary>
    public static bool HasReport(string level, CertificationRecord? record) =>
        record is not null &&
        (DocumentLevels.IsCertified(level, record.CertificationStatus) || record.CertificationStatus == DocumentLevels.Rejected);

    public static async Task<IActionResult> ReportAsync(ControllerBase c, IAssessmentDocuments documents,
        CertificationRecord? record, string zedId, string level, CancellationToken ct)
    {
        if (!HasReport(level, record)) return c.NotFound();
        return await PdfAsync(c, () => documents.RenderReportAsync(zedId, level, ct));
    }

    /// <summary>Sends a generated document under its legacy file name; 404 when it cannot be produced.</summary>
    public static async Task<IActionResult> PdfAsync(ControllerBase c, Func<Task<DocumentFile>> generate)
    {
        try
        {
            var file = await generate();
            return DocumentResults.Pdf(c, file.Content, Path.GetFileName(file.RelativePath));
        }
        catch (DocumentNotAvailableException)
        {
            return c.NotFound();
        }
    }
}

/// <summary>
/// Handholding milestone reports (ZED_CONSULTANT). MsmeCertifications keeps one row per unit and level whose NcCount is
/// the current milestone, and SP_REPORT_GET_DETAILS only answers for that milestone (C.NcCount = @NcCount); earlier
/// milestones exist only as the files stored when they were completed (GenerateSaRepory), so they are served from storage.
/// The current milestone is drawn from the data once the CO completed it (16), the MSME accepted it (100) or it was
/// rejected (99), and stored under its legacy name; staff may also preview it while it waits for review (15).
/// </summary>
internal static class MilestoneDownloads
{
    /// <summary>MsmeCertifications.CertificationStatus after the consultant's final submit (CO review pending).</summary>
    private const int Submitted = 15;

    public static async Task<IActionResult> ReportAsync(ControllerBase c, DocumentRenderer renderer, ISqlExecutor consultancyDb,
        CertificationRecord? record, string zedId, string level, int milestone, bool preview, CancellationToken ct)
    {
        if (record is null || milestone < 1 || milestone > record.Nc) return c.NotFound();
        if (milestone < record.Nc)
        {
            return renderer.Storage.Find(DocumentLevels.MilestoneReportPath(zedId, level, milestone, rejected: false)) is { } stored
                ? DocumentResults.PhysicalFile(c, stored)
                : c.NotFound();
        }

        var final = DocumentLevels.IsMilestoneCompleted(record.CertificationStatus) || record.CertificationStatus == DocumentLevels.Rejected;
        if (!final && !(preview && record.CertificationStatus == Submitted)) return c.NotFound();
        return await CertificationDownloads.PdfAsync(c, () => renderer.RenderMilestoneReportAsync(consultancyDb, zedId, level, milestone, save: final, ct));
    }
}
