using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.OpenApi;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Finance;
using Zed.Core.Payments;
using Zed.Core.Security;

namespace Zed.Core.Http;

public static class RateLimitPolicies
{
    /// <summary>Login, OTP and lookup endpoints: 10 requests per minute per client IP.</summary>
    public const string Sensitive = "sensitive";
}

public static class ZedHostingExtensions
{
    /// <summary>Wiring shared by the Main, Consultancy and Surveillance APIs.</summary>
    public static IServiceCollection AddZedPlatform(
        this IServiceCollection services, IConfiguration config, string defaultDatabase, string authCookieName)
    {
        services.AddControllers(o => o.Filters.AddService<ValidateAntiforgeryFilter>());
        services.AddZedAuthentication(authCookieName);
        services.AddZedDataProtection(config, applicationName: authCookieName);
        services.AddZedServices(config, defaultDatabase);
        return services;
    }

    /// <summary>
    /// Services without the browser parts (cookies, anti-forgery, Angular files); the mobile API
    /// host uses this on its own.
    /// </summary>
    public static IServiceCollection AddZedServices(this IServiceCollection services, IConfiguration config, string defaultDatabase)
    {
        services.AddProblemDetails();
        services.AddOpenApi();
        services.Configure<PortalOptions>(config.GetSection(PortalOptions.Section));

        services.AddSingleton<ISqlExecutor>(_ => new SqlExecutor(config.RequireConnectionString(defaultDatabase)));

        services.Configure<RecaptchaOptions>(config.GetSection(RecaptchaOptions.Section));
        services.AddHttpClient<ICaptchaVerifier, RecaptchaVerifier>();

        services.Configure<EmailOptions>(config.GetSection(EmailOptions.Section));
        services.AddSingleton<IEmailSender, SmtpEmailSender>();
        services.AddSingleton<IHtmlTemplateRenderer, HtmlTemplateRenderer>();

        services.Configure<CcAvenueOptions>(config.GetSection(CcAvenueOptions.Section));
        services.Configure<ErpOptions>(config.GetSection(ErpOptions.Section));
        services.AddHttpClient<IErpFinanceService, ErpFinanceService>(c => c.Timeout = TimeSpan.FromSeconds(60));
        services.AddSingleton<BackgroundWorkQueue>();
        services.AddSingleton<IBackgroundWork>(sp => sp.GetRequiredService<BackgroundWorkQueue>());
        services.AddHostedService(sp => sp.GetRequiredService<BackgroundWorkQueue>());

        // Single server: in memory. Several servers: Cache:SqlServerTable.
        services.AddZedDistributedCache(config, defaultDatabase);
        services.AddHealthChecks().AddCheck<DatabaseHealthCheck>("database", tags: [DatabaseHealthCheck.Tag]);

        services.AddRateLimiter(o =>
        {
            o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            o.AddPolicy(RateLimitPolicies.Sensitive, ctx => RateLimitPartition.GetFixedWindowLimiter(
                ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1) }));
        });

        services.Configure<ForwardedHeadersOptions>(o =>
            o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto);
        return services;
    }

    public static WebApplication UseZedPlatform(this WebApplication app)
    {
        app.UseForwardedHeaders();
        app.UseExceptionHandler();
        app.UseStatusCodePages();
        if (app.Environment.IsDevelopment()) app.MapOpenApi();
        else app.UseHsts();

        app.UseDefaultFiles();
        app.UseStaticFiles();
        app.UseRateLimiter();
        app.UseAuthentication();
        app.UseAuthorization();
        app.UseXsrfCookie();

        app.MapControllers();
        app.MapZedHealthChecks("/api/health");
        // Unknown API routes are 404s; any other path is an Angular client-side route.
        app.MapFallback("/api/{**rest}", () => Results.NotFound());
        app.MapFallbackToFile("index.html");
        return app;
    }

    /// <summary>
    /// <c>{path}</c>: liveness, the process answers (no checks run). <c>{path}/ready</c>: the database answers too.
    /// Both reply with the status word only.
    /// </summary>
    public static IEndpointRouteBuilder MapZedHealthChecks(this IEndpointRouteBuilder app, string path)
    {
        app.MapHealthChecks(path, new HealthCheckOptions { Predicate = _ => false });
        app.MapHealthChecks(path + "/ready", new HealthCheckOptions { Predicate = c => c.Tags.Contains(DatabaseHealthCheck.Tag) });
        return app;
    }
}
