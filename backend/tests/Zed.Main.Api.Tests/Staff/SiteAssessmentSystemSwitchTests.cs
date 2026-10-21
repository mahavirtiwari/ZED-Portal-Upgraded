using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>The surveillance and consultancy additions of the site allotment and remote page do not change Main.</summary>
public sealed class SiteAssessmentSystemSwitchTests : IDisposable
{
    private readonly TestHost _host = new();

    public SiteAssessmentSystemSwitchTests()
    {
        SiteAssessmentTestUsers.Register(_host);
        _host.Sql.Procs["SP_ASSESSMENT_ALLOT_LIST"] = _ => FakeSql.Sets(
            [new { ZedId = "ZEDMSME000001", Certification = "Silver", PUnitName = "Acme", SiteAssessorId = (string?)null, ReasonForRejection = (string?)null, SurveillanceNo = "x" }],
            [new { UserId = "ASR1", UserName = "Lead One" }]);
    }

    public void Dispose() => _host.Dispose();

    [Fact]
    public async Task Main_ignores_a_meeting_link_and_does_not_pass_it()
    {
        var client = await SiteAssessmentTestUsers.SignInAsync(_host, "AGENCY1");
        var r = await client.PostAsJsonAsync("/api/staff/site-assessment/allotments", new
        {
            zedId = "ZEDMSME000001", certification = "Silver", siteAssessorId = "ASR1", coAssessorId = (string?)null,
            assessmentDate = DateTime.Today.AddDays(1).ToString("yyyy-MM-dd"), modeOfAssessment = "Onsite Assessment", meetingLink = "javascript:alert(1)",
        });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var args = Assert.Single(_host.Sql.Calls.Where(c => c.Name == "SP_ASSESSMENT_ACCEPT_UNIT_FOR_SA")).Args!;
        Assert.Null(args.GetType().GetProperty("MeetingLink"));
        Assert.All(_host.Email.Sent, m => Assert.StartsWith("Allocation of Onsite Assessment", m.Subject));
    }

    [Fact]
    public async Task Main_list_keeps_its_columns()
    {
        var client = await SiteAssessmentTestUsers.SignInAsync(_host, "AGENCY1");
        var json = await client.GetFromJsonAsync<JsonElement>("/api/staff/site-assessment/allotments");
        Assert.False(json.GetProperty("units")[0].TryGetProperty("SurveillanceNo", out _));
    }

    [Fact]
    public async Task Consultancy_allotment_and_recording_links_are_not_served_on_Main()
    {
        var client = await SiteAssessmentTestUsers.SignInAsync(_host, "AGENCY1");
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/staff/site-assessment/consultancy/allotments")).StatusCode);
        var assessor = await SiteAssessmentTestUsers.SignInAsync(_host, "ASSESSOR1");
        Assert.Equal(HttpStatusCode.NotFound, (await assessor.PostAsJsonAsync("/api/staff/remote/ZEDMSME000001/Silver/meetings/72/recording-links", new { link = "https://x.test" })).StatusCode);
    }
}
