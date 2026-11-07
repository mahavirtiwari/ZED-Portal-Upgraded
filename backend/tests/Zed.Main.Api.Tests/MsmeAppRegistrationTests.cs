using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Zed.Core.Email;
using Zed.Core.Security;
using Zed.Portal.Features.Msme;

namespace Zed.Main.Api.Tests;

/// <summary>
/// The MSME app's registration calls on the main portal (Msme/ValidateCaptcha, ValidatePlantAndActivity,
/// SendPledgeEmailOtp, VerifyPledgeEmailOtp, FinalSubmit), replayed with the bodies the app's Gson produces
/// (docs/mobile/MSME-APP.md). The app has no cookies and no anti-forgery token.
/// </summary>
public sealed partial class MsmeAppRegistrationTests : IDisposable
{
    private const string Udyam = "UDYAM-UP-29-0003915";
    private const string Pledge = "pledge@acme.test";
    private readonly TestHost _host = new();

    public MsmeAppRegistrationTests()
    {
        // [0] plant not yet registered, [1] activity eligible, [2] e-mail usage ok.
        _host.Sql.Procs["SP_MSME_VALIDATE_UDYAM_DETAILS"] = _ =>
            FakeSql.Sets([], [new { TwoDigitActivity = "24", SectorType = "Manufacturing" }], [new { EmailCountStatus = "0", ErrorMessage = "" }]);
        _host.Sql.Procs["SP_MSME_INSERT_UDYAM_DETAILS"] = _ => FakeSql.Sets([new
        {
            ZedId = "ZEDMSME999002", MsmeId = "2", Password = "unused", CertificateNo = "ZED/PLEDGE/0002",
            QrCodeNo = "QR0002", DateOfPledge = "22-10-2026", Address = "Plot 4, Industrial Area, Kanpur, Uttar Pradesh 208001",
        }]);
    }

    public void Dispose() => _host.Dispose();

    [GeneratedRegex(@"<b>\s*([A-Z0-9]{4})\s*</b>")] private static partial Regex OtpInMail();

    private static async Task<(string Status, string? Message)> Answer(HttpResponseMessage r)
    {
        using var doc = JsonDocument.Parse(await r.Content.ReadAsStringAsync());
        var root = doc.RootElement;
        return (root.GetProperty("status").GetString()!, root.TryGetProperty("errorMessage", out var m) ? m.GetString() : null);
    }

    private static Task<HttpResponseMessage> Post(HttpClient app, string action, object body) =>
        app.PostAsJsonAsync("/Msme/" + action, body);

    /// <summary>RegistrationRequest as the app sends it: its own copy of the Udyam record, and null fields left out (Gson).</summary>
    private static object RegistrationBody(string plantId = "P1", string twoDigit = "24", string type = "UDYAM", string email = Pledge) => new Dictionary<string, object>
    {
        ["DateOfPledge"] = "22/10/2026",
        ["PledgeEmailId"] = email,
        ["RegistrationType"] = type,
        ["RegistrationFrom"] = "Android",
        ["BasicDetails"] = new Dictionary<string, object>
        {
            ["UdyogAadharNo"] = Udyam, ["EnterpriseName"] = "Name typed into the app", ["OwnerName"] = "Someone Else",
            ["EnterpriseType"] = "Medium", ["MobileNo"] = "9999999999", ["state_name"] = "Elsewhere",
        },
        ["PlantDetails"] = new Dictionary<string, object> { ["PlantIdNo"] = plantId, ["UnitName"] = "Unit name from the app", ["PAddress"] = "Somewhere" },
        ["ActivityDetails"] = new Dictionary<string, object> { ["Activity"] = "Manufacturing", ["Two_DigitActivity"] = twoDigit, ["Four_DigitActivity"] = "2431", ["Five_DigitActivity"] = "24311" },
    };

    private async Task<string> CaptchaPlantAndOtpAsync(HttpClient app)
    {
        Assert.Equal("1", (await Answer(await Post(app, "ValidateCaptcha", new { token = "safetynet-token" }))).Status);
        Assert.Equal("1", (await Answer(await Post(app, "ValidatePlantAndActivity",
            new Dictionary<string, string> { ["UdyogAadharNo"] = Udyam, ["PlantIdNo"] = "P1", ["TwoDigitActivity"] = "24" }))).Status);
        Assert.Equal("1", (await Answer(await Post(app, "SendPledgeEmailOtp", new { email = Pledge }))).Status);
        var mail = _host.Email.Sent.Last(m => m.To == Pledge);
        Assert.Equal(EmailProfiles.Otp, mail.Profile);
        return OtpInMail().Match(mail.HtmlBody).Groups[1].Value;
    }

