using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Portal.Features.Staff.Assessment;

namespace Zed.Portal.Features.Documents;

/// <summary>
/// Public certificate verification: the QR code on the pledge, Bronze, Silver and Gold certificates opens
/// <c>https://loginzed.msme.gov.in/Verify/{PC|BC|SC|GC}/{code}</c>. Port of VerifyController (Pc/Bc/Sc/Gc,
/// SP_VERIFY_QR_CODE); the Angular page <c>/verify/{type}/{code}</c> (also matched as <c>/Verify/BC/...</c>)
/// shows these fields. The procedure also returns the MSME's mobile number and e-mail address; they are not
/// sent (the old page did not show them either). Unknown codes answer 404 (the old page failed with an error).
/// </summary>
[ApiController]
[AllowAnonymous]
[Route("api/verify")]
[EnableRateLimiting(RateLimitPolicies.Sensitive)]
public sealed partial class VerifyController(ISqlExecutor db) : ControllerBase
{
    private static readonly IReadOnlyDictionary<string, string> Types = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["pc"] = "Pledge", ["bc"] = "Bronze", ["sc"] = "Silver", ["gc"] = "Gold",
    };

    private static readonly string[] PledgeFields = ["EnterpriseName", "Address", "UdyogAadharNo", "DateOfPledge", "CertificateNo"];

    private static readonly string[] CertificationFields =
    [
        "EnterpriseName", "CertificateNo", "DateOfCertification", "DateOfExpiry", "Address", "UdyogAadharNo",
        "CertificationPhase", "FirstSurveDueDate", "SurveillanceCompletionDate", "OldSurveillanceDate",
    ];

    [GeneratedRegex("^[A-Za-z0-9]{1,50}$")]
    private static partial Regex CodePattern();

    public sealed record VerifyResponse(string Certification, Dictionary<string, string?> Details);

    [HttpGet("{type}/{code}")]
    public async Task<ActionResult<VerifyResponse>> Get(string type, string code, CancellationToken ct)
    {
        if (!Types.TryGetValue(type ?? "", out var certification) || !CodePattern().IsMatch(code ?? ""))
            return this.Problem400("Invalid verification link.");

        var sets = await db.QueryProcMultipleAsync("SP_VERIFY_QR_CODE",
            new { QrCodeNo = AssessmentInput.Ansi(code), CertificationType = AssessmentInput.Ansi(certification) }, ct);
        if (sets[0].FirstOrDefault() is not { } row)
            return Problem(title: "No certificate was found for this code.", statusCode: StatusCodes.Status404NotFound);

        var fields = certification == "Pledge" ? PledgeFields : CertificationFields;
        return new VerifyResponse(certification,
            fields.ToDictionary(f => f, f => row.TryGetValue(f, out var v) && v is not null and not DBNull ? v.ToString() : null));
    }
}
