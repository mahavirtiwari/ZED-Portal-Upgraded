using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Zed.Main.Api.Tests;
using Zed.Portal.Features.Staff.SiteAssessment;

namespace Zed.Surveillance.Api.Tests;

/// <summary>Silver/Gold surveillance site allotment (meeting link) and the assessors' list on the Surveillance host.</summary>
public sealed class SurveillanceSiteAllotmentTests : IDisposable
{
    private const string Base = "/api/staff/site-assessment";
    private const string Zed = "ZEDMSME000001";
    private static readonly string Tomorrow = DateTime.Today.AddDays(1).ToString("yyyy-MM-dd");
    private const string Link = "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc?context=x";

    private readonly TestHost _host = new();
    private readonly WebApplicationFactory<Program> _app;

    public SurveillanceSiteAllotmentTests()
    {
        _app = _host.WithTestSignIn();
        _host.Sql.Procs["SP_ASSESSMENT_ALLOT_LIST"] = args =>
        {
            if (FakeSql.Arg(args, "RoleId") == "3")
                return FakeSql.Sets(FakeSql.Arg(args, "UserId") == "ASR1"
                    ? [new { ZedId = Zed, Certification = "Silver", PUnitName = "Acme Unit", ModeOfAssessment = "Onsite Assessment", AssessmentDate = "October 22, 2026", AgencyEmail = "a@x.test" }]
                    : []);
            object[] units = FakeSql.Arg(args, "UserId") == "AGENCY1"
                ? [new
                {
                    ZedId = Zed, Certification = "Silver", PUnitName = "Acme Unit", UnitAddress = "Plot 4", SiteAssessorId = "ASR1", CoAssessorId = (string?)null,
                    ReasonForRejection = (string?)null, CertificationStatus = 9, AssessmentDate = "October 22, 2026", SurveillanceNo = "1st Surveillance",
                    LeadInCertification = "ASR7", LeadNameInCertification = "Original Lead", CoInCertification = "-", CoNameInCertification = "-", AgencyEmail = "a@x.test",
                }]
                : [];
            return FakeSql.Sets(units, [new { UserId = "ASR1", UserName = "Lead One" }, new { UserId = "ASR2", UserName = "Co Two" }]);
        };
        _host.Sql.Procs["SP_EMAIL_GET_DETAILS"] = _ => FakeSql.Sets([new
        {
            EmailId = "unit@acme.test", EnterpriseName = "Acme", PUnitName = "Acme Unit", Address = "Plot 4", AgencyName = "Agency A", SpocName = "Spoc",
            AgencyEmailId = "a@x.test", AgencyMobileNo = "9000000000", FinalSaDate = "October 22, 2026", MeetingLink = Link,
            AssessorEmailId = "lead@x.test", AssessorUserId = "ASR1", Password = "LeadSecret#1",
            CoAssessorUserId = "ASR2", CoAssessorEmailId = "co@x.test", CoAssessorPassword = "CoSecret#2", MsmePassword = "MsmeSecret#3",
        }]);
    }

    public void Dispose()
    {
        _app.Dispose();
        _host.Dispose();
    }

    private Task<HttpClient> Agency() => StaffTestSignIn.BrowserAsync(_app, "AGENCY1", 2, "SiteVerification");
    private IEnumerable<object?> CallsTo(string proc) => _host.Sql.Calls.Where(c => c.Name == proc).Select(c => c.Args);

    private static object Allot(string? link = Link, string? co = "ASR2") =>
        new { zedId = Zed, certification = "Silver", siteAssessorId = "ASR1", coAssessorId = co, assessmentDate = Tomorrow, modeOfAssessment = "Onsite Assessment", meetingLink = link };

    [Fact]
    public async Task List_includes_the_surveillance_columns()
    {
        var json = await (await Agency()).GetFromJsonAsync<JsonElement>(Base + "/allotments");
        var unit = json.GetProperty("units")[0];
        Assert.Equal("1st Surveillance", unit.GetProperty("SurveillanceNo").GetString());
        Assert.Equal("Original Lead", unit.GetProperty("LeadNameInCertification").GetString());
        Assert.Equal("October 22, 2026", unit.GetProperty("AssessmentDate").GetString());
        Assert.False(unit.TryGetProperty("AgencyEmail", out _));
        Assert.Equal(2, json.GetProperty("assessors").GetArrayLength());
    }

    [Fact]
    public async Task Re_allot_rows_carry_the_current_meeting_link_and_co_assessor()
    {
        _host.Sql.Queries[SiteAssessmentController.AllotmentSql] = _ =>
            [new { ZedId = Zed, Certification = "Silver", MeetingLink = Link, CoAssessorId = "ASR2" }];
        var unit = (await (await Agency()).GetFromJsonAsync<JsonElement>(Base + "/allotments")).GetProperty("units")[0];
        Assert.Equal(Link, unit.GetProperty("MeetingLink").GetString());
        Assert.Equal("ASR2", unit.GetProperty("CoAssessorId").GetString());

        // One lookup, of this agency's own records, for the listed (already allotted) units.
        var args = Assert.Single(_host.Sql.Calls, c => c.Name == SiteAssessmentController.AllotmentSql).Args;
        Assert.Equal("AGENCY1", FakeSql.Arg(args, "UserId"));
        Assert.Equal($$"""[{"z":"{{Zed}}","c":"Silver"}]""", FakeSql.Arg(args, "Units"));
    }

