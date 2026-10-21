using System.Text.Json;
using Zed.Core.Mobile;

namespace Zed.Main.MobileApi.Tests;

public sealed class RaTests : IDisposable
{
    private const string Password = "Msme#Pass1";
    private const string Zed = "ZEDMSME000001";
    private readonly AssessorTestHost _t = new();
    private string _role = "5";

    public RaTests()
    {
        // SP_APP_MSME_REMOTE_CHECK_LOGIN: Users row, Msme, MsmeBasicInformation, Twilio keys (hard-coded in the old procedure).
        _t.Fake.Procs["SP_APP_MSME_REMOTE_CHECK_LOGIN"] = args =>
        {
            if (FakeSql.Arg(args, "Password") is not (Password or "MASTER")) return FakeSql.Sets([], [], [], []);
            return FakeSql.Sets(
                [new Dictionary<string, object?> { ["UserId"] = Zed, ["Password"] = Password, ["RoleId"] = _role }],
                [new { ZedId = Zed, MsmeId = "11", PledgeCertificateNo = Zed, PCity = "Agra", TwoDigitActivity = "24" }],
                [new { EnterpriseName = "Acme", DicName = "DIC Agra" }],
                [new { TwilioAccountSid = "AC-old", TwilioApiKey = "SK-old", TwilioApiSecret = "old-secret" }]);
        };
    }

    public void Dispose() => _t.Dispose();

    private Task<JsonElement> Login(string password, string? version = "1") =>
        _t.Json("/RA/Login", new { userName = Zed, password, version, deviceInfo = new { deviceId = "ra-phone" } });

    private void TwilioConfigured()
    {
        _t.Settings["Mobile:Twilio:AccountSid"] = "ACtest";
        _t.Settings["Mobile:Twilio:ApiKey"] = "SKtest";
        _t.Settings["Mobile:Twilio:ApiSecret"] = "test-secret-test-secret-test-secret";
    }

    [Fact]
    public async Task Login_returns_the_msme_details_without_the_twilio_secret()
    {
        TwilioConfigured();
        var e = await Login(Password);
        Assert.Equal("1", e.GetProperty("status").GetString());
        var m = e.GetProperty("MsmeDetails");
        Assert.Equal(Zed, m.GetProperty("ZedId").GetString());
        Assert.Equal("Acme", m.GetProperty("BasicDetails").GetProperty("EnterpriseName").GetString());
        Assert.Equal("DIC Agra", m.GetProperty("BasicDetails").GetProperty("Dic_Name").GetString());
        Assert.Equal("Agra", m.GetProperty("PlantDetails").GetProperty("PCity").GetString());
        Assert.Equal("24", m.GetProperty("ActivityDetails").GetProperty("Two_DigitActivity").GetString());
        Assert.Equal("ACtest", e.GetProperty("TwilioAccountSid").GetString());
        Assert.Equal("SKtest", e.GetProperty("TwilioApiKey").GetString());
        Assert.Equal(JsonValueKind.Null, e.GetProperty("TwilioApiSecret").ValueKind);
        Assert.DoesNotContain("secret", e.GetRawText());
        Assert.Contains("ra-phone", _t.Devices.Known[(MobileApps.RemoteAssessor, Zed)]);
    }

    [Fact]
    public async Task Wrong_password_master_password_and_wrong_role_are_refused()
    {
        Assert.Equal("Invalid Credentials.", (await Login("nope")).GetProperty("errorMessage").GetString());
        Assert.Equal("Invalid Credentials.", (await Login("MASTER")).GetProperty("errorMessage").GetString());
        _role = "3";
        Assert.Equal("Invalid Credentials.", (await Login(Password)).GetProperty("errorMessage").GetString());
        Assert.Empty(_t.Devices.Known);
    }

    [Fact]
    public async Task Five_failures_lock_the_user()
    {
        for (var i = 0; i < 5; i++) await Login("nope");
        Assert.Contains("Too many failed attempts", (await Login(Password)).GetProperty("errorMessage").GetString());
    }

    [Fact]
    public async Task Old_app_versions_are_told_to_update_when_the_check_is_on()
    {
        _t.Settings["Mobile:CheckRaVersion"] = "true";
        _t.Settings["Mobile:RaVersion"] = "9";
        var e = await Login(Password);
        Assert.Equal("2", e.GetProperty("status").GetString());
        Assert.Equal("Download new app from store.", e.GetProperty("errorMessage").GetString());
    }

