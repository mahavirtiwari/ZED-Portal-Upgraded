using System.Net;

namespace Zed.Main.MobileApi.Tests;

public sealed class HealthTests
{
    [Fact]
    public async Task Liveness_and_database_readiness_answer()
    {
        using var host = new MobileTestHost();
        var client = host.CreateClient();
        foreach (var path in new[] { "/health", "/health/ready" })
        {
            var response = await client.GetAsync(path);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Equal("Healthy", await response.Content.ReadAsStringAsync());
        }
    }
}
