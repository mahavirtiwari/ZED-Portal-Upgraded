using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security;
using System.Text;
using System.Text.Json;
using Zed.Portal.Features.Staff.Schemes;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>Builds small .xlsx files: strings as inline strings, numbers as numbers (dates as Excel serials).</summary>
internal static class TestXlsx
{
    public static byte[] Build(IEnumerable<object?[]> rows, bool sharedStrings = false)
    {
        using var ms = new MemoryStream();
        using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
        {
            void Add(string name, string xml)
            {
                using var w = new StreamWriter(zip.CreateEntry(name).Open(), new UTF8Encoding(false));
                w.Write(xml);
            }
            Add("[Content_Types].xml", "<?xml version=\"1.0\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"/>");
            Add("xl/workbook.xml", "<?xml version=\"1.0\"?><workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"Sheet1\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>");
            Add("xl/_rels/workbook.xml.rels", "<?xml version=\"1.0\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/></Relationships>");

            var strings = new List<string>();
            var sheet = new StringBuilder("<?xml version=\"1.0\"?><worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData>");
            var r = 0;
            foreach (var row in rows)
            {
                r++;
                sheet.Append($"<row r=\"{r}\">");
                for (var c = 0; c < row.Length; c++)
                {
                    var cell = $"{(char)('A' + c)}{r}";
                    switch (row[c])
                    {
                        case null: break;
                        case string s when sharedStrings:
                            strings.Add(s);
                            sheet.Append($"<c r=\"{cell}\" t=\"s\"><v>{strings.Count - 1}</v></c>");
                            break;
                        case string s:
                            sheet.Append($"<c r=\"{cell}\" t=\"inlineStr\"><is><t>{SecurityElement.Escape(s)}</t></is></c>");
                            break;
                        case DateOnly d:
                            sheet.Append($"<c r=\"{cell}\" s=\"1\"><v>{d.ToDateTime(TimeOnly.MinValue).ToOADate()}</v></c>");
                            break;
                        default:
                            sheet.Append($"<c r=\"{cell}\"><v>{Convert.ToString(row[c], System.Globalization.CultureInfo.InvariantCulture)}</v></c>");
                            break;
                    }
                }
                sheet.Append("</row>");
            }
            sheet.Append("</sheetData></worksheet>");
            Add("xl/worksheets/sheet1.xml", sheet.ToString());
            if (sharedStrings)
                Add("xl/sharedStrings.xml", "<?xml version=\"1.0\"?><sst xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">" +
                    string.Concat(strings.Select(s => $"<si><t>{SecurityElement.Escape(s)}</t></si>")) + "</sst>");
        }
        return ms.ToArray();
    }
}

public sealed class SchemesIncentiveTests : IDisposable
{
    private readonly TestHost _host = new();

    private static readonly object?[] Header =
        ["UdyamNo", "Certificateno", "Pin", "ApplicationId", "UnitName", "District", "FCI", "ServiceName", "ApprovalId",
         "IncentiveName", "DisbursedAmount", "DisbursedDate", "DateOfProduction", "AppliedDate", "ApprovedDate"];

    private static object?[] Row(string udyam = "UDYAM-UP-29-0003915", object? amount = null, object? date = null, string service = "Capital subsidy", string app = "A1") =>
        [udyam, "ZEDCERT1", "208001", app, "Acme Unit", "Kanpur", "1200000", service, "AP1", "Interest subvention", amount ?? 25000.5,
         date ?? new DateOnly(2026, 1, 5), null, "05-01-2026", null];

    public SchemesIncentiveTests()
    {
        SchemesTestUsers.Register(_host);
        _host.Sql.Procs["SP_GET_API_INCENTIVES"] = _ => Zed.Main.Api.Tests.FakeSql.Sets(
            [new { PUnitName = "Acme", PStateName = "UP", UdyamNo = "UDYAM-UP-29-0003915", Token = "secret-api-token", DisbursedAmount = 1000m, DataFrom = "API" }]);
        _host.Sql.Procs["SP_MASTER_GET_INCENTIVES"] = args => FakeSql.Arg(args, "IncentiveType") == "Common"
            ? FakeSql.Sets([new { Id = 41L, IncentiveType = "Common", Incentive = "Scheme A", WebLink = "https://msme.gov.in", OrderNo = 1 }])
            : FakeSql.Sets([]);
    }

    public void Dispose() => _host.Dispose();

    private Task<HttpClient> SignIn(string user) => SchemesTestUsers.SignInAsync(_host, user);

    private IEnumerable<object?> Inserts => _host.Sql.Calls.Where(c => c.Name == "SP_API_SUBMIT_INCENTIVE_DETAILS_FROM_EXCEL").Select(c => c.Args);

    private static MultipartFormDataContent File(byte[] content, string name = "incentives.xlsx")
    {
        var part = new ByteArrayContent(content);
        part.Headers.ContentType = new MediaTypeHeaderValue("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        return new MultipartFormDataContent { { part, "file", name } };
    }

    // ----- submissions (SuperAdmin) -----

    [Fact]
    public async Task Submissions_are_for_the_super_admin_only_and_filters_are_validated()
    {
        var anon = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.GetAsync("/api/staff/schemes/incentives/submissions")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await (await SignIn("MADMIN")).GetAsync("/api/staff/schemes/incentives/submissions")).StatusCode);

        var super = await SignIn("SUPER1");
        var json = await super.GetFromJsonAsync<JsonElement>("/api/staff/schemes/incentives/submissions?state=9&certification=silver&gender=FEMALE&msmeSize=micro");
        Assert.Equal("Acme", json[0].GetProperty("PUnitName").GetString());
        Assert.False(json[0].TryGetProperty("Token", out _));
        var call = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_GET_API_INCENTIVES");
        Assert.Equal("9", FakeSql.Arg(call.Args, "State"));
        Assert.Equal("Silver", FakeSql.Arg(call.Args, "CertificationType"));
        Assert.Equal("female", FakeSql.Arg(call.Args, "Gender"));
        Assert.Equal("Micro", FakeSql.Arg(call.Args, "MsmeSize"));

        Assert.Equal(HttpStatusCode.BadRequest, (await super.GetAsync("/api/staff/schemes/incentives/submissions?gender=x' OR 1=1")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await super.GetAsync("/api/staff/schemes/incentives/submissions?sector=123")).StatusCode);
    }

    // ----- upload (MasterAdmin) -----

    [Fact]
    public async Task Upload_is_for_the_master_admin_only()
    {
        var xlsx = TestXlsx.Build([Header, Row()]);
        var anon = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.PostAsync("/api/staff/schemes/incentives/upload", File(xlsx))).StatusCode);
        foreach (var user in new[] { "SUPER1", "ADMIN1", "AGENCY1", "SC_UP" })
            Assert.Equal(HttpStatusCode.Forbidden, (await (await SignIn(user)).PostAsync("/api/staff/schemes/incentives/upload", File(xlsx))).StatusCode);
        Assert.Empty(Inserts);
    }

    [Fact]
    public async Task A_valid_sheet_is_inserted_row_by_row_with_normalised_values()
    {
        var admin = await SignIn("MADMIN");
        var xlsx = TestXlsx.Build([Header, Row(), Row(udyam: "udyam-mh-23-0006117", amount: "1200", app: "A2")], sharedStrings: true);
        var r = await admin.PostAsync("/api/staff/schemes/incentives/upload", File(xlsx));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var json = await r.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(2, json.GetProperty("inserted").GetInt32());

        var first = Inserts.First();
        Assert.Equal("UDYAM-UP-29-0003915", FakeSql.Arg(first, "UdyamNo"));
        Assert.Equal("25000.50", FakeSql.Arg(first, "DisbursedAmount"));
        Assert.Equal("20260105", FakeSql.Arg(first, "DisbursedDate"));
        Assert.Equal("20260105", FakeSql.Arg(first, "AppliedDate"));
        Assert.Null(FakeSql.Arg(first, "DateOfProduction"));
        Assert.Equal("UDYAM-MH-23-0006117", FakeSql.Arg(Inserts.Last(), "UdyamNo"));
        // The workbook is kept under a server-generated name.
        Assert.Single(Directory.GetFiles(Path.Combine(_host.StorageRoot, "Excels"), "*.xlsx"));
    }

    [Fact]
    public async Task Rows_already_uploaded_are_skipped_and_listed_so_a_file_can_be_uploaded_again()
    {
        // Sheet row 2 is already in ApiIncentives; row 3 is new.
        _host.Sql.Queries["SELECT j.RowNo"] = _ => [new { RowNo = 2, FirstUploaded = (DateTime?)new DateTime(2026, 1, 6, 10, 0, 0) }];
        var admin = await SignIn("MADMIN");
        var r = await admin.PostAsync("/api/staff/schemes/incentives/upload",
            File(TestXlsx.Build([Header, Row(), Row(udyam: "UDYAM-MH-23-0006117", app: "A2")])));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var json = await r.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1, json.GetProperty("inserted").GetInt32());
        Assert.Contains("1 row(s) were uploaded before", json.GetProperty("message").GetString());
        var skipped = Assert.Single(json.GetProperty("skipped").EnumerateArray());
        Assert.Equal(2, skipped.GetProperty("row").GetInt32());
        Assert.Equal("UDYAM-UP-29-0003915", skipped.GetProperty("udyamNo").GetString());
        Assert.Equal("UDYAM-MH-23-0006117", FakeSql.Arg(Assert.Single(Inserts), "UdyamNo"));
        Assert.Single(json.GetProperty("rows").EnumerateArray());

        // The lookup gets every row's key, with the date and amount as the table stores them.
        var lookup = Assert.Single(_host.Sql.Calls, c => c.Name.Contains("FROM OPENJSON(@Rows)"));
        var keys = JsonDocument.Parse(FakeSql.Arg(lookup.Args, "Rows")!).RootElement;
        Assert.Equal(2, keys.GetArrayLength());
        Assert.Equal(2, keys[0].GetProperty("r").GetInt32());
        Assert.Equal("2026-01-05", keys[0].GetProperty("d").GetString());
        Assert.Equal("25000.50", keys[0].GetProperty("m").GetString());
    }

    [Fact]
    public async Task A_file_whose_rows_were_all_uploaded_before_inserts_nothing()
    {
        _host.Sql.Queries["SELECT j.RowNo"] = _ => [new { RowNo = 2, FirstUploaded = (DateTime?)null }, new { RowNo = 3, FirstUploaded = (DateTime?)null }];
        var admin = await SignIn("MADMIN");
        var r = await admin.PostAsync("/api/staff/schemes/incentives/upload",
            File(TestXlsx.Build([Header, Row(), Row(udyam: "UDYAM-MH-23-0006117", app: "A2")])));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var json = await r.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(0, json.GetProperty("inserted").GetInt32());
        Assert.Equal("Nothing new to upload: all 2 row(s) were uploaded before.", json.GetProperty("message").GetString());
        Assert.Empty(Inserts);
    }

    [Theory]
    [InlineData("=HYPERLINK(\"http://evil\")")]  // formula injection
    [InlineData("+cmd|' /C calc'!A0")]
    [InlineData("@SUM(A1)")]
    [InlineData("<script>alert(1)</script>")]
    [InlineData("javascript:alert(1)")]
    public async Task Unsafe_cells_reject_the_whole_file(string service)
    {
        var admin = await SignIn("MADMIN");
        var r = await admin.PostAsync("/api/staff/schemes/incentives/upload", File(TestXlsx.Build([Header, Row(app: "A0"), Row(service: service)])));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        var json = await r.Content.ReadFromJsonAsync<JsonElement>();
        var error = json.GetProperty("rowErrors")[0];
        Assert.Equal(3, error.GetProperty("row").GetInt32());
        Assert.Equal("ServiceName", error.GetProperty("column").GetString());
        Assert.Empty(Inserts);
    }

    [Fact]
    public async Task Invalid_values_and_duplicate_rows_are_reported_with_their_row_numbers()
    {
        var admin = await SignIn("MADMIN");
        var xlsx = TestXlsx.Build([Header, Row(udyam: "UDYAM-12"), Row(amount: "-5", app: "A9"), Row(date: "31-02-2026", app: "A8"), Row(), Row()]);
        var r = await admin.PostAsync("/api/staff/schemes/incentives/upload", File(xlsx));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        var errors = (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("rowErrors").EnumerateArray()
            .Select(e => (e.GetProperty("row").GetInt32(), e.GetProperty("column").GetString())).ToList();
        Assert.Contains((2, "UdyamNo"), errors);
        Assert.Contains((3, "DisbursedAmount"), errors);
        Assert.Contains((4, "DisbursedDate"), errors);
        Assert.Contains((6, ""), errors); // second copy of row 5
        Assert.Empty(Inserts);
    }

    [Fact]
    public async Task Wrong_files_are_refused()
    {
        var admin = await SignIn("MADMIN");
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsync("/api/staff/schemes/incentives/upload", File(TestXlsx.Build([Header, Row()]), "a.xls"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsync("/api/staff/schemes/incentives/upload", File("PK not a zip"u8.ToArray()))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsync("/api/staff/schemes/incentives/upload", File(TestXlsx.Build([Header])))).StatusCode);
        var missing = await admin.PostAsync("/api/staff/schemes/incentives/upload", File(TestXlsx.Build([Header[..14], Row()[..14]])));
        Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
        Assert.Contains("ApprovedDate", await missing.ProblemTitle());
        // Too many rows.
        var big = TestXlsx.Build(new[] { Header }.Concat(Enumerable.Range(0, 5001).Select(i => Row(app: "A" + i))));
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsync("/api/staff/schemes/incentives/upload", File(big))).StatusCode);
        Assert.Empty(Inserts);
    }

    [Fact]
    public void Reader_rejects_dtds_and_reads_shared_strings()
    {
        var ok = XlsxSheetReader.ReadFirstSheet(new MemoryStream(TestXlsx.Build([["a", "b"], ["c", null, 3]], sharedStrings: true)));
        Assert.Equal("a", ok[0][0]);
        Assert.Equal("c", ok[1][0]);
        Assert.Null(ok[1][1]);
        Assert.Equal("3", ok[1][2]);

        using var ms = new MemoryStream();
        using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
        using (var w = new StreamWriter(zip.CreateEntry("xl/worksheets/sheet1.xml").Open()))
            w.Write("<?xml version=\"1.0\"?><!DOCTYPE x [<!ENTITY e SYSTEM \"file:///c:/windows/win.ini\">]><worksheet><sheetData><row><c t=\"inlineStr\"><is><t>&e;</t></is></c></row></sheetData></worksheet>");
        ms.Position = 0;
        Assert.Throws<XlsxFormatException>(() => XlsxSheetReader.ReadFirstSheet(ms));
    }

    // ----- incentive catalogue (Admin) -----

    private static object Incentive(string webLink = "https://msme.gov.in/scheme", string type = "Common") => new
    {
        incentiveType = type, incentive = "Scheme B", details = "Details", ministryOrDepartment = "MoMSME", contactPerson = "Officer",
        webLink, email = "officer@msme.gov.in", mobileNo = "011-2306", videoLink = (string?)null,
        applicableForBronze = true, applicableForSilver = false, applicableForGold = false, activeStatus = true,
    };

    [Fact]
    public async Task Catalogue_is_for_the_admin_role_only()
    {
        var anon = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.PostAsJsonAsync("/api/staff/schemes/incentive-master", Incentive())).StatusCode);
        foreach (var user in new[] { "MADMIN", "SUPER1", "AGENCY1" })
            Assert.Equal(HttpStatusCode.Forbidden, (await (await SignIn(user)).PostAsJsonAsync("/api/staff/schemes/incentive-master", Incentive())).StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_MASTER_INSERT_INCENTIVE");
    }

    [Theory]
    [InlineData("javascript:alert(document.cookie)")]
    [InlineData("msme.gov.in")]
    [InlineData("data:text/html,<b>x</b>")]
    public async Task Links_must_be_http_addresses(string link)
    {
        var admin = await SignIn("ADMIN1");
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/staff/schemes/incentive-master", Incentive(link))).StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_MASTER_INSERT_INCENTIVE");
    }

    [Fact]
    public async Task Admin_adds_and_updates_incentives_and_uploads_pdf_documents()
    {
        var admin = await SignIn("ADMIN1");
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/staff/schemes/incentive-master", Incentive("---"))).StatusCode);
        var insert = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_MASTER_INSERT_INCENTIVE");
        Assert.Equal("Common", FakeSql.Arg(insert.Args, "IncentiveType"));
        Assert.Equal("---", FakeSql.Arg(insert.Args, "WebLink"));

        Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsJsonAsync("/api/staff/schemes/incentive-master/99", Incentive())).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/staff/schemes/incentive-master/41", Incentive())).StatusCode);
        Assert.Equal("41", FakeSql.Arg(Assert.Single(_host.Sql.Calls, c => c.Name == "SP_MASTER_UPDATE_INCENTIVE").Args, "Id"));

        var notPdf = new MultipartFormDataContent { { new ByteArrayContent("<html>"u8.ToArray()), "file", "a.pdf" } };
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsync("/api/staff/schemes/incentive-master/41/documents/1?type=Common", notPdf)).StatusCode);
        var pdf = "%PDF-1.7 test"u8.ToArray();
        var upload = new MultipartFormDataContent { { new ByteArrayContent(pdf), "file", "../../evil.aspx" } };
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsync("/api/staff/schemes/incentive-master/41/documents/2?type=Common", upload)).StatusCode);
        Assert.Equal(pdf, System.IO.File.ReadAllBytes(Path.Combine(_host.StorageRoot, "Uploads", "Incentives", "41File2.pdf")));
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsync("/api/staff/schemes/incentive-master/41/documents/3?type=Common", new MultipartFormDataContent { { new ByteArrayContent(pdf), "file", "a.pdf" } })).StatusCode);

        var list = await admin.GetFromJsonAsync<JsonElement>("/api/staff/schemes/incentive-master?type=common");
        Assert.False(list[0].GetProperty("hasDocument1").GetBoolean());
        Assert.True(list[0].GetProperty("hasDocument2").GetBoolean());
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.GetAsync("/api/staff/schemes/incentive-master?type=../x")).StatusCode);
    }
}
