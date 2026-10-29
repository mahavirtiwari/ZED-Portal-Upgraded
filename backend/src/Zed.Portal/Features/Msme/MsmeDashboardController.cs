using System.Data.Common;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Portal.Features.Staff.Schemes;

namespace Zed.Portal.Features.Msme;

/// <summary>
/// Data for the MSME dashboard. Port of MsmeController.GetDetails as used by Views/Msme/Dashboard.cshtml
/// (SP_MSME_GET_DETAILS without a certification type).
/// </summary>
[Route("api/msme/dashboard")]
public sealed class MsmeDashboardController(ISqlExecutor db, ILogger<MsmeDashboardController> log) : MsmeApiController
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

        var response = new DashboardResponse(
            Pick(msme, MsmeFields),
            Pick(sets[1].FirstOrDefault(), BasicInfoFields),
            Pick(sets[2].FirstOrDefault(), StatusFields));
        // ZED-X (migrations 0028 / 0029): SP_MSME_GET_DETAILS knows the three levels only. Its status as the procedure
        // gives the others: the certification row's status once there is one, else the payment flag (0 / 1).
        var zedx = await ZedXAsync(ct);
        response.Msme["IsZEDXPaymentDone"] = zedx.PaymentDone;
        response.CertStatus["ZEDXStatus"] = zedx.Status ?? zedx.PaymentDone;
        return response;
    }

    public sealed record ZedXRow(int PaymentDone, int? Status);

    internal const string ZedXSql =
        "SELECT CAST(ISNULL(m.IsZEDXPaymentDone, 0) AS int) AS PaymentDone, " +
        "(SELECT TOP 1 c.CertificationStatus FROM dbo.MsmeCertifications c WHERE c.ZedId = m.ZedId AND c.Certification = 'ZEDX' ORDER BY c.Id DESC) AS Status " +
        "FROM dbo.Msme m WHERE m.ZedId = @ZedId;";

    private async Task<ZedXRow> ZedXAsync(CancellationToken ct)
    {
        try
        {
            return (await db.QuerySqlAsync<ZedXRow>(ZedXSql, new { ZedId }, ct)).FirstOrDefault() ?? new ZedXRow(0, null);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "ZED-X status not read (is migration 0029 applied?)");
            return new ZedXRow(0, null);
        }
    }

    /// <summary>A built-in card of "My Incentives" as the Admin set it (Admin → Incentives → Main Dashboard Cards).</summary>
    public sealed record BuiltInCard(string Card, string? Title, string? Highlight, string? Details, bool Active);

    /// <summary>An incentive the Admin put on the dashboard ("Where it appears": Main dashboard), active ones only.</summary>
    public sealed record IncentiveCard(long Id, string? Title, string? Highlight, string? Details, string? Department,
        string? ContactPerson, string? Email, string? MobileNo, string? WebLink, string? VideoLink,
        bool ApplicableForBronze, bool ApplicableForSilver, bool ApplicableForGold);

    public sealed record IncentiveCardsResponse(IReadOnlyList<BuiltInCard> BuiltIn, IReadOnlyList<IncentiveCard> Incentives);

    internal const string BuiltInCardsSql =
        "SELECT DashboardCard AS Card, Incentive AS Title, CardHighlight AS Highlight, Details, CAST(ISNULL(ActiveStatus, 0) AS bit) AS Active " +
        "FROM dbo.Incentives WHERE DashboardCard IS NOT NULL ORDER BY OrderNo, Id;";

    internal const string IncentiveCardsSql =
        "SELECT Id, Incentive AS Title, CardHighlight AS Highlight, Details, MinistryOrDepartment AS Department, ContactPerson, Email, MobileNo, " +
        "WebLink, VideoLink, CAST(ISNULL(ApplicableForBronze, 0) AS bit) AS ApplicableForBronze, " +
        "CAST(ISNULL(ApplicableForSilver, 0) AS bit) AS ApplicableForSilver, CAST(ISNULL(ApplicableForGold, 0) AS bit) AS ApplicableForGold " +
        "FROM dbo.Incentives WHERE DisplayOn = 'Dashboard' AND DashboardCard IS NULL AND ActiveStatus = 1 " +
        "ORDER BY CASE IncentiveType WHEN 'Common' THEN 0 WHEN 'Financial' THEN 2 WHEN 'Other' THEN 3 ELSE 1 END, OrderNo, Id;";

    /// <summary>
    /// GET api/msme/dashboard/incentives — the cards of "My Incentives" the Admin manages. Before migration 0026 (or on an
    /// error) the lists are empty and the dashboard shows its built-in cards as they were.
    /// </summary>
    [HttpGet("incentives")]
    public async Task<IncentiveCardsResponse> Incentives(CancellationToken ct)
    {
        try
        {
            var builtIn = await db.QuerySqlAsync<BuiltInCard>(BuiltInCardsSql, null, ct);
            // Links go into href: http(s) only.
            var cards = (await db.QuerySqlAsync<IncentiveCard>(IncentiveCardsSql, null, ct))
                .Select(c => c with
                {
                    WebLink = IncentiveMasterController.IsHttpUrl(c.WebLink) ? c.WebLink!.Trim() : null,
                    VideoLink = IncentiveMasterController.IsHttpUrl(c.VideoLink) ? c.VideoLink!.Trim() : null,
                })
                .ToList();
            return new IncentiveCardsResponse(builtIn, cards);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "The dashboard incentive cards could not be read (is migration 0026 applied?)");
            return new IncentiveCardsResponse([], []);
        }
    }

    /// <summary>Copies the listed columns (null when the procedure did not return them).</summary>
    private static Dictionary<string, object?> Pick(IDictionary<string, object?>? row, string[] fields) =>
        fields.ToDictionary(f => f, f => row is not null && row.TryGetValue(f, out var v) && v is not DBNull ? v : null);
}
