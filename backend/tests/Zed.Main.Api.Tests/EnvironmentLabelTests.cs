using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;

namespace Zed.Main.Api.Tests;

/// <summary>Portal:EnvironmentLabel (staging): label in the client config, noindex header and robots.txt.</summary>
public sealed class EnvironmentLabelTests : IDisposable
{
    private readonly TestHost _host = new();

    public void Dispose() => _host.Dispose();

    [Fact]
    public async Task Without_a_label_nothing_changes()
    {
        var client = _host.CreateClient();
        var r = await client.GetAsync("/api/config");
        Assert.False(r.Headers.Contains("X-Robots-Tag"));
        var json = JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal(JsonValueKind.Null, json.GetProperty("environmentLabel").ValueKind);
    }

    [Fact]
    public async Task A_label_reaches_the_app_and_keeps_search_engines_out()
    {
        using var staging = _host.WithWebHostBuilder(b => b.UseSetting("Portal:EnvironmentLabel", "STAGING"));
        var client = staging.CreateClient();

        var config = await client.GetAsync("/api/config");
        Assert.Equal("noindex, nofollow", string.Join(",", config.Headers.GetValues("X-Robots-Tag")));
        Assert.Equal("STAGING", JsonDocument.Parse(await config.Content.ReadAsStringAsync()).RootElement.GetProperty("environmentLabel").GetString());

        var robots = await client.GetAsync("/robots.txt");
        Assert.Equal(HttpStatusCode.OK, robots.StatusCode);
        Assert.Contains("Disallow: /", await robots.Content.ReadAsStringAsync());
        Assert.True(robots.Headers.Contains("X-Robots-Tag"));
    }
}
