using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Portal.Features.Staff.AdminPortals;
using Zed.Portal.Features.Staff.Neft;
using Zed.Portal.Features.Staff.Users;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>One NEFT Admin (2026-11-07): assigned by the Master Admin, every state, financial assistance and TU.</summary>
public sealed class NeftAdminTests : IDisposable
{
    private readonly TestHost _host = new();

    public NeftAdminTests()
    {
        UsersMastersLogin.Setup(_host);
        // NEFTADMIN1: an MSME DFO of every state; SC_UP: an MSME DFO of Uttar Pradesh.
        var users = new Dictionary<string, (int Role, string? State)> { ["NEFTADMIN1"] = (6, "ALL"), ["SC_UP"] = (6, "9"), ["DFO_BOTH"] = (6, "9"), ["DFO_TU"] = (6, "9") };
        var masters = _host.Sql.Procs["SP_GET_USER_DETAILS"];
        _host.Sql.Procs["SP_GET_USER_DETAILS"] = args => users.TryGetValue(FakeSql.Arg(args, "UserId")?.ToUpperInvariant() ?? "", out var u)
            ? FakeSql.Sets([new { UserId = FakeSql.Arg(args, "UserId")!.ToUpperInvariant(), UserName = "Desk", RoleId = u.Role, Email = "d@zed.test", StateCode = u.State }], [new { ERRORMSG = "SUCCESS" }])
            : masters(args);
        _host.Sql.Procs["SP_NEFT_TRANSACTIONS_BY_STATUS"] = _ => FakeSql.Sets(
            [new { TransactionId = 1, ZedId = "ZEDM1", StateId = 9, PStateId = (int?)null, PLgDistrictCode = "162", PDistrictName = "LUCKNOW", VerificationStatus = 4 },
             new { TransactionId = 2, ZedId = "ZEDM2", StateId = 27, PStateId = (int?)null, PLgDistrictCode = "500", PDistrictName = "PUNE", VerificationStatus = 4 },
             new { TransactionId = 3, ZedId = "ZEDM3", StateId = 9, PStateId = (int?)null, PLgDistrictCode = "164", PDistrictName = "KANPUR NAGAR", VerificationStatus = 4 },
             new { TransactionId = 4, ZedId = "ZEDM4", StateId = 10, PStateId = (int?)null, PLgDistrictCode = "230", PDistrictName = "PATNA", VerificationStatus = 4 }]);
        // DFO_BOTH: both NEFT lists, Uttar Pradesh (Lucknow only) and Maharashtra; DFO_TU: Handholding only.
        _host.Sql.Queries[DashboardAdmins.ScreensSql] = args => FakeSql.Arg(args, "UserId") switch
        {
            "DFO_BOTH" => [new { ScreenAccess = "main:neft,consultancy:neft" }],
            "DFO_TU" => [new { ScreenAccess = "consultancy:neft" }],
            _ => [],
        };
        _host.Sql.Queries[LoginScopes.Sql] = args => FakeSql.Arg(args, "UserId") == "DFO_BOTH"
            ? [new { SectorActivity = (string?)null, ScopeLevels = (string?)null, ScopeStates = "9,27", ScopeDistricts = "162,500" }]
            : [];
        _host.Sql.Queries[NeftAdminsController.ListSql] = _ =>
            [new { UserId = "NEFTADMIN1", UserName = "NEFT Desk", RoleId = 6, Email = "d@zed.test", MobileNo = "9999999999", StateCode = "ALL", IsActive = (bool?)true, CreatedBy = "MASTER1", CreatedDate = (DateTime?)null }];
        _host.Sql.Queries["SELECT TOP (1) UserId FROM Users"] = _ => [];
    }

    public void Dispose() => _host.Dispose();

    private static List<string?> ZedIds(JsonElement json) =>
        json.GetProperty("transactions").EnumerateArray().Select(t => t.GetProperty("ZedId").GetString()).ToList();

    [Fact]
    public async Task The_Master_Admin_lists_and_creates_NEFT_Admins_and_the_Admin_cannot()
    {
        var master = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        var list = await master.GetFromJsonAsync<JsonElement>("/api/staff/neft-admins");
        Assert.Equal("NEFT Admin", list.GetProperty("types")[0].GetProperty("label").GetString());
        Assert.Equal("NEFTADMIN1", list.GetProperty("accounts")[0].GetProperty("userId").GetString());

        // One NEFT Admin (2026-11-08): a second is refused while NEFTADMIN1 is active ...
        var body = new { userId = "NEFTDESK2", userName = "NEFT Desk 2", email = "n2@zed.test", mobileNo = "9876543210" };
        var second = await master.PostAsJsonAsync("/api/staff/neft-admins", body);
        Assert.Equal("NEFTADMIN1 is already the NEFT Admin. Please block that login first: there is one NEFT Admin.", await second.ProblemTitle());
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == NeftAdminsController.InsertSql);

