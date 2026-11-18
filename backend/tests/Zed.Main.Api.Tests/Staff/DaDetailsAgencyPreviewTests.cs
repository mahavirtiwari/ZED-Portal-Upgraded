using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Portal.Features.Staff.Assessment;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>
/// 2026-11-18 (the user: "show assessment detail during the allocation in the login of assessment agency"): the agency opens
/// the details page of a unit allotted to it and not yet accepted, as a read-only preview with the allotment banner.
/// </summary>
public sealed class DaDetailsAgencyPreviewTests : IDisposable
{
    private const string Zed = "ZEDMSME000001";
    private const string Base = "/api/staff/assessment/da/ZEDMSME000001/Bronze";
    private readonly TestHost _host = new();

    /// <summary>MsmeCertifications row: allotted to AGENCY1 by the app's auto allotment, no desktop assessor yet (status 2).</summary>
    private object _record = Record(status: 2, assessor: null, accepted: null);

    /// <summary>The unit in AGENCY1's "DA" allotment list (null: not in it, e.g. accepted by its assessor).</summary>
    private object? _listRow = ListRow(assessor: null, reason: null);

    private static object Record(int status, string? assessor, bool? accepted, string? reason = null) => new
    {
        ZedId = Zed, Certification = "Bronze", CertificationStatus = status, NcCount = 0, NcStatus = 0, Nc1Status = 0, Nc2Status = 0, Nc3Status = 0, Nc4Status = 0, Nc5Status = 0,
        DesktopAssessorId = assessor, DesktopAccepted = accepted, DesktopReasonForRejection = reason, CertificationBodyUserId = "AGENCY1",
        SiteAssessorId = (string?)null, CoAssessorId = (string?)null,
    };

    private static object ListRow(string? assessor, string? reason, bool? accepted = null) => new
    {
        ZedId = Zed, Certification = "Bronze", PUnitName = "Unit 1", UnitSpocName = "Ravi Kumar", UnitSpocMobileNo = "9876543210", UnitSpocEmailId = "ravi@unit.in",
        DesktopAssessorId = assessor, DaAssessorName = assessor is null ? null : "Assessor One", DesktopReasonForRejection = reason, DesktopAccepted = accepted,
        ReasonForRejection = (string?)null, CertificationStatus = 2,
    };

    public DaDetailsAgencyPreviewTests()
    {
        DaTestUsers.Install(_host.Sql);
        var q = _host.Sql.Queries;
        q[AssessmentRecords.CertificationSql] = args => FakeSql.Arg(args, "ZedId") == Zed && FakeSql.Arg(args, "Certification") == "Bronze" ? [_record] : [];
        q[AssessmentRecords.RequirementSql] = args => FakeSql.Arg(args, "Id") == "11" ? [new { Id = 11L, NcCount = 0 }] : [];
        q[AssessmentRecords.ProductSql] = args => FakeSql.Arg(args, "Id") == "21" ? [new { Id = 21L, NcCount = 0 }] : [];
        q[AssessmentRecords.EvidenceSql] = args => FakeSql.Arg(args, "Id") == "31"
            ? [new { Id = 31L, NcCount = 0, SectionCode = "1", RequirementCode = "2", EvidenceCode = "3", ValidationRequired = true }]
            : [];
        q[AssessmentRecords.SectionSql] = args => FakeSql.Arg(args, "Id") == "41" ? [new { Id = 41L, NcCount = 0, IsAssessmentExcempted = "Yes" }] : [];
        q[AssessmentRecords.SiteExteriorPhotoSql] = _ => [new { Id = 61L, NcCount = 0 }];
        q["SELECT TOP 1 CreatedDate FROM AgencyAllotmentHistory"] = args =>
            FakeSql.Arg(args, "AgencyId") == "AGENCY1" ? [new { CreatedDate = new DateTime(2026, 11, 17, 10, 30, 0) }] : [];
        q["SELECT TOP 1 PanNo FROM MsmeBasicInformation"] = args => FakeSql.Arg(args, "ZedId") == Zed ? [new { PanNo = "ABCDE1234F" }] : [];

        // SP_ASSESSMENT_DA_DETAILS: the agency of the unit sees it (the procedure's rule; CanView checks it again).
        _host.Sql.Procs["SP_ASSESSMENT_DA_DETAILS"] = args => FakeSql.Arg(args, "ZedId") != Zed ? FakeSql.Sets([]) : FakeSql.Sets(
            [new { ZedId = Zed, Certification = "Bronze", PUnitName = "Unit 1", CertificationStatus = 2, NcCount = 0, PhotosPath = (string?)null,
                   CertificationBodyUserId = "AGENCY1", UserName = "Agency One", BasicInfoStatus = "November 16, 2026" }],
            [new { Id = 21, ZedId = Zed, Certification = "Bronze", ProductName = "Bolt", ProductPhoto = "p1.jpg", NcCount = 0 }],
            [],
            [new { Id = 41, SectionCode = "1", SectionName = "Leadership", ValidationRequired = 1 }],
            [new { Id = 11, SectionCode = "1", RequirementCode = "2", Conformance = (string?)null }],
            [], [],
            [new { Id = 31, ZedId = Zed, SectionCode = "1", RequirementCode = "2", EvidenceId = 5551, EvidenceCode = "3", EvidenceName = "Policy", ValidationRequired = true }],
            [new { Id = 61, PhotoId = "777", PhotoType = "SiteExteriorPhotos" }],
            [new { Latitude = "28.6", Longitude = "77.2" }],
            [],
            []);
        // SP_ASSESSMENT_ALLOT_LIST is scoped by @UserId: only AGENCY1's "DA" list holds the unit.
        _host.Sql.Procs["SP_ASSESSMENT_ALLOT_LIST"] = args =>
            FakeSql.Arg(args, "UserId") == "AGENCY1" && FakeSql.Arg(args, "RoleId") == "2" && FakeSql.Arg(args, "AllotmentType") == "DA" && _listRow is not null
                ? FakeSql.Sets([_listRow], [], [])
                : FakeSql.Sets([], [], []);
    }

