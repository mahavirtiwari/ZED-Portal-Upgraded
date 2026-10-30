using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Portal.Features.Staff.Masters;
using Zed.Portal.Features.Staff.Reports;
using Zed.Portal.Features.Staff.Schemes;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>Excel export, template and upload (check, then apply) of the Admin masters (V4).</summary>
public sealed class MasterSheetsTests : IDisposable
{
    private readonly TestHost _host = new();

    public MasterSheetsTests()
    {
        UsersMastersLogin.Setup(_host);
        _host.Sql.Procs["SP_MASTER_GET_SECTORS"] = _ => FakeSql.Sets(
            [new { Id = 1, SectorCode = "24", SectorName = "Basic metals", OrderNo = 1, SectorType = "Manufacturing" },
             new { Id = 2, SectorCode = "10", SectorName = "Food products", OrderNo = 2, SectorType = "Manufacturing" }]);
        _host.Sql.Procs["SP_MASTER_GET_CATEGORIES"] = _ => FakeSql.Sets([new { Id = 5, CategoryCode = "C1", CategoryName = "Energy", OrderNo = 1 }]);
        _host.Sql.Procs["SP_MASTER_GET_TECHNOLOGIES"] = _ => FakeSql.Sets([new
        {
            Id = 9, TechnologyCode = "T1", TechnologyName = "Solar", Description = "", Sectors = "24-Basic metals", Categories = "C1 -Energy", IsActive = true,
        }]);
        _host.Sql.Procs["SP_MASTER_ACTIVE__DEACTIVE_TECHNOLOGIES"] = _ => FakeSql.Sets([new { StatusCode = 200, Message = "OK" }]);
        _host.Sql.Procs["SP_MASTER_GET_SECTIONS"] = _ => FakeSql.Sets(
            [new { Id = 3, SectionType = "Bronze", SectionCode = "P1", SectionName = "Leadership", iButton = "-Top management", NicSectors = "24", SurveMandatories = "Yes" }]);
    }

    public void Dispose() => _host.Dispose();

    private Task<HttpClient> Admin() => UsersMastersLogin.SignInAsync(_host, "ADMIN1");

    private List<(string Name, object? Args)> Calls(string name) => _host.Sql.Calls.Where(c => c.Name == name).ToList();

    private static MultipartFormDataContent Xlsx(IReadOnlyList<string> columns, params string?[][] rows) =>
        Upload(XlsxWriter.Write([new XlsxSheet("Sheet1", columns, rows.Select(r => (IReadOnlyList<object?>)r.Cast<object?>().ToList()))]));

    private static MultipartFormDataContent Upload(byte[] content, string name = "upload.xlsx")
    {
        var part = new ByteArrayContent(content);
        part.Headers.ContentType = new MediaTypeHeaderValue(XlsxWriter.ContentType);
        return new MultipartFormDataContent { { part, "file", name } };
    }

    private static async Task<IReadOnlyList<string?[]>> Sheet(HttpResponseMessage r)
    {
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal(XlsxWriter.ContentType, r.Content.Headers.ContentType?.MediaType);
        var rows = XlsxSheetReader.ReadFirstSheet(await r.Content.ReadAsStreamAsync());
        // The reader pads every row to the widest; only the template's columns are compared.
        var width = rows[0].Count(h => !string.IsNullOrEmpty(h));
        return rows.Select(row => row.Take(width).ToArray()).ToList();
    }

    private static string?[] Row(params string?[] cells) => cells;

