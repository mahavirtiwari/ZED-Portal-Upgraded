using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Forms;
using Zed.Core.Http;
using Zed.Core.Mobile;

namespace Zed.Main.MobileApi.Controllers;

/// <summary>
/// New in V4: the apps' Basic Information forms as the Admin set them (Admin → App Forms on the portal of the same system),
/// Forms/Definition?form=msme.basicInfo. Only the fields that are shown, in order; <c>version</c> changes with any change.
/// The apps keep the last definition for offline use and their own built-in form as the fallback (docs/mobile/APP-FORMS.md).
/// Not tied to a user: a definition holds no unit data. V4: with <c>zedId</c> and <c>certificationType</c> the Admin's fields
/// limited to other levels or NIC sectors are left out for that unit (migration 0030); without them every field is sent,
/// with its <c>levels</c> / <c>nicSectors</c>.
/// </summary>
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed class FormsController(AppForms forms, PortalHost host, ISqlExecutor db) : LegacyMobileController
{
    internal const string UnknownForm = "Unknown form.";

    [HttpGet, HttpPost]
    public async Task<IActionResult> Definition(string? form, string? zedId, string? certificationType, CancellationToken ct)
    {
        var unit = string.IsNullOrWhiteSpace(zedId) || string.IsNullOrWhiteSpace(certificationType) || zedId.Length > 50 || certificationType.Length > 50
            ? null : await AppFormUnit.ForAsync(db, zedId.Trim(), certificationType, ct);
        return await forms.GetAsync(host.System, form, ct, unit) is { } f
            ? LegacyJson(f.ToAppJson())
            : Fail(UnknownForm);
    }
}
