using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Zed.Core.Email;
using Zed.Core.Http;
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

    /// <summary>The test host with a mail server configuration (the fake sender still takes the mails).</summary>
    private WebApplicationFactory<Program> WithMailServer() => _host.WithWebHostBuilder(b => b
        .UseSetting("Email:PickupDirectory", "")
        .UseSetting("Email:Profiles:Default:Host", "smtp.zed.test")
        .UseSetting("Email:Profiles:Default:Port", "587")
        .UseSetting("Email:Profiles:Default:From", "ZED <noreply@zed.test>")
        .UseSetting("Email:Profiles:Default:UserName", "noreply@zed.test")
        .UseSetting("Email:Profiles:Default:Password", "Secret#1")
        .UseSetting("Email:Profiles:Otp:Host", "smtp-otp.zed.test")
        .UseSetting("Email:Profiles:Otp:From", "otp@zed.test")
        .UseSetting("Email:RedirectAllTo", "testers@zed.test"));

    private void Servers(params SmtpServerRow[] rows) =>
        _host.Sql.Queries["SELECT Module, Host, Port, UseStartTls, FromAddress, UserName, PasswordProtected"] = _ => rows;

    private List<(string Name, object? Args)> ServerWrites() =>
        _host.Sql.Calls.Where(c => c.Name.StartsWith("MERGE dbo.V4SmtpServers") || c.Name.StartsWith("DELETE FROM dbo.V4SmtpServers")).ToList();

    private static async Task<EmailSettingsController.MailServerInfo> ServersOf(HttpClient admin)
    {
        var r = await admin.GetAsync("/api/staff/settings/email/servers");
        r.EnsureSuccessStatusCode();
        var json = await r.Content.ReadAsStringAsync();
        Assert.DoesNotContain("Secret#1", json);
        Assert.DoesNotContain("dpapi1:", json);
        return System.Text.Json.JsonSerializer.Deserialize<EmailSettingsController.MailServerInfo>(json,
            new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web))!;
    }

    [Fact]
    public async Task Only_the_Admin_sees_and_changes_the_mail_servers()
    {
        var app = WithMailServer();
        foreach (var user in new[] { "MASTER1", "AGENCY1", "SUPER1" })
        {
            var other = await ReviewTestHost.SignInAsync(app, user);
            Assert.Equal(HttpStatusCode.Forbidden, (await other.GetAsync("/api/staff/settings/email/servers")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await other.PutAsJsonAsync("/api/staff/settings/email/servers/Payment",
                new { host = "smtp.evil.test", port = 587, from = "x@evil.test" })).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await other.DeleteAsync("/api/staff/settings/email/servers/Default")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await other.PostAsJsonAsync("/api/staff/settings/email/test", new { to = "a@zed.test" })).StatusCode);
        }
        Assert.Empty(ServerWrites());
        Assert.Empty(_host.Email.Sent);
    }

    [Fact]
    public async Task Lists_every_module_with_the_server_its_mails_use_and_no_password()
    {
        var admin = await ReviewTestHost.SignInAsync(WithMailServer(), "ADMIN1");
        var info = await ServersOf(admin);
        Assert.Equal(MailModules.All.Select(m => m.Key), info.Modules.Select(m => m.Key));
        Assert.Equal(["Registration", "OTP", "Payment confirmation", "Document upload"],
            info.Modules.Where(m => m.Key is "Registration" or "Otp" or "Payment" or "DocumentUpload").Select(m => m.Label));
        // Nothing saved yet: the server file's profile of the module, else its Default.
        var otp = info.Modules.Single(m => m.Key == "Otp");
        Assert.Equal(("ServerFile", "smtp-otp.zed.test"), (otp.Uses, otp.Configured!.Host));
        var payment = info.Modules.Single(m => m.Key == "Payment");
        Assert.Equal("ServerFileDefault", payment.Uses);
        Assert.Null(payment.Saved);
        var def = info.Modules.Single(m => m.Key == "Default");
        Assert.True(def.Configured!.PasswordSet);
        Assert.Equal("testers@zed.test", info.RedirectAllTo);

        // A saved Default takes over every module without its own; a module's own wins.
        Servers(new SmtpServerRow("Default", "smtp.office365.com", 587, true, "ZED <zed@zed.test>", "zed@zed.test", SmtpSecret.Protect("Secret#1")),
                new SmtpServerRow("Payment", "smtp.pay.test", 465, false, "pay@zed.test", null, null));
        info = await ServersOf(await ReviewTestHost.SignInAsync(WithMailServer(), "ADMIN1"));
        Assert.Equal("Default", info.Modules.Single(m => m.Key == "Otp").Uses);
        payment = info.Modules.Single(m => m.Key == "Payment");
        Assert.Equal(("Module", "smtp.pay.test", 465, false, false), (payment.Uses, payment.Saved!.Host, payment.Saved.Port, payment.Saved.StartTls, payment.Saved.PasswordSet));
        Assert.True(info.Modules.Single(m => m.Key == "Default").Saved!.PasswordSet);
    }

    [Fact]
    public async Task Saves_a_module_server_with_its_password_encrypted()
    {
        var admin = await ReviewTestHost.SignInAsync(WithMailServer(), "ADMIN1");
        async Task<string?> Refusal(object body, string module = "Registration") =>
            await (await admin.PutAsJsonAsync($"/api/staff/settings/email/servers/{module}", body)).ProblemTitle();

        Assert.Equal("Unknown module.", await Refusal(new { host = "smtp.zed.test", from = "a@zed.test" }, "Marketing"));
        Assert.Equal("Registration: please enter the mail server (host name).", await Refusal(new { host = " ", from = "a@zed.test" }));
        Assert.Equal("Registration: enter the host name only, e.g. smtp.office365.com.", await Refusal(new { host = "https://smtp.zed.test", from = "a@zed.test" }));
        Assert.Equal("Registration: the port must be between 1 and 65535.", await Refusal(new { host = "smtp.zed.test", port = 0, from = "a@zed.test" }));
        Assert.Equal("Registration: please enter the From address.", await Refusal(new { host = "smtp.zed.test" }));
        Assert.StartsWith("Registration: 'nobody' is not a valid From address", await Refusal(new { host = "smtp.zed.test", from = "nobody" }));
        // Microsoft 365 refuses a display name as the sign-in name; another server may accept any name.
        Assert.Equal("Registration: smtp.office365.com only accepts the full mailbox address as the sign-in name (e.g. reg@zed.test).",
            await Refusal(new { host = "smtp.office365.com", from = "ZED <reg@zed.test>", userName = "ZED Staging" }));
        Assert.Empty(ServerWrites());

        (await admin.PutAsJsonAsync("/api/staff/settings/email/servers/registration", new
        {
            host = " smtp.office365.com ", port = 587, startTls = true, from = "ZED Registration <reg@zed.test>", userName = "reg@zed.test", password = "Pass#Word1",
        })).EnsureSuccessStatusCode();
        var merge = Assert.Single(ServerWrites());
        Assert.Equal(("Registration", "smtp.office365.com", "587", "ZED Registration <reg@zed.test>", "reg@zed.test", "False"),
            (FakeSql.Arg(merge.Args, "Module"), FakeSql.Arg(merge.Args, "Host"), FakeSql.Arg(merge.Args, "Port"), FakeSql.Arg(merge.Args, "FromAddress"),
             FakeSql.Arg(merge.Args, "UserName"), FakeSql.Arg(merge.Args, "KeepPassword")));
        var stored = FakeSql.Arg(merge.Args, "PasswordProtected")!;
        Assert.StartsWith("dpapi1:", stored);
        Assert.DoesNotContain("Pass#Word1", stored);
        Assert.Equal("Pass#Word1", SmtpSecret.Unprotect(stored, "Registration"));

        // An empty password keeps the saved one; ClearPassword removes it.
        (await admin.PutAsJsonAsync("/api/staff/settings/email/servers/Registration", new { host = "smtp.office365.com", from = "reg@zed.test", password = "" }))
            .EnsureSuccessStatusCode();
        Assert.Equal("True", FakeSql.Arg(ServerWrites()[^1].Args, "KeepPassword"));
        (await admin.PutAsJsonAsync("/api/staff/settings/email/servers/Registration", new { host = "smtp.office365.com", from = "reg@zed.test", clearPassword = true }))
            .EnsureSuccessStatusCode();
        var cleared = ServerWrites()[^1];
        Assert.Equal(("False", null), (FakeSql.Arg(cleared.Args, "KeepPassword"), FakeSql.Arg(cleared.Args, "PasswordProtected")));

        var r = await admin.DeleteAsync("/api/staff/settings/email/servers/Registration");
        r.EnsureSuccessStatusCode();
        Assert.Equal("Registration: mail server cleared; its mails use Default.", (await r.Content.ReadFromJsonAsync<MessageResponse>())!.Message);
        Assert.Equal("Registration", FakeSql.Arg(ServerWrites()[^1].Args, "Module"));

        // Another mail server may take any sign-in name.
        (await admin.PutAsJsonAsync("/api/staff/settings/email/servers/Payment", new { host = "smtp.zed.test", from = "pay@zed.test", userName = "zedsender" }))
            .EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task Sends_a_test_mail_of_a_module_now_and_says_where_it_went()
    {
        var admin = await ReviewTestHost.SignInAsync(WithMailServer(), "ADMIN1");
        Assert.Equal("Please enter the address to send the test mail to.",
            await (await admin.PostAsJsonAsync("/api/staff/settings/email/test", new { to = " " })).ProblemTitle());
        Assert.Equal("'nobody' is not a valid e-mail address.",
            await (await admin.PostAsJsonAsync("/api/staff/settings/email/test", new { to = "nobody" })).ProblemTitle());
        Assert.Equal("Unknown module.",
            await (await admin.PostAsJsonAsync("/api/staff/settings/email/test", new { to = "me@zed.test", module = "Marketing" })).ProblemTitle());
        Assert.Empty(_host.Email.Sent);

        var r = await admin.PostAsJsonAsync("/api/staff/settings/email/test", new { to = "me@zed.test", module = "Payment" });
        r.EnsureSuccessStatusCode();
        Assert.Equal("Test mail sent. On this server every mail goes to testers@zed.test, so look for it there.",
            (await r.Content.ReadFromJsonAsync<MessageResponse>())!.Message);
        var mail = Assert.Single(_host.Email.Sent);
        Assert.Equal(("me@zed.test", "ZED portal: test mail (Payment confirmation)", EmailProfiles.Payment), (mail.To, mail.Subject, mail.Profile));
    }

    [Fact]
    public async Task Answers_with_the_mail_server_error()
    {
        var admin = await ReviewTestHost.SignInAsync(WithMailServer(), "ADMIN1");
        _host.Email.Fail = new InvalidOperationException("535: 5.7.139 Authentication unsuccessful", new Exception("inner detail"));
        var r = await admin.PostAsJsonAsync("/api/staff/settings/email/test", new { to = "me@zed.test" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Equal("The test mail could not be sent: 535: 5.7.139 Authentication unsuccessful (inner detail)", await r.ProblemTitle());
    }
}
