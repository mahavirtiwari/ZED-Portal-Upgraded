using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using SkiaSharp;
using Zed.Core.Data;
using Zed.Portal.Features.Documents;

namespace Zed.Main.Api.Tests;

/// <summary>Fake ZED_SURVEILLANCE and ZED_CONSULTANT data for the documents main serves from the other systems.</summary>
internal static class SystemDocumentsTestData
{
    public const string Me = DocumentsTestData.Me;

    private static Dictionary<string, object?> Row(params (string K, object? V)[] values) =>
        values.ToDictionary(v => v.K, v => v.V, StringComparer.OrdinalIgnoreCase);

    /// <summary>Records: (ZedId, Certification) → (Status, NcCount, Agency, Desktop, Site).</summary>
    public static void Records(FakeSql sql, params (string ZedId, string Level, int Status, int Nc, string? Agency, string? Desktop, string? Site)[] records) =>
        sql.Queries["SELECT TOP 1 ZedId, Certification, CertificationStatus"] = args =>
        {
            var zed = FakeSql.Arg(args, "ZedId");
            var cert = FakeSql.Arg(args, "Certification");
            return records.Where(r => string.Equals(r.ZedId, zed, StringComparison.OrdinalIgnoreCase) && r.Level == cert)
                .Select(r => (object)new
                {
                    r.ZedId, Certification = r.Level, CertificationStatus = r.Status, NcCount = r.Nc,
                    CertificationBodyUserId = r.Agency, DesktopAssessorId = r.Desktop, SiteAssessorId = r.Site,
                }).ToList();
        };

    /// <summary>ZED_SURVEILLANCE: the certificate procedures add DateOfSurveillance and SurveillanceNo; the report adds SurveillanceNo.</summary>
    public static void Surveillance(FakeSql sql)
    {
        Records(sql, (Me, "Bronze", 6, 0, null, "ASSESSORDA", null), (Me, "Silver", 16, 0, "AGENCY1", null, "ASSESSOR1"));
        sql.Procs["SP_DA_GET_CERTIFICATE_DETAILS"] = args => WithSurveillance(DocumentsTestData.CertificateDetails(FakeSql.Arg(args, "ZedId")!, FakeSql.Arg(args, "CertificationType")!, "DaCertificateNo"));
        sql.Procs["SP_RA_GET_CERTIFICATE_DETAILS"] = args => WithSurveillance(DocumentsTestData.CertificateDetails(FakeSql.Arg(args, "ZedId")!, FakeSql.Arg(args, "CertificationType")!, "SaCertificateNo"));
        sql.Procs["SP_REPORT_GET_DETAILS"] = args =>
        {
            var sets = DocumentsTestData.ReportSets(FakeSql.Arg(args, "ZedId")!, FakeSql.Arg(args, "Certification")!);
            foreach (var row in sets[0]) row["SurveillanceNo"] = 1;
            return sets;
        };
    }

    private static ResultSets WithSurveillance(ResultSets sets)
    {
        foreach (var row in sets[0])
        {
            row["DateOfSurveillance"] = "October 20, 2027";
            row["SurveillanceNo"] = 1;
        }
        return sets;
    }

    /// <summary>ZED_CONSULTANT: Silver handholding, current milestone <paramref name="nc"/> with <paramref name="status"/>.</summary>
    public static void Consultancy(FakeSql sql, int nc = 2, int status = 16)
    {
        Records(sql, (Me, "Silver", status, nc, "CO1", null, "ZEDCC0001"));
        sql.Procs["SP_REPORT_GET_DETAILS"] = args =>
            FakeSql.Arg(args, "ZedId") == Me && FakeSql.Arg(args, "Certification") == "Silver" &&
            (FakeSql.Arg(args, "NcCount") is not { } n || n == nc.ToString(System.Globalization.CultureInfo.InvariantCulture))
                ? MilestoneSets(Me, "Silver", nc, status)
                : FakeSql.Sets([]);
    }

