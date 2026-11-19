using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Content;
using Zed.Core.Http;

namespace Zed.Portal.Features.Content;

/// <summary>
/// The web pages' disclaimers, instructions, undertakings and pledges as the Admin set them (Admin → Texts), and the page
/// wording the Admin changed (2026-11-19, Texts → Page wording), for the public pages too: one call per visit, cached by the
/// browser for a minute, then asked again with its ETag (304 Not Modified while nothing changed).
/// </summary>
[ApiController]
[Route("api/content")]
[AllowAnonymous]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed class ContentController(ContentTexts texts, PortalHost host) : ControllerBase
{
    [HttpGet]
    [ResponseCache(Duration = 60, Location = ResponseCacheLocation.Client)]
    public async Task<ActionResult<IReadOnlyList<ContentText>>> Get(CancellationToken ct)
    {
        var snapshot = await texts.SnapshotAsync(host.System, ContentChannel.Web, ct);
        Response.Headers.ETag = snapshot.ETag;
        var asked = Request.Headers.IfNoneMatch.ToString();
        if (asked.Length > 0 && asked.Split(',').Any(t => t.Trim() is var tag && (tag == snapshot.ETag || tag == "W/" + snapshot.ETag || tag == "*")))
            return StatusCode(StatusCodes.Status304NotModified);
        return Ok(snapshot.Texts);
    }
}
