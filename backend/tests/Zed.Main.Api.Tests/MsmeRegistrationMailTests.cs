using System.Net;
using System.Net.Http.Json;
using Zed.Core.Email;
using Zed.Portal.Features.Msme;

namespace Zed.Main.Api.Tests;

/// <summary>The registration mails: the password goes to the unit only, and the OTP table never holds the OTP.</summary>
public sealed partial class MsmeRegistrationTests
{
    private const string Office = "office@zed.test";

    private void OfficeMailbox() =>
        _host.Sql.Queries["SELECT SettingKey, SettingValue FROM dbo.V4Settings"] = _ =>
            [new Zed.Core.Data.PortalSettings.SettingRow(EmailAddresses.RegistrationCc, Office)];

    private async Task<string> RegisterAsync()
    {
        var (client, id) = await StartAsync();
        (await client.PostAsJsonAsync($"/api/msme/registration/{id}/plant", new { plantIndex = 0, activityIndex = 0 })).EnsureSuccessStatusCode();
        (await client.PostAsJsonAsync($"/api/msme/registration/{id}/email-otp", new { email = "pledge@acme.test", confirmEmail = "pledge@acme.test" })).EnsureSuccessStatusCode();
        var otp = OtpInMail().Match(Assert.Single(_host.Email.Sent).HtmlBody).Groups[1].Value;
        (await client.PostAsJsonAsync($"/api/msme/registration/{id}/email-otp/verify", new { otp })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync($"/api/msme/registration/{id}/submit", new { acceptedDeclaration = true, tookPledge = true })).StatusCode);
        return otp;
    }

    [Fact]
    public async Task The_office_gets_its_own_copy_of_the_registration_mail_without_the_password()
    {
        OfficeMailbox();
        await RegisterAsync();

        // While the old sites are live (Dual) the procedure is given the generated password itself.
        var password = FakeSql.Arg(Assert.Single(_host.Sql.Calls, c => c.Name == "SP_MSME_INSERT_UDYAM_DETAILS").Args, "Password")!;
        var registration = _host.Email.Sent.Where(m => m.Subject.StartsWith(MsmeRegistrationService.RegistrationSubject, StringComparison.Ordinal)).ToList();
        Assert.Equal(2, registration.Count);

        var unit = Assert.Single(registration, m => m.To == "pledge@acme.test");
        Assert.Contains(password, unit.HtmlBody);
        Assert.Empty(unit.Cc ?? []);
        Assert.Empty(unit.Bcc ?? []);

        var office = Assert.Single(registration, m => m.To == Office);
        Assert.DoesNotContain(password, office.HtmlBody);
        Assert.DoesNotContain(">Password<", office.HtmlBody);
        Assert.Contains("Office copy", office.HtmlBody);
        Assert.Contains("ZEDMSME999001", office.HtmlBody);
        Assert.Equal(EmailProfiles.Registration, office.Profile);
    }

    [Fact]
    public async Task Without_an_office_mailbox_only_the_unit_is_mailed()
    {
        await RegisterAsync();
        var mail = Assert.Single(_host.Email.Sent, m => m.Subject.StartsWith(MsmeRegistrationService.RegistrationSubject, StringComparison.Ordinal));
        Assert.Equal("pledge@acme.test", mail.To);
        Assert.Contains(">Password<", mail.HtmlBody);
    }

    [Fact]
    public async Task The_legacy_otp_table_gets_a_random_value_instead_of_the_otp()
    {
        var otp = await RegisterAsync();

        var insert = Assert.Single(_host.Sql.Calls, c => c.Name.StartsWith("INSERT INTO OTP", StringComparison.Ordinal));
        var stored = FakeSql.Arg(insert.Args, "Otp")!;
        Assert.Matches("^V4![0-9A-F]{32}$", stored);
        Assert.StartsWith(MsmeRegistrationService.OtpPlaceholderPrefix, stored);
        Assert.NotEqual(otp, stored);
        Assert.Equal("pledge@acme.test", FakeSql.Arg(insert.Args, "Email"));
    }
}
