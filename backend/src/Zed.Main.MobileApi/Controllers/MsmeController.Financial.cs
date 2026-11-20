using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Mobile;
using Zed.Core.Security;
using Zed.Main.MobileApi.Models;

namespace Zed.Main.MobileApi.Controllers;

/// <summary>
/// Financial assistance claims from the ZED MSME app. 2026-11-20 (the product owner): Financial Assistance moved to the incentive
/// schemes framework of the portal (the dashboard's Financial Assistance card), so the app no longer takes new claims: both
/// actions answer <see cref="FinancialAssistanceMovedMessage"/> in the old failure shapes and store nothing. Claims made before
/// stay with the staff (nothing more is asked of the unit on them).
/// </summary>
public sealed partial class MsmeController
{
    /// <summary>The app's answer to a new claim (the same sense as the portal's legacy page).</summary>
    public const string FinancialAssistanceMovedMessage =
        "Financial Assistance is now applied for on the ZED portal: please sign in there and open the Financial Assistance card on your dashboard.";

    /// <summary>SP_APP_MSME_INSERT_FINANCIAL_ASSISTANCE until 2026-11-20; now refused (Newtonsoft text, text/html, as before).</summary>
    [HttpPost]
    [DeviceBound(MobileApps.Msme, "ZedId")]
    [MsmeEditAudit("App: financial assistance data submitted")]
    public IActionResult SubmitFinancialData(FinancialViewModel model)
    {
        log.LogInformation("Msme/SubmitFinancialData refused for {ZedId}: Financial Assistance is applied for on the portal", model.ZedId);
        return LegacyContent(JsonSerializer.Serialize(ServiceResponse.Fail(FinancialAssistanceMovedMessage), Zed.Core.Mobile.LegacyJson.Write));
    }

    /// <summary>The claim's documents (Photos/{zedId}/FinancialAssistance) until 2026-11-20; now refused, nothing stored.</summary>
    [HttpPost]
    [DeviceBound(MobileApps.Msme, "zedId", "userName")]
    [MsmeEditAudit("App: financial assistance photos submitted", "zedId", "userName")]
    public IActionResult SubmitFinancialPhotos(SubmitPhotosRequestFile request)
    {
        log.LogInformation("Msme/SubmitFinancialPhotos refused for {ZedId}: Financial Assistance is applied for on the portal", request.zedId ?? request.userName);
        return Fail(FinancialAssistanceMovedMessage);
    }
}
