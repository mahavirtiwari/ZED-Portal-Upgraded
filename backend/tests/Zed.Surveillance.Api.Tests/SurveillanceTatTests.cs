using System.Net;
using System.Text.Json;
using Zed.Main.Api.Tests;
using Zed.Portal.Features.CertLevels;
using Zed.Portal.Features.Staff.Monitoring;

namespace Zed.Surveillance.Api.Tests;

/// <summary>
/// 2026-11-18 (the user's decisions "TAT and monitoring"): the Surveillance portal keeps its own TAT, and Surveillance Monitoring
/// splits desktop / site and finds the visits whose submission through the app is pending past the surveillance man-days.
/// </summary>
public sealed class SurveillanceTatTests : IDisposable
{
    private readonly AssessmentStaff _staff = new();
    private static readonly DateTime Today = DateTime.Today;

    public SurveillanceTatTests()
    {
        _staff.Sql.Procs["SP_MONITORING_GET_LIST"] = args => FakeSql.Arg(args, "Status") == "3" && FakeSql.Arg(args, "CertificationType") == "Gold"
            ? FakeSql.Sets(
                [new Dictionary<string, object?> { ["Id"] = 5, ["ZedId"] = "ZEDS1", ["Certification"] = "Gold", ["CertificationStatus"] = 9 },
                 new Dictionary<string, object?> { ["Id"] = 6, ["ZedId"] = "ZEDS2", ["Certification"] = "Gold", ["CertificationStatus"] = 3 }],
                [new { NotStarted = 0, InProgress = 2, Qc = 0, Nc = 0, Rj = 0 }])
            : FakeSql.Sets([], [new { NotStarted = 0, InProgress = 0, Qc = 0, Nc = 0, Rj = 0 }]);
        _staff.Sql.Queries[MonitoringInsights.FactsPrefix] = _ =>
        [
            new { Id = 5, ZedId = "ZEDS1", Certification = "Gold", CertificationStatus = 9, ModeOfAssessment = "Onsite Assessment", IsSelfieSynced = 1,
                  AssessmentDate = Today.AddDays(-3), DesktopAccepted = true },
            new { Id = 6, ZedId = "ZEDS2", Certification = "Gold", CertificationStatus = 3, CertificationStatusDate = Today.AddDays(-1), DesktopAccepted = true },
        ];
        // Assessment man-days 10 would not make it pending; the surveillance man-days (2) do.
        _staff.Sql.Queries[LevelManDays.ReadSql] = _ => [new { Code = "Gold", ManDays = (int?)10, SurveillanceManDays = (int?)2 }];
    }

    public void Dispose() => _staff.Dispose();

    [Fact]
    public async Task Surveillance_monitoring_uses_the_surveillance_man_days()
    {
        var client = await _staff.SignInAsync("MASTER1", 7);
        var body = JsonDocument.Parse(await client.GetStringAsync("/api/staff/monitoring?certification=Gold&status=3")).RootElement;
        var units = body.GetProperty("units").EnumerateArray().ToDictionary(u => u.GetProperty("ZedId").GetString()!);
        Assert.Equal("site", units["ZEDS1"].GetProperty("Track").GetString());
        Assert.True(units["ZEDS1"].GetProperty("SubmissionPending").GetBoolean());
        Assert.Equal("desktop", units["ZEDS2"].GetProperty("Track").GetString());   // desktop surveillance runs at 2-3
        Assert.Equal(2, body.GetProperty("manDays").GetProperty("Gold").GetInt32());
        var progress = body.GetProperty("stages").EnumerateArray().Single(s => s.GetProperty("status").GetInt32() == 3);
        Assert.Equal((1, 1), (progress.GetProperty("tracks").GetProperty("desktop").GetInt32(), progress.GetProperty("tracks").GetProperty("site").GetInt32()));
        // Only this database has IsSelfieSynced.
        Assert.Contains(_staff.Sql.Calls, c => c.Name.StartsWith(MonitoringInsights.FactsPrefix) && c.Name.Contains("C.IsSelfieSynced"));
    }

    [Fact]
    public async Task The_surveillance_tat_is_served_here_for_the_admin()
    {
        var admin = await _staff.SignInAsync("ADMIN1", 1);
        var res = await admin.GetAsync("/api/staff/settings/tat");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = JsonDocument.Parse(await res.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("Surveillance", body.GetProperty("module").GetString());
        Assert.Contains(body.GetProperty("statuses").EnumerateArray(), s => s.GetProperty("code").GetString() == "1" && s.GetProperty("track").GetString() == "desktop");
    }
}
