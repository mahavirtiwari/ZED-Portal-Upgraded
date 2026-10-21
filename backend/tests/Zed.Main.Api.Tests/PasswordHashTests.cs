using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Configuration;
using Zed.Core.Security;
using Zed.TestSupport;

namespace Zed.Main.Api.Tests;

/// <summary>Salted hashes next to Users.Password (SECURITY-FINDINGS #2, docs/PASSWORDS.md) on the web logins and password changes.</summary>
public sealed class PasswordHashTests : IDisposable
{
    private const string Msme = "ZEDMSME000001";
    private const string Admin = "ADMIN1";
    private readonly TestHost _host = new();
    private readonly FakePasswords _passwords;

    public PasswordHashTests()
    {
        _passwords = new FakePasswords().Attach(_host.Sql.Procs);
        _passwords.Add(Msme, "5", "Right#Pass1");
        _passwords.Add(Admin, "1", "Right#Pass1");
        // The legacy procedure: the row when @Password equals the stored value (case-insensitive collation).
        _host.Sql.Procs["SP_GET_USER_DETAILS"] = args =>
        {
            var id = FakeSql.Arg(args, "UserId") ?? "";
            var typed = FakeSql.Arg(args, "Password");
            return _passwords.Accounts.TryGetValue(id, out var a) && typed is not null && a.Stored is not null &&
                   string.Equals(typed.TrimEnd(), a.Stored.TrimEnd(), StringComparison.OrdinalIgnoreCase)
                ? FakeSql.Sets([new { UserId = id, UserName = id + " name", RoleId = int.Parse(a.RoleId!), Email = "x@y.test", Password = a.Stored }], [new { ERRORMSG = "SUCCESS" }])
                : FakeSql.Sets([], [new { ERRORMSG = "INVALID CREDENTIAILS" }]);
        };
        _host.Sql.Procs["SP_GET_USER_DETAILS_BY_USER_ID"] = args =>
            _passwords.Accounts.TryGetValue(FakeSql.Arg(args, "UserId") ?? "", out var a)
                ? FakeSql.Sets([new { UserId = FakeSql.Arg(args, "UserId"), UserName = "Acme", RoleId = int.Parse(a.RoleId!), Email = "a@acme.test", Password = a.Stored }])
                : FakeSql.Sets([]);
        _resets = new FakeStaffResets().Attach(_host.Sql.Procs);
        _resets.Add(Msme, 5, "a@acme.test");
    }

    private readonly FakeStaffResets _resets;

    public void Dispose() => _host.Dispose();

    private void Mode(PasswordMode mode) => FakePasswords.SetMode(_host.Services, mode);

    private async Task<HttpResponseMessage> MsmeLogin(HttpClient client, string password) =>
        await client.PostAsJsonAsync("/api/msme/auth/login", new { userId = Msme, password });

    private string? ProcedurePassword() =>
        FakeSql.Arg(_host.Sql.Calls.Last(c => c.Name == "SP_GET_USER_DETAILS").Args, "Password");

    // ------------------------------------------------------------------ Hashing

    [Fact]
    public void Hashes_are_salted_and_compare_like_the_procedures()
    {
        var a = PasswordStore.Hash("Right#Pass1");
        var b = PasswordStore.Hash("Right#Pass1");
        Assert.NotEqual(a, b);
        Assert.StartsWith("u1$", a);
        Assert.True(a.Length <= 256);
        Assert.Equal(PasswordVerificationResult.Success, PasswordStore.Verify(a, "Right#Pass1"));
        Assert.Equal(PasswordVerificationResult.Success, PasswordStore.Verify(a, "RIGHT#PASS1  ")); // as the CI collation
        Assert.Equal(PasswordVerificationResult.Failed, PasswordStore.Verify(a, "Right#Pass2"));
        Assert.Equal(PasswordVerificationResult.Failed, PasswordStore.Verify("plain", "plain"));
    }

    [Fact]
    public void Replacement_values_fit_the_column_and_never_match()
    {
        var r = PasswordStore.NewReplacement();
        Assert.Equal(49, r.Length);
        Assert.True(PasswordStore.IsReplacement(r));
        Assert.NotEqual(r, PasswordStore.NewReplacement());
        Assert.False(LegacyPasswords.Matches(r, r));
        Assert.False(LegacyPasswords.MatchesStored(new Dictionary<string, object?> { ["Password"] = r }, r));
        Assert.False(PasswordStore.IsReplacement(PasswordStore.RefusedValue));
    }

