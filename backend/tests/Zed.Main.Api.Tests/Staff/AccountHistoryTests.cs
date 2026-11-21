using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.Users;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>
/// 2026-11-21 (the product owner: "profile Edit histories etc. are missing"): the History of a staff account (dbo.UserBlockHistory,
/// migration 0109): creation, profile edits with their change list, password links and mobile changes recorded by the user
/// controllers, and the allotments read from the allotment histories and merged in by date.
/// </summary>
public sealed class AccountHistoryTests : IDisposable
{
    private readonly TestHost _host = new();
    private readonly Dictionary<string, Dictionary<string, object?>> _users;

    public AccountHistoryTests()
    {
        UsersMastersLogin.Setup(_host);
        _users = new(StringComparer.OrdinalIgnoreCase)
        {
            ["ZEDAA0001"] = new()
            {
                ["Id"] = 11, ["UserId"] = "ZEDAA0001", ["UserName"] = "Acme Assessors", ["RoleId"] = 2, ["CreatedBy"] = "MASTER1",
                ["IsActive"] = true, ["Email"] = "spoc@acme.test", ["MobileNo"] = "9876543210", ["SpocName"] = "A Spoc",
                ["Address"] = "Plot 1", ["Pincode"] = "110001", ["OrgPartnerId"] = "OP1", ["SectorActivity"] = "Both",
                ["DesktopVerification"] = true, ["SiteVerification"] = false, ["FinancialVerification"] = false,
            },
            ["ZEDAS0001"] = new()
            {
                ["Id"] = 21, ["UserId"] = "ZEDAS0001", ["UserName"] = "Assessor One", ["RoleId"] = 3, ["CreatedBy"] = "AGENCY1", ["IsActive"] = true,
                ["Email"] = "zedas0001@zed.test", ["MobileNo"] = "9000000001", ["Address"] = "Street 1", ["Pincode"] = "560001",
                ["IdProofType"] = "Aadhaar Card", ["IdProofNumber"] = "123456789012", ["AssessorType"] = "BronzeAssessor", ["SectorActivity"] = "Manufacturing",
            },
        };
        _host.Sql.Procs["SP_GET_USER_DETAILS_BY_USER_ID"] = args =>
            _users.TryGetValue(UsersMastersLogin.Arg(args, "UserId") ?? "", out var u)
                ? FakeSql.Sets([u], [new { States = "DELHI" }], [new { States = "24" }], [new { States = "Quality" }])
                : FakeSql.Sets([], [], [], []);
        _host.Sql.Procs["SP_MASTER_GET_SECTORS"] = _ => FakeSql.Sets(
            [new { Id = 1, SectorCode = "24", SectorName = "Basic metals" }, new { Id = 2, SectorCode = "25", SectorName = "Metal products" }],
            [new { UserId = "OP2", FirstName = "Partner Two" }]);
        _host.Sql.Procs["SP_MASTER_GET_AREA_OF_KNOWLEDGE"] = _ => FakeSql.Sets([new { AreaOfknowledge = "Quality" }, new { AreaOfknowledge = "Safety" }]);
        _host.Sql.Procs["SP_INSERT_USER"] = _ => FakeSql.Sets([new Dictionary<string, object?> { [""] = "ZEDAA0099" }]);
    }

    public void Dispose() => _host.Dispose();

    private static object AgencyBody(string name = "Acme Assessors", string mobile = "9876543210", string[]? states = null, string[]? nic = null) => new
    {
        userName = name, spocName = "A Spoc", emailId = "spoc@acme.test", mobileNo = mobile, address = "Plot 1", pinCode = "110001",
        states = states ?? ["DELHI"], nicSectors = nic ?? ["24"], orgPartnerId = "OP1", desktopVerification = true, siteVerification = false,
        financialVerification = false, sectorActivity = "Both",
    };

    private List<(string Name, object? Args)> HistoryWrites(string action) =>
        _host.Sql.Calls.Where(c => (c.Name == UserBlockHistory.InsertDetailsSql || c.Name == UserBlockHistory.InsertSql) && FakeSql.Arg(c.Args, "Action") == action).ToList();

