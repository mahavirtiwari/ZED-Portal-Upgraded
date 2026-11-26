using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Incentives;
using Zed.Portal.Features.Incentives.Staff;
using Zed.Portal.Features.Staff.Expenditure;
using Zed.Portal.Features.Staff.SubUsers;
using Zed.Portal.Features.Staff.Users;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>2026-11-24 (approved design): the Incentives Master Admin, a Master Admin with only the incentive screens, and its dashboard.</summary>
public sealed class IncentivesAdminTests : IDisposable
{
    private readonly TestHost _host = new();
    private const string Code = "SCH1";

    private static readonly SchemeDefinition Definition = new()
    {
        Code = Code, Name = "Capital Subsidy", Active = true,
        Card = new() { Title = "Capital Subsidy" },
        Activation = new() { Mode = SchemeRules.Levels, Levels = ["Bronze"] },
        Grading = new() { Mode = SchemeRules.ByLevel, Rows = [new("Bronze", 75, 50000)] },
        Form = new()
        {
            Sections =
            [
                new()
                {
                    Key = "items", Title = "Items", Repeating = true, MinItems = 1, MaxItems = 5,
                    Fields = [new() { Key = "amount", Label = "Amount", Type = "amount", IsClaim = true, AssessorChecks = true }],
                },
            ],
        },
        Verification = new() { Flow = SchemeRules.Desktop, CorrectionRounds = 2, CorrectionDays = 30, AutoAllot = true },
    };

    public IncentivesAdminTests()
    {
        UsersMastersLogin.Setup(_host);
        var setup = _host.Sql.Procs["SP_GET_USER_DETAILS"];
        _host.Sql.Procs["SP_GET_USER_DETAILS"] = args => FakeSql.Arg(args, "UserId") is { } id && id.Equals("INC1", StringComparison.OrdinalIgnoreCase)
            ? FakeSql.Sets([new { UserId = "INC1", UserName = "Incentives Desk", RoleId = 7, Email = "inc1@zed.test" }], [new { ERRORMSG = "SUCCESS" }])
            : setup(args);
        _host.Sql.Queries[IncentivesAdmins.ScreenAccessSql] = args =>
            FakeSql.Arg(args, "UserId") == "INC1" ? [new IncentivesAdmins.ScreenRow("incentives")] : [new IncentivesAdmins.ScreenRow(null)];
        _host.Sql.Queries[SchemeStore.AllSql] = _ => [new { Id = 1L, SchemeCode = Code, SchemeJson = SchemeRules.Serialize(Definition), Active = true, OrderNo = (int?)1 }];
        _host.Sql.Queries[SchemeReview.ListAllSql] = _ =>
        [
            new { Id = 1, ZedId = "ZEDM1", SchemeCode = Code, SchemeLevel = "Bronze", SchemeStatus = "Submitted", VerificationStatus = 1, PStateName = "GOA", ClaimAmount = 1000m, SubmittedOn = DateTime.Today },
            new { Id = 2, ZedId = "ZEDM2", SchemeCode = Code, SchemeLevel = "Bronze", SchemeStatus = "OnsiteAllot", VerificationStatus = 2, PStateName = "GOA", OnsiteAllotmentType = "MasterAdmin", ClaimAmount = 2000m, SubmittedOn = DateTime.Today },
            new { Id = 3, ZedId = "ZEDM3", SchemeCode = Code, SchemeLevel = "Bronze", SchemeStatus = "Approved", VerificationStatus = 6, PStateName = "KERALA", ClaimAmount = 3000m, ApprovedAmount = 2500m, SubmittedOn = DateTime.Today.AddMonths(-1), DecidedOn = DateTime.Today },
            new { Id = 4, ZedId = "ZEDM4", SchemeCode = Code, SchemeLevel = "Bronze", SchemeStatus = "OnHold", VerificationStatus = 2, PStateName = "GOA", ClaimAmount = 500m, SubmittedOn = DateTime.Today },
        ];
        _host.Sql.Queries[IncentivesDashboardController.FaSql] = _ =>
        [
            new { ZedId = "ZEDM5", CertificationType = "Bronze", VerificationStatus = 1, PStateName = "GOA", CreatedDate = DateTime.Today },
            new { ZedId = "ZEDM6", CertificationType = "Silver", VerificationStatus = 1, CertificationBodyUserId = "AGENCY1", PStateName = "GOA", CreatedDate = DateTime.Today },
            new { ZedId = "ZEDM7", CertificationType = "Gold", VerificationStatus = 6, PStateName = "KERALA", CreatedDate = DateTime.Today },
        ];
        _host.Sql.Queries[IncentivesDashboardController.AgenciesSql] = _ =>
            [new { UserId = "DESK1", AgencyKind = "SchemeDesktop" }, new { UserId = "DESK2", AgencyKind = "SchemeDesktop" }, new { UserId = "SITE1", AgencyKind = "SchemeOnsite" }];
    }

