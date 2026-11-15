using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using SkiaSharp;
using Zed.Core.Data;
using Zed.Core.Mobile;
using Zed.Portal.Features.Documents;

namespace Zed.Main.Api.Tests;

/// <summary>
/// 2026-11-15: the reports as pages (docs/designs/reports-html.html): the page data of the assessment, surveillance and
/// handholding milestone reports, built from the live data and never stored; their photos and the apps' signed links.
/// </summary>
public sealed class ReportPagesTests : IDisposable
{
    private const string Me = DocumentsTestData.Me;
    private const string Other = DocumentsTestData.Other;
    private static readonly string Key = Convert.ToBase64String(Enumerable.Range(1, 32).Select(i => (byte)i).ToArray());
    private readonly TestHost _host = new();
    private readonly FakeSql _surveillance = new();
    private readonly FakeSql _consultancy = new();
    private readonly WebApplicationFactory<Program> _factory;

    public ReportPagesTests()
    {
        DocumentsTestData.Register(_host);
        SystemDocumentsTestData.Surveillance(_surveillance);
        SystemDocumentsTestData.Consultancy(_consultancy);
        SystemDocumentsTestData.Photos(_host.StorageRoot);
        DocumentsTestData.WritePhoto(_host.StorageRoot, $"mobileapi/Photos/{Me}/Bronze/SiteExteriorPhotos/1.jpg", new SKColor(0x2E, 0x7D, 0x32), 3000, 2000);
        DocumentsTestData.WritePhoto(_host.StorageRoot, $"mobileapi/Photos/{Me}/Bronze/BasicInfo/p1.jpg", new SKColor(0x15, 0x65, 0xC0));
        DocumentsTestData.WritePhoto(_host.StorageRoot, $"mobileapi/Photos/{Other}/Bronze/BasicInfo/p1.jpg", SKColors.Red);
        _factory = _host.WithWebHostBuilder(b =>
        {
            b.UseSetting("Mobile:AppTokenKey", Key);
            b.ConfigureTestServices(s =>
            {
                s.AddKeyedSingleton<ISqlExecutor>("Surveillance", _surveillance);
                s.AddKeyedSingleton<ISqlExecutor>("Consultancy", _consultancy);
            });
        });
    }

    public void Dispose()
    {
        _factory.Dispose();
        _host.Dispose();
    }

    /// <summary>Signed in on the factory with the other systems' (fake) databases.</summary>
    private async Task<HttpClient> SignIn(string user)
    {
        var client = _factory.CreateDefaultClient(new DocumentsSystemsTests.CookieXsrfHandler());
        (await client.GetAsync("/api/auth/me")).EnsureSuccessStatusCode();
        var url = DocumentsTestData.Users[user].Role == 5 ? "/api/msme/auth/login" : "/api/staff/auth/login";
        (await client.PostAsJsonAsync(url, new { userId = user, password = "Right#Pass1" })).EnsureSuccessStatusCode();
        return client;
    }

    private string Stored(string relative) => Path.Combine(_host.StorageRoot, relative.Replace('/', Path.DirectorySeparatorChar));

