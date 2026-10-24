using System.Text;
using System.Text.Json;
using Zed.Core.Mobile;

namespace Zed.Main.MobileApi.Tests;

public sealed class MsmeLoginTests : IDisposable
{
    private const string Password = "Right#Pass1";
    private readonly MobileTestHost _host = new();
    private readonly HttpClient _client;

    public MsmeLoginTests()
    {
        // SP_APP_MSME_CHECK_LOGIN: Users row (any password the procedure accepts, including its
        // master password), Msme, MsmeBasicInformation, button states.
        _host.Sql.Procs["SP_APP_MSME_CHECK_LOGIN"] = args =>
        {
            var pw = FakeSql.Arg(args, "Password");
            if (pw is not (Password or "MASTER")) return FakeSql.Sets([], [], [], []);
            return FakeSql.Sets(
                [new Dictionary<string, object?> { ["UserId"] = "ZEDMSME000001", ["Password"] = Password, ["RoleId"] = 5 }],
                [new { ZedId = "ZEDMSME000001", MsmeId = "11", PledgeCertificateNo = "ZEDMSME000001", DateOfPledge = "May 1, 2024", PUnitName = "Unit 1", TwoDigitActivity = "24" }],
                [new { EnterpriseName = "Acme", StateId = "9", DicName = "DIC Agra", EnterpriseTypee = "Micro" }],
                [new Dictionary<string, object?> { ["BronzeStatus"] = 2, ["BronzeStatusOfNc"] = "1", ["Nc1StatusTextBronze"] = "NC raised", ["isCouponUsed"] = true, ["FinancialAssistanceStatus"] = DBNull.Value }]);
        };
        _client = _host.CreateClient();
    }

    public void Dispose() => _host.Dispose();

    private async Task<JsonElement> Login(string password, string? deviceId = "dev-1", string? version = "1.0.0")
    {
        var device = deviceId is null ? "" : $",\"deviceInfo\":{{\"deviceId\":\"{deviceId}\"}}";
        var r = await _client.PostAsync("/Msme/Login", new StringContent(
            $"{{\"userName\":\"ZEDMSME000001\",\"password\":\"{password}\",\"version\":\"{version}\"{device}}}", Encoding.UTF8, "application/json"));
        return JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement;
    }

    [Fact]
    public async Task Successful_login_returns_the_legacy_shape_and_remembers_the_device()
    {
        var e = await Login(Password);
        Assert.Equal("1", e.GetProperty("status").GetString());
        var m = e.GetProperty("MsmeDetails");
        Assert.Equal("ZEDMSME000001", m.GetProperty("ZedId").GetString());
        Assert.Equal(JsonValueKind.Null, m.GetProperty("Password").ValueKind);
        Assert.Equal("Acme", m.GetProperty("BasicDetails").GetProperty("EnterpriseName").GetString());
        Assert.Equal("DIC Agra", m.GetProperty("BasicDetails").GetProperty("Dic_Name").GetString());
        Assert.Equal("Unit 1", m.GetProperty("PlantDetails").GetProperty("UnitName").GetString());
        Assert.Equal("24", m.GetProperty("ActivityDetails").GetProperty("Two_DigitActivity").GetString());
        var st = m.GetProperty("msmeStatus");
        Assert.Equal(2, st.GetProperty("bronze").GetProperty("status").GetInt32());
        Assert.Equal(1, st.GetProperty("BronzeStatusOfNc").GetInt32());
        Assert.Equal("NC raised", st.GetProperty("bronze").GetProperty("nc1StatusText").GetString());
        Assert.Equal(0, st.GetProperty("financialAssistanceStatus").GetInt32());
        Assert.True(st.GetProperty("isCouponUsed").GetBoolean());
        // No Twilio keys configured: no token, and the key fields stay empty as before.
        Assert.Equal(JsonValueKind.Null, e.GetProperty("TwilioToken").ValueKind);
        Assert.Equal(JsonValueKind.Null, e.GetProperty("TwilioApiSecret").ValueKind);
        Assert.Contains("dev-1", _host.Devices.Known[(MobileApps.Msme, "ZEDMSME000001")]);
    }

    [Fact]
    public async Task Wrong_password_gets_the_legacy_message()
    {
        var e = await Login("nope");
        Assert.Equal("0", e.GetProperty("status").GetString());
        Assert.Equal("Invalid Credentials.", e.GetProperty("errorMessage").GetString());
        Assert.Equal(JsonValueKind.Null, e.GetProperty("MsmeDetails").ValueKind);
    }

