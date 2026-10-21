using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Zed.Core.Email;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.PasswordReset;
using Zed.TestSupport;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>Staff "Forgot password?" and administrator-sent reset links (migration 0008, docs/PASSWORDS.md).</summary>
public sealed partial class StaffPasswordResetTests : IDisposable
{
    private const string Agency = "ZEDAA0001";
    private const string NewPassword = "New#Pass123";
    private readonly TestHost _host = new();
    private readonly FakeStaffResets _resets;
    private readonly FakePasswords _passwords;

    public StaffPasswordResetTests()
    {
        UsersMastersLogin.Setup(_host);
        _resets = new FakeStaffResets().Attach(_host.Sql.Procs);
        _passwords = new FakePasswords().Attach(_host.Sql.Procs);
        _resets.Add(Agency, 2, "spoc@acme.test");
        _resets.Add("ZEDAS0001", 3, "assessor@zed.test");
        _resets.Add("ZEDAS0002", 3, "other@zed.test");
        _resets.Add("NOMAIL1", 2, email: "not an address");
        _resets.Add("BLOCKED1", 3, active: false);
        _resets.Add("MASTER1", 7, "master1@zed.test");
        _resets.Add("MASTER2", 7, "master2@zed.test");
        _resets.Add("ZEDMSME000001", 5, "unit@zed.test");
        _passwords.Add(Agency, "2", "Old#Pass123");
        // Who created which assessor (Users.CreatedBy), for the agencies' own-assessor check.
        _host.Sql.Procs["SP_GET_USER_DETAILS_BY_USER_ID"] = args => (UsersMastersLogin.Arg(args, "UserId") ?? "").ToUpperInvariant() switch
        {
            "ZEDAA0001" => FakeSql.Sets([new { UserId = Agency, UserName = "Acme", RoleId = 2, IsActive = true, Email = "spoc@acme.test", CreatedBy = "MASTER1" }], [], [], []),
            "ZEDAS0001" => FakeSql.Sets([new { UserId = "ZEDAS0001", UserName = "A1", RoleId = 3, IsActive = true, Email = "assessor@zed.test", CreatedBy = "AGENCY1" }], [], [], []),
            "ZEDAS0002" => FakeSql.Sets([new { UserId = "ZEDAS0002", UserName = "A2", RoleId = 3, IsActive = true, Email = "other@zed.test", CreatedBy = "AGENCY2" }], [], [], []),
            _ => FakeSql.Sets([], [], [], []),
        };
    }

    public void Dispose() => _host.Dispose();

    private void Set(string key, string? value) => _host.Services.GetRequiredService<IConfiguration>()[key] = value;

    private async Task<HttpResponseMessage> RequestLink(HttpClient client, string userId) =>
        await client.PostAsJsonAsync("/api/staff/auth/password-reset/request", new { userId });

    /// <summary>Waits for the background request to finish (it records an audit outcome as its last step).</summary>
    private static async Task Eventually(Func<bool> condition)
    {
        for (var i = 0; i < 100 && !condition(); i++) await Task.Delay(50);
        Assert.True(condition(), "condition not met within 5 seconds");
    }

    private EmailMessage[] MailsTo(string to) => _host.Email.Sent.Where(m => m.To == to).ToArray();

    private static string TokenIn(EmailMessage mail) => TokenPattern().Match(mail.HtmlBody).Groups[1].Value;

    private async Task<string> RequestAndGetToken(HttpClient client, string userId, string to)
    {
        var before = MailsTo(to).Length;
        (await RequestLink(client, userId)).EnsureSuccessStatusCode();
        await Eventually(() => MailsTo(to).Length > before);
        return TokenIn(MailsTo(to).Last());
    }

    private Task<HttpResponseMessage> Reset(HttpClient client, string token, string password = NewPassword) =>
        client.PostAsJsonAsync("/api/staff/auth/password-reset/reset", new { token, newPassword = password, confirmPassword = password });

    [Fact]
    public async Task Forgot_password_mails_a_single_use_link_and_sets_the_password()
    {
        var client = await _host.CreateBrowserAsync();
        var token = await RequestAndGetToken(client, Agency, "spoc@acme.test");
        var mail = MailsTo("spoc@acme.test").Single();
        Assert.Equal("ZED Password Reset - " + Agency, mail.Subject);
        var publicBaseUrl = _host.Services.GetRequiredService<Microsoft.Extensions.Options.IOptions<Zed.Core.Http.PortalOptions>>().Value.PublicBaseUrl.TrimEnd('/');
        Assert.Contains(publicBaseUrl + "/reset-password#token=" + token, mail.HtmlBody);
        Assert.Contains("30 minutes", mail.HtmlBody);
        Assert.DoesNotContain("administrator (", mail.HtmlBody);

        // Only the SHA-256 of the token is stored.
        var row = Assert.Single(_resets.Rows);
        Assert.Equal(StaffPasswordResets.HashToken(token), row.TokenHash);
        Assert.Null(row.RequestedBy);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Args?.ToString()?.Contains(token) == true);

        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/staff/auth/password-reset/check", new { token })).StatusCode);
        var weak = await Reset(client, token, "weak");
        Assert.Equal(HttpStatusCode.BadRequest, weak.StatusCode);

