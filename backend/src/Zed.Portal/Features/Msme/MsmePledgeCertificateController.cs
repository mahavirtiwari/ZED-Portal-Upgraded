using Microsoft.AspNetCore.Mvc;
using Microsoft.Net.Http.Headers;
using Zed.Core.Data;

namespace Zed.Portal.Features.Msme;

/// <summary>
/// The signed-in MSME's pledge certificate (V4): the page data (<c>GET api/msme/pledge-certificate</c>, shown at
/// /msme/pledge-certificate) and the PDF, drawn when it is downloaded (<c>.../pdf</c>). Nothing is stored on the server;
/// both come from the unit's registration (<see cref="PledgeCertificateService.LoadAsync"/>).
/// </summary>
[Route("api/msme/pledge-certificate")]
public sealed class MsmePledgeCertificateController(ISqlExecutor db, PledgeCertificateService certificates) : MsmeApiController
{
    [HttpGet]
    public async Task<ActionResult<PledgeCertificateView>> Get(CancellationToken ct) =>
        await certificates.LoadAsync(db, ZedId, ct) is { } d ? certificates.View(d) : NotFound();

    /// <summary>The PDF as a download (<paramref name="inline"/>: opened in the browser instead).</summary>
    [HttpGet("pdf")]
    public async Task<IActionResult> Pdf(bool inline, CancellationToken ct) =>
        await certificates.LoadAsync(db, ZedId, ct) is { } d ? PledgePdf.Result(this, certificates, d, inline) : NotFound();
}

/// <summary>A pledge certificate PDF drawn now, as a download or opened in the browser.</summary>
public static class PledgePdf
{
    public static IActionResult Result(ControllerBase controller, PledgeCertificateService certificates, PledgeCertificateData d, bool inline)
    {
        var name = PledgeCertificateService.FileName(d.ZedId);
        var headers = controller.Response.Headers;
        headers.XContentTypeOptions = "nosniff";
        headers.CacheControl = "no-store";
        if (!inline) return controller.File(certificates.Render(d), "application/pdf", name);
        headers.ContentDisposition = new ContentDispositionHeaderValue("inline") { FileNameStar = name }.ToString();
        return controller.File(certificates.Render(d), "application/pdf");
    }
}