    [Fact]
    public async Task The_procedures_master_password_is_refused()
    {
        var e = await Login("MASTER");
        Assert.Equal("0", e.GetProperty("status").GetString());
        Assert.Empty(_host.Devices.Known);
    }

    [Fact]
    public async Task Five_failures_lock_the_user_name_even_for_the_right_password()
    {
        for (var i = 0; i < 5; i++) await Login("nope");
        var e = await Login(Password);
        Assert.Equal("0", e.GetProperty("status").GetString());
        Assert.Contains("Too many failed attempts", e.GetProperty("errorMessage").GetString());
    }

    // ------------------------------------------------------------------ Password hashes (docs/PASSWORDS.md)

    [Fact]
    public async Task Dual_app_login_records_a_hash_and_a_master_password_does_not()
    {
        var passwords = new global::Zed.TestSupport.FakePasswords().Attach(_host.Sql.Procs);
        Assert.Equal("0", (await Login("MASTER")).GetProperty("status").GetString());
        Assert.Empty(passwords.Writes);
        Assert.Equal("1", (await Login(Password)).GetProperty("status").GetString());
        Assert.True(passwords.HashMatches("ZEDMSME000001", Password));
        Assert.Null(Assert.Single(passwords.Writes).Replace);
    }

    [Fact]
    public async Task HashOnly_app_login_checks_the_hash_and_gives_the_procedure_the_stored_value()
    {
        var passwords = new global::Zed.TestSupport.FakePasswords().Attach(_host.Sql.Procs);
        passwords.Add("ZEDMSME000001", "5", Password, hashOf: Password);
        global::Zed.TestSupport.FakePasswords.SetMode(_host.Services, global::Zed.Core.Security.PasswordMode.HashOnly);
        Assert.Equal("0", (await Login("MASTER")).GetProperty("status").GetString());
        Assert.Equal(global::Zed.Core.Security.PasswordStore.RefusedValue, FakeSql.Arg(_host.Sql.Calls.Last(c => c.Name == "SP_APP_MSME_CHECK_LOGIN").Args, "Password"));

        Assert.Equal("1", (await Login(Password.ToUpperInvariant())).GetProperty("status").GetString());
        Assert.Equal(Password, FakeSql.Arg(_host.Sql.Calls.Last(c => c.Name == "SP_APP_MSME_CHECK_LOGIN").Args, "Password"));
        Assert.True(global::Zed.Core.Security.PasswordStore.IsReplacement(passwords.Accounts["ZEDMSME000001"].Stored));
    }

    [Fact]
    public async Task Every_app_sign_in_is_recorded_with_the_device()
    {
        var r = await _client.PostAsync("/Msme/Login", new StringContent(
            "{\"userName\":\"ZEDMSME000001\",\"password\":\"" + Password + "\",\"version\":\"2.7.2\",\"deviceInfo\":{\"deviceId\":\"a1b2c3d4\",\"osVersion\":\"13\",\"apiLevel\":33,\"device\":\"a52q\",\"modelProduct\":\"SM-A525F\",\"manufacturer\":\"samsung\"}}",
            Encoding.UTF8, "application/json"));
        r.EnsureSuccessStatusCode();
        await Login("wrong");

        var events = _host.Sql.Calls.Where(c => c.Name.StartsWith("INSERT INTO dbo.V4LoginEvents")).ToList();
        Assert.Equal(2, events.Count);
        var ok = events[0].Args;
        Assert.Equal("Mobile", FakeSql.Arg(ok, "Channel"));
        Assert.Equal("MSME app", FakeSql.Arg(ok, "App"));
        Assert.Equal("Success", FakeSql.Arg(ok, "Result"));
        Assert.Equal("ZEDMSME000001", FakeSql.Arg(ok, "UserId"));
        Assert.Equal("a1b2c3d4", FakeSql.Arg(ok, "DeviceId"));
        Assert.Equal("a52q / SM-A525F", FakeSql.Arg(ok, "DeviceModel"));
        Assert.Equal("samsung", FakeSql.Arg(ok, "Manufacturer"));
        Assert.Equal("13", FakeSql.Arg(ok, "OsVersion"));
        Assert.Equal("33", FakeSql.Arg(ok, "ApiLevel"));
        Assert.Equal("2.7.2", FakeSql.Arg(ok, "AppVersion"));
        Assert.Equal("App", FakeSql.Arg(ok, "DeviceType"));
        var failed = events[1].Args;
        Assert.Equal("Failed", FakeSql.Arg(failed, "Result"));
        Assert.Equal("Invalid Credentials.", FakeSql.Arg(failed, "Reason"));
        Assert.Equal("dev-1", FakeSql.Arg(failed, "DeviceId"));
        Assert.DoesNotContain(events, e => FakeSql.Arg(e.Args, "Reason")?.Contains(Password) == true);
    }
}