        var r = await Reset(client, token);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        // Dual: plain column (the old sites read it) and the hash.
        var update = _host.Sql.Calls.Last(c => c.Name.StartsWith("UPDATE Users SET Password", StringComparison.Ordinal));
        Assert.Equal(NewPassword, FakeSql.Arg(update.Args, "Password"));
        Assert.True(_passwords.HashMatches(Agency, NewPassword));
        Assert.Contains(Agency, _resets.FailedLoginsCleared);
        Assert.Contains(MailsTo("spoc@acme.test"), m => m.Subject.StartsWith("New Login Details", StringComparison.Ordinal));

        // Used: neither check nor reset accept it again.
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/staff/auth/password-reset/check", new { token })).StatusCode);
        var again = await Reset(client, token, "Other#Pass456");
        Assert.Equal(StaffPasswordResets.InvalidLink, await again.ProblemTitle());
    }

    [Fact]
    public async Task The_answer_is_the_same_for_every_account_and_comes_before_the_lookup()
    {
        var client = await _host.CreateBrowserAsync();
        // The account lookup is held until all answers are in: if it ran on the request path, each answer would wait 10 s.
        _resets.HoldAccountLookup = new SemaphoreSlim(0);
        var clock = System.Diagnostics.Stopwatch.StartNew();
        string? expected = null;
        foreach (var id in new[] { Agency, "UNKNOWN99", "NOMAIL1", "BLOCKED1", "MASTER1" })
        {
            var r = await RequestLink(client, id);
            Assert.Equal(HttpStatusCode.OK, r.StatusCode);
            var body = await r.Content.ReadAsStringAsync();
            expected ??= body;
            Assert.Equal(expected, body);
        }
        Assert.True(clock.Elapsed < TimeSpan.FromSeconds(5), $"answers took {clock.Elapsed}");
        _resets.HoldAccountLookup.Release(100);

        Assert.Equal(StaffPasswordResetController.RequestAnswer, JsonDocument.Parse(expected!).RootElement.GetProperty("message").GetString());
        await Eventually(() => _host.Email.Sent.Count == 1);
        await Task.Delay(300);
        Assert.Equal("spoc@acme.test", Assert.Single(_host.Email.Sent).To);   // nothing for unknown, no e-mail, blocked or excluded accounts
        Assert.All(_resets.Rows, r => Assert.Equal(Agency, r.UserId));
    }

    [Fact]
    public async Task A_newer_link_replaces_the_older_and_links_expire()
    {
        var client = await _host.CreateBrowserAsync();
        var first = await RequestAndGetToken(client, Agency, "spoc@acme.test");
        var second = await RequestAndGetToken(client, Agency, "spoc@acme.test");
        Assert.NotEqual(first, second);
        Assert.Equal(HttpStatusCode.OK, (await RequestLink(client, "ZEDMSME000001")).StatusCode);   // MSMEs use their own reset
        Assert.Equal(StaffPasswordResets.InvalidLink, await (await Reset(client, first)).ProblemTitle());

        _resets.ExpireAll();
        Assert.Equal(StaffPasswordResets.InvalidLink, await (await Reset(client, second)).ProblemTitle());
        Assert.Empty(_resets.FailedLoginsCleared);
        Assert.Equal(StaffPasswordResets.InvalidLink, await (await Reset(client, "not-a-token")).ProblemTitle());
        Assert.Empty(MailsTo("unit@zed.test"));
    }

    [Fact]
    public async Task Requests_are_limited_per_account_and_per_address()
    {
        var client = await _host.CreateBrowserAsync();
        for (var i = 0; i < 4; i++) Assert.Equal(HttpStatusCode.OK, (await RequestLink(client, Agency)).StatusCode);
        await Eventually(() => MailsTo("spoc@acme.test").Length == 3);
        await Task.Delay(300);
        Assert.Equal(3, MailsTo("spoc@acme.test").Length);   // the 4th within the hour sends nothing (same answer)

        Assert.Equal(HttpStatusCode.OK, (await RequestLink(client, "ZEDAS0001")).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await RequestLink(client, "ZEDAS0001")).StatusCode);  // 6th from this address in 15 minutes
    }

    [Theory]
    [InlineData(PasswordMode.Migrate)]
    [InlineData(PasswordMode.HashOnly)]
    public async Task After_the_old_sites_only_the_hash_is_written(PasswordMode mode)
    {
        FakePasswords.SetMode(_host.Services, mode);
        var client = await _host.CreateBrowserAsync();
        var token = await RequestAndGetToken(client, Agency, "spoc@acme.test");
        Assert.Equal(HttpStatusCode.OK, (await Reset(client, token)).StatusCode);

        var update = _host.Sql.Calls.Last(c => c.Name.StartsWith("UPDATE Users SET Password", StringComparison.Ordinal));
        Assert.True(PasswordStore.IsReplacement(FakeSql.Arg(update.Args, "Password")));
        Assert.True(_passwords.HashMatches(Agency, NewPassword));
        Assert.False(_passwords.HashMatches(Agency, "Old#Pass123"));
    }

    [Fact]
    public async Task MasterAdmins_cannot_reset_by_mail_alone_but_another_MasterAdmin_can_send_them_a_link()
    {
        var anonymous = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.OK, (await RequestLink(anonymous, "MASTER2")).StatusCode);
        await Task.Delay(500);
        Assert.Empty(MailsTo("master2@zed.test"));

        var master = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        var r = await master.PostAsync("/api/staff/password-reset/MASTER2", null);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Contains("m******@zed.test", (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("message").GetString());
        var mail = Assert.Single(MailsTo("master2@zed.test"));
        Assert.Contains("A ZED administrator (MASTER1)", mail.HtmlBody);
        Assert.Equal("MASTER1", _resets.Rows.Single().RequestedBy);
        Assert.Equal(HttpStatusCode.OK, (await Reset(anonymous, TokenIn(mail))).StatusCode);

        Assert.Equal("Please use Change Password for your own account.", await (await master.PostAsync("/api/staff/password-reset/MASTER1", null)).ProblemTitle());
        Assert.Equal("This user is blocked. Unblock the account first.", await (await master.PostAsync("/api/staff/password-reset/BLOCKED1", null)).ProblemTitle());
        Assert.Equal(HttpStatusCode.NotFound, (await master.PostAsync("/api/staff/password-reset/ZEDMSME000001", null)).StatusCode);

        var agency = await UsersMastersLogin.SignInAsync(_host, "AGENCY1");
        Assert.Equal(HttpStatusCode.Forbidden, (await agency.PostAsync("/api/staff/password-reset/MASTER2", null)).StatusCode);

        // Excluding no roles lets a MasterAdmin use "Forgot password?" too.
        Set("StaffPasswordReset:ExcludedRoles", "");
        await RequestAndGetToken(anonymous, "MASTER2", "master2@zed.test");
    }

    [Fact]
    public async Task The_user_screens_send_links_to_the_users_each_role_manages()
    {
        var master = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        Assert.Equal(HttpStatusCode.OK, (await master.PostAsync($"/api/staff/users/agencies/{Agency}/password-reset", null)).StatusCode);
        Assert.Single(MailsTo("spoc@acme.test"));

        var agency = await UsersMastersLogin.SignInAsync(_host, "AGENCY1");
        Assert.Equal(HttpStatusCode.OK, (await agency.PostAsync("/api/staff/users/assessors/ZEDAS0001/password-reset", null)).StatusCode);
        Assert.Single(MailsTo("assessor@zed.test"));
        Assert.Equal(HttpStatusCode.NotFound, (await agency.PostAsync("/api/staff/users/assessors/ZEDAS0002/password-reset", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await agency.PostAsync($"/api/staff/users/agencies/{Agency}/password-reset", null)).StatusCode);
        Assert.Empty(MailsTo("other@zed.test"));

        Assert.Equal(HttpStatusCode.OK, (await master.PostAsync("/api/staff/users/assessors/ZEDAS0002/password-reset", null)).StatusCode);
        Assert.Equal("AGENCY1", _resets.Rows.Single(r => r.UserId == "ZEDAS0001").RequestedBy);
    }

    [Fact]
    public async Task Switched_off_refuses_both_ways()
    {
        Set("StaffPasswordReset:Enabled", "false");
        var anonymous = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.BadRequest, (await RequestLink(anonymous, Agency)).StatusCode);
        var master = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        Assert.Equal("Password reset is switched off on this portal.", await (await master.PostAsync($"/api/staff/password-reset/{Agency}", null)).ProblemTitle());
        Assert.Empty(_resets.Rows);
    }

    [Fact]
    public async Task The_link_validity_is_configurable()
    {
        Set("StaffPasswordReset:ValidMinutes", "10");
        var client = await _host.CreateBrowserAsync();
        await RequestAndGetToken(client, Agency, "spoc@acme.test");
        var row = Assert.Single(_resets.Rows);
        Assert.InRange((row.ExpiresAt - row.CreatedAt).TotalMinutes, 9.9, 10.1);
        Assert.Contains("10 minutes", MailsTo("spoc@acme.test").Single().HtmlBody);
    }

    [GeneratedRegex("reset-password#token=([A-Za-z0-9_-]{43})")] private static partial Regex TokenPattern();
}
