using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Zed.Core.Data;
using Zed.Main.Api.Tests;
using Zed.Portal.Features.Documents;

namespace Zed.Consultancy.Api.Tests;

/// <summary>Handholding milestone reports on the consultancy host (ZED_CONSULTANT SP_REPORT_GET_DETAILS @NcCount).</summary>
public sealed class DocumentsConsultancyTests : IDisposable
{
    private const string Me = "ZEDMSME000001";
    private readonly TestHost _host = new();
    private int _nc = 2;
    private int _status = 16;

    private static readonly Dictionary<string, int> Users = new(StringComparer.OrdinalIgnoreCase)
    {
        ["ADMIN1"] = 7, ["CO1"] = 2, ["CO2"] = 2, ["ZEDCC0001"] = 3,
    };

    private static Dictionary<string, object?> Row(params (string K, object? V)[] values) =>
        values.ToDictionary(v => v.K, v => v.V, StringComparer.OrdinalIgnoreCase);

    public DocumentsConsultancyTests()
    {
        var sql = _host.Sql;
        sql.Procs["SP_GET_USER_DETAILS"] = args =>
            FakeSql.Arg(args, "UserId") is { } id && Users.TryGetValue(id, out var role)
                ? FakeSql.Sets([new { UserId = id, UserName = id + " name", RoleId = role, Email = "x@y.test", MobileNo = "9999999999" }], [new { ERRORMSG = "SUCCESS" }])
                : FakeSql.Sets([], [new { ERRORMSG = "INVALID CREDENTIAILS" }]);
        sql.Procs["SP_GET_SUB_ROLE"] = _ => FakeSql.Sets([new { DesktopVerification = 0, SiteVerification = 1, FinancialVerification = 0 }]);
        sql.Queries["SELECT TOP 1 ZedId, Certification, CertificationStatus"] = args =>
            FakeSql.Arg(args, "ZedId") == Me && FakeSql.Arg(args, "Certification") == "Silver"
                ? [new { ZedId = Me, Certification = "Silver", CertificationStatus = _status, NcCount = _nc, CertificationBodyUserId = "CO1", SiteAssessorId = "ZEDCC0001" }]
                : [];
        sql.Procs["SP_REPORT_GET_DETAILS"] = args =>
            FakeSql.Arg(args, "ZedId") == Me && FakeSql.Arg(args, "Certification") == "Silver" &&
            (FakeSql.Arg(args, "NcCount") is not { } n || n == _nc.ToString(System.Globalization.CultureInfo.InvariantCulture))
                ? Sets()
                : FakeSql.Sets([]);
    }

    private ResultSets Sets()
    {
        var sets = Enumerable.Range(0, 17).Select(_ => (IEnumerable<object>)new List<object>()).ToArray();
        sets[0] = [Row(("ZedId", Me), ("Certification", "Silver"), ("PUnitName", "ACME UNIT 1"), ("CertificationStatus", _status), ("NcCount", _nc),
            ("BdsFromDate", "October 1, 2026"), ("LastestCertification", "Bronze"))];
        sets[3] = [Row(("SectionCode", "1"), ("SectionName", "Leadership"))];
        sets[4] = [Row(("Id", 5), ("SectionCode", "1"), ("RequirementCode", "1"), ("IsProposedActivityCompleted", "Yes"), ("ProgressReviewRemarks", "Done."))];
        sets[16] = [Row(("ReqType", "BaselineDiagnostic"), ("RequirementId", 5), ("BulletPoints", "No records."))];
        return FakeSql.Sets(sets);
    }

    public void Dispose() => _host.Dispose();

    private string Stored(string relative) => Path.Combine(_host.StorageRoot, relative.Replace('/', Path.DirectorySeparatorChar));

