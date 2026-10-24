using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Zed.Core.Security;
using Zed.Main.Api.Tests;
using Zed.Portal.Features.Staff.Assessment;

namespace Zed.Surveillance.Api.Tests;

/// <summary>
/// The surveillance site review page (meeting and recording links, original certification from main) and the agency
/// review actions on the Surveillance host (statuses as on main, surveillance mails, no report attachment).
/// </summary>
public sealed class SurveillanceReviewTests : IDisposable
{
    private const string Zed = "ZEDMSME000001";
    private const string Review = "/api/staff/site-review/ZEDMSME000001/Silver";
    private const string Monitoring = "/api/staff/monitoring/review/ZEDMSME000001";
    private const string Host = "https://loginzed.msme.gov.in";

    private readonly TestHost _host = new();
    private readonly FakeSql _main = new();
    private readonly ReviewFakeDocuments _docs = new();
    private readonly List<WebApplicationFactory<Program>> _apps = [];

    private readonly Dictionary<string, object> _records = new()
    {
        ["Silver"] = Record("Silver", 15, 0),
        ["Bronze"] = Record("Bronze", 5, 0),
    };

    private static object Record(string level, int status, int nc) => new
    {
        ZedId = Zed, Certification = level, CertificationStatus = status, NcCount = nc, NcStatus = 0,
        Nc1Status = 0, Nc2Status = 0, Nc3Status = 0, Nc4Status = 0, Nc5Status = 0,
        DesktopAssessorId = "ASSESSOR1", DesktopAccepted = true, DesktopReasonForRejection = (string?)null,
        CertificationBodyUserId = "AGENCYSV", SiteAssessorId = "ASSESSORSV", CoAssessorId = (string?)null, IsAutoReject = (bool?)null,
    };

    public SurveillanceReviewTests()
    {
        _host.Sql.Queries[AssessmentRecords.CertificationSql] = args =>
            FakeSql.Arg(args, "ZedId") == Zed && _records.TryGetValue(FakeSql.Arg(args, "Certification") ?? "", out var r) ? [r] : [];

        _host.Sql.Procs["SP_ASSESSMENT_DA_DETAILS"] = args => FakeSql.Arg(args, "ZedId") != Zed ? FakeSql.Sets([]) : FakeSql.Sets(
            [new { ZedId = Zed, Certification = "Silver", CertificationStatus = 15, NcCount = 0, MeetingLink = "https://meet.example.test/abc", PUnitName = "Unit" }]);
        _host.Sql.Procs["SP_ASSESSMENT_SA_DETAILS"] = args =>
        {
            if (FakeSql.Arg(args, "ZedId") != Zed) return FakeSql.Sets([]);
            var sets = new List<IEnumerable<object>>
            {
                Array.Empty<object>(), Array.Empty<object>(), Array.Empty<object>(),
                new[] { new { Id = 72, Comments = "Closing", MeetingRecordingLink = "javascript:alert(1)" } },
            };
            while (sets.Count < 15) sets.Add([]);
            sets.Add([new { RecordingLink = "https://rec.example.test/1", CreatedDate = new DateTime(2026, 5, 1) }, new { RecordingLink = "ftp://bad", CreatedDate = (DateTime?)null }]);
            return FakeSql.Sets([.. sets]);
        };

        // Main's procedures (read-only main connection).
        _main.Procs["SP_ASSESSMENT_DA_DETAILS"] = args => FakeSql.Arg(args, "ZedId") != Zed ? FakeSql.Sets([]) : FakeSql.Sets(
            [new { ZedId = Zed, Certification = "Silver", PUnitName = "Unit", AgencyName = "Original Agency", SiteAssessorId = "ORIGSA", Password = "Secret#1" }],
            [new { Id = 21, ProductName = "Bolt", Exported = "No" }], [],
            [new { Id = 41, SectionCode = "1", SectionName = "Leadership" }],
            [new { Id = 11, SectionCode = "1", RequirementCode = "2", RequirementId = "R12", SaConformance = "Yes", SaAssessorRemarks = "fine" }],
            [], [],
            [new { Id = 31, SectionCode = "1", RequirementCode = "2", EvidenceId = "5551", EvidenceName = "Policy" }]);
        _main.Procs["SP_ASSESSMENT_SA_DETAILS"] = _ => FakeSql.Sets(
            [], [], [], [], [], [],
            [new { Id = 9, name = "Tour", src = $"{Host}/mobileapi/SaPhotos/{Zed}/Silver/SiteTour/9.jpg" }]);

        var details = (Func<object?, Zed.Core.Data.ResultSets>)(_ => FakeSql.Sets([new { EmailId = "unit@x.test", EstablishmentName = "Acme", RejectedZedId = Zed + "_D_45" }]));
        _host.Sql.Procs["SP_RA_GET_CERTIFICATE_DETAILS"] = details;
        _host.Sql.Procs["SP_DA_GET_CERTIFICATE_DETAILS"] = details;
    }

