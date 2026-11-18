using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Core.Mobile;
using Zed.Portal.Features.Staff.Users;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>
/// Registered mobile (one phone per assessor, 2026-11-18 on all three portals): the Admin and the Master Admin see an
/// assessor's phone of the site assessor app, the recent sign-ins and the release history, and release it with a reason.
/// </summary>
public sealed class AssessorMobileTests : IDisposable
{
    private const string Url = "/api/staff/assessor-mobile/ZEDAS0009";
    private readonly TestHost _host = new();
    private bool _registered = true;

    public AssessorMobileTests()
    {
        UsersMastersLogin.Setup(_host);
        _host.Sql.Queries[AssessorMobileController.AssessorSql] = args => [Arg(args, "UserId") == "ZEDAS0009" ? 1 : 0];
        // What the mobile host wrote at the assessor's SA/Login (SqlDeviceBindings.RememberSql: AppKind SA, UserKey = the
        // procedure's Users.UserId), read with the same keys.
        _host.Sql.Queries[AssessorMobileController.PhonesSql] = args => _registered && Arg(args, "User") == "ZEDAS0009"
            ? [new
            {
                App = "SA", DeviceId = "phone-1", Model = "Samsung SM-A515F", Make = "Samsung", OsVersion = "13", ApiLevel = 33, AppVersion = "2.0",
                FirstSeenAt = new DateTime(2026, 10, 12), LastLoginAt = new DateTime(2026, 11, 3, 9, 12, 0), LastIp = "49.36.1.2", FirstIp = "49.36.0.9",
            }]
            : [];
        _host.Sql.Queries[AssessorMobileController.SignInsSql] = _ =>
        [
            new { At = new DateTime(2026, 11, 3, 3, 42, 0), App = "Site assessment app", Result = "Success", DeviceId = "phone-1", DeviceModel = "Samsung SM-A515F", OsVersion = "13", AppVersion = "2.0", IpAddress = "49.36.1.2" },
            new { At = new DateTime(2026, 11, 2, 13, 10, 0), App = "Site assessment app", Result = "Failed", Reason = OnePhoneRule.OtherPhone("Samsung SM-A515F"), DeviceId = "phone-2", DeviceModel = "Xiaomi 2201117TI", AppVersion = "2.0", IpAddress = "106.20.1.1" },
        ];
        _host.Sql.Queries[AssessorMobileController.ReleasesSql] = _ =>
            [new { At = new DateTime(2026, 10, 12, 8, 0, 0), App = "SA", DeviceId = "phone-0", Model = "Redmi Note 12", ReleasedBy = "MASTER1", Reason = "Phone lost", Ip = "10.0.0.1" }];
        _host.Sql.Queries[AssessorMobileController.AllPhonesSql] = _ =>
        [
            new { UserId = "ZEDAS0009", App = "SA", Model = "Samsung SM-A515F", Make = "Samsung", LastLoginAt = new DateTime(2026, 11, 3) },
            new { UserId = "ZEDAS0003", App = "SA", Model = "Vivo V2050", Make = "Vivo", LastLoginAt = new DateTime(2026, 11, 1) },
        ];
        _host.Sql.Queries[AssessorMobileController.RefusalsSql] = args => Arg(args, "User") is null or "ZEDAS0003"
            ? [new { UserId = "ZEDAS0003", At = DateTime.Today.AddHours(9) }, new { UserId = "ZEDAS0004", At = DateTime.Today.AddHours(10) }]
            : [];
    }

    public void Dispose() => _host.Dispose();

    private static string? Arg(object? args, string name) => args?.GetType().GetProperty(name)?.GetValue(args)?.ToString();

