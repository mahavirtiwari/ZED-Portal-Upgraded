using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Core.Data;
using Zed.Portal.Features.Staff.Schemes;

namespace Zed.Main.Api.Tests;

public sealed class MsmeSchemesIncentiveTests : IDisposable
{
    private readonly TestHost _host = new();

    public MsmeSchemesIncentiveTests()
    {
        MsmeSchemesTestSupport.RegisterUsers(_host);
        _host.Sql.Procs["SP_GET_INCENTIVES"] = args => FakeSql.Arg(args, "CertificationType") is null
            ? FakeSql.Sets([], [], [], [], [])
            : FakeSql.Sets(
                [
                    Row(11, "Ministry of MSME", "CLCS-TUS", "https://msme.gov.in/clcs"),
                    Row(12, "Ministry of MSME", "Bad link", "javascript:alert(1)"),
                ],
                [Row(21, "UP Government", "State scheme", "---")],
                [Row(31, "Other dept", "Other scheme", "http://other.test/x")],
                [Row(41, "SIDBI", "Loan", "https://sidbi.test")],
                [new { MinistryOrDepartment = "SIDBI" }]);
        _host.Sql.Procs["SP_GET_API_INCENTIVES"] = _ => FakeSql.Sets([new
        {
            PUnitName = "Acme Unit", PStateName = "UTTAR PRADESH", Certification = "Bronze", ServiceName = "Subsidy", IncentiveName = "Capital",
            UdyamNo = "UDYAM-UP-29-0003915", ApplicationId = "APP-1", Gender = "female", DisbursedAmount = 125000m, Token = "tok-secret",
            UnitAddress = "Plot 4", Certificateno = "C-77", DataFrom = "API",
        }]);
    }

    private static Dictionary<string, object?> Row(long id, string ministry, string name, string link) => new()
    {
        ["Id"] = id, ["IncentiveType"] = "Common", ["MinistryOrDepartment"] = ministry, ["Incentive"] = name, ["Details"] = "<b>details</b>",
        ["ContactPerson"] = "Mr X", ["Email"] = "x@gov.test", ["MobileNo"] = "011-1234", ["WebLink"] = link, ["VideoLink"] = "javascript:void(0)",
        ["FilePath1"] = @"E:\Publish\ZEDCS_LIVE\ZEDCS_V2_LIVE\Uploads\Incentives/11File1.pdf", ["ActiveStatus"] = true,
    };

    public void Dispose() => _host.Dispose();

    [Fact]
    public async Task Details_are_public_with_safe_links_and_documents_of_listed_incentives()
    {
        MsmeSchemesTestSupport.WriteFile(_host, "Uploads/Incentives/11File1.pdf", MsmeSchemesTestSupport.Pdf);
        var client = await _host.CreateBrowserAsync();
        var r = await client.GetAsync("/api/public/incentives?ct=bronze&id=9");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var body = await r.Content.ReadAsStringAsync();
        var j = JsonDocument.Parse(body).RootElement;

        var call = Assert.Single(MsmeSchemesTestSupport.CallsTo(_host, "SP_GET_INCENTIVES"));
        Assert.Equal("Bronze", FakeSql.Arg(call, "CertificationType"));
        Assert.Equal("9", FakeSql.Arg(call, "State"));
        var common = j.GetProperty("common").EnumerateArray().ToList();
        Assert.Equal("https://msme.gov.in/clcs", common[0].GetProperty("webLink").GetString());
        Assert.Equal(JsonValueKind.Null, common[1].GetProperty("webLink").ValueKind);
        Assert.Equal(JsonValueKind.Null, common[0].GetProperty("videoLink").ValueKind);
        Assert.Equal("/api/public/incentives/11/documents/1?ct=Bronze", common[0].GetProperty("document1").GetString());
        Assert.Equal(JsonValueKind.Null, common[0].GetProperty("document2").ValueKind);
        Assert.Equal(JsonValueKind.Null, j.GetProperty("states")[0].GetProperty("webLink").ValueKind);
        Assert.Equal("SIDBI", j.GetProperty("financialDepartments")[0].GetString());
        Assert.DoesNotContain("Publish", body);
        Assert.DoesNotContain("javascript", body);

        var doc = await client.GetAsync("/api/public/incentives/11/documents/1?ct=Bronze");
        Assert.Equal(HttpStatusCode.OK, doc.StatusCode);
        Assert.Equal("application/pdf", doc.Content.Headers.ContentType?.MediaType);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/public/incentives/99/documents/1?ct=Bronze")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/public/incentives/11/documents/3?ct=Bronze")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/public/incentives/11/documents/1")).StatusCode);
    }

    [Fact]
    public async Task Details_reject_invalid_filters()
    {
        var client = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/public/incentives?ct=Platinum")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/public/incentives?ct=Gold&id=1000")).StatusCode);
        var none = await client.GetFromJsonAsync<JsonElement>("/api/public/incentives");
        Assert.Equal(0, none.GetProperty("common").GetArrayLength());
    }

    [Fact]
    public async Task Public_submissions_show_no_personal_columns_and_no_gender_filter()
    {
        var client = await _host.CreateBrowserAsync();
        var r = await client.GetAsync("/api/public/incentives/submissions?id=9&ct=Bronze&msmeSize=micro&gender=female&un=UDYAM-UP-29-0003915");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var body = await r.Content.ReadAsStringAsync();
        var row = JsonDocument.Parse(body).RootElement[0];
        Assert.Equal(["PUnitName", "PStateName", "Certification", "ServiceName", "IncentiveName", "DataFrom"],
            row.EnumerateObject().Select(p => p.Name).ToArray());
        foreach (var hidden in new[] { "UDYAM", "APP-1", "female", "125000", "tok-secret", "C-77", "Plot 4" })
            Assert.DoesNotContain(hidden, body);

        var call = Assert.Single(MsmeSchemesTestSupport.CallsTo(_host, "SP_GET_API_INCENTIVES"));
        Assert.Null(FakeSql.Arg(call, "Gender"));
        Assert.Null(FakeSql.Arg(call, "UdyamNo"));
        Assert.Equal("Micro", FakeSql.Arg(call, "MsmeSize"));
        Assert.Equal("9", FakeSql.Arg(call, "State"));

        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/public/incentives/submissions?msmeSize=Huge")).StatusCode);
    }

    [Fact]
    public async Task Template_is_for_the_master_admin_and_has_the_upload_columns()
    {
        var anonymous = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/staff/schemes/incentives/template")).StatusCode);
        var msme = await MsmeSchemesTestSupport.MsmeAsync(_host);
        Assert.Equal(HttpStatusCode.Forbidden, (await msme.GetAsync("/api/staff/schemes/incentives/template")).StatusCode);

        var admin = await MsmeSchemesTestSupport.StaffAsync(_host);
        var r = await admin.GetAsync("/api/staff/schemes/incentives/template");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("IncentiveTemplate.xlsx", r.Content.Headers.ContentDisposition?.FileName?.Trim('"'));
        await using var stream = await r.Content.ReadAsStreamAsync();
        var rows = XlsxSheetReader.ReadFirstSheet(stream);
        Assert.Equal(IncentivesController.Columns.Select(c => c.Name).ToArray(), rows[0].Select(c => c ?? "").Where(c => c.Length > 0).ToArray());
    }
}