    public void Dispose() => _host.Dispose();

    private Task<HttpClient> As(string user) => DaTestUsers.SignInAsync(_host, user);

    [Fact]
    public async Task Agency_previews_a_unit_allotted_to_it_and_not_yet_accepted()
    {
        var json = await (await As("AGENCY1")).GetFromJsonAsync<JsonElement>(Base);

        var a = json.GetProperty("allotment");
        Assert.Equal("pending", a.GetProperty("stage").GetString());
        Assert.Equal("17 Nov 2026", a.GetProperty("allottedOn").GetString());
        Assert.True(a.GetProperty("canAllot").GetBoolean());
        Assert.True(a.GetProperty("canReject").GetBoolean());
        // 2026-11-18 (the user): nothing masked in the signed-in portal.
        Assert.Equal("Ravi Kumar", a.GetProperty("spocName").GetString());
        Assert.Equal("9876543210", a.GetProperty("mobile").GetString());
        Assert.Equal("ravi@unit.in", a.GetProperty("email").GetString());
        Assert.Equal("ABCDE1234F", a.GetProperty("pan").GetString());
        // What the applicant submitted is there; nothing can be changed.
        Assert.Equal("Bolt", json.GetProperty("products")[0].GetProperty("ProductName").GetString());
        Assert.Equal(1, json.GetProperty("evidences").GetArrayLength());
        Assert.Equal(0, json.GetProperty("ncRounds").GetArrayLength());
        var p = json.GetProperty("permissions");
        Assert.False(p.GetProperty("canAssess").GetBoolean());
        Assert.False(p.GetProperty("canFinalSubmit").GetBoolean());
        Assert.All(p.GetProperty("review").EnumerateObject(), r => Assert.False(r.Value.GetBoolean()));

        var call = DaTestUsers.CallsTo(_host.Sql, "SP_ASSESSMENT_ALLOT_LIST").Single();
        Assert.Equal("AGENCY1", FakeSql.Arg(call.Args, "UserId"));
        Assert.Equal("DA", FakeSql.Arg(call.Args, "AllotmentType"));
        Assert.Equal(Zed, FakeSql.Arg(call.Args, "ZedId"));
    }

