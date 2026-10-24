using Microsoft.AspNetCore.Mvc;
using Zed.Core.Forms;
using Zed.Core.Http;
using Zed.Core.Mobile;

namespace Zed.Main.MobileApi.Controllers;

/// <summary>
/// New in V4: the apps' Basic Information forms as the Admin set them (Admin → App Forms on the portal of the same system),
/// Forms/Definition?form=msme.basicInfo. Only the fields that are shown, in order; <c>version</c> changes with any change.
/// The apps keep the last definition for offline use and their own built-in form as the fallback (docs/mobile/APP-FORMS.md).
/// Not tied to a user: a definition holds no unit data.
/// </summary>
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed class FormsController(AppForms forms, PortalHost host) : LegacyMobileController
{
    internal const string UnknownForm = "Unknown form.";

    [HttpGet, HttpPost]
    public async Task<IActionResult> Definition(string? form, CancellationToken ct) =>
        await forms.GetAsync(host.System, form, ct) is { } f
            ? LegacyJson(f.ToAppJson())
            : Fail(UnknownForm);
}
