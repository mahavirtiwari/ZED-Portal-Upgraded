using System.Data.Common;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.Attention;
using Zed.Portal.Features.Staff.Users;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>2026-11-17 (staff redesign): the bell's and the dashboard's work counts (GET api/staff/attention), per role and scope.</summary>
public sealed class AttentionTests : IDisposable
{
    private const string Url = "/api/staff/attention";
    private readonly TestHost _host = new();
    private static readonly string Yesterday = DateTime.Today.AddDays(-1).ToString("yyyy-MM-dd");
    private static readonly string Tomorrow = DateTime.Today.AddDays(1).ToString("yyyy-MM-dd");

    public AttentionTests()
    {
        // The site-assessment test users, and MASTER1 (Master Admin).
        var users = new Dictionary<string, (int Role, int Da, int Sa, int Fa)>(SiteAssessmentTestUsers.Users, StringComparer.OrdinalIgnoreCase) { ["MASTER1"] = (7, 1, 1, 1) };
        _host.Sql.Procs["SP_GET_USER_DETAILS"] = args =>
            FakeSql.Arg(args, "UserId") is { } id && users.TryGetValue(id, out var u)
                ? FakeSql.Sets([new { UserId = id, UserName = id + " name", RoleId = u.Role, Email = "x@y.test" }], [new { ERRORMSG = "SUCCESS" }])
                : FakeSql.Sets([], [new { ERRORMSG = "INVALID CREDENTIAILS" }]);
        _host.Sql.Procs["SP_GET_SUB_ROLE"] = args =>
        {
            var u = users[FakeSql.Arg(args, "UserId")!];
            return FakeSql.Sets([new { DesktopVerification = u.Da, SiteVerification = u.Sa, FinancialVerification = u.Fa }]);
        };

        _host.Sql.Procs["SP_ASSESSMENT_ALLOT_LIST"] = args => (FakeSql.Arg(args, "RoleId"), FakeSql.Arg(args, "AllotmentType")) switch
        {
            // The Allot page: two to allot, one rejected by the agency, one left for 72 hours, one allotted and waiting.
            ("7", null) => FakeSql.Sets(
            [
                Row("ZEDM1", "Bronze"), Row("ZEDS2", "Silver"),
                Row("ZEDM3", "Silver", ("CertificationBodyUserId", "AGENCY1"), ("ReasonForRejection", "No capacity")),
                Row("ZEDM4", "Gold", ("CertificationBodyUserId", "AGENCY1"), ("TimeDuration", "Reallot")),
                Row("ZEDM5", "Bronze", ("CertificationBodyUserId", "AGENCY1")),
            ]),
            // DA Allotment: one pending, one rejected by the assessor, one allotted.
            ("2", "DA") => FakeSql.Sets(
            [
                Row("ZEDM1", "Bronze"),
                Row("ZEDM2", "Bronze", ("DesktopAssessorId", "ASR1"), ("DesktopReasonForRejection", "Busy")),
                Row("ZEDM3", "Bronze", ("DesktopAssessorId", "ASR1")),
            ]),
            // SA Allotment: one waiting, one allotted, one rejected by the agency.
            ("2", "SA") => FakeSql.Sets(
            [
                Row("ZEDM6", "Silver"), Row("ZEDM7", "Gold", ("SiteAssessorId", "ASR1")), Row("ZEDM8", "Gold", ("ReasonForRejection", "No")),
            ]),
            // Desktop verification: one to accept, two to assess, one rejected.
            ("3", null) => FakeSql.Sets(
            [
                Row("ZEDM1", "Bronze"), Row("ZEDM2", "Bronze", ("DesktopAccepted", true)), Row("ZEDM3", "Bronze", ("DesktopAccepted", "1")),
                Row("ZEDM4", "Bronze", ("DesktopReasonForRejection", "No")),
            ]),
            // Non-conformances: one answered at DA 4, one answered at SA 14, one waiting for the unit.
            ("3", "NC") => FakeSql.Sets(
            [
                Row("ZEDM1", "Bronze", ("NcStatus", 2), ("CertificationStatus", 4)), Row("ZEDM2", "Silver", ("NcStatus", "2"), ("CertificationStatus", 14)),
                Row("ZEDM3", "Silver", ("NcStatus", 1), ("CertificationStatus", 14)),
            ]),
            // Remote / onsite: one overdue, one today, one next week, one to review.
            ("3", "RA") => FakeSql.Sets(
            [
                Row("ZEDM1", "Silver", ("AssessmentDate", DateTime.Today.AddDays(-3).ToString("MMMM dd, yyyy", System.Globalization.CultureInfo.InvariantCulture)), ("CertificationStatus", 9)),
                Row("ZEDM2", "Silver", ("AssessmentDate", DateTime.Today.ToString("MMMM dd, yyyy", System.Globalization.CultureInfo.InvariantCulture)), ("CertificationStatus", 9)),
                Row("ZEDM3", "Gold", ("AssessmentDate", DateTime.Today.AddDays(7).ToString("MMMM dd, yyyy", System.Globalization.CultureInfo.InvariantCulture)), ("CertificationStatus", 8)),
                Row("ZEDM4", "Gold", ("AssessmentDate", DateTime.Today.AddDays(-9).ToString("MMMM dd, yyyy", System.Globalization.CultureInfo.InvariantCulture)), ("CertificationStatus", 13)),
            ]),
            _ => FakeSql.Sets(),
        };

        // Monitoring, per tab and level: NC tab (4) and quality check tab (5).
        _host.Sql.Procs["SP_MONITORING_GET_LIST"] = args =>
        {
            var rows = (FakeSql.Arg(args, "Status"), FakeSql.Arg(args, "CertificationType")) switch
            {
                ("4", "Bronze") => new[] { Row("ZEDM1", "Bronze", ("NcFinalClosureDtOrg", DateTime.Today.AddDays(-1)), ("NcStatus", 2)) },
                ("4", "Silver") => new[] { Row("ZEDS2", "Silver", ("NcFinalClosureDtOrg", Tomorrow), ("NcStatus", 1)), Row("ZEDM3", "Silver", ("NcFinalClosureDtOrg", Yesterday), ("NcStatus", 2)) },
                // Only the formatted date (an older procedure): still read.
                ("4", "Gold") => new[] { Row("ZEDM4", "Gold", ("NcFinalClosureDt", DateTime.Today.AddDays(-2).ToString("MMMM d, yyyy", System.Globalization.CultureInfo.InvariantCulture))) },
                ("5", "Silver") => new[] { Row("ZEDM6", "Silver") },
                ("5", "Gold") => new[] { Row("ZEDM7", "Gold") },
                _ => Array.Empty<Dictionary<string, object?>>(),
            };
            return FakeSql.Sets(rows, [new { NotStarted = 0, InProgress = 0, Qc = 0, Nc = 0, Rj = 0 }]);
        };

        _host.Sql.Queries[AttentionController.QualityOpenSql] = _ =>
            [new { ZedId = "ZEDM1", Certification = "Bronze" }, new { ZedId = "ZEDS2", Certification = "Silver" }, new { ZedId = "ZEDM3", Certification = "Gold" }];
        _host.Sql.Queries[AttentionController.QualityOpenForAgencySql] = args => FakeSql.Arg(args, "UserId") == "AGENCY1" ? [2] : [0];
    }

