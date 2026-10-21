using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;

namespace Zed.Portal.Features.Msme;

/// <summary>
/// Status of one certification of the signed-in MSME. Port of MsmeController.GetDetails as used by
/// Views/Msme/CertificationDetails.cshtml and Views/Msme/ViewStatus.cshtml (SP_MSME_GET_DETAILS with a
/// certification type; the procedure itself sends milestone types to ZED_CONSULTANT and surveillance
/// types to ZED_SURVEILLANCE). The legacy action took the ZED ID from the request (and ViewStatus had no
/// sign-in at all); here it is always the signed-in MSME.
/// </summary>
[Route("api/msme/certifications")]
public sealed class MsmeCertificationController(ISqlExecutor db) : MsmeApiController
{
    /// <summary>
    /// Certification types the certification pages are opened with (dashboard, handholding support,
    /// basic information and NC pages), in the spelling the procedures compare against.
    /// SP_MSME_GET_DETAILS also knows "Techupgrade", which only the technology upgradation module uses.
    /// </summary>
    internal static readonly IReadOnlyDictionary<string, string> CertificationTypes =
        new[]
        {
            "Bronze", "Silver", "Gold",
            "BronzeSurveillance", "SilverSurveillance", "GoldSurveillance",
            "SilverMilestone1", "SilverMilestone2", "SilverMilestone3",
            "GoldMilestone1", "GoldMilestone2", "GoldMilestone3",
        }.ToDictionary(t => t, t => t, StringComparer.OrdinalIgnoreCase);

    // Only the columns the two pages show. The legacy action sent every result set with SELECT * rows
    // (payment details, agency e-mail addresses, ...).
    private static readonly string[] MsmeFields =
    [
        "ZedId", "EnterpriseName", "EnterpriseType", "EnterpriseTypee", "RegistrationType", "StateId",
        "PUnitName", "PAddress", "PDistrictName", "PStateName", "PPin",
        "Activity", "TwoDigitActivity", "FourDigitActivity", "FiveDigitActivity", "PledgeOn",
    ];

    private static readonly string[] BasicInfoFields = ["UdyogAadharNo"];

    /// <summary>CertPath: main database; SurveCertPath: ZED_SURVEILLANCE.</summary>
    private static readonly string[] CertStatusFields = ["BronzeStatus", "CertPath", "SurveCertPath"];

    /// <summary>The MsmeHistory pivot (StatusType → description). Milestone columns come from ZED_CONSULTANT.</summary>
    private static readonly string[] StatusFields =
    [
        "ApplicationReceived", "BasicInfoStatus", "DesktopVerification", "BronzeDesktopVerification",
        "ScheduledOn", "CompletedOn",
        "Nc1Raised", "Nc1Submitted", "Nc2Raised", "Nc2Submitted", "Nc3Raised", "Nc3Submitted",
        "Nc4Raised", "Nc4Submitted", "Nc5Raised", "Nc5Submitted", "NcClosed", "NcFinalClosureDate",
        "GetCertified", "AvailIncentive",
        "AllocationCompleted", "BdsScheduledOn", "HapScheduledOn", "SubmittedByConsultant", "ApplicantAcceptedOn",
    ];

    public sealed record CertificationResponse(
        string Certification,
        Dictionary<string, object?> Msme,
        Dictionary<string, object?> BasicInfo,
        Dictionary<string, object?> CertStatus,
        Dictionary<string, object?> Status);

    [HttpGet("{certification}")]
    public async Task<ActionResult<CertificationResponse>> Get(string certification, CancellationToken ct)
    {
        if (!CertificationTypes.TryGetValue(certification ?? "", out var type))
            return this.Problem400("Invalid certification.");

        var sets = await db.QueryProcMultipleAsync("SP_MSME_GET_DETAILS", new { ZedId, CertificationType = type }, ct);
        // Surveillance and milestone details exist only once the MSME has joined that programme.
        if (sets[0].FirstOrDefault() is not { } msme)
            return Problem(title: "No details are available for this certification yet.", statusCode: StatusCodes.Status404NotFound);

        return new CertificationResponse(
            type,
            Pick(msme, MsmeFields),
            Pick(sets[1].FirstOrDefault(), BasicInfoFields),
            Pick(sets[2].FirstOrDefault(), CertStatusFields),
            Pick(sets[3].FirstOrDefault(), StatusFields));
    }

    /// <summary>Copies the listed columns (null when the procedure did not return them).</summary>
    private static Dictionary<string, object?> Pick(IDictionary<string, object?>? row, string[] fields) =>
        fields.ToDictionary(f => f, f => row is not null && row.TryGetValue(f, out var v) && v is not DBNull ? v : null);
}