    [Fact]
    public async Task Full_app_registration_registers_from_the_servers_own_udyam_record()
    {
        var app = _host.CreateClient();
        var otp = await CaptchaPlantAndOtpAsync(app);
        Assert.Matches("^[A-Z0-9]{4}$", otp); // the app's OTP field takes 4 capitals

        Assert.Equal("1", (await Answer(await Post(app, "VerifyPledgeEmailOtp", new { email = Pledge, otp = otp.ToLowerInvariant() }))).Status);
        var submit = await Post(app, "FinalSubmit", RegistrationBody());
        Assert.Equal(HttpStatusCode.OK, submit.StatusCode);
        Assert.Equal("1", (await Answer(submit)).Status);

        var insert = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_MSME_INSERT_UDYAM_DETAILS");
        // Everything comes from the server's Udyam lookup, not from the app's copy.
        Assert.Equal("Acme Castings", FakeSql.Arg(insert.Args, "EnterpriseName"));
        Assert.Equal("A Kumar", FakeSql.Arg(insert.Args, "OwnerName"));
        Assert.Equal("Micro", FakeSql.Arg(insert.Args, "EnterpriseType"));
        Assert.Equal("Acme Unit 1", FakeSql.Arg(insert.Args, "UnitName"));
        Assert.Equal("Plot 4, Industrial Area", FakeSql.Arg(insert.Args, "PAddress"));
        Assert.Equal(Udyam, FakeSql.Arg(insert.Args, "UdyogAadharNo"));
        Assert.Equal("P1", FakeSql.Arg(insert.Args, "PlantIdNo"));
        Assert.Equal(Pledge, FakeSql.Arg(insert.Args, "PledgeEmailId"));
        Assert.Equal("Android", FakeSql.Arg(insert.Args, "RegistrationFrom"));

        var certMail = _host.Email.Sent.Last();
        Assert.Equal(EmailProfiles.Registration, certMail.Profile);
        Assert.Empty(certMail.Attachments ?? []);
        Assert.Contains("/msme/pledge-certificate", certMail.HtmlBody);
        Assert.False(File.Exists(Path.Combine(_host.StorageRoot, "Certificates", "ZEDMSME999002", "Pledge.pdf")));

        // The verification is single use.
        var again = await Answer(await Post(app, "FinalSubmit", RegistrationBody()));
        Assert.Equal(("0", MsmeAppRegistrationController.EmailNotVerified), again);
    }

    [Fact]
    public async Task Final_submit_needs_an_otp_verified_pledge_email()
    {
        var app = _host.CreateClient();
        await CaptchaPlantAndOtpAsync(app);
        Assert.Equal(("0", MsmeAppRegistrationController.EmailNotVerified), await Answer(await Post(app, "FinalSubmit", RegistrationBody())));
        // Another address than the verified one does not help either.
        Assert.Equal(("0", MsmeAppRegistrationController.EmailNotVerified),
            await Answer(await Post(app, "FinalSubmit", RegistrationBody(email: "other@acme.test"))));
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_MSME_INSERT_UDYAM_DETAILS");
    }

    [Fact]
    public async Task Wrong_otps_are_counted_and_the_fifth_locks_the_otp()
    {
        var app = _host.CreateClient();
        var otp = await CaptchaPlantAndOtpAsync(app);
        var wrong = otp == "AAAA" ? "BBBB" : "AAAA";
        // Four wrong attempts already made (set directly: the per-address rate limit allows 10 calls a minute).
        var store = _host.Services.GetRequiredService<AppRegistrationStore>();
        var state = (await store.GetAsync(Pledge, default))!;
        state.Failures = 4;
        await store.SaveAsync(Pledge, state, default);

        Assert.Equal(("0", "Invalid OTP."), await Answer(await Post(app, "VerifyPledgeEmailOtp", new { email = Pledge, otp = wrong })));
        Assert.Equal(("0", "Too many wrong attempts. Please request a new OTP."),
            await Answer(await Post(app, "VerifyPledgeEmailOtp", new { email = Pledge, otp })));

        // A new OTP starts again.
        Assert.Equal("1", (await Answer(await Post(app, "SendPledgeEmailOtp", new { email = Pledge }))).Status);
        var fresh = OtpInMail().Match(_host.Email.Sent.Last(m => m.To == Pledge).HtmlBody).Groups[1].Value;
        Assert.Equal("1", (await Answer(await Post(app, "VerifyPledgeEmailOtp", new { email = Pledge, otp = fresh }))).Status);
    }

