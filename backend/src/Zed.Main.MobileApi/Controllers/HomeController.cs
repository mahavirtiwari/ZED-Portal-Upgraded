using Microsoft.AspNetCore.Mvc;
using Zed.Core.Http;
using Zed.Core.Mobile;

namespace Zed.Main.MobileApi.Controllers;

/// <summary>The old site's root page; load balancers and the apps' reachability checks hit it.</summary>
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed class HomeController : LegacyMobileController
{
    [HttpGet("/"), HttpPost("/"), HttpGet, HttpPost]
    public IActionResult Index() => LegacyContent("ZED services", "text/plain");
}
