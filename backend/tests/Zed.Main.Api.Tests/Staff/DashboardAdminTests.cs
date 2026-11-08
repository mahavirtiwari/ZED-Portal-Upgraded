using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.AdminPortals;
using Zed.Portal.Features.Staff.Users;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>One Dashboard Admin (2026-11-07, migration 0058): one login type, its screens ticked by the Admin per portal.</summary>
public sealed class DashboardAdminTests : IDisposable
{
    private readonly TestHost _host = new();

    public DashboardAdminTests()
    {
        UsersMastersLogin.Setup(_host);
        // SUPER1 (role 10): main's reports and Consultancy's history only, names hidden on main.
        _host.Sql.Queries[DashboardAdmins.ScreensSql] = args => FakeSql.Arg(args, "UserId") == "SUPER1"
            ? [new DashboardAdmins.ScreensRow("main:reports,main:hide-names,consultancy:history")]
            : [];
        _host.Sql.Queries["SELECT UserId, UserName, RoleId"] = _ => [];
        _host.Sql.Queries["SELECT TOP (1) UserId FROM Users"] = _ => [];
    }

    public void Dispose() => _host.Dispose();

    [Fact]
    public async Task Its_session_has_its_screens_and_other_screens_and_tabs_are_refused()
    {
        var dash = await UsersMastersLogin.SignInAsync(_host, "SUPER1");
        var me = await dash.GetFromJsonAsync<JsonElement>("/api/auth/me");
        Assert.Equal(["consultancy:history", "main:hide-names", "main:reports"], me.GetProperty("screens").EnumerateArray().Select(s => s.GetString()));
        Assert.Contains("/staff/reports", me.GetProperty("permissionRoutes").EnumerateArray().Select(s => s.GetString()));

        Assert.Equal(HttpStatusCode.Forbidden, (await dash.GetAsync("/api/staff/dashboard/failed-transactions")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await dash.GetAsync("/api/staff/dashboard/analytics?view=registered")).StatusCode);
        // History is ticked on Consultancy only, not here.
        Assert.Equal(HttpStatusCode.Forbidden, (await dash.GetAsync("/api/staff/history/ZEDM000001")).StatusCode);
        Assert.NotEqual(HttpStatusCode.Forbidden, (await dash.GetAsync("/api/staff/reports")).StatusCode);
    }

    [Fact]
    public async Task It_is_handed_over_only_to_portals_where_it_has_screens()
    {
        var dash = await UsersMastersLogin.SignInAsync(_host, "SUPER1");
        var r = await dash.PostAsync("/api/staff/admin-portals/consultancy/handoff", null);
        Assert.True(r.IsSuccessStatusCode, await r.Content.ReadAsStringAsync());
        var stored = Assert.Single(_host.Sql.Calls, c => c.Name == AdminPortalsController.InsertSql);
        Assert.Equal("DashHandoff:Consultancy", FakeSql.Arg(stored.Args, "OtpType"));
        Assert.Equal(HttpStatusCode.NotFound, (await dash.PostAsync("/api/staff/admin-portals/surveillance/handoff", null)).StatusCode);
    }

    [Fact]
    public async Task The_Admin_saves_its_screens_and_bad_choices_are_refused()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var list = await admin.GetFromJsonAsync<JsonElement>("/api/staff/accounts");
        var options = list.GetProperty("screens").EnumerateArray().Select(o => o.GetProperty("portal").GetString() + ":" + o.GetProperty("key").GetString()).ToList();
        Assert.Contains("surveillance:reports", options);
        Assert.Contains("main:incentive-submissions", options);
        Assert.DoesNotContain("consultancy:incentive-submissions", options);

        var created = await admin.PostAsJsonAsync("/api/staff/accounts", new
        {
            userId = "DASH01", roleId = 10, userName = "Dashboard Desk", email = "d@zed.test", mobileNo = "9876543210",
            screens = new[] { "main:dash-registered", "surveillance:reports", "main:hide-names" },
        });
        Assert.True(created.IsSuccessStatusCode, await created.Content.ReadAsStringAsync());
        var save = Assert.Single(_host.Sql.Calls, c => c.Name == StaffAccountsController.SaveScreensSql);
        Assert.Equal("main:dash-registered,surveillance:reports,main:hide-names", FakeSql.Arg(save.Args, "ScreenAccess"));

        var none = await admin.PostAsJsonAsync("/api/staff/accounts", new { userId = "DASH02", roleId = 10, userName = "D", email = "d@zed.test", mobileNo = "9876543210", screens = new[] { "main:hide-names" } });
        Assert.Equal("Please tick at least one screen for the Dashboard Admin.", await none.ProblemTitle());
        var bad = await admin.PostAsJsonAsync("/api/staff/accounts", new { userId = "DASH03", roleId = 10, userName = "D", email = "d@zed.test", mobileNo = "9876543210", screens = new[] { "consultancy:incentive-submissions" } });
        Assert.Equal("Please choose the screens from the list.", await bad.ProblemTitle());
    }

    [Fact]
    public void Screen_rules()
    {
        var user = new ZedUser("D", "D", (int)UserRole.SuperAdmin, null, null, null, null, Screens: "main:reports,surveillance:hide-names,main:dash-certified");
        Assert.True(DashboardScreens.Allows(user, PortalSystem.Main, "/api/staff/reports/list-of-registered-msme/download"));
        Assert.True(DashboardScreens.Allows(user, PortalSystem.Main, "/api/staff/dashboard"));
        Assert.False(DashboardScreens.Allows(user, PortalSystem.Surveillance, "/api/staff/reports"));
        Assert.True(DashboardScreens.Allows(user, PortalSystem.Surveillance, "/api/staff/auth/logout"));
        Assert.True(DashboardScreens.HidesNames(user, PortalSystem.Surveillance));
        Assert.False(DashboardScreens.HidesNames(user, PortalSystem.Main));
        Assert.False(DashboardScreens.HasAny(user, PortalSystem.Surveillance));
        // A Super Admin of before (no screens stored): every screen.
        var all = new ZedUser("S", "S", (int)UserRole.SuperAdmin, null, null, null, null);
        Assert.True(DashboardScreens.Allows(all, PortalSystem.Consultancy, "/api/staff/history"));
        Assert.Null(DashboardScreens.Routes(all));
    }
}