    [Fact]
    public async Task An_expired_otp_is_refused()
    {
        var app = _host.CreateClient();
        var otp = await CaptchaPlantAndOtpAsync(app);
        var store = _host.Services.GetRequiredService<AppRegistrationStore>();
        var state = (await store.GetAsync(Pledge, default))!;
        state.OtpIssuedUtc = DateTimeOffset.UtcNow.AddMinutes(-11);
        await store.SaveAsync(Pledge, state, default);

        Assert.Equal(("0", "The OTP has expired. Please request a new one."),
            await Answer(await Post(app, "VerifyPledgeEmailOtp", new { email = Pledge, otp })));
        Assert.Equal(("0", "The OTP has expired. Please request a new one."),
            await Answer(await Post(app, "VerifyPledgeEmailOtp", new { email = "never@acme.test", otp })));
    }

    [Fact]
    public async Task Otp_mails_are_limited_per_address()
    {
        var app = _host.CreateClient();
        Assert.Equal("1", (await Answer(await Post(app, "ValidateCaptcha", new { token = "t" }))).Status);
        for (var i = 0; i < 5; i++)
            Assert.Equal("1", (await Answer(await Post(app, "SendPledgeEmailOtp", new { email = Pledge }))).Status);
        Assert.Equal(("0", "Too many OTP requests. Please try again after 30 minutes."),
            await Answer(await Post(app, "SendPledgeEmailOtp", new { email = Pledge })));
        Assert.Equal(5, _host.Email.Sent.Count(m => m.To == Pledge));
        Assert.Equal(("0", "Invalid email."), await Answer(await Post(app, "SendPledgeEmailOtp", new { email = "not an address" })));
    }

    [Fact]
    public async Task A_refused_captcha_blocks_the_plant_check_and_the_otp_mail()
    {
        using var factory = _host.WithWebHostBuilder(b =>
        {
            b.UseSetting("Recaptcha:Enabled", "true");
            b.ConfigureServices(s => { s.RemoveAll<IAppCaptchaVerifier>(); s.AddSingleton<IAppCaptchaVerifier>(new RefusingCaptcha()); });
        });
        var app = factory.CreateClient();

        Assert.Equal(("0", "Invalid Captcha."), await Answer(await Post(app, "ValidateCaptcha", new { token = "forged" })));
        Assert.Equal(("0", MsmeAppRegistrationController.CaptchaFirst),
            await Answer(await Post(app, "ValidatePlantAndActivity", new Dictionary<string, string> { ["UdyogAadharNo"] = Udyam, ["PlantIdNo"] = "P1", ["TwoDigitActivity"] = "24" })));
        Assert.Equal(("0", MsmeAppRegistrationController.CaptchaFirst), await Answer(await Post(app, "SendPledgeEmailOtp", new { email = Pledge })));
        Assert.Empty(_host.Email.Sent);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_MSME_VALIDATE_UDYAM_DETAILS");
    }

    [Fact]
    public async Task A_plant_or_activity_that_is_not_in_the_udyam_record_is_refused()
    {
        var app = _host.CreateClient();
        var otp = await CaptchaPlantAndOtpAsync(app);
        Assert.Equal("1", (await Answer(await Post(app, "VerifyPledgeEmailOtp", new { email = Pledge, otp }))).Status);

        Assert.Equal(("0", MsmeAppRegistrationController.InvalidData), await Answer(await Post(app, "FinalSubmit", RegistrationBody(plantId: "P9"))));
        Assert.Equal(("0", MsmeAppRegistrationController.InvalidData), await Answer(await Post(app, "FinalSubmit", RegistrationBody(twoDigit: "99"))));
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_MSME_INSERT_UDYAM_DETAILS");
        // The verification is still there for a corrected request.
        Assert.Equal("1", (await Answer(await Post(app, "FinalSubmit", RegistrationBody()))).Status);
    }