        // ... and taken once it is blocked.
        _host.Sql.Queries[NeftAdminsController.ListSql] = _ =>
            [new { UserId = "NEFTADMIN1", UserName = "NEFT Desk", RoleId = 6, Email = "d@zed.test", MobileNo = "9999999999", StateCode = "ALL", IsActive = (bool?)false, CreatedBy = "MASTER1", CreatedDate = (DateTime?)null }];
        var r = await master.PostAsJsonAsync("/api/staff/neft-admins", body);
        Assert.True(r.IsSuccessStatusCode, await r.Content.ReadAsStringAsync());
        var insert = Assert.Single(_host.Sql.Calls, c => c.Name == NeftAdminsController.InsertSql);
        Assert.Equal(("NEFTDESK2", "MASTER1"), (FakeSql.Arg(insert.Args, "UserId"), FakeSql.Arg(insert.Args, "CreatedBy")));
        Assert.Contains("NEFTDESK2", Assert.Single(_host.Email.Sent).HtmlBody);

        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.GetAsync("/api/staff/neft-admins")).StatusCode);
        // The Admin's User Management no longer takes "every state" for an MSME DFO.
        var dfo = await admin.PostAsJsonAsync("/api/staff/accounts", new { userId = "NEFTX", roleId = 6, userName = "X", email = "x@zed.test", mobileNo = "9876543210", sectorActivity = "Both", states = new[] { "ALL" }, neftLists = new[] { "main" } });
        Assert.Equal("Please choose the applicable states from the list.", await dfo.ProblemTitle());
    }

    [Fact]
    public async Task The_NEFT_Admin_sees_every_state_and_gets_a_pass_for_the_consultancy_portal_only()
    {
        var neft = await UsersMastersLogin.SignInAsync(_host, "NEFTADMIN1");
        Assert.True((await neft.GetFromJsonAsync<JsonElement>("/api/auth/me")).GetProperty("isNeftAdmin").GetBoolean());
        Assert.Equal(["ZEDM1", "ZEDM2", "ZEDM3", "ZEDM4"], ZedIds(await neft.GetFromJsonAsync<JsonElement>("/api/staff/neft/transactions?list=new")));

        var pass = await neft.PostAsync("/api/staff/admin-portals/consultancy/handoff", null);
        Assert.True(pass.IsSuccessStatusCode, await pass.Content.ReadAsStringAsync());
        var stored = _host.Sql.Calls.Single(c => c.Name == AdminPortalsController.InsertSql);
        Assert.Equal(("NeftHandoff:Consultancy", "NEFTADMIN1"), (FakeSql.Arg(stored.Args, "OtpType"), FakeSql.Arg(stored.Args, "UserId")));
        Assert.Equal(HttpStatusCode.NotFound, (await neft.PostAsync("/api/staff/admin-portals/surveillance/handoff", null)).StatusCode);

        // A state's MSME DFO sees its state and gets no pass.
        var up = await UsersMastersLogin.SignInAsync(_host, "SC_UP");
        Assert.Equal(["ZEDM1", "ZEDM3"], ZedIds(await up.GetFromJsonAsync<JsonElement>("/api/staff/neft/transactions?list=new")));
        Assert.Equal(HttpStatusCode.NotFound, (await up.PostAsync("/api/staff/admin-portals/consultancy/handoff", null)).StatusCode);
    }

    [Fact]
    public async Task An_MSME_DFO_sees_its_states_and_districts_and_gets_a_pass_for_handholding_only_with_that_list()
    {
        var both = await UsersMastersLogin.SignInAsync(_host, "DFO_BOTH");
        var me = await both.GetFromJsonAsync<JsonElement>("/api/auth/me");
        Assert.False(me.GetProperty("isNeftAdmin").GetBoolean());
        Assert.Equal(["consultancy:neft", "main:neft"], me.GetProperty("screens").EnumerateArray().Select(x => x.GetString()));
        // Lucknow (UP) and Pune (Maharashtra); not Kanpur (a district not chosen) nor Patna (a state not chosen).
        Assert.Equal(["ZEDM1", "ZEDM2"], ZedIds(await both.GetFromJsonAsync<JsonElement>("/api/staff/neft/transactions?list=new")));
        var pass = await both.PostAsync("/api/staff/admin-portals/consultancy/handoff", null);
        Assert.True(pass.IsSuccessStatusCode, await pass.Content.ReadAsStringAsync());
        Assert.Equal("NeftHandoff:Consultancy", FakeSql.Arg(_host.Sql.Calls.Single(c => c.Name == AdminPortalsController.InsertSql).Args, "OtpType"));
        Assert.Equal(HttpStatusCode.NotFound, (await both.PostAsync("/api/staff/admin-portals/surveillance/handoff", null)).StatusCode);

        // Handholding only: no Financial Assistance list here.
        var tu = await UsersMastersLogin.SignInAsync(_host, "DFO_TU");
        Assert.Equal(HttpStatusCode.Forbidden, (await tu.GetAsync("/api/staff/neft/transactions?list=new")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await tu.PostAsJsonAsync("/api/staff/neft/transactions/1/approve", new { })).StatusCode);
    }
}