    public void Dispose() => _host.Dispose();

    [Fact]
    public async Task Its_sign_in_has_the_incentive_screens_and_the_other_staff_apis_are_refused()
    {
        var inc = await UsersMastersLogin.SignInAsync(_host, "INC1");
        var me = await inc.GetFromJsonAsync<JsonElement>("/api/auth/me");
        Assert.Equal(7, me.GetProperty("roleId").GetInt32());
        Assert.Contains(IncentivesAdmins.SubRole, me.GetProperty("subRoles").EnumerateArray().Select(s => s.GetString()));
        var routes = me.GetProperty("permissionRoutes").EnumerateArray().Select(s => s.GetString()).ToList();
        Assert.Equal(IncentivesAdmins.DashboardRoute, routes[0]);
        Assert.Contains("/staff/schemes-verify/applications", routes);
        Assert.Contains("/staff/financial-assistance", routes);
        Assert.Contains("/staff/incentives/upload", routes);
        Assert.Contains("/staff/scheme-agencies", routes);
        Assert.Contains("/staff/sub-users", routes);
        Assert.DoesNotContain("/staff/monitoring", routes);

        // 2026-11-26 (the user): it has Quality Observations and its own Documents too.
        Assert.Contains("/staff/quality-observations", routes);
        Assert.Contains("/staff/documents", routes);
        Assert.NotEqual(HttpStatusCode.Forbidden, (await inc.GetAsync("/api/staff/documents")).StatusCode);
        Assert.NotEqual(HttpStatusCode.Forbidden, (await inc.GetAsync("/api/staff/quality-observations")).StatusCode);
        foreach (var path in new[] { "/api/staff/monitoring", "/api/staff/dashboard/analytics?view=registered", "/api/staff/expenditure/summary",
                     "/api/staff/assessment/allot", "/api/staff/users/agencies" })
            Assert.Equal(HttpStatusCode.Forbidden, (await inc.GetAsync(path)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await inc.GetAsync("/api/staff/incentives-dashboard")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await inc.GetAsync("/api/staff/scheme-applications")).StatusCode);
        Assert.NotEqual(HttpStatusCode.Forbidden, (await inc.GetAsync("/api/staff/sub-users")).StatusCode);

        // 2026-11-25: its Operation Admins are not limited to assessment agencies (they do not verify incentives).
        var subUsers = await inc.GetFromJsonAsync<JsonElement>("/api/staff/sub-users");
        Assert.True(!subUsers.TryGetProperty("agencies", out var agencies) || agencies.ValueKind == JsonValueKind.Null);
        var refused = await inc.PostAsJsonAsync("/api/staff/sub-users",
            new { userName = "Op", email = "op@zed.test", permissions = new[] { "scheme-applications" }, agencies = new[] { "AGENCY1" } });
        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
    }

    [Fact]
    public async Task The_main_master_admin_keeps_its_screens_but_no_longer_the_incentive_ones()
    {
        var master = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        var me = await master.GetFromJsonAsync<JsonElement>("/api/auth/me");
        Assert.DoesNotContain(IncentivesAdmins.SubRole, me.GetProperty("subRoles").EnumerateArray().Select(s => s.GetString()));
        Assert.True(!me.TryGetProperty("permissionRoutes", out var routes) || routes.ValueKind == JsonValueKind.Null);
        Assert.NotEqual(HttpStatusCode.Forbidden, (await master.GetAsync("/api/staff/monitoring")).StatusCode);
        // 2026-11-25 (the product owner): the incentive screens moved to the Incentives Master Admin.
        foreach (var path in new[] { "/api/staff/incentives-dashboard", "/api/staff/scheme-applications", "/api/staff/schemes/fa/submissions",
                     "/api/staff/scheme-agencies", "/api/staff/schemes/incentives/template" })
        {
            var status = (await master.GetAsync(path)).StatusCode;
            Assert.True(status == HttpStatusCode.Forbidden, $"{path}: {status}");
        }
        Assert.Equal(HttpStatusCode.Forbidden, (await master.GetAsync("/api/staff/users/agencies/AGENCY1/schemes")).StatusCode);
    }

