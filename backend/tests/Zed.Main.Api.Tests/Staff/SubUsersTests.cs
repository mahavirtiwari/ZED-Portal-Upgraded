using System.Net;
using System.Net.Http.Json;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.SubUsers;

namespace Zed.Main.Api.Tests.Staff;

public sealed class SubUsersTests : IDisposable
{
    private readonly TestHost _host = new();
    private const string SubPassword = "Sub#Pass123";

    /// <summary>The sub-user rows the fake database returns, by UserId.</summary>
    private readonly Dictionary<string, object> _subUsers = new(StringComparer.OrdinalIgnoreCase);

    public SubUsersTests()
    {
        UsersMastersLogin.Setup(_host);
        _host.Sql.Queries["SELECT UserId, OwnerUserId, OwnerRoleId, UserName, Email, MobileNo, Permissions, IsActive, PasswordHash, FailedLogins, LockedUntil, LastLoginAt, CreatedBy, CreatedAt FROM dbo.V4SubUsers WHERE UserId"] =
            args => _subUsers.TryGetValue(FakeSql.Arg(args, "UserId") ?? "", out var row) ? [row] : [];
        _host.Sql.Queries["SELECT UserId, OwnerUserId, OwnerRoleId, UserName, Email, MobileNo, Permissions, IsActive, PasswordHash, FailedLogins, LockedUntil, LastLoginAt, CreatedBy, CreatedAt FROM dbo.V4SubUsers WHERE OwnerUserId"] =
            args => _subUsers.Values.Where(r => (string)r.GetType().GetProperty("OwnerUserId")!.GetValue(r)! == FakeSql.Arg(args, "OwnerUserId"));
        _host.Sql.Procs["SP_GET_USER_DETAILS_BY_USER_ID"] = args => FakeSql.Arg(args, "UserId") switch
        {
            "AGENCY1" => FakeSql.Sets([new { UserId = "AGENCY1", UserName = "Acme Assessors", RoleId = 2, IsActive = true, Email = "agency1@zed.test", MobileNo = "9999999999" }]),
            "AGENCY2" => FakeSql.Sets([new { UserId = "AGENCY2", UserName = "Blocked Agency", RoleId = 2, IsActive = false }]),
            _ => FakeSql.Sets([]),
        };
    }

    public void Dispose() => _host.Dispose();

    private void SubUser(string id, string owner, string permissions, bool active = true, int ownerRole = 2) =>
        _subUsers[id] = new
        {
            UserId = id, OwnerUserId = owner, OwnerRoleId = ownerRole, UserName = "Ravi " + id, Email = "ravi@zed.test", MobileNo = (string?)null,
            Permissions = permissions, IsActive = active, PasswordHash = PasswordStore.Hash(SubPassword), FailedLogins = 0,
            LockedUntil = (DateTime?)null, LastLoginAt = (DateTime?)null, CreatedBy = owner, CreatedAt = DateTime.UtcNow,
        };

    private async Task<(HttpClient Client, CurrentUserResponse User)> SignInSubUserAsync(string id)
    {
        var client = await _host.CreateBrowserAsync();
        var r = await client.PostAsJsonAsync("/api/staff/auth/login", new { userId = id, password = SubPassword });
        r.EnsureSuccessStatusCode();
        return (client, (await r.Content.ReadFromJsonAsync<CurrentUserResponse>())!);
    }

    private List<(string Name, object? Args)> Sql(string start) => _host.Sql.Calls.Where(c => c.Name.StartsWith(start)).ToList();

