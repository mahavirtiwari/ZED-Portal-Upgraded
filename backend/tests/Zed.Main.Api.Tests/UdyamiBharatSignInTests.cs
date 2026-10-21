using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Zed.Portal.Features.Msme;

namespace Zed.Main.Api.Tests;

public sealed class UdyamiBharatSignInTests : IDisposable
{
    private sealed class FakeVerifier : IUdyamiBharatVerifier
    {
        public UdyamiVerification Result { get; set; } = new(true, "https://ubp.ubputl.com/dashboard", "OK", "{}");
        public List<(string App, string Token)> Calls { get; } = [];

        public Task<UdyamiVerification> VerifyAsync(string applicationNo, string securityToken, CancellationToken ct)
        {
            Calls.Add((applicationNo, securityToken));
            return Task.FromResult(Result);
        }
    }

    private readonly TestHost _host = new();
    private readonly FakeVerifier _verifier = new();
    private readonly Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactory<Program> _app;

    public UdyamiBharatSignInTests()
    {
        _host.Sql.Procs["SP_GET_USER_DETAILS_BY_USER_ID"] = args => FakeSql.Arg(args, "UserId") switch
        {
            "ZEDMSME000001" => FakeSql.Sets([new { UserId = "ZEDMSME000001", UserName = "Acme", RoleId = 5, IsActive = true, Email = "a@x.test", MobileNo = "9", StateCode = "9", DistrictCode = "1", Password = "secret" }]),
            "ZEDMSME000009" => FakeSql.Sets([new { UserId = "ZEDMSME000009", UserName = "Off", RoleId = 5, IsActive = false }]),
            "ZEDMSME000007" => FakeSql.Sets([new { UserId = "ZEDMSME000007", UserName = "Staff", RoleId = 7, IsActive = true }]),
            _ => FakeSql.Sets([]),
        };
        _app = _host.WithWebHostBuilder(b =>
        {
            b.UseSetting("UdyamiBharat:Enabled", "true");
            b.ConfigureTestServices(s => { s.RemoveAll<IUdyamiBharatVerifier>(); s.AddSingleton<IUdyamiBharatVerifier>(_verifier); });
        });
    }

    public void Dispose()
    {
        _app.Dispose();
        _host.Dispose();
    }

    private async Task<(HttpClient Client, HttpResponseMessage Response)> SignIn(string app, string token)
    {
        var client = await BrowserAsync();
        return (client, await client.PostAsJsonAsync("/api/msme/auth/udyami-bharat", new { applicationNo = app, token }));
    }

    // Same XSRF dance as TestHost.CreateBrowserAsync, against the customised factory.
    private async Task<HttpClient> BrowserAsync()
    {
        var cookies = new CookieContainer();
        var client = _app.CreateDefaultClient(new CookieHandler(cookies, _app.Server.BaseAddress));
        (await client.GetAsync("/api/auth/me")).EnsureSuccessStatusCode();
        return client;
    }

    private sealed class CookieHandler(CookieContainer cookies, Uri baseAddress) : DelegatingHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var uri = request.RequestUri!.IsAbsoluteUri ? request.RequestUri : new Uri(baseAddress, request.RequestUri);
            if (cookies.GetCookieHeader(uri) is { Length: > 0 } header) request.Headers.Add("Cookie", header);
            if (request.Method != HttpMethod.Get && cookies.GetCookies(uri)["XSRF-TOKEN"] is { } xsrf)
                request.Headers.Add("X-XSRF-TOKEN", Uri.UnescapeDataString(xsrf.Value));
            var response = await base.SendAsync(request, ct);
            if (response.Headers.TryGetValues("Set-Cookie", out var set)) foreach (var c in set) cookies.SetCookies(uri, c);
            return response;
        }
    }

    [Fact]
    public async Task A_verified_token_signs_the_MSME_in_without_any_password()
    {
        var (client, r) = await SignIn("zedmsme000001", "one-time-token");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var json = await r.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("ZEDMSME000001", json.GetProperty("user").GetProperty("userId").GetString());
        Assert.Equal("https://ubp.ubputl.com/dashboard", json.GetProperty("returnUrl").GetString());
        Assert.Equal(("ZEDMSME000001", "one-time-token"), Assert.Single(_verifier.Calls));
        // No password-based procedure is involved any more.
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_GET_USER_DETAILS");
        // The one-time token is logged only as a hash.
        var log = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_API_UBP_UNIT_SIGN_IN_DETAILS");
        Assert.StartsWith("sha256:", FakeSql.Arg(log.Args, "SecurityToken"));
        Assert.Equal("ZEDMSME000001", (await client.GetFromJsonAsync<JsonElement>("/api/auth/me")).GetProperty("userId").GetString());
    }

    [Fact]
    public async Task An_unverified_token_is_refused()
    {
        _verifier.Result = new(false, null, "OK", "{\"IsTokenVerifed\":false}");
        var (_, r) = await SignIn("ZEDMSME000001", "forged");
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Equal("Invalid token.", await r.ProblemTitle());
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_UPDATE_LOGIN");
    }

    [Theory]
    [InlineData("ZEDMSME000009")] // inactive
    [InlineData("ZEDMSME000007")] // not an MSME account
    [InlineData("ZEDMSME000404")] // unknown
    public async Task Only_active_MSME_accounts_can_be_signed_in(string zedId)
    {
        var (_, r) = await SignIn(zedId, "tok");
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_UPDATE_LOGIN");
    }

    [Theory]
    [InlineData("ADMIN")]
    [InlineData("ZEDMSME1' OR 1=1")]
    [InlineData("")]
    public async Task Malformed_application_numbers_never_reach_UBP(string app)
    {
        var (_, r) = await SignIn(app, "tok");
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Empty(_verifier.Calls);
    }

    [Theory]
    [InlineData("https://evil.example/phish")]
    [InlineData("http://ubp.ubputl.com/plain-http")]
    [InlineData("https://ubputl.com.evil.example/")]
    [InlineData("javascript:alert(1)")]
    public async Task The_back_link_only_points_to_Udyami_Bharat(string returnUrl)
    {
        _verifier.Result = new(true, returnUrl, "OK", "{}");
        var (_, r) = await SignIn("ZEDMSME000001", "tok");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal(JsonValueKind.Null, (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("returnUrl").ValueKind);
    }

    [Fact]
    public async Task It_is_off_unless_configured()
    {
        var browser = await _host.CreateBrowserAsync();
        var r = await browser.PostAsJsonAsync("/api/msme/auth/udyami-bharat", new { applicationNo = "ZEDMSME000001", token = "tok" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Contains("not available", await r.ProblemTitle());
    }
}
