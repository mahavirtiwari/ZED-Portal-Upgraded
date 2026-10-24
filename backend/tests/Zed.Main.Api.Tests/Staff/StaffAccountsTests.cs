using System.Net;
using System.Net.Http.Json;
using Zed.Portal.Features.Staff.Users;

namespace Zed.Main.Api.Tests.Staff;

public sealed class StaffAccountsTests : IDisposable
{
    private readonly TestHost _host = new();

    public StaffAccountsTests()
    {
        UsersMastersLogin.Setup(_host);
        _host.Sql.Queries["SELECT UserId, UserName, RoleId"] = _ =>
            [new { UserId = "MINISTRY1", UserName = "Ministry Desk", RoleId = 8, Email = "m@zed.test", MobileNo = "9999999999", StateCode = (string?)null, IsActive = (bool?)true, CreatedBy = "ADMIN1", CreatedDate = (DateTime?)null }];
        _host.Sql.Queries["SELECT TOP (1) UserId, UserName, RoleId"] = args => FakeSql.Arg(args, "UserId") == "DFO9"
            ? [new { UserId = "DFO9", UserName = "DFO Lucknow", RoleId = 6, Email = "dfo@zed.test", MobileNo = "9999999999", StateCode = "9", IsActive = (bool?)true, CreatedBy = "ADMIN1", CreatedDate = (DateTime?)null }]
            : [];
        _host.Sql.Queries["SELECT TOP (1) UserId FROM Users"] = args => FakeSql.Arg(args, "UserId") == "TAKEN1" ? ["TAKEN1"] : [];
    }

    public void Dispose() => _host.Dispose();

    private List<(string Name, object? Args)> Sql(string start) => _host.Sql.Calls.Where(c => c.Name.StartsWith(start)).ToList();

    [Fact]
    public async Task Only_the_Admin_manages_these_logins()
    {
        foreach (var user in new[] { "MASTER1", "AGENCY1", "SUPER1" })
        {
            var client = await UsersMastersLogin.SignInAsync(_host, user);
            Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/staff/accounts")).StatusCode);
        }
    }

    [Fact]
    public async Task Lists_the_login_types_states_and_accounts()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var list = (await admin.GetFromJsonAsync<StaffAccountsController.AccountsResponse>("/api/staff/accounts"))!;
        Assert.Equal(["Master Admin", "Ministry", "MSME DFO", "Dashboard - Super Admin", "Dashboard - Citizen Feedback", "Dashboard - QC"], list.Types.Select(t => t.Label));
        Assert.Contains(list.States, s => s is { Code: "9", Name: "UTTAR PRADESH" });
        Assert.Equal("MINISTRY1", Assert.Single(list.Accounts).UserId);
    }

    [Fact]
    public async Task Creates_an_MSME_DFO_for_a_state_and_mails_the_password()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var noState = await admin.PostAsJsonAsync("/api/staff/accounts", new { userId = "DFOUP01", roleId = 6, userName = "DFO Lucknow", email = "dfo@zed.test", mobileNo = "9876543210" });
        Assert.Equal("Please select the state of the MSME DFO.", await noState.ProblemTitle());
        var taken = await admin.PostAsJsonAsync("/api/staff/accounts", new { userId = "TAKEN1", roleId = 7, userName = "M", email = "m@zed.test", mobileNo = "9876543210" });
        Assert.Equal("This User ID is already in use. Please choose another.", await taken.ProblemTitle());
        var admin2 = await admin.PostAsJsonAsync("/api/staff/accounts", new { userId = "ADMIN9", roleId = 1, userName = "A", email = "a@zed.test", mobileNo = "9876543210" });
        Assert.Equal("Please select the login type.", await admin2.ProblemTitle());
        Assert.Empty(Sql("INSERT INTO Users"));

        var r = await admin.PostAsJsonAsync("/api/staff/accounts", new { userId = "DFOUP01", roleId = 6, userName = "DFO Lucknow", email = "dfo@zed.test", mobileNo = "9876543210", stateCode = "9" });
        r.EnsureSuccessStatusCode();
        var insert = Assert.Single(Sql("INSERT INTO Users"));
        Assert.Equal("6", FakeSql.Arg(insert.Args, "RoleId"));
        Assert.Equal("9", FakeSql.Arg(insert.Args, "StateCode"));
        Assert.Equal("ADMIN1", FakeSql.Arg(insert.Args, "CreatedBy"));
        var mail = Assert.Single(_host.Email.Sent);
        Assert.Equal("dfo@zed.test", mail.To);
        Assert.Contains("MSME DFO", mail.HtmlBody);
        Assert.Contains("DFOUP01", mail.HtmlBody);
    }

    [Fact]
    public async Task Updates_blocks_and_resets_only_these_logins()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsync("/api/staff/accounts/AGENCY1/block", null)).StatusCode);

        (await admin.PutAsJsonAsync("/api/staff/accounts/DFO9", new { userName = "DFO Kanpur", email = "dfo@zed.test", mobileNo = "9876543210", stateCode = "9" })).EnsureSuccessStatusCode();
        Assert.Equal("DFO Kanpur", FakeSql.Arg(Assert.Single(Sql("UPDATE Users SET UserName")).Args, "UserName"));
        (await admin.PostAsync("/api/staff/accounts/DFO9/block", null)).EnsureSuccessStatusCode();
        Assert.Equal("False", FakeSql.Arg(Assert.Single(Sql("UPDATE Users SET IsActive")).Args, "IsActive"));
        (await admin.PostAsync("/api/staff/accounts/DFO9/reset-password", null)).EnsureSuccessStatusCode();
        Assert.Single(Sql("UPDATE Users SET Password"));
        Assert.Equal("dfo@zed.test", Assert.Single(_host.Email.Sent).To);
    }
}
