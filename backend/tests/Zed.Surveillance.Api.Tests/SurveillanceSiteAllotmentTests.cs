using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Zed.Main.Api.Tests;

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
        var r = await (await Agency()).PostAsJsonAsync(Base + "/allotments", Allot("https://meet.example/" + new string('a', 2000)));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
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

    [Fact]
    public async Task Consultancy_allotment_is_not_served_here()
    {
        Assert.Equal(HttpStatusCode.NotFound, (await (await Agency()).GetAsync(Base + "/consultancy/allotments")).StatusCode);
    }
}
