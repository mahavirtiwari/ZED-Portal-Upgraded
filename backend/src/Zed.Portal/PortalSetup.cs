using Microsoft.AspNetCore.Mvc.ApplicationParts;
using Microsoft.Extensions.Options;
using Zed.Core.Http;
using Zed.Portal.Features.Documents;
using Zed.Portal.Features.Msme;
using Zed.Portal.Features.Payments;
using Zed.Portal.Features.Payments.Mobile;

namespace Zed.Portal;

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
        services.AddScoped<MsmeRegistrationService>();
        services.AddSingleton<AppRegistrationStore>();

        services.Configure<ProteanGstinOptions>(config.GetSection(ProteanGstinOptions.Section));
        services.AddHttpClient<IGstinVerifier, ProteanGstinVerifier>(c => c.Timeout = TimeSpan.FromSeconds(30));
        services.Configure<UdyamiBharatOptions>(config.GetSection(UdyamiBharatOptions.Section));
        services.AddHttpClient<IUdyamiBharatVerifier, UdyamiBharatVerifier>(c => c.Timeout = TimeSpan.FromSeconds(20));
        services.AddScoped<PaymentCompletion>();
        services.AddScoped<SurveillancePaymentCompletion>();
        MobilePaymentsSetup.AddMobilePayments(services, config);
        services.AddSingleton<PledgeCertificateService>();
        services.AddScoped<IAssessmentDocuments, AssessmentDocuments>();
        services.AddScoped<Features.Staff.PasswordReset.StaffPasswordResets>();
        services.AddScoped<Features.Msme.MsmePasswordResets>();
        return builder;
    }
}