    [Fact]
    public async Task An_agency_creates_a_sub_user_with_screens_of_its_own_menu()
    {
        var agency = await UsersMastersLogin.SignInAsync(_host, "AGENCY1");
        var list = (await agency.GetFromJsonAsync<SubUsersController.SubUsersResponse>("/api/staff/sub-users"))!;
        Assert.Equal("Sub-User", list.AccountType);
        Assert.Equal(["monitoring", "assessors", "da-allotment", "sa-allotment", "results", "reports", "financial-assistance"], list.Permissions.Select(p => p.Key));

        var refused = await agency.PostAsJsonAsync("/api/staff/sub-users", new { userName = "Ravi", email = "ravi@zed.test", permissions = new[] { "allot" } });
        Assert.Equal("Please select only the screens of your own login.", await refused.ProblemTitle());
        Assert.Equal("Please select at least one screen.",
            await (await agency.PostAsJsonAsync("/api/staff/sub-users", new { userName = "Ravi", email = "ravi@zed.test", permissions = Array.Empty<string>() })).ProblemTitle());

        var r = await agency.PostAsJsonAsync("/api/staff/sub-users", new { userName = "Ravi", email = "ravi@zed.test", mobileNo = "9876543210", permissions = new[] { "reports", "monitoring" } });
        r.EnsureSuccessStatusCode();
        var created = (await r.Content.ReadFromJsonAsync<SubUsersController.CreatedSubUserResponse>())!;
        Assert.Equal("AGENCY1S01", created.UserId);
        var insert = Assert.Single(Sql("INSERT INTO dbo.V4SubUsers"));
        Assert.Equal("AGENCY1", FakeSql.Arg(insert.Args, "OwnerUserId"));
        Assert.Equal("2", FakeSql.Arg(insert.Args, "OwnerRoleId"));
        Assert.Equal("monitoring,reports", FakeSql.Arg(insert.Args, "Permissions"));
        Assert.StartsWith("u1$", FakeSql.Arg(insert.Args, "PasswordHash"));
        var mail = Assert.Single(_host.Email.Sent);
        Assert.Equal("ravi@zed.test", mail.To);
        Assert.Contains("AGENCY1S01", mail.HtmlBody);
        Assert.Contains("AGENCY1 name (AGENCY1)", mail.HtmlBody);
        Assert.Null(mail.Cc);
    }

    [Fact]
    public async Task Only_masters_and_agencies_have_sub_users()
    {
        foreach (var user in new[] { "ADMIN1", "ASSESSOR1", "SUPER1" })
        {
            var client = await UsersMastersLogin.SignInAsync(_host, user);
            Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/staff/sub-users")).StatusCode);
        }
        var master = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        var list = (await master.GetFromJsonAsync<SubUsersController.SubUsersResponse>("/api/staff/sub-users"))!;
        Assert.Equal("Operation Admin", list.AccountType);
        Assert.Contains(list.Permissions, p => p.Key == "allot");
    }

