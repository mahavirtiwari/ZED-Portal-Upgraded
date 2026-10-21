using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Mobile;
using Zed.Main.MobileApi.Models;

namespace Zed.Main.MobileApi.Controllers;

/// <summary>
/// The MSME-app actions the copied controller still routes. Those that could not work on ZED_SURVEILLANCE keep
/// their old (failing) answer without touching anything; see docs/MOBILE-API.md, "Surveillance".
/// </summary>
public sealed partial class SurveillanceController
{
    /// <summary>
    /// Old: SELECT * FROM Users WHERE UserId/Password match AND RoleId = 5 (MSME). The surveillance database has no
    /// MSME accounts and the assessor's password is mastered in main, so this always answered "Invalid Old Password.".
    /// That answer is kept; nothing is read or written.
    /// </summary>
    [HttpPost]
    public IActionResult ChangePassword(ChangePwdRequest request)
    {
        log.LogInformation("Surveillance/ChangePassword called for {UserId}; no MSME accounts here", request.userName);
        return Fail("Invalid Old Password.");
    }

    /// <summary>
    /// Old: mailed the MSME a reset link for a ZED_SURVEILLANCE account that does not exist, to the surveillance web
    /// MSME pages that are not ported. Answers the old "no user" text without mailing.
    /// </summary>
    [HttpPost]
    public IActionResult ResetPassword(string? userName)
    {
        log.LogInformation("Surveillance/ResetPassword called for {ZedId}; no MSME accounts here", userName);
        return Fail("Sorry, no User exists with these details.");
    }

    /// <summary>
    /// Old: read six columns (Bronze/Silver/GoldSurveillanceStatus and -Date) that ZED_SURVEILLANCE's SP_APP_MSME_STATUS
    /// does not return, so every call ended in an error page. Kept as an error (HTTP 500, the generic body); the
    /// button states the app uses come from the login.
    /// </summary>
    [HttpPost]
    public IActionResult GetMsmeStatus(string? userName, string? version)
    {
        log.LogInformation("Surveillance/GetMsmeStatus called for {ZedId}; answered with the old failure", userName);
        var result = Fail(GenericError);
        result.StatusCode = StatusCodes.Status500InternalServerError;
        return result;
    }

    /// <summary>SP_MSME_GET_MY_DOCUMENTS as the old DataSet JSON, for an allotted unit only.</summary>
    [HttpPost]
    public async Task<IActionResult> GetMyDocuments(string? zedId, CancellationToken ct)
    {
        var (_, refused) = await UnitAsync(nameof(GetMyDocuments), zedId, null, Need.Read, ct);
        if (refused is not null) return refused;
        var sets = await db.QueryProcMultipleAsync("SP_MSME_GET_MY_DOCUMENTS", new { ZedId = zedId }, ct);
        return LegacyContent(LegacyResults.DataSetJson(sets, ["Guidelines", "Certificates", "PaymentReceipts"]));
    }

    /// <summary>
    /// The MSME's own financial assistance claim (bank details, invoices). Not something the desktop assessor
    /// submits for the unit, and the claim lives in main; refused with the old failure shape (text/html).
    /// </summary>
    [HttpPost]
    public IActionResult SubmitFinancialData(FinancialViewModel model)
    {
        log.LogWarning("Surveillance/SubmitFinancialData refused for {ZedId}: claims are made on main", model.ZedId);
        return LegacyContent(JsonSerializer.Serialize(ServiceResponse.Fail(InvalidDetails), Zed.Core.Mobile.LegacyJson.Write));
    }

    /// <summary>Documents of that claim; refused for the same reason, nothing stored.</summary>
    [HttpPost]
    public IActionResult SubmitFinancialPhotos(SubmitPhotosRequestFile request)
    {
        log.LogWarning("Surveillance/SubmitFinancialPhotos refused for {ZedId}: claims are made on main", request.zedId ?? request.userName);
        return Fail(InvalidDetails);
    }
}