    [Fact]
    public async Task Units_not_yet_allotted_need_no_lookup()
    {
        _host.Sql.Procs["SP_ASSESSMENT_ALLOT_LIST"] = _ => FakeSql.Sets(
            [new { ZedId = Zed, Certification = "Silver", SiteAssessorId = (string?)null, CertificationStatus = 8 }], []);
        var unit = (await (await Agency()).GetFromJsonAsync<JsonElement>(Base + "/allotments")).GetProperty("units")[0];
        Assert.Equal(JsonValueKind.Null, unit.GetProperty("MeetingLink").ValueKind);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == SiteAssessmentController.AllotmentSql);
    }

    [Fact]
    public async Task An_onsite_surveillance_level_is_allotted_for_a_visit_without_a_link_to_assessors_ticked_onsite()
    {
        // 2026-11-14: Silver's surveillance Mode of assessment is Onsite; ASR1 is ticked for Silver onsite, ASR2 is not.
        _host.Sql.Queries[global::Zed.Portal.Features.CertLevels.LevelFlows.ReadSql] = _ =>
            [new { Code = "Silver", AssessmentFlow = (string?)null, SurveillanceMode = "Onsite" }];
        _host.Sql.Queries[global::Zed.Portal.Features.Staff.Users.AssessorScope.OfUserSql] = args => FakeSql.Arg(args, "UserId") switch
        {
            "ASR1" => [new { UserId = "ASR1", AssessmentModes = "Silver=D,O", AssessorType = "Assessor" }],
            _ => [new { UserId = "ASR2", AssessmentModes = "Bronze=D", AssessorType = "BronzeAssessor" }],
        };
        var agency = await Agency();
        var list = await agency.GetFromJsonAsync<System.Text.Json.JsonElement>(Base + "/allotments");
        Assert.Equal("Onsite", list.GetProperty("units")[0].GetProperty("AssessmentMode").GetString());

        // No meeting link needed; the co-assessor must be ticked too.
        Assert.Contains("not ticked for Silver onsite", await (await agency.PostAsJsonAsync(Base + "/allotments", Allot(null))).ProblemTitle());
        var r = await agency.PostAsJsonAsync(Base + "/allotments", Allot(null, co: null));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Empty(CallsTo("SP_ASSESSMENT_ACCEPT_UNIT_FOR_SA"));
        var args = Assert.Single(CallsTo(global::Zed.Portal.Features.Staff.SiteAssessment.SiteAssessmentController.OnsiteVisitProcedure))!;
        Assert.Equal(("ASR1", Tomorrow), (FakeSql.Arg(args, "SiteAssessorId"), FakeSql.Arg(args, "AssessmentDate")));
        Assert.All(_host.Email.Sent, m => Assert.StartsWith("Allocation of Onsite Assessment", m.Subject));
    }

    [Fact]
    public async Task Allots_with_the_meeting_link_and_mails_it_without_passwords()
    {
        var r = await (await Agency()).PostAsJsonAsync(Base + "/allotments", Allot());
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var args = Assert.Single(CallsTo("SP_ASSESSMENT_ACCEPT_UNIT_FOR_SA"))!;
        Assert.Equal(["AssessmentDate", "Certification", "CoAssessorId", "MeetingLink", "ModeOfAssessment", "SiteAssessorId", "ZedId"],
            args.GetType().GetProperties().Select(p => p.Name).OrderBy(n => n));
        Assert.Equal(Link, FakeSql.Arg(args, "MeetingLink"));
        Assert.Equal("Onsite Assessment", FakeSql.Arg(args, "ModeOfAssessment"));
        Assert.Equal(Tomorrow, FakeSql.Arg(args, "AssessmentDate"));

        var mails = _host.Email.Sent.ToList();
        Assert.Equal(["co@x.test", "lead@x.test", "unit@acme.test"], mails.Select(m => m.To).OrderBy(t => t));
        Assert.All(mails, m => Assert.StartsWith("Allocation of Surveillance Assessment", m.Subject));
        Assert.All(mails, m => Assert.Contains("meetup-join", m.HtmlBody));
        Assert.All(mails, m => Assert.DoesNotContain("Secret#", m.HtmlBody));
        Assert.Contains("Co-assessor", mails.Single(m => m.To == "co@x.test").HtmlBody);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("javascript:alert(1)")]
    [InlineData("teams.microsoft.com/l/meetup")]
    [InlineData("https://meet.example/a b")]
    [InlineData("ftp://meet.example/a")]
    public async Task A_valid_http_meeting_link_is_required(string? link)
    {
        var r = await (await Agency()).PostAsJsonAsync(Base + "/allotments", Allot(link));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Empty(CallsTo("SP_ASSESSMENT_ACCEPT_UNIT_FOR_SA"));
    }

    [Fact]
    public async Task Overlong_meeting_links_are_refused()
    {
        // MsmeCertifications.MeetingLink and the procedure's @MeetingLink are varchar(5000), as the page's maxlength.
        Assert.Equal(5000, SiteAssessmentController.MaxMeetingLink);
        var r = await (await Agency()).PostAsJsonAsync(Base + "/allotments", Allot("https://meet.example/" + new string('a', 5000)));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Meeting_links_up_to_the_column_size_are_accepted()
    {
        var link = "https://meet.example/" + new string('a', 5000 - "https://meet.example/".Length);
        var r = await (await Agency()).PostAsJsonAsync(Base + "/allotments", Allot(link));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal(link, FakeSql.Arg(Assert.Single(CallsTo("SP_ASSESSMENT_ACCEPT_UNIT_FOR_SA")), "MeetingLink"));
    }

    [Fact]
    public async Task A_javascript_link_from_the_database_is_not_put_in_the_mails()
    {
        _host.Sql.Procs["SP_EMAIL_GET_DETAILS"] = _ => FakeSql.Sets([new { EmailId = "unit@acme.test", MeetingLink = "javascript:alert(1)", AssessorEmailId = "lead@x.test", AssessorUserId = "ASR1" }]);
        Assert.Equal(HttpStatusCode.OK, (await (await Agency()).PostAsJsonAsync(Base + "/allotments", Allot())).StatusCode);
        Assert.All(_host.Email.Sent, m => Assert.DoesNotContain("javascript:", m.HtmlBody));
    }

    [Fact]
    public async Task Assessors_list_their_surveillance_assessments()
    {
        var client = await StaffTestSignIn.BrowserAsync(_app, "ASR1", 3, "SiteVerification");
        var rows = await client.GetFromJsonAsync<JsonElement>(Base + "/remote-assessments");
        var row = Assert.Single(rows.EnumerateArray());
        Assert.Equal("Onsite Assessment", row.GetProperty("ModeOfAssessment").GetString());
        Assert.False(row.TryGetProperty("AgencyEmail", out _));
        Assert.Equal("RA", FakeSql.Arg(Assert.Single(CallsTo("SP_ASSESSMENT_ALLOT_LIST")), "AllotmentType"));
    }

    private sealed class NoAssessorTypeColumn() : System.Data.Common.DbException("Invalid column name 'AssessorType'.");

    [Fact]
    public async Task The_onsite_ticks_are_read_from_surveillance_users_which_have_no_assessor_type()
    {
        // ZED_SURVEILLANCE.dbo.Users has AssessmentModes but no AssessorType (found on a real database, 2026-11-14).
        _host.Sql.Queries[global::Zed.Portal.Features.CertLevels.LevelFlows.ReadSql] = _ =>
            [new { Code = "Silver", AssessmentFlow = (string?)null, SurveillanceMode = "Onsite" }];
        _host.Sql.Queries[global::Zed.Portal.Features.Staff.Users.AssessorScope.OfUserSql] = _ => throw new NoAssessorTypeColumn();
        _host.Sql.Queries[global::Zed.Portal.Features.Staff.Users.AssessorScope.ByRoleSql] = _ => throw new NoAssessorTypeColumn();
        _host.Sql.Queries[global::Zed.Portal.Features.Staff.Users.AssessorScope.NoTypeOfUserSql] = args => FakeSql.Arg(args, "UserId") switch
        {
            "ASR1" => [new { UserId = "ASR1", AssessmentModes = "Silver=D,O", AssessorType = (string?)null }],
            _ => [new { UserId = "ASR2", AssessmentModes = "Silver=D", AssessorType = (string?)null }],
        };
        _host.Sql.Queries[global::Zed.Portal.Features.Staff.Users.AssessorScope.NoTypeByRoleSql] = _ =>
            [new { UserId = "ASR1", AssessmentModes = "Silver=D,O", AssessorType = (string?)null }, new { UserId = "ASR2", AssessmentModes = "Silver=D", AssessorType = (string?)null }];
        var agency = await Agency();
        var list = await agency.GetFromJsonAsync<JsonElement>(Base + "/allotments");
        var co = list.GetProperty("assessors").EnumerateArray().Single(a => a.GetProperty("userId").GetString() == "ASR2");
        Assert.Equal(["Desktop"], co.GetProperty("assessments")[0].GetProperty("modes").EnumerateArray().Select(m => m.GetString()));

        Assert.Contains("ASR2 is not ticked for Silver onsite", await (await agency.PostAsJsonAsync(Base + "/allotments", Allot(null))).ProblemTitle());
        Assert.Empty(CallsTo(global::Zed.Portal.Features.Staff.SiteAssessment.SiteAssessmentController.OnsiteVisitProcedure));
    }

    [Fact]
    public async Task Consultancy_allotment_is_not_served_here()
    {
        Assert.Equal(HttpStatusCode.NotFound, (await (await Agency()).GetAsync(Base + "/consultancy/allotments")).StatusCode);
    }
}