    private static async Task<JsonElement> Json(HttpResponseMessage r)
    {
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Contains("no-store", r.Headers.CacheControl?.ToString());
        return await r.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static IEnumerable<string?> Values(JsonElement array, string property) => array.EnumerateArray().Select(e => e.GetProperty(property).GetString());

    // ----- assessment report page

    [Fact]
    public async Task Msme_opens_the_assessment_report_page_built_from_the_live_data_and_nothing_is_stored()
    {
        var client = await SignIn(Me);
        var page = await Json(await client.GetAsync("/api/msme/certification-documents/bronze/report/page?zedId=" + Other));

        Assert.Equal("assessment", page.GetProperty("kind").GetString());
        Assert.Equal("Assessment Report", page.GetProperty("title").GetString());
        Assert.Equal(Me, page.GetProperty("zedId").GetString());
        Assert.False(page.GetProperty("draft").GetBoolean());
        Assert.Equal("ACME PRECISION CASTINGS UNIT 1", page.GetProperty("unit").GetProperty("name").GetString());
        Assert.Equal("26.4499", page.GetProperty("unit").GetProperty("latitude").GetString());

        // Summary: certificate number and expiry (as the verification page), the key facts and the results by section.
        var result = page.GetProperty("result");
        Assert.Equal("ok", result.GetProperty("tone").GetString());
        Assert.Equal("Certified: ZED Bronze", result.GetProperty("heading").GetString());
        Assert.Equal("Certificate 21102026_1234 · valid till October 21, 2029", result.GetProperty("detail").GetString());
        // Five sections of three requirements, the fifth exempted; the second requirement of each is an NC.
        Assert.Equal(["12", "8", "4", "1"], Values(page.GetProperty("facts"), "value"));
        var sections = page.GetProperty("sectionResults").EnumerateArray().ToList();
        Assert.Equal(5, sections.Count);
        Assert.Equal(2, sections[0].GetProperty("conformed").GetInt32());
        Assert.Equal(3, sections[0].GetProperty("total").GetInt32());
        Assert.True(sections[4].GetProperty("exempted").GetBoolean());
        Assert.Contains("Certificate number", Values(page.GetProperty("journey"), "label"));
        Assert.Equal("Certified on", page.GetProperty("dated").GetProperty("label").GetString());

        // Findings with the assessor's remark and the chip; the checkpoints (options) of the requirement.
        var findings = page.GetProperty("findings").EnumerateArray().ToList();
        Assert.Equal(5, findings.Count);
        var nc = findings[0].GetProperty("requirements")[1];
        Assert.Equal("1.2", nc.GetProperty("code").GetString());
        Assert.Equal("NC raised", nc.GetProperty("result").GetString());
        Assert.Equal("n", nc.GetProperty("tone").GetString());
        Assert.StartsWith("Records of the last three months", nc.GetProperty("remarks").GetString());
        Assert.StartsWith("Requirement 1.2", nc.GetProperty("checkpoints")[0].GetProperty("text").GetString());
        Assert.Equal(2, nc.GetProperty("checkpoints")[0].GetProperty("subOptions").GetArrayLength());
        Assert.Equal(0, findings[4].GetProperty("requirements").GetArrayLength());
        // Bronze has no Opportunities for Improvement.
        Assert.Equal(JsonValueKind.Null, findings[0].GetProperty("ofi").ValueKind);

        // NC round 1: closed.
        var round = page.GetProperty("ncRounds")[0];
        Assert.Equal(1, round.GetProperty("round").GetInt32());
        Assert.Equal("Closed", round.GetProperty("items")[0].GetProperty("status").GetString());
        Assert.True(page.GetProperty("ncClosed").GetBoolean());

        // Way forward from the verification data; the QR code of the certificate's verification page.
        Assert.Contains("Keep the certificate valid: surveillance is due by January 14, 2028.", page.GetProperty("wayForward").EnumerateArray().Select(w => w.GetString()));
        Assert.Contains(page.GetProperty("wayForward").EnumerateArray(), w => w.GetString()!.StartsWith("Apply for the ZED Silver level", StringComparison.Ordinal));
        Assert.EndsWith("/Verify/BC/P12abcd", page.GetProperty("verify").GetProperty("url").GetString());
        Assert.StartsWith("data:image/png;base64,", page.GetProperty("verify").GetProperty("qrImage").GetString());
        Assert.Contains(page.GetProperty("disclaimer").EnumerateArray(), d => d.GetString()!.Contains("3 years", StringComparison.Ordinal));

        // Only the photos of the record's own folder are addressed (the second product's photo is missing).
        Assert.Equal(1, page.GetProperty("sitePhotos").GetArrayLength());
        var products = page.GetProperty("products").EnumerateArray().ToList();
        Assert.StartsWith("/api/report-pages/photo?t=", products[0].GetProperty("photo").GetString());
        Assert.Equal("PDF document (on the ZED portal)", products[0].GetProperty("descriptionNote").GetString());
        Assert.Equal(JsonValueKind.Null, products[1].GetProperty("photo").ValueKind);
        Assert.StartsWith("/api/report-pages/photo?t=", products[1].GetProperty("descriptionPhoto").GetString());

        Assert.Equal(Me, FakeSql.Arg(Assert.Single(_host.Sql.Calls, c => c.Name == "SP_REPORT_GET_DETAILS").Args, "ZedId"));
        Assert.False(Directory.Exists(Stored("PDFs")));
    }

    [Fact]
    public async Task Photos_are_served_downscaled_by_their_signed_address_only()
    {
        var client = await SignIn(Me);
        var page = await Json(await client.GetAsync("/api/msme/certification-documents/Bronze/report/page"));
        var url = page.GetProperty("sitePhotos")[0].GetProperty("url").GetString()!;

        // No cookie needed: the address is the permission.
        var anonymous = _factory.CreateClient();
        var photo = await anonymous.GetAsync(url);
        Assert.Equal(HttpStatusCode.OK, photo.StatusCode);
        Assert.Equal("image/jpeg", photo.Content.Headers.ContentType?.MediaType);
        Assert.Contains("private", photo.Headers.CacheControl?.ToString());
        using (var image = SKBitmap.Decode(await photo.Content.ReadAsByteArrayAsync()))
            Assert.True(Math.Max(image.Width, image.Height) <= 1400);

        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync(url + "x")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync("/api/report-pages/photo?t=mobileapi%2FPhotos%2FZEDMSME000001%2FBronze%2FBasicInfo%2Fp1.jpg")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync("/api/report-pages/photo")).StatusCode);

