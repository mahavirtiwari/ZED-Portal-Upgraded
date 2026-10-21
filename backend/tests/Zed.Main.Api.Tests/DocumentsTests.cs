using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using SkiaSharp;
using Zed.Core.Data;
using Zed.Portal.Features.Documents;

namespace Zed.Main.Api.Tests;

/// <summary>Fake users, certification records and procedures for the document tests.</summary>
internal static class DocumentsTestData
{
    public const string Me = "ZEDMSME000001";
    public const string Other = "ZEDMSME000002";
    public const string MyRejected = "ZEDMSME000001_D_45";

    // UserId → (RoleId, Desktop, Site)
    public static readonly Dictionary<string, (int Role, int Da, int Sa)> Users = new(StringComparer.OrdinalIgnoreCase)
    {
        [Me] = (5, 0, 0),
        [Other] = (5, 0, 0),
        ["ADMIN1"] = (7, 1, 1),
        ["AGENCY1"] = (2, 1, 1),
        ["AGENCY2"] = (2, 1, 1),
        ["ASSESSORDA"] = (3, 1, 0),
        ["QC1"] = (17, 0, 0),
        ["STATE1"] = (6, 0, 0),
    };

    public sealed record Record(string ZedId, string Certification, int Status, string? Agency = null, string? Desktop = null, string? Site = null);

    public static readonly List<Record> Records =
    [
        new(Me, "Bronze", 6, Desktop: "ASSESSORDA"),
        new(Me, "Silver", 16, Agency: "AGENCY1", Site: "ASSESSOR1"),
        new(Me, "Gold", 9, Agency: "AGENCY1"),
        new(MyRejected, "Bronze", 99, Desktop: "ASSESSORDA"),
        new(Other, "Bronze", 6, Agency: "AGENCY2", Desktop: "ASSESSORX"),
    ];

    public static void Register(TestHost host, Func<string, string, ResultSets>? report = null)
    {
        host.Sql.Procs["SP_GET_USER_DETAILS"] = args =>
            FakeSql.Arg(args, "UserId") is { } id && Users.TryGetValue(id, out var u)
                ? FakeSql.Sets([new { UserId = id, UserName = id + " name", RoleId = u.Role, Email = "x@y.test", MobileNo = "9999999999" }], [new { ERRORMSG = "SUCCESS" }])
                : FakeSql.Sets([], [new { ERRORMSG = "INVALID CREDENTIAILS" }]);
        host.Sql.Procs["SP_GET_SUB_ROLE"] = args =>
        {
            var u = Users[FakeSql.Arg(args, "UserId")!];
            return FakeSql.Sets([new { DesktopVerification = u.Da, SiteVerification = u.Sa, FinancialVerification = 0 }]);
        };
        host.Sql.Queries["SELECT TOP 1 ZedId, Certification, CertificationStatus"] = args =>
        {
            var zed = FakeSql.Arg(args, "ZedId");
            var cert = FakeSql.Arg(args, "Certification");
            return Records.Where(r => string.Equals(r.ZedId, zed, StringComparison.OrdinalIgnoreCase) && r.Certification == cert)
                .Select(r => (object)new
                {
                    r.ZedId, r.Certification, CertificationStatus = r.Status, NcCount = 0,
                    CertificationBodyUserId = r.Agency, DesktopAssessorId = r.Desktop, SiteAssessorId = r.Site,
                }).ToList();
        };
        host.Sql.Procs["SP_DA_GET_CERTIFICATE_DETAILS"] = args => CertificateDetails(FakeSql.Arg(args, "ZedId")!, FakeSql.Arg(args, "CertificationType")!, "DaCertificateNo");
        host.Sql.Procs["SP_RA_GET_CERTIFICATE_DETAILS"] = args => CertificateDetails(FakeSql.Arg(args, "ZedId")!, FakeSql.Arg(args, "CertificationType")!, "SaCertificateNo");
        host.Sql.Procs["SP_REPORT_GET_DETAILS"] = args => (report ?? ReportSets)(FakeSql.Arg(args, "ZedId")!, FakeSql.Arg(args, "Certification")!);
        host.Sql.Procs["SP_VERIFY_QR_CODE"] = args => FakeSql.Arg(args, "QrCodeNo") == "P12abcd" && FakeSql.Arg(args, "CertificationType") == "Bronze"
            ? FakeSql.Sets([new Dictionary<string, object?>
            {
                ["EnterpriseName"] = "ACME CASTINGS UNIT 1", ["CertificateNo"] = "21102026_1234", ["DateOfCertification"] = "October 21, 2026",
                ["DateOfExpiry"] = "October 21, 2029", ["Address"] = "Plot 4, Industrial Area, Kanpur, Uttar Pradesh-208001",
                ["UdyogAadharNo"] = "UDYAM-UP-29-0003915", ["MobileNo"] = "9999999999", ["EmailId"] = "owner@acme.test",
                ["CertificationPhase"] = "ACTIVE", ["FirstSurveDueDate"] = "January 14, 2028", ["Certification"] = "Bronze",
                ["SurveillanceCompletionDate"] = null, ["OldSurveillanceDate"] = null,
            }])
            : FakeSql.Sets([]);
    }

