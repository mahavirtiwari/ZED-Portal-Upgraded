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
        Assert.Empty(_host.Sql.Calls);
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
