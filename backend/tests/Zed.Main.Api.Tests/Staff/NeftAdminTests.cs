using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Portal.Features.Staff.AdminPortals;
using Zed.Portal.Features.Staff.Neft;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>One NEFT Admin (2026-11-07): assigned by the Master Admin, every state, financial assistance and TU.</summary>
public sealed class NeftAdminTests : IDisposable
{
    private readonly TestHost _host = new();

    public NeftAdminTests()
    {
        UsersMastersLogin.Setup(_host);
        // NEFTADMIN1: an MSME DFO of every state; SC_UP: an MSME DFO of Uttar Pradesh.
        var users = new Dictionary<string, (int Role, string? State)> { ["NEFTADMIN1"] = (6, "ALL"), ["SC_UP"] = (6, "9") };
        var masters = _host.Sql.Procs["SP_GET_USER_DETAILS"];
        _host.Sql.Procs["SP_GET_USER_DETAILS"] = args => users.TryGetValue(FakeSql.Arg(args, "UserId")?.ToUpperInvariant() ?? "", out var u)
            ? FakeSql.Sets([new { UserId = FakeSql.Arg(args, "UserId")!.ToUpperInvariant(), UserName = "Desk", RoleId = u.Role, Email = "d@zed.test", StateCode = u.State }], [new { ERRORMSG = "SUCCESS" }])
            : masters(args);
        _host.Sql.Procs["SP_NEFT_TRANSACTIONS_BY_STATUS"] = _ => FakeSql.Sets(
            [new { TransactionId = 1, ZedId = "ZEDM1", StateId = 9, PStateId = (int?)null, VerificationStatus = 4 },
             new { TransactionId = 2, ZedId = "ZEDM2", StateId = 27, PStateId = (int?)null, VerificationStatus = 4 }]);
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

        var r = await master.PostAsJsonAsync("/api/staff/neft-admins", new { userId = "NEFTDESK2", userName = "NEFT Desk 2", email = "n2@zed.test", mobileNo = "9876543210" });
        Assert.True(r.IsSuccessStatusCode, await r.Content.ReadAsStringAsync());
        var insert = Assert.Single(_host.Sql.Calls, c => c.Name == NeftAdminsController.InsertSql);
        Assert.Equal(("NEFTDESK2", "MASTER1"), (FakeSql.Arg(insert.Args, "UserId"), FakeSql.Arg(insert.Args, "CreatedBy")));
        Assert.Contains("NEFTDESK2", Assert.Single(_host.Email.Sent).HtmlBody);

        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.GetAsync("/api/staff/neft-admins")).StatusCode);
        // The Admin's User Management no longer takes "every state" for an MSME DFO.
        var dfo = await admin.PostAsJsonAsync("/api/staff/accounts", new { userId = "NEFTX", roleId = 6, userName = "X", email = "x@zed.test", mobileNo = "9876543210", stateCode = "ALL" });
        Assert.Equal("Please select the state of the MSME DFO.", await dfo.ProblemTitle());
    }

    [Fact]
    public async Task The_NEFT_Admin_sees_every_state_and_gets_a_pass_for_the_consultancy_portal_only()
    {
        var neft = await UsersMastersLogin.SignInAsync(_host, "NEFTADMIN1");
        Assert.True((await neft.GetFromJsonAsync<JsonElement>("/api/auth/me")).GetProperty("isNeftAdmin").GetBoolean());
        Assert.Equal(["ZEDM1", "ZEDM2"], ZedIds(await neft.GetFromJsonAsync<JsonElement>("/api/staff/neft/transactions?list=new")));

        var pass = await neft.PostAsync("/api/staff/admin-portals/consultancy/handoff", null);
        Assert.True(pass.IsSuccessStatusCode, await pass.Content.ReadAsStringAsync());
        var stored = _host.Sql.Calls.Single(c => c.Name == AdminPortalsController.InsertSql);
        Assert.Equal(("NeftHandoff:Consultancy", "NEFTADMIN1"), (FakeSql.Arg(stored.Args, "OtpType"), FakeSql.Arg(stored.Args, "UserId")));
        Assert.Equal(HttpStatusCode.NotFound, (await neft.PostAsync("/api/staff/admin-portals/surveillance/handoff", null)).StatusCode);

        // A state's MSME DFO sees its state and gets no pass.
        var up = await UsersMastersLogin.SignInAsync(_host, "SC_UP");
        Assert.Equal(["ZEDM1"], ZedIds(await up.GetFromJsonAsync<JsonElement>("/api/staff/neft/transactions?list=new")));
        Assert.Equal(HttpStatusCode.NotFound, (await up.PostAsync("/api/staff/admin-portals/consultancy/handoff", null)).StatusCode);
    }
}
