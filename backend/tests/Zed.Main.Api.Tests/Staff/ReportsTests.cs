using System.IO.Compression;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using Zed.Portal.Features.Staff.Reports;

namespace Zed.Main.Api.Tests.Staff;

public sealed class ReportsTests : IDisposable
{
    private readonly TestHost _host = new();

    public ReportsTests() => DashboardStaffLogin.Register(_host);

    public void Dispose() => _host.Dispose();

    [Fact]
    public async Task Anonymous_gets_401()
    {
        var client = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/staff/reports")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/staff/reports/list-of-registered-msme/download")).StatusCode);
    }

    [Theory]
    [InlineData("QC1")]
    [InlineData("MASTER1")]
    [InlineData("ADMIN1")]
    [InlineData("ASSESSOR1")]
    public async Task Roles_without_the_reports_page_get_403(string userId)
    {
        var client = await _host.SignInAsync(userId);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/staff/reports")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/staff/reports/list-of-registered-msme/download")).StatusCode);
    }

    [Fact]
    public async Task Each_role_sees_its_own_report_list()
    {
        var agency = await _host.SignInAsync("AGENCY1");
        var list = await agency.GetFromJsonAsync<JsonElement>("/api/staff/reports");
        Assert.Equal(["List Of ZED Cases In-Progress", "List Of ZED Certified MSME", "List Of ZED Rejected MSME"],
            list.EnumerateArray().Select(r => r.GetProperty("name").GetString()));
        Assert.False(list[0].TryGetProperty("procedure", out _));

        var state = await _host.SignInAsync("STATE1");
        Assert.Equal(2, (await state.GetFromJsonAsync<JsonElement>("/api/staff/reports")).GetArrayLength());
        var super = await _host.SignInAsync("SUPER1");
        Assert.Equal(43, (await super.GetFromJsonAsync<JsonElement>("/api/staff/reports")).GetArrayLength());
    }

    [Theory]
    [InlineData("list-of-assessment-agencies")] // SuperAdmin's report, not the agency's
    [InlineData("SP_MSME_DISABLE_PLANT")]
    [InlineData("does-not-exist")]
    public async Task Reports_outside_the_role_allow_list_are_not_run(string id)
    {
        var agency = await _host.SignInAsync("AGENCY1");
        var r = await agency.GetAsync($"/api/staff/reports/{Uri.EscapeDataString(id)}/download?spName=SP_MSME_DISABLE_PLANT");
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.StartsWith("SP_DYNAMIC_REPORT_") || c.Name == "SP_MSME_DISABLE_PLANT");
    }

    [Fact]
    public async Task Download_runs_the_allow_listed_procedure_with_the_cookie_user()
    {
        _host.Sql.Procs["SP_DYNAMIC_REPORT_LIST_OF_REGISTERED_MSME"] = _ => FakeSql.Sets([new { ZedId = "ZEDMSME000001", Amount = 21240 }]);
        var agency = await _host.SignInAsync("AGENCY1");

        var r = await agency.GetAsync("/api/staff/reports/list-of-registered-msme/download?roleId=10&userId=SUPER1");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal(XlsxWriter.ContentType, r.Content.Headers.ContentType?.MediaType);
        Assert.Contains("List_Of_ZED_Cases_In-Progress.xlsx", r.Content.Headers.ContentDisposition?.ToString());

        var call = _host.LastCall("SP_DYNAMIC_REPORT_LIST_OF_REGISTERED_MSME");
        Assert.Equal("2", FakeSql.Arg(call.Args, "RoleId"));
        Assert.Equal("AGENCY1", FakeSql.Arg(call.Args, "Userid"));
        Assert.Null(FakeSql.Arg(call.Args, "UlbCode"));
    }

    [Fact]
    public async Task Export_neutralises_formulas_drops_secrets_and_keeps_numbers()
    {
        _host.Sql.Procs["SP_DYNAMIC_REPORT_LIST_OF_ASSESSMENT_AGENCIES"] = _ => FakeSql.Sets(
            [new { UserId = "AG1", UserName = "=HYPERLINK(\"http://evil.test\",\"x\")", MobileNo = "+919999999999", Remarks = "@SUM(A1)", Password = "Secret#1", Amount = 1500.5m, Note = "-2+3" }],
            [new { Total = 1 }]);
        var super = await _host.SignInAsync("SUPER1");

        var bytes = await super.GetByteArrayAsync("/api/staff/reports/list-of-assessment-agencies/download");
        using var zip = new ZipArchive(new MemoryStream(bytes));
        Assert.NotNull(zip.GetEntry("xl/worksheets/sheet2.xml"));
        var workbook = XDocument.Load(zip.GetEntry("xl/workbook.xml")!.Open());
        XNamespace m = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
        Assert.Equal(["Table", "Table1"], workbook.Descendants(m + "sheet").Select(s => (string)s.Attribute("name")!));

        var sheet = XDocument.Load(zip.GetEntry("xl/worksheets/sheet1.xml")!.Open());
        var rows = sheet.Descendants(m + "row").ToList();
        var header = rows[0].Descendants(m + "t").Select(t => t.Value).ToList();
        Assert.Equal(["UserId", "UserName", "MobileNo", "Remarks", "Amount", "Note"], header);
        Assert.DoesNotContain("Secret#1", sheet.ToString());
        Assert.Empty(sheet.Descendants(m + "f"));

        var cells = rows[1].Elements(m + "c").ToList();
        Assert.Equal("'=HYPERLINK(\"http://evil.test\",\"x\")", cells[1].Descendants(m + "t").Single().Value);
        Assert.Equal("'+919999999999", cells[2].Descendants(m + "t").Single().Value);
        Assert.Equal("'@SUM(A1)", cells[3].Descendants(m + "t").Single().Value);
        Assert.Equal("1500.5", cells[4].Element(m + "v")!.Value);
        Assert.Null(cells[4].Attribute("t"));
        Assert.Equal("'-2+3", cells[5].Descendants(m + "t").Single().Value);
        Assert.Equal("E2", (string)cells[4].Attribute("r")!);
    }

    [Fact]
    public void Catalog_has_only_report_procedures_and_unique_ids_per_role()
    {
        foreach (var proc in ReportCatalog.AllProcedures)
            Assert.Matches(new Regex("^SP_DYNAMIC_REPORT_[A-Z0-9_\\-]+$"), proc);
        foreach (var role in ReportCatalog.Roles)
        {
            var ids = ReportCatalog.For((int)role).Select(r => r.Id).ToList();
            Assert.NotEmpty(ids);
            Assert.Equal(ids.Count, ids.Distinct().Count());
        }
        Assert.Empty(ReportCatalog.For((int)Zed.Core.Security.UserRole.MasterAdmin));
    }

    [Theory]
    [InlineData(0, "A")]
    [InlineData(25, "Z")]
    [InlineData(26, "AA")]
    [InlineData(701, "ZZ")]
    [InlineData(702, "AAA")]
    public void Column_names_follow_excel(int index, string name) => Assert.Equal(name, XlsxWriter.ColumnName(index));

    [Theory]
    [InlineData("=1+1", "'=1+1")]
    [InlineData("+1", "'+1")]
    [InlineData("-1", "'-1")]
    [InlineData("@cmd", "'@cmd")]
    [InlineData("\t=1", "'\t=1")]
    [InlineData("ZEDMSME000001", "ZEDMSME000001")]
    [InlineData("", "")]
    public void Formula_prefixes_are_neutralised(string input, string expected) => Assert.Equal(expected, XlsxWriter.Neutralise(input));
}
