using System.Data.Common;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Caching.Distributed;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Mobile;
using Zed.Core.Payments;
using Zed.Core.Security;
using Zed.Portal.Features.Msme;

namespace Zed.Portal.Features.Payments;

/// <summary>
/// New (2026-11-07): the GSTIN check of the ZED MSME app's payment page, as the web's (<see cref="MsmePaymentController"/>
/// gstin / pan): the GSTIN format, its verification with Protean and, when the GSTIN's PAN is not the Udyam PAN, the
/// "PAN Mismatch Detected" correction (SP_MESE_UPDATE_PAN, told to the office). On the main portal with the app's sign-in
/// token; the ZED ID is the token's unit. Answers <c>{status, errorMessage, ...}</c>; 401 when the token is not accepted.
/// </summary>
public sealed class MsmeAppGstinController(
    ISqlExecutor db,
    IGstinVerifier gstinVerifier,
    IDistributedCache cache,
    PanCorrectionNotice panNotice,
    IMsmeEditHistory history,
    AppTokens tokens,
    ILogger<MsmeAppGstinController> log) : LegacyMobileController
{
    private string? ClientIp => HttpContext.Connection.RemoteIpAddress?.ToString();

    /// <summary>Why the last <see cref="UnitAsync"/> refused the token (2026-11-14, <see cref="MsmeAppToken"/>).</summary>
    private AppTokenCheck refusal = AppTokenCheck.Missing;

    private async Task<string?> UnitAsync(CancellationToken ct)
    {
        var (zedId, check) = await MsmeAppToken.UnitAsync(Request, tokens, ct);
        refusal = check;
        return zedId;
    }

    private static string GstinKey(string zedId, string gstin) => $"app-gstin-ok:{zedId}:{gstin}";

    private async Task<string?> UdyamPanAsync(string zedId, string cert, CancellationToken ct)
    {
        var sets = await db.QueryProcMultipleAsync("SP_MSME_GET_PAYMENT_DETAILS", new { ZedId = zedId, Certification = cert }, ct);
        var row = sets[0].FirstOrDefault() ?? sets[1].FirstOrDefault();
        var pan = row?.Text("UdyamPanNo");
        return string.IsNullOrEmpty(pan) ? null : pan.ToUpperInvariant();
    }

    private Task Record(string zedId, string action, bool ok, string? message, object data, CancellationToken ct) =>
        history.RecordAsync(new MsmeEdit
        {
            Channel = LoginChannels.Mobile, ZedId = zedId, Action = action, Path = Request.Path.Value, Success = ok, Message = message,
            IpAddress = ClientIp, Data = System.Text.Json.JsonSerializer.Serialize(data),
        }, ct);

    /// <summary><c>{status, errorMessage, PanMatches, GstinPan, UdyamPan}</c>.</summary>
    [HttpPost("/Msme/AppVerifyGstin")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<IActionResult> VerifyGstin(string? certification, string? gstin, CancellationToken ct)
    {
        if (await UnitAsync(ct) is not { } zedId) return MsmeAppToken.Refused(this, refusal);
        if (Certifications.CanonicalApplicable(certification ?? "") is not { } cert) return Fail("Invalid certification.");
        var g = (gstin ?? "").Trim().ToUpperInvariant();
        if (!Certifications.Gstin().IsMatch(g)) return Fail("Please enter valid GSTIN.");

        GstinResult result;
        try { result = await gstinVerifier.VerifyAsync(zedId, cert, g, ct); }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or InvalidOperationException)
        {
            log.LogWarning(ex, "GSTIN verification unavailable (app)");
            return Fail("Unexpected error occurred. Please try after some time.");
        }
        await Record(zedId, "Certification payment: GSTIN entered", result.Valid, result.Valid ? null : result.Message, new { req = new { Certification = cert, Gstin = g } }, ct);
        if (!result.Valid) return Fail(result.Message);

        await cache.SetStringAsync(GstinKey(zedId, g), "1", new DistributedCacheEntryOptions { AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(30) }, ct);
        var udyamPan = await UdyamPanAsync(zedId, cert, ct);
        var gstinPan = Certifications.PanOf(g);
        return LegacyJson(new
        {
            status = "1",
            errorMessage = result.Message,
            PanMatches = string.Equals(udyamPan, gstinPan, StringComparison.OrdinalIgnoreCase),
            GstinPan = gstinPan,
            UdyamPan = udyamPan,
        });
    }

    /// <summary>"PAN Mismatch Detected": the Udyam PAN becomes the PAN of the GSTIN verified in the last 30 minutes.</summary>
    [HttpPost("/Msme/AppCorrectPan")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<IActionResult> CorrectPan(string? certification, string? gstin, string? pan, CancellationToken ct)
    {
        if (await UnitAsync(ct) is not { } zedId) return MsmeAppToken.Refused(this, refusal);
        if (Certifications.CanonicalApplicable(certification ?? "") is not { } cert) return Fail("Invalid certification.");
        var g = (gstin ?? "").Trim().ToUpperInvariant();
        var p = (pan ?? "").Trim().ToUpperInvariant();
        if (!Certifications.Pan().IsMatch(p)) return Fail("Please enter a valid 10-character PAN.");
        if (!Certifications.Gstin().IsMatch(g) || await cache.GetStringAsync(GstinKey(zedId, g), ct) is null) return Fail("Please verify the GSTIN first.");
        if (p != Certifications.PanOf(g)) return Fail("Please enter the correct PAN associated with that GSTIN.");

        var oldPan = await UdyamPanAsync(zedId, cert, ct);
        try
        {
            await db.ExecuteProcAsync("SP_MESE_UPDATE_PAN", new { ZedId = zedId, PanNo = oldPan, UpdatedPanNo = p }, ct);
        }
        catch (DbException ex)
        {
            log.LogError(ex, "SP_MESE_UPDATE_PAN failed for {ZedId} (app)", zedId);
            return Fail("Failed to update PAN. Please try again.");
        }
        await panNotice.RecordAsync(zedId, "certification", oldPan, p, g, ct);
        await Record(zedId, "Certification payment: PAN corrected", true, null, new { req = new { Certification = cert, Gstin = g, Pan = p } }, ct);
        return LegacyJson(new { status = "1", errorMessage = "PAN updated successfully." });
    }
}
