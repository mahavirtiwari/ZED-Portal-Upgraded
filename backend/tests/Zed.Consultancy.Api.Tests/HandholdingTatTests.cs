using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Zed.Main.Api.Tests;
using Zed.Portal.Features.Staff.Monitoring;
using Zed.Portal.Features.Staff.Tat;

namespace Zed.Consultancy.Api.Tests;

/// <summary>
/// 2026-11-18 (the user's decisions "TAT and monitoring"): the Consultancy portal keeps its own TAT (Handholding), edited by the
/// main portal's Admin through the portal switch; Consultancy Monitoring splits each stage by milestone with TAT delays.
/// </summary>
public sealed class HandholdingTatTests : IDisposable
{
    private readonly TestHost _host = new();
    private readonly WebApplicationFactory<Program> _app;
    private static readonly DateTime Today = DateTime.Today;

    public HandholdingTatTests()
    {
        _app = _host.WithTestSignIn();
        _host.Sql.Queries[TatStore.RelationsSql] = _ =>
            [new { Id = 1, Name = "Milestone payment to deliverables accepted", Certification = (string?)null, FromStatus = "1", ToStatus = "100", Days = 30, IsActive = true, SortOrder = 1 }];
        _host.Sql.Queries[TatStore.StatusDaysSql] = _ => [new { Certification = "Silver", StatusCode = "15", Days = 2 }];
        _host.Sql.Procs["SP_MONITORING_GET_LIST"] = args => FakeSql.Arg(args, "Status") == "5" && FakeSql.Arg(args, "CertificationType") == "Silver"
            ? FakeSql.Sets(
                [new Dictionary<string, object?> { ["Id"] = 1, ["ZedId"] = "ZEDH1", ["Certification"] = "Silver", ["CertificationStatus"] = 15, ["NcCount"] = 2 },
                 new Dictionary<string, object?> { ["Id"] = 2, ["ZedId"] = "ZEDH2", ["Certification"] = "Silver", ["CertificationStatus"] = 15, ["NcCount"] = 1 }],
                [new { NotStarted = 0, InProgress = 0, Qc = 2, Nc = 0, Rj = 0 }])
            : FakeSql.Sets([], [new { NotStarted = 0, InProgress = 0, Qc = 0, Nc = 0, Rj = 0 }]);
        _host.Sql.Queries[MonitoringInsights.FactsPrefix] = _ =>
        [
            new { Id = 1, ZedId = "ZEDH1", Certification = "Silver", CertificationStatus = 15, CertificationStatusDate = Today.AddDays(-6), DesktopAccepted = true, NcCount = 2 },
            new { Id = 2, ZedId = "ZEDH2", Certification = "Silver", CertificationStatus = 15, CertificationStatusDate = Today.AddHours(-2), DesktopAccepted = true, NcCount = 1 },
        ];
    }

    public void Dispose()
    {
        _app.Dispose();
        _host.Dispose();
    }

    [Fact]
    public async Task The_handholding_tat_is_served_here_for_the_admin()
    {
        var admin = await StaffTestSignIn.BrowserAsync(_app, "ADMIN1", 1);
        var body = JsonDocument.Parse(await admin.GetStringAsync("/api/staff/settings/tat")).RootElement;
        Assert.Equal("Handholding", body.GetProperty("module").GetString());
        Assert.Equal(["Silver", "Gold", "ZEDX"], body.GetProperty("levels").EnumerateArray().Select(l => l.GetProperty("code").GetString()));
        Assert.Contains(body.GetProperty("statuses").EnumerateArray(), s => s.GetProperty("code").GetString() == "100");
        Assert.True(body.GetProperty("suggestions").EnumerateArray()
            .Single(s => s.GetProperty("name").GetString() == "Milestone payment to deliverables accepted").GetProperty("added").GetBoolean());

        // Handholding levels only; saved in this portal's database.
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync("/api/staff/settings/tat/days/Bronze", new { days = new[] { new { status = "15", days = 2 } } })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync("/api/staff/settings/tat/days/Gold", new { days = new[] { new { status = "15", days = 2 } } })).StatusCode);
        Assert.Single(_host.Sql.Calls, c => c.Name == TatStore.SaveStatusDaySql);

        var master = await StaffTestSignIn.BrowserAsync(_app, "MASTER1", 7);
        Assert.Equal(HttpStatusCode.Forbidden, (await master.GetAsync("/api/staff/settings/tat")).StatusCode);
    }

    [Fact]
    public async Task Consultancy_monitoring_splits_by_milestone_with_the_delays()
    {
        var client = await StaffTestSignIn.BrowserAsync(_app, "MASTER1", 7);
        var body = JsonDocument.Parse(await client.GetStringAsync("/api/staff/monitoring?certification=Silver&status=5")).RootElement;
        var units = body.GetProperty("units").EnumerateArray().ToList();
        Assert.Equal(["ZEDH1", "ZEDH2"], units.Select(u => u.GetProperty("ZedId").GetString()));   // most delayed first
        Assert.Equal("m2", units[0].GetProperty("Track").GetString());
        Assert.Equal(TatEvaluator.OneToFive, units[0].GetProperty("TatBucket").GetString());
        Assert.Equal("m1", units[1].GetProperty("Track").GetString());
        Assert.Equal(TatEvaluator.OnTime, units[1].GetProperty("TatBucket").GetString());
        Assert.False(units[0].GetProperty("SubmissionPending").GetBoolean());

        var qc = body.GetProperty("stages").EnumerateArray().Single(s => s.GetProperty("status").GetInt32() == 5);
        Assert.Equal(1, qc.GetProperty("tracks").GetProperty("m1").GetInt32());
        Assert.Equal(1, qc.GetProperty("tracks").GetProperty("m2").GetInt32());
        Assert.Equal(1, qc.GetProperty("delayed").GetInt32());
        Assert.Equal(0, body.GetProperty("manDays").EnumerateObject().Count());
    }
}