    [Fact]
    public async Task After_the_assessor_rejected_the_agency_may_re_allot_or_reject()
    {
        _record = Record(2, "ASSESSOR1", null, "Busy");
        _listRow = ListRow("ASSESSOR1", "Busy");
        var a = (await (await As("AGENCY1")).GetFromJsonAsync<JsonElement>(Base)).GetProperty("allotment");
        Assert.Equal("rejected", a.GetProperty("stage").GetString());
        Assert.Equal("Busy", a.GetProperty("assessorReason").GetString());
        Assert.True(a.GetProperty("canAllot").GetBoolean());
        Assert.True(a.GetProperty("canReject").GetBoolean());
    }

    [Fact]
    public async Task Allotted_to_an_assessor_who_has_not_accepted_it_can_be_re_allotted_not_rejected()
    {
        _record = Record(2, "ASSESSOR1", null);
        _listRow = ListRow("ASSESSOR1", null);
        var a = (await (await As("AGENCY1")).GetFromJsonAsync<JsonElement>(Base)).GetProperty("allotment");
        Assert.Equal("allotted", a.GetProperty("stage").GetString());
        Assert.Equal("Assessor One", a.GetProperty("assessorName").GetString());
        Assert.True(a.GetProperty("canAllot").GetBoolean());
        Assert.False(a.GetProperty("canReject").GetBoolean());
    }

    [Fact]
    public async Task Another_agency_cannot_open_the_unit()
    {
        var other = await As("AGENCY2");
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync(Base)).StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_ASSESSMENT_ALLOT_LIST");
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.StartsWith("SELECT TOP 1 PanNo", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Once_accepted_by_its_assessor_the_page_is_no_preview()
    {
        _record = Record(3, "ASSESSOR1", true);
        _listRow = null;
        var json = await (await As("AGENCY1")).GetFromJsonAsync<JsonElement>(Base);
        Assert.False(json.TryGetProperty("allotment", out _));
    }

    [Theory]
    [InlineData("ASSESSOR1")]
    [InlineData("MADMIN")]
    [InlineData("QC1")]
    public async Task Only_the_agency_gets_the_allotment_banner(string user)
    {
        _record = Record(2, "ASSESSOR1", null);
        var json = await (await As(user)).GetFromJsonAsync<JsonElement>(Base);
        Assert.False(json.TryGetProperty("allotment", out _));
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_ASSESSMENT_ALLOT_LIST");
    }

    /// <summary>The agency cannot change answers, conformance, validations or exemptions at this stage (nor submit).</summary>
    [Theory]
    [InlineData("/requirements/11/conformance")]
    [InlineData("/requirements/11/checkpoints")]
    [InlineData("/products/21/validate")]
    [InlineData("/site-exterior/validate")]
    [InlineData("/sections/41/exemption")]
    [InlineData("/opened")]
    [InlineData("/form-checks")]
    [InlineData("/final-submit/check")]
    [InlineData("/final-submit")]
    public async Task Agency_cannot_change_the_unit_it_previews(string action)
    {
        var client = await As("AGENCY1");
        var r = await client.PostAsJsonAsync(Base + action, new
        {
            conformance = "Yes", remarks = "x", isVerified = "Yes", isAssessmentExcempted = "No", type = "Evidence", id = 31,
            answers = new[] { new { id = 501, answer = "Yes" } }, form = "f", key = "k", status = "Yes", checklist = Array.Empty<string>(),
        });
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.StartsWith("SP_ASSESSMENT_DA_UPDATE") || c.Name.StartsWith("SP_ASSESSMENT_DA_FINAL_SUBMIT") ||
                                                    c.Name.StartsWith("SP_ASSESSMENT_DA_CONFIRM_FINAL_SUBMIT"));
    }

