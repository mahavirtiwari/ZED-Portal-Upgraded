using System.Net;
using Zed.Main.Api.Tests;

namespace Zed.Consultancy.Api.Tests;

/// <summary>The Consultancy host runs the shared platform and serves only the portal features marked for it.</summary>
public sealed class HostTests : IDisposable
{
    private readonly TestHost _host = new();

    public void Dispose() => _host.Dispose();

    [Fact]
    public async Task The_shared_platform_endpoints_answer()
    {
        var client = _host.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/health")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.GetAsync("/api/auth/me")).StatusCode);
    }

    [Fact]
    public async Task The_public_levels_and_states_are_served_here_from_mains_tables()
    {
        // 2026-11-21 (UI audit): every Consultancy page asked for them and got 404.
        var client = _host.CreateClient();
        var levels = await client.GetAsync("/api/public/levels");
        Assert.Equal(HttpStatusCode.OK, levels.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/public/levels/all")).StatusCode);
        var states = await client.GetAsync("/api/public/states");
        Assert.Equal(HttpStatusCode.OK, states.StatusCode);
        Assert.Contains("ANDHRA PRADESH", await states.Content.ReadAsStringAsync());
        // The levels live in main's database: this host reads main's table by name.
        Assert.Contains(_host.Sql.Calls, c => c.Name.Contains("ZEDCS_V2_LIVE.dbo.SectionTypes", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Main_only_features_are_not_served_here()
    {
        var client = _host.CreateClient();
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/msme/dashboard")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/msme/handholding")).StatusCode);
    }
}
