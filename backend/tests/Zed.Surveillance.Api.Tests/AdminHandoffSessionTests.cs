using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Zed.Core.Security;
using Zed.Main.Api.Tests;
using Zed.Portal.Features.Staff.AdminPortals;

namespace Zed.Surveillance.Api.Tests;

/// <summary>
/// M12 for the One Admin hand-over: the Admin's session here carries main's session stamp, read through the read-only main
/// connection, so blocking the Admin or a new password on main ends it too.
/// </summary>
public sealed class AdminHandoffSessionTests : IDisposable
{
    private readonly TestHost _host = new();
    private readonly FakeSql _main = new();
    private readonly WebApplicationFactory<Program> _app;
    private readonly Dictionary<string, string> _passes = [];
    private string _mainStamp = "AAAAAAAA-0000-0000-0000-000000000001";

    public AdminHandoffSessionTests()
    {
        _main.Queries[AdminPortalsController.FindSql] = args =>
            _passes.FirstOrDefault(p => AdminPortalsController.Hash(p.Key) == FakeSql.Arg(args, "Hash")).Value is { } userId
                ? [new AdminPortalsController.HandoffRow(userId, "Main Admin")]
                : [];
        _main.Queries[AdminPortalsController.ActiveAdminSql] = args => [new AdminPortalsController.ActiveAdminRow(FakeSql.Arg(args, "UserId"))];
        _main.Queries[SessionStamps.SelectSql] = args => FakeSql.Arg(args, "UserId") == "ADMIN1" ? [_mainStamp] : [];
        // This portal's own Users has another value for the same ID: it must not be the one compared.
        _host.Sql.Queries[SessionStamps.SelectSql] = _ => ["BBBBBBBB-0000-0000-0000-000000000002"];
        _host.Sql.Procs["SP_MASTER_GET_SECTORS"] = _ => FakeSql.Sets([new { Id = 1, SectorCode = "24", SectorName = "Basic metals" }]);
        _app = ReviewTestHost.With(_host, new ReviewFakeDocuments(), _main);
        _app.Services.GetRequiredService<IConfiguration>()[SessionStampValidator.CacheSetting] = "0";
    }

    public void Dispose()
    {
        _app.Dispose();
        _host.Dispose();
    }

    private async Task<HttpClient> HandedOverAsync()
    {
        // Taken passes are remembered per process: a fresh one for each test.
        var token = "SessionPass" + Guid.NewGuid().ToString("N");
        _passes[token] = "ADMIN1";
        var client = await ReviewTestHost.SignInAsync(_app, null, UserRole.Admin);
        var r = await client.PostAsJsonAsync("/api/staff/admin-portals/handoff", new { token });
        Assert.True(r.IsSuccessStatusCode, await r.Content.ReadAsStringAsync());
        return client;
    }

    [Fact]
    public async Task A_new_stamp_on_main_ends_the_admins_session_here()
    {
        var client = await HandedOverAsync();
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/staff/masters/sectors")).StatusCode);
        Assert.Contains(_main.Calls, c => c.Name == SessionStamps.SelectSql && FakeSql.Arg(c.Args, "UserId") == "ADMIN1");

        _mainStamp = "AAAAAAAA-0000-0000-0000-000000000003"; // blocked, or a new password, on main
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/staff/masters/sectors")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.GetAsync("/api/auth/me")).StatusCode);
    }

    [Fact]
    public async Task This_portals_own_users_keep_their_own_stamp()
    {
        var assessor = await ReviewTestHost.SignInAsync(_app, "ZEDAS0001", UserRole.DesktopAssessor);
        Assert.Equal(HttpStatusCode.OK, (await assessor.GetAsync("/api/auth/me")).StatusCode);
        Assert.DoesNotContain(_main.Calls, c => c.Name == SessionStamps.SelectSql && FakeSql.Arg(c.Args, "UserId") == "ZEDAS0001");
    }

    [Fact]
    public async Task Logout_here_does_not_touch_the_other_portals_cookies()
    {
        var client = await HandedOverAsync();
        var r = await client.PostAsync("/api/auth/logout", null);
        Assert.Equal(HttpStatusCode.NoContent, r.StatusCode);
        Assert.DoesNotContain(r.Headers.GetValues("Set-Cookie"), c => c.StartsWith("zed.consultancy=", StringComparison.Ordinal));
    }
}