    [Fact]
    public async Task Check_assessment_returns_the_schedule()
    {
        _t.Fake.Procs["SP_APP_MSME_REMOTE_CHECK_START_ASSESSMENT"] = args => FakeSql.Arg(args, "CertificationType") == "Silver"
            ? FakeSql.Sets([new { AssessmentDate = "05/01/2024 10:00:00", AllowCalling = 1 }])
            : FakeSql.Sets([]);
        var e = await _t.Json("/RA/CheckAssessment", new { userName = Zed, certificationType = "Silver" });
        Assert.Equal("1", e.GetProperty("status").GetString());
        Assert.Equal("05/01/2024 10:00:00", e.GetProperty("assementDate").GetString());
        Assert.True(e.GetProperty("allowCalling").GetBoolean());

        e = await _t.Json("/RA/CheckAssessment", new { userName = Zed, certificationType = "Gold" });
        Assert.Equal("Remote Assessment not scheduled for this certification.", e.GetProperty("errorMessage").GetString());
    }

    [Fact]
    public async Task Get_token_issues_a_video_token_with_the_old_shape()
    {
        TwilioConfigured();
        var e = await _t.Json("/RA/GetToken", new { userName = Zed, certificationType = "Silver" });
        Assert.Equal(JsonValueKind.Null, e.GetProperty("status").ValueKind);
        Assert.Equal(3, e.GetProperty("token").GetString()!.Split('.').Length);
    }

    [Fact]
    public async Task Get_token_without_configured_keys_returns_no_token()
    {
        var e = await _t.Json("/RA/GetToken", new { userName = Zed });
        Assert.Equal(JsonValueKind.Null, e.GetProperty("token").ValueKind);
    }

    [Fact]
    public async Task Enforce_mode_refuses_a_token_for_an_unknown_device()
    {
        TwilioConfigured();
        _t.Settings["Mobile:DeviceBinding"] = "Enforce";
        await Login(Password);
        var e = await _t.Json("/RA/GetToken", new { userName = Zed, deviceInfo = new { deviceId = "attacker" } });
        Assert.Contains("not registered", e.GetProperty("errorMessage").GetString());
        Assert.Equal(JsonValueKind.Null, e.GetProperty("token").ValueKind);
        e = await _t.Json("/RA/GetToken", new { userName = Zed, deviceInfo = new { deviceId = "ra-phone" } });
        Assert.Equal(JsonValueKind.String, e.GetProperty("token").ValueKind);
    }

    [Fact]
    public async Task Selfie_is_stored_in_the_old_folder_with_the_old_path_text()
    {
        var e = await _t.Json("/RA/SubmitSelfie", new
        {
            userName = Zed, certificationType = "Silver", representativeName = "Owner", representativeDesignation = "CEO",
            photo = new { photo = AssessorTestHost.Base64("img"), timeStamp = "t", latitude = "1", longitude = "2" },
        });
        Assert.Equal("1", e.GetProperty("status").GetString());
        Assert.Equal("img", File.ReadAllText(_t.FileUnderRoot("Photos", Zed, "Silver", "RA", "Selfe.jpg")));
        var args = _t.LastArgs("SP_APP_MSME_REMOTE_INSERT_SELFIE");
        Assert.Equal("/Photos\\" + Zed + "\\Silver\\RA\\Selfe.jpg", AssessorTestHost.Arg(args, "PhotoPath"));
        Assert.Equal("CEO", AssessorTestHost.Arg(args, "Designation"));
    }

    [Fact]
    public async Task Selfie_without_a_photo_gets_the_old_message()
    {
        var e = await _t.Json("/RA/SubmitSelfie", new { userName = Zed, certificationType = "Silver" });
        Assert.Equal("Selfie not received for the ZED ID: " + Zed, e.GetProperty("errorMessage").GetString());
    }

    [Fact]
    public async Task Selfie_refuses_path_traversal()
    {
        foreach (var (user, cert) in new[] { ("..\\..\\x", "Silver"), (Zed, "..\\..\\x"), (Zed, "Platinum") })
        {
            var e = await _t.Json("/RA/SubmitSelfie", new { userName = user, certificationType = cert, photo = new { photo = AssessorTestHost.Base64("img") } });
            Assert.Equal("Invalid Data.", e.GetProperty("errorMessage").GetString());
        }
        Assert.Empty(_t.AllFiles());
        Assert.Empty(_t.CallsTo("SP_APP_MSME_REMOTE_INSERT_SELFIE"));
    }

    [Fact]
    public async Task Location_is_saved_and_an_empty_one_refused()
    {
        var e = await _t.Json("/RA/SubmitLocation", new { userName = Zed, certificationType = "Silver", location = new { latitude = "1", longitude = "2", timeStamp = "t" } });
        Assert.Equal("1", e.GetProperty("status").GetString());
        Assert.Equal("2", AssessorTestHost.Arg(_t.LastArgs("SP_APP_MSME_REMOTE_INSERT_LOCATION"), "Longitude"));
        e = await _t.Json("/RA/SubmitLocation", new { userName = Zed, certificationType = "Silver", location = new { latitude = "" } });
        Assert.Equal("Invalid Location.", e.GetProperty("errorMessage").GetString());
    }
}
