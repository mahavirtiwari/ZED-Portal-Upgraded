using Microsoft.Extensions.Logging.Abstractions;
using Zed.Core.Mobile;

namespace Zed.Main.MobileApi.Tests;

/// <summary>
/// One phone per staff user in every app but the ZED MSME app (2026-11-18): the mode of each app, and what the device
/// records keep (make, API level, app version, first IP). The sign-in and call behaviour is tested with each app's own
/// tests (SaAppTests, ConsultancyAppLoginTests, SurveillanceAppTests, MsmeLoginTests).
/// </summary>
public sealed class OnePhoneRuleTests
{
    private static MobileOptions Options(DeviceBindingMode global = DeviceBindingMode.Monitor, bool? saOnePhone = null, params (string App, DeviceBindingMode Mode)[] apps)
    {
        var o = new MobileOptions { DeviceBinding = global, SaOnePhone = saOnePhone };
        foreach (var (app, mode) in apps) o.DeviceBindingApps[app] = mode;
        return o;
    }

    [Fact]
    public void Staff_apps_are_enforced_by_default_and_the_units_apps_are_not()
    {
        var o = Options();
        Assert.Equal(DeviceBindingMode.Enforce, DevicePolicy.ModeFor(o, MobileApps.SiteAssessor));
        Assert.Equal(DeviceBindingMode.Enforce, DevicePolicy.ModeFor(o, MobileApps.Surveillance));
        Assert.Equal(DeviceBindingMode.Monitor, DevicePolicy.ModeFor(o, MobileApps.Msme));
        Assert.Equal(DeviceBindingMode.Monitor, DevicePolicy.ModeFor(o, MobileApps.RemoteAssessor));
        Assert.True(DevicePolicy.OnePhone(MobileApps.SiteAssessor) && DevicePolicy.OnePhone(MobileApps.Surveillance));
        Assert.False(DevicePolicy.OnePhone(MobileApps.Msme) || DevicePolicy.OnePhone(MobileApps.RemoteAssessor));
    }

    [Fact]
    public void The_global_setting_still_turns_everything_off_and_one_app_can_be_switched()
    {
        // Mobile:DeviceBinding = Off (set before 2026-11-18) is respected.
        var off = Options(DeviceBindingMode.Off);
        Assert.All(new[] { MobileApps.SiteAssessor, MobileApps.Surveillance, MobileApps.Msme, MobileApps.RemoteAssessor },
            app => Assert.Equal(DeviceBindingMode.Off, DevicePolicy.ModeFor(off, app)));
        // Enforce as before for every app.
        Assert.Equal(DeviceBindingMode.Enforce, DevicePolicy.ModeFor(Options(DeviceBindingMode.Enforce), MobileApps.RemoteAssessor));
        // The per-app setting wins, either way (case of the key does not matter).
        var emergency = Options(DeviceBindingMode.Off, null, ("sa", DeviceBindingMode.Enforce), ("SURV", DeviceBindingMode.Monitor));
        Assert.Equal(DeviceBindingMode.Enforce, DevicePolicy.ModeFor(emergency, MobileApps.SiteAssessor));
        Assert.Equal(DeviceBindingMode.Monitor, DevicePolicy.ModeFor(Options(apps: (MobileApps.Surveillance, DeviceBindingMode.Monitor)), MobileApps.Surveillance));
        // The earlier switch of the site assessor app's rule.
        Assert.Equal(DeviceBindingMode.Monitor, DevicePolicy.ModeFor(Options(saOnePhone: false), MobileApps.SiteAssessor));
        Assert.Equal(DeviceBindingMode.Enforce, DevicePolicy.ModeFor(Options(saOnePhone: false), MobileApps.Surveillance));
    }

    [Fact]
    public void The_message_names_the_registered_phone_and_who_releases_it()
    {
        Assert.Equal("This account is registered on another phone (Samsung SM-A515F). Ask your Master Admin to release it.",
            OnePhoneRule.OtherPhone(" Samsung SM-A515F "));
        Assert.Equal("This account is registered on another phone. Ask your Master Admin to release it.", OnePhoneRule.OtherPhone(null));
    }

    [Fact]
    public async Task Only_the_phone_signed_in_from_last_is_known_under_the_rule()
    {
        var devices = new FakeDevices();
        Assert.Equal(DeviceCheck.NoBinding, await OnePhoneRule.CheckAsync(devices, MobileApps.SiteAssessor, "ZEDAS0001", "a", default));
        await devices.RememberAsync(MobileApps.SiteAssessor, "ZEDAS0001", new DeviceInfo { deviceId = "a" }, null);
        Assert.Equal(DeviceCheck.Known, await OnePhoneRule.CheckAsync(devices, MobileApps.SiteAssessor, "ZEDAS0001", "a", default));
        Assert.Equal(DeviceCheck.Unknown, await OnePhoneRule.CheckAsync(devices, MobileApps.SiteAssessor, "ZEDAS0001", "b", default));
        Assert.Equal(DeviceCheck.Missing, await OnePhoneRule.CheckAsync(devices, MobileApps.SiteAssessor, "ZEDAS0001", " ", default));
    }

