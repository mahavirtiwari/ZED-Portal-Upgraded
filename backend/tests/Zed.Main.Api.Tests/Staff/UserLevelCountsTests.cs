using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Portal.Features.Staff.Users;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>
/// 2026-11-18: level-wise allotment counts on the Assessment Agencies list, the assessor lists and the agency's own page
/// (<see cref="UserLevelCounts"/>): one grouped query per list, the rows grouped per level, and an agency sees only its own.
/// </summary>
public sealed class UserLevelCountsTests : IDisposable
{
    private readonly TestHost _host = new();

    public UserLevelCountsTests() => UsersMastersLogin.Setup(_host);

    public void Dispose() => _host.Dispose();

    private sealed class DatabaseDown() : System.Data.Common.DbException("down");

    private static Dictionary<string, object?> AgencyRow(string id) => new()
    {
        ["Id"] = 11, ["UserId"] = id, ["UserName"] = id + " name", ["RoleId"] = 2, ["IsActive"] = true, ["IdStatus"] = "Active",
        ["AllowBronzeAssessments"] = true, ["NoOfUsers"] = 1,
    };

    private static Dictionary<string, object?> AssessorRow(string id, string agency) => new()
    {
        ["Id"] = 21, ["UserId"] = id, ["UserName"] = id + " name", ["RoleId"] = 3, ["IsActive"] = true, ["IdStatus"] = "Active",
        ["AgencyUserId"] = agency, ["AgencyUserName"] = agency + " name", ["IsCertAttached"] = 0, ["AssessorType"] = "BronzeAssessor",
    };

    private static JsonElement Level(JsonElement row, string code) =>
        row.GetProperty("LevelCounts").EnumerateArray().Single(l => string.Equals(l.GetProperty("code").GetString(), code, StringComparison.OrdinalIgnoreCase));

    private IReadOnlyList<(string Name, object? Args)> CountQueries(string sql) => _host.Sql.Calls.Where(c => c.Name == sql).ToList();

    [Fact]
    public async Task The_agency_list_carries_each_agencys_allotments_per_level_from_one_grouped_query()
    {
        _host.Sql.Procs["SP_GET_USERS_BY_ROLE"] = _ => FakeSql.Sets([AgencyRow("ZEDAA0001"), AgencyRow("ZEDAA0002")]);
        _host.Sql.Queries[UserLevelCounts.AgencySql] = _ =>
        [
            new { UserId = "ZEDAA0001", Code = "Bronze", Allotted = 12, Completed = 7, Rejected = 1 },
            // The same level in another spelling is the same level.
            new { UserId = "zedaa0001 ", Code = "bronze", Allotted = 3, Completed = 0, Rejected = 0 },
            new { UserId = "ZEDAA0001", Code = "Silver", Allotted = 3, Completed = 1, Rejected = 0 },
            new { UserId = "ZEDAA0001", Code = "ZEDX", Allotted = 1, Completed = 0, Rejected = 0 },
            // A level no longer in the registry is still shown when the agency has units of it.
            new { UserId = "ZEDAA0001", Code = "OLDLEVEL", Allotted = 2, Completed = 2, Rejected = 0 },
            new { UserId = "ZEDAA0002", Code = "Gold", Allotted = 5, Completed = 5, Rejected = 0 },
        ];
        var client = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        var list = await client.GetFromJsonAsync<JsonElement>("/api/staff/users/agencies");

        var one = list.EnumerateArray().Single(a => a.GetProperty("UserId").GetString() == "ZEDAA0001");
        var bronze = Level(one, "Bronze");
        Assert.Equal("Bronze", bronze.GetProperty("name").GetString());
        Assert.Equal(15, bronze.GetProperty("allotted").GetInt32());
        Assert.Equal(7, bronze.GetProperty("completed").GetInt32());
        Assert.Equal(1, bronze.GetProperty("rejected").GetInt32());
        Assert.Equal(7, bronze.GetProperty("inProgress").GetInt32());
        Assert.Equal(3, Level(one, "Silver").GetProperty("allotted").GetInt32());
        Assert.Equal(2, Level(one, "Silver").GetProperty("inProgress").GetInt32());
        Assert.Equal(0, Level(one, "Gold").GetProperty("allotted").GetInt32());
        Assert.Equal("ZED-X", Level(one, "ZEDX").GetProperty("name").GetString());
        Assert.Equal(2, Level(one, "OLDLEVEL").GetProperty("allotted").GetInt32());
        // The enabled levels come first, in the Admin's order.
        var codes = one.GetProperty("LevelCounts").EnumerateArray().Select(l => l.GetProperty("code").GetString()).ToList();
        Assert.True(codes.IndexOf("Bronze") < codes.IndexOf("Silver") && codes.IndexOf("Silver") < codes.IndexOf("Gold") && codes.IndexOf("Gold") < codes.IndexOf("ZEDX"));
        Assert.Equal("OLDLEVEL", codes[^1]);

        var two = list.EnumerateArray().Single(a => a.GetProperty("UserId").GetString() == "ZEDAA0002");
        Assert.Equal(5, Level(two, "Gold").GetProperty("completed").GetInt32());
        Assert.Equal(0, Level(two, "Bronze").GetProperty("allotted").GetInt32());

        // One query for the whole list, over every agency, leaving out the units an agency rejected.
        var calls = CountQueries(UserLevelCounts.AgencySql);
        Assert.Single(calls);
        Assert.Null(FakeSql.Arg(calls[0].Args, "AgencyId"));
        Assert.Contains("ISNULL(C.ReasonForRejection, '') = ''", UserLevelCounts.AgencySql);
        Assert.Contains("GROUP BY LTRIM(RTRIM(C.CertificationBodyUserId)), LTRIM(RTRIM(C.Certification))", UserLevelCounts.AgencySql);
    }

