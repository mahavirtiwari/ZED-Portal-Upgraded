using System.Text;
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

    [Fact]
    public async Task Login_returns_the_msme_details_and_empty_twilio_fields()
    {
        var e = await Login(Password);
        Assert.Equal("1", e.GetProperty("status").GetString());
        var m = e.GetProperty("MsmeDetails");
        Assert.Equal(Zed, m.GetProperty("ZedId").GetString());
        Assert.Equal("Acme", m.GetProperty("BasicDetails").GetProperty("EnterpriseName").GetString());
        Assert.Equal("DIC Agra", m.GetProperty("BasicDetails").GetProperty("Dic_Name").GetString());
        Assert.Equal("Agra", m.GetProperty("PlantDetails").GetProperty("PCity").GetString());
        Assert.Equal("24", m.GetProperty("ActivityDetails").GetProperty("Two_DigitActivity").GetString());
        // Video calls were removed: the fields stay for the installed app, always empty (never the procedure's old keys).
        foreach (var field in new[] { "TwilioAccountSid", "TwilioApiKey", "TwilioApiSecret", "TwilioToken" })
            Assert.Equal(JsonValueKind.Null, e.GetProperty(field).ValueKind);
        Assert.DoesNotContain("AC-old", e.GetRawText());
        Assert.DoesNotContain("secret", e.GetRawText());
        Assert.Contains("ra-phone", _t.Devices.Known[(MobileApps.RemoteAssessor, Zed)]);
        Assert.False(string.IsNullOrEmpty(e.GetProperty("appToken").GetString()));
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
    public async Task Get_token_keeps_the_old_shape_without_a_token()
    {
        var e = await _t.Json("/RA/GetToken", new { userName = Zed, certificationType = "Silver" });
        Assert.Equal(JsonValueKind.Null, e.GetProperty("status").ValueKind);
        Assert.Equal(JsonValueKind.Null, e.GetProperty("token").ValueKind);
    }

    [Fact]
    public async Task Enforce_mode_refuses_a_token_for_an_unknown_device()
    {
        _t.Settings["Mobile:DeviceBinding"] = "Enforce";
        await Login(Password);
        var e = await _t.Json("/RA/GetToken", new { userName = Zed, deviceInfo = new { deviceId = "attacker" } });
        Assert.Contains("not registered", e.GetProperty("errorMessage").GetString());
        Assert.Equal(JsonValueKind.Null, e.GetProperty("token").ValueKind);
        e = await _t.Json("/RA/GetToken", new { userName = Zed, deviceInfo = new { deviceId = "ra-phone" } });
        Assert.False(e.TryGetProperty("errorMessage", out var message) && message.ValueKind == JsonValueKind.String);
        Assert.Equal(JsonValueKind.Null, e.GetProperty("token").ValueKind);
    }

    [Fact]
    public async Task Selfie_is_stored_in_the_old_folder_with_the_old_path_text()
    {
        var e = await _t.Json("/RA/SubmitSelfie", new
        {
            userName = Zed, certificationType = "Silver", representativeName = "Owner", representativeDesignation = "CEO",
            photo = new { photo = AssessorTestHost.JpegBase64, timeStamp = "t", latitude = "1", longitude = "2" },
        });
        Assert.Equal("1", e.GetProperty("status").GetString());
        Assert.Equal(AssessorTestHost.Jpeg, File.ReadAllBytes(_t.FileUnderRoot("Photos", Zed, "Silver", "RA", "Selfe.jpg")));
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
            var e = await _t.Json("/RA/SubmitSelfie", new { userName = user, certificationType = cert, photo = new { photo = AssessorTestHost.JpegBase64 } });
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
    [Fact]
    public async Task Ra_login_hashes_under_Dual_and_uses_the_hash_under_HashOnly()
    {
        var passwords = new global::Zed.TestSupport.FakePasswords().Attach(_t.Fake.Procs);
        _t.Settings[global::Zed.Core.Security.PasswordStore.Setting] = "HashOnly";
        passwords.Add(Zed, "5", Password, hashOf: Password);
        Assert.Equal("0", (await Login("MASTER")).GetProperty("status").GetString());
        Assert.Equal("1", (await Login(Password)).GetProperty("status").GetString());
        Assert.Equal(Password, FakeSql.Arg(_t.Fake.Calls.Last(c => c.Name == "SP_APP_MSME_REMOTE_CHECK_LOGIN").Args, "Password"));
        Assert.True(global::Zed.Core.Security.PasswordStore.IsReplacement(passwords.Accounts[Zed].Stored));
    }

    // ---------------------------------------------------------------- the rebuilt ZED MSME app (MSME app token)

    /// <summary>The ZED MSME app's sign-in (msme/login): its MSME app token, its device remembered for the MSME app.</summary>
    private async Task<string> MsmeAppLogin(string device)
    {
        _t.Fake.Procs["SP_APP_MSME_CHECK_LOGIN"] = _ => FakeSql.Sets(
            [new Dictionary<string, object?> { ["UserId"] = Zed, ["Password"] = Password, ["RoleId"] = 5 }],
            [new { ZedId = Zed, MsmeId = "11" }], [new { EnterpriseName = "Acme" }], [new { BronzeStatus = 1 }]);
        var e = await _t.Json("/Msme/Login", new { userName = Zed, password = Password, deviceInfo = new { deviceId = device } });
        Assert.Equal("1", e.GetProperty("status").GetString());
        return e.GetProperty("appToken").GetString()!;
    }

    private async Task<JsonElement> WithToken(string path, object body, string? token)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, path)
        {
            Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"),
        };
        if (token is not null) request.Headers.Add(AppTokens.Header, token);
        var r = await _t.Client.SendAsync(request);
        return JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement;
    }

    private void EnforceTokensAndDevices()
    {
        _t.Settings["Mobile:AppTokenKey"] = AppTokenTests.Key;
        _t.Settings["Mobile:AppTokens:Apps:RA"] = "Enforce";
        _t.Settings["Mobile:DeviceBinding"] = "Enforce";
        _t.Fake.Procs["SP_APP_MSME_REMOTE_CHECK_START_ASSESSMENT"] = _ => FakeSql.Sets([new { AssessmentDate = "05/01/2024 10:00:00", AllowCalling = 1 }]);
    }

    private static object Selfie(string user, string device) => new
    {
        userName = user, certificationType = "Silver", representativeName = "Owner", representativeDesignation = "CEO",
        photo = new { photo = AssessorTestHost.JpegBase64, timeStamp = "t", latitude = "1", longitude = "2" }, deviceInfo = new { deviceId = device },
    };

    [Fact]
    public async Task Check_assessment_and_selfie_take_the_msme_app_token_and_device_under_enforce()
    {
        EnforceTokensAndDevices();
        var msme = await MsmeAppLogin("msme-phone");

        var e = await WithToken("/RA/CheckAssessment", new { userName = Zed, certificationType = "Silver", deviceInfo = new { deviceId = "msme-phone" } }, msme);
        Assert.Equal("1", e.GetProperty("status").GetString());
        Assert.Equal("05/01/2024 10:00:00", e.GetProperty("assementDate").GetString());
        e = await WithToken("/RA/SubmitSelfie", Selfie(Zed, "msme-phone"), msme);
        Assert.Equal("1", e.GetProperty("status").GetString());
        Assert.Single(_t.CallsTo("SP_APP_MSME_REMOTE_INSERT_SELFIE"));
        Assert.Empty(_t.Devices.TokenEvents);

        // The remote assessment app's own sign-in keeps working.
        var ra = (await Login(Password)).GetProperty("appToken").GetString();
        e = await WithToken("/RA/CheckAssessment", new { userName = Zed, certificationType = "Silver", deviceInfo = new { deviceId = "ra-phone" } }, ra);
        Assert.Equal("1", e.GetProperty("status").GetString());
    }

    [Fact]
    public async Task The_msme_app_token_is_taken_for_its_own_unit_and_device_and_by_those_two_calls_only()
    {
        EnforceTokensAndDevices();
        var msme = await MsmeAppLogin("msme-phone");
        const string Expired = AppTokens.ExpiredMessage;

        // Another unit, no token, a device the MSME app never signed in on (the RA app's included): refused.
        var other = await WithToken("/RA/CheckAssessment", new { userName = "ZEDMSME000002", certificationType = "Silver", deviceInfo = new { deviceId = "msme-phone" } }, msme);
        Assert.Equal(Expired, other.GetProperty("errorMessage").GetString());
        Assert.Contains(_t.Devices.TokenEvents, ev => ev.App == MobileApps.Msme && ev.Outcome == AppTokenCheck.OtherUser && ev.Refused);
        var none = await WithToken("/RA/SubmitSelfie", Selfie(Zed, "msme-phone"), null);
        Assert.Equal(Expired, none.GetProperty("errorMessage").GetString());
        await Login(Password);   // the RA app on "ra-phone"
        var device = await WithToken("/RA/SubmitSelfie", Selfie(Zed, "ra-phone"), msme);
        Assert.Contains("not registered", device.GetProperty("errorMessage").GetString());
        Assert.Contains(_t.Devices.Events, ev => ev.App == MobileApps.Msme && ev.Device == "ra-phone" && ev.Refused);
        Assert.Empty(_t.CallsTo("SP_APP_MSME_REMOTE_INSERT_SELFIE"));

        // The other RA calls still want the RA app's token.
        var location = await WithToken("/RA/SubmitLocation",
            new { userName = Zed, certificationType = "Silver", location = new { latitude = "1", longitude = "2" }, deviceInfo = new { deviceId = "msme-phone" } }, msme);
        Assert.Equal(Expired, location.GetProperty("errorMessage").GetString());
        Assert.Equal(Expired, (await WithToken("/RA/GetToken", new { userName = Zed, deviceInfo = new { deviceId = "msme-phone" } }, msme))
            .GetProperty("errorMessage").GetString());
        Assert.Contains(_t.Devices.TokenEvents, ev => ev.App == MobileApps.RemoteAssessor && ev.Outcome == AppTokenCheck.OtherApp && ev.Refused);
        Assert.Empty(_t.CallsTo("SP_APP_MSME_REMOTE_INSERT_LOCATION"));
    }
}
