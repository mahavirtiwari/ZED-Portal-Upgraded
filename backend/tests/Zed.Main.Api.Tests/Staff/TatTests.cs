using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Core.Http;
using Zed.Portal.Features.CertLevels;
using Zed.Portal.Features.Staff.Tat;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>2026-11-18 (the user's decisions "TAT and monitoring"): the TAT rules, their evaluation and Administration → TAT.</summary>
public sealed class TatTests : IDisposable
{
    private const string Url = "/api/staff/settings/tat";
    private static readonly DateTime Now = new(2026, 11, 18, 12, 0, 0);
    private readonly TestHost _host = new();
    private readonly List<object> _relations = [];
    private readonly List<object> _days = [];

    public TatTests()
    {
        UsersMastersLogin.Setup(_host);
        _host.Sql.Queries[TatStore.RelationsSql] = _ => _relations;
        _host.Sql.Queries[TatStore.StatusDaysSql] = _ => _days;
        _host.Sql.Queries[TatController.StatusMasterSql] = _ =>
        [
            new { SNo = 14, Status = "15", Descrip = "QUALITY CHECK", MonitoringGetList = (string?)null },
            new { SNo = 3, Status = "Text", Descrip = "3", MonitoringGetList = "DA VERIFICATION IN PROGRESS" },
        ];
    }

    public void Dispose() => _host.Dispose();

    private static TatCase Case(string status, DateTime? since, Dictionary<string, DateTime>? reached = null, string[]? passed = null, bool ended = false) =>
        new("Silver", status, since, reached ?? [], passed, ended);

    // ------------------------------------------------------------------ evaluator

    [Fact]
    public void The_current_status_rule_gives_the_due_date_and_the_delay()
    {
        var rules = new TatRules([new("Silver", "15", 3), new("Gold", "15", 10)], []);
        var result = TatEvaluator.Evaluate(Case("15", Now.AddDays(-5)), rules, Now);

        Assert.NotNull(result.Current);
        Assert.Equal(Now.AddDays(-2), result.Current!.Due);
        Assert.Equal(48, result.Current.LateHours, 3);
        Assert.Same(result.Current, result.Primary);
        Assert.Equal(TatEvaluator.OneToFive, TatEvaluator.Bucket(result.Primary!.LateHours));
        Assert.Equal("2 days late", TatEvaluator.Label(result.Primary.LateHours));

        // No days for the status at that level: no TAT (nothing hard-coded).
        Assert.Null(TatEvaluator.Evaluate(Case("14", Now.AddDays(-50)), rules, Now).Primary);
        Assert.Null(TatEvaluator.Evaluate(Case("15", Now.AddDays(-50)) with { Level = "Bronze" }, rules, Now).Primary);
        Assert.Null(TatEvaluator.Bucket(null));
    }

    [Fact]
    public void Relations_run_from_their_start_until_their_end_is_reached()
    {
        var rules = new TatRules([],
        [
            new(1, "Registration to certification", null, "registered", "16", 90),
            new(2, "Allocation to desktop assessment", null, "2", "6", 15),
            new(3, "Scheduled to submission", "Silver", "8", "13", 10),
            new(4, "Gold only", "Gold", "8", "13", 1),
            new(5, "Inactive", null, "8", "13", 1, IsActive: false),
            new(6, "Site NC to closure", null, "14", "nc-closed", 60),
        ]);
        var reached = new Dictionary<string, DateTime>
        {
            ["registered"] = Now.AddDays(-100), ["2"] = Now.AddDays(-40), ["8"] = Now.AddDays(-12), ["14"] = Now.AddDays(-3),
            ["nc-closed"] = Now.AddDays(-20), // an earlier NC's closure: before this NC started, so the relation still runs
        };
        var result = TatEvaluator.Evaluate(Case("14", Now.AddDays(-3), reached, passed: ["1", "2", "3", "4", "5", "6", "8", "9", "13"]), rules, Now);

        Assert.Null(result.Current);
        Assert.Equal(["Registration to certification", "Site NC to closure"], result.Relations.Select(r => r.Name));
        var reg = result.Relations[0];
        Assert.Equal(Now.AddDays(-10), reg.Due);
        Assert.True(reg.IsLate);
        Assert.False(result.Relations[1].IsLate);
        Assert.Same(reg, result.Primary);   // no status rule: the most delayed relation
        Assert.Same(reg, result.Worst);

        // Not started: nothing; the end reached on or after the start: finished.
        var done = TatEvaluator.Evaluate(Case("16", Now, new() { ["registered"] = Now.AddDays(-30), ["16"] = Now }), rules, Now);
        Assert.Empty(done.Relations);
        Assert.Empty(TatEvaluator.Evaluate(Case("1", Now.AddDays(-1)), rules, Now).Relations);
        // An ended case (certified, rejected) has no TAT.
        Assert.Same(TatResult.Empty, TatEvaluator.Evaluate(Case("15", Now.AddDays(-9), reached, ended: true), rules, Now));
    }

    [Fact]
    public void The_status_rule_comes_first_and_worst_is_the_most_late()
    {
        var rules = new TatRules([new("Silver", "15", 10)], [new(1, "Registration to certification", null, "registered", "16", 30)]);
        var result = TatEvaluator.Evaluate(Case("15", Now.AddDays(-2), new() { ["registered"] = Now.AddDays(-60) }), rules, Now);
        Assert.Equal("status", result.Primary!.Kind);
        Assert.False(result.Primary.IsLate);
        Assert.Equal("relation", result.Worst!.Kind);
    }

    [Theory]
    [InlineData(-30, "on-time")]
    [InlineData(0, "on-time")]
    [InlineData(0.5, "lt1")]
    [InlineData(23.9, "lt1")]
    [InlineData(24, "1-5")]
    [InlineData(120, "1-5")]
    [InlineData(121, "5-10")]
    [InlineData(240, "5-10")]
    [InlineData(241, "gt10")]
    public void Delays_fall_in_the_monitoring_chips(double lateHours, string bucket) => Assert.Equal(bucket, TatEvaluator.Bucket(lateHours));

    [Theory]
    [InlineData(18, "18 hours late")]
    [InlineData(0.2, "1 hour late")]
    [InlineData(24 * 13 + 2, "13 days late")]
    [InlineData(30, "1 day late")]
    [InlineData(-50, "On time · 2 days left")]
    [InlineData(-5, "On time · due in 5 hours")]
    public void Delays_are_labelled(double lateHours, string label) => Assert.Equal(label, TatEvaluator.Label(lateHours));

    [Fact]
    public void The_case_is_read_from_its_status_and_history()
    {
        var sources = new Dictionary<string, DateTime?>
        {
            ["ApplicationReceived"] = Now.AddDays(-50), ["DocVerifiAllot"] = Now.AddDays(-40), ["ScheduledOn"] = Now.AddDays(-10),
            ["Nc1Raised"] = Now.AddDays(-3), [TatCatalog.OpenMeeting] = Now.AddDays(-8),
        };
        var c = TatEvaluator.BuildCase(PortalSystem.Main, "Silver", 14, Now.AddDays(-2), sources);
        Assert.Equal(Now.AddDays(-50), c.Reached["registered"]);
        Assert.Equal(Now.AddDays(-40), c.Reached["2"]);
        Assert.Equal(Now.AddDays(-8), c.Reached["opening-meeting"]);
        Assert.Equal(Now.AddDays(-3), c.Reached["14"]);       // NC raised after the visit was scheduled: the site NC
        Assert.False(c.Reached.ContainsKey("4"));
        Assert.Contains("13", c.Passed!);
        Assert.DoesNotContain("7", c.Passed!);                // a rejection is never passed
        Assert.False(c.Ended);

        var desktopNc = TatEvaluator.BuildCase(PortalSystem.Main, "Bronze", 4, Now.AddDays(-1), new Dictionary<string, DateTime?> { ["Nc1Raised"] = Now.AddDays(-6) });
        Assert.Equal(Now.AddDays(-6), desktopNc.Reached["4"]);
        // The current status without a source: since its status date.
        Assert.Equal(Now.AddDays(-1), TatEvaluator.BuildCase(PortalSystem.Main, "Silver", 15, Now.AddDays(-1), new Dictionary<string, DateTime?>()).Reached["15"]);
        Assert.True(TatEvaluator.BuildCase(PortalSystem.Main, "Silver", 17, Now, new Dictionary<string, DateTime?>()).Ended);
        Assert.True(TatEvaluator.BuildCase(PortalSystem.Main, "Bronze", 6, Now, new Dictionary<string, DateTime?> { ["GetCertified"] = Now }).Ended);
        Assert.True(TatEvaluator.BuildCase(PortalSystem.Consultancy, "Gold", 100, Now, new Dictionary<string, DateTime?>()).Ended);
    }

    [Fact]
    public void Each_portal_lists_its_own_statuses_and_suggestions()
    {
        Assert.Equal("Assessment", TatCatalog.ModuleOf(PortalSystem.Main));
        Assert.Equal("Handholding", TatCatalog.ModuleOf(PortalSystem.Consultancy));
        Assert.Equal("Surveillance", TatCatalog.ModuleOf(PortalSystem.Surveillance));
        foreach (var system in Enum.GetValues<PortalSystem>())
        {
            var codes = TatCatalog.For(system).Select(p => p.Code).ToList();
            Assert.Equal(codes.Count, codes.Distinct(StringComparer.OrdinalIgnoreCase).Count());
            foreach (var s in TatCatalog.Suggestions(system))
            {
                Assert.NotNull(TatCatalog.Find(system, s.From));
                Assert.NotNull(TatCatalog.Find(system, s.To));
            }
        }
        Assert.Contains(TatCatalog.Suggestions(PortalSystem.Main), s => s.Name == "Registration to certification");
        Assert.Contains(TatCatalog.Suggestions(PortalSystem.Consultancy), s => s.Name == "Milestone payment to deliverables accepted");
        Assert.DoesNotContain(TatCatalog.TimedStatuses(PortalSystem.Main), p => p.Code is "16" or "7" or "17");
    }

    // ------------------------------------------------------------------ validation

    [Fact]
    public void Status_days_and_relations_are_checked()
    {
        Assert.Null(TatStore.StatusDaysProblem(PortalSystem.Main, "15", 3));
        Assert.Null(TatStore.StatusDaysProblem(PortalSystem.Main, "15", null));
        Assert.NotNull(TatStore.StatusDaysProblem(PortalSystem.Main, "99", 3));
        Assert.NotNull(TatStore.StatusDaysProblem(PortalSystem.Main, "registered", 3));   // a milestone takes no days
        Assert.NotNull(TatStore.StatusDaysProblem(PortalSystem.Main, "16", 3));           // final status
        Assert.NotNull(TatStore.StatusDaysProblem(PortalSystem.Main, "15", 0));
        Assert.NotNull(TatStore.StatusDaysProblem(PortalSystem.Main, "15", 366));

        TatRelation[] others = [new(1, "Allocation", null, "2", "6", 15), new(2, "Gold rule", "Gold", "8", "13", 5)];
        string? P(string? name, string? level, string? from, string? to, int? days) => TatStore.RelationProblem(PortalSystem.Main, name, level, from, to, days, others);
        Assert.Null(P("Site to NC closure", null, "14", "nc-closed", 60));
        Assert.Null(P("Gold rule", "Silver", "8", "13", 5));                     // same name, another level
        Assert.NotNull(P(" ", null, "2", "6", 5));
        Assert.NotNull(P(new string('x', 101), null, "2", "6", 5));
        Assert.NotNull(P("X", "Platinum", "2", "6", 5));
        Assert.NotNull(P("X", null, "nope", "6", 5));
        Assert.NotNull(P("X", null, "2", "nope", 5));
        Assert.NotNull(P("X", null, "2", "2", 5));
        Assert.NotNull(P("X", null, "16", "2", 5));                               // from a final status
        Assert.NotNull(P("X", null, "2", "6", 0));
        Assert.NotNull(P("X", null, "2", "6", 1000));
        Assert.Contains("already exists", P("allocation", null, "2", "8", 5));
        // Handholding levels only on the Consultancy portal.
        Assert.NotNull(TatStore.RelationProblem(PortalSystem.Consultancy, "X", "Bronze", "8", "13", 5, []));
        Assert.Null(TatStore.RelationProblem(PortalSystem.Consultancy, "X", "gold", "8", "13", 5, []));
    }

    [Fact]
    public void Man_days_decide_the_submission_pending_through_the_app()
    {
        Assert.Null(LevelManDays.Problem(null, 3));
        Assert.NotNull(LevelManDays.Problem(0, null));
        Assert.NotNull(LevelManDays.Problem(null, 31));
        var start = new DateTime(2026, 11, 15, 16, 30, 0);
        Assert.False(LevelManDays.SubmissionPending(null, start, false, 3, new DateTime(2026, 11, 17, 23, 0, 0)));
        Assert.True(LevelManDays.SubmissionPending(null, start, false, 3, new DateTime(2026, 11, 18, 0, 0, 0)));
        Assert.False(LevelManDays.SubmissionPending(null, start, true, 3, Now));             // submitted
        Assert.False(LevelManDays.SubmissionPending(null, start, false, null, Now));         // no man-days for the level
        Assert.False(LevelManDays.SubmissionPending(null, null, false, 2, Now));             // not started
        // The opening meeting is the start when there is one.
        Assert.False(LevelManDays.SubmissionPending(Now.AddDays(-1), start, false, 2, Now));
    }

    // ------------------------------------------------------------------ Administration → TAT

    private Task<HttpClient> SignIn(string user) => UsersMastersLogin.SignInAsync(_host, user);

    private List<(string Name, object? Args)> Writes(string sql) => _host.Sql.Calls.Where(c => c.Name == sql).ToList();

    [Fact]
    public async Task Only_the_admin_sees_the_tat()
    {
        var anon = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.GetAsync(Url)).StatusCode);
        var master = await SignIn("MASTER1");
        Assert.Equal(HttpStatusCode.Forbidden, (await master.GetAsync(Url)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await master.PostAsJsonAsync(Url + "/relations", new { name = "X", fromStatus = "2", toStatus = "6", days = 5 })).StatusCode);
        Assert.Empty(Writes(TatStore.InsertRelationSql));
    }

    [Fact]
    public async Task The_admin_reads_every_status_per_level_and_the_relations()
    {
        _days.Add(new { Certification = "Silver", StatusCode = "15", Days = 3 });
        _days.Add(new { Certification = "Platinum", StatusCode = "15", Days = 3 });   // not a level: left out
        _relations.Add(new { Id = 7, Name = "Registration to certification", Certification = (string?)null, FromStatus = "registered", ToStatus = "16", Days = 90, IsActive = true, SortOrder = 1 });
        var client = await SignIn("ADMIN1");
        var body = await client.GetFromJsonAsync<JsonElement>(Url);

        Assert.Equal("Assessment", body.GetProperty("module").GetString());
        var statuses = body.GetProperty("statuses").EnumerateArray().ToList();
        Assert.Contains(statuses, s => s.GetProperty("code").GetString() == "13" && s.GetProperty("name").GetString() == "Assessment submitted through mobile app");
        Assert.True(statuses.Single(s => s.GetProperty("code").GetString() == "16").GetProperty("final").GetBoolean());
        Assert.Equal("Quality Check", statuses.Single(s => s.GetProperty("code").GetString() == "15").GetProperty("systemText").GetString());
        Assert.Equal("Da Verification In Progress", statuses.Single(s => s.GetProperty("code").GetString() == "3").GetProperty("systemText").GetString());
        Assert.DoesNotContain(statuses, s => s.GetProperty("code").GetString() == "registered");
        Assert.Contains(body.GetProperty("points").EnumerateArray(), p => p.GetProperty("code").GetString() == "registered" && p.GetProperty("kind").GetString() == "milestone");
        Assert.Contains(body.GetProperty("levels").EnumerateArray(), l => l.GetProperty("code").GetString() == "Silver");
        Assert.Equal(3, body.GetProperty("days").GetProperty("Silver").GetProperty("15").GetInt32());
        Assert.False(body.GetProperty("days").TryGetProperty("Platinum", out _));
        Assert.Equal(7, body.GetProperty("relations")[0].GetProperty("id").GetInt32());
        var suggestions = body.GetProperty("suggestions").EnumerateArray().ToList();
        Assert.True(suggestions.Single(s => s.GetProperty("name").GetString() == "Registration to certification").GetProperty("added").GetBoolean());
        Assert.False(suggestions.Single(s => s.GetProperty("name").GetString() == "Allocation to desktop assessment").GetProperty("added").GetBoolean());
    }

    [Fact]
    public async Task The_admin_saves_a_levels_days()
    {
        var client = await SignIn("ADMIN1");
        var res = await client.PutAsJsonAsync(Url + "/days/silver", new { days = new object[] { new { status = "15", days = 3 }, new { status = "5", days = (int?)null } } });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var writes = Writes(TatStore.SaveStatusDaySql);
        Assert.Equal(2, writes.Count);
        Assert.Equal("Silver", FakeSql.Arg(writes[0].Args, "Certification"));
        Assert.Equal("15", FakeSql.Arg(writes[0].Args, "StatusCode"));
        Assert.Equal("3", FakeSql.Arg(writes[0].Args, "Days"));
        Assert.Equal("ADMIN1", FakeSql.Arg(writes[0].Args, "UpdatedBy"));
        Assert.Null(FakeSql.Arg(writes[1].Args, "Days"));

        foreach (var (url, payload) in new (string, object)[]
        {
            ("/days/Platinum", new { days = new[] { new { status = "15", days = 3 } } }),
            ("/days/Silver", new { days = new[] { new { status = "15", days = 400 } } }),
            ("/days/Silver", new { days = new[] { new { status = "16", days = 3 } } }),
            ("/days/Silver", new { days = new[] { new { status = "15", days = 3 }, new { status = "15", days = 4 } } }),
            ("/days/Silver", new { days = Array.Empty<object>() }),
        })
            Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync(Url + url, payload)).StatusCode);
        Assert.Equal(2, Writes(TatStore.SaveStatusDaySql).Count);
    }

    [Fact]
    public async Task The_admin_adds_changes_and_deletes_relations()
    {
        _relations.Add(new { Id = 3, Name = "Allocation to desktop assessment", Certification = (string?)null, FromStatus = "2", ToStatus = "6", Days = 15, IsActive = true, SortOrder = 1 });
        var client = await SignIn("ADMIN1");

        var add = await client.PostAsJsonAsync(Url + "/relations", new { name = " Site assessment to NC closure ", certification = "gold", fromStatus = "14", toStatus = "NC-CLOSED", days = 60 });
        Assert.Equal(HttpStatusCode.OK, add.StatusCode);
        var insert = Assert.Single(Writes(TatStore.InsertRelationSql));
        Assert.Equal("Site assessment to NC closure", FakeSql.Arg(insert.Args, "Name"));
        Assert.Equal("Gold", FakeSql.Arg(insert.Args, "Certification"));
        Assert.Equal("nc-closed", FakeSql.Arg(insert.Args, "ToStatus"));
        Assert.Equal("True", FakeSql.Arg(insert.Args, "IsActive"));

        var duplicate = await client.PostAsJsonAsync(Url + "/relations", new { name = "allocation to desktop assessment", fromStatus = "2", toStatus = "8", days = 5 });
        Assert.Equal(HttpStatusCode.BadRequest, duplicate.StatusCode);
        Assert.Contains("already exists", await duplicate.ProblemTitle());

        Assert.Equal(HttpStatusCode.NotFound, (await client.PutAsJsonAsync(Url + "/relations/99", new { name = "X", fromStatus = "2", toStatus = "6", days = 5 })).StatusCode);
        var update = await client.PutAsJsonAsync(Url + "/relations/3", new { name = "Allocation to desktop assessment", fromStatus = "2", toStatus = "6", days = 20, isActive = false });
        Assert.Equal(HttpStatusCode.OK, update.StatusCode);
        var upd = Assert.Single(Writes(TatStore.UpdateRelationSql));
        Assert.Equal("3", FakeSql.Arg(upd.Args, "Id"));
        Assert.Equal("False", FakeSql.Arg(upd.Args, "IsActive"));
        Assert.Equal("20", FakeSql.Arg(upd.Args, "Days"));

        Assert.Equal(HttpStatusCode.NotFound, (await client.DeleteAsync(Url + "/relations/99")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.DeleteAsync(Url + "/relations/3")).StatusCode);
        Assert.Equal("3", FakeSql.Arg(Assert.Single(Writes(TatStore.DeleteRelationSql)).Args, "Id"));
    }

    [Fact]
    public async Task Suggested_relations_are_added_only_on_request_and_only_once()
    {
        _relations.Add(new { Id = 3, Name = "Allocation to desktop assessment", Certification = (string?)null, FromStatus = "2", ToStatus = "6", Days = 15, IsActive = true, SortOrder = 1 });
        var client = await SignIn("ADMIN1");
        await client.GetFromJsonAsync<JsonElement>(Url);
        Assert.Empty(Writes(TatStore.InsertRelationSql));   // never added on their own

        var body = await (await client.PostAsync(Url + "/relations/suggested", null)).Content.ReadFromJsonAsync<JsonElement>();
        var expected = TatCatalog.Suggestions(PortalSystem.Main).Count - 1;
        Assert.Equal(expected, body.GetProperty("added").GetInt32());
        var names = Writes(TatStore.InsertRelationSql).Select(w => FakeSql.Arg(w.Args, "Name")).ToList();
        Assert.DoesNotContain("Allocation to desktop assessment", names);
        Assert.Contains("Registration to certification", names);
    }
}
