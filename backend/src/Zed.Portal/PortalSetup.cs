using System.Reflection;
using Microsoft.AspNetCore.Mvc.ApplicationParts;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.Extensions.Options;
using Zed.Portal.Features.Documents;
using Zed.Portal.Features.Msme;
using Zed.Portal.Features.Payments;
using Zed.Portal.Features.Payments.Mobile;

namespace Zed.Portal;

/// <summary>The three legacy systems this library serves, one API host each.</summary>
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
/// The systems whose host serves this controller. A controller without the attribute is served by the Main host
/// only, so a feature reaches the Consultancy or Surveillance host only once it has been checked against that
/// system's procedures.
/// </summary>
[AttributeUsage(AttributeTargets.Class, Inherited = true)]
public sealed class PortalSystemsAttribute(params PortalSystem[] systems) : Attribute
{
    public IReadOnlyList<PortalSystem> Systems { get; } = systems;
}

/// <summary>The system of the running host (for features whose behaviour differs between systems).</summary>
public sealed record PortalHost(PortalSystem System);

public static class PortalSetup
{
    /// <summary>Feature services shared by all hosts, and the controller filter for <paramref name="system"/>.</summary>
    public static WebApplicationBuilder AddPortal(this WebApplicationBuilder builder, PortalSystem system)
    {
        var services = builder.Services;
        var config = builder.Configuration;
        services.AddSingleton(new PortalHost(system));

        var assembly = typeof(PortalSetup).Assembly;
        services.AddControllers().ConfigureApplicationPartManager(m =>
        {
            if (!m.ApplicationParts.OfType<AssemblyPart>().Any(p => p.Assembly == assembly))
                m.ApplicationParts.Add(new AssemblyPart(assembly));
            m.FeatureProviders.Add(new PortalControllerFilter(system, assembly));
        });

        services.Configure<UdyamOptions>(config.GetSection(UdyamOptions.Section));
        services.AddHttpClient<IUdyamClient, UdyamClient>(c => c.Timeout = TimeSpan.FromSeconds(30))
            .ConfigurePrimaryHttpMessageHandler(sp => new HttpClientHandler
            {
                ServerCertificateCustomValidationCallback = sp.GetRequiredService<IOptions<UdyamOptions>>().Value.AllowInvalidCertificate
                    ? HttpClientHandler.DangerousAcceptAnyServerCertificateValidator
                    : null,
            });
        if (config.GetValue<bool>("Udyam:UseSampleData"))
        {
            if (!builder.Environment.IsDevelopment())
                throw new InvalidOperationException("Udyam:UseSampleData is only allowed in the Development environment.");
            services.AddSingleton<IUdyamClient, SampleUdyamClient>();
        }
        services.AddSingleton<RegistrationSessionStore>();

        services.Configure<ProteanGstinOptions>(config.GetSection(ProteanGstinOptions.Section));
        services.AddHttpClient<IGstinVerifier, ProteanGstinVerifier>(c => c.Timeout = TimeSpan.FromSeconds(30));
        services.Configure<UdyamiBharatOptions>(config.GetSection(UdyamiBharatOptions.Section));
        services.AddHttpClient<IUdyamiBharatVerifier, UdyamiBharatVerifier>(c => c.Timeout = TimeSpan.FromSeconds(20));
        services.AddScoped<PaymentCompletion>();
        services.AddScoped<SurveillancePaymentCompletion>();
        MobilePaymentsSetup.AddMobilePayments(services, config);
        services.AddSingleton<PledgeCertificateService>();
        services.AddScoped<IAssessmentDocuments, AssessmentDocuments>();
        return builder;
    }
}

/// <summary>Removes this library's controllers that are not meant for the running system.</summary>
internal sealed class PortalControllerFilter(PortalSystem system, Assembly assembly) : IApplicationFeatureProvider<ControllerFeature>
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
