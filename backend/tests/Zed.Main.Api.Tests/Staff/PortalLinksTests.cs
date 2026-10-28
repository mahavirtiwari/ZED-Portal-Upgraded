using System.Net;
using System.Net.Http.Json;
using Zed.Core.Http;
using Zed.Portal.Features.Staff.Settings;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>Admin → Links: where "Contact ZED" goes, given to the pages by /api/config.</summary>
public sealed class PortalLinksTests : IDisposable
{
    private readonly TestHost _host = new();

    public PortalLinksTests() => UsersMastersLogin.Setup(_host);

    public void Dispose() => _host.Dispose();

    [Fact]
    public async Task Contact_ZED_goes_to_the_address_the_Admin_set()
    {
        _host.Sql.Queries["SELECT SettingKey, SettingValue FROM dbo.V4Settings"] = _ =>
            [new { SettingKey = PortalLinks.ContactUrlKey, SettingValue = "https://zed.qci.org.in/contact-us" }];
        var anonymous = await _host.CreateBrowserAsync();
        Assert.Equal("https://zed.qci.org.in/contact-us", (await anonymous.GetFromJsonAsync<SessionController.ClientConfig>("/api/config"))!.ContactUrl);
    }

    [Fact]
    public async Task Only_the_Admin_sets_a_web_address()
    {
        var anonymous = await _host.CreateBrowserAsync();
        // Nothing saved: the ZED website's contact page (the server configuration).
        Assert.Equal("https://zed-staging.qci.org.in/contact-us", (await anonymous.GetFromJsonAsync<SessionController.ClientConfig>("/api/config"))!.ContactUrl);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/staff/settings/links")).StatusCode);
        var master = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        Assert.Equal(HttpStatusCode.Forbidden, (await master.PutAsJsonAsync("/api/staff/settings/links", new { contactUrl = "https://x.example.org" })).StatusCode);

        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var current = await admin.GetFromJsonAsync<PortalLinksController.LinksResponse>("/api/staff/settings/links");
        Assert.Equal(new PortalLinksController.LinksResponse(null, "https://zed-staging.qci.org.in/contact-us"), current);

        foreach (var bad in new[] { "javascript:alert(1)", "ftp://zed.example.org", "zed contact", "https://localhost/x" })
            Assert.StartsWith("Contact ZED: ", await (await admin.PutAsJsonAsync("/api/staff/settings/links", new { contactUrl = bad })).ProblemTitle());
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.StartsWith("MERGE dbo.V4Settings"));

        (await admin.PutAsJsonAsync("/api/staff/settings/links", new { contactUrl = " https://zed.qci.org.in/contact-us " })).EnsureSuccessStatusCode();
        var merge = Assert.Single(_host.Sql.Calls, c => c.Name.StartsWith("MERGE dbo.V4Settings"));
        Assert.Equal(PortalLinks.ContactUrlKey, FakeSql.Arg(merge.Args, "SettingKey"));
        Assert.Equal("https://zed.qci.org.in/contact-us", FakeSql.Arg(merge.Args, "SettingValue"));
    }
}
