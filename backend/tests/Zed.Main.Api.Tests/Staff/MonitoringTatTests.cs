using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Core.Http;
using Zed.Portal.Features.CertLevels;
using Zed.Portal.Features.Staff.Monitoring;
using Zed.Portal.Features.Staff.Tat;
using Zed.Portal.Features.Staff.Users;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>
/// 2026-11-18 (approved monitoring design): Desktop / Site sub-sections, the stage's date range, the site steps and the submission
/// pending through the app (man-days), the TAT delays and the stage counts, scoped as the list.
/// </summary>
public sealed class MonitoringTatTests : IDisposable
{
    private const string Url = "/api/staff/monitoring";
    private static readonly DateTime Today = DateTime.Today;
    private readonly TestHost _host = new();
    private readonly List<object> _facts = [];

    public MonitoringTatTests()
    {
        SiteAssessmentTestUsers.Register(_host);
        // The procedure's rows: quality check (status 5) desktop + site, in progress (3) desktop + site.
        _host.Sql.Procs["SP_MONITORING_GET_LIST"] = args =>
        {
            var status = FakeSql.Arg(args, "Status");
            var cert = FakeSql.Arg(args, "CertificationType");
            var rows = new List<object>();
            void Add(int id, string zedId, int s, int certStatus) => rows.Add(new Dictionary<string, object?>
            {
                ["Id"] = id, ["ZedId"] = zedId, ["Certification"] = "Silver", ["CertificationStatus"] = certStatus, ["NcCount"] = 0, ["PUnitName"] = "Unit " + zedId,
                ["UnitSpocName"] = "Ravi Kumar", ["UnitSpocMobileNo"] = "9876543210", ["UnitSpocEmailId"] = "ravi@unit.test", ["_S"] = s,
            });
            Add(1, "ZEDA", 5, 5);
            Add(2, "ZEDB", 5, 15);
            Add(3, "ZEDC", 5, 15);
            Add(10, "ZEDP", 3, 9);
            Add(11, "ZEDQ", 3, 9);
            Add(12, "ZEDR", 3, 13);
            Add(13, "ZEDS", 3, 3);
            var list = rows.Cast<Dictionary<string, object?>>().Where(r => r["_S"]!.ToString() == status && cert == "Silver").Cast<object>().ToList();
            return FakeSql.Sets(list, [new { NotStarted = 0, InProgress = 4, Qc = 3, Nc = 0, Rj = 0 }]);
        };
        _host.Sql.Queries[MonitoringInsights.FactsPrefix] = _ => _facts;
        _host.Sql.Queries[TatStore.StatusDaysSql] = _ =>
            [new { Certification = "Silver", StatusCode = "5", Days = 2 }, new { Certification = "Silver", StatusCode = "15", Days = 3 }];
        _host.Sql.Queries[LevelManDays.ReadSql] = _ => [new { Code = "Silver", ManDays = (int?)2, SurveillanceManDays = (int?)5 }];

        Fact(1, "ZEDA", 5, statusDate: Today.AddDays(-1));                         // desktop QC: 1 day left
        Fact(2, "ZEDB", 15, statusDate: Today.AddDays(-16));                       // site QC: 13 days late
        Fact(3, "ZEDC", 15, statusDate: Today.AddDays(-5));                        // site QC: 2 days late
        Fact(10, "ZEDP", 9, assessment: Today.AddDays(-5), mode: "Onsite Assessment"); // distributed, man-days passed
        Fact(11, "ZEDQ", 9, assessment: Today.AddDays(-1), mode: "Onsite Assessment", open: Today.AddDays(-1));
        Fact(12, "ZEDR", 13, assessment: Today.AddDays(-9), mode: "Onsite Assessment", open: Today.AddDays(-9));
        Fact(13, "ZEDS", 3, statusDate: Today.AddDays(-2));
    }

    public void Dispose() => _host.Dispose();

    private void Fact(int id, string zedId, int status, DateTime? statusDate = null, DateTime? assessment = null, string? mode = null, DateTime? open = null) =>
        _facts.Add(new
        {
            Id = id, ZedId = zedId, Certification = "Silver", CertificationStatus = status, CertificationStatusDate = statusDate ?? Today.AddDays(-3),
            AssessmentDate = assessment, ModeOfAssessment = mode, JoinRoomStatus = 0, DesktopAccepted = true, NcCount = 0,
            CertificationBodyUserId = "AGENCYDA", OpenMeetingOn = open,
        });

