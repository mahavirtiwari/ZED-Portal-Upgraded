using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.RegularExpressions;
using Zed.Core.Content;
using Zed.Core.Http;
using Zed.Portal.Features.Staff.Settings;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>
/// Admin → Texts → Page wording (2026-11-19, the user: "All page wording"): the catalogue written by
/// frontend/tools/extract-texts.mjs, the Admin's plain-text wording (dbo.V4ContentBlocks) and api/content.
/// </summary>
public sealed partial class PageTextsTests : IDisposable
{
    private const string Url = "/api/staff/settings/page-texts";
    private const string Title = "staff.agencies.title";
    private const string Showing = "msme.dashboard.welcome"; // "Welcome, {name}"
    private readonly TestHost _host = new();

    public PageTextsTests() => UsersMastersLogin.Setup(_host);

    public void Dispose() => _host.Dispose();

    private void Stored(params ContentBlockOverride[] rows) =>
        _host.Sql.Queries["SELECT BlockKey, Enabled, BodyHtml, UpdatedBy, UpdatedOn FROM dbo.V4ContentBlocks"] = _ => rows;

    private List<(string Name, object? Args)> Writes() =>
        _host.Sql.Calls.Where(c => c.Name.StartsWith("MERGE dbo.V4ContentBlocks") || c.Name.StartsWith("DELETE FROM dbo.V4ContentBlocks")).ToList();

    private static ContentBlockOverride Row(string key, string? body, bool enabled = true) => new(key, enabled, body, "ADMIN1", new DateTime(2026, 11, 19, 4, 30, 0));