    private IEnumerable<object?> ReportCalls => _host.Sql.Calls.Where(c => c.Name == "SP_REPORT_GET_DETAILS").Select(c => c.Args);

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
    public async Task Milestone_report_is_drawn_with_the_milestone_under_the_legacy_name_and_stored_only_when_rejected()
    {
        using var scope = _host.Services.CreateScope();
        var docs = scope.ServiceProvider.GetRequiredService<IAssessmentDocuments>();
        var file = await docs.RenderReportAsync(Me, "SilverMilestone2", default);
        Assert.Equal($"Consultancy/PDFs/SA/{Me}/Silver_Report_PR1.pdf", file.RelativePath);
        // 2026-11-15: a completed milestone's report is a page; only the rejection's copy is stored.
        Assert.False(File.Exists(Stored(file.RelativePath)));
        Assert.Equal("2", FakeSql.Arg(Assert.Single(ReportCalls), "NcCount"));

        // A plain level takes the current milestone.
        Assert.Equal($"Consultancy/PDFs/SA/{Me}/Silver_Report_PR1.pdf", (await docs.RenderReportAsync(Me, "Silver", default)).RelativePath);
        Assert.Null(FakeSql.Arg(ReportCalls.Last(), "NcCount"));

        await Assert.ThrowsAsync<DocumentNotAvailableException>(() => docs.RenderReportAsync(Me, "SilverMilestone1", default));
        await Assert.ThrowsAsync<DocumentNotAvailableException>(() => docs.IssueCertificateAsync(Me, "SilverMilestone2", default));
        await Assert.ThrowsAsync<ArgumentException>(() => docs.RenderReportAsync(Me, "BronzeMilestone1", default));
        await Assert.ThrowsAsync<ArgumentException>(() => docs.RenderReportAsync("../x", "SilverMilestone1", default));
    }

    [Fact]
    public async Task Rejected_milestone_is_saved_as_the_reject_report()
    {
        _status = 99;
        using var scope = _host.Services.CreateScope();
        var file = await scope.ServiceProvider.GetRequiredService<IAssessmentDocuments>().RenderReportAsync(Me, "SilverMilestone2", default);
        Assert.Equal($"Consultancy/PDFs/SA/{Me}/Silver_Reject_Report.pdf", file.RelativePath);
        // The rejection archives the rows next: this file is then the report's only source.
        Assert.Equal(file.Content, await File.ReadAllBytesAsync(Stored(file.RelativePath)));
    }

