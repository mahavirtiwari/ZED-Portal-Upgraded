using System.Net;
using System.Net.Http.Json;
using System.Text.RegularExpressions;
using Zed.Core.Security;
using Zed.TestSupport;

namespace Zed.Main.Api.Tests;

public sealed partial class MsmeRegistrationTests
{
    [GeneratedRegex("font-weight: 700;\">([^<]+)</td>")] private static partial Regex BoldCell();

    [Fact]
    public async Task After_the_old_sites_registration_stores_a_random_value_and_hashes_the_mailed_password()
    {
        var passwords = new FakePasswords().Attach(_host.Sql.Procs);
        FakePasswords.SetMode(_host.Services, PasswordMode.HashOnly);
        var (client, id) = await StartAsync();
        (await client.PostAsJsonAsync($"/api/msme/registration/{id}/plant", new { plantIndex = 0, activityIndex = 0 })).EnsureSuccessStatusCode();
        (await client.PostAsJsonAsync($"/api/msme/registration/{id}/email-otp", new { email = "pledge@acme.test", confirmEmail = "pledge@acme.test" })).EnsureSuccessStatusCode();
        var otp = OtpInMail().Match(Assert.Single(_host.Email.Sent).HtmlBody).Groups[1].Value;
        (await client.PostAsJsonAsync($"/api/msme/registration/{id}/email-otp/verify", new { otp })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync($"/api/msme/registration/{id}/submit", new { acceptedDeclaration = true, tookPledge = true })).StatusCode);

        var insert = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_MSME_INSERT_UDYAM_DETAILS");
        var stored = FakeSql.Arg(insert.Args, "Password");
        Assert.True(PasswordStore.IsReplacement(stored));

        var mail = _host.Email.Sent.Last().HtmlBody;
        Assert.DoesNotContain(stored!, mail);
        // The hash is of the password the pledge mail shows.
        Assert.Contains(BoldCell().Matches(mail), m => passwords.HashMatches("ZEDMSME999001", m.Groups[1].Value.Trim()));
    }
}
