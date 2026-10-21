using System.Net;
using System.Net.Http.Json;
using System.Text.RegularExpressions;
using Zed.Core.Email;
using Zed.Core.Http;

namespace Zed.Main.Api.Tests;

public sealed partial class MsmeRegistrationTests : IDisposable
{
    private readonly TestHost _host = new();

    public MsmeRegistrationTests()
    {
        // [0] plant not yet registered, [1] activity eligible, [2] e-mail usage ok.
        _host.Sql.Procs["SP_MSME_VALIDATE_UDYAM_DETAILS"] = _ =>
            FakeSql.Sets([], [new { TwoDigitActivity = "24" }], [new { EmailCountStatus = "0", ErrorMessage = "" }]);
        _host.Sql.Procs["SP_MSME_INSERT_UDYAM_DETAILS"] = _ => FakeSql.Sets([new
        {
            ZedId = "ZEDMSME999001", MsmeId = "1", Password = "x7k2m9p4q3", CertificateNo = "ZED/PLEDGE/0001",
            QrCodeNo = "QR0001", DateOfPledge = "20-10-2026", Address = "Plot 4, Industrial Area, Kanpur, Uttar Pradesh 208001",
        }]);
    }

    public void Dispose() => _host.Dispose();

    private sealed record LookupResult(string RegistrationId);

    [GeneratedRegex(@"<b>\s*(\d{6})\s*</b>")] private static partial Regex OtpInMail();

    private async Task<(HttpClient Client, string Id)> StartAsync()
    {
        var client = await _host.CreateBrowserAsync();
        var lookup = await client.PostAsJsonAsync("/api/msme/registration/lookup",
            new { registrationNo = "udyam-up-29-0003915", mobileNo = "9999999999" });
        Assert.Equal(HttpStatusCode.OK, lookup.StatusCode);
        var id = (await lookup.Content.ReadFromJsonAsync<LookupResult>())!.RegistrationId;
        return (client, id);
    }

    [Fact]
    public async Task Full_registration_creates_msme_sends_certificate_and_signs_in()
    {
        var (client, id) = await StartAsync();

        (await client.PostAsJsonAsync($"/api/msme/registration/{id}/plant", new { plantIndex = 0, activityIndex = 0 })).EnsureSuccessStatusCode();
        (await client.PostAsJsonAsync($"/api/msme/registration/{id}/email-otp", new { email = "pledge@acme.test", confirmEmail = "pledge@acme.test" })).EnsureSuccessStatusCode();

        var otpMail = Assert.Single(_host.Email.Sent);
        Assert.Equal(EmailProfiles.Otp, otpMail.Profile);
        var otp = OtpInMail().Match(otpMail.HtmlBody).Groups[1].Value;

        (await client.PostAsJsonAsync($"/api/msme/registration/{id}/email-otp/verify", new { otp })).EnsureSuccessStatusCode();
        var submit = await client.PostAsJsonAsync($"/api/msme/registration/{id}/submit", new { acceptedDeclaration = true, tookPledge = true });
        Assert.Equal(HttpStatusCode.OK, submit.StatusCode);

        var insert = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_MSME_INSERT_UDYAM_DETAILS");
        Assert.Equal("UDYAM-UP-29-0003915", FakeSql.Arg(insert.Args, "UdyogAadharNo"));
        Assert.Equal("pledge@acme.test", FakeSql.Arg(insert.Args, "PledgeEmailId"));
        Assert.Equal("P1", FakeSql.Arg(insert.Args, "PlantIdNo"));
        // Fields missing from the Udyam record go to the procedure as NULL (an empty string breaks numeric columns).
        Assert.Null(FakeSql.Arg(insert.Args, "InvestmentCost"));
        Assert.Null(FakeSql.Arg(insert.Args, "TotalEmp"));

        var certMail = _host.Email.Sent.Last();
        Assert.Equal(EmailProfiles.Registration, certMail.Profile);
        var pdf = Assert.Single(certMail.Attachments!);
        Assert.StartsWith("%PDF", System.Text.Encoding.ASCII.GetString(pdf.Content, 0, 4));
        Assert.True(File.Exists(Path.Combine(_host.StorageRoot, "Certificates", "ZEDMSME999001", "Pledge.pdf")));

        var me = await client.GetFromJsonAsync<CurrentUserResponse>("/api/auth/me");
        Assert.Equal("ZEDMSME999001", me!.UserId);

        // The session is single use.
        var again = await client.PostAsJsonAsync($"/api/msme/registration/{id}/submit", new { acceptedDeclaration = true, tookPledge = true });
        Assert.Equal(HttpStatusCode.Gone, again.StatusCode);
    }

