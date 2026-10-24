using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Zed.Main.Api.Tests.Staff;

public sealed class MonitoringTests : IDisposable
{
    private readonly TestHost _host = new();

    public MonitoringTests()
    {
        SiteAssessmentTestUsers.Register(_host);
        // NC tab: ZEDMSME000001 Silver (NC1). Scheduled tab: ZEDMSME000003 Gold, status 8. Bronze unit in NC too.
        _host.Sql.Procs["SP_MONITORING_GET_LIST"] = args =>
        {
            var status = FakeSql.Arg(args, "Status");
            var cert = FakeSql.Arg(args, "CertificationType");
            var zed = FakeSql.Arg(args, "ZedId");
            var rows = new List<Dictionary<string, object?>>();
            void Add(string zedId, string c, int s, int certStatus, int nc) => rows.Add(new()
            {
                ["ZedId"] = zedId, ["Certification"] = c, ["CertificationStatus"] = certStatus, ["NcCount"] = nc,
                ["PUnitName"] = "Unit " + zedId, ["NcFinalClosureDt"] = "October 30, 2026", ["NcFinalClosureDtOrg"] = "2026-10-30",
                ["UnitSpocEmailId"] = "spoc@x.test", ["EmailId"] = "owner@x.test", ["ReportPath"] = "https://x/PDFs/SA/a.pdf", ["_Status"] = s,
            });
            Add("ZEDMSME000001", "Silver", 4, 14, 1);
            Add("ZEDMSME000004", "Silver", 4, 14, 0);
            Add("ZEDMSME000003", "Gold", 2, 8, 0);
            Add("ZEDMSME000005", "Bronze", 4, 4, 2);
            Add("ZEDMSME000006", "Silver", 7, 17, 2);
            var list = rows.Where(r => r["_Status"]!.ToString() == status && (string)r["Certification"]! == cert && (zed is null || (string)r["ZedId"]! == zed))
                .Select(r => (object)r).ToList();
            return FakeSql.Sets(list, [new { NotStarted = 1, InProgress = 2, Qc = 3, Nc = 4, Rj = 5 }]);
        };
    }

    public void Dispose() => _host.Dispose();

    private Task<HttpClient> SignIn(string user) => SiteAssessmentTestUsers.SignInAsync(_host, user);

    private IEnumerable<object?> CallsTo(string proc) => _host.Sql.Calls.Where(c => c.Name == proc).Select(c => c.Args);

    private static readonly string[] ChangeUrls =
    [
        "/api/staff/monitoring/extend-nc-closure", "/api/staff/monitoring/step-back-nc", "/api/staff/monitoring/send-back-to-agency",
    ];

    // ----- access -----

