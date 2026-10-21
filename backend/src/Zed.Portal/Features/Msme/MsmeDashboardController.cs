using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;

namespace Zed.Portal.Features.Msme;

/// <summary>
/// Data for the MSME dashboard. Port of MsmeController.GetDetails as used by Views/Msme/Dashboard.cshtml
/// (SP_MSME_GET_DETAILS without a certification type).
/// </summary>
[Route("api/msme/dashboard")]
public sealed class MsmeDashboardController(ISqlExecutor db) : MsmeApiController
{
    // Only the columns the dashboard shows. The legacy action sent whole rows (SELECT * on Msme etc.).
    private static readonly string[] MsmeFields =
    [
        "ZedId", "EnterpriseName", "EnterpriseType", "EnterpriseTypee", "OldEnterpriseType", "RegistrationType", "StateId",
        "PUnitName", "PAddress", "PDistrictName", "PStateName", "PPin",
        "Activity", "TwoDigitActivity", "FourDigitActivity", "FiveDigitActivity", "PledgeOn",
        "IsBronzePaymentDone", "IsSilverPaymentDone", "IsGoldPaymentDone",
        "BronzeDashboardSurStatus", "SilverDashboardSurStatus", "GoldDashboardSurStatus",
        "IsSurBronzePaymentDone", "IsSurSilverPaymentDone", "IsSurGoldPaymentDone",
        "IsCouponUsed", "DateOfAvail", "JoiningRewardAmount", "LatestCertification",
    ];

    private static readonly string[] BasicInfoFields =
    [
        "UdyogAadharNo", "ReCertification", "ReCertificationLevel", "IsEligibleForFinancial", "IsEligibleForBenefits",
    ];

    private static readonly string[] StatusFields =
    [
        "BronzeStatus", "SilverStatus", "GoldStatus", "FinancialAssistanceStatus", "ConsultancyStatus", "TechnologyUpgradationStatus",
        "LevelOfCertificationForFa", "DateOfFaAvail", "FaAmount", "FaReferenceNo", "FaCertificationCategory",
        "LevelOfCertificationForTu", "DateOfTuAvail", "TuAmount", "TuReferenceNo", "TuCertificationCategory", "PledgePath",
    ];

    public sealed record DashboardResponse(
        Dictionary<string, object?> Msme,
        Dictionary<string, object?> BasicInfo,
        Dictionary<string, object?> CertStatus);

    [HttpGet]
    public async Task<ActionResult<DashboardResponse>> Get(CancellationToken ct)
    {
        var sets = await db.QueryProcMultipleAsync("SP_MSME_GET_DETAILS", new { ZedId, CertificationType = (string?)null }, ct);
        if (sets[0].FirstOrDefault() is not { } msme)
            return NotFound();

        return new DashboardResponse(
            Pick(msme, MsmeFields),
            Pick(sets[1].FirstOrDefault(), BasicInfoFields),
            Pick(sets[2].FirstOrDefault(), StatusFields));
    }

    /// <summary>Copies the listed columns (null when the procedure did not return them).</summary>
    private static Dictionary<string, object?> Pick(IDictionary<string, object?>? row, string[] fields) =>
        fields.ToDictionary(f => f, f => row is not null && row.TryGetValue(f, out var v) && v is not DBNull ? v : null);
}