    /// <summary>
    /// 2026-11-18: a unit in the agency's site-assessment allotment list (Remote only / Onsite only levels arrive there straight
    /// from the app): the same banner with the site actions; the preview hides verdicts only when there was no desktop step.
    /// </summary>
    [Theory]
    [InlineData(null, null, true, true)]          // no desktop step, no site assessor yet: preview, Accept and Reject
    [InlineData("ASSESSOR1", null, false, true)]  // after a desktop assessment: its results are shown
    [InlineData(null, "SITE1", true, false)]      // a site assessor allotted, not started: Re-allot only
    public async Task Site_agency_gets_the_banner_for_a_unit_waiting_in_its_site_allotment(string? desktopAssessor, string? siteAssessor, bool preview, bool canReject)
    {
        const string silver = "/api/staff/assessment/da/ZEDMSME000001/Silver";
        var record = new
        {
            ZedId = Zed, Certification = "Silver", CertificationStatus = 6, NcCount = 0, NcStatus = 0, Nc1Status = 0, Nc2Status = 0, Nc3Status = 0, Nc4Status = 0, Nc5Status = 0,
            DesktopAssessorId = desktopAssessor, DesktopAccepted = desktopAssessor is null ? (bool?)null : true, DesktopReasonForRejection = (string?)null,
            CertificationBodyUserId = "AGENCYSV", SiteAssessorId = siteAssessor, CoAssessorId = (string?)null,
        };
        _host.Sql.Queries[AssessmentRecords.CertificationSql] = args => FakeSql.Arg(args, "Certification") == "Silver" ? [record] : [];
        // Silver's result sets: 23, the screenshots at 21 and the ESG check list at 22.
        var sets = Enumerable.Range(0, 23).Select(_ => (IEnumerable<object>)Array.Empty<object>()).ToArray();
        sets[0] = [new { ZedId = Zed, Certification = "Silver", PUnitName = "Unit 1", CertificationStatus = 6, NcCount = 0, PhotosPath = (string?)null, CertificationBodyUserId = "AGENCYSV" }];
        _host.Sql.Procs["SP_ASSESSMENT_DA_DETAILS"] = _ => FakeSql.Sets(sets);
        _host.Sql.Procs["SP_ASSESSMENT_ALLOT_LIST"] = args =>
            FakeSql.Arg(args, "UserId") == "AGENCYSV" && FakeSql.Arg(args, "AllotmentType") == "SA"
                ? FakeSql.Sets([new { ZedId = Zed, Certification = "Silver", SiteAssessorId = siteAssessor, SaAssessorName = siteAssessor is null ? null : "Site One",
                                      ReasonForRejection = (string?)null, UnitSpocName = "Ravi Kumar", UnitSpocMobileNo = "9876543210", UnitSpocEmailId = "ravi@unit.in" }], [], [])
                : FakeSql.Sets([], [], []);
        _host.Sql.Queries["SELECT TOP 1 CreatedDate FROM AgencyAllotmentHistory"] = _ => [new { CreatedDate = new DateTime(2026, 11, 16) }];

        var a = (await (await As("AGENCYSV")).GetFromJsonAsync<JsonElement>(silver)).GetProperty("allotment");
        Assert.Equal("site", a.GetProperty("kind").GetString());
        Assert.Equal(preview, a.GetProperty("preview").GetBoolean());
        Assert.Equal(siteAssessor is null ? "pending" : "allotted", a.GetProperty("stage").GetString());
        Assert.Equal("16 Nov 2026", a.GetProperty("allottedOn").GetString());
        Assert.True(a.GetProperty("canAllot").GetBoolean());
        Assert.Equal(canReject, a.GetProperty("canReject").GetBoolean());
        Assert.Equal("9876543210", a.GetProperty("mobile").GetString());
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_ASSESSMENT_ALLOT_LIST" && FakeSql.Arg(c.Args, "AllotmentType") == "DA");
    }

    [Fact]
    public async Task The_desktop_preview_says_desktop()
    {
        var a = (await (await As("AGENCY1")).GetFromJsonAsync<JsonElement>(Base)).GetProperty("allotment");
        Assert.Equal("desktop", a.GetProperty("kind").GetString());
        Assert.True(a.GetProperty("preview").GetBoolean());
    }

    [Fact]
    public async Task Agency_cannot_validate_an_evidence_it_previews()
    {
        var client = await As("AGENCY1");
        using var form = new MultipartFormDataContent { { new StringContent("Yes"), "IsVerified" }, { new StringContent("x"), "Remarks" } };
        var r = await client.PostAsync(Base + "/evidences/31/validate", form);
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.StartsWith("SP_ASSESSMENT_DA_UPDATE"));
    }

    [Fact]
    public async Task Agency_review_actions_are_refused_before_the_assessment()
    {
        var client = await As("AGENCY1");
        var r = await client.PostAsJsonAsync($"/api/staff/monitoring/review/{Zed}/Bronze/remarks", new { kind = "requirement", id = 11, remarks = "x" });
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }
}
