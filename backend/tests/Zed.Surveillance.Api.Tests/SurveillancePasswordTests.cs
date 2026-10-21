using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Zed.Core.Data;
using Zed.Core.Security;
using Zed.Main.Api.Tests;
using Zed.TestSupport;

namespace Zed.Surveillance.Api.Tests;

/// <summary>
/// Agencies and assessors are created on main and copied here in clear text (#111). Once the old sites are off, main's
/// hash is their password on this portal too (docs/PASSWORDS.md); the copy is replaced.
/// </summary>
public sealed class SurveillancePasswordTests : IDisposable
{
    private const string Assessor = "ZEDAS0001";
    private readonly TestHost _host = new();
    private readonly FakeSql _main = new();
    private readonly FakePasswords _own;
    private readonly FakePasswords _master;
    private readonly WebApplicationFactory<Program> _app;

    public SurveillancePasswordTests()
    {
        _own = new FakePasswords().Attach(_host.Sql.Procs);
        _master = new FakePasswords().Attach(_main.Procs);
        _own.Add(Assessor, "3", "Copy#Pass1");                    // copied when main created the account
        _master.Accounts[Assessor] = new FakePasswords.Account("3", PasswordStore.NewReplacement(), PasswordStore.Hash("Main#Pass2"));
        _host.Sql.Procs["SP_GET_USER_DETAILS"] = args =>
        {
            var id = FakeSql.Arg(args, "UserId") ?? "";
            var typed = FakeSql.Arg(args, "Password");
            return _own.Accounts.TryGetValue(id, out var a) && typed is not null && string.Equals(typed, a.Stored, StringComparison.OrdinalIgnoreCase)
                ? FakeSql.Sets([new { UserId = id, UserName = "Assessor", RoleId = 3, Email = "a@zed.test", Password = a.Stored }], [new { ERRORMSG = "SUCCESS" }])
                : FakeSql.Sets([], [new { ERRORMSG = "INVALID CREDENTIAILS" }]);
        };
        _host.Sql.Procs["SP_GET_USER_DETAILS_BY_USER_ID"] = args =>
            _own.Accounts.TryGetValue(FakeSql.Arg(args, "UserId") ?? "", out var a)
                ? FakeSql.Sets([new { UserId = Assessor, UserName = "Assessor", RoleId = 3, Email = "a@zed.test", Password = a.Stored }])
                : FakeSql.Sets([]);
        _app = _host.WithWebHostBuilder(b => b.ConfigureTestServices(s => s.AddKeyedSingleton<ISqlExecutor>(ZedDatabases.Main, _main)));
    }

    public void Dispose()
    {
        _app.Dispose();
        _host.Dispose();
    }

    private void Mode(PasswordMode mode) => FakePasswords.SetMode(_app.Services, mode);

    private async Task<(HttpClient Client, HttpStatusCode Status)> Login(string password)
    {
        var client = await ReviewTestHost.SignInAsync(_app, null, UserRole.DesktopAssessor);
        var r = await client.PostAsJsonAsync("/api/staff/auth/login", new { userId = Assessor, password });
        return (client, r.StatusCode);
    }

    [Fact]
    public async Task Dual_keeps_the_copy_as_the_password_and_does_not_ask_main()
    {
        Assert.Equal(HttpStatusCode.OK, (await Login("Copy#Pass1")).Status);
        Assert.Empty(_main.Calls);
        Assert.True(_own.HashMatches(Assessor, "Copy#Pass1"));
        Assert.Null(_own.LastWrite(Assessor)!.Replace);
    }

    [Fact]
    public async Task After_the_old_sites_mains_password_signs_in_and_the_copy_no_longer_does()
    {
        Mode(PasswordMode.HashOnly);
        Assert.Equal(HttpStatusCode.BadRequest, (await Login("Copy#Pass1")).Status);
        Assert.Equal(HttpStatusCode.OK, (await Login("Main#Pass2")).Status);

        var write = Assert.Single(_own.Writes);
        Assert.Null(write.Hash);
        Assert.True(PasswordStore.IsReplacement(write.Replace));
        Assert.Empty(_master.Writes); // this host only reads main
    }

    [Fact]
    public async Task After_the_old_sites_an_account_held_by_main_changes_its_password_there()
    {
        Mode(PasswordMode.HashOnly);
        var (client, status) = await Login("Main#Pass2");
        Assert.Equal(HttpStatusCode.OK, status);
        (await client.GetAsync("/api/auth/me")).EnsureSuccessStatusCode();
        var r = await client.PostAsJsonAsync("/api/account/change-password", new { oldPassword = "Main#Pass2", newPassword = "New#Pass33", confirmPassword = "New#Pass33" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Contains("main ZED portal", await r.ProblemTitle());
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.StartsWith("UPDATE Users"));
    }

    [Fact]
    public async Task An_account_only_this_system_has_uses_its_own_hash()
    {
        _master.Accounts.TryRemove(Assessor, out _);
        _own.Add(Assessor, "3", PasswordStore.NewReplacement(), hashOf: "Own#Pass4");
        Mode(PasswordMode.HashOnly);
        Assert.Equal(HttpStatusCode.OK, (await Login("Own#Pass4")).Status);
    }
}