    [Fact]
    public async Task The_dashboard_counts_the_schemes_financial_assistance_months_and_states()
    {
        var inc = await UsersMastersLogin.SignInAsync(_host, "INC1");
        var d = await inc.GetFromJsonAsync<JsonElement>("/api/staff/incentives-dashboard");
        var h = d.GetProperty("headline");
        Assert.Equal(4, h.GetProperty("applications").GetInt32());
        Assert.Equal(2, h.GetProperty("inVerification").GetInt32());
        Assert.Equal(1, h.GetProperty("paid").GetInt32());
        Assert.Equal(1, h.GetProperty("onHold").GetInt32());
        Assert.Equal(6500m, h.GetProperty("claimAmount").GetDecimal());
        Assert.Equal(2500m, h.GetProperty("paidAmount").GetDecimal());
        Assert.Equal(2, h.GetProperty("desktopAgencies").GetInt32());
        Assert.Equal(1, h.GetProperty("onsiteAgencies").GetInt32());

        var card = Assert.Single(d.GetProperty("schemes").EnumerateArray());
        Assert.Equal("Capital Subsidy", card.GetProperty("name").GetString());
        // 2026-11-26 (the user: "dynamic as per incentive scheme"): the scheme's own flow and on/off with its card.
        Assert.Equal(("Desktop", true), (card.GetProperty("flow").GetString(), card.GetProperty("active").GetBoolean()));
        Assert.Equal((4, 1, 1, 1, 1), (card.GetProperty("total").GetInt32(), card.GetProperty("desktop").GetInt32(), card.GetProperty("onsite").GetInt32(),
            card.GetProperty("paid").GetInt32(), card.GetProperty("onHold").GetInt32()));

        var fa = d.GetProperty("fa");
        Assert.Equal((3, 1, 1, 1), (fa.GetProperty("total").GetInt32(), fa.GetProperty("toAllot").GetInt32(), fa.GetProperty("inVerification").GetInt32(),
            fa.GetProperty("reimbursed").GetInt32()));

        var months = d.GetProperty("months").EnumerateArray().ToList();
        Assert.Equal(12, months.Count);
        Assert.Equal(DateTime.Today.ToString("yyyy-MM"), months[^1].GetProperty("month").GetString());
        Assert.Equal(3, months[^1].GetProperty("submitted").GetInt32());
        Assert.Equal("GOA", d.GetProperty("states")[0].GetProperty("state").GetString());

        // By state: Kerala has the paid application and the reimbursed Financial Assistance.
        var kerala = await inc.GetFromJsonAsync<JsonElement>("/api/staff/incentives-dashboard?state=KERALA");
        Assert.Equal(1, kerala.GetProperty("headline").GetProperty("applications").GetInt32());
        Assert.Equal(1, kerala.GetProperty("fa").GetProperty("total").GetInt32());
        Assert.Equal(HttpStatusCode.BadRequest, (await inc.GetAsync("/api/staff/incentives-dashboard?from=2026-11-10&to=2026-11-01")).StatusCode);
    }

    [Fact]
    public async Task Its_bell_lists_the_incentive_work_and_the_open_quality_observations()
    {
        var inc = await UsersMastersLogin.SignInAsync(_host, "INC1");
        var a = await inc.GetFromJsonAsync<JsonElement>("/api/staff/attention?fresh=true");
        var items = a.GetProperty("items").EnumerateArray().ToDictionary(i => i.GetProperty("key").GetString()!, i => i.GetProperty("count").GetInt32());
        // 2026-11-26: with the open quality observations (its Quality Observations screen).
        Assert.Equal(new Dictionary<string, int> { ["scheme-allot"] = 1, ["scheme-onsite-allot"] = 1, ["scheme-hold"] = 1, ["fa-allot"] = 1, ["quality-open"] = 0 }, items);
    }

