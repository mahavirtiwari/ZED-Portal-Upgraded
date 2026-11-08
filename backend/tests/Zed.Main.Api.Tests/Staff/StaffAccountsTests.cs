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
        _host.Sql.Queries["SELECT StateCode, DistrictCode, DistrictName FROM Districts"] = _ =>
        [
            new { StateCode = "09", DistrictCode = "162", DistrictName = "LUCKNOW" },
            new { StateCode = "09", DistrictCode = "164", DistrictName = "KANPUR NAGAR" },
            new { StateCode = "10", DistrictCode = "230", DistrictName = "PATNA" },
        ];
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
        // One Dashboard Admin instead of Super Admin, Citizen Feedback and QC (2026-11-07).
        Assert.Equal(["Master Admin", "Ministry", "MSME DFO", "Dashboard Admin"], list.Types.Select(t => t.Label));
        Assert.Contains(list.States, s => s is { Code: "9", Name: "UTTAR PRADESH" });
        Assert.Equal("MINISTRY1", Assert.Single(list.Accounts).UserId);
    }

    [Fact]
    public async Task Creates_an_MSME_DFO_for_its_states_districts_and_lists_and_mails_a_set_password_link()
    {
        var resets = new Zed.TestSupport.FakeStaffResets().Attach(_host.Sql.Procs);
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        object Dfo(string[] states, string[] districts, string[] lists) => new
        {
            userId = "DFOUP01", roleId = 6, userName = "DFO Lucknow", email = "dfo@zed.test", mobileNo = "9876543210",
            sectorActivity = "Both", states, districts, neftLists = lists,
        };
        var noState = await admin.PostAsJsonAsync("/api/staff/accounts", Dfo([], [], ["main"]));
        Assert.Equal("Please choose the MSME DFO's states.", await noState.ProblemTitle());
        // A district of a state not chosen (Patna, Bihar) is refused.
        var otherState = await admin.PostAsJsonAsync("/api/staff/accounts", Dfo(["9"], ["230"], ["main"]));
        Assert.Equal("Please choose the districts of the chosen states.", await otherState.ProblemTitle());
        var noList = await admin.PostAsJsonAsync("/api/staff/accounts", Dfo(["9"], [], ["neither"]));
        Assert.Equal("Please tick Financial Assistance and / or Handholding.", await noList.ProblemTitle());
        var taken = await admin.PostAsJsonAsync("/api/staff/accounts", new { userId = "TAKEN1", roleId = 7, userName = "M", email = "m@zed.test", mobileNo = "9876543210" });
        Assert.Equal("This User ID is already in use. Please choose another.", await taken.ProblemTitle());
        var admin2 = await admin.PostAsJsonAsync("/api/staff/accounts", new { userId = "ADMIN9", roleId = 1, userName = "A", email = "a@zed.test", mobileNo = "9876543210" });
        Assert.Equal("Please select the login type.", await admin2.ProblemTitle());
        Assert.Empty(Sql("INSERT INTO Users"));

        var r = await admin.PostAsJsonAsync("/api/staff/accounts", Dfo(["9", "10"], ["162", "164"], ["main", "consultancy"]));
        r.EnsureSuccessStatusCode();
        var insert = Assert.Single(Sql("INSERT INTO Users"));
        Assert.Equal("6", FakeSql.Arg(insert.Args, "RoleId"));
        // The legacy StateCode keeps its first state; its states, districts and both NEFT lists are stored.
        Assert.Equal("9", FakeSql.Arg(insert.Args, "StateCode"));
        var scope = Assert.Single(Sql("UPDATE Users SET SectorActivity"));
        Assert.Equal("9,10", FakeSql.Arg(scope.Args, "ScopeStates"));
        Assert.Equal("162,164", FakeSql.Arg(scope.Args, "ScopeDistricts"));
        Assert.Equal("main:neft,consultancy:neft", FakeSql.Arg(Assert.Single(Sql("UPDATE Users SET ScreenAccess")).Args, "ScreenAccess"));
        Assert.Equal("ADMIN1", FakeSql.Arg(insert.Args, "CreatedBy"));
        var mail = Assert.Single(_host.Email.Sent);
        Assert.Equal("dfo@zed.test", mail.To);
        Assert.Contains("MSME DFO", mail.HtmlBody);
        Assert.Contains("DFOUP01", mail.HtmlBody);
        // No password (it was generated and hashed; nobody is told it): a one-time link of 24 hours instead.
        Assert.DoesNotContain(">Password<", mail.HtmlBody);
        var link = Assert.Single(resets.Rows);
        Assert.Equal(("DFOUP01", "ADMIN1"), (link.UserId, link.RequestedBy));
        Assert.Contains("reset-password#token=", mail.HtmlBody);
        Assert.Contains("within 24 hours", mail.HtmlBody);
    }

    [Theory]
    [InlineData(7, "MASTER09", true)]
    // 2026-11-08: only Master Admin logins keep the generated password; the Dashboard Admin gets the 24-hour link.
    [InlineData(10, "SUPER09", false)]
    public async Task Only_Master_Admin_logins_still_get_the_password(int roleId, string userId, bool password)
    {
        var resets = new Zed.TestSupport.FakeStaffResets().Attach(_host.Sql.Procs);
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        (await admin.PostAsJsonAsync("/api/staff/accounts", new { userId, roleId, userName = "New Admin", email = "new@zed.test", mobileNo = "9876543210", screens = new[] { "main:reports" } })).EnsureSuccessStatusCode();
        var mail = Assert.Single(_host.Email.Sent);
        Assert.Equal(password, mail.HtmlBody.Contains(">Password<"));
        Assert.Equal(!password, mail.HtmlBody.Contains("reset-password#token="));
        Assert.Equal(password ? 0 : 1, resets.Rows.Count);
    }

    [Fact]
    public async Task Lists_the_districts_of_the_chosen_states()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var groups = (await admin.GetFromJsonAsync<List<StaffAccountsController.StateDistricts>>("/api/staff/accounts/districts?states=9,10,XX"))!;
        Assert.Equal(["9", "10"], groups.Select(g => g.StateCode));
        Assert.Equal(["162", "164"], groups[0].Districts.Select(d => d.Code));
        Assert.Equal("PATNA", Assert.Single(groups[1].Districts).Name);
    }

    [Fact]
    public async Task Updates_blocks_and_resets_only_these_logins()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsync("/api/staff/accounts/AGENCY1/block", null)).StatusCode);

        (await admin.PutAsJsonAsync("/api/staff/accounts/DFO9", new { userName = "DFO Kanpur", email = "dfo@zed.test", mobileNo = "9876543210", sectorActivity = "Both", states = new[] { "9" }, neftLists = new[] { "main" } })).EnsureSuccessStatusCode();
        Assert.Equal("DFO Kanpur", FakeSql.Arg(Assert.Single(Sql("UPDATE Users SET UserName")).Args, "UserName"));
        (await admin.PostAsync("/api/staff/accounts/DFO9/block", null)).EnsureSuccessStatusCode();
        Assert.Equal("False", FakeSql.Arg(Assert.Single(Sql("UPDATE Users SET IsActive")).Args, "IsActive"));
        (await admin.PostAsync("/api/staff/accounts/DFO9/reset-password", null)).EnsureSuccessStatusCode();
        Assert.Single(Sql("UPDATE Users SET Password"));
        Assert.Equal("dfo@zed.test", Assert.Single(_host.Email.Sent).To);
    }
}
