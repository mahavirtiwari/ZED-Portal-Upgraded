using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Mobile;

namespace Zed.Portal.Features.Msme;

/// <summary>
/// V4, for the ZED MSME app 2.0 (React Native): the status steps of one certification behind the card's VIEW DETAILS,
/// <c>GET /Msme/AppCertificationStatus?certification=…</c> with the app's sign-in token (<see cref="AppTokens.Header"/>).
/// <para>
/// The legacy app opened Msme/ViewStatus?zedId=… in a WebView (no sign-in at all); V4 serves that data to the signed-in
/// web user only (<see cref="MsmeCertificationController"/>). Here the ZED ID is the token's unit, as for
/// <see cref="MsmeAppFilesController"/>, and only the status fields of that page are answered.
/// </para>
/// </summary>
public sealed class MsmeAppStatusController(ISqlExecutor db, AppTokens tokens) : LegacyMobileController
{
    /// <summary>The levels whose cards have VIEW DETAILS.</summary>
    private static readonly string[] Levels = ["Bronze", "Silver", "Gold"];

    [HttpGet("/Msme/AppCertificationStatus")]
    public async Task<IActionResult> AppCertificationStatus(string? certification, CancellationToken ct)
    {
        var token = Request.Headers[AppTokens.Header].ToString();
        if (tokens.Read(token) is not { } t || (t.Unit ?? t.User) is not { Length: > 0 } zedId
            || await tokens.CheckAsync(token, MobileApps.Msme, null, zedId, ct) != AppTokenCheck.Valid)
            return Unauthorized();

        var level = Levels.FirstOrDefault(l => string.Equals(l, certification?.Trim(), StringComparison.OrdinalIgnoreCase));
        if (level is null) return Fail("Invalid certification.");

        var sets = await db.QueryProcMultipleAsync("SP_MSME_GET_DETAILS", new { ZedId = zedId, CertificationType = level }, ct);
        if (sets.Count < 4 || sets[0].Count == 0) return Fail("No details are available for this certification yet.");

        return LegacyJson(new
        {
            status = "1",
            certification = level,
            steps = MsmeCertificationController.Pick(sets[3].FirstOrDefault(), MsmeCertificationController.StatusFields),
        });
    }
}
