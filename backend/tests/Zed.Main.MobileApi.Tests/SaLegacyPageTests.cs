using System.Text.Json;

namespace Zed.Main.MobileApi.Tests;

/// <summary>The four hotel self-assessment actions that carry a registration number and no identity.</summary>
public sealed class SaLegacyPageTests : IDisposable
{
    private readonly AssessorTestHost _t = new();

    public void Dispose() => _t.Dispose();

    [Fact]
    public async Task Registration_details_fall_back_to_the_empty_dataset_when_the_procedure_is_missing()
    {
        _t.Sql.Failing["SP_SA_GET_REG_DETAILS"] = true;
        var r = await _t.Client.PostAsync("/SA/GetSiteAssessmentDetails",
            new StringContent("{\"registrationNo\":\"UC1\"}", System.Text.Encoding.UTF8, "application/json"));
        Assert.Equal("{}", await r.Content.ReadAsStringAsync());
        Assert.Equal("text/html", r.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task Registration_details_only_return_the_columns_the_page_reads()
    {
        _t.Fake.Procs["SP_SA_GET_REG_DETAILS"] = _ => FakeSql.Sets(
            [new Dictionary<string, object?> { ["SaDate"] = "2024-01-01", ["UtrNumber"] = "U1", ["MobileNo"] = "9999", ["EmailId"] = "a@b", ["Password"] = "x" }],
            [new Dictionary<string, object?> { ["Amount"] = 10m, ["Gst"] = 1.8m, ["Total"] = 11.8m, ["CaseNumber"] = 2 }]);
        var e = await _t.Json("/SA/GetSiteAssessmentDetails", new { registrationNo = "UC1" });
        var row = e.GetProperty("Table")[0];
        Assert.Equal("U1", row.GetProperty("UtrNumber").GetString());
        Assert.False(row.TryGetProperty("MobileNo", out _));
        Assert.False(row.TryGetProperty("EmailId", out _));
        Assert.False(row.TryGetProperty("Password", out _));
        Assert.Equal(11.8m, e.GetProperty("Table1")[0].GetProperty("Total").GetDecimal());
        Assert.Equal("UC1", AssessorTestHost.Arg(_t.LastArgs("SP_SA_GET_REG_DETAILS"), "RegistrationNo"));
    }

    [Fact]
    public async Task Declaration_update_answers_like_before()
    {
        var (e, type, _) = await _t.Post("/SA/UpdateSaDeclaration", new { registrationNo = "UC1" });
        Assert.Equal("text/html", type);
        Assert.Equal("1", e.GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.Null, e.GetProperty("errorMessage").ValueKind);
        Assert.Equal("UC1", AssessorTestHost.Arg(_t.LastArgs("SP_SA_UPDATE_DECLARATION"), "RegistrationNumber"));
    }

    [Fact]
    public async Task Sa_registration_checks_the_date_first()
    {
        var valid = "0";
        _t.Fake.Procs["SP_SA_CHECK_VALID_DATE"] = _ => FakeSql.Sets([new { ValidDate = valid }]);
        var (e, type, _) = await _t.Post("/SA/SubmitSaReg", new { SaDate = "2024-01-01", RegistrationNumber = "UC1" });
        Assert.Equal("text/html", type);
        Assert.Equal("Please select valid date.", e.GetProperty("errorMessage").GetString());
        Assert.Empty(_t.CallsTo("SP_SA_INSERT_REGISTRATION_DATA"));

        valid = "1";
        e = await _t.Json("/SA/SubmitSaReg", new { SaDate = "2024-01-01", RegistrationNumber = "UC1" });
        Assert.Equal("1", e.GetProperty("status").GetString());
        Assert.Equal("2024-01-01", AssessorTestHost.Arg(_t.LastArgs("SP_SA_INSERT_REGISTRATION_DATA"), "SaDate"));
    }

    [Fact]
    public async Task Sa_registration_for_an_unknown_number_fails_without_exception_text()
    {
        var (e, type, _) = await _t.Post("/SA/SubmitSaReg", new { SaDate = "x", RegistrationNumber = "none" });
        Assert.Equal("application/json", type);
        Assert.Equal("0", e.GetProperty("status").GetString());
        Assert.Equal("An error has occurred, please try again later.", e.GetProperty("errorMessage").GetString());
    }

    [Fact]
    public async Task Amounts_are_the_fee_table()
    {
        _t.Fake.Procs["SP_SA_GET_AMOUNTS_MASTER"] = _ => FakeSql.Sets([new { CaseNumber = 1, Amount = 5000m }]);
        var e = await _t.Json("/SA/GetAmounts", new { });
        Assert.Equal(5000m, e.GetProperty("Table")[0].GetProperty("Amount").GetDecimal());
    }
}
