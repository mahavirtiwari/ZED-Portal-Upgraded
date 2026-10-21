using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Portal.Features.Staff.Assessment;

namespace Zed.Main.Api.Tests.Staff;

public sealed class SiteReviewTests : IDisposable
{
    private const string Zed = "ZEDMSME000001";
    private const string Base = "/api/staff/site-review/ZEDMSME000001/Silver";
    private const string Host = "https://loginzed.msme.gov.in";
    private readonly TestHost _host = new();

    private object _record = Record(15, 1);

    private static object Record(int status, int nc) => new
    {
        ZedId = Zed, Certification = "Silver", CertificationStatus = status, NcCount = nc, NcStatus = 0,
        Nc1Status = 2, Nc2Status = 0, Nc3Status = 0, Nc4Status = 0, Nc5Status = 0,
        DesktopAssessorId = "ASSESSOR1", DesktopAccepted = true, DesktopReasonForRejection = (string?)null,
        CertificationBodyUserId = "AGENCYSV", SiteAssessorId = "ASSESSORSV", CoAssessorId = (string?)null, IsAutoReject = (bool?)null,
    };

    public SiteReviewTests()
    {
        DaTestUsers.Install(_host.Sql);
        _host.Sql.Queries[AssessmentRecords.CertificationSql] = args =>
            FakeSql.Arg(args, "ZedId") == Zed && FakeSql.Arg(args, "Certification") == "Silver" ? [_record] : [];

        _host.Sql.Procs["SP_ASSESSMENT_DA_DETAILS"] = args =>
        {
            if (FakeSql.Arg(args, "ZedId") != Zed) return FakeSql.Sets([]);
            var sets = new List<IEnumerable<object>>
            {
                new[] { new { ZedId = Zed, Certification = "Silver", PUnitName = "Unit 1", CertificationStatus = 15, NcCount = 1, PhotosPath = (string?)null,
                    AgencyName = "Agency SV", CertificationBodyUserId = "AGENCYSV", SiteAssessorId = "ASSESSORSV", SiteAssessorName = "Site One",
                    SaAssessorRemarks = "All good", ModeOfAssessment = "Onsite Assessment", Password = "Secret#1", UnitSpocMobileNo = "9999999999" } },
                new[] { new { Id = 21, ProductName = "Bolt", Exported = "No", ProductPhoto = "p1.jpg", ProductDescriptionPhoto = "d1.pdf", IsSaVerified = "Yes", SaAssessorRemarks = "ok" } },
                new[] { new { ModeOfAssessment = "SA", RawMaterialName = "Steel", Percentage = "10", CountryName = "X", Id = 1 } },
                new[] { new { Id = 41, SectionCode = "1", SectionName = "Leadership", IsAssessmentExcempted = "No", OfiComments = "ofi", AllotedAssessorId = "ASSESSORSV", AllotedAssessorName = "Site One", AssessorRank = "Lead Assessor" } },
                new[] { new { Id = 11, SectionCode = "1", RequirementCode = "2", RequirementId = "R12", SaConformance = "Yes", SaAssessorRemarks = "fine" } },
                Array.Empty<object>(), Array.Empty<object>(),
                new[] { new { Id = 31, SectionCode = "1", RequirementCode = "2", EvidenceId = 5551, EvidenceName = "Policy", SyncedDate = "May 01, 2024" } },
                new[] { new { Id = 61, PhotoId = "777", PhotoType = "SiteExteriorPhotos", IsVerified = "Yes", AssessorRemarks = "ok", Latitude = "28.6" } },
                new[] { new { Latitude = "28.6", Longitude = "77.2", SaLatitude = "28.7", SaLongitude = "77.3" } },
            };
            while (sets.Count < 23) sets.Add([]);
            sets.Add([new { ConsultantId = "ASSESSORSV", RowNumber = 1, TimeStamps = new DateTime(2026, 10, 1), LoginTime = "10:00:00", LogoutTime = "18:00:00", NoOfHours = 8, NoOfMinutes = 0,
                LoginPhotoId1 = "55", LoginPhotoId = $"{Host}/mobileapi/Attendance/{Zed}/Silver/55.jpg", LogoutPhotoId1 = (string?)null, LogoutPhotoId = $"{Host}/mobileapi/Attendance/{Zed}/Silver/.jpg" }]);
            sets.Add([new { ConsultantId = "ASSESSORSV", AssessorType = "Assessor" }]);
            return FakeSql.Sets([.. sets]);
        };

        _host.Sql.Procs["SP_ASSESSMENT_SA_DETAILS"] = args =>
        {
            if (FakeSql.Arg(args, "ZedId") != Zed || FakeSql.Arg(args, "RoleId") == "17") return FakeSql.Sets([]);
            return FakeSql.Sets(
                [new { Id = 1, name = "Site Exterior Photo", src = $"{Host}/mobileapi/SaPhotos/{Zed}/Silver/ext.jpg", Latitude = "1" }],
                [new { Id = 71, Comments = "Opening", MeetingType = "Open Meeting", Latitude = "1" }],
                [new { Name = "Owner", Designation = "MD", MobileNo = "9999999999" }],
                [], [],
                [new { Id = 2, src = $"{Host}/mobileapi/SaPhotos/{Zed}/Silver/open.jpg" }],
                [new { Id = 3, name = "Shop floor", src = $"{Host}/mobileapi/SaPhotos/{Zed}/Silver/SiteTour/9.jpg" },
                 new { Id = 4, name = "Foreign", src = $"{Host}/mobileapi/SaPhotos/ZEDMSME000002/Silver/SiteTour/9.jpg" }],
                [new { Id = 5, name = "Evidence", RequirementId = "R12", SectionCode = "1", RequirementCode = "2", Photo = $"{Host}/mobileapi/SaPhotos/{Zed}/Silver/SiteTour/10.jpg", src = $"{Host}/mobileapi/SaPhotos/{Zed}/Silver/SiteTour/10.jpg" }],
                [],
                [new { Id = 22, ProductName = "New nut", Exported = "Yes" }],
                [],
                [new { Id = 6, ProductId = 21, name = "Product", src = $"{Host}/mobileapi/SaPhotos/{Zed}/Silver/BasicInfo/6.jpg" }],
                [new { Id = 7, PhotoPath = $"{Host}/mobileapi/SaPhotos/{Zed}/Silver/ASSESSORSV.jpg", src = "javascript:alert(1)" }]);
        };

        _host.Sql.Procs["SP_ASSESSMENT_DA_DETAILS_NC"] = _ => FakeSql.Sets(
            [new { Id = 23, ProductName = "Bolt", NcCount = 1, ProductParentId = "21", SaProductPhoto = $"{Host}/mobileapi/SaPhotos/{Zed}/Silver/BasicInfo/n.jpg", SaProductDescriptionPhoto = "x.pdf", IsSaVerified = "No" }],
            [new { Id = 42, SectionCode = "1", SectionName = "Leadership" }],
            [new { Id = 12, SectionCode = "1", RequirementCode = "2", SaConformance = "No", MsmeComments = "Fixed" }],
            [], [],
            [new { Id = 32, SectionCode = "1", RequirementCode = "2", EvidenceId = 6661, EvidenceName = "Proof", NcCount = 1, SyncedDate = "May 02, 2024" }],
            [new { Id = 91, PhotoId = "888", PhotoType = "SiteExteriorPhotos", IsVerified = "Yes" }],
            [new { Id = 81, SaAssessorRemarks = "NC comments" }]);
    }

