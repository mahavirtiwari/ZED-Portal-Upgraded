using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Main.Api.Tests;

namespace Zed.Consultancy.Api.Tests;

/// <summary>Allot to Consultant Organisation, Consultancy Completed and Consultancy Monitoring on the Consultancy host.</summary>
public sealed class AssessmentConsultancyTests : IDisposable
{
    private const string Zed = "ZEDMSME000001";
    private readonly AssessmentStaff _s = new();

    public AssessmentConsultancyTests()
    {
        _s.Sql.Procs["SP_ASSESSMENT_ALLOT_LIST"] = args => FakeSql.Arg(args, "RoleId") == "7"
            ? FakeSql.Sets([new { ZedId = Zed, Certification = "Silver", PUnitName = "Unit 1", CertificationStatus = 6, NcCount = 2, CertId = 9 }])
            : FakeSql.Sets([]);
        _s.Sql.Procs["SP_ASSESSMENT_AGENCIES_TO_ALLOT"] = _ => FakeSql.Sets([
            new { UserId = "CO1", UserName = "Consultant Org", DesktopVerification = false, SiteVerification = true, FinancialVerification = false },
            new { UserId = "CO2", UserName = "Other", DesktopVerification = true, SiteVerification = false, FinancialVerification = true },
        ]);
        _s.Sql.Procs["SP_EMAIL_GET_DETAILS"] = _ => FakeSql.Sets([new
        {
            EnterpriseName = "Acme", Address = "Plot 4", AgencyEmailId = "co@x.test", NcCount = 2, Password = "Secret#1", CoAssessorPassword = "Secret#2",
        }]);
    }

    public void Dispose() => _s.Dispose();

    [Fact]
    public async Task Allot_list_shows_the_milestone()
    {
        var client = await _s.SignInAsync("MADMIN", 7);
        var row = (await client.GetFromJsonAsync<JsonElement>("/api/staff/assessment/allot")).GetProperty("rows")[0];
        Assert.Equal(2, row.GetProperty("NcCount").GetInt32());
        Assert.False(row.TryGetProperty("CertId", out _));
        // The procedure's parameters in ZED_CONSULTANT: no @Milestone needed for the master admin list.
        Assert.Null(_s.Sql.Calls.First(c => c.Name == "SP_ASSESSMENT_ALLOT_LIST").Args!.GetType().GetProperty("Milestone"));
    }

    [Fact]
    public async Task Allot_to_consultant_organisation_sends_the_handholding_mail()
    {
        var client = await _s.SignInAsync("MADMIN", 7);
        var agencies = await client.GetFromJsonAsync<JsonElement>($"/api/staff/assessment/allot/agencies?zedId={Zed}&certification=Silver");
        Assert.Equal(["CO1"], agencies.EnumerateArray().Select(a => a.GetProperty("userId").GetString()));

        var res = await client.PostAsJsonAsync("/api/staff/assessment/allot", new { zedId = Zed, certification = "Silver", agencyUserId = "CO1" });
        res.EnsureSuccessStatusCode();
        var mail = Assert.Single(_s.Email.Sent);
        Assert.Equal("co@x.test", mail.To);
        Assert.StartsWith("Allocation of MSME for Handholding Support (Milestone 2) under", mail.Subject);
        Assert.Contains("Milestone 2", mail.HtmlBody);
        Assert.DoesNotContain("Secret#", mail.HtmlBody);
    }

    [Theory]
    [InlineData("/api/staff/assessment/da-allotment")]
    [InlineData("/api/staff/assessment/da-verification")]
    [InlineData("/api/staff/assessment/non-conformances")]
    [InlineData("/api/staff/assessment/da/ZEDMSME000001/Silver")]
    [InlineData("/api/staff/assessment/rejected")]
    public async Task Desktop_assessment_screens_and_rejected_are_not_served(string url)
    {
        var client = await _s.SignInAsync("MADMIN", 7);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(url)).StatusCode);
    }

    [Fact]
    public async Task Completed_list_reads_the_monitoring_list_with_milestone_columns()
    {
        _s.Sql.Procs["SP_MONITORING_GET_LIST"] = _ => FakeSql.Sets([
            new { RowNumber = 1, ZedId = Zed, Certification = "Silver", NcCount = 3, DisplayRecTech = 1, TuStatus = 1, CertificationStatus = 100, PUnitName = "Acme", UdyogAadharNo = "UDYAM-1" },
        ]);
        var client = await _s.SignInAsync("CO1", 2, "SiteVerification");
        var json = await client.GetFromJsonAsync<JsonElement>("/api/staff/assessment/completed?searchBy=Unit%20Name&search=acme");
        var row = json.GetProperty("rows")[0];
        Assert.Equal(3, row.GetProperty("NcCount").GetInt32());
        Assert.Equal(1, row.GetProperty("DisplayRecTech").GetInt32());
        var args = _s.Sql.Calls.Single(c => c.Name == "SP_MONITORING_GET_LIST").Args!;
        Assert.Null(args.GetType().GetProperty("NcClosingDate"));
        Assert.Equal("6", FakeSql.Arg(args, "Status"));
    }

    [Fact]
    public async Task Monitoring_list_has_no_nc_closing_date_and_no_nc_actions()
    {
        _s.Sql.Procs["SP_MONITORING_GET_LIST"] = _ => FakeSql.Sets(
            [new { ZedId = Zed, Certification = "Silver", CertificationStatus = 8, NcCount = 1, TechExpert = "EXP1", TechExpertName = "Expert", BdsFromDate = "May 1, 2026" }],
            [new { NotStarted = 1, InProgress = 0, Qc = 0, Nc = 0, Rj = 0 }]);
        var client = await _s.SignInAsync("MADMIN", 7);
        var row = (await client.GetFromJsonAsync<JsonElement>("/api/staff/monitoring?certification=Silver&status=2")).GetProperty("units")[0];
        Assert.Equal("Expert", row.GetProperty("TechExpertName").GetString());
        Assert.Equal("May 1, 2026", row.GetProperty("BdsFromDate").GetString());
        Assert.Null(_s.Sql.Calls.Single(c => c.Name == "SP_MONITORING_GET_LIST").Args!.GetType().GetProperty("NcClosingDate"));

        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/staff/monitoring?certification=Bronze")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/staff/monitoring?certification=Silver&status=4")).StatusCode);
        foreach (var action in new[] { "extend-nc-closure", "step-back-nc", "send-back-to-agency" })
        {
            var res = await client.PostAsJsonAsync("/api/staff/monitoring/" + action, new { zedId = Zed, certification = "Silver", noOfDays = 3 });
            Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
        }
        Assert.DoesNotContain(_s.Sql.Calls, c => c.Name is "SP_MOVING_ONE_STEP_BACK_OF_NC" or "SP_EXTEND_NC_CLOSURE_DATE");
    }
}