    public static ResultSets CertificateDetails(string zedId, string level, string numberColumn)
    {
        var r = Records.FirstOrDefault(x => x.ZedId == zedId && x.Certification == level);
        if (r is null) return FakeSql.Sets([]);
        var code = level switch { "Bronze" => "BC", "Silver" => "SC", _ => "GC" };
        return FakeSql.Sets([new Dictionary<string, object?>
        {
            ["EnterpriseName"] = "ACME PRECISION CASTINGS AND FORGINGS PRIVATE LIMITED UNIT 1",
            [numberColumn] = r.Status is 6 or 16 ? "21102026_1234" : null,
            ["DateOfCertification"] = "October 21, 2026",
            ["Address"] = "Plot No. 4, Sector 7, Industrial Area Phase II, Panki, Kanpur Nagar, Uttar Pradesh-208020",
            ["UdyogAadharNo"] = "UDYAM-UP-29-0003915", ["MobileNo"] = "9999999999", ["EmailId"] = "owner@acme.test",
            ["EstablishmentName"] = "Acme", ["NicCode"] = "24 - Manufacture of basic metals",
            ["AssessmentAgency"] = level == "Bronze" ? "" : "Quality Assessors Private Limited",
            ["QrCodeSeqNo"] = $"https://loginzed.msme.gov.in/Verify/{code}/P12abcd", ["PUnitName"] = "ACME UNIT 1",
        }]);
    }

