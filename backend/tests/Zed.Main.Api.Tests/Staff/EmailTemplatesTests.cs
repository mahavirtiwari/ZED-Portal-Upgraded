using System.Net;
using System.Net.Http.Json;
using Zed.Core.Email;
using Zed.Portal.Features.Staff.Settings;

namespace Zed.Main.Api.Tests.Staff;

public sealed class EmailTemplatesTests : IDisposable
{
    private const string Url = "/api/staff/settings/email-templates";
    private readonly TestHost _host = new();

    public EmailTemplatesTests() => UsersMastersLogin.Setup(_host);

    public void Dispose() => _host.Dispose();

    private void Stored(params EmailTemplateOverride[] rows) =>
        _host.Sql.Queries["SELECT TemplateKey, Enabled, Subject, BodyHtml, UpdatedBy, UpdatedOn FROM dbo.V4EmailTemplates"] = _ => rows;

    private List<(string Name, object? Args)> Writes() =>
        _host.Sql.Calls.Where(c => c.Name.StartsWith("MERGE dbo.V4EmailTemplates") || c.Name.StartsWith("DELETE FROM dbo.V4EmailTemplates")).ToList();

    private static EmailTemplateOverride Row(string key, bool enabled = true, string? subject = null, string? body = null) =>
        new(key, enabled, subject, body, "ADMIN1", new DateTime(2026, 10, 1, 10, 0, 0));

    private Task<HttpResponseMessage> ContactAsync(HttpClient client) =>
        client.PostAsJsonAsync("/api/contact", new { name = "Ravi <b>", mobile = "9999999999", email = "ravi@example.test", query = "Hello" });

