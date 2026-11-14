using Microsoft.AspNetCore.Mvc;
using Zed.Core.Mobile;

namespace Zed.Portal.Features.Msme;

/// <summary>
/// The ZED MSME app's sign-in token on the portal's app endpoints (Msme/AppCertificationStatus, Msme/AppDocument,
/// Msme/AppProfile …), 2026-11-14. A refused token used to get a bare 401, which the app showed as "HTTP 401 Unauthorized"
/// or "This document could not be opened right now" while its other calls (the mobile host, in Monitor mode) went on —
/// typically after the account's password was reset or changed elsewhere (a new session stamp) or once the token expired.
/// Now the refusal says why: an ended sign-in answers the app's own "sign-in has expired" message, on which every app
/// build since V4 signs out to its login page (shared http.ts), so a fresh sign-in gives a valid token again. A token the
/// portal cannot read at all is answered the same way (most often one issued before the shared <c>Mobile:AppTokenKey</c>
/// was set or changed, which a new sign-in replaces) and logged as an error, in case the portal and the mobile host hold
/// different keys (then a new sign-in does not help: the settings need the same key). The reason is in <see cref="ReasonHeader"/>.
/// </summary>
public static class MsmeAppToken
{
    public const string ReasonHeader = "X-Zed-App-Token";

    /// <summary>The unit of a valid MSME app token, else null with the reason.</summary>
    public static async Task<(string? ZedId, AppTokenCheck Check)> UnitAsync(HttpRequest request, AppTokens tokens, CancellationToken ct)
    {
        var token = request.Headers[AppTokens.Header].ToString();
        if (string.IsNullOrWhiteSpace(token)) return (null, AppTokenCheck.Missing);
        if (tokens.Read(token) is not { } t || (t.Unit ?? t.User) is not { Length: > 0 } zedId) return (null, AppTokenCheck.Invalid);
        var check = await tokens.CheckAsync(token, MobileApps.Msme, null, zedId, ct);
        return (check == AppTokenCheck.Valid ? zedId : null, check);
    }

    /// <summary>The 401 of a refused token, in the legacy shape the app reads ({status, errorMessage}), logged with its reason.</summary>
    public static IActionResult Refused(ControllerBase controller, AppTokenCheck check)
    {
        var http = controller.HttpContext;
        var log = http.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger(typeof(MsmeAppToken).FullName!);
        if (check == AppTokenCheck.Invalid)
            log.LogError("MSME app token unreadable on {Path}: is Mobile:AppTokenKey the same on the portal and the mobile host? (or a token issued before the key)", http.Request.Path);
        else
            log.LogWarning("MSME app token refused on {Path}: {Check}", http.Request.Path, check);
        http.Response.Headers[ReasonHeader] = check.ToString();
        return new JsonResult(new { status = "0", errorMessage = AppTokens.ExpiredMessage }) { StatusCode = StatusCodes.Status401Unauthorized };
    }
}
