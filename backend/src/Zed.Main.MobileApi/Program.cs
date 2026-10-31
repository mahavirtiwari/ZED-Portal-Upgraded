using System.Text.Json;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Mobile;
using Zed.Main.MobileApi;

// Serves the installed mobile apps (MSME, site assessor, remote assessor; consultant and surveillance apps on
// their deployments) with the URLs and formats of the old services sites. Host each at that site's address.
var builder = WebApplication.CreateBuilder(args);

// One host, three deployments: Mobile:System (Main, Consultancy, Surveillance) picks the database and the
// controllers, matching the old /mobileapi, /Consultancymobileapi and /surveillancemobileapi sites. A controller
// without [PortalSystems(...)] is served by the Main deployment only.
var system = builder.Configuration.GetValue("Mobile:System", PortalSystem.Main);
var host = new PortalHost(system);
builder.Services.AddSingleton(host);
builder.Services.AddZedServices(builder.Configuration, host.Database);
builder.Services.AddZedDataProtection(builder.Configuration, "zed.mobile." + system.ToString().ToLowerInvariant());
builder.Services.AddLegacyMobile(builder.Configuration);
builder.Services.AddSingleton<LoginThrottle>();
builder.Services.AddControllers().ConfigureApplicationPartManager(m =>
    m.FeatureProviders.Add(new PortalControllerFilter(system, typeof(LoginThrottle).Assembly)));

var maxRequest = builder.Configuration.GetValue<long?>("Mobile:MaxRequestBytes") ?? new MobileOptions().MaxRequestBytes;
builder.Services.Configure<KestrelServerOptions>(o => o.Limits.MaxRequestBodySize = maxRequest);
builder.Services.Configure<IISServerOptions>(o => o.MaxRequestBodySize = maxRequest);
builder.Services.Configure<Microsoft.AspNetCore.Http.Features.FormOptions>(o =>
{
    o.MultipartBodyLengthLimit = maxRequest;
    o.ValueLengthLimit = (int)Math.Min(int.MaxValue, maxRequest);
});

// Mobile users often share an address (carrier NAT), so the per-IP limit is generous; logins and password
// resets also have the portal's Sensitive policy (10 a minute per IP, [EnableRateLimiting] on those actions)
// and are limited per user id in LoginThrottle.
builder.Services.Configure<RateLimiterOptions>(o =>
{
    o.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 300, Window = TimeSpan.FromMinutes(1) }));
    // The apps show errorMessage of a legacy failure answer; a bare 429 on a login reads as "no network".
    o.OnRejected = async (ctx, ct) =>
    {
        if (ctx.HttpContext.GetEndpoint()?.Metadata.GetMetadata<EnableRateLimitingAttribute>()?.PolicyName != RateLimitPolicies.Sensitive)
            return;
        ctx.HttpContext.Response.StatusCode = StatusCodes.Status200OK;
        ctx.HttpContext.Response.ContentType = "application/json; charset=utf-8";
        await ctx.HttpContext.Response.WriteAsync(
            JsonSerializer.Serialize(ServiceResponse.Fail(LoginThrottle.TooManyRequests), LegacyJson.Write), ct);
    };
});

// The old services turned dates into text with the server's regional settings (row["X"].ToString()).
// Set Mobile:Culture to what the old server used; the apps parse these strings.
var culture = System.Globalization.CultureInfo.GetCultureInfo(builder.Configuration["Mobile:Culture"] ?? "en-US");
System.Globalization.CultureInfo.DefaultThreadCurrentCulture = culture;
System.Globalization.CultureInfo.DefaultThreadCurrentUICulture = culture;

builder.EnsureZedConfiguration(system, ZedHostKind.Mobile);
var app = builder.Build();

var pathBase = app.Configuration["Mobile:PathBase"];
if (!string.IsNullOrEmpty(pathBase)) app.UsePathBase(pathBase);
// The consultant app requests ".../SA//SubmitAllocation"; collapse the slashes before routing (hence the explicit UseRouting).
app.UseLegacyPathNormalization();
app.UseForwardedHeaders();
app.UseZedEnvironmentLabel();
app.UseExceptionHandler();
if (app.Environment.IsDevelopment()) app.MapOpenApi();
else app.UseHsts();
app.UseRouting();
app.UseRateLimiter();

app.MapControllers();
app.MapZedHealthChecks("/health");
app.Run();

/// <summary>Entry point marker for WebApplicationFactory in tests.</summary>
public partial class Program;