    [Fact]
    public async Task Staff_report_needs_sign_in_and_the_record()
    {
        var anonymous = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync($"/api/staff/certification-documents/{Me}/Silver/report?milestone=2")).StatusCode);

        var co = await SignIn("CO1");
        await Pdf(await co.GetAsync($"/api/staff/certification-documents/{Me}/Silver/report?milestone=2"), "Silver_Report_PR1.pdf");
        Assert.False(File.Exists(Stored($"Consultancy/PDFs/SA/{Me}/Silver_Report_PR1.pdf")));
        await Pdf(await co.GetAsync($"/api/staff/certification-documents/{Me}/Silver/report"), "Silver_Report_PR1.pdf");
        Assert.Equal(HttpStatusCode.NotFound, (await co.GetAsync($"/api/staff/certification-documents/{Me}/Silver/report?milestone=1")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await co.GetAsync($"/api/staff/certification-documents/{Me}/Silver/report?milestone=3")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await co.GetAsync($"/api/staff/certification-documents/{Me}/Silver/report?milestone=4")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await co.GetAsync($"/api/staff/certification-documents/{Me}/Bronze/report?milestone=1")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await co.GetAsync($"/api/staff/certification-documents/{Me}/Silver/certificate")).StatusCode);

        var consultant = await SignIn("ZEDCC0001");
        await Pdf(await consultant.GetAsync($"/api/staff/certification-documents/{Me}/Silver/report?milestone=2"), "Silver_Report_PR1.pdf");
        var otherCo = await SignIn("CO2");
        Assert.Equal(HttpStatusCode.NotFound, (await otherCo.GetAsync($"/api/staff/certification-documents/{Me}/Silver/report?milestone=2")).StatusCode);
    }

    [Fact]
    public async Task Milestone_under_review_is_previewed_for_staff_but_not_stored()
    {
        _status = 15;
        var co = await SignIn("CO1");
        await Pdf(await co.GetAsync($"/api/staff/certification-documents/{Me}/Silver/report?milestone=2"), "Silver_Report_PR1.pdf");
        Assert.False(File.Exists(Stored($"Consultancy/PDFs/SA/{Me}/Silver_Report_PR1.pdf")));
        _status = 13;
        Assert.Equal(HttpStatusCode.NotFound, (await co.GetAsync($"/api/staff/certification-documents/{Me}/Silver/report?milestone=2")).StatusCode);
    }

    [Fact]
    public async Task Earlier_milestones_come_from_storage()
    {
        var stored = Stored($"Consultancy/PDFs/SA/{Me}/Silver_Report.pdf");
        Directory.CreateDirectory(Path.GetDirectoryName(stored)!);
        await File.WriteAllTextAsync(stored, "%PDF-1.4 milestone 1");
        var admin = await SignIn("ADMIN1");
        var bytes = await Pdf(await admin.GetAsync($"/api/staff/certification-documents/{Me}/Silver/report?milestone=1"), "Silver_Report.pdf");
        Assert.Equal("%PDF-1.4 milestone 1", System.Text.Encoding.ASCII.GetString(bytes));
        Assert.Empty(ReportCalls);
    }

    [Fact]
    public async Task Staff_open_the_milestone_report_page_a_draft_before_the_final_submit_and_an_earlier_stored_pdf()
    {
        var co = await SignIn("CO1");
        var page = await co.GetFromJsonAsync<JsonElement>($"/api/staff/certification-documents/{Me}/Silver/report/page?milestone=2");
        Assert.Equal("milestone", page.GetProperty("kind").GetString());
        Assert.False(page.GetProperty("draft").GetBoolean());
        Assert.Equal("Bronze", page.GetProperty("milestone").GetProperty("existing").GetString());
        Assert.Equal("PR1: October 1, 2026", page.GetProperty("milestone").GetProperty("dates").GetString());
        Assert.False(File.Exists(Stored($"Consultancy/PDFs/SA/{Me}/Silver_Report_PR1.pdf")));
        // The current milestone by default.
        Assert.Equal(2, (await co.GetFromJsonAsync<JsonElement>($"/api/staff/certification-documents/{Me}/Silver/report/page")).GetProperty("milestone").GetProperty("number").GetInt32());

        // Waiting for the CO's review: a DRAFT for staff.
        _status = 15;
        var draft = await co.GetFromJsonAsync<JsonElement>($"/api/staff/certification-documents/{Me}/Silver/report/page?milestone=2");
        Assert.True(draft.GetProperty("draft").GetBoolean());
        Assert.Equal("Under review", draft.GetProperty("milestone").GetProperty("steps")[1].GetProperty("status").GetString());

        // Milestone 1, stored as a PDF when it was completed: the page only links to it.
        var stored = Stored($"Consultancy/PDFs/SA/{Me}/Silver_Report.pdf");
        Directory.CreateDirectory(Path.GetDirectoryName(stored)!);
        await File.WriteAllTextAsync(stored, "%PDF-1.4 milestone 1");
        var first = await co.GetFromJsonAsync<JsonElement>($"/api/staff/certification-documents/{Me}/Silver/report/page?milestone=1");
        Assert.Equal($"/api/staff/certification-documents/{Me}/Silver/report?milestone=1", first.GetProperty("storedPdf").GetString());

        var otherCo = await SignIn("CO2");
        Assert.Equal(HttpStatusCode.NotFound, (await otherCo.GetAsync($"/api/staff/certification-documents/{Me}/Silver/report/page?milestone=2")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await co.GetAsync($"/api/staff/certification-documents/{Me}/Bronze/report/page?milestone=1")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await co.GetAsync($"/api/staff/certification-documents/{Me}/Silver/report/page?milestone=3")).StatusCode);
    }
}