    [Fact]
    public async Task Endpoints_require_sign_in()
    {
        var client = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/staff/monitoring?certification=Silver&status=4")).StatusCode);
        foreach (var url in ChangeUrls)
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync(url, new { zedId = "ZEDMSME000001", certification = "Silver", noOfDays = 5 })).StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.StartsWith("SP_MONITORING") || c.Name.StartsWith("SP_EXTEND") || c.Name.StartsWith("SP_MOVING"));
    }

    [Theory]
    [InlineData("ASSESSOR1")]
    [InlineData("SUPER1")]
    public async Task Other_roles_cannot_see_monitoring(string user)
    {
        var client = await SignIn(user);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/staff/monitoring?certification=Silver&status=4")).StatusCode);
        Assert.Empty(CallsTo("SP_MONITORING_GET_LIST"));
    }

    [Fact]
    public async Task Agency_without_site_or_desktop_verification_is_forbidden()
    {
        var client = await SignIn("AGENCYFA");
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/staff/monitoring?certification=Silver&status=4")).StatusCode);
        Assert.Empty(CallsTo("SP_MONITORING_GET_LIST"));
    }

    [Fact]
    public async Task Agencies_cannot_change_assessments()
    {
        var client = await SignIn("AGENCY1");
        foreach (var url in ChangeUrls)
            Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync(url, new { zedId = "ZEDMSME000001", certification = "Silver", noOfDays = 5 })).StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name is "SP_EXTEND_NC_CLOSURE_DATE" or "SP_MOVING_ONE_STEP_BACK_OF_NC" or "SP_MONITORING_SEND_BACK_TO_AGENCY_FOR_REALLOCATION");
    }

    // ----- list -----

    [Fact]
    public async Task Agency_list_is_scoped_to_the_agency_and_hides_admin_columns()
    {
        var client = await SignIn("AGENCYDA");
        var body = await client.GetFromJsonAsync<JsonElement>("/api/staff/monitoring?certification=silver&status=4&userId=ADMIN1");

        var call = Assert.Single(CallsTo("SP_MONITORING_GET_LIST"));
        Assert.Equal("AGENCYDA", FakeSql.Arg(call, "UserId"));
        Assert.Equal("2", FakeSql.Arg(call, "RoleId"));
        Assert.Equal("Silver", FakeSql.Arg(call, "CertificationType"));
        Assert.False(body.GetProperty("canManage").GetBoolean());
        var unit = body.GetProperty("units").EnumerateArray().First();
        Assert.False(unit.TryGetProperty("NcFinalClosureDt", out _));
        Assert.False(unit.TryGetProperty("EmailId", out _));
        Assert.False(unit.TryGetProperty("ReportPath", out _));
        Assert.Equal(4, body.GetProperty("counts").GetProperty("Nc").GetInt32());
    }

    [Fact]
    public async Task Master_admin_sees_nc_closure_dates_and_filters_by_date()
    {
        var client = await SignIn("ADMIN1");
        var body = await client.GetFromJsonAsync<JsonElement>("/api/staff/monitoring?certification=Silver&status=4&ncClosingDate=2026-10-30");

        var call = Assert.Single(CallsTo("SP_MONITORING_GET_LIST"));
        Assert.Equal("ADMIN1", FakeSql.Arg(call, "UserId"));
        Assert.Equal("10/30/2026", FakeSql.Arg(call, "NcClosingDate"));
        Assert.True(body.GetProperty("canManage").GetBoolean());
        Assert.Equal("October 30, 2026", body.GetProperty("units")[0].GetProperty("NcFinalClosureDt").GetString());
    }

    [Theory]
    [InlineData("?certification=Platinum&status=4")]
    [InlineData("?certification=Silver&status=9")]
    [InlineData("?certification=Silver&status=2&ncClosingDate=2026-10-30")]
    [InlineData("?certification=Silver&status=4&ncClosingDate=30/10/2026")]
    public async Task Invalid_filters_are_refused(string query)
    {
        var client = await SignIn("ADMIN1");
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/staff/monitoring" + query)).StatusCode);
        Assert.Empty(CallsTo("SP_MONITORING_GET_LIST"));
    }

    // ----- master admin actions -----

    [Fact]
    public async Task Master_admin_extends_the_nc_closure_date_of_a_unit_in_nc()
    {
        var client = await SignIn("ADMIN1");
        var r = await client.PostAsJsonAsync("/api/staff/monitoring/extend-nc-closure", new { zedId = "ZEDMSME000001", certification = "silver", noOfDays = 7 });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var call = Assert.Single(CallsTo("SP_EXTEND_NC_CLOSURE_DATE"));
        Assert.Equal("ZEDMSME000001", FakeSql.Arg(call, "ZedId"));
        Assert.Equal("Silver", FakeSql.Arg(call, "CertificationType"));
        Assert.Equal("7", FakeSql.Arg(call, "NoOfDays"));
        Assert.Equal("ADMIN1", FakeSql.Arg(call, "UserId"));
    }

    [Theory]
    [InlineData("ZEDMSME000003", "Gold", 5)]   // not in NC
    [InlineData("ZEDMSME000006", "Silver", 5)] // rejected: offered on the surveillance portal only
    [InlineData("ZEDMSME009999", "Silver", 5)] // unknown unit
    [InlineData("ZEDMSME000001", "Silver", 0)]
    [InlineData("ZEDMSME000001", "Silver", 31)]
    public async Task Nc_extension_is_refused_outside_its_conditions(string zedId, string certification, int days)
    {
        var client = await SignIn("ADMIN1");
        var r = await client.PostAsJsonAsync("/api/staff/monitoring/extend-nc-closure", new { zedId, certification, noOfDays = days });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Empty(CallsTo("SP_EXTEND_NC_CLOSURE_DATE"));
    }

    [Fact]
    public async Task Master_admin_steps_back_an_nc_round()
    {
        var client = await SignIn("ADMIN1");
        var r = await client.PostAsJsonAsync("/api/staff/monitoring/step-back-nc", new { zedId = "ZEDMSME000005", certification = "Bronze" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var call = Assert.Single(CallsTo("SP_MOVING_ONE_STEP_BACK_OF_NC"));
        Assert.Equal("ZEDMSME000005", FakeSql.Arg(call, "ZedId"));
        Assert.Equal("Bronze", FakeSql.Arg(call, "CertificationType"));
    }

    [Theory]
    [InlineData("ZEDMSME000003", "Gold")]   // not in NC
    [InlineData("ZEDMSME000004", "Silver")] // NcCount 0
    public async Task Nc_step_back_is_refused_outside_its_conditions(string zedId, string certification)
    {
        var client = await SignIn("ADMIN1");
        var r = await client.PostAsJsonAsync("/api/staff/monitoring/step-back-nc", new { zedId, certification });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Empty(CallsTo("SP_MOVING_ONE_STEP_BACK_OF_NC"));
    }

    [Fact]
    public async Task Master_admin_sends_a_scheduled_assessment_back_to_the_agency()
    {
        var client = await SignIn("ADMIN1");
        var r = await client.PostAsJsonAsync("/api/staff/monitoring/send-back-to-agency", new { zedId = "ZEDMSME000003", certification = "Gold" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var call = Assert.Single(CallsTo("SP_MONITORING_SEND_BACK_TO_AGENCY_FOR_REALLOCATION"));
        Assert.Equal("ZEDMSME000003", FakeSql.Arg(call, "ZedId"));
        Assert.Equal("Gold", FakeSql.Arg(call, "CertificationType"));
    }

    [Theory]
    [InlineData("ZEDMSME000005", "Bronze")] // not offered for Bronze
    [InlineData("ZEDMSME000001", "Silver")] // in NC, not scheduled
    public async Task Send_back_is_refused_outside_its_conditions(string zedId, string certification)
    {
        var client = await SignIn("ADMIN1");
        var r = await client.PostAsJsonAsync("/api/staff/monitoring/send-back-to-agency", new { zedId, certification });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Empty(CallsTo("SP_MONITORING_SEND_BACK_TO_AGENCY_FOR_REALLOCATION"));
    }

    [Fact]
    public async Task Send_back_reports_the_procedures_refusal()
    {
        _host.Sql.Procs["SP_MONITORING_SEND_BACK_TO_AGENCY_FOR_REALLOCATION"] = _ => FakeSql.Sets([new { Status = 0, ErrorMessage = "Invalid Details." }]);
        var client = await SignIn("ADMIN1");
        var r = await client.PostAsJsonAsync("/api/staff/monitoring/send-back-to-agency", new { zedId = "ZEDMSME000003", certification = "Gold" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Equal("Invalid Details.", await r.ProblemTitle());
    }
}
