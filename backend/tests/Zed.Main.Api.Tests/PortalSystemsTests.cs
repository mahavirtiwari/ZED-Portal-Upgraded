using System.Reflection;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ApplicationParts;
using Microsoft.AspNetCore.Mvc.Controllers;
using Zed.Core.Http;
using Zed.Portal;
using Zed.Portal.Features.Msme;

namespace Zed.Main.Api.Tests;

public sealed class PortalSystemsTests
{
    [PortalSystems(PortalSystem.Main, PortalSystem.Surveillance)]
    private sealed class SharedProbeController : ControllerBase;

    private static List<TypeInfo> Filter(PortalSystem system, params Type[] controllers)
    {
        var feature = new ControllerFeature();
        foreach (var c in controllers) feature.Controllers.Add(c.GetTypeInfo());
        // The filter only touches controllers of the given assembly; the probe lives in this test assembly.
        new PortalControllerFilter(system, typeof(PortalSystemsTests).Assembly).PopulateFeature([], feature);
        new PortalControllerFilter(system, typeof(PortalSetup).Assembly).PopulateFeature([], feature);
        return feature.Controllers.ToList();
    }

    [Fact]
    public void A_controller_without_the_attribute_is_served_by_the_main_host_only()
    {
        Assert.Contains(typeof(MsmeAuthController).GetTypeInfo(), Filter(PortalSystem.Main, typeof(MsmeAuthController)));
        Assert.Empty(Filter(PortalSystem.Consultancy, typeof(MsmeAuthController)));
        Assert.Empty(Filter(PortalSystem.Surveillance, typeof(MsmeAuthController)));
    }

    [Fact]
    public void A_marked_controller_is_served_by_the_systems_it_names()
    {
        Assert.Single(Filter(PortalSystem.Surveillance, typeof(SharedProbeController)));
        Assert.Single(Filter(PortalSystem.Main, typeof(SharedProbeController)));
        Assert.Empty(Filter(PortalSystem.Consultancy, typeof(SharedProbeController)));
    }
}
