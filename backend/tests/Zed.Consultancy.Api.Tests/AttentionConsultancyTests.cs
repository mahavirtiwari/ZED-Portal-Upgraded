using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Zed.Main.Api.Tests;
using Zed.Portal.Features.Staff.Attention;
using Zed.Portal.Features.Staff.SiteAssessment;

namespace Zed.Consultancy.Api.Tests;

/// <summary>2026-11-17: the bell's work counts on the Consultancy host (milestones, no NC round, the CO allotment).</summary>
public sealed class AttentionConsultancyTests : IDisposable
{
    private readonly TestHost _host = new();
    private readonly WebApplicationFactory<Program> _app;

    public AttentionConsultancyTests()
    {
        _app = _host.WithTestSignIn();
        _host.Sql.Procs["SP_ASSESSMENT_ALLOT_LIST"] = args => (FakeSql.Arg(args, "RoleId"), FakeSql.Arg(args, "AllotmentType"), FakeSql.Arg(args, "Milestone")) switch
        {
            ("7", null, _) => FakeSql.Sets([new { ZedId = "ZEDM1", Certification = "Silver", CertificationBodyUserId = (string?)null, NcCount = 1 }]),
            ("2", "SA", _) => FakeSql.Sets(
                [new { ZedId = "ZEDM1", Certification = "Silver", SiteAssessorId = (string?)null, ReasonForRejection = (string?)null },
                 new { ZedId = "ZEDM2", Certification = "Gold", SiteAssessorId = "CC1", ReasonForRejection = (string?)null }]),
            // Milestone 2: one to review (lead), one to review that is not the consultant's, one in progress.
            ("3", "RA", "2") => FakeSql.Sets(
                [new { ZedId = "ZEDM1", Certification = "Silver", CertificationStatus = 13 },
                 new { ZedId = "ZEDM9", Certification = "Gold", CertificationStatus = 14 },
                 new { ZedId = "ZEDM3", Certification = "Gold", CertificationStatus = 9 }]),
            _ => FakeSql.Sets(),
        };
        _host.Sql.Queries[ConsultancyAllotmentController.MilestoneMembershipSql[..40]] = args => FakeSql.Arg(args, "Milestone") == "2"
            ? [new { ZedId = "ZEDM1", Certification = "Silver", SiteAssessorId = "CC1", CoAssessorId = (string?)null },
               new { ZedId = "ZEDM3", Certification = "Gold", SiteAssessorId = "CC5", CoAssessorId = "CC10,CC1" },
               new { ZedId = "ZEDM9", Certification = "Gold", SiteAssessorId = "CC5", CoAssessorId = "CC10" }]
            : [];
        _host.Sql.Procs["SP_MONITORING_GET_LIST"] = args => FakeSql.Arg(args, "CertificationType") == "Silver" && FakeSql.Arg(args, "Status") == "5"
            ? FakeSql.Sets([new { ZedId = "ZEDM1", Certification = "Silver" }], [])
            : FakeSql.Sets([], []);
        _host.Sql.Queries[AttentionController.QualityOpenSql] = _ => [];
        _host.Sql.Queries[AttentionController.QualityOpenForAgencySql] = _ => [1];
    }

    public void Dispose()
    {
        _app.Dispose();
        _host.Dispose();
    }

    private async Task<Dictionary<string, JsonElement>> Items(string user, int role, params string[] subRoles)
    {
        var client = await StaffTestSignIn.BrowserAsync(_app, user, role, subRoles);
        var body = JsonDocument.Parse(await client.GetStringAsync("/api/staff/attention")).RootElement;
        return body.GetProperty("items").EnumerateArray().ToDictionary(i => i.GetProperty("key").GetString()!);
    }

    [Fact]
    public async Task Master_admin_has_no_nc_round_here()
    {
        var items = await Items("MASTER1", 7);
        Assert.Equal(["allot", "reallot", "quality-open"], items.Keys);
        Assert.Equal(1, items["allot"].GetProperty("count").GetInt32());
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_MONITORING_GET_LIST");
    }

    [Fact]
    public async Task A_consultant_organisation_sees_the_co_allotment_and_its_milestone_reviews()
    {
        var items = await Items("CO1", 2, "SiteVerification");
        Assert.Equal(["sa-allot", "review", "quality-agency"], items.Keys);
        Assert.Equal("Milestones awaiting a consultant", items["sa-allot"].GetProperty("label").GetString());
        Assert.Equal("/staff/site-assessment/co-allotment", items["sa-allot"].GetProperty("link").GetString());
        Assert.Equal(1, items["sa-allot"].GetProperty("count").GetInt32());
        Assert.Equal(1, items["review"].GetProperty("count").GetInt32());
        // The consultancy procedure has no @NcClosingDate, and only the handholding levels are asked for.
        var monitoring = _host.Sql.Calls.Where(c => c.Name == "SP_MONITORING_GET_LIST").Select(c => c.Args!).ToList();
        Assert.All(monitoring, a => Assert.Null(a.GetType().GetProperty("NcClosingDate")));
        Assert.DoesNotContain(monitoring, a => FakeSql.Arg(a, "CertificationType") == "Bronze");
    }

    [Fact]
    public async Task A_consultant_sees_its_own_milestones_to_review()
    {
        var items = await Items("CC1", 3, "SiteVerification");
        var review = Assert.Single(items.Values);
        Assert.Equal("milestone-review", review.GetProperty("key").GetString());
        Assert.Equal(1, review.GetProperty("count").GetInt32());   // ZEDM1 (lead); not ZEDM9 (not its), not ZEDM3 (in progress)
        Assert.Equal("/staff/site-assessment/milestones/2", review.GetProperty("link").GetString());
    }
}
