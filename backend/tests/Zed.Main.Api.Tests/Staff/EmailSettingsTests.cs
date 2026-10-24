using System.Net;
using System.Net.Http.Json;
using Zed.Core.Email;
using Zed.Portal.Features.Staff.Settings;

namespace Zed.Main.Api.Tests.Staff;

public sealed class EmailSettingsTests : IDisposable
{
    private readonly TestHost _host = new();

    public EmailSettingsTests() => UsersMastersLogin.Setup(_host);

    public void Dispose() => _host.Dispose();

    private void Stored(params (string Key, string Value)[] rows) =>
        _host.Sql.Queries["SELECT SettingKey, SettingValue FROM dbo.V4Settings"] = _ => rows.Select(r => new { SettingKey = r.Key, SettingValue = r.Value });

    private List<(string Name, object? Args)> Writes() =>
        _host.Sql.Calls.Where(c => c.Name.StartsWith("MERGE dbo.V4Settings") || c.Name.StartsWith("DELETE FROM dbo.V4Settings")).ToList();

    [Fact]
    public async Task Only_the_Admin_sees_and_changes_the_addresses()
    {
        var anonymous = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/staff/settings/email")).StatusCode);
        foreach (var user in new[] { "MASTER1", "AGENCY1", "SUPER1" })
        {
            var other = await UsersMastersLogin.SignInAsync(_host, user);
            Assert.Equal(HttpStatusCode.Forbidden, (await other.GetAsync("/api/staff/settings/email")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await other.PutAsJsonAsync("/api/staff/settings/email",
                new { values = new Dictionary<string, string> { [EmailAddresses.ContactInbox] = "a@zed.test" } })).StatusCode);
        }
        Assert.Empty(Writes());
    }

    [Fact]
    public async Task Lists_the_main_portal_addresses_with_their_configured_defaults()
    {
        Stored((EmailAddresses.DbMailBcc, "monitor@zed.test"));
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var items = (await admin.GetFromJsonAsync<List<EmailSettingsController.EmailSettingItem>>("/api/staff/settings/email"))!;
        Assert.Equal(EmailAddresses.All.Select(a => a.Key), items.Select(i => i.Key));
        Assert.Equal("zed.support@example.test", items.Single(i => i.Key == EmailAddresses.ContactInbox).Default);
        Assert.Equal("zed@qcin.org", items.Single(i => i.Key == EmailAddresses.ZedTeamInbox).Default);
        var bcc = items.Single(i => i.Key == EmailAddresses.DbMailBcc);
        Assert.True(bcc.Database);
        Assert.Equal("monitor@zed.test", bcc.Value);
    }

    [Fact]
    public async Task Saves_checked_lists_and_clears_back_to_the_configuration()
    {
        Stored((EmailAddresses.RegistrationCc, "old@zed.test"));
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");

        var bad = await admin.PutAsJsonAsync("/api/staff/settings/email",
            new { values = new Dictionary<string, string> { [EmailAddresses.ContactInbox] = "a@zed.test, not-an-address" } });
        Assert.Equal("Contact ZED queries: 'not-an-address' is not a valid e-mail address.", await bad.ProblemTitle());
        var unknown = await admin.PutAsJsonAsync("/api/staff/settings/email", new { values = new Dictionary<string, string> { ["Email.Other"] = "a@zed.test" } });
        Assert.Equal(HttpStatusCode.BadRequest, unknown.StatusCode);
        Assert.Empty(Writes());

        var r = await admin.PutAsJsonAsync("/api/staff/settings/email", new
        {
            values = new Dictionary<string, string?>
            {
                [EmailAddresses.ContactInbox] = " queries@zed.test ;help@zed.test ",
                [EmailAddresses.RegistrationCc] = "",
                [EmailAddresses.ZedTeamInbox] = null,
            },
        });
        r.EnsureSuccessStatusCode();
        var writes = Writes();
        Assert.Equal(2, writes.Count);
        var merge = writes.Single(w => w.Name.StartsWith("MERGE"));
        Assert.Equal(EmailAddresses.ContactInbox, FakeSql.Arg(merge.Args, "SettingKey"));
        Assert.Equal("queries@zed.test; help@zed.test", FakeSql.Arg(merge.Args, "SettingValue"));
        var delete = writes.Single(w => w.Name.StartsWith("DELETE"));
        Assert.Equal(EmailAddresses.RegistrationCc, FakeSql.Arg(delete.Args, "SettingKey"));
    }

    [Fact]
    public async Task Contact_queries_go_to_the_Admin_inbox()
    {
        Stored((EmailAddresses.ContactInbox, "queries@zed.test; help@zed.test"));
        var client = await _host.CreateBrowserAsync();
        (await client.PostAsJsonAsync("/api/contact", new { name = "Ravi", mobile = "9999999999", email = "ravi@example.test", query = "Hello" }))
            .EnsureSuccessStatusCode();
        Assert.Equal("queries@zed.test; help@zed.test", Assert.Single(_host.Email.Sent).To);
    }
}
