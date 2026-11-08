using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Portal.Features.Staff.Assessment;

namespace Zed.Portal.Features.Documents;

/// <summary>
/// Public certificate verification: the QR code on the pledge, Bronze, Silver, Gold and ZED-X certificates opens
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
        // V4: ZED-X certificates (its QR is drawn by the portal, AssessmentDocuments).
        ["xc"] = "ZEDX",
    };

    /// <summary>
    /// The code of a level in the verification address (Gold: GC, ZEDX: XC). 2026-11-08: another V4 level is named by its own
    /// code (/Verify/PLATINUM/...), which <see cref="Get"/> resolves through the level registry; an unknown level stays GC.
    /// </summary>
    public static string CodeOf(string level) =>
        Types.FirstOrDefault(t => string.Equals(t.Value, level, StringComparison.OrdinalIgnoreCase)).Key?.ToUpperInvariant()
        ?? (LevelRegistry.IsV4(level) ? LevelRegistry.Canonical(level)!.ToUpperInvariant() : "GC");

    /// <summary>The certification of a verification address type: PC, BC, SC, GC, XC, or a V4 level's code.</summary>
    internal static string? TypeOf(string? type) =>
        Types.TryGetValue(type ?? "", out var known) ? known : LevelRegistry.IsV4(type) ? LevelRegistry.Canonical(type) : null;

    private static readonly string[] PledgeFields = ["EnterpriseName", "Address", "UdyogAadharNo", "DateOfPledge", "CertificateNo"];

    private static readonly string[] CertificationFields =
    [
        "EnterpriseName", "CertificateNo", "DateOfCertification", "DateOfExpiry", "Address", "UdyogAadharNo",
        "CertificationPhase", "FirstSurveDueDate", "SecondSurveDueDate", "SurveillanceCompletionDate", "OldSurveillanceDate",
    ];

    [GeneratedRegex("^[A-Za-z0-9]{1,50}$")]
    private static partial Regex CodePattern();

    public sealed record VerifyResponse(string Certification, Dictionary<string, string?> Details);

    [HttpGet("{type}/{code}")]
    public async Task<ActionResult<VerifyResponse>> Get(string type, string code, CancellationToken ct)
    {
        if (TypeOf(type) is not { } certification || !CodePattern().IsMatch(code ?? ""))
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