    [Fact]
    public async Task Submit_is_refused_until_the_email_is_verified()
    {
        var (client, id) = await StartAsync();
        await client.PostAsJsonAsync($"/api/msme/registration/{id}/plant", new { plantIndex = 0, activityIndex = 0 });
        await client.PostAsJsonAsync($"/api/msme/registration/{id}/email-otp", new { email = "pledge@acme.test", confirmEmail = "pledge@acme.test" });

        var submit = await client.PostAsJsonAsync($"/api/msme/registration/{id}/submit", new { acceptedDeclaration = true, tookPledge = true });
        Assert.Equal(HttpStatusCode.BadRequest, submit.StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_MSME_INSERT_UDYAM_DETAILS");
    }

    [Fact]
    public async Task Otp_locks_after_five_wrong_attempts()
    {
        var (client, id) = await StartAsync();
        await client.PostAsJsonAsync($"/api/msme/registration/{id}/plant", new { plantIndex = 0, activityIndex = 0 });
        await client.PostAsJsonAsync($"/api/msme/registration/{id}/email-otp", new { email = "pledge@acme.test", confirmEmail = "pledge@acme.test" });
        var otp = OtpInMail().Match(_host.Email.Sent.Last().HtmlBody).Groups[1].Value;
        var wrong = otp == "000000" ? "111111" : "000000";

        for (var i = 0; i < 5; i++)
            Assert.Equal("Invalid OTP.", await (await client.PostAsJsonAsync($"/api/msme/registration/{id}/email-otp/verify", new { otp = wrong })).ProblemTitle());

        var right = await client.PostAsJsonAsync($"/api/msme/registration/{id}/email-otp/verify", new { otp });
        Assert.Equal(HttpStatusCode.BadRequest, right.StatusCode);
    }

    [Fact]
    public async Task Already_registered_plant_is_rejected()
    {
        _host.Sql.Procs["SP_MSME_VALIDATE_UDYAM_DETAILS"] = _ => FakeSql.Sets([new { ZedId = "ZEDMSME000002" }], [new { TwoDigitActivity = "24" }]);
        var (client, id) = await StartAsync();
        var r = await client.PostAsJsonAsync($"/api/msme/registration/{id}/plant", new { plantIndex = 0, activityIndex = 0 });
        Assert.Equal("Selected Plant already registered.", await r.ProblemTitle());
    }

    [Fact]
    public async Task Udyam_record_without_plants_is_rejected()
    {
        _host.Udyam.Result = _host.Udyam.Result with { Plants = [] };
        var client = await _host.CreateBrowserAsync();
        var r = await client.PostAsJsonAsync("/api/msme/registration/lookup", new { registrationNo = "UDYAM-UP-29-0003915", mobileNo = "9999999999" });
        Assert.StartsWith("It seems that the Plant Details are missing", await r.ProblemTitle());
    }

    [Theory]
    [InlineData("12345", "9999999999")]
    [InlineData("UDYAM-UP-29-0003915", "99999")]
    public async Task Lookup_validates_input_format(string regNo, string mobile)
    {
        var client = await _host.CreateBrowserAsync();
        var r = await client.PostAsJsonAsync("/api/msme/registration/lookup", new { registrationNo = regNo, mobileNo = mobile });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }
}
