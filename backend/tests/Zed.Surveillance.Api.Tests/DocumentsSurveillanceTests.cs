using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Zed.Core.Data;
using Zed.Main.Api.Tests;
using Zed.Portal.Features.Documents;

namespace Zed.Surveillance.Api.Tests;

/// <summary>Surveillance certificates and reports on the surveillance host (ZED_SURVEILLANCE procedures, surveillance artwork).</summary>
public sealed class DocumentsSurveillanceTests : IDisposable
{
    private const string Me = "ZEDMSME000001";
    private const string Other = "ZEDMSME000002";
    private readonly TestHost _host = new();

    // UserId → RoleId
    private static readonly Dictionary<string, int> Users = new(StringComparer.OrdinalIgnoreCase)
    {
        ["ADMIN1"] = 7, ["AGENCY1"] = 2, ["AGENCY2"] = 2, ["ASSESSORDA"] = 3, ["STATE1"] = 6,
    };

    private static readonly (string ZedId, string Level, int Status, string? Agency, string? Desktop)[] Records =
    [
        (Me, "Bronze", 6, null, "ASSESSORDA"),
        (Me, "Gold", 16, "AGENCY1", null),
        (Other, "Silver", 9, "AGENCY2", null),
        (Other, "Gold", 15, "AGENCY2", null),
    ];

    private static Dictionary<string, object?> Row(params (string K, object? V)[] values) =>
        values.ToDictionary(v => v.K, v => v.V, StringComparer.OrdinalIgnoreCase);

    public DocumentsSurveillanceTests()
    {
        var sql = _host.Sql;
        sql.Procs["SP_GET_USER_DETAILS"] = args =>
            FakeSql.Arg(args, "UserId") is { } id && Users.TryGetValue(id, out var role)
                ? FakeSql.Sets([new { UserId = id, UserName = id + " name", RoleId = role, Email = "x@y.test", MobileNo = "9999999999" }], [new { ERRORMSG = "SUCCESS" }])
                : FakeSql.Sets([], [new { ERRORMSG = "INVALID CREDENTIAILS" }]);
        sql.Procs["SP_GET_SUB_ROLE"] = _ => FakeSql.Sets([new { DesktopVerification = 1, SiteVerification = 1, FinancialVerification = 0 }]);
        sql.Queries["SELECT TOP 1 ZedId, Certification, CertificationStatus"] = args =>
            Records.Where(r => r.ZedId == FakeSql.Arg(args, "ZedId") && r.Level == FakeSql.Arg(args, "Certification"))
                .Select(r => (object)new { r.ZedId, Certification = r.Level, CertificationStatus = r.Status, NcCount = 0, CertificationBodyUserId = r.Agency, DesktopAssessorId = r.Desktop })
                .ToList();
        sql.Procs["SP_DA_GET_CERTIFICATE_DETAILS"] = args => Certificate(FakeSql.Arg(args, "ZedId")!, FakeSql.Arg(args, "CertificationType")!, "DaCertificateNo");
        sql.Procs["SP_RA_GET_CERTIFICATE_DETAILS"] = args => Certificate(FakeSql.Arg(args, "ZedId")!, FakeSql.Arg(args, "CertificationType")!, "SaCertificateNo");
        sql.Procs["SP_REPORT_GET_DETAILS"] = args => Report(FakeSql.Arg(args, "ZedId")!, FakeSql.Arg(args, "Certification")!);
    }

    public void Dispose() => _host.Dispose();

    private static ResultSets Certificate(string zedId, string level, string numberColumn, string? number = "21102026_1234", bool anyRecord = false) =>
        anyRecord || Records.Any(r => r.ZedId == zedId && r.Level == level && r.Status is 6 or 16)
            ? FakeSql.Sets([Row(("EnterpriseName", "ACME PRECISION CASTINGS UNIT 1"), (numberColumn, number), ("DateOfCertification", "October 21, 2024"),
                ("Address", "Plot No. 4, Sector 7, Industrial Area, Kanpur Nagar, Uttar Pradesh-208020"), ("UdyogAadharNo", "UDYAM-UP-29-0003915"),
                ("NicCode", "24 - Manufacture of basic metals"), ("AssessmentAgency", level == "Bronze" ? "" : "Quality Assessors Private Limited"),
                ("QrCodeSeqNo", "https://loginzed.msme.gov.in/Verify/BC/P12abcd"), ("DateOfSurveillance", "October 20, 2025"), ("SurveillanceNo", 1))])
            : FakeSql.Sets([]);

    private static ResultSets Report(string zedId, string level)
    {
        if (!Records.Any(r => r.ZedId == zedId && r.Level == level)) return FakeSql.Sets([]);
        var sets = Enumerable.Range(0, 52).Select(_ => (IEnumerable<object>)new List<object>()).ToArray();
        sets[0] = [Row(("ZedId", zedId), ("Certification", level), ("PUnitName", "ACME UNIT 1"), ("PDistrictName", "Kanpur Nagar"), ("PStateName", "Uttar Pradesh"),
            ("AssessmentDate", "October 20, 2025"), ("CertificationStatus", 16), ("SurveillanceNo", 2))];
        sets[3] = [Row(("SectionCode", "1"), ("SectionName", "Leadership"), ("OfiComments", "Should not appear."))];
        sets[4] = [Row(("SectionCode", "1"), ("RequirementCode", "1"), ("Conformance", "Yes"))];
        sets[9] = [Row(("Latitude", "26.4"), ("Longitude", "80.3"))];
        return FakeSql.Sets(sets);
    }

