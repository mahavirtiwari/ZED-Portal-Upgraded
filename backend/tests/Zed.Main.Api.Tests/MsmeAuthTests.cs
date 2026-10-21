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

    [Fact]
    public async Task Reset_password_updates_the_user_and_clears_the_code()
    {
        _host.Sql.Procs["SP_MSME_PWD_VALIDATE_CODE"] = args => FakeSql.Arg(args, "PwdCode") == "good-code"
            ? FakeSql.Sets([new { UserId = "ZEDMSME000001", UserName = "Acme", Email = "a@acme.test", RoleId = 5 }])
            : FakeSql.Sets([]);
        var client = await _host.CreateBrowserAsync();

        var weak = await client.PostAsJsonAsync("/api/msme/auth/reset-password", new { code = "good-code", newPassword = "short", confirmPassword = "short" });
        Assert.Equal(HttpStatusCode.BadRequest, weak.StatusCode);

        var bad = await client.PostAsJsonAsync("/api/msme/auth/reset-password", new { code = "bad", newPassword = "New#Pass123", confirmPassword = "New#Pass123" });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);

        var ok = await client.PostAsJsonAsync("/api/msme/auth/reset-password", new { code = "good-code", newPassword = "New#Pass123", confirmPassword = "New#Pass123" });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var update = Assert.Single(_host.Sql.Calls, c => c.Name.StartsWith("UPDATE Users"));
        Assert.Contains("PwdCode = NULL", update.Name);
        var mail = Assert.Single(_host.Email.Sent);
        Assert.DoesNotContain("New#Pass123", mail.HtmlBody);
    }

    [Fact]
    public async Task Forgot_password_answers_the_same_for_unknown_ids()
    {
        var client = await _host.CreateBrowserAsync();
        var r = await client.PostAsJsonAsync("/api/msme/auth/forgot-password", new { userId = "NOPE" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Empty(_host.Email.Sent);
    }
}
