using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Portal.Features.Staff.Users;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>The scope of Master Admin and Ministry logins (2026-11-07, migration 0057).</summary>
public sealed class LoginScopeTests : IDisposable
{
    private readonly TestHost _host = new();

    public LoginScopeTests()
    {
        UsersMastersLogin.Setup(_host);
        _host.Sql.Queries["SELECT UserId, UserName, RoleId"] = _ =>
            [new { UserId = "MASTER2", UserName = "Master North", RoleId = 7, Email = "m@zed.test", MobileNo = "9999999999", StateCode = (string?)null, IsActive = (bool?)true, CreatedBy = "ADMIN1", CreatedDate = (DateTime?)null }];
        _host.Sql.Queries["SELECT TOP (1) UserId, UserName, RoleId"] = args => FakeSql.Arg(args, "UserId") == "MASTER2"
            ? [new { UserId = "MASTER2", UserName = "Master North", RoleId = 7, Email = "m@zed.test", MobileNo = "9999999999", StateCode = (string?)null, IsActive = (bool?)true, CreatedBy = "ADMIN1", CreatedDate = (DateTime?)null }]
            : [];
        _host.Sql.Queries["SELECT TOP (1) UserId FROM Users"] = _ => [];
        _host.Sql.Queries[StaffAccountsController.ScopesSql] = _ => [new StaffAccountsController.ScopeRow("MASTER2", "Manufacturing", "Bronze,Silver", "9,7")];
    }

    public void Dispose() => _host.Dispose();

    private List<(string Name, object? Args)> Calls(string start) => _host.Sql.Calls.Where(c => c.Name.StartsWith(start, StringComparison.Ordinal)).ToList();

    /// <summary>MASTER1 limited to Manufacturing, Bronze and Silver, in Uttar Pradesh: ZEDM1 (Manufacturing, UP) only.</summary>
    private void ScopeMaster1()
    {
        _host.Sql.Queries[LoginScopes.Sql] = args => FakeSql.Arg(args, "UserId") == "MASTER1"
            ? [new { SectorActivity = "Manufacturing", ScopeLevels = "Bronze,Silver", ScopeStates = "9" }]
            : [];
        _host.Sql.Queries[ScopedUnits.StateUnitsSql] = _ =>
            [new { ZedId = "ZEDM1", Activity = "Manufacturing", TwoDigitActivity = "10" }, new { ZedId = "ZEDS2", Activity = "Services", TwoDigitActivity = "62" }];
    }

    [Fact]
    public async Task The_Admin_gives_a_Master_Admin_its_category_levels_and_states_and_sees_them_listed()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var list = await admin.GetFromJsonAsync<JsonElement>("/api/staff/accounts");
        // Every level of Administration → Certification Levels (2026-11-08: also the one the tests added, AddedLevel).
        Assert.Equal(["Bronze", "Silver", "Gold", "ZEDX", AddedLevel.Code], list.GetProperty("levels").EnumerateArray().Select(l => l.GetProperty("code").GetString()));
        var master = list.GetProperty("types").EnumerateArray().First(t => t.GetProperty("roleId").GetInt32() == 7);
        Assert.True(master.GetProperty("hasStateScope").GetBoolean());
        var ministry = list.GetProperty("types").EnumerateArray().First(t => t.GetProperty("roleId").GetInt32() == 8);
        Assert.True(ministry.GetProperty("hasScope").GetBoolean());
        Assert.False(ministry.GetProperty("hasStateScope").GetBoolean());
        var row = list.GetProperty("accounts")[0];
        Assert.Equal("Manufacturing", row.GetProperty("sectorActivity").GetString());
        Assert.Equal(["Bronze", "Silver"], row.GetProperty("levels").EnumerateArray().Select(l => l.GetString()));
        Assert.Equal(["9", "7"], row.GetProperty("states").EnumerateArray().Select(l => l.GetString()));

