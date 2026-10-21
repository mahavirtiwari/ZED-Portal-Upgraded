using System.Reflection;
using Microsoft.AspNetCore.Mvc.ApplicationParts;
using Microsoft.AspNetCore.Mvc.Controllers;

namespace Zed.Core.Http;

/// <summary>The three legacy systems; each has its own API host, mobile host and database.</summary>
public enum PortalSystem
{
    /// <summary>ZEDCS main (ZEDCS_V2_LIVE).</summary>
    Main,
    /// <summary>ZEDCS_CONSULTANCY, handholding (ZED_CONSULTANT).</summary>
    Consultancy,
    /// <summary>ZEDCS_SURVEILLANCE (ZED_SURVEILLANCE).</summary>
    Surveillance,
}

/// <summary>
/// The systems whose host serves this controller. A controller of a shared library without the attribute is served by
/// the Main host only, so a feature reaches the Consultancy or Surveillance host only once it has been checked against
/// that system's procedures.
/// </summary>
[AttributeUsage(AttributeTargets.Class, Inherited = true)]
public sealed class PortalSystemsAttribute(params PortalSystem[] systems) : Attribute
{
    public IReadOnlyList<PortalSystem> Systems { get; } = systems;
}

/// <summary>The system of the running host (for features whose behaviour differs between systems).</summary>
public sealed record PortalHost(PortalSystem System)
{
    /// <summary>Connection string name of the host's own database.</summary>
    public string Database => System switch
    {
        PortalSystem.Consultancy => Data.ZedDatabases.Consultancy,
        PortalSystem.Surveillance => Data.ZedDatabases.Surveillance,
        _ => Data.ZedDatabases.Main,
    };
}

/// <summary>Removes the controllers of <paramref name="assembly"/> that are not meant for the running system.</summary>
public sealed class PortalControllerFilter(PortalSystem system, Assembly assembly) : IApplicationFeatureProvider<ControllerFeature>
{
    public void PopulateFeature(IEnumerable<ApplicationPart> parts, ControllerFeature feature)
    {
        foreach (var controller in feature.Controllers.Where(c => c.Assembly == assembly).ToList())
        {
            var systems = controller.GetCustomAttribute<PortalSystemsAttribute>()?.Systems ?? [PortalSystem.Main];
            if (!systems.Contains(system)) feature.Controllers.Remove(controller);
        }
    }
}