    private Task<HttpClient> SignIn(string user) => SiteAssessmentTestUsers.SignInAsync(_host, user);

    private static List<JsonElement> Units(JsonElement body) => body.GetProperty("units").EnumerateArray().ToList();

    private static JsonElement Unit(JsonElement body, string zedId) => Units(body).Single(u => u.GetProperty("ZedId").GetString() == zedId);

    [Fact]
    public void Stages_follow_the_monitoring_procedures_and_split_desktop_and_site()
    {
        MonitoringInsights.Fact F(int s, string? mode = "Onsite Assessment", int join = 0, int? selfie = null, bool accepted = true) =>
            new() { CertificationStatus = s, ModeOfAssessment = mode, JoinRoomStatus = join, IsSelfieSynced = selfie, DesktopAccepted = accepted };
        Assert.Equal(2, MonitoringInsights.StageOf(PortalSystem.Main, F(2)));
        Assert.Equal(2, MonitoringInsights.StageOf(PortalSystem.Main, F(8)));
        Assert.Equal(2, MonitoringInsights.StageOf(PortalSystem.Main, F(9, "Remote Assessment", join: 0)));
        Assert.Equal(3, MonitoringInsights.StageOf(PortalSystem.Main, F(9, "Remote Assessment", join: 1)));
        Assert.Equal(3, MonitoringInsights.StageOf(PortalSystem.Main, F(9)));
        Assert.Equal(3, MonitoringInsights.StageOf(PortalSystem.Main, F(13)));
        Assert.Equal(4, MonitoringInsights.StageOf(PortalSystem.Main, F(14)));
        Assert.Equal(5, MonitoringInsights.StageOf(PortalSystem.Main, F(5)));
        Assert.Equal(7, MonitoringInsights.StageOf(PortalSystem.Main, F(17)));
        Assert.Null(MonitoringInsights.StageOf(PortalSystem.Main, F(1)));
        // Surveillance: desktop scheduled at 1, running at 2-3; a visit starts once the selfie is synced.
        Assert.Equal(2, MonitoringInsights.StageOf(PortalSystem.Surveillance, F(1)));
        Assert.Equal(3, MonitoringInsights.StageOf(PortalSystem.Surveillance, F(2)));
        Assert.Equal(2, MonitoringInsights.StageOf(PortalSystem.Surveillance, F(9, selfie: 0)));
        Assert.Equal(3, MonitoringInsights.StageOf(PortalSystem.Surveillance, F(9, selfie: 1)));

        Assert.Equal("desktop", MonitoringInsights.TrackOf(PortalSystem.Main, 5, 0));
        Assert.Equal("site", MonitoringInsights.TrackOf(PortalSystem.Main, 8, 0));
        Assert.Equal("m2", MonitoringInsights.TrackOf(PortalSystem.Consultancy, 15, 2));
    }

    [Fact]
    public void The_date_range_follows_the_stage()
    {
        var f = new MonitoringInsights.Fact
        {
            CertificationStatus = 8, CertificationStatusDate = Today.AddDays(-1), ScheduledOn = Today.AddDays(-4), DocVerifiAllot = Today.AddDays(-30),
            AssessmentDate = Today.AddDays(2),
        };
        Assert.Equal(Today.AddDays(-4), MonitoringInsights.StageDate(PortalSystem.Main, 2, f));     // site allotted on
        var d = new MonitoringInsights.Fact { CertificationStatus = 2, CertificationStatusDate = Today, DocVerifiAllot = Today.AddDays(-30) };
        Assert.Equal(Today.AddDays(-30), MonitoringInsights.StageDate(PortalSystem.Main, 2, d));    // desktop allotted on
        var site = new MonitoringInsights.Fact { CertificationStatus = 9, CertificationStatusDate = Today, AssessmentDate = Today.AddDays(-2) };
        Assert.Equal(Today.AddDays(-2), MonitoringInsights.StageDate(PortalSystem.Main, 3, site));  // assessment date
        var qc = new MonitoringInsights.Fact { CertificationStatus = 15, CertificationStatusDate = Today.AddDays(-6), AssessmentDate = Today.AddDays(-9) };
        Assert.Equal(Today.AddDays(-6), MonitoringInsights.StageDate(PortalSystem.Main, 5, qc));    // submitted on
        Assert.Equal(Today.AddDays(-6), MonitoringInsights.StageDate(PortalSystem.Main, 4, qc));    // NC raised on
        Assert.Equal(Today.AddDays(-6), MonitoringInsights.StageDate(PortalSystem.Main, 7, qc));    // rejected on

        Assert.True(MonitoringInsights.InRange("2026-11-10T09:00:00", new DateOnly(2026, 11, 10), new DateOnly(2026, 11, 10)));
        Assert.False(MonitoringInsights.InRange("2026-11-09T23:59:00", new DateOnly(2026, 11, 10), null));
        Assert.False(MonitoringInsights.InRange(null, null, new DateOnly(2026, 11, 10)));
        Assert.True(MonitoringInsights.InRange(null, null, null));
    }