    [Fact]
    public async Task The_Admin_creates_it_on_the_main_portal_and_the_list_tells_it_apart()
    {
        _host.Sql.Queries[StaffAccountsController.ScreensListSql] = _ => [new StaffAccountsController.ScreenRow("INC1", "incentives")];
        _host.Sql.Queries["SELECT UserId, UserName, RoleId, Email"] = _ =>
            [new { UserId = "INC1", UserName = "Incentives Desk", RoleId = 7, IsActive = true }, new { UserId = "MASTER1", UserName = "Master", RoleId = 7, IsActive = true }];
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var list = await admin.GetFromJsonAsync<JsonElement>("/api/staff/accounts");
        var type = Assert.Single(list.GetProperty("types").EnumerateArray(), t => t.GetProperty("typeId").GetInt32() == IncentivesAdmins.TypeId);
        Assert.Equal(("Incentives Master Admin", 7), (type.GetProperty("label").GetString(), type.GetProperty("roleId").GetInt32()));
        var rows = list.GetProperty("accounts").EnumerateArray().ToDictionary(r => r.GetProperty("userId").GetString()!, r => r.GetProperty("typeId").GetInt32());
        Assert.Equal(IncentivesAdmins.TypeId, rows["INC1"]);
        Assert.Equal(7, rows["MASTER1"]);

        var created = await admin.PostAsJsonAsync("/api/staff/accounts", new
        {
            userId = "INC02", roleId = 7, typeId = IncentivesAdmins.TypeId, userName = "Incentive Desk", email = "inc@zed.test", mobileNo = "9876543210",
        });
        Assert.True(created.IsSuccessStatusCode, await created.Content.ReadAsStringAsync());
        Assert.StartsWith("Incentives Master Admin login INC02 created", (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("message").GetString());
        var insert = Assert.Single(_host.Sql.Calls, c => c.Name.StartsWith("INSERT INTO Users (UserId, Password"));
        Assert.Equal("7", FakeSql.Arg(insert.Args, "RoleId"));
        var save = Assert.Single(_host.Sql.Calls, c => c.Name == StaffAccountsController.SaveScreensSql);
        Assert.Equal(("INC02", "incentives"), (FakeSql.Arg(save.Args, "UserId"), FakeSql.Arg(save.Args, "ScreenAccess")));
    }

    [Fact]
    public void Its_operation_admins_get_only_the_incentive_screens()
    {
        var keys = SubUserPermissions.For((int)UserRole.MasterAdmin, [IncentivesAdmins.SubRole], PortalSystem.Main).Select(p => p.Key).Order().ToArray();
        Assert.Equal(["financial-assistance", "incentive-upload", "quality-observations", "scheme-applications", "scheme-onsite-agencies"], keys);
        var main = SubUserPermissions.For((int)UserRole.MasterAdmin, [], PortalSystem.Main).Select(p => p.Key).ToList();
        Assert.Contains("monitoring", main);
        // 2026-11-25: the main Master Admin's Operation Admins no longer get the incentive screens.
        Assert.Empty(main.Intersect(IncentivesAdmins.IncentiveKeys));
        Assert.Contains("quality-observations", main);

        Assert.True(IncentivesAdmins.Allows("GET", "/api/staff/scheme-applications/4", subUser: false, PortalSystem.Main));
        Assert.True(IncentivesAdmins.Allows("POST", "/api/staff/sub-users", subUser: false, PortalSystem.Main));
        Assert.False(IncentivesAdmins.Allows("POST", "/api/staff/sub-users", subUser: true, PortalSystem.Main));
        Assert.True(IncentivesAdmins.Allows("GET", "/api/staff/msme-profile/ZEDM1", subUser: true, PortalSystem.Main));
        Assert.False(IncentivesAdmins.Allows("GET", "/api/staff/dashboard", subUser: false, PortalSystem.Main));
        Assert.False(IncentivesAdmins.Allows("GET", "/api/staff/history", subUser: false, PortalSystem.Main));
        // What it creates stays with the Master Admins' Expenditure (it has none).
        Assert.Contains("ScreenAccess, '') <> 'incentives'", ExpenditureParties.MastersSql);
    }
}
