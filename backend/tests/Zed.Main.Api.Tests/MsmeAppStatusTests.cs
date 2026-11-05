using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;

namespace Zed.Main.Api.Tests;

/// <summary>The ZED MSME app's VIEW DETAILS: the status steps with its sign-in token (Msme/AppCertificationStatus).</summary>
public sealed class MsmeAppStatusTests : IDisposable
{
    private const string Me = "ZEDMSME000001";
    private readonly TestHost _host = new();

    public MsmeAppStatusTests()
    {
        _host.Sql.Procs["SP_MSME_GET_DETAILS"] = args => FakeSql.Sets(
            [new Dictionary<string, object?> { ["ZedId"] = FakeSql.Arg(args, "ZedId"), ["EnterpriseName"] = "Acme", ["Password"] = "secret" }],
            [new Dictionary<string, object?> { ["UdyogAadharNo"] = "UDYAM-UP-29-0003915" }],
            [new Dictionary<string, object?> { ["BronzeStatus"] = 3 }],
            [new Dictionary<string, object?>
            {
                ["ApplicationReceived"] = "Application received on May 1, 2024",
                ["BasicInfoStatus"] = "Submitted on May 2, 2024",
                ["Nc1Raised"] = "NC 1 raised on May 5, 2024",
                ["PaymentReference"] = "not for the app",
            }],
            [new Dictionary<string, object?> { ["Total"] = 10000 }]);
    }

    public void Dispose() => _host.Dispose();

    private async Task<(HttpClient Client, string Token)> AppAsync()
    {
        var key = Convert.ToBase64String(Enumerable.Range(1, 32).Select(i => (byte)i).ToArray());
        var app = _host.WithWebHostBuilder(b => b.UseSetting("Mobile:AppTokenKey", key));
        var token = await app.Services.GetRequiredService<Zed.Core.Mobile.AppTokens>().IssueAsync(Zed.Core.Mobile.MobileApps.Msme, Me, Me);
        return (app.CreateClient(), token);
    }

    private static async Task<HttpResponseMessage> GetAsync(HttpClient client, string certification, string? token)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, "/Msme/AppCertificationStatus?certification=" + Uri.EscapeDataString(certification));
        if (token is not null) request.Headers.Add(Zed.Core.Mobile.AppTokens.Header, token);
        return await client.SendAsync(request);
    }

    [Fact]
    public async Task Answers_the_status_steps_of_the_tokens_unit()
    {
        var (client, token) = await AppAsync();

        var response = await GetAsync(client, "silver", token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("1", json.GetProperty("status").GetString());
        Assert.Equal("Silver", json.GetProperty("certification").GetString());
        var steps = json.GetProperty("steps");
        Assert.Equal("Application received on May 1, 2024", steps.GetProperty("ApplicationReceived").GetString());
        Assert.Equal("NC 1 raised on May 5, 2024", steps.GetProperty("Nc1Raised").GetString());
        Assert.Equal(JsonValueKind.Null, steps.GetProperty("GetCertified").ValueKind);
        Assert.False(steps.TryGetProperty("PaymentReference", out _));

        var call = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_MSME_GET_DETAILS");
        Assert.Equal(Me, FakeSql.Arg(call.Args, "ZedId"));
        Assert.Equal("Silver", FakeSql.Arg(call.Args, "CertificationType"));
    }

    [Fact]
    public async Task Answers_ZED_X_as_the_web_status_page_does()
    {
        var (client, token) = await AppAsync();

        var json = JsonDocument.Parse(await (await GetAsync(client, "zedx", token)).Content.ReadAsStringAsync()).RootElement;

        Assert.Equal("1", json.GetProperty("status").GetString());
        Assert.Equal("ZEDX", json.GetProperty("certification").GetString());
        Assert.Equal("ZEDX", FakeSql.Arg(Assert.Single(_host.Sql.Calls, c => c.Name == "SP_MSME_GET_DETAILS").Args, "CertificationType"));
    }

    [Fact]
    public async Task Needs_a_valid_token()
    {
        var (client, _) = await AppAsync();

        Assert.Equal(HttpStatusCode.Unauthorized, (await GetAsync(client, "Bronze", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await GetAsync(client, "Bronze", "h1.forged.token")).StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_MSME_GET_DETAILS");
    }

    [Theory]
    [InlineData("BronzeSurveillance")]
    [InlineData("Platinum")]
    [InlineData("Bronze' OR 1=1 --")]
    public async Task Only_the_known_levels_are_answered(string certification)
    {
        var (client, token) = await AppAsync();

        var json = JsonDocument.Parse(await (await GetAsync(client, certification, token)).Content.ReadAsStringAsync()).RootElement;

        Assert.Equal("0", json.GetProperty("status").GetString());
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_MSME_GET_DETAILS");
    }
}
