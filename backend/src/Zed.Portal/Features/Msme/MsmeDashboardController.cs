using System.Data.Common;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Portal.Features.Payments;
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
        Dictionary<string, object?> CertStatus)
    {
        /// <summary>2026-11-08: every V4 level (ZED-X and the levels the Admin added), the same values as the keys above.</summary>
        public IReadOnlyList<LevelState> Levels { get; init; } = [];
    }

    /// <param name="Status">As {Code}Status: the certification row's status, else the payment flag (0 / 1).</param>
    /// <param name="SurveillanceStatus">As {Code}DashboardSurStatus: 1 once a surveillance round is open.</param>
    /// <param name="SurveillancePaid">As IsSur{Code}PaymentDone.</param>
    public sealed record LevelState(string Code, string Name, string AssessmentMode, bool IsEnabled, int PaymentDone, int Status,
        int SurveillanceStatus, int SurveillancePaid);

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
        // ZED-X (migrations 0028 / 0029) and, since 2026-11-08, every V4 level: SP_MSME_GET_DETAILS knows the three levels
        // only. Its status as the procedure gives the others: the certification row's status once there is one, else the
        // payment flag (0 / 1); keys named as the three's (Is{Code}PaymentDone, {Code}Status, ...), and the list Levels.
        var levels = new List<LevelState>();
        foreach (var level in LevelRegistry.All.Where(l => !LevelRegistry.IsLegacy(l.Code)))
        {
            var s = await V4LevelStatus.ReadAsync(db, ZedId, level.Code, log, ct);
            response.Msme[$"Is{level.Code}PaymentDone"] = s.PaymentDone;
            response.CertStatus[$"{level.Code}Status"] = s.Value;
            // Its surveillance (migration 0032): the SURVEILLANCE box once SP_V4_LEVEL_SURVEILLANCE_SCHEDULE opens a round.
            var sur = await LevelSurveillance.StatusAsync(db, ZedId, level.Code, log, ct);
            response.Msme[$"{level.Code}DashboardSurStatus"] = LevelSurveillance.DashboardStatus(sur);
            response.Msme[$"IsSur{level.Code}PaymentDone"] = sur is { Paid: true } ? 1 : 0;
            levels.Add(new LevelState(level.Code, level.Name, level.AssessmentMode, level.IsEnabled, s.PaymentDone, s.Value,
                LevelSurveillance.DashboardStatus(sur), sur is { Paid: true } ? 1 : 0));
        }
        return response with { Levels = levels };
    }

    internal const string ZedXSql =
        "SELECT CAST(ISNULL(m.IsZEDXPaymentDone, 0) AS int) AS PaymentDone, " +
        "(SELECT TOP 1 c.CertificationStatus FROM dbo.MsmeCertifications c WHERE c.ZedId = m.ZedId AND c.Certification = 'ZEDX' ORDER BY c.Id DESC) AS Status " +
        "FROM dbo.Msme m WHERE m.ZedId = @ZedId;";


    /// <summary>A built-in card of "My Incentives" as the Admin set it (Admin → Incentives → Main Dashboard Cards).</summary>
    public sealed record BuiltInCard(string Card, string? Title, string? Highlight, string? Details, bool Active);

    /// <summary>An incentive the Admin put on the dashboard ("Where it appears": Main dashboard), active ones only.</summary>
    public sealed record IncentiveCard(long Id, string? Title, string? Highlight, string? Details, string? Department,
        string? ContactPerson, string? Email, string? MobileNo, string? WebLink, string? VideoLink,
        bool ApplicableForBronze, bool ApplicableForSilver, bool ApplicableForGold);

    public sealed record IncentiveCardsResponse(IReadOnlyList<BuiltInCard> BuiltIn, IReadOnlyList<IncentiveCard> Incentives);

    internal const string BuiltInCardsSql =
        "SELECT DashboardCard AS Card, Incentive AS Title, CardHighlight AS Highlight, Details, CAST(ISNULL(ActiveStatus, 0) AS bit) AS Active " +
        // MSME KAWACH was removed (2026-11-06): its row (migration 0026) is not listed.
        "FROM dbo.Incentives WHERE DashboardCard IS NOT NULL AND DashboardCard <> 'KAWACH' ORDER BY OrderNo, Id;";

    internal const string IncentiveCardsSql =
        "SELECT Id, Incentive AS Title, CardHighlight AS Highlight, Details, MinistryOrDepartment AS Department, ContactPerson, Email, MobileNo, " +
        "WebLink, VideoLink, CAST(ISNULL(ApplicableForBronze, 0) AS bit) AS ApplicableForBronze, " +
        "CAST(ISNULL(ApplicableForSilver, 0) AS bit) AS ApplicableForSilver, CAST(ISNULL(ApplicableForGold, 0) AS bit) AS ApplicableForGold " +
        "FROM dbo.Incentives WHERE DisplayOn = 'Dashboard' AND DashboardCard IS NULL AND ActiveStatus = 1 " +
        "ORDER BY CASE IncentiveType WHEN 'Common' THEN 0 WHEN 'Financial' THEN 2 WHEN 'Other' THEN 3 ELSE 1 END, OrderNo, Id;";

    /// <summary>
    /// GET api/msme/dashboard/level-fees (2026-11-08): what this unit would pay for each enabled level, from Masters → Payments
    /// as the payment step reads it (SP_MSME_GET_PAYMENT_DETAILS without the joining reward: after subsidy, with GST). A level
    /// without a fee row, or a procedure error, gives no amount; the level box then shows no fee.
    /// </summary>
    [HttpGet("level-fees")]
    public async Task<IReadOnlyDictionary<string, decimal?>> LevelFees(CancellationToken ct)
    {
        var fees = new Dictionary<string, decimal?>(StringComparer.OrdinalIgnoreCase);
        foreach (var level in (await CertLevels.CertificationLevels.AllAsync(db, log, ct)).Where(l => l.IsEnabled))
        {
            try
            {
                var sets = await db.QueryProcMultipleAsync("SP_MSME_GET_PAYMENT_DETAILS", new { ZedId, Certification = level.Code }, ct);
                fees[level.Code] = sets.Count > 1 && sets[1].FirstOrDefault() is { } row ? new FeeOption(row).Due : null;
            }
            catch (DbException ex)
            {
                log.LogWarning(ex, "Fee of {Level} for {ZedId} not readable", level.Code, ZedId);
                fees[level.Code] = null;
            }
        }
        return fees;
    }

    /// <summary>
    /// GET api/msme/dashboard/incentives — the cards of "My Incentives" the Admin manages. Before migration 0026 (or on an
    /// error) the lists are empty and the dashboard shows its built-in cards as they were.
    /// </summary>
    [HttpGet("incentives")]
    public Task<IncentiveCardsResponse> Incentives(CancellationToken ct) => IncentiveCardsAsync(db, log, ct);

    /// <summary>The cards of "My Incentives" (the dashboard, and since 2026-11-08 the ZED MSME app through api/public/incentive-cards).</summary>
    public static async Task<IncentiveCardsResponse> IncentiveCardsAsync(ISqlExecutor db, ILogger log, CancellationToken ct)
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

/// <summary>
/// GET api/public/incentive-cards (2026-11-08): the same cards for the ZED MSME app's "My Incentives" (the Admin's titles,
/// highlights, show / hide and dashboard incentives). Public: the Admin publishes them for every MSME, and the app reads them
/// before and without a session, keeping the last answer offline.
/// </summary>
[ApiController]
[Microsoft.AspNetCore.Authorization.AllowAnonymous]
[Route("api/public/incentive-cards")]
[Zed.Core.Http.PortalSystems(Zed.Core.Http.PortalSystem.Main)]
public sealed class PublicIncentiveCardsController(ISqlExecutor db, ILogger<PublicIncentiveCardsController> log) : ControllerBase
{
    [HttpGet]
    [ResponseCache(Duration = 300, Location = ResponseCacheLocation.Any)]
    public Task<MsmeDashboardController.IncentiveCardsResponse> Get(CancellationToken ct) => MsmeDashboardController.IncentiveCardsAsync(db, log, ct);
}
