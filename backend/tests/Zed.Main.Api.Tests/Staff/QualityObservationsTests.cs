using System.Net;
using System.Net.Http.Json;
using Zed.Portal.Features.Staff.Assessment;
using Zed.Portal.Features.Staff.Quality;
using Zed.TestSupport;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>
/// 2026-11-16 (approved): the ZED team's quality observations, the agency's replies, close / reopen, their time history,
/// the ranking, and the hold on the agency's final submit.
/// </summary>
public sealed class QualityObservationsTests : IDisposable
{
    private static readonly string[] AgencyTicks = [.. global::Zed.Core.Assessment.SubmissionChecklists.AgencyQcKind.Defaults.Select(i => i.Id)];
    private const string Zed = "ZEDMSME000001";
    private const string Base = "/api/staff/quality-observations";
    private readonly TestHost _host = new();
    private readonly List<object> _rows = [];
    private long _nextId = 100;

    public QualityObservationsTests()
    {
        UsersMastersLogin.Setup(_host);
        _host.Sql.Queries[AssessmentRecords.CertificationSql] = args => FakeSql.Arg(args, "ZedId") == Zed
            ? [new { ZedId = Zed, Certification = "Silver", CertificationStatus = 15, NcCount = 0, CertificationBodyUserId = "AGENCY1",
                DesktopAssessorId = "ASSESSOR9", SiteAssessorId = "ASSESSOR1", CoAssessorId = "ASSESSOR2" }]
            : [];
        _host.Sql.Queries[QualityObservations.InsertSql] = args =>
        {
            var id = ++_nextId;
            _rows.Add(new QualityObservations.Row
            {
                Id = id, ZedId = FakeSql.Arg(args, "ZedId"), Certification = FakeSql.Arg(args, "Certification"), AssessmentType = FakeSql.Arg(args, "Type"),
                Text = FakeSql.Arg(args, "Text"), At = DateTime.Now.AddHours(_rows.Count), QoStatus = FakeSql.Arg(args, "Status"),
                QoParentId = long.TryParse(FakeSql.Arg(args, "ParentId"), out var p) ? p : null, QoSeverity = FakeSql.Arg(args, "Severity"),
                QoCategory = FakeSql.Arg(args, "Category"), QoAbout = FakeSql.Arg(args, "About"), QoAboutUserId = FakeSql.Arg(args, "AboutUserId"),
                QoAgencyId = FakeSql.Arg(args, "AgencyId"), QoBy = FakeSql.Arg(args, "By"), QoRefLabel = FakeSql.Arg(args, "RefLabel"),
            });
            return [id];
        };
        _host.Sql.Queries[QualityObservations.UnitSql] = _ => _rows;
        _host.Sql.Queries[QualityObservations.AllSql] = _ => _rows;
        _host.Sql.Queries[QualityObservations.OneSql] = args => _rows.OfType<QualityObservations.Row>()
            .Where(r => r.Id.ToString() == FakeSql.Arg(args, "Id") && r.AssessmentType == QualityObservations.ObservationType);
        _host.Sql.Queries[QualityObservations.NamesSql] = _ =>
            [new { UserId = "AGENCY1", UserName = "Acme Assessors", Email = "agency1@zed.test" }, new { UserId = "ASSESSOR1", UserName = "R Sharma", Email = (string?)null }];
    }

    public void Dispose() => _host.Dispose();

    private QualityObservations.Row Obs(long id) => _rows.OfType<QualityObservations.Row>().Single(r => r.Id == id);