    private string Stored(string relative) => Path.Combine(_host.StorageRoot, relative.Replace('/', Path.DirectorySeparatorChar));

    private async Task<HttpClient> SignIn(string user)
    {
        var client = await _host.CreateBrowserAsync();
        (await client.PostAsJsonAsync("/api/staff/auth/login", new { userId = user, password = "Right#Pass1" })).EnsureSuccessStatusCode();
        return client;
    }

    private static async Task<byte[]> Pdf(HttpResponseMessage r, string fileName)
    {
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("application/pdf", r.Content.Headers.ContentType?.MediaType);
        Assert.Equal(fileName, r.Content.Headers.ContentDisposition?.FileNameStar);
        return await r.Content.ReadAsByteArrayAsync();
    }

    [Fact]
    public async Task Issuing_draws_the_surveillance_certificate_at_mains_surveillance_path_without_the_generation_status()
    {
        using var scope = _host.Services.CreateScope();
        var docs = scope.ServiceProvider.GetRequiredService<IAssessmentDocuments>();
        var bronze = await docs.IssueCertificateAsync(Me, "Bronze", default);
        Assert.Equal($"Surveillance/Certificates/DA/{Me}/Bronze.pdf", bronze.RelativePath);
        Assert.Equal(bronze.Content, await File.ReadAllBytesAsync(Stored(bronze.RelativePath)));
        Assert.InRange(bronze.Content.Length, 50_000, 700_000);
        var gold = await docs.IssueCertificateAsync(Me, "GoldSurveillance", default);
        Assert.Equal($"Surveillance/Certificates/SA/{Me}/Gold.pdf", gold.RelativePath);
        Assert.False(File.Exists(Stored($"Certificates/DA/{Me}/Bronze.pdf")));
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_INSERT_CERTIFICATE_GENERATION_STATUS");

        await Assert.ThrowsAsync<DocumentNotAvailableException>(() => docs.IssueCertificateAsync(Other, "Silver", default));
        await Assert.ThrowsAsync<ArgumentException>(() => docs.IssueCertificateAsync("../x", "Bronze", default));

        var report = await docs.RenderReportAsync(Me, "Gold", default);
        Assert.Equal($"Surveillance/PDFs/SA/{Me}/Gold_Report.pdf", report.RelativePath);
    }

