using System.Net;
using System.Net.Http.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc.Testing;
using Zed.Core.Security;
using Zed.Main.Api.Tests;
using Zed.Portal.Features.Staff.PasswordReset;
using Zed.TestSupport;

namespace Zed.Surveillance.Api.Tests;

/// <summary>
/// Staff password reset on the surveillance portal. Accounts copied from main (#111) reset here while the old sites are
/// live (Dual: their copy is their password here); once main's hash is their password, they are pointed to main.
/// </summary>
public sealed partial class SurveillancePasswordResetTests : IDisposable
{
    private const string Assessor = "ZEDAS0001";
    private const string To = "a@zed.test";
    private readonly TestHost _host = new();
    private readonly FakeSql _main = new();
    private readonly FakeStaffResets _resets;
    private readonly WebApplicationFactory<Program> _app;

    public SurveillancePasswordResetTests()
    {
        _resets = new FakeStaffResets().Attach(_host.Sql.Procs);
        var own = new FakePasswords().Attach(_host.Sql.Procs);
        var master = new FakePasswords().Attach(_main.Procs);
        _resets.Add(Assessor, 3, To);
        own.Add(Assessor, "3", "Copy#Pass1");
        master.Accounts[Assessor] = new FakePasswords.Account("3", PasswordStore.NewReplacement(), PasswordStore.Hash("Main#Pass2"));
        _host.Sql.Procs["SP_GET_USER_DETAILS_BY_USER_ID"] = args => FakeSql.Arg(args, "UserId") == Assessor
            ? FakeSql.Sets([new { UserId = Assessor, UserName = "Assessor", RoleId = 3, IsActive = true, Email = To, CreatedBy = "ZEDAA0001" }], [], [], [])
            : FakeSql.Sets([], [], [], []);
        _app = ReviewTestHost.With(_host, new ReviewFakeDocuments(), _main);
    }

    public void Dispose()
    {
        _app.Dispose();
        _host.Dispose();
    }

    private static async Task Eventually(Func<bool> condition)
    {
        for (var i = 0; i < 100 && !condition(); i++) await Task.Delay(50);
        Assert.True(condition(), "condition not met within 5 seconds");
    }

    private Task<HttpResponseMessage> RequestLink(HttpClient c) => c.PostAsJsonAsync("/api/staff/auth/password-reset/request", new { userId = Assessor });

    [Fact]
    public async Task While_the_old_sites_are_live_the_surveillance_copy_is_reset_here()
    {
        var client = await ReviewTestHost.SignInAsync(_app, null, UserRole.DesktopAssessor);
        Assert.Equal(HttpStatusCode.OK, (await RequestLink(client)).StatusCode);
        await Eventually(() => _host.Email.Sent.Count == 1);
        var token = TokenPattern().Match(_host.Email.Sent.Single().HtmlBody).Groups[1].Value;
        Assert.Contains("http://localhost:4202/reset-password#token=", _host.Email.Sent.Single().HtmlBody);

        var r = await client.PostAsJsonAsync("/api/staff/auth/password-reset/reset", new { token, newPassword = "New#Pass123", confirmPassword = "New#Pass123" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Empty(_main.Calls);
    }

    [Fact]
    public async Task Once_main_holds_the_password_the_user_is_pointed_to_main_by_mail()
    {
        // A link from before the switch...
        var client = await ReviewTestHost.SignInAsync(_app, null, UserRole.DesktopAssessor);
        Assert.Equal(HttpStatusCode.OK, (await RequestLink(client)).StatusCode);
        await Eventually(() => _host.Email.Sent.Count == 1);
        var oldToken = TokenPattern().Match(_host.Email.Sent.Single().HtmlBody).Groups[1].Value;

        FakePasswords.SetMode(_app.Services, PasswordMode.Migrate);
        var r = await RequestLink(client);
        Assert.Equal(StaffPasswordResetController.RequestAnswer, (await r.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>()).GetProperty("message").GetString());
        await Eventually(() => _host.Email.Sent.Count == 2);
        var hint = _host.Email.Sent.Last();
        Assert.Contains("password of the main ZED portal", hint.HtmlBody);
        Assert.Contains("http://localhost:4202/login", hint.HtmlBody);   // no Portal:PathBase in Development
        Assert.DoesNotContain("reset-password#token=", hint.HtmlBody);
        Assert.Single(_resets.Rows);

        // ...cannot set the surveillance copy any more, and the hint is not repeated within 15 minutes.
        var reset = await client.PostAsJsonAsync("/api/staff/auth/password-reset/reset", new { token = oldToken, newPassword = "New#Pass123", confirmPassword = "New#Pass123" });
        Assert.Equal(StaffPasswordResets.ManagedByMain, await reset.ProblemTitle());
        Assert.Equal(HttpStatusCode.OK, (await RequestLink(client)).StatusCode);
        await Task.Delay(500);
        Assert.Equal(2, _host.Email.Sent.Count);

        var masterAdmin = await ReviewTestHost.SignInAsync(_app, "MASTER1", UserRole.MasterAdmin);
        var admin = await masterAdmin.PostAsync($"/api/staff/surveillance-users/assessors/{Assessor}/password-reset", null);
        Assert.Equal("This account's password is managed on the main ZED portal. Send the link from there.", await admin.ProblemTitle());
    }

    [Fact]
    public async Task A_MasterAdmin_sends_a_link_from_the_surveillance_user_screens()
    {
        var masterAdmin = await ReviewTestHost.SignInAsync(_app, "MASTER1", UserRole.MasterAdmin);
        var r = await masterAdmin.PostAsync($"/api/staff/surveillance-users/assessors/{Assessor}/password-reset", null);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Contains("A ZED administrator (MASTER1)", Assert.Single(_host.Email.Sent).HtmlBody);
        Assert.Equal("MASTER1", Assert.Single(_resets.Rows).RequestedBy);
    }

    [GeneratedRegex("reset-password#token=([A-Za-z0-9_-]{43})")] private static partial Regex TokenPattern();
}
