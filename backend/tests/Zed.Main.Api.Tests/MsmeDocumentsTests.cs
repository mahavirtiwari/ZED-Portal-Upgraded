using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Zed.Core.Content;
using Zed.Portal.Features.Msme;

namespace Zed.Main.Api.Tests;

public sealed class MsmeDocumentsTests : IDisposable
{
    private const string Me = "ZEDMSME000001";
    private const string Other = "ZEDMSME000002";
    private const string Site = "https://loginzed.msme.gov.in";

    private readonly TestHost _host = new();

    public MsmeDocumentsTests()
    {
        _host.Sql.Procs["SP_GET_USER_DETAILS"] = args => FakeSql.Sets(
            [new { UserId = FakeSql.Arg(args, "UserId"), UserName = "Acme Castings", RoleId = 5, Email = "a@acme.test", MobileNo = "9999999999", StateCode = "9", DistrictCode = "160" }],
            [new { ERRORMSG = "SUCCESS" }]);
        // Shaped like the real procedure: everything is built from @ZedId and UrlsMasterData.UrlName.
        _host.Sql.Procs[MsmeMyDocuments.Procedure] = args =>
        {
            var id = FakeSql.Arg(args, "ZedId");
            return FakeSql.Sets(
                [
                    new { ZedId = id, DocumentName = "ZED Guidelines", DocumentPath = $"{Site}/Uploads/Documents/Guide 1.pdf", OrderNo = 1 },
                    new { ZedId = id, DocumentName = "Checklist", DocumentPath = $"{Site}/Uploads/Documents/Checklist.docx", OrderNo = 2 },
                    new { ZedId = id, DocumentName = "Bad row", DocumentPath = "Uploads/Documents/../../../secret.pdf", OrderNo = 3 },
                    new { ZedId = id, DocumentName = "Not a guideline", DocumentPath = $"{Site}/Certificates/{Other}/Pledge.pdf", OrderNo = 4 },
                ],
                [new Dictionary<string, object?>
                {
                    ["ZedId"] = id, ["Pledge"] = $"{Site}/Certifications/{id}/Pledge.pdf",
                    ["Bronze"] = $"{Site}/Certifications/DA/{id}/Bronze.pdf", ["Silver"] = null, ["Gold"] = null,
                    ["Wash"] = "https://msmekawach.org.in/Certificates/DA/KAWACH01/Bronze.pdf",
                    ["Webinar"] = "https://evil.example/WebinarCertificates/1.pdf",
                }],
                [new { ZedId = id, BronzeReceipt = $"{Site}/PDFs/SA/{id}/Bronze_Payment_Receipt.pdf", SilverReceipt = (string?)null }],
                [
                    new { TadaInvoiceNo = "INV1", InvoicePath = $"{Site}/ReceiptInvoice/INV1_{id}_Invoice.pdf", DocumentType = "Invoice", ModuleName = "ZED", Certification = "Bronze", SubModuleName = "", MileStoneNo = "" },
                    new { TadaInvoiceNo = "INV2", InvoicePath = $"{Site}/ReceiptInvoice/INV2_{Other}_Invoice.pdf", DocumentType = "Invoice", ModuleName = "ZED", Certification = "Bronze", SubModuleName = "", MileStoneNo = "" },
                ]);
        };
    }

    public void Dispose() => _host.Dispose();

    private async Task<HttpClient> SignInAsync(string zedId = Me)
    {
        var client = await _host.CreateBrowserAsync();
        (await client.PostAsJsonAsync("/api/msme/auth/login", new { userId = zedId, password = "Right#Pass1" })).EnsureSuccessStatusCode();
        return client;
    }

    private string WriteFile(string relative, string content = "%PDF-1.4 test")
    {
        var path = Path.Combine(_host.StorageRoot, relative.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, content);
        return path;
    }