    /// <summary>SP_REPORT_GET_DETAILS-shaped result sets (52 sets), with one NC round.</summary>
    public static ResultSets ReportSets(string zedId, string level)
    {
        if (!Records.Any(r => r.ZedId == zedId && r.Certification == level)) return FakeSql.Sets([]);
        var sets = Enumerable.Range(0, 52).Select(_ => (IEnumerable<object>)new List<object>()).ToArray();
        Dictionary<string, object?> Row(params (string K, object? V)[] values) => values.ToDictionary(v => v.K, v => v.V);
        sets[0] = [Row(("ZedId", zedId), ("Certification", level), ("PUnitName", "ACME PRECISION CASTINGS UNIT 1"), ("UdyogAadharNo", "UDYAM-UP-29-0003915"),
            ("EnterpriseTypee", "Micro"), ("PlantAddress", "Plot No. 4, Sector 7, Industrial Area Kanpur Nagar Uttar Pradesh-208020"),
            ("PDistrictName", "Kanpur Nagar"), ("PStateName", "Uttar Pradesh"), ("TwoDigitActivity", "24 - Manufacture of basic metals"),
            ("AuditsConducted", "Yes"), ("DomesticCustomers", "Tata Motors, Mahindra"), ("InternationalCustomers", "None"),
            ("RawMaterialImported", "Yes"), ("OutsourcedProcesses", "Heat treatment"), ("EnergySources", "Grid, Solar"),
            ("AssessmentDate", "October 21, 2026"), ("CertificationStatus", zedId.Contains("_D_") ? 99 : level == "Bronze" ? 6 : 16), ("PhotosPath", null))];
        sets[1] = [Row(("ZedId", zedId), ("Certification", level), ("ProductName", "Cast iron housings"), ("Exported", "No"), ("ProductPhoto", "p1.jpg"),
                ("ProductDescriptionPhoto", "d1.pdf"), ("IsVerified", "Yes"), ("AssessorRemarks", "Verified against invoices."), ("OldProductPhoto", "this.src=\"https://x/mobileapi/Photos/" + Other + "/Bronze/BasicInfo/p1.jpg\"")),
            Row(("ZedId", zedId), ("Certification", level), ("ProductName", "Brackets"), ("Exported", "Yes"), ("ProductPhoto", "missing.jpg"),
                ("ProductDescriptionPhoto", "p1.jpg"), ("IsVerified", "No"), ("AssessorRemarks", ""))];
        sets[2] = [Row(("RawMaterialName", "Pig iron"), ("Percentage", "20"), ("CountryName", "Australia"))];
        var sectionNames = new[] { "Leadership", "Swachh Workplace", "Occupational Safety", "Quality Management", "Delivery Management" };
        sets[3] = sectionNames.Select((n, i) => (object)Row(("SectionCode", (i + 1).ToString()), ("SectionName", n), ("OfiComments", "Document the review."),
            ("IsAssessmentExcempted", i == 4 ? "Yes" : "No"))).ToList();
        var reqs = new List<object>(); var opts = new List<object>(); var subs = new List<object>();
        for (var s = 1; s <= 5; s++)
            for (var r = 1; r <= 3; r++)
            {
                reqs.Add(Row(("SectionCode", s.ToString()), ("RequirementCode", r.ToString()), ("Conformance", r == 2 ? "No" : "Yes"),
                    ("AssessorRemarks", r == 2 ? "Records of the last three months were not available at the time of the assessment." : "")));
                opts.Add(Row(("SectionCode", s.ToString()), ("RequirementCode", r.ToString()), ("OptionCode", "1"),
                    ("OptionName", $"Requirement {s}.{r}: the unit has a documented process for this parameter, reviewed at planned intervals.")));
                subs.Add(Row(("SectionCode", s.ToString()), ("RequirementCode", r.ToString()), ("OptionCode", "1"), ("SubOptionName", "Records are maintained and reviewed by the management.")));
                subs.Add(Row(("SectionCode", s.ToString()), ("RequirementCode", r.ToString()), ("OptionCode", "1"), ("SubOptionName", "Responsibilities are assigned.")));
            }
        sets[4] = reqs; sets[5] = opts; sets[6] = subs;
        sets[8] = [Row(("ZedId", zedId), ("Certification", level), ("PhotoId", "1"), ("PhotoExtension", "jpg"), ("Photo", $"https://x/mobileapi/SaPhotos/{zedId}/{level}/Site Exterior Photo.jpg"), ("OldPath", "")),
            Row(("ZedId", zedId), ("Certification", level), ("PhotoId", "2"), ("PhotoExtension", "jpg"), ("Photo", $"https://x/mobileapi/SaPhotos/{Other}/{level}/Site Exterior Photo.jpg"), ("OldPath", ""))];
        sets[9] = [Row(("Latitude", "26.4499"), ("Longitude", "80.3319"))];
        // NC round 1
        sets[10] = [Row(("ZedId", zedId), ("Certification", level), ("ProductName", "Cast iron housings"), ("Exported", "No"), ("ProductPhoto", "p1.jpg"),
            ("ProductDescriptionPhoto", ""), ("IsVerified", "Yes"), ("AssessorRemarks", "Closed."))];
        sets[11] = [Row(("SectionCode", "1"), ("SectionName", "Leadership"))];
        sets[12] = [Row(("SectionCode", "1"), ("RequirementCode", "2"), ("Conformance", "Yes"), ("AssessorRemarks", "Records submitted."))];
        sets[13] = [Row(("SectionCode", "1"), ("RequirementCode", "2"), ("OptionCode", "1"), ("OptionName", "Requirement 1.2"))];
        return FakeSql.Sets(sets);
    }