    [Fact]
    public async Task The_lookup_marks_registered_plants_and_activities_the_scheme_does_not_cover()
    {
        _host.Udyam.Result = _host.Udyam.Result with
        {
            Plants =
            [
                new() { ["PlantIdNo"] = "P1", ["UnitName"] = "Acme Unit 1", ["PAddress"] = "Plot 4" },
                new() { ["PlantIdNo"] = "P2", ["UnitName"] = "Acme Unit 2", ["PAddress"] = "Plot 9" },
            ],
            Activities =
            [
                new() { ["Activity"] = "Manufacturing", ["Two_DigitActivity"] = "10-Manufacture of food products", ["Four_DigitActivity"] = "1020", ["Five_DigitActivity"] = "10202" },
                new() { ["Activity"] = "Trading", ["Two_DigitActivity"] = "46-Wholesale trade", ["Four_DigitActivity"] = "4630", ["Five_DigitActivity"] = "46309" },
            ],
        };
        _host.Sql.Procs["SP_MSME_VALIDATE_UDYAM_DETAILS"] = c => FakeSql.Sets(
            FakeSql.Arg(c, "PlantIdNo") == "P1" ? new object[] { new { ZedId = "ZEDM000123", PlantIdNo = "P1" } } : [],
            (FakeSql.Arg(c, "TwoDigitActivity") ?? "").StartsWith("10") ? new object[] { new { SectorCode = "10", SectorType = "Manufacturing" } } : [],
            [new { EmailCountStatus = "1", ErrorMessage = "Invalid Email" }]);

        var app = _host.CreateClient();
        var r = await app.PostAsJsonAsync("/Msme/LookupUdyam", new { udyamNumber = Udyam, mobileNo = "9999999999" });
        using var doc = JsonDocument.Parse(await r.Content.ReadAsStringAsync());
        var plants = doc.RootElement.GetProperty("Plants");
        Assert.Equal("ZEDM•••123", plants[0].GetProperty(MsmeRegistrationService.PlantRegisteredKey).GetString());
        Assert.False(plants[1].TryGetProperty(MsmeRegistrationService.PlantRegisteredKey, out _));
        var activities = doc.RootElement.GetProperty("Activities");
        Assert.False(activities[0].TryGetProperty(MsmeRegistrationService.ActivityRefusedKey, out _));
        Assert.Equal(MsmeRegistrationService.NotApplicable, activities[1].GetProperty(MsmeRegistrationService.ActivityRefusedKey).GetString());
    }

    [Fact]
    public async Task Activities_sharing_an_ActivityDetail_Id_register_the_one_the_user_chose()
    {
        // Udyam gave both activities the same ActivityDetail_Id; only "10" (food products) is in Masters -> Sectors.
        _host.Udyam.Result = _host.Udyam.Result with
        {
            Activities =
            [
                new() { ["Activity"] = "Trading", ["Two_DigitActivity"] = "46-Wholesale trade", ["Four_DigitActivity"] = "4630", ["Five_DigitActivity"] = "46309", ["ActivityDetail_Id"] = "0" },
                new() { ["Activity"] = "Manufacturing", ["Two_DigitActivity"] = "10-Manufacture of food products", ["Four_DigitActivity"] = "1020", ["Five_DigitActivity"] = "10202", ["ActivityDetail_Id"] = "0" },
            ],
        };
        _host.Sql.Procs["SP_MSME_VALIDATE_UDYAM_DETAILS"] = c =>
            FakeSql.Sets([], (FakeSql.Arg(c, "TwoDigitActivity") ?? "").StartsWith("10") ? new object[] { new { SectorCode = "10", SectorType = "Manufacturing" } } : [],
                [new { EmailCountStatus = "0", ErrorMessage = "" }]);
        var app = _host.CreateClient();
        Assert.Equal("1", (await Answer(await Post(app, "ValidateCaptcha", new { token = "t" }))).Status);
        Assert.Equal("1", (await Answer(await Post(app, "ValidatePlantAndActivity",
            new Dictionary<string, string> { ["UdyogAadharNo"] = Udyam, ["PlantIdNo"] = "P1", ["TwoDigitActivity"] = "10-Manufacture of food products" }))).Status);
        Assert.Equal("1", (await Answer(await Post(app, "SendPledgeEmailOtp", new { email = Pledge }))).Status);
        var otp = OtpInMail().Match(_host.Email.Sent.Last(m => m.To == Pledge).HtmlBody).Groups[1].Value;
        Assert.Equal("1", (await Answer(await Post(app, "VerifyPledgeEmailOtp", new { email = Pledge, otp }))).Status);

        var body = (Dictionary<string, object>)RegistrationBody();
        body["ActivityDetails"] = new Dictionary<string, object>
        {
            ["Activity"] = "Manufacturing", ["Two_DigitActivity"] = "10-Manufacture of food products", ["Four_DigitActivity"] = "1020",
            ["Five_DigitActivity"] = "10202", ["ActivityDetail_Id"] = "0",
        };
        Assert.Equal("1", (await Answer(await Post(app, "FinalSubmit", body))).Status);
        var insert = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_MSME_INSERT_UDYAM_DETAILS");
        Assert.Equal("10-Manufacture of food products", FakeSql.Arg(insert.Args, "TwoDigitActivity"));
    }