    [Theory]
    [InlineData("/api/msme/documents")]
    [InlineData("/api/msme/files/pledge-certificate")]
    [InlineData("/api/msme/files/Certificates/ZEDMSME000001/Pledge.pdf")]
    public async Task Endpoints_require_a_signed_in_msme(string url)
    {
        WriteFile("Certificates/ZEDMSME000001/Pledge.pdf");
        var client = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(url)).StatusCode);
    }

    [Fact]
    public async Task Documents_use_the_cookie_zed_id_and_link_to_the_files_api()
    {
        foreach (var f in new[] { "Uploads/Documents/Guide 1.pdf", "Uploads/Documents/Checklist.docx", $"Certifications/DA/{Me}/Bronze.pdf",
                     $"PDFs/SA/{Me}/Bronze_Payment_Receipt.pdf", $"ReceiptInvoice/INV1_{Me}_Invoice.pdf" })
            WriteFile(f);
        var client = await SignInAsync();

        var json = await client.GetFromJsonAsync<JsonElement>("/api/msme/documents?zedId=" + Other);

        var call = Assert.Single(_host.Sql.Calls, c => c.Name == MsmeMyDocuments.Procedure);
        Assert.Equal(Me, FakeSql.Arg(call.Args, "ZedId"));

        var guidelines = json.GetProperty("Guidelines").EnumerateArray().Select(r => r.GetProperty("DocumentPath").GetString()).ToList();
        Assert.Equal(["/api/msme/files/Uploads/Documents/Guide%201.pdf", "/api/msme/files/Uploads/Documents/Checklist.docx", null, null], guidelines);

        var cert = json.GetProperty("Certificates")[0];
        Assert.Equal($"/api/msme/files/Certifications/{Me}/Pledge.pdf", cert.GetProperty("Pledge").GetString());
        Assert.Equal($"/api/msme/files/Certifications/DA/{Me}/Bronze.pdf", cert.GetProperty("Bronze").GetString());
        Assert.Equal(JsonValueKind.Null, cert.GetProperty("Silver").ValueKind);
        // MSME KAWACH was removed: no WASH or webinar certificate, whatever the procedure returns.
        Assert.False(cert.TryGetProperty("Wash", out _));
        Assert.False(cert.TryGetProperty("Webinar", out _));

        Assert.Equal($"/api/msme/files/PDFs/SA/{Me}/Bronze_Payment_Receipt.pdf", json.GetProperty("PaymentReceipts")[0].GetProperty("BronzeReceipt").GetString());

        var invoices = json.GetProperty("Invoices").EnumerateArray().Select(r => r.GetProperty("InvoicePath").GetString()).ToList();
        Assert.Equal([$"/api/msme/files/ReceiptInvoice/INV1_{Me}_Invoice.pdf", null], invoices);
        Assert.DoesNotContain(Site, json.GetRawText());
    }

    [Fact]
    public async Task A_listed_file_missing_from_storage_has_no_link()
    {
        // The test server had the guideline rows but not their files: the link opened a 404 page.
        WriteFile("Uploads/Documents/Checklist.docx");
        var client = await SignInAsync();

        var json = await client.GetFromJsonAsync<JsonElement>("/api/msme/documents");

        var guidelines = json.GetProperty("Guidelines").EnumerateArray().Select(r => r.GetProperty("DocumentPath").GetString()).ToList();
        Assert.Equal([null, "/api/msme/files/Uploads/Documents/Checklist.docx", null, null], guidelines);
        Assert.Equal(JsonValueKind.Null, json.GetProperty("Certificates")[0].GetProperty("Bronze").ValueKind);
        // The pledge certificate is drawn, so it keeps its link without a file.
        Assert.Equal($"/api/msme/files/Certifications/{Me}/Pledge.pdf", json.GetProperty("Certificates")[0].GetProperty("Pledge").GetString());
    }

    [Fact]
    public async Task Only_the_guidelines_given_to_the_msmes_are_listed_and_served_with_their_description_and_video()
    {
        // Admin → Documents/Videos: the checklist (OrderNo 2) is for the assessors only; a video (OrderNo 5, no file).
        _host.Sql.Queries["SELECT d.Id AS DocumentId, d.OrderNo"] = _ =>
        [
            new DocumentAccessRow(11, 1, "Read first", null, "msme,assessor", "ADMIN1", null),
            new DocumentAccessRow(12, 2, null, null, "assessor", "ADMIN1", null),
            new DocumentAccessRow(15, 5, "How to apply", "https://www.youtube.com/watch?v=abc", "msme", "ADMIN1", null),
        ];
        var inner = _host.Sql.Procs[MsmeMyDocuments.Procedure];
        _host.Sql.Procs[MsmeMyDocuments.Procedure] = args =>
        {
            var sets = inner(args);
            var rows = sets[0].ToList();
            rows.Add(new Dictionary<string, object?> { ["ZedId"] = Me, ["DocumentName"] = "Video", ["DocumentPath"] = null, ["OrderNo"] = 5 });
            return new Zed.Core.Data.ResultSets([rows, sets[1], sets[2], sets[3]]);
        };
        WriteFile("Uploads/Documents/Checklist.docx");
        var client = await SignInAsync();

        var guidelines = (await client.GetFromJsonAsync<JsonElement>("/api/msme/documents")).GetProperty("Guidelines").EnumerateArray().ToList();
        Assert.Equal(["ZED Guidelines", "Bad row", "Not a guideline", "Video"], guidelines.Select(g => g.GetProperty("DocumentName").GetString()));
        Assert.Equal("Read first", guidelines[0].GetProperty("Description").GetString());
        Assert.Equal("https://www.youtube.com/watch?v=abc", guidelines[3].GetProperty("VideoUrl").GetString());
        Assert.Equal(JsonValueKind.Null, guidelines[3].GetProperty("DocumentPath").ValueKind);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/msme/files/Uploads/Documents/Checklist.docx")).StatusCode);
    }

    [Fact]
    public async Task Own_pledge_certificate_is_drawn_from_the_registration_not_read_from_storage()
    {
        // An old file in storage is not served any more: V4 draws the certificate from the registration record.
        WriteFile($"Certificates/{Me}/Pledge.pdf", "%PDF-1.4 old pledge");
        var client = await SignInAsync();

        var r = await client.GetAsync($"/api/msme/files/Certifications/{Me}/Pledge.pdf");

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("application/pdf", r.Content.Headers.ContentType!.MediaType);
        Assert.Equal("inline", r.Content.Headers.ContentDisposition!.DispositionType);
        Assert.Equal($"Pledge_Certificate_{Me}.pdf", r.Content.Headers.ContentDisposition.FileNameStar);
        var pdf = await r.Content.ReadAsStringAsync();
        Assert.StartsWith("%PDF", pdf);
        Assert.NotEqual("%PDF-1.4 old pledge", pdf);
    }

    [Fact]
    public async Task The_new_app_gets_its_documents_with_its_sign_in_token_only()
    {
        WriteFile($"Certifications/DA/{Me}/Bronze.pdf", "%PDF-1.4 bronze");
        WriteFile($"Certificates/DA/{Other}/Bronze.pdf", "%PDF-1.4 other");
        var key = Convert.ToBase64String(Enumerable.Range(1, 32).Select(i => (byte)i).ToArray());
        // The MSME app's token mode stays Monitor for the store app: this address needs a valid token all the same.
        using var app = _host.WithWebHostBuilder(b => b.UseSetting("Mobile:AppTokenKey", key));
        var client = app.CreateClient();
        var tokens = app.Services.GetRequiredService<Zed.Core.Mobile.AppTokens>();
        var mine = await tokens.IssueAsync(Zed.Core.Mobile.MobileApps.Msme, Me, Me);

        async Task<HttpResponseMessage> Get(string path, string? token)
        {
            var request = new HttpRequestMessage(HttpMethod.Get, "/Msme/AppDocument?path=" + Uri.EscapeDataString(path));
            if (token is not null) request.Headers.Add(Zed.Core.Mobile.AppTokens.Header, token);
            return await client.SendAsync(request);
        }

        // The path as GetMyDocuments answers it (the old site's address).
        var bronze = await Get($"{Site}/Certifications/DA/{Me}/Bronze.pdf", mine);
        Assert.Equal(HttpStatusCode.OK, bronze.StatusCode);
        Assert.Equal("%PDF-1.4 bronze", await bronze.Content.ReadAsStringAsync());

        var pledge = await Get("pledge", mine);
        Assert.Equal(HttpStatusCode.OK, pledge.StatusCode);
        Assert.Equal($"Pledge_Certificate_{Me}.pdf", pledge.Content.Headers.ContentDisposition!.FileNameStar);
        Assert.StartsWith("%PDF", await pledge.Content.ReadAsStringAsync());

        Assert.Equal(HttpStatusCode.Unauthorized, (await Get($"{Site}/Certifications/DA/{Me}/Bronze.pdf", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Get("pledge", "h1.forged.token")).StatusCode);
        // Another unit's certificate is not listed for this token's unit.
        Assert.Equal(HttpStatusCode.NotFound, (await Get($"{Site}/Certificates/DA/{Other}/Bronze.pdf", mine)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Get("Uploads/Documents/../../../secret.pdf", mine)).StatusCode);
    }

    [Fact]
    public async Task Pledge_certificate_page_data_and_download()
    {
        var client = await SignInAsync();

        var view = await client.GetFromJsonAsync<System.Text.Json.JsonElement>("/api/msme/pledge-certificate");
        Assert.Equal(Me, view.GetProperty("zedId").GetString());
        Assert.Equal("Acme Unit 1", view.GetProperty("name").GetString());
        Assert.Equal("UDYAM-UP-29-0003915", view.GetProperty("udyamNo").GetString());
        var name = view.GetProperty("fields").EnumerateArray().First(f => f.GetProperty("name").GetString() == "Name");
        Assert.Equal(["Acme Unit 1"], name.GetProperty("lines").EnumerateArray().Select(l => l.GetString()));
        Assert.Contains(view.GetProperty("fields").EnumerateArray(), f => f.GetProperty("align").GetString() == "image");

        var pdf = await client.GetAsync("/api/msme/pledge-certificate/pdf");
        Assert.Equal(HttpStatusCode.OK, pdf.StatusCode);
        Assert.Equal("attachment", pdf.Content.Headers.ContentDisposition!.DispositionType);
        Assert.Equal($"Pledge_Certificate_{Me}.pdf", pdf.Content.Headers.ContentDisposition.FileNameStar);
        Assert.StartsWith("%PDF", await pdf.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task A_long_unit_name_takes_two_lines_on_the_pledge_certificate()
    {
        const string longName = "Shree Ganesh Precision Engineering and Fabrication Works Private Limited Unit Two";
        _host.Sql.Queries[FakeSql.PledgeQuery] = args => [FakeSql.PledgeRow(FakeSql.Arg(args, "ZedId")!, longName)];
        var client = await SignInAsync();

        var view = await client.GetFromJsonAsync<System.Text.Json.JsonElement>("/api/msme/pledge-certificate");
        var name = view.GetProperty("fields").EnumerateArray().First(f => f.GetProperty("name").GetString() == "Name");
        var lines = name.GetProperty("lines").EnumerateArray().Select(l => l.GetString()!).ToList();
        Assert.Equal(2, lines.Count);
        Assert.Equal(longName, string.Join(' ', lines));
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/msme/pledge-certificate/pdf")).StatusCode);
    }

    [Fact]
    public async Task Receipts_invoices_and_guidelines_listed_for_the_user_download()
    {
        WriteFile($"PDFs/SA/{Me}/Bronze_Payment_Receipt.pdf");
        WriteFile($"ReceiptInvoice/INV1_{Me}_Invoice.pdf");
        WriteFile("Uploads/Documents/Guide 1.pdf");
        WriteFile("Uploads/Documents/Checklist.docx", "docx");
        var client = await SignInAsync();

        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync($"/api/msme/files/PDFs/SA/{Me}/Bronze_Payment_Receipt.pdf")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync($"/api/msme/files/ReceiptInvoice/INV1_{Me}_Invoice.pdf")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/msme/files/Uploads/Documents/Guide%201.pdf")).StatusCode);

        var docx = await client.GetAsync("/api/msme/files/uploads/documents/checklist.docx");
        Assert.Equal(HttpStatusCode.OK, docx.StatusCode);
        Assert.Equal("attachment", docx.Content.Headers.ContentDisposition!.DispositionType);
        Assert.Equal("application/vnd.openxmlformats-officedocument.wordprocessingml.document", docx.Content.Headers.ContentType!.MediaType);
    }

    [Theory]
    [InlineData("/api/msme/files/Certificates/ZEDMSME000002/Pledge.pdf")]  // another MSME's certificate
    [InlineData("/api/msme/files/Certifications/ZEDMSME000002/Pledge.pdf")]
    [InlineData("/api/msme/files/ReceiptInvoice/INV2_ZEDMSME000002_Invoice.pdf")] // listed by the procedure, but names another ZED ID
    [InlineData("/api/msme/files/Uploads/Documents/Unlisted.pdf")]           // exists, but not on My Documents
    public async Task Files_not_listed_for_the_signed_in_zed_id_are_not_found(string url)
    {
        WriteFile($"Certificates/{Other}/Pledge.pdf");
        WriteFile($"ReceiptInvoice/INV2_{Other}_Invoice.pdf");
        WriteFile("Uploads/Documents/Unlisted.pdf");
        var client = await SignInAsync();

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(url)).StatusCode);
    }

    [Fact]
    public async Task The_other_msme_can_read_its_own_file()
    {
        WriteFile($"Certificates/{Other}/Pledge.pdf");
        var client = await SignInAsync(Other);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync($"/api/msme/files/Certifications/{Other}/Pledge.pdf")).StatusCode);
    }

    [Theory]
    [InlineData("/api/msme/files/..%2F..%2Fsecret.pdf")]
    [InlineData("/api/msme/files/Uploads%2F..%2F..%2Fsecret.pdf")]
    [InlineData("/api/msme/files/Uploads/Documents/..%5C..%5C..%5Csecret.pdf")]
    [InlineData("/api/msme/files/Certificates/%2E%2E/%2E%2E/%2E%2E/secret.pdf")]
    [InlineData("/api/msme/files/C:%2FWindows%2Fwin.ini")]
    [InlineData("/api/msme/files/Uploads/Documents/../../../secret.pdf")]
    [InlineData("/api/msme/files/appsettings.json")]
    public async Task Path_traversal_is_refused(string url)
    {
        var outside = Path.Combine(Path.GetDirectoryName(_host.StorageRoot)!, "secret.pdf");
        WriteFile("Uploads/Documents/Guide 1.pdf");
        var client = await SignInAsync();
        try
        {
            File.WriteAllText(outside, "secret");
            var r = await client.GetAsync(url);
            Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
            Assert.DoesNotContain("secret", await r.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        }
        finally { File.Delete(outside); }
    }

    [Fact]
    public async Task Listed_file_missing_from_storage_is_not_found()
    {
        var client = await SignInAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/msme/files/Certifications/DA/{Me}/Bronze.pdf")).StatusCode);
    }

    [Fact]
    public async Task Pledge_certificate_shortcut_opens_the_drawn_certificate()
    {
        var client = await SignInAsync();

        var r = await client.GetAsync("/api/msme/files/pledge-certificate");

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("inline", r.Content.Headers.ContentDisposition!.DispositionType);
        Assert.StartsWith("%PDF", await r.Content.ReadAsStringAsync());
    }
}

