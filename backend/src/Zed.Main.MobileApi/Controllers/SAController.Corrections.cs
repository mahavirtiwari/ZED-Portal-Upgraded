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

    private AppFormChecks FormChecks => HttpContext.RequestServices.GetRequiredService<AppFormChecks>();

    private async Task<bool> InAgencyReviewAsync(string zedId, string certification, CancellationToken ct) =>
        (await db.QuerySqlAsync<ReviewStatusRow>(ReviewStatusSql, new { ZedId = zedId, Certification = certification }, ct)).FirstOrDefault()?.CertificationStatus == 15;

    /// <summary>The answers the agency sent back for correction (none outside the agency's review).</summary>
    [HttpPost]
    [DeviceBound(MobileApps.SiteAssessor, "saId")]
    public Task<IActionResult> FormCorrections(SaAssessmentRequest request, CancellationToken ct) => Guarded(nameof(FormCorrections), async () =>
    {
        if (await CheckNamedAssessorAsync(nameof(FormCorrections), request.saId, request.zedId, request.certificationType, ct) is { } refused) return refused;
        var certification = AppFormSubmission.Certification(request.certificationType);
        if (portal.System != PortalSystem.Main || !await InAgencyReviewAsync(request.zedId!, certification, ct))
            return LegacyJson(new SaFormCorrectionsResponse { status = "1" });
        return LegacyJson(new SaFormCorrectionsResponse { status = "1", corrections = (await FormChecks.CorrectionsAsync(PortalSystem.Main, request.zedId!, certification, ct)).Select(SaFormCorrection.From).ToList() });
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