    [Fact]
    public async Task Quality_check_rows_carry_their_sub_section_and_delay_most_delayed_first()
    {
        var client = await SignIn("ADMIN1");
        var body = await client.GetFromJsonAsync<JsonElement>(Url + "?certification=Silver&status=5");

        Assert.Equal(["ZEDB", "ZEDC", "ZEDA"], Units(body).Select(u => u.GetProperty("ZedId").GetString()));
        var late = Unit(body, "ZEDB");
        Assert.Equal("site", late.GetProperty("Track").GetString());
        Assert.Equal(TatEvaluator.OverTen, late.GetProperty("TatBucket").GetString());
        Assert.Equal("13 days late", late.GetProperty("TatLabel").GetString());
        Assert.Equal("Days allowed in Site assessment quality check", late.GetProperty("TatRule").GetString());
        var desk = Unit(body, "ZEDA");
        Assert.Equal("desktop", desk.GetProperty("Track").GetString());
        Assert.Equal(TatEvaluator.OnTime, desk.GetProperty("TatBucket").GetString());
        Assert.StartsWith("On time", desk.GetProperty("TatLabel").GetString());
        Assert.Equal(TatEvaluator.OneToFive, Unit(body, "ZEDC").GetProperty("TatBucket").GetString());
        // The contact is given in full.
        Assert.Equal("9876543210", desk.GetProperty("UnitSpocMobileNo").GetString());
        Assert.Equal("ravi@unit.test", desk.GetProperty("UnitSpocEmailId").GetString());

        var qc = body.GetProperty("stages").EnumerateArray().Single(s => s.GetProperty("status").GetInt32() == 5);
        Assert.Equal(3, qc.GetProperty("total").GetInt32());
        Assert.Equal(1, qc.GetProperty("tracks").GetProperty("desktop").GetInt32());
        Assert.Equal(2, qc.GetProperty("tracks").GetProperty("site").GetInt32());
        Assert.Equal(2, qc.GetProperty("delayed").GetInt32());
        var progress = body.GetProperty("stages").EnumerateArray().Single(s => s.GetProperty("status").GetInt32() == 3);
        Assert.Equal(1, progress.GetProperty("tracks").GetProperty("desktop").GetInt32());
        Assert.Equal(3, progress.GetProperty("tracks").GetProperty("site").GetInt32());
        Assert.Equal(2, body.GetProperty("manDays").GetProperty("Silver").GetInt32());
    }

    [Fact]
    public async Task Site_assessments_in_progress_show_their_step_and_the_submission_pending_through_the_app()
    {
        var client = await SignIn("ADMIN1");
        var body = await client.GetFromJsonAsync<JsonElement>(Url + "?certification=Silver&status=3");

        var p = Unit(body, "ZEDP");
        Assert.Equal(MonitoringInsights.StepDistributed, p.GetProperty("Step").GetString());
        Assert.True(p.GetProperty("SubmissionPending").GetBoolean());      // assessment date + 2 man-days passed
        var q = Unit(body, "ZEDQ");
        Assert.Equal(MonitoringInsights.StepOpening, q.GetProperty("Step").GetString());
        Assert.False(q.GetProperty("SubmissionPending").GetBoolean());
        var r = Unit(body, "ZEDR");
        Assert.Equal(MonitoringInsights.StepSubmitted, r.GetProperty("Step").GetString());
        Assert.False(r.GetProperty("SubmissionPending").GetBoolean());      // submitted through the app
        var s = Unit(body, "ZEDS");
        Assert.Equal("desktop", s.GetProperty("Track").GetString());
        Assert.Equal(JsonValueKind.Null, s.GetProperty("Step").ValueKind);
        Assert.Equal(Today.AddDays(-5).ToString("yyyy-MM-dd'T'HH:mm:ss"), p.GetProperty("StageDate").GetString()); // the assessment date
    }