    [Fact]
    public async Task Registered_plants_ineligible_activities_and_uam_registrations_are_refused()
    {
        var app = _host.CreateClient();
        var otp = await CaptchaPlantAndOtpAsync(app);
        Assert.Equal("1", (await Answer(await Post(app, "VerifyPledgeEmailOtp", new { email = Pledge, otp }))).Status);
        var plant = new Dictionary<string, string> { ["UdyogAadharNo"] = Udyam, ["PlantIdNo"] = "P1", ["TwoDigitActivity"] = "24" };

        _host.Sql.Procs["SP_MSME_VALIDATE_UDYAM_DETAILS"] = _ => FakeSql.Sets([new { ZedId = "ZEDMSME000777" }], [new { TwoDigitActivity = "24", SectorType = "Manufacturing" }], []);
        Assert.Equal(("0", MsmeRegistrationService.AlreadyRegistered), await Answer(await Post(app, "ValidatePlantAndActivity", plant)));
        Assert.Equal(("0", MsmeRegistrationService.AlreadyRegistered), await Answer(await Post(app, "FinalSubmit", RegistrationBody())));

        _host.Sql.Procs["SP_MSME_VALIDATE_UDYAM_DETAILS"] = _ => FakeSql.Sets([], [], []);
        Assert.Equal(("0", MsmeRegistrationService.NotApplicable), await Answer(await Post(app, "ValidatePlantAndActivity", plant)));
        Assert.Equal(("0", MsmeRegistrationService.NotApplicable), await Answer(await Post(app, "FinalSubmit", RegistrationBody())));

        Assert.Equal(("0", MsmeAppRegistrationController.UamNotSupported), await Answer(await Post(app, "FinalSubmit", RegistrationBody(type: "UAM"))));
        Assert.Equal(("0", MsmeAppRegistrationController.InvalidData),
            await Answer(await Post(app, "ValidatePlantAndActivity", new Dictionary<string, string> { ["UdyogAadharNo"] = "not-a-number", ["PlantIdNo"] = "P1", ["TwoDigitActivity"] = "24" })));
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_MSME_INSERT_UDYAM_DETAILS");
    }

    [Fact]
    public async Task A_sector_without_a_type_is_refused_before_the_unit_submits()
    {
        var app = _host.CreateClient();
        var otp = await CaptchaPlantAndOtpAsync(app);
        Assert.Equal("1", (await Answer(await Post(app, "VerifyPledgeEmailOtp", new { email = Pledge, otp }))).Status);
        var plant = new Dictionary<string, string> { ["UdyogAadharNo"] = Udyam, ["PlantIdNo"] = "P1", ["TwoDigitActivity"] = "24" };
        // Migration 0051: the new ZED ID (ZEDM / ZEDS) needs the sector's type in Masters → Sectors.
        _host.Sql.Procs["SP_MSME_VALIDATE_UDYAM_DETAILS"] = _ => FakeSql.Sets([], [new { TwoDigitActivity = "24", SectorType = (string?)null }], []);
        Assert.Equal(("0", MsmeRegistrationService.SectorTypeMissing), await Answer(await Post(app, "ValidatePlantAndActivity", plant)));
        Assert.Equal(("0", MsmeRegistrationService.SectorTypeMissing), await Answer(await Post(app, "FinalSubmit", RegistrationBody())));
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_MSME_INSERT_UDYAM_DETAILS");
    }

    [Fact]
    public async Task Udyam_refusals_are_shown_to_the_app()
    {
        var app = _host.CreateClient();
        var otp = await CaptchaPlantAndOtpAsync(app);
        Assert.Equal("1", (await Answer(await Post(app, "VerifyPledgeEmailOtp", new { email = Pledge, otp }))).Status);
        _host.Udyam.Result = new([], [], []);
        var (status, message) = await Answer(await Post(app, "FinalSubmit", RegistrationBody()));
        Assert.Equal("0", status);
        Assert.Contains("does not exist in the UDYAM Database", message);
    }