    [Fact]
    public async Task Only_the_admin_and_the_master_admin_see_and_release_the_phone()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await (await _host.CreateBrowserAsync()).GetAsync(Url)).StatusCode);
        foreach (var user in new[] { "AGENCY1", "SUPER1" })
        {
            var other = await UsersMastersLogin.SignInAsync(_host, user);
            Assert.Equal(HttpStatusCode.Forbidden, (await other.GetAsync(Url)).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await other.GetAsync("/api/staff/assessor-mobile")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await other.PostAsJsonAsync(Url + "/release", new { reason = "x" })).StatusCode);
        }
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == SqlDeviceBindings.ReleaseSql);
        var master = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        Assert.Equal(HttpStatusCode.OK, (await master.GetAsync(Url)).StatusCode);
    }

    [Fact]
    public async Task Shows_the_phone_the_sign_ins_and_the_release_history()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var r = (await admin.GetFromJsonAsync<AssessorMobileController.MobileResponse>(Url))!;
        Assert.Equal("phone-1", r.Device!.DeviceId);
        Assert.Equal(("Samsung SM-A515F", "Samsung", "2.0", 33, "49.36.0.9"), (r.Device.Model, r.Device.Make, r.Device.AppVersion, r.Device.ApiLevel, r.Device.FirstIp));
        Assert.Equal("Site assessment app", r.Device.AppName);
        Assert.Equal(2, r.SignIns.Count);
        Assert.Equal("Failed", r.SignIns[1].Result);
        Assert.Equal("106.20.1.1", r.SignIns[1].IpAddress);
        var release = Assert.Single(r.Releases);
        Assert.Equal(("Redmi Note 12", "MASTER1", "Phone lost"), (release.Model, release.ReleasedBy, release.Reason));
        Assert.False(r.RefusedToday);
        // The keys the mobile host writes with: AppKind SA and the site assessor app's name in the sign-in log.
        var phones = _host.Sql.Calls.Last(c => c.Name == AssessorMobileController.PhonesSql);
        Assert.Equal(["SA"], (string[])phones.Args!.GetType().GetProperty("Apps")!.GetValue(phones.Args)!);
        var signIns = _host.Sql.Calls.Last(c => c.Name == AssessorMobileController.SignInsSql);
        Assert.Equal(["Site assessment app"], (string[])signIns.Args!.GetType().GetProperty("AppNames")!.GetValue(signIns.Args)!);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync("/api/staff/assessor-mobile/ZEDAS0001")).StatusCode);
    }

    [Fact]
    public async Task The_lists_get_each_phone_and_the_refusals_of_today()
    {
        var master = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        var list = await master.GetFromJsonAsync<JsonElement>("/api/staff/assessor-mobile");
        var rows = list.EnumerateArray().ToDictionary(e => e.GetProperty("userId").GetString()!);
        Assert.Equal("Samsung SM-A515F", rows["ZEDAS0009"].GetProperty("model").GetString());
        Assert.False(rows["ZEDAS0009"].GetProperty("refusedToday").GetBoolean());
        Assert.True(rows["ZEDAS0003"].GetProperty("refusedToday").GetBoolean());
        Assert.Equal("Vivo V2050", rows["ZEDAS0003"].GetProperty("model").GetString());
        // Refused today without a registered phone.
        Assert.True(rows["ZEDAS0004"].GetProperty("refusedToday").GetBoolean());
        Assert.Equal(JsonValueKind.Null, rows["ZEDAS0004"].GetProperty("model").ValueKind);
    }

    [Fact]
    public async Task A_release_needs_a_reason_and_is_kept_in_the_history()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        Assert.Equal("Please enter the reason for releasing the mobile.", await (await admin.PostAsJsonAsync(Url + "/release", new { reason = "  " })).ProblemTitle());
        Assert.Equal("The reason can have at most 500 characters.", await (await admin.PostAsJsonAsync(Url + "/release", new { reason = new string('x', 501) })).ProblemTitle());
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == SqlDeviceBindings.ReleaseSql);

        var released = await admin.PostAsJsonAsync(Url + "/release", new { reason = " Phone replaced " });
        released.EnsureSuccessStatusCode();
        var call = Assert.Single(_host.Sql.Calls, c => c.Name == SqlDeviceBindings.ReleaseSql);
        Assert.Equal("ZEDAS0009", Arg(call.Args, "User"));
        Assert.Equal(MobileApps.SiteAssessor, Arg(call.Args, "App"));
        var ev = Assert.Single(_host.Sql.Calls, c => c.Name == AssessorMobileController.ReleaseEventSql);
        Assert.Equal(("phone-1", "Samsung SM-A515F", "ADMIN1", "Phone replaced"), (Arg(ev.Args, "Device"), Arg(ev.Args, "Model"), Arg(ev.Args, "By"), Arg(ev.Args, "Reason")));

        var history = await admin.GetFromJsonAsync<JsonElement>(Url + "/releases");
        Assert.Equal("Phone lost", history[0].GetProperty("reason").GetString());

        _registered = false;
        Assert.Equal("No mobile is registered for this user.", await (await admin.PostAsJsonAsync(Url + "/release", new { reason = "x" })).ProblemTitle());
    }
}