    [Fact]
    public async Task Only_the_Admin_sees_and_changes_the_templates()
    {
        var anonymous = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(Url)).StatusCode);
        foreach (var user in new[] { "MASTER1", "AGENCY1", "SUPER1" })
        {
            var other = await UsersMastersLogin.SignInAsync(_host, user);
            Assert.Equal(HttpStatusCode.Forbidden, (await other.GetAsync(Url)).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await other.PutAsJsonAsync($"{Url}/ContactQueryEmail", new { enabled = false })).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await other.DeleteAsync($"{Url}/ContactQueryEmail")).StatusCode);
        }
        Assert.Empty(Writes());
    }

    [Fact]
    public async Task Lists_the_portal_mails_and_the_main_database_mails()
    {
        Stored(Row("ContactQueryEmail", enabled: false), Row("db:SP_SEND_MAIL_AUTO_ALLOT_AGENCY", subject: "Allotted: {{StandardSubject}}"));
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var items = (await admin.GetFromJsonAsync<List<EmailTemplatesController.TemplateItem>>(Url))!;

        var contact = items.Single(i => i.Key == "ContactQueryEmail");
        Assert.Equal("Contact Query", contact.Name);
        Assert.False(contact.Enabled);
        Assert.True(contact.Customised);
        Assert.Equal(["Name", "Mobile", "Email", "Query", "ZedId", "StandardSubject", "StandardBody"], contact.Placeholders);
        Assert.DoesNotContain(items, i => i.Key is "EmailLayout" or "StaffSchemeDetailTable" or "ConsultancyCoAllotmentDates" or "_Imports");
        Assert.Contains(items, i => i.Key == "DesktopAssessment.NcRaised" && i.Placeholders.Contains("Certification"));
        Assert.Contains(items, i => i.Key == "MsmeResetPasswordEmail" && i.Group == "MSME app");

        var database = items.Where(i => i.Database).ToList();
        Assert.Equal(EmailTemplatesController.DbMailers[Zed.Core.Http.PortalSystem.Main].Select(p => "db:" + p), database.Select(d => d.Key));
        var allot = database.Single(d => d.Key == "db:SP_SEND_MAIL_AUTO_ALLOT_AGENCY");
        Assert.True(allot.Enabled);
        Assert.Equal("Allotted: {{StandardSubject}}", allot.Subject);
        Assert.Equal(["StandardSubject", "StandardBody"], allot.Placeholders);
        Assert.DoesNotContain(items, i => i.Key == "db:SP_SEND_AUTO_MAIL_TO_MSME_FOR_CO_ACCEPT_QC");
        Assert.True(items.All(i => i.Customised == (i.Key is "ContactQueryEmail" or "db:SP_SEND_MAIL_AUTO_ALLOT_AGENCY")));
    }

    [Fact]
    public async Task Opens_the_standard_mail_with_its_fields_as_placeholders()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var contact = (await admin.GetFromJsonAsync<EmailTemplatesController.TemplateDetails>($"{Url}/ContactQueryEmail"))!;
        Assert.True(contact.StandardBody);
        Assert.Contains("<b>Name:</b> {{Name}}", contact.BodyHtml);
        Assert.Contains("{{Query}}", contact.BodyHtml);

        var database = (await admin.GetFromJsonAsync<EmailTemplatesController.TemplateDetails>($"{Url}/db:SP_SEND_MAIL_AUTO_ALLOT_AGENCY"))!;
        Assert.Equal("{{StandardBody}}", database.BodyHtml);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync($"{Url}/NoSuchEmail")).StatusCode);
    }

    [Fact]
    public async Task Saves_checked_templates_and_resets_them()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");

        var unknown = await admin.PutAsJsonAsync($"{Url}/ContactQueryEmail", new { enabled = true, subject = "Query from {{Nme}}" });
        Assert.Equal("{{Nme}} is not a field of this e-mail.", await unknown.ProblemTitle());
        var script = await admin.PutAsJsonAsync($"{Url}/ContactQueryEmail", new { enabled = true, bodyHtml = "<p onclick=\"x()\">{{Name}}</p>" });
        Assert.Equal("Scripts are not allowed in e-mails.", await script.ProblemTitle());
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PutAsJsonAsync($"{Url}/db:SP_NOT_A_MAILER", new { enabled = false })).StatusCode);
        Assert.Empty(Writes());

        // The standard text as it was offered is not stored.
        var standard = (await admin.GetFromJsonAsync<EmailTemplatesController.TemplateDetails>($"{Url}/ContactQueryEmail"))!.BodyHtml;
        (await admin.PutAsJsonAsync($"{Url}/ContactQueryEmail", new { enabled = false, subject = " Query: {{Name}} ", bodyHtml = standard })).EnsureSuccessStatusCode();
        var merge = Assert.Single(Writes());
        Assert.Equal("ContactQueryEmail", FakeSql.Arg(merge.Args, "TemplateKey"));
        Assert.Equal("False", FakeSql.Arg(merge.Args, "Enabled"));
        Assert.Equal("Query: {{Name}}", FakeSql.Arg(merge.Args, "Subject"));
        Assert.Null(FakeSql.Arg(merge.Args, "BodyHtml"));
        Assert.Equal("ADMIN1", FakeSql.Arg(merge.Args, "UpdatedBy"));

        (await admin.DeleteAsync($"{Url}/ContactQueryEmail")).EnsureSuccessStatusCode();
        var delete = Writes().Last();
        Assert.StartsWith("DELETE", delete.Name);
        Assert.Equal("ContactQueryEmail", FakeSql.Arg(delete.Args, "TemplateKey"));
    }

    [Fact]
    public async Task A_switched_off_mail_is_not_sent()
    {
        Stored(Row("ContactQueryEmail", enabled: false));
        (await ContactAsync(await _host.CreateBrowserAsync())).EnsureSuccessStatusCode();
        Assert.Empty(_host.Email.Sent);
    }

    [Fact]
    public async Task The_Admins_subject_and_text_are_sent_with_the_fields_filled()
    {
        Stored(Row("ContactQueryEmail", subject: "{{StandardSubject}} ({{Mobile}})", body: "<p>New query from {{Name}}:</p>{{StandardBody}}"));
        (await ContactAsync(await _host.CreateBrowserAsync())).EnsureSuccessStatusCode();
        var mail = Assert.Single(_host.Email.Sent);
        Assert.Equal("ZED Query from Ravi <b> (9999999999)", mail.Subject);
        Assert.StartsWith("<p>New query from Ravi &lt;b&gt;:</p>", mail.HtmlBody);
        Assert.Contains("<b>Mobile Number:</b> 9999999999", mail.HtmlBody);
    }

    [Fact]
    public async Task Without_a_saved_template_the_standard_mail_is_sent()
    {
        (await ContactAsync(await _host.CreateBrowserAsync())).EnsureSuccessStatusCode();
        var mail = Assert.Single(_host.Email.Sent);
        Assert.Equal("ZED Query from Ravi <b>", mail.Subject);
        Assert.StartsWith("<div><b>Name:</b> Ravi &lt;b&gt;</div>", mail.HtmlBody);
    }
}