    /// <summary>A JPEG photo in the mobile-app store under the storage root.</summary>
    public static void WritePhoto(string storageRoot, string relative, SKColor color, int width = 1600, int height = 1200)
    {
        var path = Path.Combine(storageRoot, relative.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        using var bitmap = new SKBitmap(width, height);
        using (var canvas = new SKCanvas(bitmap))
        {
            canvas.Clear(color);
            using var paint = new SKPaint { Color = SKColors.White, IsAntialias = true };
            canvas.DrawCircle(width / 2f, height / 2f, height / 4f, paint);
        }
        using var data = bitmap.Encode(SKEncodedImageFormat.Jpeg, 90);
        File.WriteAllBytes(path, data.ToArray());
    }

    public static async Task<HttpClient> SignInAsync(TestHost host, string userId)
    {
        var client = await host.CreateBrowserAsync();
        var url = Users[userId].Role == 5 ? "/api/msme/auth/login" : "/api/staff/auth/login";
        (await client.PostAsJsonAsync(url, new { userId, password = "Right#Pass1" })).EnsureSuccessStatusCode();
        return client;
    }
}

public sealed class DocumentsTests : IDisposable
{
    private const string Me = DocumentsTestData.Me;
    private const string Other = DocumentsTestData.Other;
    private readonly TestHost _host = new();

    public DocumentsTests()
    {
        DocumentsTestData.Register(_host);
        DocumentsTestData.WritePhoto(_host.StorageRoot, $"mobileapi/Photos/{Me}/Bronze/SiteExteriorPhotos/1.jpg", new SKColor(0x2E, 0x7D, 0x32));
        DocumentsTestData.WritePhoto(_host.StorageRoot, $"mobileapi/Photos/{Me}/Bronze/BasicInfo/p1.jpg", new SKColor(0x15, 0x65, 0xC0), 3000, 4000);
        DocumentsTestData.WritePhoto(_host.StorageRoot, $"mobileapi/Photos/{Other}/Bronze/BasicInfo/p1.jpg", SKColors.Red);
    }

    public void Dispose() => _host.Dispose();

    private Task<HttpClient> SignIn(string user) => DocumentsTestData.SignInAsync(_host, user);

    private IEnumerable<object?> CallsTo(string proc) => _host.Sql.Calls.Where(c => c.Name == proc).Select(c => c.Args);

    private string Stored(string relative) => Path.Combine(_host.StorageRoot, relative.Replace('/', Path.DirectorySeparatorChar));

    private static async Task<byte[]> Pdf(HttpResponseMessage r)
    {
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("application/pdf", r.Content.Headers.ContentType?.MediaType);
        Assert.Equal("inline", r.Content.Headers.ContentDisposition?.DispositionType);
        var bytes = await r.Content.ReadAsByteArrayAsync();
        Assert.StartsWith("%PDF", System.Text.Encoding.ASCII.GetString(bytes, 0, 4));
        return bytes;
    }

    // ----- access