    [Fact]
    public void The_catalogue_lists_each_key_once_with_its_standard_wording_and_values()
    {
        var texts = PageTextCatalogue.Texts;
        Assert.NotEmpty(texts);
        Assert.DoesNotContain(texts.GroupBy(t => t.Key, StringComparer.OrdinalIgnoreCase), g => g.Count() > 1);
        var blocks = ContentCatalogue.Blocks.Select(b => b.Key).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var t in texts)
        {
            Assert.Matches(KeyPattern(), t.Key);
            Assert.DoesNotContain(t.Key, blocks);
            Assert.False(string.IsNullOrWhiteSpace(t.Standard), t.Key);
            Assert.Contains(t.Kind, new[] { "heading", "label", "button", "note", "placeholder", "tooltip", "message", "text" });
            Assert.Equal(t.Key.Split('.')[0], t.Portal);
            Assert.Equal(t.Key.Split('.')[1], t.Page);
            Assert.Equal(PageTextCatalogue.Placeholders(t.Standard).Order(), t.Placeholders.Order());
            // The standard wording passes the checks of the Admin's.
            Assert.Null(PageTextCatalogue.Problem(t, PageTextCatalogue.Clean(t.Standard)));
        }
        // The pilot pages are in it; MSME wording is of the main build only.
        Assert.Equal("{agencies}", texts.Single(t => t.Key == Title).Standard);
        Assert.NotNull(PageTextCatalogue.Find(PortalSystem.Consultancy, Title));
        Assert.Null(PageTextCatalogue.Find(PortalSystem.Consultancy, Showing));
        Assert.NotNull(PageTextCatalogue.Find(PortalSystem.Main, Showing));
    }

    [Fact]
    public void Cleans_the_wording_to_plain_text()
    {
        Assert.Equal("Agencies of the portal", PageTextCatalogue.Clean("  Agencies \t of  the portal\u0007 "));
        Assert.Equal("Line one\n\nLine two", PageTextCatalogue.Clean("Line one \r\n\r\n\r\n\r\n Line two"));
    }

    [Fact]
    public async Task Only_the_Admin_sees_and_changes_the_page_wording()
    {
        var anonymous = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(Url)).StatusCode);
        foreach (var user in new[] { "MASTER1", "AGENCY1", "SUPER1" })
        {
            var other = await UsersMastersLogin.SignInAsync(_host, user);
            Assert.Equal(HttpStatusCode.Forbidden, (await other.GetAsync(Url)).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await other.PutAsJsonAsync($"{Url}/{Title}", new { text = "X" })).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await other.DeleteAsync($"{Url}/{Title}")).StatusCode);
        }
        Assert.Empty(Writes());
    }

    [Fact]
    public async Task Lists_every_wording_of_the_portal_with_the_Admins_and_the_last_change()
    {
        Stored(Row(Title, "Agencies"), Row("msme.registration.pledge", "<p>Not page wording</p>"));
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var items = (await admin.GetFromJsonAsync<List<PageTextsController.PageTextItem>>(Url))!;

        Assert.Equal(PageTextCatalogue.For(PortalSystem.Main).Select(t => t.Key), items.Select(i => i.Key));
        var title = items.Single(i => i.Key == Title);
        Assert.Equal("Agencies", title.Text);
        Assert.Equal("{agencies}", title.Standard);
        Assert.Equal(("staff", "agencies", "Agencies"), (title.Portal, title.Page, title.PageName));
        Assert.Equal("ADMIN1", title.UpdatedBy);
        Assert.Equal(DateTimeKind.Utc, title.UpdatedOn!.Value.Kind);
        var welcome = items.Single(i => i.Key == Showing);
        Assert.Null(welcome.Text);
        Assert.Null(welcome.UpdatedOn);
        Assert.Equal(["name"], welcome.Placeholders);
        Assert.DoesNotContain(items, i => i.Key == "msme.registration.pledge");
    }

    [Fact]
    public async Task Saves_checked_plain_text_and_goes_back_to_the_standard_wording()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");

        Assert.Equal(HttpStatusCode.NotFound, (await admin.PutAsJsonAsync($"{Url}/staff.no.such", new { text = "X" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PutAsJsonAsync($"{Url}/msme.registration.pledge", new { text = "X" })).StatusCode);
        Assert.Equal("Use plain text: HTML tags are not allowed in page wording.",
            await (await admin.PutAsJsonAsync($"{Url}/{Showing}", new { text = "Hello <b>{name}</b>" })).ProblemTitle());
        Assert.Equal("{unit} is not a value of this wording. Values of this wording: {name}.",
            await (await admin.PutAsJsonAsync($"{Url}/{Showing}", new { text = "Hello {unit}" })).ProblemTitle());
        Assert.Equal("Enter the wording, or use Reset to show the standard wording.",
            await (await admin.PutAsJsonAsync($"{Url}/{Showing}", new { text = "  " })).ProblemTitle());
        Assert.Equal("The wording is too long (at most 300 characters).",
            await (await admin.PutAsJsonAsync($"{Url}/staff.agencies.addButton", new { text = new string('x', 301) })).ProblemTitle());
        Assert.Empty(Writes());

        var saved = await admin.PutAsJsonAsync($"{Url}/{Showing}", new { text = "  Hello,\t{name} " });
        saved.EnsureSuccessStatusCode();
        Assert.Equal("Hello, {name}", (await saved.Content.ReadFromJsonAsync<PageTextsController.PageTextItem>())!.Text);
        var merge = Assert.Single(Writes());
        Assert.Equal(Showing, FakeSql.Arg(merge.Args, "BlockKey"));
        Assert.Equal("True", FakeSql.Arg(merge.Args, "Enabled"));
        Assert.Equal("Hello, {name}", FakeSql.Arg(merge.Args, "BodyHtml"));
        Assert.Equal("ADMIN1", FakeSql.Arg(merge.Args, "UpdatedBy"));

        // The standard wording is not stored: saving it is a reset.
        var standard = await admin.PutAsJsonAsync($"{Url}/{Showing}", new { text = "Welcome, {name}" });
        Assert.Null((await standard.Content.ReadFromJsonAsync<PageTextsController.PageTextItem>())!.Text);
        Assert.StartsWith("DELETE", Writes().Last().Name);

        (await admin.DeleteAsync($"{Url}/{Title}")).EnsureSuccessStatusCode();
        Assert.Equal(Title, FakeSql.Arg(Writes().Last().Args, "BlockKey"));
    }

    [Fact]
    public async Task Api_content_adds_the_changed_wording_of_this_portal_and_answers_304_while_nothing_changed()
    {
        Stored(Row(Title, "Agencies"), Row(Showing, "Hello, {name}"), Row("staff.agencies.addButton", "Hidden", enabled: false),
            Row("staff.not.in.catalogue", "Unknown"));
        var browser = await _host.CreateBrowserAsync();
        var response = await browser.GetAsync("/api/content");
        response.EnsureSuccessStatusCode();
        var texts = (await response.Content.ReadFromJsonAsync<List<ContentText>>())!;

        // The Texts first (as before), then the changed page wording: plain text, never the standard wording of the others.
        Assert.Equal(ContentCatalogue.For(PortalSystem.Main).Count(b => b.Channel == ContentChannel.Web) + 2, texts.Count);
        Assert.Equal([Showing, Title], texts.TakeLast(2).Select(t => t.Key));
        Assert.Equal("Agencies", texts.Single(t => t.Key == Title).Html);
        Assert.DoesNotContain(texts, t => t.Key is "staff.agencies.addButton" or "staff.not.in.catalogue");

        var etag = response.Headers.ETag;
        Assert.NotNull(etag);
        var again = new HttpRequestMessage(HttpMethod.Get, "/api/content");
        again.Headers.IfNoneMatch.Add(etag!);
        var notModified = await browser.SendAsync(again);
        Assert.Equal(HttpStatusCode.NotModified, notModified.StatusCode);

        var other = new HttpRequestMessage(HttpMethod.Get, "/api/content");
        other.Headers.IfNoneMatch.Add(new EntityTagHeaderValue("\"0000\""));
        Assert.Equal(HttpStatusCode.OK, (await browser.SendAsync(other)).StatusCode);
    }

    [GeneratedRegex(@"^(msme|staff|public|common)\.[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$")] private static partial Regex KeyPattern();
}