    [Fact]
    public async Task A_sign_in_records_make_api_level_app_version_and_ip()
    {
        var sql = new FakeSql();
        var devices = new SqlDeviceBindings(sql, NullLogger<SqlDeviceBindings>.Instance);
        await devices.RememberAsync(MobileApps.SiteAssessor, " ZEDAS0001 ",
            new DeviceInfo { deviceId = "dev-1", manufacturer = "Samsung", modelProduct = "SM-A515F", osVersion = "13", apiLevel = 33 }, "49.36.1.2", "2.0");
        var call = Assert.Single(sql.Calls, c => c.Name == SqlDeviceBindings.RememberSql);
        Assert.Equal("ZEDAS0001", FakeSql.Arg(call.Args, "User"));
        Assert.Equal("Samsung", FakeSql.Arg(call.Args, "Make"));
        Assert.Equal("Samsung SM-A515F", FakeSql.Arg(call.Args, "Model"));
        Assert.Equal("13", FakeSql.Arg(call.Args, "Os"));
        Assert.Equal("33", FakeSql.Arg(call.Args, "ApiLevel"));
        Assert.Equal("2.0", FakeSql.Arg(call.Args, "AppVersion"));
        Assert.Equal("49.36.1.2", FakeSql.Arg(call.Args, "Ip"));
        Assert.Contains("FirstIp", SqlDeviceBindings.RememberSql);
    }
}

/// <summary>The calls of the apps under the rule (the probe endpoints: MSME and SA device-bound actions).</summary>
public sealed class OnePhoneCallTests : IDisposable
{
    private readonly MobileTestHost _host = new();

    public void Dispose() => _host.Dispose();

    private async Task<string> Call(string path, Dictionary<string, string> fields) =>
        System.Text.Json.JsonDocument.Parse(await (await _host.CreateClient().PostAsync(path, new FormUrlEncodedContent(fields))).Content.ReadAsStringAsync())
            .RootElement.GetProperty("status").GetString()!;

    private Task<string> Sa(string device) =>
        Call("/probe/assessorguarded", new() { ["saId"] = "ZEDAS0001", ["deviceInfo.deviceId"] = device });

    private Task<string> Msme(string device) =>
        Call("/probe/guarded", new() { ["zedId"] = "ZEDMSME000001", ["deviceInfo.deviceId"] = device });

    [Fact]
    public async Task The_msme_app_is_never_refused_by_default_whatever_phone()
    {
        await _host.Devices.RememberAsync(MobileApps.Msme, "ZEDMSME000001", new DeviceInfo { deviceId = "phone-1" }, null);
        await _host.Devices.RememberAsync(MobileApps.Msme, "ZEDMSME000001", new DeviceInfo { deviceId = "phone-2" }, null);
        Assert.Equal("1", await Msme("phone-1"));
        Assert.Equal("1", await Msme("phone-2"));
        Assert.Equal("1", await Msme("a-third-phone"));
        Assert.DoesNotContain(_host.Devices.Events, e => e.Refused);
    }

    [Fact]
    public async Task Of_the_phones_recorded_at_monitor_the_assessor_keeps_the_latest()
    {
        await _host.Devices.RememberAsync(MobileApps.SiteAssessor, "ZEDAS0001", new DeviceInfo { deviceId = "old-phone" }, null);
        await _host.Devices.RememberAsync(MobileApps.SiteAssessor, "ZEDAS0001", new DeviceInfo { deviceId = "new-phone" }, null);
        Assert.Equal("1", await Sa("new-phone"));
        Assert.Equal("0", await Sa("old-phone"));
        Assert.Contains(_host.Devices.Events, e => e.Device == "old-phone" && e.Outcome == DeviceCheck.Unknown && e.Refused);
        // Released: no phone registered, nothing refused until the next sign-in registers one.
        _host.Devices.Known.Clear();
        Assert.Equal("1", await Sa("old-phone"));
    }

    [Fact]
    public async Task The_global_off_is_respected()
    {
        _host.Settings["Mobile:DeviceBinding"] = "Off";
        await _host.Devices.RememberAsync(MobileApps.SiteAssessor, "ZEDAS0001", new DeviceInfo { deviceId = "new-phone" }, null);
        Assert.Equal("1", await Sa("other-phone"));
    }
}