    public void Dispose() => _host.Dispose();

    private Task<HttpClient> As(string user) => DaTestUsers.SignInAsync(_host, user);

    // ------------------------------------------------------------------ access

    [Fact]
    public async Task Review_page_needs_a_signed_in_user()
    {
        var client = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(Base)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(Base + "/files/mobileapi/SaPhotos/ZEDMSME000001/Silver/ext.jpg")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/staff/site-review/site-verification")).StatusCode);
    }

    [Fact]
    public async Task Roles_without_the_page_are_forbidden()
    {
        var admin = await As("ADMIN1");
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.GetAsync(Base)).StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.StartsWith("SP_ASSESSMENT_"));
    }

    [Fact]
    public async Task Another_agency_cannot_open_the_record()
    {
        var other = await As("AGENCY2");
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync(Base)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync(Base + "/files/mobileapi/SaPhotos/ZEDMSME000001/Silver/ext.jpg")).StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_ASSESSMENT_SA_DETAILS");
    }

    [Fact]
    public async Task Bronze_has_no_site_assessment_page()
    {
        var client = await As("MADMIN");
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/staff/site-review/ZEDMSME000001/Bronze")).StatusCode);
    }

    [Fact]
    public async Task Procedures_get_the_user_from_the_cookie()
    {
        var client = await As("AGENCYSV");
        (await client.GetAsync(Base + "?userId=MADMIN&roleId=7")).EnsureSuccessStatusCode();
        var call = _host.Sql.Calls.Single(c => c.Name == "SP_ASSESSMENT_SA_DETAILS");
        Assert.Equal("AGENCYSV", FakeSql.Arg(call.Args, "UserId"));
        Assert.Equal("2", FakeSql.Arg(call.Args, "RoleId"));
        Assert.Equal("Silver", FakeSql.Arg(call.Args, "Certification"));
    }

    // ------------------------------------------------------------------ data

    [Fact]
    public async Task Review_page_returns_shown_columns_and_authorised_addresses()
    {
        var client = await As("AGENCYSV");
        var json = await client.GetFromJsonAsync<JsonElement>(Base);
        var prefix = Base + "/files/";

        var msme = json.GetProperty("msme");
        Assert.Equal("Agency SV", msme.GetProperty("AgencyName").GetString());
        Assert.Equal("All good", msme.GetProperty("SaAssessorRemarks").GetString());
        Assert.False(msme.TryGetProperty("Password", out _));
        Assert.False(msme.TryGetProperty("PhotosPath", out _));
        Assert.False(msme.TryGetProperty("UnitSpocMobileNo", out _));

        Assert.Equal(prefix + "mobileapi/Photos/ZEDMSME000001/Silver/SiteExteriorPhotos/777.jpg", json.GetProperty("daSiteExterior")[0].GetProperty("url").GetString());
        Assert.Equal(prefix + "mobileapi/SaPhotos/ZEDMSME000001/Silver/ext.jpg", json.GetProperty("saSiteExterior")[0].GetProperty("url").GetString());
        Assert.Equal(prefix + "mobileapi/SaPhotos/ZEDMSME000001/Silver/ASSESSORSV.jpg", json.GetProperty("saSelfies")[0].GetProperty("url").GetString());

        // A site tour photo of another MSME, and a script address, are not passed on.
        var tour = json.GetProperty("siteTour");
        Assert.Equal(prefix + "mobileapi/SaPhotos/ZEDMSME000001/Silver/SiteTour/9.jpg", tour[0].GetProperty("url").GetString());
        Assert.Equal(JsonValueKind.Null, tour[1].GetProperty("url").ValueKind);

        var products = json.GetProperty("products");
        Assert.Equal("da", products[0].GetProperty("source").GetString());
        Assert.Equal(prefix + "mobileapi/Photos/ZEDMSME000001/Silver/BasicInfo/p1.jpg", products[0].GetProperty("photoUrl").GetString());
        Assert.Equal("pdf", products[0].GetProperty("descriptionKind").GetString());
        Assert.Equal(prefix + "mobileapi/SaPhotos/ZEDMSME000001/Silver/BasicInfo/6.jpg", products[0].GetProperty("photos")[0].GetProperty("url").GetString());
        Assert.Equal("sa", products[1].GetProperty("source").GetString());

        var requirement = json.GetProperty("requirements")[0];
        Assert.Equal(prefix + "mobileapi/SaPhotos/ZEDMSME000001/Silver/SiteTour/10.jpg", requirement.GetProperty("Photos")[0].GetProperty("url").GetString());
        Assert.Equal(prefix + "mobileapi/Photos/ZEDMSME000001/Silver/Evidences/5551.pdf", json.GetProperty("evidences")[0].GetProperty("FileUrl").GetString());

        var open = json.GetProperty("openMeeting");
        Assert.Equal(71, open.GetProperty("id").GetInt64());
        Assert.Equal("Opening", open.GetProperty("comments").GetString());
        Assert.False(open.GetProperty("participants")[0].TryGetProperty("MobileNo", out _));
        Assert.Equal(JsonValueKind.Null, json.GetProperty("closeMeeting").ValueKind);

        var attendance = json.GetProperty("attendance")[0];
        Assert.Equal(prefix + "mobileapi/Attendance/ZEDMSME000001/Silver/55.jpg", attendance.GetProperty("LoginPhotoUrl").GetString());
        Assert.Equal(JsonValueKind.Null, attendance.GetProperty("LogoutPhotoUrl").ValueKind);

        var round = json.GetProperty("ncRounds")[0];
        Assert.Equal(1, round.GetProperty("ncCount").GetInt32());
        Assert.Equal(81, round.GetProperty("commentsId").GetInt64());
        Assert.Equal("NC comments", round.GetProperty("assessorComments").GetString());
        Assert.Equal(prefix + "mobileapi/Photos/ZEDMSME000001/Silver/SiteExteriorPhotos/888.jpg", round.GetProperty("photos")[0].GetProperty("url").GetString());
        Assert.Equal(prefix + "mobileapi/SaPhotos/ZEDMSME000001/Silver/BasicInfo/n.jpg", round.GetProperty("products")[0].GetProperty("photoUrl").GetString());
        Assert.Equal(prefix + "mobileapi/Photos/ZEDMSME000001/Silver/Evidences/6661.pdf", round.GetProperty("evidences")[0].GetProperty("FileUrl").GetString());

        var review = json.GetProperty("permissions").GetProperty("review");
        Assert.True(review.GetProperty("finalSubmit").GetBoolean());
        Assert.True(review.GetProperty("editRemarks").GetBoolean());
        Assert.False(json.GetProperty("permissions").GetProperty("assessorOnCurrentPortal").GetBoolean());
    }

    [Fact]
    public async Task Qc_sees_no_names_and_no_site_data()
    {
        var qc = await As("QC1");
        var json = await qc.GetFromJsonAsync<JsonElement>(Base);
        Assert.False(json.GetProperty("msme").TryGetProperty("AgencyName", out _));
        Assert.False(json.GetProperty("sections")[0].TryGetProperty("AllotedAssessorName", out _));
        Assert.Empty(json.GetProperty("siteTour").EnumerateArray());
        Assert.False(json.GetProperty("permissions").GetProperty("review").GetProperty("any").GetBoolean());
    }

    [Fact]
    public async Task Site_assessor_is_sent_to_the_current_portal_for_its_own_actions()
    {
        _record = Record(14, 1);
        var assessor = await As("ASSESSORSV");
        var json = await assessor.GetFromJsonAsync<JsonElement>(Base);
        Assert.True(json.GetProperty("permissions").GetProperty("assessorOnCurrentPortal").GetBoolean());
        Assert.False(json.GetProperty("permissions").GetProperty("review").GetProperty("any").GetBoolean());
    }

    [Fact]
    public async Task Master_admin_may_withdraw_exemptions_while_the_site_assessment_is_scheduled()
    {
        _record = Record(8, 0);
        var master = await As("MADMIN");
        var json = await master.GetFromJsonAsync<JsonElement>(Base);
        Assert.True(json.GetProperty("permissions").GetProperty("canWithdrawExemption").GetBoolean());
        Assert.Empty(json.GetProperty("ncRounds").EnumerateArray());
    }

    [Fact]
    public async Task Record_hidden_by_the_procedure_is_not_found()
    {
        _host.Sql.Procs["SP_ASSESSMENT_DA_DETAILS"] = _ => FakeSql.Sets([new { ZedId = "000" }]);
        var client = await As("AGENCYSV");
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(Base)).StatusCode);
    }

    // ------------------------------------------------------------------ files

    [Fact]
    public async Task Files_are_served_from_the_records_folders_only()
    {
        var file = Path.Combine(_host.StorageRoot, "mobileapi", "SaCertifiedPhotos", Zed, "Silver", "SiteTour", "9.jpg");
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        await File.WriteAllBytesAsync(file, [0xFF, 0xD8, 0xFF]);
        var foreign = Path.Combine(_host.StorageRoot, "mobileapi", "SaPhotos", "ZEDMSME000002", "Silver", "x.jpg");
        Directory.CreateDirectory(Path.GetDirectoryName(foreign)!);
        await File.WriteAllBytesAsync(foreign, [0xFF, 0xD8, 0xFF]);

        var client = await As("AGENCYSV");
        // Not moved yet in the procedure's address, moved on disk: the counterpart folder is tried.
        var r = await client.GetAsync(Base + "/files/mobileapi/SaPhotos/ZEDMSME000001/Silver/SiteTour/9.jpg");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("image/jpeg", r.Content.Headers.ContentType?.MediaType);

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(Base + "/files/mobileapi/SaPhotos/ZEDMSME000002/Silver/x.jpg")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(Base + "/files/mobileapi/SaPhotos/ZEDMSME000001/../ZEDMSME000002/Silver/x.jpg")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(Base + "/files/Web.config")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(Base + "/files/mobileapi/SaPhotos/ZEDMSME000001/Silver/missing.jpg")).StatusCode);
    }

    // ------------------------------------------------------------------ SA Verification list

    [Fact]
    public async Task Site_verification_lists_the_assessors_units_with_shown_columns()
    {
        _host.Sql.Procs["SP_ASSESSMENT_ALLOT_LIST"] = _ => FakeSql.Sets([new
        {
            ZedId = Zed, Certification = "Silver", CertificationBodyUserId = "AGENCYSV", EnterpriseName = "Acme", UnitAddress = "Plot 4", StateName = "Delhi",
            DesktopReasonForRejection = (string?)null, MobileNo = "9999999999", EmailId = "owner@x.test",
        }]);
        var assessor = await As("ASSESSORSV");
        var json = await assessor.GetFromJsonAsync<JsonElement>("/api/staff/site-review/site-verification?userId=OTHER");
        var call = _host.Sql.Calls.Single(c => c.Name == "SP_ASSESSMENT_ALLOT_LIST");
        Assert.Equal("ASSESSORSV", FakeSql.Arg(call.Args, "UserId"));
        Assert.Equal("3", FakeSql.Arg(call.Args, "RoleId"));
        Assert.Equal("SA", FakeSql.Arg(call.Args, "AllotmentType"));
        var row = json.GetProperty("rows")[0];
        Assert.Equal("Acme", row.GetProperty("EnterpriseName").GetString());
        Assert.False(row.TryGetProperty("MobileNo", out _));
        Assert.False(row.TryGetProperty("EmailId", out _));

        var agency = await As("AGENCYSV");
        Assert.Equal(HttpStatusCode.Forbidden, (await agency.GetAsync("/api/staff/site-review/site-verification")).StatusCode);
    }
}
