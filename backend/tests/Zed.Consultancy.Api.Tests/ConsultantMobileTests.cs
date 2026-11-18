using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Core.Mobile;
using Zed.Main.Api.Tests;
using Zed.Portal.Features.Staff.Users;

namespace Zed.Consultancy.Api.Tests;

/// <summary>
/// One phone per consultant (2026-11-18): the Consultancy portal's Master Admin (and the Admin) sees a consultant's registered
/// phone of the consultant app and releases it with a reason; consultant organisations cannot.
/// </summary>
public sealed class ConsultantMobileTests : IDisposable
{
    private const string Consultant = "ZEDCC0001";
    private const string Url = "/api/staff/assessor-mobile/" + Consultant;
    private readonly AssessmentStaff _staff = new();
    private bool _registered = true;

    public ConsultantMobileTests()
    {
        _staff.Sql.Queries[AssessorMobileController.AssessorSql] = args => [FakeSql.Arg(args, "UserId") == Consultant ? 1 : 0];
        _staff.Sql.Queries[AssessorMobileController.PhonesSql] = _ => _registered
            ? [new
            {
                App = MobileApps.SiteAssessor, DeviceId = "cc-phone", Model = "Xiaomi 2201117TI", Make = "Xiaomi", OsVersion = "14", ApiLevel = 34,
                AppVersion = "1.3", FirstSeenAt = new DateTime(2026, 11, 1), LastLoginAt = new DateTime(2026, 11, 17, 9, 0, 0), LastIp = "10.0.0.5", FirstIp = "10.0.0.1",
            }]
            : [];
        _staff.Sql.Queries[AssessorMobileController.AllPhonesSql] = _ =>
            [new { UserId = Consultant, App = MobileApps.SiteAssessor, Model = "Xiaomi 2201117TI", Make = "Xiaomi", LastLoginAt = new DateTime(2026, 11, 17) }];
    }

    public void Dispose() => _staff.Dispose();

    [Fact]
    public async Task The_master_admin_sees_the_consultant_app_phone_and_releases_it_with_a_reason()
    {
        var master = await _staff.SignInAsync("MASTER1", 7);
        var r = (await master.GetFromJsonAsync<JsonElement>(Url))!;
        Assert.Equal("Xiaomi 2201117TI", r.GetProperty("device").GetProperty("model").GetString());
        Assert.Equal("1.3", r.GetProperty("device").GetProperty("appVersion").GetString());
        Assert.Equal("Consultant app", r.GetProperty("device").GetProperty("appName").GetString());
        // The sign-in log of the consultant app.
        var signIns = _staff.Sql.Calls.Last(c => c.Name == AssessorMobileController.SignInsSql);
        Assert.Equal(["Consultant app"], (string[])signIns.Args!.GetType().GetProperty("AppNames")!.GetValue(signIns.Args)!);

        var list = await master.GetFromJsonAsync<JsonElement>("/api/staff/assessor-mobile");
        Assert.Equal(Consultant, list[0].GetProperty("userId").GetString());

        Assert.Equal("Please enter the reason for releasing the mobile.",
            await (await master.PostAsJsonAsync(Url + "/release", new { reason = " " })).ProblemTitle());
        Assert.DoesNotContain(_staff.Sql.Calls, c => c.Name == SqlDeviceBindings.ReleaseSql);

        (await master.PostAsJsonAsync(Url + "/release", new { reason = "Phone replaced" })).EnsureSuccessStatusCode();
        var release = Assert.Single(_staff.Sql.Calls, c => c.Name == SqlDeviceBindings.ReleaseSql);
        Assert.Equal(Consultant, FakeSql.Arg(release.Args, "User"));
        Assert.Equal(MobileApps.SiteAssessor, FakeSql.Arg(release.Args, "App"));
        var ev = Assert.Single(_staff.Sql.Calls, c => c.Name == AssessorMobileController.ReleaseEventSql);
        Assert.Equal("cc-phone", FakeSql.Arg(ev.Args, "Device"));
        Assert.Equal("Phone replaced", FakeSql.Arg(ev.Args, "Reason"));
        Assert.Equal("MASTER1", FakeSql.Arg(ev.Args, "By"));
    }

    [Fact]
    public async Task Consultant_organisations_cannot_see_or_release_a_phone()
    {
        var org = await _staff.SignInAsync("ZEDCO0001", 2, "SiteVerification");
        Assert.Equal(HttpStatusCode.Forbidden, (await org.GetAsync(Url)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await org.PostAsJsonAsync(Url + "/release", new { reason = "x" })).StatusCode);
        Assert.DoesNotContain(_staff.Sql.Calls, c => c.Name == SqlDeviceBindings.ReleaseSql);
    }
}