    [Fact]
    public async Task The_new_app_looks_udyam_up_on_the_server_and_needs_no_captcha()
    {
        var app = _host.CreateClient();
        var r = await Post(app, "LookupUdyam", new { udyamNumber = Udyam.ToLowerInvariant(), mobileNo = "9999999999" });
        using var doc = JsonDocument.Parse(await r.Content.ReadAsStringAsync());
        var root = doc.RootElement;
        Assert.Equal("1", root.GetProperty("status").GetString());
        var basic = root.GetProperty("BasicDetails");
        Assert.Equal("Acme Castings", basic.GetProperty("EnterpriseName").GetString());
        Assert.Equal("Micro", basic.GetProperty("EnterpriseType").GetString());
        // Only what the app shows: not the e-mail, state and district ids of the Udyam record.
        Assert.False(basic.TryGetProperty("EmailId", out _));
        Assert.False(basic.TryGetProperty("State_Id", out _));
        Assert.Equal("P1", root.GetProperty("Plants")[0].GetProperty("PlantIdNo").GetString());
        Assert.Equal("24", root.GetProperty("Activities")[0].GetProperty("Two_DigitActivity").GetString());

        // The successful lookup stands for the captcha: plant check, OTP and registration follow without ValidateCaptcha.
        Assert.Equal("1", (await Answer(await Post(app, "ValidatePlantAndActivity",
            new Dictionary<string, string> { ["UdyogAadharNo"] = Udyam, ["PlantIdNo"] = "P1", ["TwoDigitActivity"] = "24" }))).Status);
        Assert.Equal("1", (await Answer(await Post(app, "SendPledgeEmailOtp", new { email = Pledge }))).Status);
        var otp = OtpInMail().Match(_host.Email.Sent.Last(m => m.To == Pledge).HtmlBody).Groups[1].Value;
        Assert.Equal("1", (await Answer(await Post(app, "VerifyPledgeEmailOtp", new { email = Pledge, otp }))).Status);
        Assert.Equal("1", (await Answer(await Post(app, "FinalSubmit", RegistrationBody()))).Status);
    }

    [Fact]
    public async Task Failed_udyam_lookups_are_limited_per_number()
    {
        var app = _host.CreateClient();
        Assert.Equal(("0", "Please enter a valid Udyam Registration Number."),
            await Answer(await Post(app, "LookupUdyam", new { udyamNumber = "UDYAM-1", mobileNo = "9999999999" })));
        Assert.Equal(("0", "Please enter a valid 10 digit mobile number."),
            await Answer(await Post(app, "LookupUdyam", new { udyamNumber = Udyam, mobileNo = "99999" })));

        var good = _host.Udyam.Result;
        _host.Udyam.Result = new([], [], []); // the Udyam service's answer to a wrong mobile
        for (var i = 0; i < MsmeAppRegistrationController.MaxLookupFailures; i++)
            Assert.Contains("does not exist in the UDYAM Database",
                (await Answer(await Post(app, "LookupUdyam", new { udyamNumber = Udyam, mobileNo = "9000000000" }))).Message);

        // Now even the right mobile waits: the mobile cannot be guessed.
        _host.Udyam.Result = good;
        Assert.Equal(("0", MsmeAppRegistrationController.TooManyLookups),
            await Answer(await Post(app, "LookupUdyam", new { udyamNumber = Udyam, mobileNo = "9999999999" })));
        // A failed lookup is no captcha pass.
        Assert.Equal(("0", MsmeAppRegistrationController.CaptchaFirst), await Answer(await Post(app, "SendPledgeEmailOtp", new { email = Pledge })));
    }

    [Fact]
    public async Task Get_requests_to_these_addresses_are_not_the_app_endpoints()
    {
        var client = _host.CreateClient();
        foreach (var action in new[] { "FinalSubmit", "ValidateCaptcha", "SendPledgeEmailOtp" })
        {
            var r = await client.GetAsync("/Msme/" + action);
            Assert.NotEqual(HttpStatusCode.MethodNotAllowed, r.StatusCode);
            // Not the app's {status:"0|1"} answer (a 404 problem body has a numeric status).
            Assert.DoesNotContain("\"status\":\"", await r.Content.ReadAsStringAsync());
        }
    }

    private sealed class RefusingCaptcha : IAppCaptchaVerifier
    {
        public Task<bool> VerifyAsync(string? token, string? remoteIp, CancellationToken ct = default) => Task.FromResult(false);
    }
}