    /// <summary>The bundled surveillance artwork is embedded as it is (a slice of the JPEG is found in the PDF).</summary>
    private static bool Embeds(byte[] pdf, string artwork)
    {
        var jpg = File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "Assets", "Documents", artwork));
        return pdf.AsSpan().IndexOf(jpg.AsSpan(jpg.Length / 2, 4096)) >= 0;
    }

    /// <summary>
    /// 2026-11-15 (migration 0082): a round copies main's number by main's record into the round's own column, so a Bronze
    /// certified after a visit has its site number in the Bronze round's DaCertificateNo and a Silver certified at the desktop
    /// its desktop number in the Silver round's SaCertificateNo. The certificate reads the round's procedure and column
    /// (the round's other column is empty) and keeps the level's own surveillance artwork and folder.
    /// </summary>
    [Theory]
    [InlineData("Bronze", "SP_DA_GET_CERTIFICATE_DETAILS", "DaCertificateNo", "SP_RA_GET_CERTIFICATE_DETAILS", "SaCertificateNo", "16032025_000003", "DA", "Surveillance/DaBronze.jpg")]
    [InlineData("Silver", "SP_RA_GET_CERTIFICATE_DETAILS", "SaCertificateNo", "SP_DA_GET_CERTIFICATE_DETAILS", "DaCertificateNo", "13042025_000004", "SA", "SaSilver.jpg")]
    [InlineData("Gold", "SP_RA_GET_CERTIFICATE_DETAILS", "SaCertificateNo", "SP_DA_GET_CERTIFICATE_DETAILS", "DaCertificateNo", "13042025_000005", "SA", "Surveillance/SaGold.jpg")]
    public async Task A_round_shows_mains_number_of_either_route_on_the_levels_own_surveillance_artwork(
        string level, string roundProc, string roundColumn, string otherProc, string otherColumn, string mainNumber, string folder, string artwork)
    {
        _host.Sql.Procs[roundProc] = args => Certificate(FakeSql.Arg(args, "ZedId")!, level, roundColumn, mainNumber, anyRecord: true);
        _host.Sql.Procs[otherProc] = args => Certificate(FakeSql.Arg(args, "ZedId")!, level, otherColumn, null, anyRecord: true);
        using var scope = _host.Services.CreateScope();
        var docs = scope.ServiceProvider.GetRequiredService<IAssessmentDocuments>();

        var cert = await docs.IssueCertificateAsync(Me, level, default);

        Assert.Equal($"Surveillance/Certificates/{folder}/{Me}/{level}.pdf", cert.RelativePath);
        Assert.Equal(cert.RelativePath, DocumentLevels.SurveillanceCertificatePath(Me, level));
        Assert.Single(_host.Sql.Calls, c => c.Name == roundProc);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == otherProc);
        Assert.True(Embeds(cert.Content, artwork), $"{level}: {artwork}");
    }

    [Theory]
    [InlineData("/api/staff/certification-documents/ZEDMSME000001/Bronze/certificate")]
    [InlineData("/api/staff/certification-documents/ZEDMSME000001/Bronze/report")]
    public async Task Staff_downloads_are_served_here_and_need_sign_in(string url)
    {
        var client = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(url)).StatusCode);
    }

    [Fact]
    public async Task Staff_download_the_certificates_and_reports_they_may_see()
    {
        var admin = await SignIn("ADMIN1");
        await Pdf(await admin.GetAsync($"/api/staff/certification-documents/{Me}/Bronze/certificate"), "Bronze.pdf");
        Assert.True(File.Exists(Stored($"Surveillance/Certificates/DA/{Me}/Bronze.pdf")));
        await Pdf(await admin.GetAsync($"/api/staff/certification-documents/{Me}/Bronze/certificate"), "Bronze.pdf");
        Assert.Single(_host.Sql.Calls, c => c.Name == "SP_DA_GET_CERTIFICATE_DETAILS");
        await Pdf(await admin.GetAsync($"/api/staff/certification-documents/{Me}/GoldSurveillance/report"), "Gold_Report.pdf");
        // 2026-11-15: the report is a page; the PDF is drawn when asked for and not stored.
        Assert.False(File.Exists(Stored($"Surveillance/PDFs/SA/{Me}/Gold_Report.pdf")));
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync($"/api/staff/certification-documents/{Other}/Silver/report")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.GetAsync($"/api/staff/certification-documents/{Me}/Gold/report?milestone=1")).StatusCode);

        var agency = await SignIn("AGENCY1");
        await Pdf(await agency.GetAsync($"/api/staff/certification-documents/{Me}/Gold/certificate"), "Gold.pdf");
        Assert.Equal(HttpStatusCode.NotFound, (await agency.GetAsync($"/api/staff/certification-documents/{Me}/Bronze/report")).StatusCode);
        var other = await SignIn("AGENCY2");
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync($"/api/staff/certification-documents/{Me}/Gold/report")).StatusCode);

        var state = await SignIn("STATE1");
        Assert.Equal(HttpStatusCode.Forbidden, (await state.GetAsync($"/api/staff/certification-documents/{Me}/Gold/report")).StatusCode);
    }

    [Fact]
    public async Task Staff_open_the_surveillance_report_page_and_a_draft_before_the_final_submit()
    {
        var admin = await SignIn("ADMIN1");
        var page = await admin.GetFromJsonAsync<JsonElement>($"/api/staff/certification-documents/{Me}/GoldSurveillance/report/page");
        Assert.Equal("surveillance", page.GetProperty("kind").GetString());
        Assert.Equal("Surveillance Assessment Report", page.GetProperty("title").GetString());
        Assert.False(page.GetProperty("draft").GetBoolean());
        Assert.Equal("Surveillance 2 completed on October 20, 2025", page.GetProperty("result").GetProperty("heading").GetString());
        Assert.Equal("Certificate 21102026_1234", page.GetProperty("result").GetProperty("detail").GetString());
        Assert.Equal("Round 2", page.GetProperty("facts")[3].GetProperty("value").GetString());
        // No Opportunities for Improvement in surveillance; the QR code of main's certificate.
        Assert.Equal(JsonValueKind.Null, page.GetProperty("findings")[0].GetProperty("ofi").ValueKind);
        Assert.EndsWith("/Verify/GC/P12abcd", page.GetProperty("verify").GetProperty("url").GetString());
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_VERIFY_QR_CODE");
        Assert.False(File.Exists(Stored($"Surveillance/PDFs/SA/{Me}/Gold_Report.pdf")));

        // Silver of the other unit is at status 9: no report, not even a draft.
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync($"/api/staff/certification-documents/{Other}/Silver/report/page")).StatusCode);
        // Its Gold waits for review (status 15): a DRAFT for the staff who may see it.
        var draft = await admin.GetFromJsonAsync<JsonElement>($"/api/staff/certification-documents/{Other}/Gold/report/page");
        Assert.True(draft.GetProperty("draft").GetBoolean());
        Assert.Equal(JsonValueKind.Null, draft.GetProperty("verify").ValueKind);
        var agency = await SignIn("AGENCY1");
        Assert.Equal(HttpStatusCode.NotFound, (await agency.GetAsync($"/api/staff/certification-documents/{Other}/Gold/report/page")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.GetAsync($"/api/staff/certification-documents/{Me}/Gold/report/page?milestone=1")).StatusCode);
        var anonymous = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync($"/api/staff/certification-documents/{Me}/Gold/report/page")).StatusCode);
    }
}
