using Microsoft.AspNetCore.Mvc;
using Zed.Core.Forms;
using Zed.Core.Http;
using Zed.Core.Mobile;
using Zed.Core.Security;
using Zed.Main.MobileApi.Models.Assessor;

namespace Zed.Main.MobileApi.Controllers;

/// <summary>
/// 2026-11-16 (the user): the site assessor's Basic Information answers to the Admin's "Validation required" fields are
/// checked by the assessment agency on its review (MonitoringReviewController form-checks). One found Not valid comes back
/// here: the assessor app lists it with the agency's remark, and the lead or co-assessor sends the corrected answer, which
/// the agency checks again. Only while the agency's site review is open (status 15).
/// </summary>
public sealed partial class SAController
{
    public const string ReviewStatusSql =
        "SELECT TOP 1 CertificationStatus FROM dbo.MsmeCertifications WHERE ZedId = @ZedId AND Certification = @Certification ORDER BY Id DESC;";

    private sealed record ReviewStatusRow(int? CertificationStatus);

    /// <summary>The assessor's units (lead or co-assessor) under the agency's site review.</summary>
    public const string InReviewSql =
        "SELECT ZedId, Certification FROM dbo.MsmeCertifications WHERE CertificationStatus = 15 AND (SiteAssessorId = @SaId OR CoAssessorId = @SaId);";

    private sealed record InReviewRow(string ZedId, string Certification);

    private AppFormChecks FormChecks => HttpContext.RequestServices.GetRequiredService<AppFormChecks>();

    private async Task<bool> InAgencyReviewAsync(string zedId, string certification, CancellationToken ct) =>
        (await db.QuerySqlAsync<ReviewStatusRow>(ReviewStatusSql, new { ZedId = zedId, Certification = certification }, ct)).FirstOrDefault()?.CertificationStatus == 15;

    /// <summary>
    /// The answers the agency sent back for correction: of one unit, or (no zedId: the assessor app's home page, after the
    /// assessment's local data is gone) of every unit the assessor is lead or co-assessor of under the agency's review.
    /// </summary>
    [HttpPost]
    [DeviceBound(MobileApps.SiteAssessor, "saId")]
    public Task<IActionResult> FormCorrections(SaAssessmentRequest request, CancellationToken ct) => Guarded(nameof(FormCorrections), async () =>
    {
        if (portal.System != PortalSystem.Main) return LegacyJson(new SaFormCorrectionsResponse { status = "1" });
        var units = new List<(string ZedId, string Certification)>();
        if (string.IsNullOrWhiteSpace(request.zedId))
        {
            if (string.IsNullOrWhiteSpace(request.saId)) return Fail(ErrorText);
            units.AddRange((await db.QuerySqlAsync<InReviewRow>(InReviewSql, new { SaId = request.saId.Trim() }, ct))
                .Select(r => (r.ZedId.Trim(), r.Certification.Trim())));
        }
        else
        {
            if (await CheckNamedAssessorAsync(nameof(FormCorrections), request.saId, request.zedId, request.certificationType, ct) is { } refused) return refused;
            var certification = AppFormSubmission.Certification(request.certificationType);
            if (await InAgencyReviewAsync(request.zedId, certification, ct)) units.Add((request.zedId.Trim(), certification));
        }
        var corrections = new List<SaFormCorrection>();
        foreach (var (zedId, certification) in units)
            corrections.AddRange((await FormChecks.CorrectionsAsync(PortalSystem.Main, zedId, certification, ct)).Select(c => SaFormCorrection.From(zedId, certification, c)));
        return LegacyJson(new SaFormCorrectionsResponse { status = "1", corrections = corrections });
    });

    /// <summary>The corrected answer (checked against the field's type and choices); the agency checks it again.</summary>
    [HttpPost]
    [DeviceBound(MobileApps.SiteAssessor, "saId")]
    public Task<IActionResult> SubmitFormCorrection(SaFormCorrectionRequest request, CancellationToken ct) => Guarded(nameof(SubmitFormCorrection), async () =>
    {
        if (await CheckNamedAssessorAsync(nameof(SubmitFormCorrection), request.saId, request.zedId, request.certificationType, ct) is { } refused) return refused;
        var certification = AppFormSubmission.Certification(request.certificationType);
        if (portal.System != PortalSystem.Main || !await InAgencyReviewAsync(request.zedId!, certification, ct))
            return Fail("The agency's review of this site assessment is not open.");
        var error = await FormChecks.CorrectAsync(PortalSystem.Main, request.zedId!, certification, request.form, request.key, request.value, request.saId!.Trim(), ct);
        return LegacyJson(error is null ? new ServiceResponse { status = "1" } : ServiceResponse.Fail(error));
    });
}
