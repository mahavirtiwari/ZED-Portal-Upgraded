using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Zed.Core.Security;
using Zed.Main.Api.Tests.Staff;

namespace Zed.Main.Api.Tests;

/// <summary>
/// M12: sessions end on the server when the user's access changes (Users.SessionStamp, migration 0040), and H11: main's
/// logout also expires the other two portals' cookies in the browser.
/// </summary>
public sealed class SessionStampTests : IDisposable
{
    private readonly TestHost _host = new();

    /// <summary>Users.SessionStamp of the fake main database, by UserId (missing = NULL).</summary>
    private readonly ConcurrentDictionary<string, string> _stamps = new(StringComparer.OrdinalIgnoreCase);

    public SessionStampTests()
    {
        UsersMastersLogin.Setup(_host);
        _host.Sql.Queries[SessionStamps.SelectSql] = args => _stamps.TryGetValue(FakeSql.Arg(args, "UserId") ?? "", out var s) ? [s] : [];
    }

    public void Dispose() => _host.Dispose();

    /// <summary>Every request reads the stamp (no minute of cache), so a change shows at once.</summary>
    private void NoCache() => _host.Services.GetRequiredService<IConfiguration>()[SessionStampValidator.CacheSetting] = "0";

    private int StampReads(string userId) => _host.Sql.Calls.Count(c => c.Name == SessionStamps.SelectSql && FakeSql.Arg(c.Args, "UserId") == userId);

    private bool Bumped(string sql, string userId) => _host.Sql.Calls.Any(c => c.Name == sql && FakeSql.Arg(c.Args, "UserId") == userId);

