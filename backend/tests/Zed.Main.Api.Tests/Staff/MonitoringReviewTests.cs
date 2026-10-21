using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Zed.Portal.Features.Documents;
using Zed.Portal.Features.Staff.Assessment;
using Zed.Portal.Features.Staff.Monitoring;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>Stand-in for the certificate/report service (implemented by another feature).</summary>
public sealed class FakeAssessmentDocuments : IAssessmentDocuments
{
    public static readonly byte[] Pdf = Encoding.ASCII.GetBytes("%PDF-1.4\n%%EOF");
    public ConcurrentQueue<(string Kind, string ZedId, string Certification)> Calls { get; } = new();
    public bool FailCertificates { get; set; }
    public bool FailReports { get; set; }

    public Task<DocumentFile> IssueCertificateAsync(string zedId, string certification, CancellationToken ct)
    {
        Calls.Enqueue(("certificate", zedId, certification));
        if (FailCertificates) throw new NotSupportedException("Certificate generation is not ported yet.");
        return Task.FromResult(new DocumentFile(CertificationCompletion.CertificatePath(zedId, certification), Pdf));
    }

    public Task<DocumentFile> RenderReportAsync(string zedId, string certification, CancellationToken ct)
    {
        Calls.Enqueue(("report", zedId, certification));
        if (FailReports) throw new NotSupportedException("Report generation is not ported yet.");
        return Task.FromResult(new DocumentFile($"PDFs/SA/{zedId}/{certification}_Report.pdf", Pdf));
    }
}

/// <summary>The real pipeline of <see cref="TestHost"/> with the documents service faked, and signed-in clients for it.</summary>
public static class ReviewTestHost
{
    public static WebApplicationFactory<Program> WithDocuments(TestHost host, FakeAssessmentDocuments documents) =>
        host.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.RemoveAll<IAssessmentDocuments>();
            s.AddSingleton<IAssessmentDocuments>(documents);
        }));

    public static async Task<HttpClient> SignInAsync(WebApplicationFactory<Program> app, string? userId)
    {
        var cookies = new CookieContainer();
        var client = app.CreateDefaultClient(new Xsrf(cookies, app.Server.BaseAddress));
        (await client.GetAsync("/api/auth/me")).EnsureSuccessStatusCode();
        if (userId is null) return client;
        (await client.PostAsJsonAsync("/api/staff/auth/login", new { userId, password = "Right#Pass1" })).EnsureSuccessStatusCode();
        (await client.GetAsync("/api/auth/me")).EnsureSuccessStatusCode();
        return client;
    }

    private sealed class Xsrf(CookieContainer cookies, Uri baseAddress) : DelegatingHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var uri = request.RequestUri!.IsAbsoluteUri ? request.RequestUri : new Uri(baseAddress, request.RequestUri);
            var header = cookies.GetCookieHeader(uri);
            if (header.Length > 0) request.Headers.Add("Cookie", header);
            if (request.Method != HttpMethod.Get && cookies.GetCookies(uri)["XSRF-TOKEN"] is { } xsrf)
                request.Headers.Add("X-XSRF-TOKEN", Uri.UnescapeDataString(xsrf.Value));
            var response = await base.SendAsync(request, ct);
            if (response.Headers.TryGetValues("Set-Cookie", out var setCookies))
                foreach (var c in setCookies) cookies.SetCookies(uri, c);
            return response;
        }
    }
}

public sealed class MonitoringReviewTests : IDisposable
{
    private const string Zed = "ZEDMSME000001";
    private const string Bronze = "/api/staff/monitoring/review/ZEDMSME000001/Bronze";
    private const string Silver = "/api/staff/monitoring/review/ZEDMSME000001/Silver";

    private readonly TestHost _host = new();
    private readonly FakeAssessmentDocuments _docs = new();
    private readonly WebApplicationFactory<Program> _app;

    /// <summary>MsmeCertifications rows by certification: allotted to AGENCY1 (DA) / AGENCYSV (SA).</summary>
    private readonly Dictionary<string, object> _records = new()
    {
        ["Bronze"] = Record("Bronze", 5, 0, "AGENCY1"),
        ["Silver"] = Record("Silver", 15, 1, "AGENCYSV"),
    };