    [Theory]
    [InlineData("/api/msme/certification-documents/Bronze/certificate")]
    [InlineData("/api/msme/certification-documents/Bronze/report")]
    [InlineData("/api/staff/certification-documents/ZEDMSME000001/Bronze/certificate")]
    [InlineData("/api/staff/certification-documents/ZEDMSME000001/Bronze/report")]
    [InlineData("/api/staff/certification-documents/ZEDMSME000001/pledge-certificate")]
    public async Task Downloads_require_sign_in(string url)
    {
        var client = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(url)).StatusCode);
        Assert.Empty(CallsTo("SP_DA_GET_CERTIFICATE_DETAILS"));
        Assert.Empty(CallsTo("SP_REPORT_GET_DETAILS"));
    }

    [Fact]
    public async Task Msme_cannot_use_staff_downloads_and_staff_cannot_use_msme_downloads()
    {
        var msme = await SignIn(Me);
        Assert.Equal(HttpStatusCode.Forbidden, (await msme.GetAsync($"/api/staff/certification-documents/{Me}/Bronze/certificate")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await msme.GetAsync($"/api/staff/certification-documents/{Me}/pledge-certificate")).StatusCode);

        var admin = await SignIn("ADMIN1");
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.GetAsync("/api/msme/certification-documents/Bronze/certificate")).StatusCode);

        var state = await SignIn("STATE1");
        Assert.Equal(HttpStatusCode.Forbidden, (await state.GetAsync($"/api/staff/certification-documents/{Me}/Bronze/report")).StatusCode);
        Assert.Empty(CallsTo("SP_REPORT_GET_DETAILS"));
    }

    // ----- MSME certificate

    [Fact]
    public async Task Missing_certificate_of_a_certified_record_is_drawn_saved_and_then_served_from_storage()
    {
        var client = await SignIn(Me);
        var first = await Pdf(await client.GetAsync("/api/msme/certification-documents/bronze/certificate?zedId=" + Other));

        var path = Stored($"Certificates/DA/{Me}/Bronze.pdf");
        Assert.True(File.Exists(path));
        Assert.Equal(first, await File.ReadAllBytesAsync(path));
        Assert.InRange(first.Length, 50_000, 700_000);
        Assert.Equal(Me, FakeSql.Arg(Assert.Single(CallsTo("SP_DA_GET_CERTIFICATE_DETAILS")), "ZedId"));
        var status = Assert.Single(CallsTo("SP_INSERT_CERTIFICATE_GENERATION_STATUS"));
        Assert.Equal("SUCCESS", FakeSql.Arg(status, "GenerateStatus"));
        Assert.False(Directory.Exists(Stored($"Certificates/DA/{Other}")));

        // Second download: the stored file, no new drawing.
        Assert.Equal(first, await Pdf(await client.GetAsync("/api/msme/certification-documents/Bronze/certificate")));
        Assert.Single(CallsTo("SP_DA_GET_CERTIFICATE_DETAILS"));
    }

    [Fact]
    public async Task Stored_certificate_in_the_older_certifications_folder_is_served()
    {
        var path = Stored($"Certifications/SA/{Me}/Silver.pdf");
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await File.WriteAllTextAsync(path, "%PDF-1.4 stored silver");

        var client = await SignIn(Me);
        var bytes = await Pdf(await client.GetAsync("/api/msme/certification-documents/Silver/certificate"));
        Assert.Equal("%PDF-1.4 stored silver", System.Text.Encoding.ASCII.GetString(bytes));
        Assert.Empty(CallsTo("SP_RA_GET_CERTIFICATE_DETAILS"));
    }

    [Fact]
    public async Task Uncertified_level_has_no_certificate_or_report()
    {
        var client = await SignIn(Me);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/msme/certification-documents/Gold/certificate")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/msme/certification-documents/Gold/report")).StatusCode);
        Assert.Empty(CallsTo("SP_RA_GET_CERTIFICATE_DETAILS"));
        Assert.Empty(CallsTo("SP_REPORT_GET_DETAILS"));
    }

    [Theory]
    [InlineData("/api/msme/certification-documents/Platinum/certificate")]
    [InlineData("/api/msme/certification-documents/SilverMilestone1/report")]
    [InlineData("/api/msme/certification-documents/BronzeSurveillance/report")]
    public async Task Unknown_certifications_are_refused(string url)
    {
        var client = await SignIn(Me);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync(url)).StatusCode);
    }

    [Fact]
    public async Task Surveillance_certificate_is_served_only_when_stored()
    {
        var client = await SignIn(Me);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/msme/certification-documents/SilverSurveillance/certificate")).StatusCode);

        var path = Stored($"Surveillance/Certificates/SA/{Me}/Silver.pdf");
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await File.WriteAllTextAsync(path, "%PDF-1.4 surveillance");
        await Pdf(await client.GetAsync("/api/msme/certification-documents/silversurveillance/certificate"));
        Assert.Empty(CallsTo("SP_RA_GET_CERTIFICATE_DETAILS"));
    }

    // ----- MSME report

    [Fact]
    public async Task Report_is_drawn_for_the_signed_in_msme_and_saved_at_the_legacy_path()
    {
        var client = await SignIn(Me);
        var bytes = await Pdf(await client.GetAsync("/api/msme/certification-documents/Bronze/report?zedId=" + Other));

        var call = Assert.Single(CallsTo("SP_REPORT_GET_DETAILS"));
        Assert.Equal(Me, FakeSql.Arg(call, "ZedId"));
        Assert.Equal("Bronze", FakeSql.Arg(call, "Certification"));
        Assert.Equal(bytes, await File.ReadAllBytesAsync(Stored($"PDFs/SA/{Me}/Bronze_Report.pdf")));
        Assert.InRange(bytes.Length, 100_000, 2_000_000);
    }

    [Fact]
    public async Task Rejected_report_of_the_own_record_is_available_but_not_another_msmes()
    {
        var client = await SignIn(Me);
        await Pdf(await client.GetAsync($"/api/msme/certification-documents/Bronze/report?record={DocumentsTestData.MyRejected}"));
        Assert.Equal(DocumentsTestData.MyRejected, FakeSql.Arg(Assert.Single(CallsTo("SP_REPORT_GET_DETAILS")), "ZedId"));

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/msme/certification-documents/Bronze/report?record={Other}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/msme/certification-documents/Bronze/report?record={Other}_D_45")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/msme/certification-documents/Bronze/report?record=..%2F..%2Fx")).StatusCode);
        Assert.Single(CallsTo("SP_REPORT_GET_DETAILS"));
    }

    // ----- staff

    [Fact]
    public async Task Master_admin_downloads_any_certificate_report_and_pledge()
    {
        var pledge = Stored($"Certifications/{Other}/Pledge.pdf");
        Directory.CreateDirectory(Path.GetDirectoryName(pledge)!);
        await File.WriteAllTextAsync(pledge, "%PDF-1.4 pledge");

        var client = await SignIn("ADMIN1");
        await Pdf(await client.GetAsync($"/api/staff/certification-documents/{Other}/Bronze/certificate"));
        await Pdf(await client.GetAsync($"/api/staff/certification-documents/{Other}/Bronze/report"));
        await Pdf(await client.GetAsync($"/api/staff/certification-documents/{Other}/pledge-certificate"));
        await Pdf(await client.GetAsync($"/api/staff/certification-documents/{DocumentsTestData.MyRejected}/Bronze/report"));
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/staff/certification-documents/{DocumentsTestData.MyRejected}/Bronze/certificate")).StatusCode);
    }

    [Fact]
    public async Task Agencies_and_assessors_see_only_their_allotted_records()
    {
        var agency = await SignIn("AGENCY1");
        await Pdf(await agency.GetAsync($"/api/staff/certification-documents/{Me}/Silver/report"));
        Assert.Equal(HttpStatusCode.NotFound, (await agency.GetAsync($"/api/staff/certification-documents/{Other}/Bronze/certificate")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await agency.GetAsync($"/api/staff/certification-documents/{Other}/Bronze/report")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await agency.GetAsync($"/api/staff/certification-documents/{Other}/pledge-certificate")).StatusCode);

        var assessor = await SignIn("ASSESSORDA");
        await Pdf(await assessor.GetAsync($"/api/staff/certification-documents/{Me}/Bronze/certificate"));
        Assert.Equal(HttpStatusCode.NotFound, (await assessor.GetAsync($"/api/staff/certification-documents/{Me}/Silver/certificate")).StatusCode);

        Assert.DoesNotContain(CallsTo("SP_REPORT_GET_DETAILS"), a => FakeSql.Arg(a, "ZedId") == Other);
        Assert.DoesNotContain(CallsTo("SP_DA_GET_CERTIFICATE_DETAILS"), a => FakeSql.Arg(a, "ZedId") == Other);
    }

    [Theory]
    [InlineData("/api/staff/certification-documents/ZED..MSME/Bronze/certificate")]
    [InlineData("/api/staff/certification-documents/ZEDMSME000001/Diamond/report")]
    [InlineData("/api/staff/certification-documents/ZEDMSME000001_D_45/pledge-certificate")]
    public async Task Staff_downloads_check_their_input(string url)
    {
        var client = await SignIn("ADMIN1");
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync(url)).StatusCode);
    }

    // ----- service

    [Fact]
    public async Task Issuing_needs_a_certificate_number_and_valid_input()
    {
        using var scope = _host.Services.CreateScope();
        var docs = scope.ServiceProvider.GetRequiredService<IAssessmentDocuments>();
        await Assert.ThrowsAsync<DocumentNotAvailableException>(() => docs.IssueCertificateAsync(Me, "Gold", default));
        await Assert.ThrowsAsync<DocumentNotAvailableException>(() => docs.IssueCertificateAsync("ZEDMSME999999", "Bronze", default));
        await Assert.ThrowsAsync<ArgumentException>(() => docs.IssueCertificateAsync("../x", "Bronze", default));
        await Assert.ThrowsAsync<ArgumentException>(() => docs.IssueCertificateAsync(Me, "BronzeSurveillance", default));

        var file = await docs.IssueCertificateAsync(Me, "Silver", default);
        Assert.Equal($"Certificates/SA/{Me}/Silver.pdf", file.RelativePath);
        Assert.True(File.Exists(Stored(file.RelativePath)));
        var report = await docs.RenderReportAsync(Me, "Silver", default);
        Assert.Equal($"PDFs/SA/{Me}/Silver_Report.pdf", report.RelativePath);
    }

    [Fact]
    public void Report_photos_come_only_from_the_records_own_folders()
    {
        using var photos = new ReportPhotos(_host.StorageRoot, DocumentsTestData.MyRejected);
        Assert.NotNull(photos.Load($"https://loginzed.msme.gov.in/mobileapi/CertifiedPhotos/{Me}/Bronze/BasicInfo/p1.jpg"));
        Assert.NotNull(photos.Load($"this.src=\"https://x/mobileapi/Photos/{Me}/Bronze/BasicInfo/p1.jpg\""));
        Assert.Null(photos.Load($"mobileapi/Photos/{Other}/Bronze/BasicInfo/p1.jpg"));
        Assert.Null(photos.Load($"mobileapi/Photos/{Me}/../{Other}/Bronze/BasicInfo/p1.jpg"));
        Assert.Null(photos.Load($"Certificates/{Me}/Pledge.pdf"));
        var big = photos.Load($"mobileapi/Photos/{Me}/Bronze/BasicInfo/p1.jpg")!;
        Assert.True(Math.Max(big.Width, big.Height) <= 900);
    }

    // ----- regeneration

    [Fact]
    public async Task Regeneration_is_for_master_admins_and_draws_only_missing_certificates()
    {
        _host.Sql.Procs["SP_GET_RE_GENERATE_CERTIFICATE_LIST"] = _ => FakeSql.Sets(
            [new { ZedId = Me, Certification = "Bronze" }, new { ZedId = Other, Certification = "Bronze" }, new { ZedId = "../x", Certification = "Bronze" }]);
        var existing = Stored($"Certificates/DA/{Other}/Bronze.pdf");
        Directory.CreateDirectory(Path.GetDirectoryName(existing)!);
        await File.WriteAllTextAsync(existing, "%PDF-1.4 existing");

        var anonymous = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.PostAsync("/api/staff/certification-documents/regenerate", null)).StatusCode);
        var agency = await SignIn("AGENCY1");
        Assert.Equal(HttpStatusCode.Forbidden, (await agency.PostAsync("/api/staff/certification-documents/regenerate", null)).StatusCode);
        Assert.Empty(CallsTo("SP_GET_RE_GENERATE_CERTIFICATE_LIST"));

        var admin = await SignIn("ADMIN1");
        var res = await admin.PostAsync("/api/staff/certification-documents/regenerate", null);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var json = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal([$"{Me}_Bronze"], json.GetProperty("generated").EnumerateArray().Select(e => e.GetString()));
        Assert.Equal("7", FakeSql.Arg(Assert.Single(CallsTo("SP_GET_RE_GENERATE_CERTIFICATE_LIST")), "RoleId"));
        Assert.True(File.Exists(Stored($"Certificates/DA/{Me}/Bronze.pdf")));
        Assert.Equal("%PDF-1.4 existing", await File.ReadAllTextAsync(existing));
    }

    // ----- verification

    [Fact]
    public async Task Verification_is_public_and_returns_only_the_shown_fields()
    {
        var client = await _host.CreateBrowserAsync();
        var res = await client.GetAsync("/api/verify/BC/P12abcd");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var json = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Bronze", json.GetProperty("certification").GetString());
        var details = json.GetProperty("details");
        Assert.Equal("ACME CASTINGS UNIT 1", details.GetProperty("EnterpriseName").GetString());
        Assert.Equal("October 21, 2029", details.GetProperty("DateOfExpiry").GetString());
        Assert.False(details.TryGetProperty("MobileNo", out _));
        Assert.False(details.TryGetProperty("EmailId", out _));

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/verify/gc/P12abcd")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/verify/xc/P12abcd")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/verify/bc/P12'--")).StatusCode);
        Assert.Equal(2, CallsTo("SP_VERIFY_QR_CODE").Count());
    }

    // ----- visual samples (only when ZED_DOC_SAMPLES names a folder)

    [Fact]
    public async Task Writes_sample_documents_for_visual_checks()
    {
        var folder = Environment.GetEnvironmentVariable("ZED_DOC_SAMPLES");
        if (string.IsNullOrEmpty(folder)) return;
        Directory.CreateDirectory(folder);
        using var scope = _host.Services.CreateScope();
        var docs = scope.ServiceProvider.GetRequiredService<IAssessmentDocuments>();
        foreach (var level in new[] { "Bronze", "Silver" })
        {
            var cert = await docs.IssueCertificateAsync(Me, level, default);
            await File.WriteAllBytesAsync(Path.Combine(folder, $"{level}.pdf"), cert.Content);
            var report = await docs.RenderReportAsync(Me, level, default);
            await File.WriteAllBytesAsync(Path.Combine(folder, $"{level}_Report.pdf"), report.Content);
        }
        var rejected = await docs.RenderReportAsync(DocumentsTestData.MyRejected, "Bronze", default);
        await File.WriteAllBytesAsync(Path.Combine(folder, "Rejected_Report.pdf"), rejected.Content);
    }
}

