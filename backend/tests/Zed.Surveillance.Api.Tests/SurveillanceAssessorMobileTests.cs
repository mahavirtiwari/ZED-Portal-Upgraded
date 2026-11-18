using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Core.Mobile;
using Zed.Main.Api.Tests;
using Zed.Portal.Features.Staff.Users;

namespace Zed.Surveillance.Api.Tests;

/// <summary>
/// One phone per assessor on Surveillance (2026-11-18): the site assessor app (SA) and the Bronze surveillance app (SURV)
/// each have the assessor's registered phone; the Master Admin releases both, or one app's, with a reason.
/// </summary>
public sealed class SurveillanceAssessorMobileTests : IDisposable
{
    private const string Assessor = "ZEDAS0007";
    private const string Url = "/api/staff/assessor-mobile/" + Assessor;
    private readonly AssessmentStaff _staff = new();

    public SurveillanceAssessorMobileTests()
    {
        _staff.Sql.Queries[AssessorMobileController.AssessorSql] = args => [FakeSql.Arg(args, "UserId") == Assessor ? 1 : 0];
        _staff.Sql.Queries[AssessorMobileController.PhonesSql] = _ =>
        [
            new { App = MobileApps.Surveillance, DeviceId = "bronze-phone", Model = "Samsung SM-A515F", LastLoginAt = new DateTime(2026, 11, 17) },
            new { App = MobileApps.SiteAssessor, DeviceId = "sa-phone", Model = "Samsung SM-A515F", LastLoginAt = new DateTime(2026, 11, 10) },
        ];
        _staff.Sql.Queries[AssessorMobileController.RefusalsSql] = _ => [new { UserId = Assessor, At = DateTime.Today.AddHours(9) }];
    }

    public void Dispose() => _staff.Dispose();

    [Fact]
    public async Task Both_apps_phones_show_and_a_release_names_one_app()
    {
        var master = await _staff.SignInAsync("MASTER1", 7);
        var r = await master.GetFromJsonAsync<JsonElement>(Url);
        Assert.Equal(["Surveillance app", "Site assessment app"], r.GetProperty("devices").EnumerateArray().Select(d => d.GetProperty("appName").GetString()));
        Assert.True(r.GetProperty("refusedToday").GetBoolean());
        var apps = (string[])_staff.Sql.Calls.Last(c => c.Name == AssessorMobileController.PhonesSql).Args!.GetType().GetProperty("Apps")!.GetValue(
            _staff.Sql.Calls.Last(c => c.Name == AssessorMobileController.PhonesSql).Args)!;
        Assert.Equal([MobileApps.SiteAssessor, MobileApps.Surveillance], apps);

        Assert.Equal("Please choose an app of this portal.",
            await (await master.PostAsJsonAsync(Url + "/release", new { reason = "Lost", app = "MSME" })).ProblemTitle());
        (await master.PostAsJsonAsync(Url + "/release", new { reason = "Lost", app = "SURV" })).EnsureSuccessStatusCode();
        var release = Assert.Single(_staff.Sql.Calls, c => c.Name == SqlDeviceBindings.ReleaseSql);
        Assert.Equal(MobileApps.Surveillance, FakeSql.Arg(release.Args, "App"));
        Assert.Equal("bronze-phone", FakeSql.Arg(Assert.Single(_staff.Sql.Calls, c => c.Name == AssessorMobileController.ReleaseEventSql).Args, "Device"));
    }

    [Fact]
    public async Task Agencies_cannot_release()
    {
        var agency = await _staff.SignInAsync("ZEDAA0001", 2, "SiteVerification");
        Assert.Equal(HttpStatusCode.Forbidden, (await agency.PostAsJsonAsync(Url + "/release", new { reason = "x" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await agency.GetAsync("/api/staff/assessor-mobile")).StatusCode);
    }
}
