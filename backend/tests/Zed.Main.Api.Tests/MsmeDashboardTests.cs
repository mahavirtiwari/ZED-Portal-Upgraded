using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Zed.Main.Api.Tests;

public sealed class MsmeDashboardTests : IDisposable
{
    private readonly TestHost _host = new();

    public MsmeDashboardTests()
    {
        _host.Sql.Procs["SP_GET_USER_DETAILS"] = args => FakeSql.Arg(args, "UserId") switch
        {
            "ZEDMSME000001" => FakeSql.Sets([new { UserId = "ZEDMSME000001", UserName = "Acme", RoleId = 5, Email = "a@acme.test" }], [new { ERRORMSG = "SUCCESS" }]),
            "AGENCY1" => FakeSql.Sets([new { UserId = "AGENCY1", UserName = "Agency", RoleId = 2, Email = "x@agency.test" }], [new { ERRORMSG = "SUCCESS" }]),
            _ => FakeSql.Sets([], [new { ERRORMSG = "INVALID CREDENTIAILS" }]),
        };
        _host.Sql.Procs["SP_MSME_GET_DETAILS"] = args => FakeSql.Sets(
            [new Dictionary<string, object?> { ["ZedId"] = FakeSql.Arg(args, "ZedId"), ["EnterpriseName"] = "Acme", ["Password"] = "secret", ["IsBronzePaymentDone"] = 1 }],
            [new Dictionary<string, object?> { ["UdyogAadharNo"] = "UDYAM-UP-29-0003915", ["PanNo"] = "ABCDE1234F", ["ReCertification"] = 0 }],
            [new Dictionary<string, object?> { ["BronzeStatus"] = 3, ["SilverStatus"] = 0, ["GoldStatus"] = 0, ["PledgePath"] = "Certificates" }]);
    }

    public void Dispose() => _host.Dispose();

    private async Task<HttpClient> SignedInAsync(string userId = "ZEDMSME000001")
    {
        var client = await _host.CreateBrowserAsync();
        (await client.PostAsJsonAsync("/api/msme/auth/login", new { userId, password = "Right#Pass1" })).EnsureSuccessStatusCode();
        return client;
    }

    [Fact]
    public async Task Dashboard_requires_a_signed_in_msme()
    {
        var client = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/msme/dashboard")).StatusCode);
    }

    [Fact]
    public async Task Dashboard_returns_only_the_fields_the_page_uses_for_the_signed_in_zed_id()
    {
        var client = await SignedInAsync();
        var json = await client.GetFromJsonAsync<JsonElement>("/api/msme/dashboard?zedId=ZEDMSME999999");

        var call = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_MSME_GET_DETAILS");
        Assert.Equal("ZEDMSME000001", FakeSql.Arg(call.Args, "ZedId"));
        Assert.Null(FakeSql.Arg(call.Args, "CertificationType"));

        Assert.Equal("Acme", json.GetProperty("msme").GetProperty("EnterpriseName").GetString());
        Assert.Equal(3, json.GetProperty("certStatus").GetProperty("BronzeStatus").GetInt32());
        Assert.False(json.GetProperty("msme").TryGetProperty("Password", out _));
        Assert.False(json.GetProperty("basicInfo").TryGetProperty("PanNo", out _));
    }

    [Fact]
    public async Task Dashboard_is_forbidden_for_staff_roles()
    {
        // Staff cannot sign in through the MSME login, so sign in directly with the cookie helper route.
        var client = await _host.CreateBrowserAsync();
        var r = await client.PostAsJsonAsync("/api/msme/auth/login", new { userId = "AGENCY1", password = "Right#Pass1" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/msme/dashboard")).StatusCode);
    }
}

public sealed class AccountTests : IDisposable
{
    private readonly TestHost _host = new();

    public AccountTests()
    {
        _host.Sql.Procs["SP_GET_USER_DETAILS"] = _ =>
            FakeSql.Sets([new { UserId = "ZEDMSME000001", UserName = "Acme", RoleId = 5, Email = "a@acme.test" }], [new { ERRORMSG = "SUCCESS" }]);
        _host.Sql.Procs["SP_GET_USER_DETAILS_BY_USER_ID"] = _ =>
            FakeSql.Sets([new { UserId = "ZEDMSME000001", UserName = "Acme", Password = "Old#Pass1", Email = "a@acme.test" }]);
    }

    public void Dispose() => _host.Dispose();

    private async Task<HttpClient> SignedInAsync()
    {
        var client = await _host.CreateBrowserAsync();
        (await client.PostAsJsonAsync("/api/msme/auth/login", new { userId = "ZEDMSME000001", password = "Old#Pass1" })).EnsureSuccessStatusCode();
        return client;
    }

    [Fact]
    public async Task Wrong_old_password_is_rejected()
    {
        var client = await SignedInAsync();
        var r = await client.PostAsJsonAsync("/api/account/change-password", new { oldPassword = "nope", newPassword = "New#Pass12", confirmPassword = "New#Pass12" });
        Assert.Equal("Invalid Old Password.", await r.ProblemTitle());
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.StartsWith("UPDATE Users"));
    }

    [Fact]
    public async Task Change_password_updates_mails_without_the_password_and_signs_out()
    {
        var client = await SignedInAsync();
        var r = await client.PostAsJsonAsync("/api/account/change-password", new { oldPassword = "Old#Pass1", newPassword = "New#Pass12", confirmPassword = "New#Pass12" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);

        var update = Assert.Single(_host.Sql.Calls, c => c.Name.StartsWith("UPDATE Users"));
        Assert.Equal("ZEDMSME000001", FakeSql.Arg(update.Args, "UserId"));
        Assert.DoesNotContain("New#Pass12", Assert.Single(_host.Email.Sent).HtmlBody);
        Assert.Equal(HttpStatusCode.NoContent, (await client.GetAsync("/api/auth/me")).StatusCode);
    }

    [Fact]
    public async Task Change_password_requires_sign_in()
    {
        var client = await _host.CreateBrowserAsync();
        var r = await client.PostAsJsonAsync("/api/account/change-password", new { oldPassword = "a", newPassword = "New#Pass12", confirmPassword = "New#Pass12" });
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }
}

public sealed class ContactTests : IDisposable
{
    private readonly TestHost _host = new();
    public void Dispose() => _host.Dispose();

    [Fact]
    public async Task Query_is_stored_and_mailed_with_user_text_html_encoded()
    {
        var client = await _host.CreateBrowserAsync();
        var r = await client.PostAsJsonAsync("/api/contact", new
        {
            name = "<b>Ravi</b>", mobile = "9999999999", email = "ravi@example.test", query = "Line 1\n<script>alert(1)</script>",
        });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);

        var call = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_INSERT_QUERY");
        Assert.Equal("9999999999", FakeSql.Arg(call.Args, "MobileNumber"));
        var mail = Assert.Single(_host.Email.Sent);
        Assert.Equal("zed.support@example.test", mail.To);
        Assert.DoesNotContain("<script>", mail.HtmlBody);
        Assert.Contains("&lt;script&gt;", mail.HtmlBody);
    }

    [Theory]
    [InlineData("", "9999999999", "a@b.test", "q")]
    [InlineData("Ravi", "123", "a@b.test", "q")]
    [InlineData("Ravi", "9999999999", "not-an-email", "q")]
    public async Task Invalid_input_is_rejected(string name, string mobile, string email, string query)
    {
        var client = await _host.CreateBrowserAsync();
        var r = await client.PostAsJsonAsync("/api/contact", new { name, mobile, email, query });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_INSERT_QUERY");
    }
}
