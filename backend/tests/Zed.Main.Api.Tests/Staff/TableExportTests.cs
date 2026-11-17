using System.IO.Compression;
using System.Net;
using System.Net.Http.Json;
using Zed.Portal.Features.Staff.Reports;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>2026-11-17 (the user's staff designs): Export of a page's table as .xlsx.</summary>
public sealed class TableExportTests : IDisposable
{
    private readonly TestHost _host = new();

    public TableExportTests() => SiteAssessmentTestUsers.Register(_host);

    public void Dispose() => _host.Dispose();

    [Fact]
    public async Task Writes_the_page_s_rows_as_a_workbook_with_formula_text_made_inert()
    {
        var client = await SiteAssessmentTestUsers.SignInAsync(_host, "ADMIN1");
        var r = await client.PostAsJsonAsync("/api/staff/export/xlsx", new
        {
            fileName = "payments received/Nov",
            sheets = new[] { new { name = "Payments: Nov", columns = new[] { "ZED ID", "Amount" }, rows = new object?[][] { ["ZEDM000005", 5000.5], ["=HYPERLINK(1)", null] } } },
        });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal(XlsxWriter.ContentType, r.Content.Headers.ContentType!.MediaType);
        Assert.Equal("payments received-Nov.xlsx", r.Content.Headers.ContentDisposition!.FileNameStar ?? r.Content.Headers.ContentDisposition.FileName!.Trim('"'));
        using var zip = new ZipArchive(await r.Content.ReadAsStreamAsync());
        var sheet = new StreamReader(zip.GetEntry("xl/worksheets/sheet1.xml")!.Open()).ReadToEnd();
        Assert.Contains("ZEDM000005", sheet);
        Assert.Contains("5000.5", sheet);
        Assert.Contains("'=HYPERLINK(1)", sheet);
        var book = new StreamReader(zip.GetEntry("xl/workbook.xml")!.Open()).ReadToEnd();
        Assert.Contains("Payments  Nov", book);
    }

    [Fact]
    public async Task Refuses_an_empty_export_and_needs_a_staff_login()
    {
        var client = await SiteAssessmentTestUsers.SignInAsync(_host, "ADMIN1");
        var empty = await client.PostAsJsonAsync("/api/staff/export/xlsx", new { fileName = "x", sheets = Array.Empty<object>() });
        Assert.Equal(HttpStatusCode.BadRequest, empty.StatusCode);
        var anon = await _host.CreateBrowserAsync();
        Assert.NotEqual(HttpStatusCode.OK, (await anon.PostAsJsonAsync("/api/staff/export/xlsx", new { fileName = "x" })).StatusCode);
    }

    [Fact]
    public void Names_follow_excel_rules()
    {
        Assert.Equal("Sheet3", TableExportController.SheetName("  ", 2));
        Assert.Equal(31, TableExportController.SheetName(new string('a', 40), 0).Length);
        Assert.Equal("zed-export.xlsx", TableExportController.FileName("../.."));
    }
}
