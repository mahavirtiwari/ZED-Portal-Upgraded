using System.Net;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Zed.Core.Http;

namespace Zed.Main.Api.Tests;

/// <summary>
/// Behind a load balancer that ends TLS: the cookies stay Secure when the portal's public address is https, and the
/// balancer's forwarded client address is trusted only when it is listed (Security:TrustedProxies).
/// </summary>
public sealed class CookieSecurityTests
{
    private static async Task<IReadOnlyList<string>> CookiesOfAsync(Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactory<Program> host)
    {
        var r = await host.CreateDefaultClient().GetAsync("/api/auth/me");
        // A plain-http request must still work (antiforgery refuses one when its own cookie policy is Always).
        Assert.True(r.IsSuccessStatusCode, $"GET /api/auth/me: {(int)r.StatusCode}");
        return r.Headers.TryGetValues("Set-Cookie", out var values) ? values.ToList() : [];
    }

    [Fact]
    public async Task With_an_https_public_address_every_cookie_is_secure_even_over_http()
    {
        using var host = new TestHost().WithWebHostBuilder(b => b.UseSetting("Portal:PublicBaseUrl", "https://zed.example.test"));

        var cookies = await CookiesOfAsync(host);
        Assert.Contains(cookies, c => c.StartsWith("XSRF-TOKEN=", StringComparison.Ordinal));
        Assert.NotEmpty(cookies);
        Assert.All(cookies, c => Assert.Contains("; secure", c, StringComparison.OrdinalIgnoreCase));

        var auth = host.Services.GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>().Get(CookieAuthenticationDefaults.AuthenticationScheme);
        Assert.Equal(CookieSecurePolicy.Always, auth.Cookie.SecurePolicy);
        // Not Always: antiforgery would refuse plain-http requests; the cookie policy makes its cookie Secure (above).
        Assert.NotEqual(CookieSecurePolicy.Always, host.Services.GetRequiredService<IOptions<AntiforgeryOptions>>().Value.Cookie.SecurePolicy);
    }

    [Fact]
    public async Task With_an_http_public_address_cookies_follow_the_request()
    {
        // Development: Portal:PublicBaseUrl is http://localhost:4200.
        using var host = new TestHost();

        var cookies = await CookiesOfAsync(host);
        Assert.Contains(cookies, c => c.StartsWith("XSRF-TOKEN=", StringComparison.Ordinal));
        Assert.All(cookies, c => Assert.DoesNotContain("; secure", c, StringComparison.OrdinalIgnoreCase));
        var auth = host.Services.GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>().Get(CookieAuthenticationDefaults.AuthenticationScheme);
        Assert.Equal(CookieSecurePolicy.SameAsRequest, auth.Cookie.SecurePolicy);
    }

    [Fact]
    public void Listed_proxies_are_trusted_besides_loopback()
    {
        using var host = new TestHost().WithWebHostBuilder(b => b.UseSetting(ZedHostingExtensions.TrustedProxiesSetting, "10.0.0.5, 10.1.0.0/16"));

        var o = host.Services.GetRequiredService<IOptions<ForwardedHeadersOptions>>().Value;
        Assert.Contains(IPAddress.Parse("10.0.0.5"), o.KnownProxies);
        Assert.Contains(IPAddress.IPv6Loopback, o.KnownProxies);
        Assert.Contains(o.KnownIPNetworks, n => n.ToString() == "10.1.0.0/16");
    }

    [Fact]
    public void Without_the_setting_only_loopback_is_trusted()
    {
        using var host = new TestHost();
        var o = host.Services.GetRequiredService<IOptions<ForwardedHeadersOptions>>().Value;
        Assert.Equal(IPAddress.IPv6Loopback, Assert.Single(o.KnownProxies));
        Assert.All(o.KnownIPNetworks, n => Assert.True(n.Contains(IPAddress.Loopback)));
    }

    [Fact]
    public void Trusted_proxies_can_be_a_list_and_bad_entries_are_refused()
    {
        var list = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Security:TrustedProxies:0"] = "10.0.0.5",
            ["Security:TrustedProxies:1"] = "10.0.0.6; 10.2.0.0/24",
        }).Build();
        Assert.Equal(["10.0.0.5", "10.0.0.6", "10.2.0.0/24"], ZedHostingExtensions.TrustedProxies(list));

        using var bad = new TestHost().WithWebHostBuilder(b => b.UseSetting(ZedHostingExtensions.TrustedProxiesSetting, "balancer.example.test"));
        var ex = Assert.ThrowsAny<Exception>(() => bad.Services.GetRequiredService<IOptions<ForwardedHeadersOptions>>().Value);
        var messages = new List<string>();
        for (var e = ex; e is not null; e = e.InnerException) messages.Add(e.Message);
        Assert.Contains(messages, m => m.Contains("balancer.example.test", StringComparison.Ordinal));
    }
}
