using System.Net;
using System.Net.Http.Json;
using Zed.Portal.Features.Staff.Dashboard;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>The "ZED Dashboard" / "ZED Certification" figures of the staff dashboard (SP_V4_DASHBOARD_ANALYTICS).</summary>
public sealed class DashboardAnalyticsTests : IDisposable
{
    private const string Proc = "SP_V4_DASHBOARD_ANALYTICS";
    private readonly TestHost _host = new();

    public DashboardAnalyticsTests()
    {
        DashboardStaffLogin.Register(_host);
        _host.Sql.Procs[Proc] = _ => FakeSql.Sets(
            [new { Registered = 724287, Certified = 512808, Bronze = 500112, Silver = 7735, Gold = 4961 }],
            [new { Label = "Micro", Total = 666594 }, new { Label = "Small", Total = 50485 }],
            [new { Label = "male", Total = 574614 }, new { Label = "OTHERS", Total = 7739 }],
            [new { Label = "General", Total = 378031 }],
            [new { Month = "2025-12", Registered = 53478, Certified = 41020 }, new { Month = "2026-01", Registered = 8810, Certified = 6120 }],
            [new { Label = "GUJARAT", Total = 146518 }],
            [new { Label = "SURAT", Total = 57498 }],
            [new { Label = "13-Manufacture of textiles", Total = 230213 }],
            [new { Label = "SURAT" }, new { Label = "VADODARA" }],
            [new { BronzeTotal = 512340, BronzePending = 3120, SaGoldCompleted = 4961, FaTotal = 9, Password = "x" }],
            [new { Year = 2025, Registered = 400000, Certified = 300000 }, new { Year = 2026, Registered = 8810, Certified = 6120 }]);
    }

    public void Dispose() => _host.Dispose();

    private int Calls() => _host.Sql.Calls.Count(c => c.Name == Proc);

    [Fact]
    public async Task Only_the_dashboard_roles_see_it()
    {
        var anonymous = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/staff/dashboard/analytics")).StatusCode);
        var coordinator = await _host.SignInAsync("STATE1");
        Assert.Equal(HttpStatusCode.Forbidden, (await coordinator.GetAsync("/api/staff/dashboard/analytics")).StatusCode);
        Assert.Equal(0, Calls());
    }

    [Fact]
    public async Task The_admin_sees_the_whole_portal_as_the_master_admin_does()
    {
        var admin = await _host.SignInAsync("ADMIN1");
        var r = await admin.GetFromJsonAsync<StaffDashboardController.AnalyticsResponse>("/api/staff/dashboard/analytics");
        Assert.Equal(724287, r!.Totals.Registered);
        Assert.Equal("1", FakeSql.Arg(_host.LastCall(Proc).Args, "RoleId"));
    }

    [Fact]
    public async Task Returns_the_totals_splits_months_and_rankings_with_the_filters()
    {
        var client = await _host.SignInAsync("SUPER1");
        var r = await client.GetFromJsonAsync<StaffDashboardController.AnalyticsResponse>(
            "/api/staff/dashboard/analytics?view=certified&state=gujarat&district=SURAT&certification=silver&gender=female&size=micro&socialCategory=obc&from=2025-05-01&to=2026-01-06");
        Assert.NotNull(r);
        Assert.Equal("certified", r!.View);
        Assert.Equal(new StaffDashboardController.AnalyticsTotals(724287, 512808, 500112, 7735, 4961), r.Totals);
        Assert.Equal(["Micro", "Small"], r.Sizes.Select(s => s.Label));
        Assert.Equal(new StaffDashboardController.TrendItem("2025-12", 53478, 41020), r.Months[0]);
        Assert.Equal(new StaffDashboardController.TrendItem("2026", 8810, 6120), r.Years[1]);
        Assert.Equal("13-Manufacture of textiles", r.Activities.Single().Label);
        Assert.Equal(["SURAT", "VADODARA"], r.DistrictOptions);
        Assert.Null(r.BoundState);
        // The status cards: only their columns (no Financial Assistance, nothing else the procedure sends).
        Assert.Equal(StaffDashboardController.StatusCardColumns, r.StatusCards.Keys);
        Assert.Equal("512340", r.StatusCards["BronzeTotal"]!.ToString());
        Assert.Null(r.StatusCards["GoldRejected"]);

        var (_, args) = _host.LastCall(Proc);
        Assert.Equal(("certified", "GUJARAT", "SURAT", "Silver", "female", "Micro", "OBC"),
            (FakeSql.Arg(args, "View"), FakeSql.Arg(args, "State"), FakeSql.Arg(args, "District"), FakeSql.Arg(args, "Certification"),
             FakeSql.Arg(args, "Gender"), FakeSql.Arg(args, "Size"), FakeSql.Arg(args, "SocialCategory")));
        Assert.Equal(new DateTime(2025, 5, 1), args!.GetType().GetProperty("From")!.GetValue(args));
        Assert.Equal(("SUPER1", "10"), (FakeSql.Arg(args, "UserId"), FakeSql.Arg(args, "RoleId")));
        Assert.Equal(new DateTime(2026, 1, 6), args.GetType().GetProperty("To")!.GetValue(args));

        // Dates of registration (the default) with a certification level: the units certified at that level.
        await client.GetFromJsonAsync<StaffDashboardController.AnalyticsResponse>("/api/staff/dashboard/analytics?certification=Gold");
        Assert.Equal("Gold", FakeSql.Arg(_host.LastCall(Proc).Args, "Certification"));
        Assert.Equal("registered", FakeSql.Arg(_host.LastCall(Proc).Args, "View"));
    }

