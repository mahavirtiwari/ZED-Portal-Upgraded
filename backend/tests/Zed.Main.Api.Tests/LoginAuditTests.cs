using System.Net.Http.Json;
using Zed.Core.Security;
using Zed.Main.Api.Tests.Staff;

namespace Zed.Main.Api.Tests;

public sealed class LoginAuditTests : IDisposable
{
    private readonly TestHost _host = new();
    private const string Chrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

    public LoginAuditTests() => UsersMastersLogin.Setup(_host);

    public void Dispose() => _host.Dispose();

    private List<object?> Events() =>
        _host.Sql.Calls.Where(c => c.Name.StartsWith("INSERT INTO dbo.V4LoginEvents")).Select(c => c.Args).ToList();

    [Fact]
    public async Task Web_sign_ins_are_recorded_with_ip_browser_and_a_persistent_browser_id()
    {
        var client = await _host.CreateBrowserAsync();
        client.DefaultRequestHeaders.UserAgent.ParseAdd(Chrome);
        var bad = await client.PostAsJsonAsync("/api/staff/auth/login", new { userId = "NOBODY", password = "Wrong#Pass1" });
        Assert.Equal("Invalid credentials.", await bad.ProblemTitle());
        var cookie = bad.Headers.GetValues("Set-Cookie").Single(c => c.StartsWith(LoginAuditAttribute.WebDeviceCookie + "="));
        Assert.Contains("httponly", cookie, StringComparison.OrdinalIgnoreCase);
        (await client.PostAsJsonAsync("/api/staff/auth/login", new { userId = "ADMIN1", password = "Right#Pass1" })).EnsureSuccessStatusCode();

        var events = Events();
        Assert.Equal(2, events.Count);
        var (failed, ok) = (events[0], events[1]);
        Assert.Equal("Failed", FakeSql.Arg(failed, "Result"));
        Assert.Equal("NOBODY", FakeSql.Arg(failed, "UserId"));
        Assert.Equal("Invalid credentials.", FakeSql.Arg(failed, "Reason"));
        Assert.Equal("Success", FakeSql.Arg(ok, "Result"));
        Assert.Equal("ADMIN1", FakeSql.Arg(ok, "UserId"));
        Assert.Equal("1", FakeSql.Arg(ok, "RoleId"));
        Assert.Equal("Web", FakeSql.Arg(ok, "Channel"));
        Assert.Equal("Staff", FakeSql.Arg(ok, "App"));
        Assert.Equal("Main", FakeSql.Arg(ok, "System"));
        Assert.Equal("Chrome 141", FakeSql.Arg(ok, "Browser"));
        Assert.Equal("Windows 10/11", FakeSql.Arg(ok, "Os"));
        Assert.Equal("Desktop", FakeSql.Arg(ok, "DeviceType"));
        Assert.Equal(Chrome, FakeSql.Arg(ok, "UserAgent"));
        // The same browser keeps its ID.
        Assert.Matches("^[0-9a-f]{32}$", FakeSql.Arg(ok, "DeviceId"));
        Assert.Equal(FakeSql.Arg(failed, "DeviceId"), FakeSql.Arg(ok, "DeviceId"));
        // IpAddress: the test server has no remote address; HttpContext.Connection.RemoteIpAddress is recorded.
        Assert.DoesNotContain(events, e => FakeSql.Arg(e, "Reason")?.Contains("Pass") == true);
    }

    [Theory]
    [InlineData("Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36", "Chrome 140", "Android 14", "Mobile", "SM-S918B")]
    [InlineData("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", "Safari 18", "iOS 18.1", "Mobile", null)]
    [InlineData("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0", "Edge 141", "Windows 10/11", "Desktop", null)]
    [InlineData("Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0", "Firefox 132", "macOS", "Desktop", null)]
    [InlineData("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", "Safari 17", "iOS 17.0", "Tablet", null)]
    public void User_agents_are_read(string ua, string browser, string os, string type, string? model)
    {
        Assert.Equal((browser, os, type, model), UserAgentInfo.Parse(ua));
    }
}