    [Fact]
    public async Task A_sub_user_works_as_its_owner_on_its_screens_only()
    {
        SubUser("AGENCY1S01", "AGENCY1", "reports");
        var (client, me) = await SignInSubUserAsync("agency1s01");
        Assert.Equal("AGENCY1", me.UserId);
        Assert.Equal(2, me.RoleId);
        Assert.Equal("AGENCY1S01", me.ActingUserId);
        Assert.Equal("Ravi AGENCY1S01", me.ActingUserName);
        Assert.Equal(["/staff/reports"], me.PermissionRoutes!);
        Assert.Contains(SubRoles.DesktopVerification, me.SubRoles);
        Assert.Contains(Sql("UPDATE dbo.V4SubUsers SET FailedLogins = 0"), c => FakeSql.Arg(c.Args, "UserId") == "AGENCY1S01");

        Assert.NotEqual(HttpStatusCode.Forbidden, (await client.GetAsync("/api/staff/reports")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/staff/dashboard/counts")).StatusCode);
        var monitoring = await client.GetAsync("/api/staff/monitoring");
        Assert.Equal(HttpStatusCode.Forbidden, monitoring.StatusCode);
        Assert.Equal(SubUserAccessFilter.NoAccess, await monitoring.ProblemTitle());
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/staff/sub-users")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync("/api/staff/assessment/da-allotment/allot", new { })).StatusCode);
    }

    [Fact]
    public async Task Wrong_password_blocked_sub_user_or_inactive_owner_cannot_sign_in()
    {
        SubUser("AGENCY1S01", "AGENCY1", "reports");
        SubUser("AGENCY1S02", "AGENCY1", "reports", active: false);
        SubUser("AGENCY2S01", "AGENCY2", "reports");
        var client = await _host.CreateBrowserAsync();

        var wrong = await client.PostAsJsonAsync("/api/staff/auth/login", new { userId = "AGENCY1S01", password = "Wrong#Pass1" });
        Assert.Equal("Invalid credentials.", await wrong.ProblemTitle());
        Assert.Single(Sql("UPDATE dbo.V4SubUsers SET FailedLogins = CASE"));
        Assert.Equal("Invalid credentials.",
            await (await client.PostAsJsonAsync("/api/staff/auth/login", new { userId = "AGENCY1S02", password = SubPassword })).ProblemTitle());
        Assert.Equal("The account you work for is not active. Please contact your administrator.",
            await (await client.PostAsJsonAsync("/api/staff/auth/login", new { userId = "AGENCY2S01", password = SubPassword })).ProblemTitle());
        // The legacy login procedure is never asked for a sub-user's ID.
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_GET_USER_DETAILS");
    }

    [Fact]
    public async Task A_sub_user_changes_its_own_password_not_the_owners()
    {
        SubUser("AGENCY1S01", "AGENCY1", "reports");
        var (client, _) = await SignInSubUserAsync("AGENCY1S01");
        var r = await client.PostAsJsonAsync("/api/account/change-password", new { oldPassword = SubPassword, newPassword = "New#Pass456", confirmPassword = "New#Pass456" });
        r.EnsureSuccessStatusCode();
        var update = Assert.Single(Sql("UPDATE dbo.V4SubUsers SET PasswordHash"));
        Assert.Equal("AGENCY1S01", FakeSql.Arg(update.Args, "UserId"));
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.StartsWith("UPDATE Users SET Password"));
    }

    [Fact]
    public async Task Owners_change_block_and_reset_only_their_own_sub_users()
    {
        SubUser("AGENCY1S01", "AGENCY1", "reports");
        SubUser("MASTER1S01", "MASTER1", "allot", ownerRole: 7);
        var agency = await UsersMastersLogin.SignInAsync(_host, "AGENCY1");
        Assert.Equal(HttpStatusCode.NotFound, (await agency.PostAsync("/api/staff/sub-users/MASTER1S01/reset-password", null)).StatusCode);

        var r = await agency.PutAsJsonAsync("/api/staff/sub-users/AGENCY1S01", new { userName = "Ravi K", email = "ravi@zed.test", permissions = new[] { "results" }, isActive = false });
        r.EnsureSuccessStatusCode();
        var update = Assert.Single(Sql("UPDATE dbo.V4SubUsers SET UserName"));
        Assert.Equal("results", FakeSql.Arg(update.Args, "Permissions"));
        Assert.Equal("False", FakeSql.Arg(update.Args, "IsActive"));

        (await agency.PostAsync("/api/staff/sub-users/AGENCY1S01/reset-password", null)).EnsureSuccessStatusCode();
        Assert.Single(Sql("UPDATE dbo.V4SubUsers SET PasswordHash"));
        Assert.Equal("ravi@zed.test", Assert.Single(_host.Email.Sent).To);
    }

    [Fact]
    public void Permission_paths_match_whole_segments()
    {
        Assert.True(SubUserPermissions.Under("/api/staff/reports/list", "/api/staff/reports"));
        Assert.True(SubUserPermissions.Under("/api/staff/reports", "/api/staff/reports"));
        Assert.False(SubUserPermissions.Under("/api/staff/reportsx", "/api/staff/reports"));
        Assert.True(SubUserPermissions.Under("/api/staff/assessment/da/Z1/Bronze", "/api/staff/assessment/da/"));
        Assert.False(SubUserPermissions.Under("/api/staff/assessment/da-allotment", "/api/staff/assessment/da/"));
    }
}
