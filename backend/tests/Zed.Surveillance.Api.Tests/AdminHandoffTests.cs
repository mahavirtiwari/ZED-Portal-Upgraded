using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.DependencyInjection;
using Zed.Core.Data;
using Zed.Core.Security;
using Zed.Main.Api.Tests;
using Zed.Portal.Features.Staff.AdminPortals;

namespace Zed.Surveillance.Api.Tests;

/// <summary>One Admin (V4): the main portal's Admin signs in here with a one-time pass the main host stored in dbo.OTP.</summary>
public sealed class AdminHandoffTests : IDisposable
{
    private const string Token = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE";
    // Taken passes are remembered per process: each test uses its own.
    private const string ElsewhereToken = "ElsewhereTakenPass0123456789-_AbCdEfGhIjKlM";
    private const string BlockedToken = "BlockedAdminPass0123456789-_AbCdEfGhIjKlMnO";
    private readonly TestHost _host = new();
    private readonly FakeSql _main = new();
    private readonly WebApplicationFactory<Program> _app;

    /// <summary>Passes stored on main (dbo.OTP) and the active Admins of main's Users.</summary>
    private readonly Dictionary<string, string> _passes = new() { [Token] = "ADMIN1", [ElsewhereToken] = "ADMIN1", [BlockedToken] = "ADMIN2" };
    private readonly HashSet<string> _activeAdmins = ["ADMIN1"];

    public AdminHandoffTests()
    {
        _main.Queries[AdminPortalsController.FindSql] = args =>
            FakeSql.Arg(args, "OtpType") == "AdminHandoff:Surveillance" && _passes.FirstOrDefault(p => AdminPortalsController.Hash(p.Key) == FakeSql.Arg(args, "Hash")).Value is { } userId
                ? [new AdminPortalsController.HandoffRow(userId, "Main Admin")]
                : [];
        _main.Queries[AdminPortalsController.ActiveAdminSql] = args =>
            FakeSql.Arg(args, "RoleId") == "1" && _activeAdmins.Contains(FakeSql.Arg(args, "UserId")!)
                ? [new AdminPortalsController.ActiveAdminRow(FakeSql.Arg(args, "UserId"))]
                : [];
        _host.Sql.Procs["SP_MASTER_GET_SECTORS"] = _ => FakeSql.Sets([new { Id = 1, SectorCode = "24", SectorName = "Basic metals" }]);
        _app = ReviewTestHost.With(_host, new ReviewFakeDocuments(), _main);
    }

    public void Dispose()
    {
        _app.Dispose();
        _host.Dispose();
    }

    [Fact]
    public async Task The_main_admin_is_signed_in_here_once_with_the_pass_and_works_as_admin()
    {
        var client = await ReviewTestHost.SignInAsync(_app, null, UserRole.Admin);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/staff/masters/sectors")).StatusCode);

        var r = await client.PostAsJsonAsync("/api/staff/admin-portals/handoff", new { token = Token });
        Assert.True(r.IsSuccessStatusCode, await r.Content.ReadAsStringAsync());
        var body = await r.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Main Admin", body.GetProperty("userName").GetString());
        Assert.False(string.IsNullOrEmpty(body.GetProperty("xsrfToken").GetString()));
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/staff/masters/sectors")).StatusCode);
        var me = await client.GetFromJsonAsync<JsonElement>("/api/auth/me");
        Assert.Contains("ADMIN1", me.GetRawText());

        // Once only.
        var again = await (await ReviewTestHost.SignInAsync(_app, null, UserRole.Admin)).PostAsJsonAsync("/api/staff/admin-portals/handoff", new { token = Token });
        Assert.Equal(HttpStatusCode.BadRequest, again.StatusCode);
    }

    [Fact]
    public async Task A_pass_another_server_already_took_is_refused()
    {
        // Recorded by another server of this portal in the shared cache (Cache:SqlServerTable).
        await _app.Services.GetRequiredService<IDistributedCache>().SetAsync(
            AdminPortalsController.TakenKey(AdminPortalsController.Hash(ElsewhereToken)), [1], new DistributedCacheEntryOptions { AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(4) });

        var client = await ReviewTestHost.SignInAsync(_app, null, UserRole.Admin);
        var r = await client.PostAsJsonAsync("/api/staff/admin-portals/handoff", new { token = ElsewhereToken });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/staff/masters/sectors")).StatusCode);
    }

    [Fact]
    public async Task A_used_pass_is_recorded_for_the_other_servers()
    {
        var client = await ReviewTestHost.SignInAsync(_app, null, UserRole.Admin);
        // A fresh pass of this test only (the per-process memory of taken passes is shared by the tests).
        var token = "RecordedPass" + Guid.NewGuid().ToString("N");
        _passes[token] = "ADMIN1";
        Assert.True((await client.PostAsJsonAsync("/api/staff/admin-portals/handoff", new { token })).IsSuccessStatusCode);

        var cache = _app.Services.GetRequiredService<IDistributedCache>();
        Assert.NotNull(await cache.GetAsync(AdminPortalsController.TakenKey(AdminPortalsController.Hash(token))));
    }

    [Fact]
    public async Task A_pass_of_an_account_that_is_no_longer_an_active_admin_on_main_is_refused()
    {
        var client = await ReviewTestHost.SignInAsync(_app, null, UserRole.Admin);
        var r = await client.PostAsJsonAsync("/api/staff/admin-portals/handoff", new { token = BlockedToken });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/staff/masters/sectors")).StatusCode);
        Assert.Contains(_main.Calls, c => c.Name == AdminPortalsController.ActiveAdminSql && FakeSql.Arg(c.Args, "UserId") == "ADMIN2");
    }

    [Theory]
    [InlineData("short")]
    [InlineData("ZZZZEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE")]
    public async Task Unknown_or_malformed_passes_are_refused(string token)
    {
        var client = await ReviewTestHost.SignInAsync(_app, null, UserRole.Admin);
        var r = await client.PostAsJsonAsync("/api/staff/admin-portals/handoff", new { token });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/staff/masters/sectors")).StatusCode);
    }

    [Fact]
    public async Task Only_main_issues_passes()
    {
        var admin = await ReviewTestHost.SignInAsync(_app, "ADMIN1", UserRole.Admin);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsync("/api/staff/admin-portals/consultancy/handoff", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync("/api/staff/admin-portals")).StatusCode);
    }
}