        var created = await admin.PostAsJsonAsync("/api/staff/accounts", new
        {
            userId = "MASTER07", roleId = 7, userName = "Master UP", email = "up@zed.test", mobileNo = "9876543210",
            sectorActivity = "Services", levels = new[] { "Gold", "ZEDX" }, states = new[] { "9" },
        });
        created.EnsureSuccessStatusCode();
        var save = Assert.Single(Calls(StaffAccountsController.SaveScopeSql));
        Assert.Equal(("MASTER07", "Services", "Gold,ZEDX", "9"),
            (FakeSql.Arg(save.Args, "UserId"), FakeSql.Arg(save.Args, "SectorActivity"), FakeSql.Arg(save.Args, "ScopeLevels"), FakeSql.Arg(save.Args, "ScopeStates")));
    }

    [Fact]
    public async Task Both_every_level_and_a_Ministry_state_are_no_limit_and_bad_choices_are_refused()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var r = await admin.PutAsJsonAsync("/api/staff/accounts/MASTER2", new
        {
            roleId = 7, userName = "Master North", email = "m@zed.test", mobileNo = "9876543210",
            sectorActivity = "Both", levels = new[] { "Bronze", "Silver", "Gold", "ZEDX", AddedLevel.Code }, states = Array.Empty<string>(),
        });
        r.EnsureSuccessStatusCode();
        var save = Assert.Single(Calls(StaffAccountsController.SaveScopeSql));
        Assert.Null(FakeSql.Arg(save.Args, "SectorActivity"));
        Assert.Null(FakeSql.Arg(save.Args, "ScopeLevels"));
        Assert.Null(FakeSql.Arg(save.Args, "ScopeStates"));

        foreach (var (body, message) in new (object Body, string Message)[]
        {
            (new { roleId = 7, userName = "M", email = "m@zed.test", mobileNo = "9876543210", levels = new[] { "Platinum" } }, "Please choose the certification levels from the list."),
            (new { roleId = 7, userName = "M", email = "m@zed.test", mobileNo = "9876543210", states = new[] { "99" } }, "Please choose the applicable states from the list."),
            (new { roleId = 7, userName = "M", email = "m@zed.test", mobileNo = "9876543210", sectorActivity = "Mining" }, "Please choose Manufacturing, Services or Both."),
        })
        {
            var bad = await admin.PutAsJsonAsync("/api/staff/accounts/MASTER2", body);
            Assert.Equal(message, await bad.ProblemTitle());
        }
        Assert.Single(Calls(StaffAccountsController.SaveScopeSql));
    }

    [Fact]
    public async Task A_scoped_Master_Admin_sees_only_its_units_and_levels_in_the_allot_list()
    {
        ScopeMaster1();
        _host.Sql.Procs["SP_ASSESSMENT_ALLOT_LIST"] = _ => FakeSql.Sets(
        [
            new { ZedId = "ZEDM1", Certification = "Bronze", PUnitName = "In scope" },
            new { ZedId = "ZEDM1", Certification = "Gold", PUnitName = "Level outside" },
            new { ZedId = "ZEDS2", Certification = "Bronze", PUnitName = "Services unit" },
            new { ZedId = "ZEDX9", Certification = "Bronze", PUnitName = "Other state" },
        ]);
        var master = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        var list = await master.GetFromJsonAsync<JsonElement>("/api/staff/assessment/allot");
        var row = Assert.Single(list.GetProperty("rows").EnumerateArray());
        Assert.Equal("In scope", row.GetProperty("PUnitName").GetString());
    }

    [Fact]
    public async Task Units_outside_the_scope_answer_404_by_route_or_by_request_body()
    {
        ScopeMaster1();
        var master = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        Assert.Equal(HttpStatusCode.NotFound, (await master.GetAsync("/api/staff/assessment/da/ZEDS2/Bronze")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await master.GetAsync("/api/staff/assessment/da/ZEDM1/Gold")).StatusCode);
        Assert.Empty(Calls("SP_ASSESSMENT_DA_DETAILS"));
        var allot = await master.PostAsJsonAsync("/api/staff/assessment/allot", new { zedId = "ZEDS2", certification = "Bronze", agencyUserId = "ZEDAA0001" });
        Assert.Equal(HttpStatusCode.NotFound, allot.StatusCode);
        Assert.Empty(Calls("SP_ASSESSMENT_ALLOT_LIST"));
    }

    [Fact]
    public async Task A_login_without_a_scope_sees_everything()
    {
        _host.Sql.Procs["SP_ASSESSMENT_ALLOT_LIST"] = _ => FakeSql.Sets(
            [new { ZedId = "ZEDM1", Certification = "Bronze" }, new { ZedId = "ZEDS2", Certification = "Gold" }]);
        var master = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        var list = await master.GetFromJsonAsync<JsonElement>("/api/staff/assessment/allot");
        Assert.Equal(2, list.GetProperty("rows").GetArrayLength());
        Assert.Empty(Calls(ScopedUnits.StateUnitsSql));
    }

    [Fact]
    public void Scope_rules()
    {
        var scope = new LoginScope("Services", ["Gold"], ["9"]);
        Assert.True(scope.AllowsLevel("GoldSurveillance"));
        Assert.False(scope.AllowsLevel("Bronze"));
        Assert.True(scope.AllowsSector("Services"));
        Assert.False(scope.AllowsSector("Manufacturing"));
        Assert.True(scope.AllowsSector(null));
        Assert.True(scope.AllowsState("UTTAR PRADESH"));
        Assert.True(scope.AllowsState("9"));
        Assert.False(scope.AllowsState("DELHI"));
        Assert.True(scope.Contains(new LoginScope("Services", ["Gold"], ["9"])));
        Assert.False(scope.Contains(new LoginScope(null, ["Gold"], ["9"])));
        Assert.False(scope.Contains(new LoginScope("Services", ["Gold", "Silver"], ["9"])));
        Assert.False(LoginScope.None.IsLimited);
        Assert.True(new LoginScope("Both", [], []) is { IsLimited: false, OneSector: null });
    }
}