public sealed class MsmeVersionCheckTests : IDisposable
{
    private readonly MobileTestHost _host = new();

    public void Dispose() => _host.Dispose();

    [Fact]
    public async Task Old_app_versions_are_told_to_update_when_the_check_is_on()
    {
        _host.Settings["Mobile:CheckMsmeVersion"] = "true";
        _host.Settings["Mobile:MsmeVersion"] = "2.0.0";
        var r = await _host.CreateClient().PostAsync("/Msme/Login", new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["userName"] = "ZEDMSME000001", ["password"] = "x", ["version"] = "1.0.0",
        }));
        var e = JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("2", e.GetProperty("status").GetString());
        Assert.Equal("Download new app from store.", e.GetProperty("errorMessage").GetString());
        // No login procedure ran; only the refused attempt was recorded.
        var call = Assert.Single(_host.Sql.Calls);
        Assert.StartsWith("INSERT INTO dbo.V4LoginEvents", call.Name);
        Assert.Equal("Failed", FakeSql.Arg(call.Args, "Result"));
        Assert.Equal("1.0.0", FakeSql.Arg(call.Args, "AppVersion"));
    }
}

public sealed class DeviceBindingTests : IDisposable
{
    private readonly MobileTestHost _host = new();

    public void Dispose() => _host.Dispose();

    private async Task<JsonElement> Call(string? deviceId, string user = "ZEDMSME000001")
    {
        var fields = new Dictionary<string, string> { ["zedId"] = user };
        if (deviceId is not null) fields["deviceInfo.deviceId"] = deviceId;
        var r = await _host.CreateClient().PostAsync("/probe/guarded", new FormUrlEncodedContent(fields));
        return JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement;
    }

    private void Registered() =>
        _host.Devices.RememberAsync(MobileApps.Msme, "ZEDMSME000001", new DeviceInfo { deviceId = "phone-1" }, null).Wait();

    [Fact]
    public async Task Monitor_mode_allows_unknown_and_missing_devices_but_records_them()
    {
        Registered();
        Assert.Equal("1", (await Call("phone-1")).GetProperty("status").GetString());
        Assert.Equal("1", (await Call("attacker")).GetProperty("status").GetString());
        Assert.Equal("1", (await Call(null)).GetProperty("status").GetString());
        Assert.Collection(_host.Devices.Events,
            e => Assert.Equal((DeviceCheck.Unknown, false), (e.Outcome, e.Refused)),
            e => Assert.Equal((DeviceCheck.Missing, false), (e.Outcome, e.Refused)));
    }

    [Fact]
    public async Task Enforce_mode_refuses_a_device_that_never_signed_in_as_that_user()
    {
        _host.Settings["Mobile:DeviceBinding"] = "Enforce";
        Registered();
        Assert.Equal("1", (await Call("phone-1")).GetProperty("status").GetString());
        var refused = await Call("attacker");
        Assert.Equal("0", refused.GetProperty("status").GetString());
        Assert.Contains("not registered", refused.GetProperty("errorMessage").GetString());
        // Missing device ids are allowed unless RefuseMissingDevice is set.
        Assert.Equal("1", (await Call(null)).GetProperty("status").GetString());
        // A user with no registered device (has not logged in since the switch) is not blocked.
        Assert.Equal("1", (await Call("any", "ZEDMSME000002")).GetProperty("status").GetString());
    }

    [Fact]
    public async Task Enforce_mode_can_also_refuse_calls_without_a_device_id()
    {
        _host.Settings["Mobile:DeviceBinding"] = "Enforce";
        _host.Settings["Mobile:RefuseMissingDevice"] = "true";
        Registered();
        Assert.Equal("0", (await Call(null)).GetProperty("status").GetString());
    }
}