    private static List<AccountChange> Changes(object? args) => AccountChanges.FromJson(FakeSql.Arg(args, "Details"))!.ToList();

    // ---- the change list (pure) -----------------------------------------------------------

    [Fact]
    public void An_unchanged_save_gives_no_changes_texts_and_lists_compared_loosely()
    {
        var before = new AccountProfile().Add("name", "Acme").Add("address", "Plot 1\r\nDelhi ").Add("gstin", "").Add("states", ["Delhi", "Goa"]).Add("verified", true);
        var after = new AccountProfile().Add("name", " Acme").Add("address", "Plot 1\nDelhi").Add("gstin", null as string).Add("states", ["GOA", "delhi"]).Add("verified", true);
        Assert.Empty(AccountChanges.Diff(before, after));
        Assert.Null(AccountChanges.ToJson(AccountChanges.Diff(before, after)));
    }

    [Fact]
    public void Values_are_old_to_new_and_lists_are_added_and_removed()
    {
        var before = new AccountProfile().Add("mobile", "9876543210").Add("states", ["DELHI", "GOA"]).Add("nicSectors", ["Basic metals"]).Add("pin", null as string);
        var after = new AccountProfile().Add("mobile", "9123456780").Add("states", ["DELHI", "KERALA"]).Add("nicSectors", ["Basic metals"]).Add("pin", "110001")
            .Add("activity", "Both");
        var changes = AccountChanges.Diff(before, after);
        Assert.Equal(["mobile", "states", "pin", "activity"], changes.Select(c => c.Field));
        Assert.Equal(("9876543210", "9123456780"), (changes[0].Old, changes[0].New));
        Assert.Equal(["KERALA"], changes[1].Added!);
        Assert.Equal(["GOA"], changes[1].Removed!);
        Assert.Equal((null, "110001"), (changes[2].Old, changes[2].New));
        // A field the old profile did not have is compared with nothing.
        Assert.Equal("Both", changes[3].New);
        var json = AccountChanges.ToJson(changes)!;
        Assert.Contains("\"field\":\"states\",\"added\":[\"KERALA\"],\"removed\":[\"GOA\"]", json);
        Assert.DoesNotContain("addedCount", json);
        Assert.Equal(changes, AccountChanges.FromJson(json)!, new ChangeComparer());
    }

    [Fact]
    public void Long_lists_keep_the_first_names_and_the_count_and_long_texts_are_cut()
    {
        var districts = Enumerable.Range(1, 12).Select(i => $"District {i}").ToList();
        var changes = AccountChanges.Diff(new AccountProfile().Add("districts", []).Add("address", "short"),
            new AccountProfile().Add("districts", districts).Add("address", new string('a', 400)));
        Assert.Equal(AccountChanges.ListShown, changes[0].Added!.Count);
        Assert.Equal(12, changes[0].AddedCount);
        Assert.Null(changes[0].Removed);
        Assert.Equal(AccountChanges.TextShown + 1, changes[1].New!.Length);
        Assert.EndsWith("…", changes[1].New);
    }

    [Fact]
    public void A_new_account_lists_what_it_was_created_with()
    {
        var changes = AccountChanges.Diff(null, new AccountProfile().Add("name", "New").Add("gstin", null as string).Add("states", ["DELHI"]).Add("nic", []));
        Assert.Equal(["name", "states"], changes.Select(c => c.Field));
        Assert.Null(changes[0].Old);
    }

    // ---- allotment lines ----------------------------------------------------------------------