    [Fact]
    public async Task The_date_range_limits_the_list_on_the_stages_date()
    {
        var client = await SignIn("ADMIN1");
        var day = Today.AddDays(-5).ToString("yyyy-MM-dd");
        var body = await client.GetFromJsonAsync<JsonElement>($"{Url}?certification=Silver&status=5&from={day}&to={day}");
        Assert.Equal(["ZEDC"], Units(body).Select(u => u.GetProperty("ZedId").GetString()));
        // The stage cards are not limited by the range.
        Assert.Equal(3, body.GetProperty("stages").EnumerateArray().Single(s => s.GetProperty("status").GetInt32() == 5).GetProperty("total").GetInt32());

        foreach (var q in new[] { "&from=2026-13-01", "&to=18/11/2026", "&from=2026-11-18&to=2026-11-01" })
            Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync($"{Url}?certification=Silver&status=5{q}")).StatusCode);
    }

    [Fact]
    public async Task An_agency_reads_only_its_own_cases_and_the_master_admin_every_agencys()
    {
        var agency = await SignIn("AGENCYDA");
        await agency.GetFromJsonAsync<JsonElement>(Url + "?certification=Silver&status=5");
        var call = _host.Sql.Calls.Last(c => c.Name.StartsWith(MonitoringInsights.FactsPrefix));
        Assert.Equal("AGENCYDA", FakeSql.Arg(call.Args, "AgencyId"));

        var admin = await SignIn("ADMIN1");
        await admin.GetFromJsonAsync<JsonElement>(Url + "?certification=Silver&status=5");
        Assert.Null(FakeSql.Arg(_host.Sql.Calls.Last(c => c.Name.StartsWith(MonitoringInsights.FactsPrefix)).Args, "AgencyId"));
    }

    [Fact]
    public async Task An_operation_admin_counts_only_the_cases_of_its_scope()
    {
        _host.Sql.Queries[LoginScopes.Sql] = args => FakeSql.Arg(args, "UserId") == "ADMIN1"
            ? [new { SectorActivity = (string?)null, ScopeLevels = "Silver", ScopeStates = "9" }]
            : [];
        _host.Sql.Queries[ScopedUnits.StateUnitsSql] = _ =>
            [new { ZedId = "ZEDB", Activity = "Manufacturing", TwoDigitActivity = "10" }, new { ZedId = "ZEDP", Activity = "Manufacturing", TwoDigitActivity = "10" }];
        var client = await SignIn("ADMIN1");
        var body = await client.GetFromJsonAsync<JsonElement>(Url + "?status=5");

        Assert.Equal(["ZEDB"], Units(body).Select(u => u.GetProperty("ZedId").GetString()));
        var qc = body.GetProperty("stages").EnumerateArray().Single(s => s.GetProperty("status").GetInt32() == 5);
        Assert.Equal(1, qc.GetProperty("total").GetInt32());
        Assert.Equal(1, qc.GetProperty("tracks").GetProperty("site").GetInt32());
        Assert.Equal(1, body.GetProperty("stages").EnumerateArray().Single(s => s.GetProperty("status").GetInt32() == 3).GetProperty("total").GetInt32());
        // Only the scope's levels are read.
        var args = _host.Sql.Calls.Last(c => c.Name.StartsWith(MonitoringInsights.FactsPrefix)).Args!;
        Assert.Equal(["Silver"], (IEnumerable<string>)args.GetType().GetProperty("Levels")!.GetValue(args)!);
    }

    [Fact]
    public async Task Without_tat_rules_or_details_the_list_still_works()
    {
        _host.Sql.Queries.TryRemove(TatStore.StatusDaysSql, out _);
        _facts.Clear();
        var client = await SignIn("ADMIN1");
        var body = await client.GetFromJsonAsync<JsonElement>(Url + "?certification=Silver&status=5");
        var row = Unit(body, "ZEDB");
        Assert.Equal("site", row.GetProperty("Track").GetString());    // from the row's status
        Assert.Equal(JsonValueKind.Null, row.GetProperty("TatBucket").ValueKind);
        Assert.Equal(0, body.GetProperty("stages").EnumerateArray().Sum(s => s.GetProperty("delayed").GetInt32()));
    }
}