    [Fact]
    public async Task A_new_stamp_ends_the_session_with_401_and_a_new_sign_in_works()
    {
        NoCache();
        _stamps["ADMIN1"] = "11111111-1111-1111-1111-111111111111";
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync("/api/staff/accounts")).StatusCode);

        // Blocked, new password, other role…: another browser's session of the same user ends too.
        _stamps["ADMIN1"] = "22222222-2222-2222-2222-222222222222";
        Assert.Equal(HttpStatusCode.Unauthorized, (await admin.GetAsync("/api/staff/accounts")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await admin.GetAsync("/api/auth/me")).StatusCode);

        var again = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        Assert.Equal(HttpStatusCode.OK, (await again.GetAsync("/api/staff/accounts")).StatusCode);
    }

    [Fact]
    public async Task Before_any_change_the_stamp_is_null_and_sessions_stay_valid()
    {
        NoCache();
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync("/api/staff/accounts")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync("/api/staff/accounts")).StatusCode);
        Assert.True(StampReads("ADMIN1") >= 3); // sign-in and each request
    }

    [Fact]
    public async Task The_stamp_is_read_once_a_minute_per_user_not_on_every_request()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        for (var i = 0; i < 3; i++) Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync("/api/staff/accounts")).StatusCode);
        Assert.Equal(1, StampReads("ADMIN1")); // at sign-in; the requests use the cached value
    }

    [Fact]
    public void Statements_check_for_the_column_and_change_every_row_of_the_user_at_once()
    {
        // Before migration 0040 the column is missing: reads give "" and bumps do nothing, without an error.
        Assert.Contains("COL_LENGTH('dbo.Users', 'SessionStamp') IS NOT NULL", SessionStamps.SelectSql);
        Assert.Contains("COL_LENGTH('dbo.Users', 'SessionStamp') IS NOT NULL", SessionStamps.BumpSql);
        // One value for all rows of a UserId (it can appear more than once in Users).
        Assert.StartsWith("DECLARE @Stamp uniqueidentifier = NEWID();", SessionStamps.BumpSql);
        Assert.Contains("SET SessionStamp = @Stamp WHERE UserId = @UserId", SessionStamps.BumpSql);
        Assert.Contains("ZED_SURVEILLANCE.sys.sp_executesql", SessionStamps.BumpSurveillanceCopySql);
    }

    [Fact]
    public async Task Blocking_unblocking_editing_and_resetting_a_login_end_its_sessions_here_and_on_surveillance()
    {
        _host.Sql.Queries["SELECT TOP (1) UserId, UserName, RoleId"] = args => FakeSql.Arg(args, "UserId") == "DFO9"
            ? [new { UserId = "DFO9", UserName = "DFO", RoleId = 6, Email = "dfo@zed.test", MobileNo = "9999999999", StateCode = "9", IsActive = (bool?)true, CreatedBy = "ADMIN1", CreatedDate = (DateTime?)null }]
            : [];
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        foreach (var call in new Func<Task<HttpResponseMessage>>[]
        {
            () => admin.PostAsync("/api/staff/accounts/DFO9/block", null),
            () => admin.PostAsync("/api/staff/accounts/DFO9/unblock", null),
            () => admin.PutAsJsonAsync("/api/staff/accounts/DFO9", new { userName = "DFO Kanpur", email = "dfo@zed.test", mobileNo = "9876543210", stateCode = "9" }),
            () => admin.PostAsync("/api/staff/accounts/DFO9/reset-password", null),
        })
        {
            int Bumps() => _host.Sql.Calls.Count(c => c.Name == SessionStamps.BumpSql && FakeSql.Arg(c.Args, "UserId") == "DFO9");
            var before = Bumps();
            (await call()).EnsureSuccessStatusCode();
            Assert.Equal(before + 1, Bumps());
        }
        Assert.True(Bumped(SessionStamps.BumpSurveillanceCopySql, "DFO9"));
    }

    [Fact]
    public async Task Changing_an_agencys_verification_types_ends_its_sessions_and_those_of_its_assessors()
    {
        _host.Sql.Procs["SP_GET_USER_DETAILS_BY_USER_ID"] = _ => FakeSql.Sets(
            [new Dictionary<string, object?>
            {
                ["UserId"] = "ZEDAA0001", ["UserName"] = "Acme", ["RoleId"] = 2, ["CreatedBy"] = "MASTER1", ["IsActive"] = true, ["Email"] = "a@acme.test",
                ["MobileNo"] = "9876543210", ["SpocName"] = "Spoc", ["Address"] = "Addr", ["Pincode"] = "110001", ["OrgPartnerId"] = "",
            }],
            [new { States = "DELHI" }], [new { States = "24" }], []);
        _host.Sql.Procs["SP_MASTER_GET_SECTORS"] = _ => FakeSql.Sets([new { SectorCode = "24", SectorName = "Basic metals" }], [], []);
        var master = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        var r = await master.PutAsJsonAsync("/api/staff/users/agencies/ZEDAA0001", new
        {
            userName = "Acme", spocName = "Spoc", emailId = "a@acme.test", mobileNo = "9876543210", address = "Addr", pinCode = "110001",
            states = new[] { "DELHI" }, nicSectors = new[] { "24" }, desktopVerification = true, siteVerification = true, financialVerification = false,
            sectorActivity = "Both",
        });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.True(Bumped(SessionStamps.BumpSql, "ZEDAA0001"));
        Assert.True(Bumped(SessionStamps.BumpAssessorsSql, "ZEDAA0001"));
        Assert.True(Bumped(SessionStamps.BumpSurveillanceAssessorsSql, "ZEDAA0001"));
    }

    [Fact]
    public async Task A_password_change_ends_the_other_sessions_of_the_account()
    {
        NoCache();
        _host.Sql.Procs["SP_GET_USER_DETAILS_BY_USER_ID"] = _ => FakeSql.Sets([new { UserId = "ADMIN1", UserName = "Admin", Password = "Right#Pass1", Email = "admin1@zed.test" }]);
        var other = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var r = await admin.PostAsJsonAsync("/api/account/change-password", new { oldPassword = "Right#Pass1", newPassword = "New#Pass456", confirmPassword = "New#Pass456" });
        r.EnsureSuccessStatusCode();
        Assert.True(Bumped(SessionStamps.BumpSql, "ADMIN1"));

        _stamps["ADMIN1"] = "33333333-3333-3333-3333-333333333333"; // what the bump wrote
        Assert.Equal(HttpStatusCode.Unauthorized, (await other.GetAsync("/api/staff/accounts")).StatusCode);
    }

    [Fact]
    public async Task An_account_locked_by_wrong_passwords_loses_its_sessions()
    {
        _host.Sql.Procs["SP_GET_USER_DETAILS"] = _ => FakeSql.Sets([], [new { ERRORMSG = "ACCOUNT LOCKED. PLEASE LOGIN AFTER 15 MINUTES." }]);
        var client = await _host.CreateBrowserAsync();
        var r = await client.PostAsJsonAsync("/api/staff/auth/login", new { userId = "ZEDAA0001", password = "Wrong#Pass1" });
        Assert.Equal("ACCOUNT LOCKED. PLEASE LOGIN AFTER 15 MINUTES.", await r.ProblemTitle());
        Assert.True(Bumped(SessionStamps.BumpSql, "ZEDAA0001"));

        _host.Sql.Procs["SP_GET_USER_DETAILS"] = _ => FakeSql.Sets([], [new { ERRORMSG = "INVALID CREDENTIAILS" }]);
        await client.PostAsJsonAsync("/api/staff/auth/login", new { userId = "ZEDAA0002", password = "Wrong#Pass1" });
        Assert.False(Bumped(SessionStamps.BumpSql, "ZEDAA0002"));
    }

    // ---- H11: main's logout ------------------------------------------------------------------------

    [Fact]
    public async Task Main_logout_expires_the_consultancy_and_surveillance_cookies_but_not_the_stamp()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var r = await admin.PostAsync("/api/auth/logout", null);
        Assert.Equal(HttpStatusCode.NoContent, r.StatusCode);
        var cookies = r.Headers.GetValues("Set-Cookie").ToList();

        bool Expired(string name, string path) => cookies.Any(c =>
            c.StartsWith(name + "=;", StringComparison.Ordinal)
            && (c.Contains("path=" + path + ";", StringComparison.Ordinal) || c.EndsWith("path=" + path, StringComparison.Ordinal))
            && c.Contains("expires=Thu, 01 Jan 1970 00:00:00 GMT", StringComparison.OrdinalIgnoreCase));
        Assert.True(Expired("zed.consultancy", "/Consultancy"));
        Assert.True(Expired("zed.consultancy", "/consultancy"));
        Assert.True(Expired("zed.surveillance", "/surveillance"));
        Assert.True(Expired("zed.consultancy.AF", "/Consultancy"));
        Assert.True(Expired("XSRF-TOKEN", "/surveillance"));
        // Main's own sign-in ends as before, and its new XSRF token at "/" is not expired.
        Assert.Contains(cookies, c => c.StartsWith("zed.main=;", StringComparison.Ordinal));
        Assert.Contains(cookies, c => c.StartsWith("XSRF-TOKEN=", StringComparison.Ordinal) && !c.StartsWith("XSRF-TOKEN=;", StringComparison.Ordinal));
        Assert.DoesNotContain(cookies, c => c.StartsWith("XSRF-TOKEN=;", StringComparison.Ordinal) && c.Contains("path=/;", StringComparison.Ordinal));
        // Logging out does not end the user's sessions on other devices.
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == SessionStamps.BumpSql);
    }

    [Fact]
    public async Task Logout_without_a_session_also_expires_the_other_portals_cookies()
    {
        var client = await _host.CreateBrowserAsync();
        var r = await client.PostAsync("/api/auth/logout", null);
        Assert.Equal(HttpStatusCode.NoContent, r.StatusCode);
        Assert.Contains(r.Headers.GetValues("Set-Cookie"), c => c.StartsWith("zed.surveillance=;", StringComparison.Ordinal));
    }
}
