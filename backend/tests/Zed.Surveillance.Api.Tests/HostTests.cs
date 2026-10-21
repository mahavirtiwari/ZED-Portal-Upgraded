using System.Net;
using Zed.Main.Api.Tests;

namespace Zed.Surveillance.Api.Tests;

/// <summary>The Surveillance host runs the shared platform and serves only the portal features marked for it.</summary>
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
    public async Task Main_only_features_are_not_served_here()
    {
        var client = _host.CreateClient();
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/msme/dashboard")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/msme/handholding")).StatusCode);
    }
}