public sealed class MsmeFilePathsTests
{
    [Theory]
    [InlineData("https://loginzed.msme.gov.in/Certificates/ZEDMSME000001/Pledge.pdf", "Certificates/ZEDMSME000001/Pledge.pdf")]
    [InlineData("http://localhost:1234/Uploads/Documents/My%20Guide.pdf", "Uploads/Documents/My Guide.pdf")]
    [InlineData("https://loginzed.msme.gov.in/ReceiptInvoice\\INV1_ZEDMSME000001_Invoice.pdf", "ReceiptInvoice/INV1_ZEDMSME000001_Invoice.pdf")]
    [InlineData("Uploads\\Documents\\Guide_20240101.pdf", "Uploads/Documents/Guide_20240101.pdf")]
    [InlineData("~/Documents/NEFT/GST Certificate.pdf", "Documents/NEFT/GST Certificate.pdf")]
    [InlineData("/Certificates/ZEDMSME000001/Pledge.pdf", "Certificates/ZEDMSME000001/Pledge.pdf")]
    public void Legacy_values_map_to_storage_relative_paths(string legacy, string expected) =>
        Assert.Equal(expected, MsmeFilePaths.FromLegacy(legacy));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("../secret.pdf")]
    [InlineData("Uploads/../secret.pdf")]
    [InlineData("Uploads/.../secret.pdf")]
    [InlineData("Uploads/.. /secret.pdf")]
    [InlineData("Uploads//secret.pdf")]
    [InlineData("C:/Windows/win.ini")]
    [InlineData("C:\\secret.pdf")]
    [InlineData("\\\\server\\share\\secret.pdf")]
    [InlineData("file:///C:/secret.pdf")]
    [InlineData("ftp://host/secret.pdf")]
    [InlineData("Uploads/secret.pdf::$DATA")]
    [InlineData("web.config")]
    [InlineData("Uploads/Documents/script.html")]
    public void Unsafe_values_are_refused(string? legacy) => Assert.Null(MsmeFilePaths.FromLegacy(legacy));

    [Theory]
    [InlineData("Certificates/ZEDMSME000001/Pledge.pdf", true)]
    [InlineData("ReceiptInvoice/INV1_ZEDMSME000001_Invoice.pdf", true)]
    [InlineData("Certificates/ZEDMSME0000010/Pledge.pdf", false)]
    [InlineData("ReceiptInvoice/INV1_ZEDMSME0000012_Invoice.pdf", false)]
    [InlineData("Certificates/ZEDMSME000002/Pledge.pdf", false)]
    public void Ownership_needs_the_exact_zed_id(string path, bool expected) =>
        Assert.Equal(expected, MsmeFilePaths.BelongsTo(path, "ZEDMSME000001"));

    [Fact]
    public void Both_certificate_folders_are_candidates()
    {
        Assert.Equal(["Certifications/DA/Z1/Bronze.pdf", "Certificates/DA/Z1/Bronze.pdf"], MsmeFilePaths.StorageCandidates("Certifications/DA/Z1/Bronze.pdf"));
        Assert.Equal(["Surveillance/Certificates/SA/Z1/Gold.pdf", "Surveillance/Certifications/SA/Z1/Gold.pdf"], MsmeFilePaths.StorageCandidates("Surveillance/Certificates/SA/Z1/Gold.pdf"));
        Assert.Equal(["PDFs/SA/Z1/Bronze_Payment_Receipt.pdf"], MsmeFilePaths.StorageCandidates("PDFs/SA/Z1/Bronze_Payment_Receipt.pdf"));
    }

    [Fact]
    public void Resolve_stays_under_the_storage_root()
    {
        var root = Path.Combine(Path.GetTempPath(), "zed-root");
        Assert.Equal(Path.Combine(root, "Certificates", "Z1", "Pledge.pdf"), MsmeFilePaths.Resolve(root, "Certificates/Z1/Pledge.pdf"));
        Assert.Null(MsmeFilePaths.Resolve(root, "../zed-root-other/x.pdf"));
        Assert.Null(MsmeFilePaths.Resolve(root, Path.Combine(Path.GetTempPath(), "x.pdf")));
    }

    [Fact]
    public void App_files_are_found_with_or_without_the_app_folder_and_written_where_the_app_writes()
    {
        Assert.Equal(["mobileapi/Photos/Z1/Bronze/Evidences/1.pdf", "Photos/Z1/Bronze/Evidences/1.pdf"],
            MsmeFilePaths.AppLayoutCandidates("mobileapi/Photos/Z1/Bronze/Evidences/1.pdf"));
        Assert.Equal(["Uploads/DA/Z1/x.pdf"], MsmeFilePaths.AppLayoutCandidates("Uploads/DA/Z1/x.pdf"));

        var root = Path.Combine(Path.GetTempPath(), "zed-app-layout-" + Guid.NewGuid().ToString("N"));
        try
        {
            const string rel = "mobileapi/Photos/Z1/Bronze/Evidences/1.pdf";
            // Nothing stored and no Photos folder: the path as given.
            Directory.CreateDirectory(root);
            Assert.Equal(Path.Combine(root, "mobileapi", "Photos", "Z1", "Bronze", "Evidences", "1.pdf"), MsmeFilePaths.ResolveAppFile(root, rel));
            // The root is the app's own folder (the live layout): written and found under {root}\Photos.
            var flat = Path.Combine(root, "Photos", "Z1", "Bronze", "Evidences", "1.pdf");
            Directory.CreateDirectory(Path.GetDirectoryName(flat)!);
            Assert.Equal(flat, MsmeFilePaths.ResolveAppFile(root, rel));
            File.WriteAllText(flat, "%PDF");
            Assert.Equal(flat, MsmeFilePaths.ResolveAppFile(root, rel));
            // A file already stored with the app folder is kept where it is.
            var nested = Path.Combine(root, "mobileapi", "Photos", "Z1", "Bronze", "Evidences", "2.pdf");
            Directory.CreateDirectory(Path.GetDirectoryName(nested)!);
            File.WriteAllText(nested, "%PDF");
            Assert.Equal(nested, MsmeFilePaths.ResolveAppFile(root, "mobileapi/Photos/Z1/Bronze/Evidences/2.pdf"));
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }
}
