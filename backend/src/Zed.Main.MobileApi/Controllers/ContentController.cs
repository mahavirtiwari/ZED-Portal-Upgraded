using Microsoft.AspNetCore.Mvc;
using Zed.Core.Content;
using Zed.Core.Http;
using Zed.Core.Mobile;

namespace Zed.Main.MobileApi.Controllers;

/// <summary>
/// New in V4: the apps' undertakings, pledges, disclaimers and instructions as the Admin set them (Admin → Texts on
/// the portal of the same system). The apps keep the last answer for offline use and their own copy as the fallback.
/// <c>{ status: "1", texts: [{ key, enabled, html }] }</c>.
/// </summary>
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed class ContentController(ContentTexts texts, PortalHost host) : LegacyMobileController
{
    // The legacy serializer keeps the C# names: the camel-case names of the contract are spelled out.
    [HttpGet, HttpPost]
    public async Task<IActionResult> Texts(CancellationToken ct) =>
        LegacyJson(new { status = "1", texts = (await texts.ForAsync(host.System, ContentChannel.App, ct)).Select(t => new { key = t.Key, enabled = t.Enabled, html = t.Html }) });
}