    [Fact]
    public async Task When_the_counts_cannot_be_read_the_agency_list_still_loads_without_them()
    {
        _host.Sql.Procs["SP_GET_USERS_BY_ROLE"] = _ => FakeSql.Sets([AgencyRow("ZEDAA0001")]);
        _host.Sql.Queries[UserLevelCounts.AgencySql] = _ => throw new DatabaseDown();
        var client = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        var list = await client.GetFromJsonAsync<JsonElement>("/api/staff/users/agencies");
        Assert.Equal(JsonValueKind.Null, list[0].GetProperty("LevelCounts").ValueKind);
    }

    [Fact]
    public async Task The_master_admins_assessor_list_counts_per_assessor_and_level_scoped_to_the_chosen_agency()
    {
        _host.Sql.Procs["SP_GET_ASSESSORS"] = _ => FakeSql.Sets([AssessorRow("ZEDAS0001", "ZEDAA0001")]);
        _host.Sql.Queries[UserLevelCounts.AssessorSql] = _ =>
        [
            new { UserId = "ZEDAS0001", Code = "Bronze", Allotted = 4, Completed = 3, Rejected = 0 },
            new { UserId = "ZEDAS0001", Code = "Gold", Allotted = 2, Completed = 0, Rejected = 1 },
        ];
        var client = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        var all = await client.GetFromJsonAsync<JsonElement>("/api/staff/users/assessors");
        Assert.Equal(4, Level(all[0], "Bronze").GetProperty("allotted").GetInt32());
        Assert.Equal(1, Level(all[0], "Gold").GetProperty("inProgress").GetInt32());
        Assert.Equal(0, Level(all[0], "Silver").GetProperty("allotted").GetInt32());
        Assert.Null(FakeSql.Arg(CountQueries(UserLevelCounts.AssessorSql).Last().Args, "AgencyId"));

        await client.GetFromJsonAsync<JsonElement>("/api/staff/users/assessors?agencyId=ZEDAA0001");
        Assert.Equal("ZEDAA0001", FakeSql.Arg(CountQueries(UserLevelCounts.AssessorSql).Last().Args, "AgencyId"));
        // Desktop (unless the assessor rejected it), lead and co-assessor; a row counts once per assessor.
        Assert.Contains("ISNULL(C.DesktopReasonForRejection, '') = ''", UserLevelCounts.AssessorSql);
        Assert.Contains("UNION SELECT LTRIM(RTRIM(C.SiteAssessorId))", UserLevelCounts.AssessorSql);
        Assert.Contains("UNION SELECT LTRIM(RTRIM(C.CoAssessorId))", UserLevelCounts.AssessorSql);
    }