    /// <summary>ZED_CONSULTANT SP_REPORT_GET_DETAILS-shaped result sets (17 sets).</summary>
    public static ResultSets MilestoneSets(string zedId, string level, int nc, int status)
    {
        var sets = Enumerable.Range(0, 17).Select(_ => (IEnumerable<object>)new List<object>()).ToArray();
        sets[0] = [Row(("ZedId", zedId), ("Certification", level), ("PUnitName", "ACME PRECISION CASTINGS UNIT 1"), ("UdyogAadharNo", "UDYAM-UP-29-0003915"),
            ("EnterpriseTypee", "Micro"), ("PlantAddress", "Plot No. 4, Sector 7, Industrial Area Kanpur Nagar Uttar Pradesh-208020"),
            ("PDistrictName", "Kanpur Nagar"), ("PStateName", "Uttar Pradesh"), ("TwoDigitActivity", "24 - Manufacture of basic metals"),
            ("CertificationStatus", status), ("NcCount", nc), ("BdsFromDate", "October 1, 2026"), ("HapFromDate", "October 9, 2026"),
            ("LastestCertification", "Bronze"))];
        var names = new[] { "Leadership", "Swachh Workplace", "Occupational Safety" };
        sets[3] = names.Select((n, i) => (object)Row(("SectionCode", (i + 1).ToString()), ("SectionName", n))).ToList();
        var reqs = new List<object>(); var opts = new List<object>(); var subs = new List<object>(); var bullets = new List<object>();
        var id = 100;
        for (var s = 1; s <= 3; s++)
            for (var r = 1; r <= 2; r++)
            {
                id++;
                reqs.Add(Row(("Id", id), ("SectionCode", s.ToString()), ("RequirementCode", r.ToString()), ("SaConformance", r == 1 ? "No" : "Yes"),
                    ("BaselineDate", "October 2, 2026"), ("HActionPlanDate", "October 9, 2026"), ("EstimatedTimeInDays", "30"),
                    ("Intervention", "A barcode based stores system removes the manual stock register."), ("InterventionDate", "October 9, 2026"),
                    ("IsProposedActivityCompleted", "Yes"), ("ProgressReviewRemarks", "The procedure is in use; two months of records were seen."),
                    ("ProgressReviewDate", "January 12, 2027"), ("IsProposedActivityCompleted2", "No"), ("ProgressReviewRemarks2", ""), ("ProgressReviewDate2", "")));
                opts.Add(Row(("SectionCode", s.ToString()), ("RequirementCode", r.ToString()), ("OptionCode", "1"),
                    ("OptionName", $"Requirement {s}.{r}: the unit has a documented process for this parameter, reviewed at planned intervals.")));
                subs.Add(Row(("SectionCode", s.ToString()), ("RequirementCode", r.ToString()), ("OptionCode", "1"), ("SubOptionName", "Records are maintained and reviewed.")));
                foreach (var type in new[] { "BaselineDiagnostic", "HandholdingActionPlan", "TechnologyIntervention" })
                    bullets.Add(Row(("ReqType", type), ("RequirementId", id), ("BulletPoints", $"{type} point for requirement {s}.{r}.")));
            }
        sets[4] = reqs; sets[5] = opts; sets[6] = subs; sets[16] = bullets;
        sets[8] = [Row(("ZedId", zedId), ("Certification", level), ("PhotoId", "7"), ("Name", "Site Exterior Photo"),
            ("Photo", $"https://loginzed.msme.gov.in/consultancymobileapi/SaPhotos/{zedId}/{level}/Site Exterior Photo_7.jpg"))];
        sets[9] = [Row(("Latitude", "26.4499"), ("Longitude", "80.3319"))];
        sets[10] = [Row(("Comments", "Opening meeting held with the proprietor and the production head; the scope of handholding was explained."))];
        sets[11] = [Row(("ParticipantName", "1. R K Sharma"), ("Designation", "Proprietor")), Row(("ParticipantName", "2. S Verma"), ("Designation", "Production Head"))];
        sets[12] = [Row(("Comments", "Closing meeting: findings shared and agreed."))];
        sets[13] = [Row(("ParticipantName", "1. R K Sharma"), ("Designation", "Proprietor"))];
        sets[14] = [Row(("PhotoPath", $"https://loginzed.msme.gov.in/consultancymobileapi/SaPhotos/{zedId}/{level}/Opening Meeting Photo_8.jpg"))];
        return FakeSql.Sets(sets);
    }