    [Theory]
    [InlineData("view=all", "Invalid filter.")]
    [InlineData("state=Atlantis", "Invalid filter.")]
    [InlineData("gender=x", "Invalid filter.")]
    [InlineData("gender=NA", "Invalid filter.")]
    [InlineData("district=SURAT%3BDROP", "Invalid filter.")]
    [InlineData("from=06-01-2026", "Please enter the dates as yyyy-MM-dd.")]
    [InlineData("from=2026-02-01&to=2026-01-01", "The From date is after the To date.")]
    public async Task Refuses_wrong_filters(string query, string message)
    {
        var client = await _host.SignInAsync("MASTER1");
        var r = await client.GetAsync("/api/staff/dashboard/analytics?" + query);
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Equal(message, await r.ProblemTitle());
        Assert.Equal(0, Calls());
    }

    [Fact]
    public async Task A_state_bound_Ministry_user_sees_only_that_state()
    {
        var client = await _host.SignInAsync("MINSTATE1");
        var r = await client.GetFromJsonAsync<StaffDashboardController.AnalyticsResponse>("/api/staff/dashboard/analytics?state=GUJARAT");
        Assert.Equal("UTTAR PRADESH", r!.BoundState);
        Assert.Equal("UTTAR PRADESH", FakeSql.Arg(_host.LastCall(Proc).Args, "State"));
    }

    [Fact]
    public async Task Keeps_a_filter_combination_for_a_while()
    {
        var client = await _host.SignInAsync("SUPER1");
        await client.GetFromJsonAsync<StaffDashboardController.AnalyticsResponse>("/api/staff/dashboard/analytics?state=GUJARAT");
        await client.GetFromJsonAsync<StaffDashboardController.AnalyticsResponse>("/api/staff/dashboard/analytics?state=gujarat");
        Assert.Equal(1, Calls());
        await client.GetFromJsonAsync<StaffDashboardController.AnalyticsResponse>("/api/staff/dashboard/analytics?state=BIHAR");
        Assert.Equal(2, Calls());

        // Another portal-wide user shares the figures; an agency gets its own (its cards count its allotments).
        await (await _host.SignInAsync("MASTER1")).GetFromJsonAsync<StaffDashboardController.AnalyticsResponse>("/api/staff/dashboard/analytics?state=BIHAR");
        Assert.Equal(2, Calls());
        await (await _host.SignInAsync("AGENCY1")).GetFromJsonAsync<StaffDashboardController.AnalyticsResponse>("/api/staff/dashboard/analytics?state=BIHAR");
        Assert.Equal(3, Calls());
        Assert.Equal(("AGENCY1", "2"), (FakeSql.Arg(_host.LastCall(Proc).Args, "UserId"), FakeSql.Arg(_host.LastCall(Proc).Args, "RoleId")));
    }
}