    [Fact]
    public async Task An_agency_sees_level_counts_of_its_own_assessors_only()
    {
        _host.Sql.Procs["SP_GET_USERS_BY_ROLE"] = _ => FakeSql.Sets([AssessorRow("ZEDAS0001", "AGENCY1")]);
        _host.Sql.Queries[UserLevelCounts.AssessorSql] = _ =>
        [
            new { UserId = "ZEDAS0001", Code = "Silver", Allotted = 6, Completed = 2, Rejected = 0 },
            new { UserId = "ZEDAS0002", Code = "Silver", Allotted = 99, Completed = 0, Rejected = 0 },
        ];
        var client = await UsersMastersLogin.SignInAsync(_host, "AGENCY1");
        var body = await client.GetStringAsync("/api/staff/users/assessors/mine");
        var mine = JsonDocument.Parse(body).RootElement;
        Assert.Single(mine.EnumerateArray());
        Assert.Equal(6, Level(mine[0], "Silver").GetProperty("allotted").GetInt32());
        Assert.Equal(4, Level(mine[0], "Silver").GetProperty("inProgress").GetInt32());
        Assert.DoesNotContain("ZEDAS0002", body);
        Assert.DoesNotContain("\"allotted\":99", body);
        // The query is limited to the signed-in agency's assessors.
        Assert.Equal("AGENCY1", FakeSql.Arg(CountQueries(UserLevelCounts.AssessorSql).Last().Args, "AgencyId"));
    }

    [Fact]
    public async Task An_agency_gets_its_own_totals_per_level_and_no_one_elses()
    {
        _host.Sql.Queries[UserLevelCounts.AgencySql] = args => FakeSql.Arg(args, "AgencyId") == "AGENCY1"
            ? [new { UserId = "AGENCY1", Code = "Bronze", Allotted = 9, Completed = 4, Rejected = 2 }]
            : [new { UserId = "AGENCY2", Code = "Bronze", Allotted = 50, Completed = 0, Rejected = 0 }];
        var client = await UsersMastersLogin.SignInAsync(_host, "AGENCY1");
        // A query string cannot point it at another agency: the agency is the sign-in.
        var totals = await client.GetFromJsonAsync<JsonElement>("/api/staff/users/assessors/mine/level-counts?agencyId=AGENCY2");
        var bronze = totals.EnumerateArray().Single(l => l.GetProperty("code").GetString() == "Bronze");
        Assert.Equal(9, bronze.GetProperty("allotted").GetInt32());
        Assert.Equal(3, bronze.GetProperty("inProgress").GetInt32());
        Assert.Contains(totals.EnumerateArray(), l => l.GetProperty("code").GetString() == "Gold" && l.GetProperty("allotted").GetInt32() == 0);
        Assert.Equal("AGENCY1", FakeSql.Arg(CountQueries(UserLevelCounts.AgencySql).Last().Args, "AgencyId"));

        var master = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        Assert.Equal(HttpStatusCode.Forbidden, (await master.GetAsync("/api/staff/users/assessors/mine/level-counts")).StatusCode);
        var assessor = await UsersMastersLogin.SignInAsync(_host, "ASSESSOR1");
        Assert.Equal(HttpStatusCode.Forbidden, (await assessor.GetAsync("/api/staff/users/assessors/mine/level-counts")).StatusCode);
    }

    [Fact]
    public async Task An_agency_is_told_when_its_totals_cannot_be_read()
    {
        _host.Sql.Queries[UserLevelCounts.AgencySql] = _ => throw new DatabaseDown();
        var client = await UsersMastersLogin.SignInAsync(_host, "AGENCY1");
        var r = await client.GetAsync("/api/staff/users/assessors/mine/level-counts");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, r.StatusCode);
    }

    [Fact]
    public void Counts_of_a_user_without_rows_are_every_enabled_level_at_zero()
    {
        var counts = new UserLevelCounts.Counts([new UserLevelCounts.Row { UserId = "X", Code = "Gold", Allotted = 1 }]);
        var none = counts.Of("Y");
        Assert.Contains(none, l => l.Code == "Bronze" && l.Allotted == 0 && l.InProgress == 0);
        Assert.All(none, l => Assert.Equal(0, l.Allotted));
        Assert.Equal(1, counts.Of(" x ").Single(l => l.Code == "Gold").InProgress);
        Assert.All(counts.Of(null), l => Assert.Equal(0, l.Allotted));
    }
}
