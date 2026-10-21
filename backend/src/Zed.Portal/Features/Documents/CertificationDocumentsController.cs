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
/// </summary>
[Route("api/msme/certification-documents")]
public sealed class MsmeCertificationDocumentsController(
    ISqlExecutor db,
    IAssessmentDocuments documents,
    IWebHostEnvironment env,
    IOptions<PortalOptions> portal) : MsmeApiController
{
    private static readonly string[] SurveillanceTypes = ["BronzeSurveillance", "SilverSurveillance", "GoldSurveillance"];

    /// <summary>
    /// GET api/msme/certification-documents/{Bronze|Silver|Gold}/certificate: the stored certificate, or a
    /// newly drawn one when the record is certified but the file is missing (as RegenerateCertificate did).
    /// {Level}Surveillance: the certificate the surveillance application stored (never drawn here).
    /// </summary>
    [HttpGet("{certification}/certificate")]
    public async Task<IActionResult> Certificate(string certification, CancellationToken ct)
    {
        var storage = new DocumentStorage(env, portal);
        var surveillance = SurveillanceTypes.FirstOrDefault(t => string.Equals(t, certification, StringComparison.OrdinalIgnoreCase));
        if (surveillance is not null)
        {
            var level = surveillance.Replace("Surveillance", "");
            return storage.Find(DocumentLevels.SurveillanceCertificatePath(ZedId, level)) is { } path
                ? DocumentResults.PhysicalFile(this, path)
                : NotFound();
        }

        if (DocumentLevels.Level(certification) is not { } lvl) return this.Problem400("Invalid certification.");
        var record = await AssessmentRecords.CertificationAsync(db, ZedId, lvl, ct);
        return await CertificationDownloads.CertificateAsync(this, storage, documents, record, ZedId, lvl, ct);
    }

    /// <summary>
    /// GET api/msme/certification-documents/{Bronze|Silver|Gold}/report[?record=ZEDMSME000123_D_45]: the
    /// assessment report of the MSME's certified record, or of one of its rejected records (the rejection
    /// e-mail links to it). Drawn from the current data each time, as the old page was.
    /// </summary>
    [HttpGet("{certification}/report")]
    public async Task<IActionResult> Report(string certification, string? record, CancellationToken ct)
    {
        if (DocumentLevels.Level(certification) is not { } level) return this.Problem400("Invalid certification.");
        var recordId = string.IsNullOrEmpty(record) ? ZedId : record;
        // Another MSME's record answers 404 like a missing one.
        if (!AssessmentInput.IsId(recordId) ||
            !string.Equals(AssessmentInput.BaseZedId(recordId), ZedId, StringComparison.OrdinalIgnoreCase))
            return NotFound();

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

internal static class CertificationDownloads
{
    public static async Task<IActionResult> CertificateAsync(ControllerBase c, DocumentStorage storage, IAssessmentDocuments documents,
        CertificationRecord? record, string zedId, string level, CancellationToken ct)
    {
        if (record is null || !DocumentLevels.IsCertified(level, record.CertificationStatus)) return c.NotFound();
        if (storage.Find(DocumentLevels.CertificatePath(zedId, level)) is { } path) return DocumentResults.PhysicalFile(c, path);
        try
        {
            var file = await documents.IssueCertificateAsync(zedId, level, ct);
            return DocumentResults.Pdf(c, file.Content, level + ".pdf");
        }
        catch (DocumentNotAvailableException)
        {
            return c.NotFound();
        }
    }

    public static async Task<IActionResult> ReportAsync(ControllerBase c, IAssessmentDocuments documents,
        CertificationRecord? record, string zedId, string level, CancellationToken ct)
    {
        if (record is null ||
            !(DocumentLevels.IsCertified(level, record.CertificationStatus) || record.CertificationStatus == DocumentLevels.Rejected))
            return c.NotFound();
        try
        {
            var file = await documents.RenderReportAsync(zedId, level, ct);
            return DocumentResults.Pdf(c, file.Content, level + "_Report.pdf");
        }
        catch (DocumentNotAvailableException)
        {
            return c.NotFound();
        }
    }
}
