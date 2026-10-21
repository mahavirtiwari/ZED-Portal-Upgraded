using System.Data.Common;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Zed.Core.Data;
using Zed.Core.Http;

namespace Zed.Portal.Features.Msme.Handholding;

/// <summary>
/// Handholding Support page of a signed-in MSME. Port of MsmeController.HandholdingSupport (the view
/// Frontend/Msme/HandholdingSupport.cshtml) with GetConsultancyDetails (SP_CONSULTANCY_MSME_GET_DETAILS),
/// GetConsultancyStatusDetails (SP_CONSULTANCY_APP_MSME_STATUS) and AcceptMilestone
/// (SP_MONITORING_RA_APPLICANT_ACCEPTANCE). The data lives in ZED_CONSULTANT; the procedures are in the
/// main database. Paying for a milestone is <see cref="Payments.Consultancy.ConsultancyPaymentController"/>.
/// <para>
/// The legacy data actions took the ZED ID from the request when one was sent (and had no sign-in check),
/// and returned whole Msme / MsmeBasicInformation rows; here the ZED ID comes from the cookie and only
/// the columns the page shows are returned.
/// </para>
/// </summary>
[Route("api/msme/handholding")]
public sealed class HandholdingController(ISqlExecutor db, ILogger<HandholdingController> log) : MsmeApiController
{
    private static readonly string[] MsmeFields =
    [
        "ZedId", "EnterpriseName", "EnterpriseType", "EnterpriseTypee", "RegistrationType",
        "PUnitName", "PAddress", "PDistrictName", "PStateName", "PPin",
        "Activity", "TwoDigitActivity", "FourDigitActivity", "FiveDigitActivity", "PledgeOn",
        "IsSilverPaymentDone", "IsGoldPaymentDone", "IsCouponUsed",
    ];

    private static readonly string[] BasicInfoFields = ["UdyogAadharNo"];

    /// <summary>The status columns the page binds to (steppers, milestone panels, accept buttons).</summary>
    public static readonly string[] StatusFields =
    [
        "EnableSilver", "EnableGold",
        "SilverStatus", "SilverStatus2", "SilverStatus3", "GoldStatus", "GoldStatus2", "GoldStatus3",
        "SilverStatusOfNc", "GoldStatusOfNc",
        "SilverStatusOfNc1", "SilverStatusOfNc2", "SilverStatusOfNc3", "GoldStatusOfNc1", "GoldStatusOfNc2", "GoldStatusOfNc3",
        "MilestoneCompletionStatus1", "MilestoneCompletionStatus2", "MilestoneCompletionStatus3",
        "MilestoneCompletionStatusGold1", "MilestoneCompletionStatusGold2", "MilestoneCompletionStatusGold3",
    ];

    public sealed record SummaryResponse(
        Dictionary<string, object?> Msme,
        Dictionary<string, object?> BasicInfo,
        Dictionary<string, object?> Status,
        IReadOnlyList<HandholdingEligibility.LevelState> Levels);

    [HttpGet]
    public async Task<ActionResult<SummaryResponse>> Get(CancellationToken ct)
    {
        var details = await db.QueryProcMultipleAsync("SP_CONSULTANCY_MSME_GET_DETAILS", new { ZedId, CertificationType = (string?)null }, ct);
        if (details[0].FirstOrDefault() is not { } msme)
            return Problem(title: "Handholding Support details are not available for this unit.", statusCode: StatusCodes.Status404NotFound);

        var status = await StatusAsync(ct);
        return new SummaryResponse(
            Pick(msme, MsmeFields),
            Pick(details[1].FirstOrDefault(), BasicInfoFields),
            Pick(status, StatusFields),
            HandholdingEligibility.Levels.Select(l => HandholdingEligibility.Evaluate(status, l)).ToList());
    }

    public sealed record AcceptRequest(string? Certification, int Milestone);

    /// <summary>
    /// "ACCEPT MILESTONE n" (Msme/AcceptMilestone). SP_MONITORING_RA_APPLICANT_ACCEPTANCE marks the
    /// signed-in unit's milestone that waits for acceptance (status 16) as accepted (100). The old page
    /// posted an empty ZED ID and level; here the button's level and milestone must be the one waiting.
    /// </summary>
    [HttpPost("accept-milestone")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<ActionResult<MessageResponse>> AcceptMilestone(AcceptRequest req, CancellationToken ct)
    {
        if (HandholdingEligibility.Canonical(req.Certification) is not { } level || req.Milestone is < 1 or > HandholdingEligibility.Milestones)
            return this.Problem400("Invalid milestone.");

        var status = await StatusAsync(ct);
        if (HandholdingEligibility.Int(status, HandholdingEligibility.CompletionColumn(level, req.Milestone)) != HandholdingEligibility.AwaitingAcceptance)
            return this.Problem400($"Milestone {req.Milestone} is not waiting for your acceptance.");

        try
        {
            await db.ExecuteProcAsync("SP_MONITORING_RA_APPLICANT_ACCEPTANCE", new { UserId = ZedId, ZedId, CertificationType = level }, ct);
        }
        catch (DbException ex)
        {
            log.LogError(ex, "SP_MONITORING_RA_APPLICANT_ACCEPTANCE failed for {ZedId}/{Level} milestone {Milestone}", ZedId, level, req.Milestone);
            return this.Problem400("The milestone could not be accepted. Please try again.");
        }
        log.LogInformation("{ZedId} accepted {Level} handholding milestone {Milestone}", ZedId, level, req.Milestone);
        return new MessageResponse($"Milestone {req.Milestone} accepted.");
    }

    private async Task<IDictionary<string, object?>?> StatusAsync(CancellationToken ct) =>
        (await db.QueryProcMultipleAsync("SP_CONSULTANCY_APP_MSME_STATUS", new { ZedId, CertificationType = (string?)null }, ct))[0].FirstOrDefault();

    private static Dictionary<string, object?> Pick(IDictionary<string, object?>? row, string[] fields) =>
        fields.ToDictionary(f => f, f => row is not null && row.TryGetValue(f, out var v) && v is not DBNull ? v : null);
}