    [Theory]
    [InlineData("DA for Bronze Alotted to Desktop Assessor ZEDBA0001", "ZEDBA0001", "Desktop")]
    [InlineData("DA for Bronze Alotted to Desktop Assessor ZEDBA00011", "ZEDBA0001", null)]
    [InlineData("DA for Silver Alotted to Agency ZEDAA0001", "ZEDAA0001", "Agency")]
    [InlineData("SA for Silver Alotted toZEDBA0001 and ZEDBA0002", "ZEDBA0001", "Site")]
    [InlineData("SA for Silver Alotted toZEDBA0001 and ZEDBA0002", "zedba0002", "SiteCo")]
    [InlineData("SA for Gold Alotted toZEDBA0001 and ZEDBA00021", "ZEDBA0002", null)]
    [InlineData("SA for Gold Alotted toZEDCO1 and ZEDCO2 and ZEDTE1,ZEDTE2", "ZEDTE2", "Expert")]
    [InlineData("SA for Bronze Alotted toZEDBA0001 and ", "ZEDBA0001", "Site")]
    [InlineData("Onsite surveillance for Bronze allotted to ZEDBA0001 and ZEDBA0002", "ZEDBA0002", "OnsiteSurveillanceCo")]
    [InlineData("Payment received from ZEDBA0001", "ZEDBA0001", null)]
    public void An_allotment_line_is_matched_to_the_exact_id_and_part(string line, string userId, string? role) =>
        Assert.Equal(role, UserBlockHistory.AllotmentRole(line, userId));

    [Fact]
    public void A_replaced_allotment_loses_its_del_marks()
    {
        Assert.Equal("ZED123", UserBlockHistory.BaseZedId("ZED123_DEL_DEL", out var replaced));
        Assert.True(replaced);
        Assert.Equal("ZED124", UserBlockHistory.BaseZedId(" ZED124 ", out replaced));
        Assert.False(replaced);
    }

    [Fact]
    public void A_sub_user_is_recorded_as_owner_and_sub_user()
    {
        Assert.Equal("ZEDAA0001 / OPS1", UserBlockHistory.ActorOf(new ZedUser("ZEDAA0001", "Acme", 2, null, null, null, null, ActingUserId: "OPS1"), "x"));
        Assert.Equal("MASTER1", UserBlockHistory.ActorOf(new ZedUser("MASTER1", "M", 7, null, null, null, null), "x"));
        Assert.Equal(UserBlockHistory.ActorLength, UserBlockHistory.ActorOf(new ZedUser(new string('A', 40), "M", 7, null, null, null, null, ActingUserId: new string('B', 40)), "x").Length);
    }

    // ---- the controllers write ------------------------------------------------------------------

    [Fact]
    public async Task An_agency_profile_save_records_its_changes_and_an_unchanged_save_records_nothing()
    {
        var master = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        Assert.Equal(HttpStatusCode.OK, (await master.PutAsJsonAsync("/api/staff/users/agencies/ZEDAA0001", AgencyBody())).StatusCode);
        Assert.Empty(HistoryWrites(UserBlockHistory.Edited));

        Assert.Equal(HttpStatusCode.OK, (await master.PutAsJsonAsync("/api/staff/users/agencies/ZEDAA0001",
            AgencyBody(name: "Acme Certification", mobile: "9123456780", states: ["DELHI", "GOA"], nic: ["25"]))).StatusCode);
        var write = Assert.Single(HistoryWrites(UserBlockHistory.Edited));
        Assert.Equal(("ZEDAA0001", "2", "MASTER1", "7"), (FakeSql.Arg(write.Args, "UserId"), FakeSql.Arg(write.Args, "RoleId"),
            FakeSql.Arg(write.Args, "ActionBy"), FakeSql.Arg(write.Args, "ActionByRole")));
        var changes = Changes(write.Args);
        Assert.Equal(["name", "mobile", "states", "nicSectors"], changes.Select(c => c.Field));
        Assert.Equal(("Acme Assessors", "Acme Certification"), (changes[0].Old, changes[0].New));
        Assert.Equal(("9876543210", "9123456780"), (changes[1].Old, changes[1].New));
        Assert.Equal(["GOA"], changes[2].Added!.Select(s => s.ToUpperInvariant()));
        // NIC sectors by name.
        Assert.Equal(["Metal products"], changes[3].Added!);
        Assert.Equal(["Basic metals"], changes[3].Removed!);
    }

