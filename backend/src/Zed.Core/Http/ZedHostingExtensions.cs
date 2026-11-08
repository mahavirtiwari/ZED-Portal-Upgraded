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
using Microsoft.Extensions.Logging;
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

    /// <summary>Staff "Forgot password?" requests: 5 per 15 minutes per client IP (each account is also limited, migration 0008).</summary>
    public const string PasswordReset = "password-reset";

    /// <summary>New captcha pictures: 30 per minute per client IP.</summary>
    public const string Captcha = "captcha";
}

public static class ZedHostingExtensions
{
    /// <summary>
    /// The Sensitive rate limit's bucket. Not signed in (sign-in, reset, verification): one bucket per address for all
    /// those endpoints together, so guesses cannot be spread over the apps' login endpoints. Signed in: per user and
    /// endpoint, so one user's payments or uploads never use up another's, or the sign-ins of their office.
    /// </summary>
    internal static string SensitivePartition(HttpContext ctx) =>
        ctx.User.Identity?.IsAuthenticated == true && !string.IsNullOrEmpty(ctx.User.Identity.Name)
            ? "u:" + ctx.User.Identity.Name + "|" + ctx.Request.Path.Value?.ToLowerInvariant()
            : "ip:" + (ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown");

    /// <summary>Wiring shared by the Main, Consultancy and Surveillance APIs.</summary>
    public static IServiceCollection AddZedPlatform(
        this IServiceCollection services, IConfiguration config, string defaultDatabase, string authCookieName)
    {
        services.AddControllers(o => o.Filters.AddService<ValidateAntiforgeryFilter>());
        services.AddZedAuthentication(authCookieName);
        services.AddZedDataProtection(config, applicationName: authCookieName);
        services.AddZedServices(config, defaultDatabase);
        // Admin → Settings → Payment Gateway and Invoices: a saved CCAvenue account replaces the file's (read every 30 s).
        // Portals only: the payments run there, the mobile API hosts take none.
        services.AddSingleton<CcAvenueSettings>();
        services.AddHostedService<CcAvenueSettingsRefresher>();
        services.AddTransient<Microsoft.Extensions.Options.IOptions<CcAvenueOptions>>(sp =>
            Microsoft.Extensions.Options.Options.Create(sp.GetRequiredService<CcAvenueSettings>().Current));
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

        ZedDatabaseNames.Configure(config);
        services.AddSingleton<ISqlExecutor>(_ => new SqlExecutor(config.RequireConnectionString(defaultDatabase)));
        // The certification levels for every level check and list (main's dbo.SectionTypes; 2026-11-08, generic levels).
        services.AddHostedService(sp => new LevelRegistryRefresher(sp.GetRequiredService<IServiceScopeFactory>(), config,
            sp.GetRequiredService<ILogger<LevelRegistryRefresher>>(), fromOtherDatabase: defaultDatabase != ZedDatabases.Main));

        services.Configure<RecaptchaOptions>(config.GetSection(RecaptchaOptions.Section));
        services.AddHttpClient<RecaptchaVerifier>();
        services.AddSingleton<IPortalSettings, PortalSettings>();
        services.AddSingleton<ICaptchaSettings, CaptchaSettings>();
        services.AddSingleton<EmailAddresses>();
        services.AddSingleton<TextCaptcha>();
        services.AddTransient<ICaptchaVerifier, CaptchaVerifier>();
        services.AddSingleton<ILoginAudit, SqlLoginAudit>();
        services.AddSingleton<IMsmeEditHistory, SqlMsmeEditHistory>();
        services.AddHttpClient<IAppCaptchaVerifier, RecaptchaAppVerifier>();

        services.Configure<EmailOptions>(config.GetSection(EmailOptions.Section));
        // The Admin's mail servers per module (Email Settings); without one, Email:Profiles of the configuration.
        services.AddSingleton<ISmtpServers, SqlSmtpServers>();
        services.AddSingleton<SmtpEmailSender>();
        // The Admin's Email Templates: switched-off mails are not sent, own subjects replace the standard ones.
        services.AddSingleton<IEmailSender>(sp => new TemplatedEmailSender(sp.GetRequiredService<SmtpEmailSender>(), sp.GetRequiredService<ILogger<TemplatedEmailSender>>()));
        services.AddSingleton<IEmailTemplateStore, SqlEmailTemplateStore>();
        // The Admin's Texts: disclaimers, instructions, undertakings and pledges of the web pages and the apps.
        services.AddSingleton<Zed.Core.Content.IContentBlockStore, Zed.Core.Content.SqlContentBlockStore>();
        services.AddSingleton<Zed.Core.Content.ContentTexts>();
        // Who may open each document of Admin → Documents/Videos (the MSMEs only when the Admin set nothing).
        services.AddSingleton<Zed.Core.Content.IDocumentAccessStore, Zed.Core.Content.SqlDocumentAccessStore>();
        // The Admin's App Forms: fields of the apps' Basic Information forms (definition served to the apps, checked on submit).
        services.AddSingleton<Zed.Core.Forms.IAppFormStore, Zed.Core.Forms.SqlAppFormStore>();
        services.AddSingleton<Zed.Core.Forms.AppForms>();
        // The Admin's ESG checklist (served to the apps by GetEsgChecklist).
        services.AddSingleton<Zed.Core.Forms.IEsgChecklistStore, Zed.Core.Forms.SqlEsgChecklistStore>();
        services.AddSingleton<Zed.Core.Forms.EsgChecklists>();
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
            // 10 a minute: per address for sign-in and the other anonymous endpoints (together), per user and endpoint once
            // signed in (SensitivePartition).
            o.AddPolicy(RateLimitPolicies.Sensitive, ctx => RateLimitPartition.GetFixedWindowLimiter(
                SensitivePartition(ctx),
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1) }));
            o.AddPolicy(RateLimitPolicies.PasswordReset, ctx => RateLimitPartition.GetFixedWindowLimiter(
                ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 5, Window = TimeSpan.FromMinutes(15) }));
            o.AddPolicy(RateLimitPolicies.Captcha, ctx => RateLimitPartition.GetFixedWindowLimiter(
                ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 30, Window = TimeSpan.FromMinutes(1) }));
        });

        services.Configure<ForwardedHeadersOptions>(o =>
        {
            o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
            // Loopback (IIS on the same server) is always trusted; a load balancer elsewhere only when listed, so its
            // X-Forwarded-For gives the rate limits and logs the client's address instead of the balancer's.
            foreach (var entry in TrustedProxies(config))
            {
                if (System.Net.IPAddress.TryParse(entry, out var address)) o.KnownProxies.Add(address);
                else if (System.Net.IPNetwork.TryParse(entry, out var network)) o.KnownIPNetworks.Add(network);
                else throw new InvalidOperationException($"{TrustedProxiesSetting}: '{entry}' is not an IP address or network (e.g. 10.0.0.5 or 10.0.0.0/24).");
            }
        });
        return services;
    }

    /// <summary>Addresses or networks (CIDR) of the proxies in front of the hosts, as a list or one comma-separated value.</summary>
    public const string TrustedProxiesSetting = "Security:TrustedProxies";

    public static IReadOnlyList<string> TrustedProxies(IConfiguration config)
    {
        var section = config.GetSection(TrustedProxiesSetting);
        var values = section.Value is { } single ? new[] { single } : section.GetChildren().Select(c => c.Value).OfType<string>();
        return values.SelectMany(v => v.Split([',', ';'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)).ToList();
    }

    public static WebApplication UseZedPlatform(this WebApplication app)
    {
        app.UseForwardedHeaders();
        // An https public address: every cookie is Secure, also over plain http behind a TLS-ending balancer.
        if (ZedAuthenticationExtensions.HttpsOnly(app.Services.GetRequiredService<Microsoft.Extensions.Options.IOptions<PortalOptions>>().Value))
            app.UseCookiePolicy(new CookiePolicyOptions { Secure = CookieSecurePolicy.Always });
        app.UseZedEnvironmentLabel();
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
    /// In the Staging environment, and wherever <c>Portal:EnvironmentLabel</c> is set: every response says
    /// <c>X-Robots-Tag: noindex, nofollow</c> and <c>/robots.txt</c> disallows everything, so search engines keep the
    /// test site out of their index (MSMEs must not find it and register there). The label is not shown anywhere (no banner, title or
    /// mail prefix) is optional: a staging site may run without one. Elsewhere nothing changes.
    /// </summary>
    public static IApplicationBuilder UseZedEnvironmentLabel(this IApplicationBuilder app)
    {
        var label = app.ApplicationServices.GetRequiredService<IConfiguration>()["Portal:EnvironmentLabel"];
        if (string.IsNullOrWhiteSpace(label) && !app.ApplicationServices.GetRequiredService<IHostEnvironment>().IsStaging()) return app;
        return app.Use(async (context, next) =>
        {
            context.Response.OnStarting(() =>
            {
                context.Response.Headers["X-Robots-Tag"] = "noindex, nofollow";
                return Task.CompletedTask;
            });
            if ((HttpMethods.IsGet(context.Request.Method) || HttpMethods.IsHead(context.Request.Method))
                && context.Request.Path.Equals("/robots.txt", StringComparison.OrdinalIgnoreCase))
            {
                context.Response.ContentType = "text/plain; charset=utf-8";
                await context.Response.WriteAsync("User-agent: *\nDisallow: /\n");
                return;
            }
            await next();
        });
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