    [Fact]
    public void An_unknown_mode_is_an_error()
    {
        var config = new Microsoft.Extensions.Configuration.ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { [PasswordStore.Setting] = "Plain" }).Build();
        Assert.Throws<InvalidOperationException>(() => { PasswordStore.ReadMode(config); });
        config[PasswordStore.Setting] = "hashonly";
        Assert.Equal(PasswordMode.HashOnly, PasswordStore.ReadMode(config));
        Assert.Equal(PasswordMode.Dual, PasswordStore.ReadMode(new Microsoft.Extensions.Configuration.ConfigurationBuilder().Build()));
    }

    // ------------------------------------------------------------------ Dual (default)

    [Fact]
    public async Task Dual_login_checks_the_plain_value_and_records_a_hash()
    {
        var client = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.OK, (await MsmeLogin(client, "Right#Pass1")).StatusCode);

        Assert.Equal("Right#Pass1", ProcedurePassword());
        var write = Assert.Single(_passwords.Writes);
        Assert.Null(write.Replace); // the old sites still read the plain value
        Assert.True(_passwords.HashMatches(Msme, "Right#Pass1"));
        Assert.Equal("Right#Pass1", _passwords.Accounts[Msme].Stored);
    }

    [Fact]
    public async Task Dual_login_with_a_current_hash_writes_nothing()
    {
        _passwords.Add(Msme, "5", "Right#Pass1", hashOf: "Right#Pass1");
        var client = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.OK, (await MsmeLogin(client, "Right#Pass1")).StatusCode);
        Assert.Empty(_passwords.Writes);
    }

    [Fact]
    public async Task Dual_login_after_an_old_site_changed_the_password_follows_the_plain_value()
    {
        // The hash is from before; the old site's change-password wrote a new plain value since.
        _passwords.Add(Msme, "5", "New#Pass22", hashOf: "Right#Pass1");
        var client = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.OK, (await MsmeLogin(client, "New#Pass22")).StatusCode);
        Assert.True(_passwords.HashMatches(Msme, "New#Pass22"));
        Assert.False(_passwords.HashMatches(Msme, "Right#Pass1"));
    }

    [Fact]
    public async Task Dual_master_password_is_refused_and_never_hashed()
    {
        _host.Sql.Procs["SP_GET_USER_DETAILS"] = _ => FakeSql.Sets(
            [new { UserId = Msme, UserName = "Acme", RoleId = 5, Password = "Right#Pass1" }], [new { ERRORMSG = "SUCCESS" }]);
        var client = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.BadRequest, (await MsmeLogin(client, "Any#Master1")).StatusCode);
        Assert.Empty(_passwords.Writes);
    }

    [Fact]
    public async Task Dual_login_works_when_the_migration_is_missing()
    {
        _host.Sql.Procs[PasswordStore.GetProcedure] = _ => throw new InvalidOperationException("Could not find stored procedure");
        _host.Sql.Procs[PasswordStore.SetProcedure] = _ => throw new InvalidOperationException("Could not find stored procedure");
        var client = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.OK, (await MsmeLogin(client, "Right#Pass1")).StatusCode);
    }

    [Fact]
    public async Task Dual_after_migrate_signs_migrated_accounts_in_with_their_hash()
    {
        // Set back to Dual after Migrate had replaced the plain value: only the hash can work, and the value itself is refused.
        var replacement = PasswordStore.NewReplacement();
        _passwords.Accounts[Msme] = new FakePasswords.Account("5", replacement, PasswordStore.Hash("Right#Pass1"));
        var client = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.BadRequest, (await MsmeLogin(client, replacement)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await MsmeLogin(client, "Right#Pass1")).StatusCode);
        Assert.Equal(replacement, ProcedurePassword());
    }

    // ------------------------------------------------------------------ Migrate

    [Fact]
    public async Task Migrate_checks_the_hash_and_replaces_the_plain_value()
    {
        Mode(PasswordMode.Migrate);
        _passwords.Add(Msme, "5", "Right#Pass1", hashOf: "Right#Pass1");
        var client = await _host.CreateBrowserAsync();

        Assert.Equal(HttpStatusCode.OK, (await MsmeLogin(client, "right#pass1")).StatusCode);
        Assert.Equal("Right#Pass1", ProcedurePassword()); // the stored value, so the procedure's own checks run
        var stored = _passwords.Accounts[Msme].Stored;
        Assert.True(PasswordStore.IsReplacement(stored));
        Assert.Null(Assert.Single(_passwords.Writes).Hash);

        // Next time the procedure gets the replacement, which only V4 knows.
        Assert.Equal(HttpStatusCode.OK, (await MsmeLogin(await _host.CreateBrowserAsync(), "Right#Pass1")).StatusCode);
        Assert.Equal(stored, ProcedurePassword());
        Assert.Single(_passwords.Writes);
    }

    [Fact]
    public async Task Migrate_wrong_password_is_refused_without_sending_it_to_the_procedure()
    {
        Mode(PasswordMode.Migrate);
        _passwords.Add(Msme, "5", "Right#Pass1", hashOf: "Right#Pass1");
        var client = await _host.CreateBrowserAsync();
        var r = await MsmeLogin(client, "Wrong#Pass1");
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        // Still called, for its failed-login count, but FailedLogins gets the marker instead of the typed password.
        Assert.Equal(PasswordStore.RefusedValue, ProcedurePassword());
        Assert.Empty(_passwords.Writes);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_UPDATE_LOGIN");
    }

    [Fact]
    public async Task Migrate_hash_wins_over_a_plain_value_that_still_matches()
    {
        Mode(PasswordMode.Migrate);
        _passwords.Add(Msme, "5", "Old#Pass11", hashOf: "New#Pass22");
        var client = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.BadRequest, (await MsmeLogin(client, "Old#Pass11")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await MsmeLogin(client, "New#Pass22")).StatusCode);
    }

    [Fact]
    public async Task Migrate_account_without_a_hash_signs_in_once_against_the_plain_value_and_moves()
    {
        Mode(PasswordMode.Migrate);
        var client = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.OK, (await MsmeLogin(client, "Right#Pass1")).StatusCode);
        Assert.Equal("Right#Pass1", ProcedurePassword());
        var write = Assert.Single(_passwords.Writes);
        Assert.True(PasswordStore.IsReplacement(write.Replace));
        Assert.True(_passwords.HashMatches(Msme, "Right#Pass1"));
    }

    [Fact]
    public async Task Migrate_account_without_a_hash_and_a_master_password_is_refused()
    {
        Mode(PasswordMode.Migrate);
        _host.Sql.Procs["SP_GET_USER_DETAILS"] = _ => FakeSql.Sets(
            [new { UserId = Msme, UserName = "Acme", RoleId = 5, Password = "Right#Pass1" }], [new { ERRORMSG = "SUCCESS" }]);
        var client = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.BadRequest, (await MsmeLogin(client, "Any#Master1")).StatusCode);
        Assert.Empty(_passwords.Writes);
    }

    // ------------------------------------------------------------------ HashOnly

    [Fact]
    public async Task HashOnly_refuses_an_account_without_a_hash()
    {
        Mode(PasswordMode.HashOnly);
        var client = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.BadRequest, (await MsmeLogin(client, "Right#Pass1")).StatusCode);
        Assert.Equal(PasswordStore.RefusedValue, ProcedurePassword());
        Assert.Empty(_passwords.Writes);
    }

    [Fact]
    public async Task HashOnly_signs_in_with_the_hash_and_refuses_the_replacement_value()
    {
        Mode(PasswordMode.HashOnly);
        var replacement = PasswordStore.NewReplacement();
        _passwords.Accounts[Msme] = new FakePasswords.Account("5", replacement, PasswordStore.Hash("Right#Pass1"));
        var client = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.BadRequest, (await MsmeLogin(client, replacement)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await MsmeLogin(client, "Right#Pass1")).StatusCode);
        Assert.Empty(_passwords.Writes);
    }

    [Fact]
    public async Task HashOnly_staff_login_uses_the_hash()
    {
        Mode(PasswordMode.HashOnly);
        _passwords.Accounts[Admin] = new FakePasswords.Account("1", PasswordStore.NewReplacement(), PasswordStore.Hash("Admin#Pass9"));
        var client = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.BadRequest,
            (await client.PostAsJsonAsync("/api/staff/auth/login", new { userId = Admin, password = "Right#Pass1" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK,
            (await client.PostAsJsonAsync("/api/staff/auth/login", new { userId = Admin, password = "Admin#Pass9" })).StatusCode);
    }

    [Fact]
    public async Task Dual_staff_login_records_a_hash()
    {
        var client = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.OK,
            (await client.PostAsJsonAsync("/api/staff/auth/login", new { userId = Admin, password = "Right#Pass1" })).StatusCode);
        Assert.True(_passwords.HashMatches(Admin, "Right#Pass1"));
        Assert.Null(_passwords.LastWrite(Admin)!.Replace);
    }

    // ------------------------------------------------------------------ Change and reset

    private string? PlainWritten() => FakeSql.Arg(_host.Sql.Calls.Last(c => c.Name.StartsWith("UPDATE Users")).Args, "Password");

    [Fact]
    public async Task Dual_change_password_writes_the_plain_value_and_the_hash()
    {
        var client = await _host.CreateBrowserAsync();
        (await MsmeLogin(client, "Right#Pass1")).EnsureSuccessStatusCode();
        var r = await client.PostAsJsonAsync("/api/account/change-password", new { oldPassword = "Right#Pass1", newPassword = "New#Pass22", confirmPassword = "New#Pass22" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("New#Pass22", PlainWritten());
        Assert.True(_passwords.HashMatches(Msme, "New#Pass22"));
    }

    [Fact]
    public async Task HashOnly_change_password_checks_the_hash_and_stores_a_random_value()
    {
        Mode(PasswordMode.HashOnly);
        _passwords.Accounts[Msme] = new FakePasswords.Account("5", PasswordStore.NewReplacement(), PasswordStore.Hash("Right#Pass1"));
        var client = await _host.CreateBrowserAsync();
        (await MsmeLogin(client, "Right#Pass1")).EnsureSuccessStatusCode();

        var wrong = await client.PostAsJsonAsync("/api/account/change-password", new { oldPassword = "Wrong#Pass1", newPassword = "New#Pass22", confirmPassword = "New#Pass22" });
        Assert.Equal("Invalid Old Password.", await wrong.ProblemTitle());

        var r = await client.PostAsJsonAsync("/api/account/change-password", new { oldPassword = "Right#Pass1", newPassword = "New#Pass22", confirmPassword = "New#Pass22" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.True(PasswordStore.IsReplacement(PlainWritten()));
        Assert.True(_passwords.HashMatches(Msme, "New#Pass22"));
        Assert.False(_passwords.HashMatches(Msme, "Right#Pass1"));
    }

    [Fact]
    public async Task Dual_reset_password_writes_the_plain_value_and_the_hash()
    {
        var client = await _host.CreateBrowserAsync();
        var r = await client.PostAsJsonAsync("/api/msme/auth/reset-password", new { token = _resets.Issue(Msme), newPassword = "New#Pass22", confirmPassword = "New#Pass22" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("New#Pass22", PlainWritten());
        Assert.True(_passwords.HashMatches(Msme, "New#Pass22"));
    }

    [Fact]
    public async Task HashOnly_reset_lets_an_account_without_a_hash_back_in()
    {
        Mode(PasswordMode.HashOnly);
        var client = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.BadRequest, (await MsmeLogin(client, "Right#Pass1")).StatusCode);

        var r = await client.PostAsJsonAsync("/api/msme/auth/reset-password", new { token = _resets.Issue(Msme), newPassword = "New#Pass22", confirmPassword = "New#Pass22" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var stored = PlainWritten();
        Assert.True(PasswordStore.IsReplacement(stored));
        _passwords.Accounts[Msme] = _passwords.Accounts[Msme] with { Stored = stored }; // the fake UPDATE does not write the table
        Assert.Equal(HttpStatusCode.OK, (await MsmeLogin(client, "New#Pass22")).StatusCode);
    }
}