    public void Dispose()
    {
        foreach (var a in _apps) a.Dispose();
        _host.Dispose();
    }

    private WebApplicationFactory<Program> App(bool mainConnection = true)
    {
        var app = ReviewTestHost.With(_host, _docs, mainConnection ? _main : null);
        _apps.Add(app);
        return app;
    }

    private static string[] Sv => [SubRoles.SiteVerification];

    // ------------------------------------------------------------------ site review page

    [Fact]
    public async Task The_review_page_shows_the_meeting_link_and_only_web_recording_links()
    {
        var client = await ReviewTestHost.SignInAsync(App(), "AGENCYSV", UserRole.Agency, Sv);
        var json = await client.GetFromJsonAsync<JsonElement>(Review);
        var s = json.GetProperty("surveillance");
        Assert.Equal("https://meet.example.test/abc", s.GetProperty("meetingLink").GetString());
        var links = s.GetProperty("recordingLinks").EnumerateArray().Select(l => l.GetProperty("url").GetString()).ToList();
        Assert.Equal(["https://rec.example.test/1"], links);
        Assert.True(s.GetProperty("hasOriginal").GetBoolean());
        Assert.Equal(0, json.GetProperty("attendance").GetArrayLength());
    }

    [Fact]
    public async Task The_original_certification_is_read_from_main_with_the_surveillance_flag()
    {
        var client = await ReviewTestHost.SignInAsync(App(), "AGENCYSV", UserRole.Agency, Sv);
        var res = await client.GetAsync(Review + "/original");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadAsStringAsync();
        Assert.DoesNotContain("Secret#1", body);
        var json = JsonDocument.Parse(body).RootElement;
        Assert.Equal("Original Agency", json.GetProperty("msme").GetProperty("AgencyName").GetString());
        Assert.StartsWith("/api/staff/site-review/ZEDMSME000001/Silver/files/mobileapi/SaPhotos/", json.GetProperty("siteTour")[0].GetProperty("url").GetString());
        Assert.StartsWith("/api/staff/site-review/ZEDMSME000001/Silver/files/mobileapi/Photos/ZEDMSME000001/Silver/Evidences/5551.pdf",
            json.GetProperty("evidences")[0].GetProperty("FileUrl").GetString());

        var da = _main.Calls.Single(c => c.Name == "SP_ASSESSMENT_DA_DETAILS").Args;
        Assert.Equal("Surveillance", FakeSql.Arg(da, "FromSurveillance"));
        Assert.Equal(Zed, FakeSql.Arg(da, "ZedId"));
        Assert.Equal("AGENCYSV", FakeSql.Arg(da, "UserId"));
        Assert.Single(_main.Calls, c => c.Name == "SP_ASSESSMENT_SA_DETAILS");
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.EndsWith("_FROM_ZEDCS_LIVE", StringComparison.Ordinal));
    }

    [Fact]
    public async Task The_original_certification_needs_the_role_and_the_allotment()
    {
        var app = App();
        var other = await ReviewTestHost.SignInAsync(app, "AGENCY2", UserRole.Agency, Sv);
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync(Review + "/original")).StatusCode);
        var admin = await ReviewTestHost.SignInAsync(app, "ADMIN1", UserRole.Admin);
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.GetAsync(Review + "/original")).StatusCode);
        var anonymous = await ReviewTestHost.SignInAsync(app, null, UserRole.None);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(Review + "/original")).StatusCode);
        Assert.Empty(_main.Calls);
    }

    [Fact]
    public async Task Without_a_main_connection_the_cross_database_wrappers_are_used()
    {
        _host.Sql.Procs["SP_ASSESSMENT_DA_DETAILS_FROM_ZEDCS_LIVE"] = _main.Procs["SP_ASSESSMENT_DA_DETAILS"];
        _host.Sql.Procs["SP_ASSESSMENT_SA_DETAILS_FROM_ZEDCS_LIVE"] = _main.Procs["SP_ASSESSMENT_SA_DETAILS"];
        var client = await ReviewTestHost.SignInAsync(App(mainConnection: false), "MADMIN", UserRole.MasterAdmin);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(Review + "/original")).StatusCode);
        var call = _host.Sql.Calls.Single(c => c.Name == "SP_ASSESSMENT_DA_DETAILS_FROM_ZEDCS_LIVE").Args;
        Assert.Null(FakeSql.Arg(call, "FromSurveillance"));
        Assert.Empty(_main.Calls);
    }

    [Fact]
    public async Task The_review_page_carries_the_surveillance_plan_location_and_selfie_names()
    {
        _host.Sql.Procs["SP_ASSESSMENT_DA_DETAILS"] = _ => FakeSql.Sets(
            [new { ZedId = Zed, Certification = "Silver", CertificationStatus = 15, NcCount = 0, MeetingLink = (string?)null }],
            [], [], [], [], [], [], [], [],
            [new { SurLatitude = "28.9", SurLongitude = "77.9" }]);
        _host.Sql.Procs["SP_ASSESSMENT_SA_DETAILS"] = _ =>
        {
            var sets = new List<IEnumerable<object>>();
            while (sets.Count < 12) sets.Add([]);
            // Set 12: the unit's own selfie (AssessorId = ZED ID) and the assessor's.
            sets.Add([
                new { Id = 1, ZedId = Zed, AssessorId = Zed, PhotoPath = $"{Host}/surveillancemobileapi/SaPhotos/{Zed}/Silver/SiteTour/1.jpg" },
                new { Id = 2, ZedId = Zed, AssessorId = "ASSESSORSV", PhotoPath = $"{Host}/surveillancemobileapi/SaPhotos/{Zed}/Silver/Selfie on Site.jpg" },
            ]);
            sets.Add([]);
            sets.Add([new { Id = 41, SectionCode = "1", SectionName = "Leadership", AllotedAssessorId = "ASSESSORSV", AllotedAssessorName = "Lead SV", AssessorRank = "Lead Assessor" }]);
            return FakeSql.Sets([.. sets]);
        };

        var client = await ReviewTestHost.SignInAsync(App(), "AGENCYSV", UserRole.Agency, Sv);
        var json = await client.GetFromJsonAsync<JsonElement>(Review);
        Assert.Equal("28.9", json.GetProperty("location").GetProperty("SurLatitude").GetString());
        Assert.Equal(["Msme Representative Selfie", "Assessor Selfie"], json.GetProperty("saSelfies").EnumerateArray().Select(p => p.GetProperty("name").GetString()));
        var plan = json.GetProperty("surveillance").GetProperty("planSections")[0];
        Assert.Equal("Lead SV", plan.GetProperty("AllotedAssessorName").GetString());
        Assert.Equal("Lead Assessor", plan.GetProperty("AssessorRank").GetString());
    }

    [Fact]
    public async Task The_original_certification_brings_survemandatories_its_plan_and_its_location()
    {
        _main.Procs["SP_ASSESSMENT_DA_DETAILS"] = _ => FakeSql.Sets(
            [new { ZedId = Zed, Certification = "Silver", PUnitName = "Unit" }],
            [], [],
            [new { Id = 41, SectionCode = "1", SectionName = "Leadership", SurveMandatories = "Yes", AllotedAssessorId = "ORIGSA", AllotedAssessorName = "Original Lead", AssessorRank = "Lead Assessor" }],
            [new { Id = 11, SectionCode = "1", RequirementCode = "2", RequirementId = "R12", SaConformance = "Yes", SaUpdatedDate = "May 6, 2025" }],
            [], [], [], [],
            [new { Latitude = "28.6", Longitude = "77.2", SaLatitude = "28.7", SaLongitude = "77.3" }]);
        var client = await ReviewTestHost.SignInAsync(App(), "MADMIN", UserRole.MasterAdmin);
        var json = await client.GetFromJsonAsync<JsonElement>(Review + "/original");
        var section = json.GetProperty("sections")[0];
        Assert.Equal("Yes", section.GetProperty("SurveMandatories").GetString());
        Assert.Equal("Original Lead", section.GetProperty("AllotedAssessorName").GetString());
        Assert.Equal("May 6, 2025", json.GetProperty("requirements")[0].GetProperty("SaUpdatedDate").GetString());
        Assert.Equal("28.7", json.GetProperty("location").GetProperty("SaLatitude").GetString());
    }

    // ------------------------------------------------------------------ agency decisions

    [Fact]
    public async Task Silver_final_submit_at_15_mails_the_surveillance_certificate_without_a_report()
    {
        var client = await ReviewTestHost.SignInAsync(App(), "AGENCYSV", UserRole.Agency, Sv);
        var res = await client.PostAsJsonAsync(Monitoring + "/Silver/final-submit", new { exemptionsReviewed = false, qualityChecked = true });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Single(_host.Sql.Calls, c => c.Name == "SP_MONITORING_RA_FINAL_SUBMIT");
        Assert.Equal([("certificate", Zed, "Silver")], _docs.Calls.ToList());
        var mail = Assert.Single(_host.Email.Sent);
        Assert.StartsWith("Surveillance Certificate and Assessment Report under", mail.Subject);
        Assert.Single(mail.Attachments!);
        Assert.Contains("surveillance", mail.HtmlBody);
        Assert.DoesNotContain("/surveillance/msme/login", mail.HtmlBody);
        Assert.Contains("/msme/login", mail.HtmlBody);
    }

    [Fact]
    public async Task Bronze_desktop_final_submit_uses_the_surveillance_subject()
    {
        var client = await ReviewTestHost.SignInAsync(App(), "AGENCYSV", UserRole.Agency, [SubRoles.DesktopVerification]);
        var res = await client.PostAsJsonAsync(Monitoring + "/Bronze/final-submit", new { exemptionsReviewed = true, qualityChecked = true });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Single(_host.Sql.Calls, c => c.Name == "SP_MONITORING_DA_FINAL_SUBMIT");
        Assert.StartsWith("Certificate and Surveillance Report under", Assert.Single(_host.Email.Sent).Subject);
        Assert.DoesNotContain(_docs.Calls, c => c.Kind == "report");
    }

    [Fact]
    public async Task Decisions_follow_the_main_status_rules()
    {
        _records["Silver"] = Record("Silver", 13, 0);
        var client = await ReviewTestHost.SignInAsync(App(), "AGENCYSV", UserRole.Agency, Sv);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync(Monitoring + "/Silver/final-submit", new { qualityChecked = true })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync(Monitoring + "/Silver/reject", new { confirmed = true })).StatusCode);

        // Failed NCs (17, NcCount 6): reject, without a report attached on surveillance.
        _records["Silver"] = Record("Silver", 17, 6);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync(Monitoring + "/Silver/reject", new { confirmed = true })).StatusCode);
        Assert.Single(_host.Sql.Calls, c => c.Name == "SP_MONITORING_REJECT_FINAL_SUBMIT");
        Assert.Single(_host.Sql.Calls, c => c.Name == "SP_MONITORING_REJECT_CERTIFICATION");
        var mail = Assert.Single(_host.Email.Sent);
        Assert.Null(mail.Attachments);
        Assert.Empty(_docs.Calls);
    }
}
