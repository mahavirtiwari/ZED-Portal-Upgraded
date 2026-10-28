using System.Net;
using System.Net.Http.Json;
using Zed.Core.Http;
using Zed.Portal.Features.Staff.Settings;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>Admin → Links: the links to pages outside the portal, given to the pages by /api/config.</summary>
public sealed class PortalLinksTests : IDisposable
{
    private const string Url = "/api/staff/settings/links";
    private const string Settings = "SELECT SettingKey, SettingValue FROM dbo.V4Settings";
    private readonly TestHost _host = new();

    public PortalLinksTests() => UsersMastersLogin.Setup(_host);

    public void Dispose() => _host.Dispose();

    [Fact]
    public async Task The_pages_get_each_link_or_null_when_switched_off()
    {
        _host.Sql.Queries[Settings] = _ =>
        [
            new { SettingKey = PortalLinks.ContactUrlKey, SettingValue = "https://zed.qci.org.in/contact-us" },
            new { SettingKey = "Portal.KawachEnabled", SettingValue = "0" },
            new { SettingKey = "Portal.PlayStoreUrl", SettingValue = "https://play.google.com/store/apps/details?id=x.y" },
        ];
        var config = (await (await _host.CreateBrowserAsync()).GetFromJsonAsync<SessionController.ClientConfig>("/api/config"))!;
        Assert.Equal("https://zed.qci.org.in/contact-us", config.ContactUrl);
        Assert.Equal(PortalLinks.All.Select(l => l.Key), config.Links!.Keys);
        Assert.Equal("https://zed.qci.org.in/contact-us", config.Links["contact"]);
        Assert.Equal("https://msme.gov.in/", config.Links["ministry"]);
        Assert.Equal("https://play.google.com/store/apps/details?id=x.y", config.Links["playStore"]);
        Assert.Null(config.Links["kawach"]);
    }

    [Fact]
    public async Task Only_the_Admin_sets_a_web_address()
    {
        var anonymous = await _host.CreateBrowserAsync();
        // Nothing saved: the ZED website's contact page (the server configuration).
        Assert.Equal("https://zed-staging.qci.org.in/contact-us", (await anonymous.GetFromJsonAsync<SessionController.ClientConfig>("/api/config"))!.ContactUrl);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(Url)).StatusCode);
        var master = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        Assert.Equal(HttpStatusCode.Forbidden, (await master.PutAsJsonAsync($"{Url}/contact", new { url = "https://x.example.org" })).StatusCode);

        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var links = (await admin.GetFromJsonAsync<PortalLinksController.LinksResponse>(Url))!.Links;
        Assert.Equal(["contact", "ministry", "playStore", "appStore", "kawach", "lgd"], links.Select(l => l.Key));
        Assert.Equal(new PortalLinksController.LinkItem("contact", "Contact ZED", PortalLinks.All[0].ShownOn, null, "https://zed-staging.qci.org.in/contact-us", true), links[0]);
        Assert.All(links, l => Assert.True(l.Enabled));

        foreach (var bad in new[] { "javascript:alert(1)", "ftp://zed.example.org", "zed contact", "https://localhost/x" })
            Assert.StartsWith("Ministry of MSME: ", await (await admin.PutAsJsonAsync($"{Url}/ministry", new { url = bad })).ProblemTitle());
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PutAsJsonAsync($"{Url}/nowhere", new { url = "" })).StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.StartsWith("MERGE dbo.V4Settings"));

        (await admin.PutAsJsonAsync($"{Url}/contact", new { url = " https://zed.qci.org.in/contact-us " })).EnsureSuccessStatusCode();
        var merge = Assert.Single(_host.Sql.Calls, c => c.Name.StartsWith("MERGE dbo.V4Settings"));
        Assert.Equal(PortalLinks.ContactUrlKey, FakeSql.Arg(merge.Args, "SettingKey"));
        Assert.Equal("https://zed.qci.org.in/contact-us", FakeSql.Arg(merge.Args, "SettingValue"));
    }

    [Fact]
    public async Task The_Admin_switches_a_link_off_and_on()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var r = await admin.PutAsJsonAsync($"{Url}/appStore", new { url = "", enabled = false });
        r.EnsureSuccessStatusCode();
        Assert.Contains("ZED MSME app on the App Store saved.", await r.Content.ReadAsStringAsync());
        var off = Assert.Single(_host.Sql.Calls, c => c.Name.StartsWith("MERGE dbo.V4Settings"));
        Assert.Equal(("Portal.AppStoreEnabled", "0"), (FakeSql.Arg(off.Args, "SettingKey"), FakeSql.Arg(off.Args, "SettingValue")));

        // Switched off (the save cleared the cache): the pages get null; the Admin page shows it as disabled.
        _host.Sql.Queries[Settings] = _ => [new { SettingKey = "Portal.AppStoreEnabled", SettingValue = "0" }];
        Assert.Null((await (await _host.CreateBrowserAsync()).GetFromJsonAsync<SessionController.ClientConfig>("/api/config"))!.Links!["appStore"]);
        var links = (await admin.GetFromJsonAsync<PortalLinksController.LinksResponse>(Url))!.Links;
        Assert.False(links.Single(l => l.Key == "appStore").Enabled);
        Assert.True(links.Single(l => l.Key == "playStore").Enabled);

        // On again: the row goes (enabled is the default); leaving the switch out keeps it as it is.
        (await admin.PutAsJsonAsync($"{Url}/appStore", new { url = "", enabled = true })).EnsureSuccessStatusCode();
        var on = _host.Sql.Calls.Last(c => c.Name.StartsWith("DELETE FROM dbo.V4Settings"));
        Assert.Equal("Portal.AppStoreEnabled", FakeSql.Arg(on.Args, "SettingKey"));
        var before = _host.Sql.Calls.Count(c => FakeSql.Arg(c.Args, "SettingKey") == "Portal.AppStoreEnabled");
        (await admin.PutAsJsonAsync($"{Url}/appStore", new { url = "" })).EnsureSuccessStatusCode();
        Assert.Equal(before, _host.Sql.Calls.Count(c => FakeSql.Arg(c.Args, "SettingKey") == "Portal.AppStoreEnabled"));
    }
}