    [Theory]
    [InlineData("/api/staff/masters/sectors/excel")]
    [InlineData("/api/staff/masters/categories/excel/template")]
    [InlineData("/api/staff/masters/technologies/excel")]
    [InlineData("/api/staff/masters/parameters/Bronze/excel")]
    [InlineData("/api/staff/masters/regions/excel")]
    [InlineData("/api/staff/masters/lgd/excel")]
    [InlineData("/api/staff/schemes/incentive-master/excel")]
    public async Task Only_the_admin_exports(string url)
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await (await _host.CreateBrowserAsync()).GetAsync(url)).StatusCode);
        var master = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        Assert.Equal(HttpStatusCode.Forbidden, (await master.GetAsync(url)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await (await Admin()).GetAsync(url)).StatusCode);
    }

    [Fact]
    public async Task Non_admins_cannot_check_or_apply_an_upload()
    {
        var master = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        var file = Xlsx(StaffMastersController.SectorSheet.Columns.Select(c => c.Name).ToList(), Row("26", "Electronics", "Manufacturing"));
        Assert.Equal(HttpStatusCode.Forbidden, (await master.PostAsync("/api/staff/masters/sectors/excel/apply", file)).StatusCode);
        Assert.Empty(Calls("SP_MASTER_INSERT_SECTOR"));
    }

    [Fact]
    public async Task Sectors_export_in_the_template_columns_and_the_template_has_no_rows()
    {
        var admin = await Admin();
        var export = await Sheet(await admin.GetAsync("/api/staff/masters/sectors/excel"));
        Assert.Equal(["Code", "Name", "Type"], export[0]);
        Assert.Equal(["24", "Basic metals", "Manufacturing"], export[1]);
        Assert.Equal(3, export.Count);
        var template = await admin.GetAsync("/api/staff/masters/sectors/excel/template");
        Assert.Equal("sectors-template.xlsx", template.Content.Headers.ContentDisposition?.FileName?.Trim('"'));
        Assert.Equal(["Code", "Name", "Type"], Assert.Single(await Sheet(template)));
    }

    [Fact]
    public async Task Checking_sectors_lists_new_changed_same_and_error_rows_and_changes_nothing()
    {
        var admin = await Admin();
        string[] columns = ["Type", "Code", "Name", "Notes"]; // any column order; other columns are ignored
        var r = await admin.PostAsync("/api/staff/masters/sectors/excel/check", Xlsx(columns,
            Row("manufacturing", "26", "Electronics", "x"), Row("Services", "24", "Basic metals", null), Row("Manufacturing", "10", "Food products", null),
            Row(null, null, null, null), Row("Trading", "27", "", null), Row("Services", "26", "Again", null)));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var check = await r.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal((1, 1, 1, 2), (check.GetProperty("new").GetInt32(), check.GetProperty("changed").GetInt32(), check.GetProperty("unchanged").GetInt32(), check.GetProperty("errors").GetInt32()));
        var rows = check.GetProperty("rows");
        Assert.Equal(("new", "Manufacturing"), (rows[0].GetProperty("result").GetString(), rows[0].GetProperty("values")[2].GetString()));
        Assert.Equal("Type", Assert.Single(rows[1].GetProperty("changed").EnumerateArray()).GetString());
        Assert.Equal("Manufacturing", rows[1].GetProperty("was")[2].GetString());
        // The empty row is skipped; the row numbers are the sheet's.
        Assert.Equal(6, rows[3].GetProperty("row").GetInt32());
        var errors = rows[3].GetProperty("errors").EnumerateArray().Select(e => e.GetString()).ToList();
        Assert.Contains("Name required (up to 200 characters).", errors);
        Assert.Contains("Type must be Manufacturing or Services.", errors);
        Assert.Equal("Row 2 has the same Code.", rows[4].GetProperty("errors")[0].GetString());
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.StartsWith("SP_MASTER_INSERT", StringComparison.Ordinal) || c.Name.StartsWith("UPDATE", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Applying_sectors_saves_the_new_and_changed_rows_and_skips_the_errors()
    {
        var admin = await Admin();
        var r = await admin.PostAsync("/api/staff/masters/sectors/excel/apply", Xlsx(["Code", "Name", "Type"],
            Row("26", "Electronics", "Manufacturing"), Row("24", "Metals", "Manufacturing"), Row("10", "Food products", "Manufacturing"), Row("27", "Bad", "")));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var applied = await r.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal((1, 1, 1), (applied.GetProperty("added").GetInt32(), applied.GetProperty("updated").GetInt32(), applied.GetProperty("failed").GetInt32()));
        Assert.Equal("1 added, 1 updated; 1 row(s) with errors skipped.", applied.GetProperty("message").GetString());
        Assert.Equal("26", FakeSql.Arg(Assert.Single(Calls("SP_MASTER_INSERT_SECTOR")).Args, "SectorCode"));
        var update = Assert.Single(Calls("SP_MASTER_UPDATE_SECTOR"));
        Assert.Equal(("1", "24", "Metals"), (FakeSql.Arg(update.Args, "Id"), FakeSql.Arg(update.Args, "SectorCode"), FakeSql.Arg(update.Args, "SectorName")));
    }

    [Fact]
    public async Task A_file_without_the_template_headers_or_not_xlsx_is_refused()
    {
        var admin = await Admin();
        var r = await admin.PostAsync("/api/staff/masters/sectors/excel/check", Xlsx(["Code", "Sector"], Row("26", "Electronics")));
        Assert.Equal("The first row must have the template's column headers; missing: Name, Type. Please download the template.", await r.ProblemTitle());
        r = await admin.PostAsync("/api/staff/masters/sectors/excel/check", Upload("Code,Name,Type\n26,E,Services"u8.ToArray(), "sectors.csv"));
        Assert.Equal("Please upload an Excel file (.xlsx). Save an .xls or .csv file as .xlsx first.", await r.ProblemTitle());
        r = await admin.PostAsync("/api/staff/masters/sectors/excel/check", Upload("not a zip"u8.ToArray()));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Technologies_use_sector_and_category_codes_and_inactive_switches_one_off()
    {
        var admin = await Admin();
        var export = await Sheet(await admin.GetAsync("/api/staff/masters/technologies/excel"));
        Assert.Equal(["T1", "Solar", "", "24", "C1", "Active"], export[1].Select(v => v ?? "").ToArray());

        var columns = StaffMastersController.TechnologySheet.Columns.Select(c => c.Name).ToList();
        var check = await (await admin.PostAsync("/api/staff/masters/technologies/excel/check", Xlsx(columns,
            Row("T1", "Solar", "", "24", "c1", "inactive"), Row("T2", "Heat pump", "Saves fuel", "24, 10", "", ""), Row("T3", "X", "", "99", "", "")))).Content.ReadFromJsonAsync<JsonElement>();
        var rows = check.GetProperty("rows");
        Assert.Equal("Status", Assert.Single(rows[0].GetProperty("changed").EnumerateArray()).GetString());
        Assert.Equal(("new", "10, 24", "Active"), (rows[1].GetProperty("result").GetString(), rows[1].GetProperty("values")[3].GetString(), rows[1].GetProperty("values")[5].GetString()));
        Assert.Equal("NIC sector 99 is not in Masters → Sectors.", rows[2].GetProperty("errors")[0].GetString());

        var r = await admin.PostAsync("/api/staff/masters/technologies/excel/apply", Xlsx(columns, Row("T1", "Solar", "", "24", "C1", "Inactive"), Row("T2", "Heat pump", "", "10,24", "C1", "")));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        // Only the status of T1 changed: it is switched off, its other fields are not saved again.
        Assert.Empty(Calls("SP_MASTER_UPDATE_TECHNOLOGY"));
        var off = Assert.Single(Calls("SP_MASTER_ACTIVE__DEACTIVE_TECHNOLOGIES"));
        Assert.Equal(("9", "False"), (FakeSql.Arg(off.Args, "Id"), FakeSql.Arg(off.Args, "IsActive")));
        // Stored as the master's labels.
        var insert = Assert.Single(Calls("SP_MASTER_INSERT_TECHNOLOGY"));
        Assert.Equal(("10-Food products,24-Basic metals", "C1 -Energy"), (FakeSql.Arg(insert.Args, "Sectors"), FakeSql.Arg(insert.Args, "Categories")));
    }

    [Fact]
    public async Task Parameters_of_a_level_round_trip_and_new_ones_get_their_sectors_and_surveillance()
    {
        var admin = await Admin();
        var export = await Sheet(await admin.GetAsync("/api/staff/masters/parameters/bronze/excel"));
        Assert.Equal(["Code", "Name", "Description", "NIC sectors", "In surveillance"], export[0]);
        // A description starting with "-" is exported with an apostrophe (no formula) and read back without it: no change.
        Assert.Equal("'-Top management", export[1][2]);
        var check = await (await admin.PostAsync("/api/staff/masters/parameters/Bronze/excel/check", Upload(XlsxWriter.Write(
            [new XlsxSheet("Sheet1", export[0]!.Select(h => h!).ToList(), export.Skip(1).Select(r => (IReadOnlyList<object?>)r.Cast<object?>().ToList()))])))).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1, check.GetProperty("unchanged").GetInt32());

        var r = await admin.PostAsync("/api/staff/masters/parameters/Bronze/excel/apply", Xlsx(["Code", "Name", "Description", "NIC sectors", "In surveillance"],
            Row("P2", "Safety", "", "10", "yes"), Row("P3", "Quality", "", "", "maybe")));
        var applied = await r.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal((1, 1), (applied.GetProperty("added").GetInt32(), applied.GetProperty("failed").GetInt32()));
        Assert.Equal(("Bronze", "P2"), (FakeSql.Arg(Assert.Single(Calls("SP_MASTER_INSERT_SECTION")).Args, "SectionType"), FakeSql.Arg(Calls("SP_MASTER_INSERT_SECTION")[0].Args, "SectionCode")));
        Assert.Equal("10", FakeSql.Arg(Assert.Single(Calls(StaffMastersController.NicSectorsByCodeSql)).Args, "NicSectors"));
        Assert.Equal("Yes", FakeSql.Arg(Assert.Single(Calls(StaffMastersController.SurveillanceByCodeSql)).Args, "SurveMandatories"));

        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync("/api/staff/masters/parameters/Platinum/excel")).StatusCode);
    }

    [Fact]
    public async Task Regions_are_matched_by_list_state_and_district_and_added_or_enabled()
    {
        var regions = new List<SpecialRegionsController.RegionRow> { new("ASPIRATIONAL", "9", "170", true, "ADMIN1", null, "UTTAR PRADESH", "SONBHADRA") };
        _host.Sql.Queries["SELECT x.Category, x.StateCode"] = _ => regions.Cast<object>();
        _host.Sql.Queries["SELECT LTRIM(RTRIM(StateCode)) AS Code, StateName AS Name FROM dbo.States"] = _ => [new SpecialRegionsController.Option("9", "UTTAR PRADESH")];
        _host.Sql.Queries["SELECT LTRIM(RTRIM(DistrictCode)) AS Code, DistrictName AS Name FROM dbo.Districts"] = _ => [new SpecialRegionsController.Option("164", "KANPUR NAGAR")];
        _host.Sql.Queries[SpecialRegionsController.AllDistrictsSql] = _ => [new SpecialRegionsController.DistrictOption("9", "164", "KANPUR NAGAR")];
        _host.Sql.Queries["SELECT COUNT(*) AS Total FROM dbo.Districts"] = _ => [new SpecialRegionsController.CountRow(112)];
        var admin = await Admin();
        var export = await Sheet(await admin.GetAsync("/api/staff/masters/regions/excel"));
        Assert.Equal(["Aspirational Districts", "9", "170", "UTTAR PRADESH", "SONBHADRA", "Enabled"], export[1]);

        var columns = SpecialRegionsController.Sheet.Columns.Select(c => c.Name).ToList();
        var r = await admin.PostAsync("/api/staff/masters/regions/excel/apply", Xlsx(columns,
            Row("aspirational", "9", "170", "", "", "Disabled"), Row("Aspirational Districts", "9", "164", "", "", ""), Row("LWE Districts", "9", "", "", "", ""),
            Row("Himalayan Region", "9", "", "", "", "Enabled")));
        var applied = await r.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal((2, 1, 1), (applied.GetProperty("added").GetInt32(), applied.GetProperty("updated").GetInt32(), applied.GetProperty("failed").GetInt32()));
        Assert.Equal("LWE Districts are districts: District code is required.", applied.GetProperty("rows")[2].GetProperty("errors")[0].GetString());
        Assert.Equal("KANPUR NAGAR", applied.GetProperty("rows")[1].GetProperty("values")[4].GetString());
        Assert.Contains(_host.Sql.Calls, c => c.Name.StartsWith("UPDATE dbo.Districts SET SubsidyAspirational", StringComparison.Ordinal)
            && FakeSql.Arg(c.Args, "DistrictCode") == "170" && FakeSql.Arg(c.Args, "Value") == "False");
        Assert.Contains(_host.Sql.Calls, c => c.Name.StartsWith("UPDATE dbo.States SET SubsidyHimalayan", StringComparison.Ordinal));
    }

    [Fact]
    public async Task The_lgd_export_is_a_district_list_the_lgd_upload_reads()
    {
        _host.Sql.Queries[LgdDirectoryController.ExportSql] = _ => [new LgdDirectoryController.ExportRow("9", "UTTAR PRADESH", "164", "KANPUR NAGAR")];
        var admin = await Admin();
        var export = await Sheet(await admin.GetAsync("/api/staff/masters/lgd/excel"));
        var (districts, error) = LgdDirectoryController.Parse(export);
        Assert.Null(error);
        Assert.Equal(new LgdDirectoryController.LgdDistrict("9", "UTTAR PRADESH", "164", "KANPUR NAGAR"), Assert.Single(districts!));
        Assert.Single(await Sheet(await admin.GetAsync("/api/staff/masters/lgd/excel/template")));
    }

    [Fact]
    public async Task Incentives_are_matched_by_type_and_title_and_existing_levels_are_kept()
    {
        _host.Sql.Procs["SP_MASTER_GET_INCENTIVES"] = args => FakeSql.Arg(args, "IncentiveType") == "Common"
            ? FakeSql.Sets([new
            {
                Id = 41L, IncentiveType = "Common", Incentive = "Scheme A", Details = "Support", MinistryOrDepartment = "MoMSME", ContactPerson = "Desk",
                WebLink = "https://msme.gov.in", Email = "desk@msme.gov.in", MobileNo = "011-2306", VideoLink = "", ApplicableForBronze = true,
                ApplicableForSilver = false, ApplicableForGold = false, ActiveStatus = true, OrderNo = 1, DisplayOn = (string?)null, CardHighlight = "",
            }])
            : FakeSql.Sets([]);
        var admin = await Admin();
        var export = await Sheet(await admin.GetAsync("/api/staff/schemes/incentive-master/excel"));
        Assert.Equal(["Common", "Scheme A"], export[1][..2]);
        Assert.Equal("Stakeholder card", export[1][13]);

        var columns = IncentiveMasterController.Sheet.Columns.Select(c => c.Name).ToList();
        string?[] Incentive(string type, string title, string bronze, string status = "Active", string silver = "Yes") =>
            [type, title, "Support", "MoMSME", "Desk", "desk@msme.gov.in", "011-2306", "https://msme.gov.in", "", bronze, silver, "No", status, "", ""];
        var r = await admin.PostAsync("/api/staff/schemes/incentive-master/excel/apply", Xlsx(columns,
            Incentive("common", "scheme a", "Yes", "Inactive"), Incentive("UTTAR PRADESH", "State scheme", "Yes"), Incentive("Mars", "X", "Yes"), Incentive("Other", "No levels", "No", silver: "No")));
        var applied = await r.Content.ReadFromJsonAsync<JsonElement>();
        var rows = applied.GetProperty("rows");
        Assert.Equal((1, 1, 2), (applied.GetProperty("added").GetInt32(), applied.GetProperty("updated").GetInt32(), applied.GetProperty("failed").GetInt32()));
        Assert.StartsWith("The levels of an existing incentive stay as they are", rows[0].GetProperty("notes")[0].GetString());
        Assert.Equal("No", rows[0].GetProperty("values")[10].GetString());
        Assert.StartsWith("Type must be", rows[2].GetProperty("errors")[0].GetString());
        Assert.Equal("A new incentive needs at least one level: Bronze, Silver or Gold.", rows[3].GetProperty("errors")[0].GetString());
        var update = Assert.Single(Calls("SP_MASTER_UPDATE_INCENTIVE"));
        Assert.Equal(("41", "False"), (FakeSql.Arg(update.Args, "Id"), FakeSql.Arg(update.Args, "ActiveStatus")));
        Assert.Equal("UTTAR PRADESH", FakeSql.Arg(Assert.Single(Calls("SP_MASTER_INSERT_INCENTIVE")).Args, "IncentiveType"));
    }
}