    [Fact]
    public async Task Master_admin_raises_the_agency_replies_and_the_history_and_ranking_follow()
    {
        var master = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        Assert.Equal("Please choose the reason.", await (await master.PostAsJsonAsync($"{Base}/{Zed}/Silver",
            new { category = "No such reason", about = "Lead", text = "x" })).ProblemTitle());

        var r = await master.PostAsJsonAsync($"{Base}/{Zed}/Silver", new
        {
            refType = "Requirement", refId = "51", refLabel = "3.2 Process control", category = "Conformance not justified", severity = "Minor",
            about = "Lead", text = "Yes given, but the photo shows no process sheet.",
        });
        r.EnsureSuccessStatusCode();
        var obs = _rows.OfType<QualityObservations.Row>().Single(x => x.AssessmentType == QualityObservations.ObservationType);
        Assert.Equal(("ASSESSOR1", "AGENCY1", "Open"), (obs.QoAboutUserId, obs.QoAgencyId, obs.QoStatus));
        // 2026-11-17: the severity is the reason's (Admin → Observation reasons), whatever the page sends.
        Assert.Equal(("Conformance not justified", "Major"), (obs.QoCategory, obs.QoSeverity));
        Assert.Contains(_rows.OfType<QualityObservations.Row>(), x => x.AssessmentType == QualityObservations.EventType && x.QoStatus == "Raised" && x.QoParentId == obs.Id);
        Assert.Contains(_host.Sql.Calls, c => c.Name.StartsWith("INSERT INTO dbo.MsmeHistory", StringComparison.Ordinal));
        var mail = Assert.Single(_host.Email.Sent);
        Assert.Equal("agency1@zed.test", mail.To);
        Assert.Contains("final submit of this assessment waits for your reply", mail.HtmlBody);

        // The agency sees it on the unit and replies; the master admin cannot reply.
        var agency = await UsersMastersLogin.SignInAsync(_host, "AGENCY1");
        var view = (await agency.GetFromJsonAsync<QualityObservationsController.UnitView>($"{Base}/{Zed}/Silver"))!;
        Assert.True(view.CanRespond);
        Assert.False(view.CanRaise);
        Assert.Equal("R Sharma", view.Items.Single().AboutName);
        Assert.Equal(HttpStatusCode.Forbidden, (await master.PostAsJsonAsync($"{Base}/items/{obs.Id}/respond", new { text = "x" })).StatusCode);
        (await agency.PostAsJsonAsync($"{Base}/items/{obs.Id}/respond", new { text = "Re-checked in NC 1." })).EnsureSuccessStatusCode();
        Assert.Contains(_host.Sql.Calls, c => c.Name == QualityObservations.StatusSql && FakeSql.Arg(c.Args, "Status") == "Responded");

        // Close, then reopen (a note is needed), with each step kept.
        (await master.PostAsJsonAsync($"{Base}/items/{obs.Id}/close", new { text = (string?)null })).EnsureSuccessStatusCode();
        typeof(QualityObservations.Row).GetProperty(nameof(QualityObservations.Row.QoStatus))!.SetValue(obs, "Closed");   // as the UPDATE did
        Assert.Equal("Please write why it is reopened.", await (await master.PostAsJsonAsync($"{Base}/items/{obs.Id}/reopen", new { text = "" })).ProblemTitle());
        var steps = _rows.OfType<QualityObservations.Row>().Where(x => x.QoParentId == obs.Id).Select(x => x.QoStatus).ToList();
        Assert.Equal(["Raised", "Responded", "Closed"], steps);
    }

    [Fact]
    public async Task An_assessor_sees_only_what_is_about_its_own_work()
    {
        var master = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        (await master.PostAsJsonAsync($"{Base}/{Zed}/Silver", new { category = "Conduct", severity = "Minor", about = "Lead", text = "Late." })).EnsureSuccessStatusCode();
        (await master.PostAsJsonAsync($"{Base}/{Zed}/Silver", new { category = "Other", severity = "Minor", about = "Agency", text = "Slow allotment." })).EnsureSuccessStatusCode();
        var assessor = await UsersMastersLogin.SignInAsync(_host, "ASSESSOR1");
        var view = (await assessor.GetFromJsonAsync<QualityObservationsController.UnitView>($"{Base}/{Zed}/Silver"))!;
        Assert.Equal(["Late."], view.Items.Select(i => i.Text));
        Assert.False(view.CanRespond || view.CanRaise || view.CanClose);
    }

    [Fact]
    public void Ranking_counts_weighted_observations_per_assessment_and_reply_times()
    {
        var t = new DateTime(2026, 11, 1, 10, 0, 0);
        QualityObservations.Row O(long id, string zed, string agency, string sev, string status) => new()
        {
            Id = id, ZedId = zed, Certification = "Silver", AssessmentType = "QualityObs", At = t, QoStatus = status, QoSeverity = sev,
            QoAgencyId = agency, QoAbout = "Lead", QoAboutUserId = agency + "-SA",
        };
        QualityObservations.Row E(long id, long parent, string kind, int hours) => new()
        { Id = id, AssessmentType = "QualityEvt", QoParentId = parent, QoStatus = kind, At = t.AddHours(hours) };
        var items = QualityObservations.Build(
        [
            O(1, "U1", "A", "Critical", "Closed"), E(11, 1, "Raised", 0), E(12, 1, "Responded", 10), E(13, 1, "Closed", 20), E(14, 1, "Reopened", 21),
            O(2, "U2", "B", "Minor", "Open"), E(21, 2, "Raised", 0),
            O(3, "U3", "B", "Minor", "Responded"), E(31, 3, "Raised", 0), E(32, 3, "Responded", 4),
        ], new Dictionary<string, string>());
        Assert.Equal(10, items.Single(i => i.Id == 1).ReplyHours);
        Assert.Equal(1, items.Single(i => i.Id == 1).Reopens);

        var agencies = QualityObservations.Rank(items, "Agency");
        Assert.Equal(["B", "A"], agencies.Select(a => a.UserId));   // 1 point per assessment beats 5
        Assert.Equal((1, 2, 1.0), (agencies[0].Rank, agencies[0].Assessments, agencies[0].Score));
        Assert.Equal(["B-SA", "A-SA"], QualityObservations.Rank(items, "Assessor").Select(a => a.UserId));
    }