    public void Dispose() => _host.Dispose();

    private static Dictionary<string, object?> Row(string zedId, string level, params (string Key, object? Value)[] values)
    {
        var row = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase) { ["ZedId"] = zedId, ["Certification"] = level };
        foreach (var (k, v) in values) row[k] = v;
        return row;
    }

    private async Task<JsonElement> Attention(string user)
    {
        var client = await SiteAssessmentTestUsers.SignInAsync(_host, user);
        var r = await client.GetAsync(Url);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        return JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement;
    }

    private static Dictionary<string, JsonElement> Items(JsonElement body) =>
        body.GetProperty("items").EnumerateArray().ToDictionary(i => i.GetProperty("key").GetString()!);

    private static int Count(JsonElement body, string key) => Items(body)[key].GetProperty("count").GetInt32();

    private int Calls(string name) => _host.Sql.Calls.Count(c => c.Name.StartsWith(name, StringComparison.Ordinal));

    [Fact]
    public async Task Attention_needs_a_sign_in()
    {
        var client = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(Url)).StatusCode);
    }

    [Fact]
    public async Task Master_admin_sees_allotment_overdue_ncs_open_observations_and_re_allotment()
    {
        var body = await Attention("MASTER1");
        var items = Items(body);
        Assert.Equal(["allot", "reallot", "nc-overdue", "quality-open"], items.Keys);
        Assert.Equal(2, Count(body, "allot"));
        Assert.Equal(2, Count(body, "reallot"));
        Assert.Equal(3, Count(body, "nc-overdue"));    // Bronze yesterday, Silver yesterday, Gold (text) two days ago; not Silver tomorrow
        Assert.Equal(3, Count(body, "quality-open"));
        Assert.Equal(10, body.GetProperty("total").GetInt32());

        var allot = items["allot"];
        Assert.Equal("Units awaiting allotment", allot.GetProperty("label").GetString());
        Assert.Equal("/staff/assessment/allot", allot.GetProperty("link").GetString());
        Assert.Equal("ALLOT", allot.GetProperty("query").GetProperty("type").GetString());
        Assert.Equal("warn", allot.GetProperty("tone").GetString());
        Assert.Equal("REALLOT", items["reallot"].GetProperty("query").GetProperty("type").GetString());
        Assert.Equal("/staff/monitoring", items["nc-overdue"].GetProperty("link").GetString());
        Assert.Equal("4", items["nc-overdue"].GetProperty("query").GetProperty("status").GetString());
        Assert.Equal("bad", items["nc-overdue"].GetProperty("tone").GetString());
        Assert.Equal("/staff/quality-observations", items["quality-open"].GetProperty("link").GetString());

        // The procedures as the pages call them: the Master Admin's whole allot list, the NC tab of each level.
        var allotArgs = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_ASSESSMENT_ALLOT_LIST").Args;
        Assert.Equal("MASTER1", FakeSql.Arg(allotArgs, "UserId"));
        Assert.Null(FakeSql.Arg(allotArgs, "AllotmentType"));
        var monitoring = _host.Sql.Calls.Where(c => c.Name == "SP_MONITORING_GET_LIST").Select(c => c.Args).ToList();
        Assert.All(monitoring, a => Assert.Equal("4", FakeSql.Arg(a, "Status")));
        Assert.Contains(monitoring, a => FakeSql.Arg(a, "CertificationType") == "Bronze");
        Assert.Contains(monitoring, a => FakeSql.Arg(a, "CertificationType") == "Gold");
    }

    [Fact]
    public async Task A_scoped_master_admin_counts_only_its_units_and_levels()
    {
        // MASTER1 limited to Manufacturing, Bronze and Silver, in Uttar Pradesh: ZEDM1 and ZEDM3 are its units.
        _host.Sql.Queries[LoginScopes.Sql] = args => FakeSql.Arg(args, "UserId") == "MASTER1"
            ? [new { SectorActivity = "Manufacturing", ScopeLevels = "Bronze,Silver", ScopeStates = "9" }]
            : [];
        _host.Sql.Queries[ScopedUnits.StateUnitsSql] = _ =>
        [
            new { ZedId = "ZEDM1", Activity = "Manufacturing", TwoDigitActivity = "10" }, new { ZedId = "ZEDM3", Activity = "Manufacturing", TwoDigitActivity = "10" },
            new { ZedId = "ZEDS2", Activity = "Services", TwoDigitActivity = "62" },
        ];

        var body = await Attention("MASTER1");
        Assert.Equal(1, Count(body, "allot"));          // ZEDM1 (ZEDS2 is a services unit)
        Assert.Equal(1, Count(body, "reallot"));        // ZEDM3 Silver (ZEDM4 is Gold)
        Assert.Equal(2, Count(body, "nc-overdue"));     // ZEDM1 Bronze, ZEDM3 Silver
        Assert.Equal(1, Count(body, "quality-open"));   // ZEDM1 Bronze (ZEDM3's is Gold)
        // Levels outside the scope are not asked for.
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_MONITORING_GET_LIST" && FakeSql.Arg(c.Args, "CertificationType") == "Gold");
    }

    [Fact]
    public async Task Agency_sees_its_allotments_reviews_nc_replies_and_observations()
    {
        var body = await Attention("AGENCY1");
        var items = Items(body);
        Assert.Equal(["da-allot", "sa-allot", "review", "nc-replies", "quality-agency"], items.Keys);
        Assert.Equal(2, Count(body, "da-allot"));        // pending + rejected by the assessor
        Assert.Equal(1, Count(body, "sa-allot"));
        Assert.Equal(2, Count(body, "review"));          // the quality check tab
        Assert.Equal(2, Count(body, "nc-replies"));      // NcStatus 2 on the NC tab
        Assert.Equal(2, Count(body, "quality-agency"));
        Assert.Equal(9, body.GetProperty("total").GetInt32());
        Assert.Equal("/staff/assessment/da-allotment", items["da-allot"].GetProperty("link").GetString());
        Assert.Equal("/staff/sa-allotment", items["sa-allot"].GetProperty("link").GetString());
        Assert.Equal("5", items["review"].GetProperty("query").GetProperty("status").GetString());
        Assert.Contains(_host.Sql.Calls, c => c.Name == AttentionController.QualityOpenForAgencySql && FakeSql.Arg(c.Args, "UserId") == "AGENCY1");
        Assert.All(_host.Sql.Calls.Where(c => c.Name is "SP_ASSESSMENT_ALLOT_LIST" or "SP_MONITORING_GET_LIST"), c => Assert.Equal("AGENCY1", FakeSql.Arg(c.Args, "UserId")));
    }

    [Fact]
    public async Task An_agency_gets_only_the_lists_of_its_sub_roles()
    {
        var site = Items(await Attention("AGENCY2"));     // site verification only
        Assert.DoesNotContain("da-allot", site.Keys);
        Assert.Contains("sa-allot", site.Keys);

        var fa = Items(await Attention("AGENCYFA"));      // financial verification only: no allotment, no monitoring
        Assert.Equal(["quality-agency"], fa.Keys);
    }

    [Fact]
    public async Task Assessors_see_desktop_nc_and_site_work_due()
    {
        var desktop = await Attention("ASSESSORDA");
        Assert.Equal(["da-accept", "da-assess", "nc-review"], Items(desktop).Keys);
        Assert.Equal(1, Count(desktop, "da-accept"));
        Assert.Equal(2, Count(desktop, "da-assess"));
        Assert.Equal(2, Count(desktop, "nc-review"));
        Assert.Equal("/staff/assessment/da-verification", Items(desktop)["da-accept"].GetProperty("link").GetString());

        var site = await Attention("ASSESSOR1");
        var items = Items(site);
        Assert.Equal(["nc-review", "site-due", "site-review"], items.Keys);
        Assert.Equal(2, Count(site, "site-due"));         // three days ago and today; not next week, not the one to review
        Assert.Equal(1, Count(site, "site-review"));
        Assert.Equal("/staff/remote-assessments", items["site-due"].GetProperty("link").GetString());
        Assert.Equal("bad", items["site-due"].GetProperty("tone").GetString());
    }

    [Fact]
    public async Task Other_roles_have_nothing_waiting()
    {
        var body = await Attention("SUPER1");
        Assert.Equal(0, body.GetProperty("total").GetInt32());
        Assert.Empty(body.GetProperty("items").EnumerateArray());
        Assert.Equal(0, Calls("SP_ASSESSMENT_ALLOT_LIST") + Calls("SP_MONITORING_GET_LIST"));
    }

    [Fact]
    public async Task The_counts_are_kept_briefly_so_the_bell_can_ask_on_every_page()
    {
        var client = await SiteAssessmentTestUsers.SignInAsync(_host, "MASTER1");
        (await client.GetAsync(Url)).EnsureSuccessStatusCode();
        var calls = Calls("SP_");
        (await client.GetAsync(Url)).EnsureSuccessStatusCode();
        Assert.Equal(calls, Calls("SP_"));
        // After a change the page asks for fresh counts.
        (await client.GetAsync(Url + "?fresh=true")).EnsureSuccessStatusCode();
        Assert.True(Calls("SP_") > calls);
    }

    [Fact]
    public async Task A_list_the_database_cannot_give_is_left_out()
    {
        _host.Sql.Procs["SP_MONITORING_GET_LIST"] = _ => throw new MissingProcedure();
        var items = Items(await Attention("MASTER1"));
        Assert.Equal(["allot", "reallot", "quality-open"], items.Keys);
    }

    [Fact]
    public async Task A_sub_user_sees_only_the_screens_it_was_given()
    {
        var subRow = new
        {
            UserId = "MASTER1S01", OwnerUserId = "MASTER1", OwnerRoleId = 7, UserName = "Ops", Email = "ops@zed.test", MobileNo = (string?)null,
            Permissions = "allot", IsActive = true, PasswordHash = PasswordStore.Hash("Sub#Pass123"), FailedLogins = 0,
            LockedUntil = (DateTime?)null, LastLoginAt = (DateTime?)null, CreatedBy = "MASTER1", CreatedAt = DateTime.UtcNow,
            ScopeStates = (string?)null, ScopeAgencies = (string?)null,
        };
        _host.Sql.Queries["SELECT UserId, OwnerUserId, OwnerRoleId, UserName, Email, MobileNo, Permissions, IsActive, PasswordHash, FailedLogins, LockedUntil, LastLoginAt, CreatedBy, CreatedAt, ScopeStates, ScopeAgencies FROM dbo.V4SubUsers WHERE UserId"] =
            args => string.Equals(FakeSql.Arg(args, "UserId"), "MASTER1S01", StringComparison.OrdinalIgnoreCase) ? [subRow] : [];
        _host.Sql.Procs["SP_GET_USER_DETAILS_BY_USER_ID"] = args => FakeSql.Arg(args, "UserId") == "MASTER1"
            ? FakeSql.Sets([new { UserId = "MASTER1", UserName = "Master One", RoleId = 7, IsActive = true, Email = "m@zed.test", MobileNo = "9999999999" }])
            : FakeSql.Sets([]);

        var client = await _host.CreateBrowserAsync();
        (await client.PostAsJsonAsync("/api/staff/auth/login", new { userId = "MASTER1S01", password = "Sub#Pass123" })).EnsureSuccessStatusCode();
        var r = await client.GetAsync(Url);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var items = Items(JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement);
        Assert.Equal(["allot", "reallot"], items.Keys);
        Assert.Equal(0, Calls("SP_MONITORING_GET_LIST"));
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == AttentionController.QualityOpenSql);
    }

    [Fact]
    public void Dates_are_read_from_the_procedures_values_and_texts()
    {
        Assert.Equal(new DateTime(2026, 10, 30), AttentionController.DateOf("October 30, 2026"));
        Assert.Equal(new DateTime(2026, 10, 3), AttentionController.DateOf("October 03, 2026"));
        Assert.Equal(new DateTime(2026, 10, 30), AttentionController.DateOf("2026-10-30"));
        Assert.Equal(new DateTime(2026, 10, 30, 8, 0, 0), AttentionController.DateOf(new DateTime(2026, 10, 30, 8, 0, 0)));
        Assert.Null(AttentionController.DateOf(""));
        Assert.Null(AttentionController.DateOf(null));
        Assert.Null(AttentionController.DateOf(12));
    }

    private sealed class MissingProcedure : DbException
    {
        public MissingProcedure() : base("Could not find stored procedure") { }
    }
}