    private static object Record(string level, int status, int nc, string agency, bool? auto = null) => new
    {
        ZedId = Zed, Certification = level, CertificationStatus = status, NcCount = nc, NcStatus = 0,
        Nc1Status = 0, Nc2Status = 0, Nc3Status = 0, Nc4Status = 0, Nc5Status = 0,
        DesktopAssessorId = "ASSESSOR1", DesktopAccepted = true, DesktopReasonForRejection = (string?)null,
        CertificationBodyUserId = agency, SiteAssessorId = "ASSESSORSV", CoAssessorId = (string?)null, IsAutoReject = auto,
    };

    public MonitoringReviewTests()
    {
        DaTestUsers.Install(_host.Sql);
        _app = ReviewTestHost.WithDocuments(_host, _docs);
        var q = _host.Sql.Queries;
        q[AssessmentRecords.CertificationSql] = args =>
            FakeSql.Arg(args, "ZedId") == Zed && _records.TryGetValue(FakeSql.Arg(args, "Certification") ?? "", out var r) ? [r] : [];
        q[AssessmentRecords.ProductSql] = args => Mine(args, 21) ? [new { Id = 21L, NcCount = 0 }] : [];
        q[AssessmentRecords.RequirementSql] = args => Mine(args, 11) ? [new { Id = 11L, NcCount = 1 }] : [];
        q[AssessmentRecords.SectionSql] = args => Mine(args, 41) ? [new { Id = 41L, NcCount = 0 }] : [];
        q[MonitoringReviewController.AnyPhotoSql] = args => Mine(args, 61) ? [new { Id = 61L, NcCount = 0 }] : [];
        q[MonitoringReviewController.MeetingSql] = args => Mine(args, 71) ? [new { Id = 71L }] : [];
        q[MonitoringReviewController.AssessorCommentSql] = args => Mine(args, 81) ? [new { Id = 81L, NcCount = 1 }] : [];
        q[MonitoringReviewController.SaPhotoSql] = args => Mine(args, 91) ? [new { Id = 91L, NcCount = 1 }] : [];

        var details = (Func<object?, Zed.Core.Data.ResultSets>)(_ => FakeSql.Sets([new
        {
            EnterpriseName = "ACME UNIT", EmailId = "unit@x.test", EstablishmentName = "Acme <Castings>", PUnitName = "ACME UNIT",
            RejectedZedId = Zed + "_D_45", MobileNo = "9999999999", AgencyEmailId = "agency@x.test", Password = "Secret#1",
        }]));
        _host.Sql.Procs["SP_DA_GET_CERTIFICATE_DETAILS"] = details;
        _host.Sql.Procs["SP_RA_GET_CERTIFICATE_DETAILS"] = details;
    }

    private static bool Mine(object? args, long id) => FakeSql.Arg(args, "Id") == id.ToString() && FakeSql.Arg(args, "ZedId") == Zed;

    public void Dispose()
    {
        _app.Dispose();
        _host.Dispose();
    }

    private Task<HttpClient> As(string? user) => ReviewTestHost.SignInAsync(_app, user);

    private IEnumerable<object?> CallsTo(string name) => _host.Sql.Calls.Where(c => c.Name == name).Select(c => c.Args);

    private static readonly string[] ChangeProcs =
    [
        "SP_MONITORING_UPDATE_AGENCY_REMARKS", "SP_MONITORING_RA_UPDATE_AGENCY_REMARKS", "SP_ASSESSMENT_RA_UPDATE_COMMENTS",
        "SP_MONITORING_DA_FINAL_SUBMIT", "SP_MONITORING_RA_FINAL_SUBMIT", "SP_MONITORING_SEND_BACK_TO_ASSESSOR",
        "SP_MONITORING_REJECT_FINAL_SUBMIT", "SP_MONITORING_REJECT_CERTIFICATION",
    ];

    private void AssertNothingChanged()
    {
        Assert.DoesNotContain(_host.Sql.Calls, c => ChangeProcs.Contains(c.Name));
        Assert.Empty(_docs.Calls);
        Assert.Empty(_host.Email.Sent);
    }

    private static object Body => new { kind = "product", id = 21, remarks = "ok", exemptionsReviewed = true, qualityChecked = true, confirmed = true, sectionId = 41, comments = "c" };

    // ------------------------------------------------------------------ access

