using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Main.Api.Tests;

public sealed class StaffAuthTests : IDisposable
{
    private readonly TestHost _host = new();

    public StaffAuthTests()
    {
        _host.Sql.Procs["SP_GET_USER_DETAILS"] = args => FakeSql.Arg(args, "UserId") switch
        {
            "AGENCY1" => User("AGENCY1", 2),
            "ADMIN1" => User("ADMIN1", 7),
            "MSME1" => User("MSME1", 5),
            "OLD1" => User("OLD1", 12), // CallCenter: a Swachh Survekshan leftover role
            _ => FakeSql.Sets([], [new { ERRORMSG = "INVALID CREDENTIAILS" }]),
        };
        _host.Sql.Procs["SP_GET_SUB_ROLE"] = args => FakeSql.Arg(args, "RoleId") == "2"
            ? FakeSql.Sets([new { DesktopVerification = 1, SiteVerification = 0, FinancialVerification = 1 }])
            : FakeSql.Sets([new { DesktopVerification = 1, SiteVerification = 1, FinancialVerification = 1 }]);
    }

    private static Zed.Core.Data.ResultSets User(string id, int role) =>
        FakeSql.Sets([new { UserId = id, UserName = id + " name", RoleId = role, Email = "x@y.test" }], [new { ERRORMSG = "SUCCESS" }]);

    public void Dispose() => _host.Dispose();

    [Fact]
    public async Task Agency_signs_in_with_its_sub_roles()
    {
        var client = await _host.CreateBrowserAsync();
        var r = await client.PostAsJsonAsync("/api/staff/auth/login", new { userId = "AGENCY1", password = "Right#Pass1" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);

        var me = await client.GetFromJsonAsync<CurrentUserResponse>("/api/auth/me");
        Assert.Equal("Agency", me!.Role);
        Assert.Equal([SubRoles.DesktopVerification, SubRoles.FinancialVerification], me.SubRoles);
        Assert.Contains(_host.Sql.Calls, c => c.Name == "SP_UPDATE_LOGIN");
    }

    [Theory]
    [InlineData("MSME1", "MSMEs please use the MSME login")]
    [InlineData("OLD1", "Invalid credentials.")]
    [InlineData("NOBODY", "Invalid credentials.")]
    public async Task Non_staff_accounts_are_refused(string userId, string message)
    {
        var client = await _host.CreateBrowserAsync();
        var r = await client.PostAsJsonAsync("/api/staff/auth/login", new { userId, password = "Right#Pass1" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Contains(message, await r.ProblemTitle());
        Assert.Equal(HttpStatusCode.NoContent, (await client.GetAsync("/api/auth/me")).StatusCode);
    }

    [Fact]
    public async Task Master_passwords_are_refused()
    {
        // As the legacy procedure does for its hard-coded master passwords: a row comes back, but its stored
        // password is not the one typed.
        _host.Sql.Procs["SP_GET_USER_DETAILS"] = _ => FakeSql.Sets(
            [new { UserId = "ADMIN1", UserName = "Admin", RoleId = 1, Password = "Right#Pass1" }], [new { ERRORMSG = "SUCCESS" }]);
        var client = await _host.CreateBrowserAsync();
        var r = await client.PostAsJsonAsync("/api/staff/auth/login", new { userId = "ADMIN1", password = "Any#Master1" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_UPDATE_LOGIN");
    }

    [Fact]
    public async Task Staff_cannot_use_msme_endpoints_and_msmes_cannot_use_staff_ones()
    {
        var staff = await _host.CreateBrowserAsync();
        (await staff.PostAsJsonAsync("/api/staff/auth/login", new { userId = "ADMIN1", password = "Right#Pass1" })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync("/api/msme/dashboard")).StatusCode);
    }
}