public sealed class DocumentsFontSubsetTests
{
    [Fact]
    public void Subset_font_keeps_the_glyphs_and_widths_of_the_used_characters()
    {
        using var full = SKTypeface.FromFamilyName("Arial", SKFontStyle.Bold);
        const string text = "ACME Castings – Plot 4, Kanpur ₹ 1,000 • “ZED”";
        using var subset = Zed.Core.Documents.FontSubsetter.Subset(full, text);
        if (ReferenceEquals(subset, full)) return; // no TrueType Arial on this machine: nothing to check

        using var a = new SKFont(full, 12);
        using var b = new SKFont(subset, 12);
        Assert.Equal(a.MeasureText(text), b.MeasureText(text), 3);
        Assert.DoesNotContain((ushort)0, b.GetGlyphs(text));
        Assert.Equal(0, b.GetGlyphs("\u0915")[0]); // not in the subset

        static long PdfSize(SKTypeface typeface, string value)
        {
            using var ms = new MemoryStream();
            using (var doc = SKDocument.CreatePdf(ms))
            {
                var canvas = doc.BeginPage(595, 842);
                using var font = new SKFont(typeface, 12);
                using var paint = new SKPaint { Color = SKColors.Black };
                canvas.DrawText(value, 50, 50, SKTextAlign.Left, font, paint);
                doc.EndPage();
                doc.Close();
            }
            return ms.Length;
        }
        Assert.True(PdfSize(subset, text) < 60_000, "subset PDF too large");
        Assert.True(PdfSize(subset, text) * 5 < PdfSize(full, text));
    }

    [Fact]
    public void Non_truetype_data_is_left_alone()
    {
        Assert.Null(Zed.Core.Documents.FontSubsetter.SubsetTrueType([0x4F, 0x54, 0x54, 0x4F, 0, 0, 0, 0, 0, 0, 0, 0], "abc"));
        Assert.Null(Zed.Core.Documents.FontSubsetter.SubsetTrueType([0, 1, 0, 0, 0, 9], "abc"));
    }
}