    public static void Photos(string storageRoot)
    {
        DocumentsTestData.WritePhoto(storageRoot, $"surveillancemobileapi/Photos/{Me}/Bronze/SiteExteriorPhotos/1.jpg", new SKColor(0x6A, 0x1B, 0x9A));
        DocumentsTestData.WritePhoto(storageRoot, $"consultancymobileapi/SaPhotos/{Me}/Silver/Site Exterior Photo_7.jpg", new SKColor(0x2E, 0x7D, 0x32));
        DocumentsTestData.WritePhoto(storageRoot, $"consultancymobileapi/SaPhotos/{Me}/Silver/Opening Meeting Photo_8.jpg", new SKColor(0x15, 0x65, 0xC0));
    }
}

/// <summary>
/// Surveillance and handholding documents served by main to the owning MSME through the read-only connections
/// (registered here as keyed fakes, as SystemDatabases looks them up).
/// </summary>
public sealed class DocumentsSystemsTests : IDisposable
{
    private const string Me = DocumentsTestData.Me;
    private readonly TestHost _host = new();
    private readonly FakeSql _surveillance = new();
    private readonly FakeSql _consultancy = new();
    private readonly WebApplicationFactory<Program> _factory;

    public DocumentsSystemsTests()
    {
        DocumentsTestData.Register(_host);
        SystemDocumentsTestData.Surveillance(_surveillance);
        SystemDocumentsTestData.Consultancy(_consultancy);
        SystemDocumentsTestData.Photos(_host.StorageRoot);
        _factory = _host.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.AddKeyedSingleton<ISqlExecutor>("Surveillance", _surveillance);
            s.AddKeyedSingleton<ISqlExecutor>("Consultancy", _consultancy);
        }));
    }

    public void Dispose()
    {
        _factory.Dispose();
        _host.Dispose();
    }

    private string Stored(string relative) => Path.Combine(_host.StorageRoot, relative.Replace('/', Path.DirectorySeparatorChar));

    private static IEnumerable<object?> CallsTo(FakeSql sql, string proc) => sql.Calls.Where(c => c.Name == proc).Select(c => c.Args);

    private async Task<HttpClient> SignIn(WebApplicationFactory<Program> factory, string user)
    {
        var client = factory.CreateDefaultClient(new CookieXsrfHandler());
        (await client.GetAsync("/api/auth/me")).EnsureSuccessStatusCode();
        var url = user == Me ? "/api/msme/auth/login" : "/api/staff/auth/login";
        (await client.PostAsJsonAsync(url, new { userId = user, password = "Right#Pass1" })).EnsureSuccessStatusCode();
        return client;
    }

    private static async Task<byte[]> Pdf(HttpResponseMessage r, string fileName)
    {
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("application/pdf", r.Content.Headers.ContentType?.MediaType);
        Assert.Equal(fileName, r.Content.Headers.ContentDisposition?.FileNameStar);
        var bytes = await r.Content.ReadAsByteArrayAsync();
        Assert.StartsWith("%PDF", System.Text.Encoding.ASCII.GetString(bytes, 0, 4));
        return bytes;
    }

    [Fact]
    public async Task Without_the_other_connections_the_documents_are_not_available()
    {
        var client = await DocumentsTestData.SignInAsync(_host, Me);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/msme/certification-documents/BronzeSurveillance/report")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/msme/certification-documents/BronzeSurveillance/certificate")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/msme/certification-documents/Silver/report?milestone=2")).StatusCode);
        Assert.Empty(CallsTo(_host.Sql, "SP_REPORT_GET_DETAILS"));
    }

    [Fact]
    public async Task Surveillance_report_is_drawn_from_ZED_SURVEILLANCE_for_the_signed_in_msme()
    {
        var client = await SignIn(_factory, Me);
        var bytes = await Pdf(await client.GetAsync("/api/msme/certification-documents/bronzesurveillance/report?zedId=" + DocumentsTestData.Other), "Bronze_Report.pdf");

        var call = Assert.Single(CallsTo(_surveillance, "SP_REPORT_GET_DETAILS"));
        Assert.Equal(Me, FakeSql.Arg(call, "ZedId"));
        Assert.Equal("Bronze", FakeSql.Arg(call, "Certification"));
        Assert.Empty(CallsTo(_host.Sql, "SP_REPORT_GET_DETAILS"));
        Assert.Equal(bytes, await File.ReadAllBytesAsync(Stored($"Surveillance/PDFs/SA/{Me}/Bronze_Report.pdf")));
        Assert.False(File.Exists(Stored($"PDFs/SA/{Me}/Bronze_Report.pdf")));
        Assert.InRange(bytes.Length, 100_000, 2_000_000);

        // Not certified in ZED_SURVEILLANCE, or another MSME's record.
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/msme/certification-documents/GoldSurveillance/report")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/msme/certification-documents/BronzeSurveillance/report?record={DocumentsTestData.Other}")).StatusCode);
        Assert.Single(CallsTo(_surveillance, "SP_REPORT_GET_DETAILS"));
    }

    [Fact]
    public async Task Missing_surveillance_certificate_is_drawn_from_ZED_SURVEILLANCE_and_stored_where_the_surveillance_host_keeps_it()
    {
        var client = await SignIn(_factory, Me);
        var first = await Pdf(await client.GetAsync("/api/msme/certification-documents/BronzeSurveillance/certificate"), "Bronze.pdf");
        Assert.Equal(first, await File.ReadAllBytesAsync(Stored($"Surveillance/Certificates/DA/{Me}/Bronze.pdf")));
        Assert.Single(CallsTo(_surveillance, "SP_DA_GET_CERTIFICATE_DETAILS"));
        Assert.DoesNotContain(_surveillance.Calls, c => c.Name == "SP_INSERT_CERTIFICATE_GENERATION_STATUS");
        Assert.Empty(CallsTo(_host.Sql, "SP_DA_GET_CERTIFICATE_DETAILS"));

        await Pdf(await client.GetAsync("/api/msme/certification-documents/BronzeSurveillance/certificate"), "Bronze.pdf");
        Assert.Single(CallsTo(_surveillance, "SP_DA_GET_CERTIFICATE_DETAILS"));
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/msme/certification-documents/GoldSurveillance/certificate")).StatusCode);
    }

    [Fact]
    public async Task Current_milestone_report_is_drawn_from_ZED_CONSULTANT_and_stored_under_its_legacy_name()
    {
        var client = await SignIn(_factory, Me);
        var bytes = await Pdf(await client.GetAsync("/api/msme/certification-documents/Silver/report?milestone=2"), "Silver_Report_PR1.pdf");

        var call = Assert.Single(CallsTo(_consultancy, "SP_REPORT_GET_DETAILS"));
        Assert.Equal("2", FakeSql.Arg(call, "NcCount"));
        Assert.Equal(Me, FakeSql.Arg(call, "ZedId"));
        Assert.Equal(bytes, await File.ReadAllBytesAsync(Stored($"Consultancy/PDFs/SA/{Me}/Silver_Report_PR1.pdf")));
        Assert.InRange(bytes.Length, 50_000, 2_000_000);

        // Milestone 1 is over: only its stored file. Milestone 3 has not started. Gold is not a handholding of this unit.
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/msme/certification-documents/Silver/report?milestone=1")).StatusCode);
        var stored = Stored($"Consultancy/PDFs/SA/{Me}/Silver_Report.pdf");
        await File.WriteAllTextAsync(stored, "%PDF-1.4 milestone 1");
        Assert.Equal("%PDF-1.4 milestone 1", System.Text.Encoding.ASCII.GetString(await Pdf(await client.GetAsync("/api/msme/certification-documents/Silver/report?milestone=1"), "Silver_Report.pdf")));
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/msme/certification-documents/Silver/report?milestone=3")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/msme/certification-documents/Gold/report?milestone=1")).StatusCode);
        Assert.Single(CallsTo(_consultancy, "SP_REPORT_GET_DETAILS"));
    }

    [Fact]
    public async Task Milestone_under_review_is_not_shown_to_the_msme()
    {
        SystemDocumentsTestData.Consultancy(_consultancy, nc: 2, status: 15);
        var client = await SignIn(_factory, Me);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/msme/certification-documents/Silver/report?milestone=2")).StatusCode);
        Assert.Empty(CallsTo(_consultancy, "SP_REPORT_GET_DETAILS"));
    }

    [Fact]
    public async Task Rejected_milestone_report_takes_the_reject_name()
    {
        SystemDocumentsTestData.Consultancy(_consultancy, nc: 1, status: 99);
        var client = await SignIn(_factory, Me);
        await Pdf(await client.GetAsync("/api/msme/certification-documents/Silver/report?milestone=1"), "Silver_Reject_Report.pdf");
        Assert.True(File.Exists(Stored($"Consultancy/PDFs/SA/{Me}/Silver_Reject_Report.pdf")));
    }

    [Fact]
    public async Task Read_only_executor_refuses_writes()
    {
        var ro = new ReadOnlySqlExecutor(_surveillance);
        await Assert.ThrowsAsync<InvalidOperationException>(() => ro.ExecuteProcAsync("SP_X"));
        await Assert.ThrowsAsync<InvalidOperationException>(() => ro.ExecuteSqlAsync("DELETE FROM X"));
        Assert.Empty(_surveillance.Calls);
    }

    [Theory]
    [InlineData("SilverMilestone2", true, "Silver", 2)]
    [InlineData("goldmilestone3", true, "Gold", 3)]
    [InlineData("BronzeMilestone1", false, "", 0)]
    [InlineData("SilverMilestone4", false, "", 0)]
    [InlineData("Silver", false, "", 0)]
    public void Milestone_names_are_parsed(string value, bool ok, string level, int milestone)
    {
        Assert.Equal(ok, DocumentLevels.TryMilestone(value, out var l, out var m));
        Assert.Equal(level, l);
        Assert.Equal(milestone, m);
    }

    [Fact]
    public void Legacy_file_names()
    {
        Assert.Equal($"Consultancy/PDFs/SA/{Me}/Gold_Report.pdf", DocumentLevels.MilestoneReportPath(Me, "Gold", 1, false));
        Assert.Equal($"Consultancy/PDFs/SA/{Me}/Gold_Report_PR2.pdf", DocumentLevels.MilestoneReportPath(Me, "Gold", 3, false));
        Assert.Equal($"Consultancy/PDFs/SA/{Me}/Gold_Reject_Report.pdf", DocumentLevels.MilestoneReportPath(Me, "Gold", 2, true));
        Assert.Equal($"Surveillance/PDFs/SA/{Me}/Gold_Report.pdf", DocumentLevels.SurveillanceReportPath(Me, "Gold"));
        Assert.Equal("Silver", DocumentLevels.SurveillanceLevel("silverSurveillance"));
        Assert.Null(DocumentLevels.SurveillanceLevel("Surveillance"));
    }

    [Fact]
    public void Report_photos_read_the_surveillance_desktop_stores_of_the_own_record_only()
    {
        using var photos = new ReportPhotos(_host.StorageRoot, Me);
        Assert.NotNull(photos.Load($"surveillancemobileapi/Photos/{Me}/Bronze/SiteExteriorPhotos/1.jpg"));
        Assert.NotNull(photos.Load($"https://x/surveillancemobileapi/CertifiedPhotos/{Me}/Bronze/SiteExteriorPhotos/1.jpg"));
        Assert.NotNull(photos.Load($"https://x/consultancy/consultancymobileapi/SaPhotos/{Me}/Silver/Site Exterior Photo_7.jpg"));
        Assert.Null(photos.Load($"surveillancemobileapi/Photos/{DocumentsTestData.Other}/Bronze/SiteExteriorPhotos/1.jpg"));
        Assert.Null(photos.Load($"surveillancemobileapi/Other/{Me}/Bronze/SiteExteriorPhotos/1.jpg"));
    }

    // ----- visual samples (only when ZED_DOC_SAMPLES names a folder)

    [Fact]
    public async Task Writes_sample_documents_for_visual_checks()
    {
        var folder = Environment.GetEnvironmentVariable("ZED_DOC_SAMPLES");
        if (string.IsNullOrEmpty(folder)) return;
        Directory.CreateDirectory(folder);
        using var scope = _factory.Services.CreateScope();
        var renderer = new DocumentRenderer(scope.ServiceProvider.GetRequiredService<Microsoft.AspNetCore.Hosting.IWebHostEnvironment>(),
            scope.ServiceProvider.GetRequiredService<Microsoft.Extensions.Options.IOptions<Zed.Core.Http.PortalOptions>>(),
            Microsoft.Extensions.Logging.Abstractions.NullLogger.Instance);
        foreach (var level in new[] { "Bronze", "Silver" })
        {
            var cert = await renderer.IssueSurveillanceCertificateAsync(_surveillance, Me, level, default);
            await File.WriteAllBytesAsync(Path.Combine(folder, $"Surveillance_{level}.pdf"), cert.Content);
            var report = await renderer.RenderSurveillanceReportAsync(_surveillance, Me, level, default);
            await File.WriteAllBytesAsync(Path.Combine(folder, $"Surveillance_{level}_Report.pdf"), report.Content);
        }
        // Gold: the surveillance artwork differs from main's.
        var silverRow = _surveillance.Procs["SP_RA_GET_CERTIFICATE_DETAILS"];
        _surveillance.Procs["SP_RA_GET_CERTIFICATE_DETAILS"] = _ => silverRow(new { ZedId = Me, CertificationType = "Silver" });
        var gold = await renderer.IssueSurveillanceCertificateAsync(_surveillance, Me, "Gold", default);
        await File.WriteAllBytesAsync(Path.Combine(folder, "Surveillance_Gold.pdf"), gold.Content);
        foreach (var nc in new[] { 1, 2, 3 })
        {
            SystemDocumentsTestData.Consultancy(_consultancy, nc, 16);
            var milestone = await renderer.RenderMilestoneReportAsync(_consultancy, Me, "Silver", nc, save: false, default);
            await File.WriteAllBytesAsync(Path.Combine(folder, $"Milestone{nc}_Report.pdf"), milestone.Content);
        }
    }

    /// <summary>Cookie jar and XSRF echo, like TestHost.CreateBrowserAsync, for the factory with the extra services.</summary>
    private sealed class CookieXsrfHandler : DelegatingHandler
    {
        private readonly System.Net.CookieContainer _cookies = new();

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var uri = request.RequestUri!;
            var header = _cookies.GetCookieHeader(uri);
            if (header.Length > 0) request.Headers.Add("Cookie", header);
            if (request.Method != HttpMethod.Get && _cookies.GetCookies(uri)["XSRF-TOKEN"] is { } xsrf)
                request.Headers.Add("X-XSRF-TOKEN", Uri.UnescapeDataString(xsrf.Value));
            var response = await base.SendAsync(request, ct);
            if (response.Headers.TryGetValues("Set-Cookie", out var setCookies))
                foreach (var c in setCookies) _cookies.SetCookies(uri, c);
            return response;
        }
    }
}
