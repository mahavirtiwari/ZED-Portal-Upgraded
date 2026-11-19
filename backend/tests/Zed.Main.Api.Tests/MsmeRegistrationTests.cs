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
            FakeSql.Sets([], [new { TwoDigitActivity = "24", SectorType = "Manufacturing" }], [new { EmailCountStatus = "0", ErrorMessage = "" }]);
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
        // V4: no certificate attached and none kept on the server; the mail links to the page that draws it.
        Assert.Empty(certMail.Attachments ?? []);
        Assert.Contains("/msme/pledge-certificate", certMail.HtmlBody);
        Assert.DoesNotContain("attached", certMail.HtmlBody);
        Assert.False(File.Exists(Path.Combine(_host.StorageRoot, "Certificates", "ZEDMSME999001", "Pledge.pdf")));

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
        _host.Sql.Procs["SP_MSME_VALIDATE_UDYAM_DETAILS"] = _ => FakeSql.Sets([new { ZedId = "ZEDMSME000002" }], [new { TwoDigitActivity = "24", SectorType = "Manufacturing" }]);
        var (client, id) = await StartAsync();
        var r = await client.PostAsJsonAsync($"/api/msme/registration/{id}/plant", new { plantIndex = 0, activityIndex = 0 });
        Assert.Equal("Selected Plant already registered.", await r.ProblemTitle());
    }

    /// <summary>2026-11-17 (the user): the same unit entered twice in Udyam (another plant number, the same address).</summary>
    [Fact]
    public async Task A_plant_at_the_address_of_a_registered_plant_of_the_same_udyam_is_refused()
    {
        _host.Udyam.Result = _host.Udyam.Result with
        {
            Plants =
            [
                new() { ["PlantIdNo"] = "P2", ["UnitName"] = "Acme Unit 2", ["PFlat"] = "Plot-4", ["PBuilding"] = "", ["PRoad"] = "Industrial  Area", ["PCity"] = "KANPUR", ["PPin"] = "208001" },
                new() { ["PlantIdNo"] = "P3", ["UnitName"] = "Acme Unit 3", ["PFlat"] = "Plot 9", ["PRoad"] = "Industrial Area", ["PCity"] = "Kanpur", ["PPin"] = "208001" },
            ],
        };
        _host.Sql.Queries[Zed.Portal.Features.Msme.MsmeRegistrationService.SameAddressSql] = _ =>
            [new Zed.Portal.Features.Msme.MsmeRegistrationService.PlantAddressRow("ZEDMSME000002", "P1", "Plot 4", null, "Industrial Area", "Kanpur", "208001")];
        var client = await _host.CreateBrowserAsync();
        var lookup = await (await client.PostAsJsonAsync("/api/msme/registration/lookup", new { registrationNo = "udyam-up-29-0003915", mobileNo = "9999999999" }))
            .Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        var id = lookup.GetProperty("registrationId").GetString();

        // The plant list greys out the repeat with the registered (masked) ZED ID; the other plant stays open.
        var plants = lookup.GetProperty("plants").EnumerateArray().ToList();
        Assert.True(plants[0].TryGetProperty(Zed.Portal.Features.Msme.MsmeRegistrationService.PlantRegisteredKey, out var masked));
        Assert.DoesNotContain("000002", masked.GetString());
        Assert.False(plants[1].TryGetProperty(Zed.Portal.Features.Msme.MsmeRegistrationService.PlantRegisteredKey, out _));

        var r = await client.PostAsJsonAsync($"/api/msme/registration/{id}/plant", new { plantIndex = 0, activityIndex = 0 });
        Assert.StartsWith("This plant appears to be already registered as ", await r.ProblemTitle());
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync($"/api/msme/registration/{id}/plant", new { plantIndex = 1, activityIndex = 0 })).StatusCode);
    }

    /// <summary>2026-11-19 (the user): units were registering with plant names such as N/A, NA, 1, 2, 3.</summary>
    [Fact]
    public async Task A_plant_with_a_placeholder_unit_name_is_greyed_out_and_refused()
    {
        _host.Udyam.Result = _host.Udyam.Result with
        {
            Plants =
            [
                new() { ["PlantIdNo"] = "P1", ["UnitName"] = "N/A", ["PAddress"] = "Plot 4" },
                new() { ["PlantIdNo"] = "P2", ["UnitName"] = "Acme Unit 2", ["PAddress"] = "Plot 9" },
            ],
        };
        var client = await _host.CreateBrowserAsync();
        var lookup = await (await client.PostAsJsonAsync("/api/msme/registration/lookup", new { registrationNo = "udyam-up-29-0003915", mobileNo = "9999999999" }))
            .Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        var id = lookup.GetProperty("registrationId").GetString();

        var plants = lookup.GetProperty("plants").EnumerateArray().ToList();
        Assert.Equal(Zed.Portal.Features.Msme.UnitNameRule.Refused,
            plants[0].GetProperty(Zed.Portal.Features.Msme.MsmeRegistrationService.UnitNameRefusedKey).GetString());
        Assert.False(plants[1].TryGetProperty(Zed.Portal.Features.Msme.MsmeRegistrationService.UnitNameRefusedKey, out _));

        var r = await client.PostAsJsonAsync($"/api/msme/registration/{id}/plant", new { plantIndex = 0, activityIndex = 0 });
        Assert.Equal(Zed.Portal.Features.Msme.UnitNameRule.Refused, await r.ProblemTitle());
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync($"/api/msme/registration/{id}/plant", new { plantIndex = 1, activityIndex = 0 })).StatusCode);
    }

    [Theory]
    [InlineData("N/A")] [InlineData("NA")] [InlineData("n.a.")] [InlineData("1")] [InlineData("2")] [InlineData("003")]
    [InlineData("")] [InlineData("  ")] [InlineData(null)] [InlineData("-")] [InlineData("XXX")] [InlineData("Nil")]
    [InlineData("Not Applicable")] [InlineData("Unit 1")] [InlineData("Plant No. 2")] [InlineData("NA1")] [InlineData("Test")]
    public void Placeholder_unit_names_are_recognised(string? name) =>
        Assert.True(Zed.Portal.Features.Msme.UnitNameRule.IsPlaceholder(name));

    [Theory]
    [InlineData("Acme Unit 1")] [InlineData("SAMPLE UNIT 1")] [InlineData("Shree Ganesh Castings")] [InlineData("A1 Engineering")]
    [InlineData("3M India")] [InlineData("NA Steel Works")] [InlineData("Unit 2 of Kanpur Forge")] [InlineData("Nalco")]
    public void Real_unit_names_are_accepted(string name) =>
        Assert.False(Zed.Portal.Features.Msme.UnitNameRule.IsPlaceholder(name));

    [Theory]
    [InlineData("Plot-4", "", "Industrial  Area", "KANPUR", "208 001", "plot4||industrialarea|kanpur|208001")]
    [InlineData("", "", "", "", "208001", null)]
    [InlineData("Plot 4", null, null, "Kanpur", "", null)]
    public void The_address_is_compared_without_spaces_punctuation_and_case(string? flat, string? building, string? road, string? city, string? pin, string? key) =>
        Assert.Equal(key, Zed.Portal.Features.Msme.MsmeRegistrationService.AddressKey(flat, building, road, city, pin));

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
