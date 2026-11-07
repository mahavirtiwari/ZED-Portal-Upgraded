using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Zed.Core.Data;
using Zed.Main.Api.Tests;
using Zed.Portal.Features.Staff.AdminPortals;

namespace Zed.Consultancy.Api.Tests;

/// <summary>One NEFT Admin (2026-11-07): the main portal's NEFT Admin opens the Technology Upgradation reimbursements here.</summary>
public sealed class NeftAdminHandoffTests : IDisposable
{
    private const string Token = "NeftAdminPass0123456789-_AbCdEfGhIjKlMnOpQr";
    private const string BlockedToken = "NeftBlockedPass0123456789-_AbCdEfGhIjKlMnO";
    private readonly TestHost _host = new();
    private readonly FakeSql _main = new();
    private readonly WebApplicationFactory<Program> _app;

    public NeftAdminHandoffTests()
    {
        var passes = new Dictionary<string, string> { [Token] = "NEFTADMIN1", [BlockedToken] = "NEFTOLD" };
        _main.Queries[AdminPortalsController.FindSql] = args =>
            FakeSql.Arg(args, "OtpType") == "NeftHandoff:Consultancy" && passes.FirstOrDefault(p => AdminPortalsController.Hash(p.Key) == FakeSql.Arg(args, "Hash")).Value is { } userId
                ? [new AdminPortalsController.HandoffRow(userId, "NEFT Desk")]
                : [];
        _main.Queries[AdminPortalsController.ActiveNeftAdminSql] = args =>
            FakeSql.Arg(args, "UserId") == "NEFTADMIN1" ? [new AdminPortalsController.ActiveAdminRow("NEFTADMIN1")] : [];
        // TU reimbursements of two states.
        _host.Sql.Procs["SP_NEFT_TRANSACTIONS_BY_STATUS"] = _ => FakeSql.Sets(
            [new { TransactionId = 1, ZedId = "ZEDM1", StateId = 9, PStateId = (int?)null, VerificationStatus = 4 },
             new { TransactionId = 2, ZedId = "ZEDM2", StateId = 27, PStateId = (int?)null, VerificationStatus = 4 }]);
        _app = _host.WithWebHostBuilder(b => b.ConfigureTestServices(s => s.AddKeyedSingleton<ISqlExecutor>(ZedDatabases.Main, _main)));
    }

    public void Dispose()
    {
        _app.Dispose();
        _host.Dispose();
    }

    [Fact]
    public async Task The_main_NEFT_Admin_is_signed_in_here_and_sees_every_states_TU_reimbursements()
    {
        var client = await StaffTestSignIn.BrowserAsync(_app, null, 0);
        var r = await client.PostAsJsonAsync("/api/staff/admin-portals/handoff", new { token = Token });
        Assert.True(r.IsSuccessStatusCode, await r.Content.ReadAsStringAsync());
        var me = await client.GetFromJsonAsync<JsonElement>("/api/auth/me");
        Assert.Equal(6, me.GetProperty("roleId").GetInt32());
        Assert.True(me.GetProperty("isNeftAdmin").GetBoolean());
        var list = await client.GetFromJsonAsync<JsonElement>("/api/staff/neft/transactions?list=new");
        Assert.Equal(["ZEDM1", "ZEDM2"], list.GetProperty("transactions").EnumerateArray().Select(t => t.GetProperty("ZedId").GetString()));
    }

    [Fact]
    public async Task A_login_that_is_no_longer_an_active_NEFT_Admin_on_main_is_refused()
    {
        var client = await StaffTestSignIn.BrowserAsync(_app, null, 0);
        var r = await client.PostAsJsonAsync("/api/staff/admin-portals/handoff", new { token = BlockedToken });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/staff/neft/transactions?list=new")).StatusCode);
    }
}
