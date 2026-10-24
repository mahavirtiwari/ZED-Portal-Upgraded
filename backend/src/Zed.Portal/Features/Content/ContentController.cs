using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Content;
using Zed.Core.Http;

namespace Zed.Portal.Features.Content;

/// <summary>
/// The web pages' disclaimers, instructions, undertakings and pledges as the Admin set them (Admin → Texts), for the
/// public pages too: one call per visit, cached by the browser for a minute.
/// </summary>
[ApiController]
[Route("api/content")]
[AllowAnonymous]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed class ContentController(ContentTexts texts, PortalHost host) : ControllerBase
{
    [HttpGet]
    [ResponseCache(Duration = 60, Location = ResponseCacheLocation.Client)]
    public Task<IReadOnlyList<ContentText>> Get(CancellationToken ct) => texts.ForAsync(host.System, ContentChannel.Web, ct);
}
