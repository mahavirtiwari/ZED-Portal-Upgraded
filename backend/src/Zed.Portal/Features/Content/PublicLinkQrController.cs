using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using QRCoder;
using Zed.Core.Data;
using Zed.Core.Http;

namespace Zed.Portal.Features.Content;

/// <summary>
/// GET api/public/links/{key}/qr (2026-11-08): a QR code (SVG) of an app store link as Admin → Links has it, so the codes on the
/// registration and payment pages follow the Admin's link (before, fixed pictures of the default addresses). Only the app store
/// links; 404 when the link is switched off.
/// </summary>
[ApiController]
[AllowAnonymous]
[Route("api/public/links")]
public sealed class PublicLinkQrController(IPortalSettings settings, IOptions<PortalOptions> portal) : ControllerBase
{
    private static readonly HashSet<string> QrLinks = new(StringComparer.OrdinalIgnoreCase) { "playStore", "appStore" };

    [HttpGet("{key}/qr")]
    [ResponseCache(Duration = 300, Location = ResponseCacheLocation.Any)]
    public async Task<IActionResult> Qr(string key, CancellationToken ct)
    {
        if (!QrLinks.Contains(key)) return NotFound();
        var links = await PortalLinks.ForPagesAsync(settings, portal.Value, ct);
        if (links.FirstOrDefault(l => string.Equals(l.Key, key, StringComparison.OrdinalIgnoreCase)).Value is not { Length: > 0 } url) return NotFound();
        using var generator = new QRCodeGenerator();
        using var data = generator.CreateQrCode(url, QRCodeGenerator.ECCLevel.M);
        return Content(new SvgQRCode(data).GetGraphic(6), "image/svg+xml");
    }
}