    private static object? Raw(object? args, string name) =>
        args?.GetType().GetProperty(name)?.GetValue(args) switch { Dapper.DbString s => s.Value, var v => v };

    [Fact]
    public async Task The_date_range_and_the_certification_level_reach_the_query()
    {
        var master = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        (await master.GetAsync($"{Base}?from=2026-11-01&to=2026-11-15&level=gold")).EnsureSuccessStatusCode();
        var call = _host.Sql.Calls.Last(c => c.Name == QualityObservations.AllSql);
        // Raised on or after From, before the day after To; the level in its stored spelling.
        Assert.Equal((new DateTime(2026, 11, 1), new DateTime(2026, 11, 16), "Gold"),
            ((DateTime)Raw(call.Args, "From")!, (DateTime?)Raw(call.Args, "Before"), (string?)Raw(call.Args, "Certification")));

        // The dashboard (counts, rankings, categories and the CSV made from them) takes the same filters; a preset has no end.
        (await master.GetAsync($"{Base}/dashboard?days=30&level=Silver")).EnsureSuccessStatusCode();
        call = _host.Sql.Calls.Last(c => c.Name == QualityObservations.AllSql);
        Assert.Equal((DateTime.Today.AddDays(-30), null, "Silver"),
            ((DateTime)Raw(call.Args, "From")!, (DateTime?)Raw(call.Args, "Before"), (string?)Raw(call.Args, "Certification")));

        // No level: every level (NULL); a From alone overrides the preset.
        (await master.GetAsync($"{Base}/dashboard?days=30&from=2026-10-05")).EnsureSuccessStatusCode();
        call = _host.Sql.Calls.Last(c => c.Name == QualityObservations.AllSql);
        Assert.Equal((new DateTime(2026, 10, 5), null, null),
            ((DateTime)Raw(call.Args, "From")!, (DateTime?)Raw(call.Args, "Before"), (string?)Raw(call.Args, "Certification")));
    }

    [Theory]
    [InlineData("from=2026-02-31", "Please enter valid dates (dd-mm-yyyy).")]
    [InlineData("to=yesterday", "Please enter valid dates (dd-mm-yyyy).")]
    [InlineData("from=0001-01-01", "Please enter valid dates (dd-mm-yyyy).")]
    [InlineData("from=2026-11-10&to=2026-11-01", "The To date cannot be before the From date.")]
    [InlineData("to=2999-01-01", "The dates cannot be after today.")]
    [InlineData("level=NoSuchLevel", "Invalid certification level.")]
    public async Task Bad_dates_and_levels_are_refused(string query, string message)
    {
        var master = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        foreach (var path in new[] { $"{Base}?{query}", $"{Base}/dashboard?{query}" })
        {
            var r = await master.GetAsync(path);
            Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
            Assert.Equal(message, await r.ProblemTitle());
        }
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == QualityObservations.AllSql);
    }

    [Fact]
    public async Task Open_major_observations_hold_the_agencys_final_submit()
    {
        _host.Sql.Queries[QualityObservations.BlockingSql] = _ => [2];
        _host.Sql.Queries[AssessmentRecords.CertificationSql] = _ =>
            [new { ZedId = Zed, Certification = "Silver", CertificationStatus = 15, NcCount = 0, CertificationBodyUserId = "AGENCY1" }];
        var agency = await UsersMastersLogin.SignInAsync(_host, "AGENCY1");
        var r = await agency.PostAsJsonAsync($"/api/staff/monitoring/review/{Zed}/Silver/final-submit", new { checklist = AgencyTicks });
        Assert.Equal(QualityObservations.BlockingMessage(2), await r.ProblemTitle());
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.Contains("FINAL_SUBMIT", StringComparison.Ordinal));
    }
}