        // A signed address of another record's file is refused when it is served, too.
        var links = _factory.Services.GetRequiredService<ReportLinks>();
        var forged = links.Photo(Me, $"mobileapi/Photos/{Other}/Bronze/BasicInfo/p1.jpg");
        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync(forged)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await anonymous.GetAsync(links.Photo(Me, $"mobileapi/Photos/{Me}/Bronze/BasicInfo/p1.jpg"))).StatusCode);
    }

    [Fact]
    public async Task Rejected_copy_opens_as_a_rejected_report_for_its_own_msme_only()
    {
        var client = await SignIn(Me);
        var page = await Json(await client.GetAsync($"/api/msme/certification-documents/Bronze/report/page?record={DocumentsTestData.MyRejected}"));
        Assert.True(page.GetProperty("rejected").GetBoolean());
        Assert.Equal("rej", page.GetProperty("result").GetProperty("tone").GetString());
        Assert.Equal(JsonValueKind.Null, page.GetProperty("verify").ValueKind);
        Assert.Equal(Me, page.GetProperty("zedId").GetString());
        Assert.Equal(DocumentsTestData.MyRejected, page.GetProperty("recordId").GetString());

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/msme/certification-documents/Bronze/report/page?record={Other}_D_45")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/msme/certification-documents/Gold/report/page")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/msme/certification-documents/Platinum/report/page")).StatusCode);
    }

    [Fact]
    public async Task Staff_preview_a_draft_before_the_final_submit_and_see_only_their_records()
    {
        var anonymous = _factory.CreateDefaultClient(new DocumentsSystemsTests.CookieXsrfHandler());
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync($"/api/staff/certification-documents/{Me}/Gold/report/page")).StatusCode);

        // Gold is at status 9 (not certified): staff see a DRAFT, the MSME nothing.
        var admin = await SignIn("ADMIN1");
        var draft = await Json(await admin.GetAsync($"/api/staff/certification-documents/{Me}/Gold/report/page"));
        Assert.True(draft.GetProperty("draft").GetBoolean());
        Assert.Equal("draft", draft.GetProperty("result").GetProperty("tone").GetString());
        Assert.Equal(JsonValueKind.Null, draft.GetProperty("verify").ValueKind);
        Assert.Equal(JsonValueKind.Null, draft.GetProperty("dated").ValueKind);
        Assert.Empty(draft.GetProperty("wayForward").EnumerateArray());
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_RA_GET_CERTIFICATE_DETAILS");

        var msme = await SignIn(Me);
        Assert.Equal(HttpStatusCode.NotFound, (await msme.GetAsync("/api/msme/certification-documents/Gold/report/page")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await msme.GetAsync($"/api/staff/certification-documents/{Me}/Gold/report/page")).StatusCode);

        var agency = await SignIn("AGENCY1");
        var silver = await Json(await agency.GetAsync($"/api/staff/certification-documents/{Me}/Silver/report/page"));
        Assert.False(silver.GetProperty("draft").GetBoolean());
        // Silver has Opportunities for Improvement.
        Assert.Equal("Document the review.", silver.GetProperty("findings")[0].GetProperty("ofi").GetString());
        Assert.Equal(HttpStatusCode.NotFound, (await agency.GetAsync($"/api/staff/certification-documents/{Other}/Bronze/report/page")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await agency.GetAsync($"/api/staff/certification-documents/{Me}/Diamond/report/page")).StatusCode);
    }

    // ----- other systems' reports, served by main to the MSME

    [Fact]
    public async Task Surveillance_report_page_comes_from_ZED_SURVEILLANCE()
    {
        var client = await SignIn(Me);
        var page = await Json(await client.GetAsync("/api/msme/certification-documents/BronzeSurveillance/report/page"));
        Assert.Equal("surveillance", page.GetProperty("kind").GetString());
        Assert.Equal("Surveillance Assessment Report", page.GetProperty("title").GetString());
        Assert.StartsWith("Surveillance 1 completed on", page.GetProperty("result").GetProperty("heading").GetString());
        Assert.Equal("Round 1", page.GetProperty("facts")[3].GetProperty("value").GetString());
        Assert.Equal("Requirements checked", page.GetProperty("facts")[0].GetProperty("label").GetString());
        Assert.Single(_surveillance.Calls, c => c.Name == "SP_REPORT_GET_DETAILS");
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_REPORT_GET_DETAILS");
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/msme/certification-documents/GoldSurveillance/report/page")).StatusCode);
        Assert.False(Directory.Exists(Stored("Surveillance/PDFs")));
    }

    [Fact]
    public async Task Milestone_report_page_shows_the_progress_of_the_current_milestone_and_an_earlier_one_stored_as_a_pdf()
    {
        var client = await SignIn(Me);
        var page = await Json(await client.GetAsync("/api/msme/certification-documents/Silver/report/page?milestone=2"));
        Assert.Equal("milestone", page.GetProperty("kind").GetString());
        var m = page.GetProperty("milestone");
        Assert.Equal(2, m.GetProperty("number").GetInt32());
        Assert.Equal("Bronze", m.GetProperty("existing").GetString());
        Assert.Equal(["Done", "Done", "Later"], Values(m.GetProperty("steps"), "status"));
        Assert.Equal("PR1: October 1, 2026", m.GetProperty("steps")[1].GetProperty("date").GetString());
        var progress = m.GetProperty("progress");
        Assert.Equal(6, progress.GetProperty("total").GetInt32());
        Assert.Equal(6, progress.GetProperty("completed").GetInt32());
        Assert.Equal(2, m.GetProperty("meetings").GetArrayLength());
        Assert.StartsWith("/api/report-pages/photo?t=", m.GetProperty("meetings")[0].GetProperty("photo").GetString());
        Assert.Equal("Existing: Bronze · Target: Silver", page.GetProperty("result").GetProperty("heading").GetString());
        Assert.Equal(JsonValueKind.Null, page.GetProperty("storedPdf").ValueKind);
        Assert.Equal("2", FakeSql.Arg(Assert.Single(_consultancy.Calls, c => c.Name == "SP_REPORT_GET_DETAILS").Args, "NcCount"));
        Assert.False(Directory.Exists(Stored("Consultancy/PDFs")));

        // Milestone 1 is over: drawn from its own rows (the unit row is the current milestone's) ...
        var first = await Json(await client.GetAsync("/api/msme/certification-documents/Silver/report/page?milestone=1"));
        Assert.Equal(1, first.GetProperty("milestone").GetProperty("number").GetInt32());
        Assert.Equal(["Done", "Done", "Later"], Values(first.GetProperty("milestone").GetProperty("steps"), "status"));
        Assert.Equal("", first.GetProperty("milestone").GetProperty("dates").GetString());
        // ... or, once stored as a PDF when it was completed, that file.
        var stored = Stored($"Consultancy/PDFs/SA/{Me}/Silver_Report.pdf");
        Directory.CreateDirectory(Path.GetDirectoryName(stored)!);
        await File.WriteAllTextAsync(stored, "%PDF-1.4 milestone 1");
        var storedPage = await Json(await client.GetAsync("/api/msme/certification-documents/Silver/report/page?milestone=1"));
        Assert.Equal("/api/msme/certification-documents/Silver/report?milestone=1", storedPage.GetProperty("storedPdf").GetString());

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/msme/certification-documents/Silver/report/page?milestone=3")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/msme/certification-documents/Bronze/report/page?milestone=1")).StatusCode);
    }

    [Fact]
    public async Task Milestone_under_review_is_not_shown_to_the_msme()
    {
        SystemDocumentsTestData.Consultancy(_consultancy, nc: 2, status: 15);
        var client = await SignIn(Me);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/msme/certification-documents/Silver/report/page?milestone=2")).StatusCode);
        Assert.DoesNotContain(_consultancy.Calls, c => c.Name == "SP_REPORT_GET_DETAILS");
    }

    // ----- the ZED MSME app's signed link

    private async Task<HttpResponseMessage> AppLink(string query, string? token)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/Msme/AppReportLink?" + query);
        if (token is not null) request.Headers.Add(AppTokens.Header, token);
        return await _factory.CreateClient().SendAsync(request);
    }

    [Fact]
    public async Task Msme_app_gets_a_signed_page_link_that_opens_the_report_without_a_cookie()
    {
        var token = await _factory.Services.GetRequiredService<AppTokens>().IssueAsync(MobileApps.Msme, Me, Me);
        var json = JsonDocument.Parse(await (await AppLink("certification=bronze", token)).Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("1", json.GetProperty("status").GetString());
        var url = json.GetProperty("url").GetString()!;
        Assert.Contains("/report/link?t=", url);
        var t = Uri.UnescapeDataString(url[(url.IndexOf("?t=", StringComparison.Ordinal) + 3)..]);

        // The page's API takes the token instead of the cookie (read-only): the unit of the app's token.
        var anonymous = _factory.CreateClient();
        var page = await Json(await anonymous.GetAsync("/api/report-pages/link?t=" + Uri.EscapeDataString(t)));
        Assert.Equal(Me, page.GetProperty("zedId").GetString());
        Assert.Equal("Bronze", page.GetProperty("level").GetString());
        Assert.False(page.GetProperty("draft").GetBoolean());
        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync("/api/report-pages/link?t=" + Uri.EscapeDataString(t[..^2] + "xx"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync("/api/report-pages/link")).StatusCode);

        // Not certified yet; a refused token; another app's token.
        Assert.Equal("0", JsonDocument.Parse(await (await AppLink("certification=Gold", token)).Content.ReadAsStringAsync()).RootElement.GetProperty("status").GetString());
        Assert.Equal(HttpStatusCode.Unauthorized, (await AppLink("certification=Bronze", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await AppLink("certification=Bronze", "h1.forged.token")).StatusCode);

        // The surveillance and milestone reports, from the other systems.
        var surveillance = JsonDocument.Parse(await (await AppLink("certification=BronzeSurveillance", token)).Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("1", surveillance.GetProperty("status").GetString());
        var milestone = JsonDocument.Parse(await (await AppLink("certification=Silver&milestone=2", token)).Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("1", milestone.GetProperty("status").GetString());
        var mt = Uri.UnescapeDataString(milestone.GetProperty("url").GetString()!.Split("?t=")[1]);
        var milestonePage = await Json(await anonymous.GetAsync("/api/report-pages/link?t=" + Uri.EscapeDataString(mt)));
        Assert.Equal(2, milestonePage.GetProperty("milestone").GetProperty("number").GetInt32());
    }

    [Fact]
    public void Link_tokens_are_bound_to_their_report_and_refuse_anything_else()
    {
        var links = _factory.Services.GetRequiredService<ReportLinks>();
        var target = new ReportLinkTarget(ReportLinks.Milestone, Me, "Silver", 2);
        var token = links.Link(target);
        Assert.Equal(target, links.ReadLink(token));
        Assert.Null(links.ReadLink(token + "a"));
        Assert.Null(links.ReadLink(null));
        Assert.Null(links.ReadLink(new string('a', 3000)));
        // A photo token is not a link token.
        var photo = links.Photo(Me, $"mobileapi/Photos/{Me}/Bronze/BasicInfo/p1.jpg");
        Assert.Null(links.ReadLink(Uri.UnescapeDataString(photo.Split("?t=")[1])));
        Assert.StartsWith("http", links.PageUrl(target));
        Assert.Contains("/report/link?t=", links.PageUrl(target));
    }
}