    [Fact]
    public async Task Review_actions_need_a_signed_in_user()
    {
        var client = await As(null);
        foreach (var action in new[] { "/remarks", "/ofi-comments", "/final-submit", "/send-back", "/reject" })
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync(Bronze + action, Body)).StatusCode);
        AssertNothingChanged();
    }

    [Theory]
    [InlineData("ASSESSOR1")]
    [InlineData("QC1")]
    [InlineData("ADMIN1")]
    [InlineData("MADMIN")]
    public async Task Only_the_agency_edits_remarks_final_submits_and_rejects(string user)
    {
        var client = await As(user);
        foreach (var action in new[] { "/remarks", "/final-submit", "/reject" })
            Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync(Bronze + action, Body)).StatusCode);
        AssertNothingChanged();
    }

    [Fact]
    public async Task Another_agency_cannot_touch_the_record()
    {
        var client = await As("AGENCY2");
        foreach (var action in new[] { "/remarks", "/final-submit", "/send-back", "/reject" })
            Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync(Bronze + action, Body)).StatusCode);
        AssertNothingChanged();
    }

    [Fact]
    public async Task Agency_needs_the_sub_role_of_the_page()
    {
        // Desktop review needs DesktopVerification; AGENCYSV only has SiteVerification.
        _records["Bronze"] = Record("Bronze", 5, 0, "AGENCYSV");
        var sv = await As("AGENCYSV");
        Assert.Equal(HttpStatusCode.Forbidden, (await sv.PostAsJsonAsync(Bronze + "/final-submit", Body)).StatusCode);
        // Site review needs SiteVerification; AGENCY1 only has DesktopVerification.
        _records["Silver"] = Record("Silver", 15, 0, "AGENCY1");
        var da = await As("AGENCY1");
        Assert.Equal(HttpStatusCode.Forbidden, (await da.PostAsJsonAsync(Silver + "/final-submit", Body)).StatusCode);
        AssertNothingChanged();
    }

    [Theory]
    [InlineData(3)]
    [InlineData(4)]
    [InlineData(6)]
    public async Task Actions_are_refused_outside_the_quality_check(int status)
    {
        _records["Bronze"] = Record("Bronze", status, 0, "AGENCY1");
        var client = await As("AGENCY1");
        foreach (var action in new[] { "/remarks", "/final-submit", "/send-back", "/reject" })
            Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync(Bronze + action, Body)).StatusCode);
        AssertNothingChanged();
    }

    [Theory]
    [InlineData("/api/staff/monitoring/review/ZED'1/Bronze/final-submit")]
    [InlineData("/api/staff/monitoring/review/ZEDMSME000001/Platinum/final-submit")]
    public async Task Malformed_requests_are_refused(string url)
    {
        var client = await As("AGENCY1");
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync(url, Body)).StatusCode);
        AssertNothingChanged();
    }

    // ------------------------------------------------------------------ desktop review

    [Fact]
    public async Task Agency_edits_remarks_of_rows_of_the_record_only()
    {
        var client = await As("AGENCY1");
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync(Bronze + "/remarks", new { kind = "product", id = 21, remarks = " Fine " })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync(Bronze + "/remarks", new { kind = "photo", id = 61, remarks = "Clear" })).StatusCode);

        var calls = CallsTo("SP_MONITORING_UPDATE_AGENCY_REMARKS").ToList();
        Assert.Equal(2, calls.Count);
        Assert.Equal("MsmeProducts", FakeSql.Arg(calls[0], "TableName"));
        Assert.Equal("21", FakeSql.Arg(calls[0], "Id"));
        Assert.Equal("Fine", FakeSql.Arg(calls[0], "Remarks"));
        Assert.Equal("Bronze", FakeSql.Arg(calls[0], "CertificationType"));
        Assert.Equal("AGENCY1", FakeSql.Arg(calls[0], "UserId"));
        Assert.Equal("MsmePhotos", FakeSql.Arg(calls[1], "TableName"));

        // Another record's row, a table the desktop page does not edit, and empty or long remarks.
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync(Bronze + "/remarks", new { kind = "product", id = 99, remarks = "x" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync(Bronze + "/remarks", new { kind = "meeting", id = 71, remarks = "x" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync(Bronze + "/remarks", new { kind = "Users", id = 1, remarks = "x" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync(Bronze + "/remarks", new { kind = "product", id = 21, remarks = "  " })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync(Bronze + "/remarks", new { kind = "product", id = 21, remarks = new string('x', 2001) })).StatusCode);
        Assert.Equal(2, CallsTo("SP_MONITORING_UPDATE_AGENCY_REMARKS").Count());
    }

    [Fact]
    public async Task Final_submit_needs_both_confirmations()
    {
        var client = await As("AGENCY1");
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync(Bronze + "/final-submit", new { exemptionsReviewed = false, qualityChecked = true })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync(Bronze + "/final-submit", new { exemptionsReviewed = true, qualityChecked = false })).StatusCode);
        AssertNothingChanged();
    }

    [Fact]
    public async Task Bronze_final_submit_certifies_and_mails_certificate_and_report()
    {
        var client = await As("AGENCY1");
        var r = await client.PostAsJsonAsync(Bronze + "/final-submit", new { exemptionsReviewed = true, qualityChecked = true, zedId = "ZEDMSME999999" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);

        var call = Assert.Single(CallsTo("SP_MONITORING_DA_FINAL_SUBMIT"));
        Assert.Equal(Zed, FakeSql.Arg(call, "ZedId"));
        Assert.Equal("Bronze", FakeSql.Arg(call, "CertificationType"));
        Assert.Equal("AGENCY1", FakeSql.Arg(call, "UserId"));
        Assert.Matches("^[1-9a-z]{4}$", FakeSql.Arg(call, "QrCodeSeqNo"));

        Assert.Contains(("certificate", Zed, "Bronze"), _docs.Calls);
        // The documents service records the generation status itself.
        Assert.Empty(CallsTo("SP_INSERT_CERTIFICATE_GENERATION_STATUS"));

        var mail = Assert.Single(_host.Email.Sent);
        Assert.Equal("unit@x.test", mail.To);
        Assert.Contains("Certificate and Assessment Report", mail.Subject);
        Assert.EndsWith(Zed, mail.Subject);
        Assert.Equal(["Bronze.pdf", $"{Zed}_Bronze_Report.pdf"], mail.Attachments!.Select(a => a.FileName));
        Assert.DoesNotContain("Secret#1", mail.HtmlBody);
        Assert.DoesNotContain("ReportSummary", mail.HtmlBody);
        Assert.Contains("/msme/login", mail.HtmlBody);
    }

    [Fact]
    public async Task Silver_desktop_final_submit_only_completes_the_desktop_verification()
    {
        _records["Silver"] = Record("Silver", 5, 0, "AGENCY1");
        var client = await As("AGENCY1");
        var r = await client.PostAsJsonAsync(Silver + "/final-submit", new { exemptionsReviewed = true, qualityChecked = true });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Single(CallsTo("SP_MONITORING_DA_FINAL_SUBMIT"));
        Assert.Empty(CallsTo("SP_MONITORING_RA_FINAL_SUBMIT"));
        Assert.Empty(_docs.Calls);
        Assert.Empty(_host.Email.Sent);
    }

    [Fact]
    public async Task Final_submit_is_kept_when_the_certificate_cannot_be_generated()
    {
        _docs.FailCertificates = true;
        var client = await As("AGENCY1");
        var r = await client.PostAsJsonAsync(Bronze + "/final-submit", new { exemptionsReviewed = true, qualityChecked = true });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Contains("could not be generated", (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("message").GetString());
        Assert.Single(CallsTo("SP_MONITORING_DA_FINAL_SUBMIT"));
        // No mail without a certificate.
        Assert.Empty(_host.Email.Sent);
    }

    [Fact]
    public async Task Certificate_is_mailed_without_the_report_when_the_report_fails()
    {
        _docs.FailReports = true;
        var client = await As("AGENCY1");
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync(Bronze + "/final-submit", new { exemptionsReviewed = true, qualityChecked = true })).StatusCode);
        var mail = Assert.Single(_host.Email.Sent);
        Assert.Equal(["Bronze.pdf"], mail.Attachments!.Select(a => a.FileName));
    }

    [Fact]
    public async Task Agency_sends_back_from_the_quality_check_with_remarks()
    {
        var client = await As("AGENCY1");
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync(Bronze + "/send-back", new { remarks = "" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync(Bronze + "/send-back", new { remarks = "Recheck 1.2" })).StatusCode);
        var call = Assert.Single(CallsTo("SP_MONITORING_SEND_BACK_TO_ASSESSOR"));
        Assert.Equal("Recheck 1.2", FakeSql.Arg(call, "SendBackRemarks"));
        Assert.Equal("2", FakeSql.Arg(call, "RoleId"));
        Assert.Equal("AGENCY1", FakeSql.Arg(call, "UserId"));
    }

    [Fact]
    public async Task Master_admin_sends_back_only_automatic_rejections()
    {
        var master = await As("MADMIN");
        // Quality check: agency only.
        Assert.Equal(HttpStatusCode.Forbidden, (await master.PostAsJsonAsync(Bronze + "/send-back", new { remarks = "x" })).StatusCode);
        // Rejected by the assessor after NC5: agency only.
        _records["Bronze"] = Record("Bronze", 7, 6, "AGENCY1", auto: false);
        Assert.Equal(HttpStatusCode.Forbidden, (await master.PostAsJsonAsync(Bronze + "/send-back", new { remarks = "x" })).StatusCode);
        var agency = await As("AGENCY1");
        Assert.Equal(HttpStatusCode.OK, (await agency.PostAsJsonAsync(Bronze + "/send-back", new { remarks = "x" })).StatusCode);
        // Rejected by the NC closure job: master admin, not the agency.
        _records["Bronze"] = Record("Bronze", 7, 6, "AGENCY1", auto: true);
        Assert.Equal(HttpStatusCode.Forbidden, (await agency.PostAsJsonAsync(Bronze + "/send-back", new { remarks = "x" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await master.PostAsJsonAsync(Bronze + "/send-back", new { remarks = "Extend" })).StatusCode);
        Assert.Equal(2, CallsTo("SP_MONITORING_SEND_BACK_TO_ASSESSOR").Count());
        Assert.Equal("7", FakeSql.Arg(CallsTo("SP_MONITORING_SEND_BACK_TO_ASSESSOR").Last(), "RoleId"));
    }

    [Fact]
    public async Task Agency_rejects_a_failed_unit_archives_it_and_tells_the_msme()
    {
        _records["Bronze"] = Record("Bronze", 7, 6, "AGENCY1", auto: true);
        var client = await As("AGENCY1");
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync(Bronze + "/reject", new { confirmed = false })).StatusCode);
        Assert.Empty(CallsTo("SP_MONITORING_REJECT_FINAL_SUBMIT"));

        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync(Bronze + "/reject", new { confirmed = true })).StatusCode);
        var order = _host.Sql.Calls.Select(c => c.Name)
            .Where(n => n is "SP_MONITORING_REJECT_FINAL_SUBMIT" or "SP_RA_GET_CERTIFICATE_DETAILS" or "SP_MONITORING_REJECT_CERTIFICATION").ToList();
        Assert.Equal(["SP_MONITORING_REJECT_FINAL_SUBMIT", "SP_RA_GET_CERTIFICATE_DETAILS", "SP_MONITORING_REJECT_CERTIFICATION"], order);

        var mail = Assert.Single(_host.Email.Sent);
        Assert.Equal("unit@x.test", mail.To);
        Assert.StartsWith("Rejection of your application", mail.Subject);
        Assert.Contains("Acme &lt;Castings&gt;", mail.HtmlBody);
        Assert.DoesNotContain("Secret#1", mail.HtmlBody);
        // The report of the archived copy is attached.
        Assert.Contains(("report", Zed + "_D_45", "Bronze"), _docs.Calls);
        Assert.Single(mail.Attachments!);
    }

    [Fact]
    public async Task Rejection_is_not_offered_during_the_quality_check()
    {
        var client = await As("AGENCY1");
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync(Bronze + "/reject", new { confirmed = true })).StatusCode);
        AssertNothingChanged();
    }

    // ------------------------------------------------------------------ site review

    [Fact]
    public async Task Site_agency_edits_site_remarks_meetings_and_ofi_comments()
    {
        var client = await As("AGENCYSV");
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync(Silver + "/remarks", new { kind = "meeting", id = 71, remarks = "Opening ok" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync(Silver + "/remarks", new { kind = "summary", id = 0, remarks = "Summary" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync(Silver + "/remarks", new { kind = "nc-comments", id = 81, remarks = "NC1" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync(Silver + "/remarks", new { kind = "photo", id = 91, remarks = "Photo" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync(Silver + "/remarks", new { kind = "meeting", id = 72, remarks = "x" })).StatusCode);

        var calls = CallsTo("SP_MONITORING_RA_UPDATE_AGENCY_REMARKS").ToList();
        Assert.Equal(["Meetings", "MsmeCertifications", "AssessorComments", "SaPhotos"], calls.Select(c => FakeSql.Arg(c, "TableName")));
        Assert.Null(FakeSql.Arg(calls[1], "Id"));
        Assert.Empty(CallsTo("SP_MONITORING_UPDATE_AGENCY_REMARKS"));

        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync(Silver + "/ofi-comments", new { sectionId = 41, comments = "Improve" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync(Silver + "/ofi-comments", new { sectionId = 42, comments = "Improve" })).StatusCode);
        var ofi = Assert.Single(CallsTo("SP_ASSESSMENT_RA_UPDATE_COMMENTS"));
        Assert.Equal("MsmeSections", FakeSql.Arg(ofi, "TableName"));
        Assert.Equal("41", FakeSql.Arg(ofi, "Id"));
    }

    [Fact]
    public async Task Ofi_comments_are_not_edited_on_the_desktop_review()
    {
        var client = await As("AGENCY1");
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync(Bronze + "/ofi-comments", new { sectionId = 41, comments = "x" })).StatusCode);
        AssertNothingChanged();
    }

    [Fact]
    public async Task Site_final_submit_certifies_silver()
    {
        var client = await As("AGENCYSV");
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync(Silver + "/final-submit", new { qualityChecked = false })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync(Silver + "/final-submit", new { qualityChecked = true })).StatusCode);
        var call = Assert.Single(CallsTo("SP_MONITORING_RA_FINAL_SUBMIT"));
        Assert.Equal("Silver", FakeSql.Arg(call, "CertificationType"));
        Assert.Empty(CallsTo("SP_MONITORING_DA_FINAL_SUBMIT"));
        Assert.Contains(("certificate", Zed, "Silver"), _docs.Calls);
        var mail = Assert.Single(_host.Email.Sent);
        Assert.Equal("Silver.pdf", mail.Attachments![0].FileName);
        Assert.Contains("Your certificate details are as below", mail.HtmlBody);
    }

    [Fact]
    public async Task Site_rejection_send_back_follows_the_old_page()
    {
        _records["Silver"] = Record("Silver", 17, 6, "AGENCYSV", auto: true);
        var agency = await As("AGENCYSV");
        var master = await As("MADMIN");
        // The SA page offered the agency send back at 17 whatever the cause; the master admin only for automatic rejections.
        Assert.Equal(HttpStatusCode.OK, (await agency.PostAsJsonAsync(Silver + "/send-back", new { remarks = "x" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await master.PostAsJsonAsync(Silver + "/send-back", new { remarks = "x" })).StatusCode);
        _records["Silver"] = Record("Silver", 17, 6, "AGENCYSV", auto: false);
        Assert.Equal(HttpStatusCode.Forbidden, (await master.PostAsJsonAsync(Silver + "/send-back", new { remarks = "x" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await agency.PostAsJsonAsync(Silver + "/final-submit", new { qualityChecked = true })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await agency.PostAsJsonAsync(Silver + "/reject", new { confirmed = true })).StatusCode);
    }

    // ------------------------------------------------------------------ DA review page permissions

    [Fact]
    public async Task Desktop_review_page_lists_the_agency_actions()
    {
        _host.Sql.Procs["SP_ASSESSMENT_DA_DETAILS"] = _ => FakeSql.Sets([new { ZedId = Zed, Certification = "Bronze", CertificationStatus = 5, NcCount = 0 }]);
        var agency = await As("AGENCY1");
        var review = (await agency.GetFromJsonAsync<JsonElement>("/api/staff/assessment/da/ZEDMSME000001/Bronze")).GetProperty("permissions").GetProperty("review");
        Assert.True(review.GetProperty("editRemarks").GetBoolean());
        Assert.True(review.GetProperty("finalSubmit").GetBoolean());
        Assert.True(review.GetProperty("sendBack").GetBoolean());
        Assert.False(review.GetProperty("reject").GetBoolean());

        var master = await As("MADMIN");
        var none = (await master.GetFromJsonAsync<JsonElement>("/api/staff/assessment/da/ZEDMSME000001/Bronze")).GetProperty("permissions").GetProperty("review");
        Assert.False(none.GetProperty("any").GetBoolean());
    }
}