    [Fact]
    public async Task Creating_an_agency_records_what_it_was_created_with()
    {
        var master = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        var r = await master.PostAsJsonAsync("/api/staff/users/agencies", new
        {
            userName = "New Agency", spocName = "Spoc", emailId = "new@agency.test", mobileNo = "9876501234", address = "Addr", pinCode = "110002",
            states = new[] { "DELHI" }, nicSectors = new[] { "24" }, orgPartnerId = "OP2", desktopVerification = true, siteVerification = true,
            financialVerification = false, sectorActivity = "Both",
        });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var write = Assert.Single(HistoryWrites(UserBlockHistory.Created));
        Assert.Equal("ZEDAA0099", FakeSql.Arg(write.Args, "UserId"));
        var changes = Changes(write.Args);
        Assert.Equal("New Agency", changes.Single(c => c.Field == "name").New);
        Assert.Equal(["Desktop", "Site"], changes.Single(c => c.Field == "verifications").Added!);
        Assert.Equal("Partner Two", changes.Single(c => c.Field == "organisingPartner").New);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == UserBlockHistory.InsertDetailsSql && (FakeSql.Arg(c.Args, "Details") ?? "").Contains("assword"));
    }

    [Fact]
    public async Task The_agency_edits_its_assessor_and_changes_its_mobile_both_kept_in_the_history()
    {
        var agency = await UsersMastersLogin.SignInAsync(_host, "AGENCY1");
        var r = await agency.PutAsJsonAsync("/api/staff/users/assessors/ZEDAS0001", new
        {
            address = "Street 1", pinCode = "560001", idProofType = "Aadhaar Card", idProofNumber = "", states = new[] { "KERALA" },
            nicSectors = new[] { "24" }, areasOfKnowledge = new[] { "Quality", "Safety" }, sectorActivity = "Manufacturing", mobileNo = "9000000002",
        });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var write = Assert.Single(HistoryWrites(UserBlockHistory.Edited));
        Assert.Equal(("ZEDAS0001", "3", "AGENCY1"), (FakeSql.Arg(write.Args, "UserId"), FakeSql.Arg(write.Args, "RoleId"), FakeSql.Arg(write.Args, "ActionBy")));
        var changes = Changes(write.Args);
        Assert.Equal(["mobile", "states", "areasOfKnowledge"], changes.Select(c => c.Field));
        Assert.Equal(["Safety"], changes[2].Added!);

        r = await agency.PostAsJsonAsync("/api/staff/users/assessors/ZEDAS0001/mobile", new { mobileNo = "9000000003" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var mobile = Assert.Single(HistoryWrites(UserBlockHistory.MobileReset));
        Assert.Equal(("9000000001", "9000000003"), (Changes(mobile.Args)[0].Old, Changes(mobile.Args)[0].New));
    }

    [Fact]
    public async Task A_history_write_that_fails_never_fails_the_save()
    {
        var sql = new ThrowingInserts(_host.Sql);
        var changes = new AccountProfile().Add("name", "B");
        await UserBlockHistory.RecordChangesAsync(sql, "ZEDAA0001", 2, UserBlockHistory.Edited, new AccountProfile().Add("name", "A"), changes, "MASTER1", 7,
            Microsoft.Extensions.Logging.Abstractions.NullLogger.Instance, default);
        Assert.Equal(1, sql.Attempts);
    }

    // ---- the list merges the allotments ----------------------------------------------------------

    [Fact]
    public async Task The_assessors_history_merges_its_allotments_by_date()
    {
        _host.Sql.Queries[UserBlockHistory.ListSql] = _ =>
        [
            new UserBlockHistory.Entry("Edited", null, "AGENCY1", 2, new DateTime(2026, 11, 21, 10, 0, 0), "Agency One",
                """[{"field":"mobile","old":"9000000001","new":"9000000002"}]"""),
            new UserBlockHistory.Entry("Blocked", "Absent", "MASTER1", 7, new DateTime(2026, 11, 1)),
        ];
        _host.Sql.Queries[UserBlockHistory.AssessorAllotmentsSql] = args =>
        {
            Assert.Equal("%ZEDAS0001%", FakeSql.Arg(args, "Like"));
            return
            [
                new { ZedId = "ZED200_DEL", Level = "Bronze", AllotType = "DocVerifiAllot", Descrip = "DA for Bronze Alotted to Desktop Assessor ZEDAS0001", At = new DateTime(2026, 11, 10) },
                new { ZedId = "ZED201", Level = "Silver", AllotType = (string?)null, Descrip = "SA for Silver Alotted toZEDAS0009 and ZEDAS0001", At = new DateTime(2026, 11, 15) },
                new { ZedId = "ZED202", Level = "Gold", AllotType = (string?)null, Descrip = "SA for Gold Alotted toZEDAS00010 and ZEDAS0009", At = new DateTime(2026, 11, 16) },
            ];
        };
        var master = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        var list = (await master.GetFromJsonAsync<JsonElement>("/api/staff/users/assessors/ZEDAS0001/history")).EnumerateArray().ToList();
        Assert.Equal(["Edited", "Allotment", "Allotment", "Blocked"], list.Select(e => e.GetProperty("action").GetString()));
        Assert.Equal(("ZED201", "Silver", "SiteCo"), (list[1].GetProperty("zedId").GetString(), list[1].GetProperty("level").GetString(), list[1].GetProperty("allotment").GetString()));
        Assert.Equal(("ZED200", "Desktop", true), (list[2].GetProperty("zedId").GetString(), list[2].GetProperty("allotment").GetString(), list[2].GetProperty("replaced").GetBoolean()));
        Assert.Contains("9000000002", list[0].GetProperty("details").GetString());
    }

    [Fact]
    public async Task The_agencys_history_merges_its_allotment_rows_and_lines()
    {
        _host.Sql.Queries[UserBlockHistory.AgencyAllotmentsSql] = args =>
        {
            Assert.Equal("ZEDAA0001", FakeSql.Arg(args, "UserId"));
            return [new { ZedId = "ZED300", Level = "Bronze", AllotType = "Auto", Descrip = (string?)null, At = new DateTime(2026, 11, 5) }];
        };
        _host.Sql.Queries[UserBlockHistory.AgencyLinesSql] = args =>
        {
            Assert.Equal("%Alotted to Agency ZEDAA0001", FakeSql.Arg(args, "Like"));
            return [new { ZedId = "ZED301", Level = "Silver", AllotType = "Manual", Descrip = "DA for Silver Alotted to Agency ZEDAA0001", At = new DateTime(2026, 11, 6) }];
        };
        var master = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        var list = (await master.GetFromJsonAsync<JsonElement>("/api/staff/users/agencies/ZEDAA0001/history")).EnumerateArray().ToList();
        Assert.Equal([("ZED301", "Manual"), ("ZED300", "Auto")],
            list.Select(e => (e.GetProperty("zedId").GetString(), e.GetProperty("allotment").GetString())));
    }

    private sealed class ChangeComparer : IEqualityComparer<AccountChange>
    {
        public bool Equals(AccountChange? x, AccountChange? y) => JsonSerializer.Serialize(x) == JsonSerializer.Serialize(y);
        public int GetHashCode(AccountChange obj) => obj.Field.GetHashCode();
    }

    /// <summary>A database whose history inserts fail (no migration 0109): the write is tried once and only logged.</summary>
    private sealed class ThrowingInserts(FakeSql inner) : Zed.Core.Data.ISqlExecutor
    {
        public int Attempts { get; private set; }
        public Task<int> ExecuteSqlAsync(string sql, object? parameters = null, CancellationToken ct = default)
        {
            Attempts++;
            throw new InvalidOperationException("CK_UserBlockHistory_Action");
        }
        public Task<IReadOnlyList<T>> QueryProcAsync<T>(string procedure, object? parameters = null, CancellationToken ct = default) => inner.QueryProcAsync<T>(procedure, parameters, ct);
        public Task<Zed.Core.Data.ResultSets> QueryProcMultipleAsync(string procedure, object? parameters = null, CancellationToken ct = default) => inner.QueryProcMultipleAsync(procedure, parameters, ct);
        public Task<int> ExecuteProcAsync(string procedure, object? parameters = null, CancellationToken ct = default) => inner.ExecuteProcAsync(procedure, parameters, ct);
        public Task<IReadOnlyList<T>> QuerySqlAsync<T>(string sql, object? parameters = null, CancellationToken ct = default) => inner.QuerySqlAsync<T>(sql, parameters, ct);
    }
}
