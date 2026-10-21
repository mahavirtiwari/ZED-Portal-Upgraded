using System.Net;
using System.Net.Http.Json;
using Zed.Core.Http;

namespace Zed.Main.Api.Tests;

public sealed class MsmeAuthTests : IDisposable
{
    private readonly TestHost _host = new();

    public MsmeAuthTests()
    {
        _host.Sql.Procs["SP_GET_USER_DETAILS"] = args => FakeSql.Arg(args, "Password") == "Right#Pass1"
            ? FakeSql.Sets([new { UserId = "ZEDMSME000001", UserName = "Acme Castings", RoleId = 5, Email = "a@acme.test", MobileNo = "9999999999", StateCode = "9", DistrictCode = "160" }], [new { ERRORMSG = "SUCCESS" }])
            : FakeSql.Sets([], [new { ERRORMSG = "INVALID CREDENTIAILS" }]);
    }

    public void Dispose() => _host.Dispose();

    [Fact]
    public async Task Login_with_valid_credentials_signs_in_and_records_login()
    {
        var client = await _host.CreateBrowserAsync();

        var login = await client.PostAsJsonAsync("/api/msme/auth/login", new { userId = "ZEDMSME000001", password = "Right#Pass1" });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);

        var me = await client.GetFromJsonAsync<CurrentUserResponse>("/api/auth/me");
        Assert.Equal("ZEDMSME000001", me!.UserId);
        Assert.Equal("Msme", me.Role);
        Assert.Contains(_host.Sql.Calls, c => c.Name == "SP_UPDATE_LOGIN");
    }

    [Fact]
    public async Task Login_failure_returns_the_procedure_message()
    {
        var client = await _host.CreateBrowserAsync();
        var login = await client.PostAsJsonAsync("/api/msme/auth/login", new { userId = "ZEDMSME000001", password = "wrong" });
        Assert.Equal(HttpStatusCode.BadRequest, login.StatusCode);
        Assert.Equal("INVALID CREDENTIAILS", await login.ProblemTitle());
    }

    [Fact]
    public async Task A_master_password_the_procedure_accepts_is_refused()
    {
        // The legacy procedures accept hard-coded master passwords for any account; the row they return then
        // carries the account's real password, which differs from the one typed.
        _host.Sql.Procs["SP_GET_USER_DETAILS"] = _ => FakeSql.Sets(
            [new { UserId = "ZEDMSME000001", UserName = "Acme", RoleId = 5, Password = "Right#Pass1" }], [new { ERRORMSG = "SUCCESS" }]);
        var client = await _host.CreateBrowserAsync();
        var login = await client.PostAsJsonAsync("/api/msme/auth/login", new { userId = "ZEDMSME000001", password = "Any#Master1" });
        Assert.Equal(HttpStatusCode.BadRequest, login.StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_UPDATE_LOGIN");
    }

    [Fact]
    public async Task State_changing_requests_without_the_xsrf_header_are_rejected()
    {
        var bare = _host.CreateClient();
        var login = await bare.PostAsJsonAsync("/api/msme/auth/login", new { userId = "ZEDMSME000001", password = "Right#Pass1" });
        Assert.Equal(HttpStatusCode.BadRequest, login.StatusCode);
        Assert.StartsWith("Your session token has expired", await login.ProblemTitle());
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_GET_USER_DETAILS");
    }

    [Fact]
    public async Task Me_is_empty_when_signed_out_and_after_logout()
    {
        var client = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.NoContent, (await client.GetAsync("/api/auth/me")).StatusCode);

        await client.PostAsJsonAsync("/api/msme/auth/login", new { userId = "ZEDMSME000001", password = "Right#Pass1" });
        (await client.GetAsync("/api/auth/me")).EnsureSuccessStatusCode(); // refresh XSRF token for the signed-in user
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync("/api/auth/logout", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.GetAsync("/api/auth/me")).StatusCode);
    }

    private const string Unit = "ZEDMSME000001";

    private Zed.TestSupport.FakeStaffResets Resets()
    {
        var resets = new Zed.TestSupport.FakeStaffResets().Attach(_host.Sql.Procs);
        resets.Users[Unit] = new Zed.TestSupport.FakeStaffResets.User(Unit, 5, true, "pledge@acme.test", "Acme Castings");
        resets.Users["ZEDMSME000002"] = new Zed.TestSupport.FakeStaffResets.User("ZEDMSME000002", 5, false, "off@acme.test", "Inactive Unit");
        resets.Users["ZEDMSME000003"] = new Zed.TestSupport.FakeStaffResets.User("ZEDMSME000003", 5, true, null, "No Mail Unit");
        resets.Users["ZEDAA0001"] = new Zed.TestSupport.FakeStaffResets.User("ZEDAA0001", 2, true, "agency@zed.test", "Agency");
        return resets;
    }

    private static async Task Eventually(Func<bool> condition)
    {
        for (var i = 0; i < 100 && !condition(); i++) await Task.Delay(50);
        Assert.True(condition(), "condition not met within 5 seconds");
    }

    private static string TokenIn(Zed.Core.Email.EmailMessage mail) =>
        System.Text.RegularExpressions.Regex.Match(mail.HtmlBody, "/msme/reset-password#token=([A-Za-z0-9_-]{43})").Groups[1].Value;

    private static Task<HttpResponseMessage> Reset(HttpClient client, string? token, string password = "New#Pass123") =>
        client.PostAsJsonAsync("/api/msme/auth/reset-password", new { token, newPassword = password, confirmPassword = password });

    [Fact]
    public async Task Forgot_password_mails_a_hashed_single_use_link_and_the_reset_sets_the_password()
    {
        var resets = Resets();
        var client = await _host.CreateBrowserAsync();
        var r = await client.PostAsJsonAsync("/api/msme/auth/forgot-password", new { userId = Unit });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        await Eventually(() => _host.Email.Sent.Count == 1);

        var mail = Assert.Single(_host.Email.Sent);
        Assert.Equal("pledge@acme.test", mail.To);
        Assert.Equal("MSME Reset Password Details - " + Unit, mail.Subject);
        Assert.Contains("60 minutes", mail.HtmlBody);
        var token = TokenIn(mail);
        var row = Assert.Single(resets.Rows);
        Assert.Equal(Zed.Core.Security.PasswordResetTokens.Hash(token), row.TokenHash);
        Assert.Null(row.RequestedBy);
        // The legacy clear-text codes are neither written nor read; the token is never sent to the database.
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.StartsWith("SP_MSME_PWD", StringComparison.Ordinal));
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Args?.ToString()?.Contains(token) == true);

        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/msme/auth/reset-password/check", new { token })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Reset(client, token, "short")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Reset(client, token)).StatusCode);

        var update = _host.Sql.Calls.Last(c => c.Name.StartsWith("UPDATE Users SET Password", StringComparison.Ordinal));
        Assert.Equal("New#Pass123", FakeSql.Arg(update.Args, "Password"));
        Assert.Contains(Unit, resets.FailedLoginsCleared);
        var changed = _host.Email.Sent.Last();
        Assert.StartsWith("New Login Details", changed.Subject);
        Assert.DoesNotContain("New#Pass123", changed.HtmlBody);

        // Used once only.
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/msme/auth/reset-password/check", new { token })).StatusCode);
        var again = await Reset(client, token, "Other#Pass456");
        Assert.Equal(Zed.Core.Security.PasswordResetTokens.InvalidLink, await again.ProblemTitle());
    }

    [Fact]
    public async Task Forgot_password_answers_the_same_for_every_zed_id_before_the_lookup()
    {
        var resets = Resets();
        resets.HoldAccountLookup = new SemaphoreSlim(0);
        var client = await _host.CreateBrowserAsync();
        var clock = System.Diagnostics.Stopwatch.StartNew();
        string? expected = null;
        foreach (var id in new[] { Unit, "NOPE", "ZEDMSME000002", "ZEDMSME000003", "ZEDAA0001" })
        {
            var r = await client.PostAsJsonAsync("/api/msme/auth/forgot-password", new { userId = id });
            Assert.Equal(HttpStatusCode.OK, r.StatusCode);
            var body = await r.Content.ReadAsStringAsync();
            expected ??= body;
            Assert.Equal(expected, body);
        }
        Assert.True(clock.Elapsed < TimeSpan.FromSeconds(5), "the answers waited for the account lookup");
        resets.HoldAccountLookup.Release(10);

        // Only the active MSME with an e-mail address gets a link; the inactive, mail-less, unknown and staff ids get nothing.
        await Eventually(() => _host.Sql.Calls.Count(c => c.Name == "SP_V4_MSME_RESET_ACCOUNT") == 5);
        await Eventually(() => _host.Email.Sent.Count == 1);
        await Task.Delay(200);
        Assert.Equal("pledge@acme.test", Assert.Single(_host.Email.Sent).To);
        Assert.Equal(Unit, Assert.Single(resets.Rows).UserId);
    }

    [Fact]
    public async Task Old_codes_expired_replaced_and_staff_links_are_refused()
    {
        var resets = Resets();
        var client = await _host.CreateBrowserAsync();

        // A legacy ?code= link (no V4 token), a missing one and a staff account's link do not work here.
        Assert.Equal(HttpStatusCode.BadRequest, (await Reset(client, "0b6a2c3e-legacy-guid-code")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Reset(client, null)).StatusCode);
        var staff = resets.Issue("ZEDAA0001");
        Assert.Equal(HttpStatusCode.BadRequest, (await Reset(client, staff)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/msme/auth/reset-password/check", new { token = staff })).StatusCode);
        // ... and an MSME link does not work on the staff reset.
        var msme = resets.Issue(Unit);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await client.PostAsJsonAsync("/api/staff/auth/password-reset/reset", new { token = msme, newPassword = "New#Pass123", confirmPassword = "New#Pass123" })).StatusCode);

        // A newer link replaces the older one.
        await client.PostAsJsonAsync("/api/msme/auth/forgot-password", new { userId = Unit });
        await Eventually(() => _host.Email.Sent.Count == 1);
        var newer = TokenIn(_host.Email.Sent.Single());
        Assert.Equal(HttpStatusCode.BadRequest, (await Reset(client, msme)).StatusCode);

        // An expired link is refused.
        resets.ExpireAll();
        Assert.Equal(HttpStatusCode.BadRequest, (await Reset(client, newer)).StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.StartsWith("UPDATE Users SET Password", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Forgot_password_is_limited_to_three_links_an_hour_per_zed_id()
    {
        var resets = Resets();
        var client = await _host.CreateBrowserAsync();
        for (var i = 0; i < 4; i++)
            Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/msme/auth/forgot-password", new { userId = Unit })).StatusCode);
        await Eventually(() => _host.Sql.Calls.Count(c => c.Name == "SP_V4_STAFF_RESET_CREATE") == 4);
        await Task.Delay(200);
        Assert.Equal(3, _host.Email.Sent.Count);
        Assert.Equal(3, resets.Rows.Count);
    }
}
