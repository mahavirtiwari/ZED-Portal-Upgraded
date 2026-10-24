using System.Net;
using System.Net.Http.Json;
using Zed.Core.Content;
using Zed.Core.Http;
using Zed.Portal.Features.Staff.Settings;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>Admin → Texts: the disclaimers, instructions, undertakings and pledges of the portal and its apps.</summary>
public sealed class TextsTests : IDisposable
{
    private const string Url = "/api/staff/settings/texts";
    private readonly TestHost _host = new();

    public TextsTests() => UsersMastersLogin.Setup(_host);

    public void Dispose() => _host.Dispose();

    private void Stored(params ContentBlockOverride[] rows) =>
        _host.Sql.Queries["SELECT BlockKey, Enabled, BodyHtml, UpdatedBy, UpdatedOn FROM dbo.V4ContentBlocks"] = _ => rows;

    private List<(string Name, object? Args)> Writes() =>
        _host.Sql.Calls.Where(c => c.Name.StartsWith("MERGE dbo.V4ContentBlocks") || c.Name.StartsWith("DELETE FROM dbo.V4ContentBlocks")).ToList();

    private static ContentBlockOverride Row(string key, bool enabled = true, string? body = null) =>
        new(key, enabled, body, "ADMIN1", new DateTime(2026, 10, 1, 10, 0, 0));

    [Fact]
    public async Task Only_the_Admin_sees_and_changes_the_texts()
    {
        var anonymous = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(Url)).StatusCode);
        foreach (var user in new[] { "MASTER1", "AGENCY1", "SUPER1" })
        {
            var other = await UsersMastersLogin.SignInAsync(_host, user);
            Assert.Equal(HttpStatusCode.Forbidden, (await other.GetAsync(Url)).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await other.GetAsync($"{Url}/msme.registration.pledge")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await other.PutAsJsonAsync($"{Url}/msme.registration.pledge", new { enabled = false })).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await other.DeleteAsync($"{Url}/msme.registration.pledge")).StatusCode);
        }
        Assert.Empty(Writes());
    }

    [Fact]
    public async Task Lists_the_web_and_app_texts_of_the_main_system()
    {
        Stored(Row("msme.login.newUserEligibility", enabled: false), Row("app.msme.payment.success", body: "<p>Paid for {{Certification}}</p>"));
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var items = (await admin.GetFromJsonAsync<List<TextsController.TextItem>>(Url))!;

        Assert.Equal(ContentCatalogue.For(PortalSystem.Main).Select(b => b.Key), items.Select(i => i.Key));
        Assert.DoesNotContain(items, i => i.Key.StartsWith("app.consultant."));
        var eligibility = items.Single(i => i.Key == "msme.login.newUserEligibility");
        Assert.Equal("Website", eligibility.Channel);
        Assert.Equal("MSME: Registration", eligibility.Group);
        Assert.False(eligibility.Enabled);
        Assert.True(eligibility.Customised);
        Assert.Equal("ADMIN1", eligibility.UpdatedBy);
        var success = items.Single(i => i.Key == "app.msme.payment.success");
        Assert.Equal("Mobile app", success.Channel);
        Assert.Equal(["Certification"], success.Placeholders);
        Assert.True(items.All(i => i.Customised == (i.Key is "msme.login.newUserEligibility" or "app.msme.payment.success")));
    }

    [Fact]
    public async Task Opens_the_standard_or_the_Admins_text()
    {
        Stored(Row("msme.registration.pledge", body: "<p>Our pledge</p>"));
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");

        var milestone = (await admin.GetFromJsonAsync<TextsController.TextDetails>($"{Url}/msme.handholding.acceptMilestone.checkbox"))!;
        Assert.Contains("Milestone-{{Milestone}}", milestone.BodyHtml);
        Assert.Equal(milestone.StandardHtml, milestone.BodyHtml);
        Assert.Equal(["Milestone"], milestone.Item.Placeholders);

        var pledge = (await admin.GetFromJsonAsync<TextsController.TextDetails>($"{Url}/msme.registration.pledge"))!;
        Assert.Equal("<p>Our pledge</p>", pledge.BodyHtml);
        Assert.Contains("our community and to our planet.", pledge.StandardHtml);

        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync($"{Url}/msme.no.such.text")).StatusCode);
        // Consultancy texts are edited on the consultancy portal.
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync($"{Url}/staff.consultancy.milestone.review.checkbox")).StatusCode);
    }

    [Fact]
    public async Task Saves_checked_texts_without_storing_the_standard_one_and_resets_them()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        const string key = "msme.handholding.acceptMilestone.checkbox";

        var unknown = await admin.PutAsJsonAsync($"{Url}/{key}", new { enabled = true, bodyHtml = "I accept Milestone {{Milestne}}" });
        Assert.Equal("{{Milestne}} is not a field of this text.", await unknown.ProblemTitle());
        var script = await admin.PutAsJsonAsync($"{Url}/{key}", new { enabled = true, bodyHtml = "<b onclick=\"x()\">I accept</b>" });
        Assert.Equal("Scripts are not allowed in texts.", await script.ProblemTitle());
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PutAsJsonAsync($"{Url}/msme.no.such.text", new { enabled = false })).StatusCode);
        Assert.Empty(Writes());

        // The standard text as it was offered is not stored: only "hidden" is.
        var standard = ContentCatalogue.Find(PortalSystem.Main, key)!.DefaultHtml;
        (await admin.PutAsJsonAsync($"{Url}/{key}", new { enabled = false, bodyHtml = standard })).EnsureSuccessStatusCode();
        var merge = Assert.Single(Writes());
        Assert.Equal(key, FakeSql.Arg(merge.Args, "BlockKey"));
        Assert.Equal("False", FakeSql.Arg(merge.Args, "Enabled"));
        Assert.Null(FakeSql.Arg(merge.Args, "BodyHtml"));
        Assert.Equal("ADMIN1", FakeSql.Arg(merge.Args, "UpdatedBy"));

        // An own text is stored, with its fields.
        (await admin.PutAsJsonAsync($"{Url}/{key}", new { enabled = true, bodyHtml = " I accept Milestone {{Milestone}} " })).EnsureSuccessStatusCode();
        Assert.Equal("I accept Milestone {{Milestone}}", FakeSql.Arg(Writes().Last().Args, "BodyHtml"));

        (await admin.DeleteAsync($"{Url}/{key}")).EnsureSuccessStatusCode();
        var delete = Writes().Last();
        Assert.StartsWith("DELETE", delete.Name);
        Assert.Equal(key, FakeSql.Arg(delete.Args, "BlockKey"));
    }
}
