using System.Data;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Zed.Core.Data;

namespace Zed.Main.Api.Tests;

public sealed class MsmeSchemesTuTests : IDisposable
{
    private const string Me = MsmeSchemesTestSupport.Me;
    private const string Other = MsmeSchemesTestSupport.Other;
    private const string Details = "SP_APP_MSME_INSERT_TECHNOLOGY_DETAILS";
    private const string Final = "SP_APP_MSME_INSERT_TECHNOLOGY_UPGRADATION";
    private readonly TestHost _host = new();

    private int? _benefits = 1;
    private int? _tuFlag = 1;
    private string _listFlag = "1";
    private bool _submitted;

    public MsmeSchemesTuTests()
    {
        MsmeSchemesTestSupport.RegisterUsers(_host);
        _host.Sql.Procs["SP_MSME_GET_DETAILS"] = args => FakeSql.Arg(args, "CertificationType") == "Techupgrade"
            ? FakeSql.Sets([], [], [], [], [new { Certification = "Silver", CertId = 4405, SubsidyPercentage = 80 }])
            : MsmeSchemesTestSupport.MsmeDetails(FakeSql.Arg(args, "ZedId")!, isEligibleForBenefits: _benefits, tuFlag: _tuFlag);
        _host.Sql.Procs["SP_TECHNOLOGY_UPGRADATION_GET_LIST"] = args => FakeSql.Arg(args, "ZedId") != Me
            ? FakeSql.Sets([], [], [], [])
            : FakeSql.Sets(
                [
                    new Dictionary<string, object?>
                    {
                        ["Id"] = 1, ["TechnologyCode"] = "T1", ["TechnologyName"] = "Solar rooftop", ["Description"] = "PV", ["Submitted"] = _submitted ? 1 : 0,
                        ["CertId"] = 4405, ["CertificationType"] = "Silver", ["SNo"] = 1, ["EligibleSubsidyPer"] = 80m, ["DaysLimit"] = 30,
                    },
                    new Dictionary<string, object?>
                    {
                        ["Id"] = 2, ["TechnologyCode"] = "T2", ["TechnologyName"] = "LED lighting", ["Submitted"] = 0, ["CertId"] = 4405,
                        ["CertificationType"] = "Silver", ["SNo"] = 2, ["EligibleSubsidyPer"] = 80m, ["DaysLimit"] = 30,
                    },
                ],
                _submitted
                    ? [new Dictionary<string, object?>
                    {
                        ["TechnologyCode"] = "T1", ["NameOfTheManufaturer"] = "Acme Solar", ["AmountPaid"] = "500000", ["EligibleAmount"] = "400000",
                        ["InvoiceNo"] = "I-9", ["FinancialAssistanceId"] = 55, ["ZedId"] = Me,
                    }]
                    : [],
                [new Dictionary<string, object?> { ["photoPath"] = "20240101100000000aaaaaaaa.jpg", ["photoType"] = "Purchased Technology", ["TechnologyCode"] = "T1", ["AssessorRemarks"] = "internal" }],
                [new Dictionary<string, object?> { ["TechnologyUpgradation"] = _listFlag }]);
        _host.Sql.Procs[Details] = _ => FakeSql.Sets([new { Status = 1, ErrorMessage = "Data submitted Successfully." }]);
        _host.Sql.Procs["SP_EMAIL_GET_DETAILS_TECHNOLOGY_UPGRADATION"] = _ => FakeSql.Sets([new { EmailId = "msme@acme.test", Password = "Secret#123" }]);
    }

    public void Dispose() => _host.Dispose();

    private Task<HttpClient> SignIn(string zedId = Me) => MsmeSchemesTestSupport.MsmeAsync(_host, zedId);

    private async Task<string> UploadAsync(HttpClient client, string type)
    {
        var r = await client.PostAsync("/api/msme/schemes/tu/documents", MsmeSchemesTestSupport.Upload(type, MsmeSchemesTestSupport.Pdf));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        return (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("fileName").GetString()!;
    }

    private async Task<JsonNode> TechnologyAsync(HttpClient client, decimal amount = 100001m) => JsonSerializer.SerializeToNode(new
    {
        nameOfTheManufaturer = "Acme Solar", makeOrModelName = "X-100", dateOfPurchase = DateTime.Today.AddDays(-3).ToString("yyyy-MM-dd"),
        agencyOrSupplier = "Supplier", invoiceNo = "INV-7", invoiceBillDate = DateTime.Today.AddDays(-2).ToString("yyyy-MM-dd"),
        amountPaid = amount, modeOfPayment = "Offline",
        documents = new[]
        {
            new { fileName = await UploadAsync(client, "Purchased Technology"), type = "Purchased Technology" },
            new { fileName = await UploadAsync(client, "Copy of Invoice"), type = "Copy of Invoice" },
        },
        certId = "1", eligibleAmount = 1, // ignored
    })!;

    [Fact]
    public async Task Signed_out_is_401_and_staff_is_403()
    {
        var anonymous = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/msme/schemes/tu")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.PostAsJsonAsync("/api/msme/schemes/tu/technologies/T1", new { })).StatusCode);
        var staff = await MsmeSchemesTestSupport.StaffAsync(_host);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync("/api/msme/schemes/tu")).StatusCode);
    }

    [Fact]
    public async Task Lists_the_signed_in_units_technologies_with_certification_from_the_server()
    {
        _submitted = true;
        var client = await SignIn();
        var r = await client.GetAsync($"/api/msme/schemes/tu?zedId={Other}");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var body = await r.Content.ReadAsStringAsync();
        var j = JsonDocument.Parse(body).RootElement;

        Assert.True(j.GetProperty("canApply").GetBoolean());
        Assert.Equal("Silver", j.GetProperty("certification").GetString());
        Assert.Equal(DateTime.Today.AddDays(-30).ToString("yyyy-MM-dd"), j.GetProperty("minDate").GetString());
        var list = Assert.Single(MsmeSchemesTestSupport.CallsTo(_host, "SP_TECHNOLOGY_UPGRADATION_GET_LIST"));
        Assert.Equal(Me, FakeSql.Arg(list, "ZedId"));
        Assert.Equal("Silver", FakeSql.Arg(list, "Certification"));
        Assert.Equal("4405", FakeSql.Arg(list, "CertId"));

        var techs = j.GetProperty("technologies").EnumerateArray().ToList();
        Assert.Equal(2, techs.Count);
        Assert.True(techs[0].GetProperty("submitted").GetBoolean());
        Assert.Equal("Acme Solar", techs[0].GetProperty("details").GetProperty("NameOfTheManufaturer").GetString());
        Assert.Equal("/api/msme/schemes/tu/files/20240101100000000aaaaaaaa.jpg", techs[0].GetProperty("documents")[0].GetProperty("url").GetString());
        Assert.False(techs[1].GetProperty("submitted").GetBoolean());
        Assert.Equal(500000m, j.GetProperty("totalAmount").GetDecimal());
        Assert.Equal(300000m, j.GetProperty("eligibleTotal").GetDecimal());
        foreach (var hidden in new[] { "internal", "Secret#1", "9999999999", "FinancialAssistanceId" })
            Assert.DoesNotContain(hidden, body);
    }

    [Fact]
    public async Task Units_that_may_not_apply_get_a_message_and_no_list()
    {
        var client = await SignIn();
        _tuFlag = 0;
        var j = await client.GetFromJsonAsync<JsonElement>("/api/msme/schemes/tu");
        Assert.False(j.GetProperty("canApply").GetBoolean());
        Assert.Equal("Data already submitted.", j.GetProperty("message").GetString());
        Assert.Equal(0, j.GetProperty("technologies").GetArrayLength());

        _tuFlag = 1; _benefits = 0;
        j = await client.GetFromJsonAsync<JsonElement>("/api/msme/schemes/tu");
        Assert.Equal("You are not eligible for benefits. Please contact ZED team.", j.GetProperty("message").GetString());

        _benefits = 1; _listFlag = "0";
        j = await client.GetFromJsonAsync<JsonElement>("/api/msme/schemes/tu");
        Assert.False(j.GetProperty("canApply").GetBoolean());
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync("/api/msme/schemes/tu/documents",
            MsmeSchemesTestSupport.Upload("Copy of Invoice", MsmeSchemesTestSupport.Pdf))).StatusCode);
    }

    [Fact]
    public async Task Technology_details_use_server_values_for_certification_and_amount()
    {
        var client = await SignIn();
        var req = await TechnologyAsync(client);
        var r = await client.PostAsJsonAsync("/api/msme/schemes/tu/technologies/T1", req);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);

        var args = Assert.Single(MsmeSchemesTestSupport.CallsTo(_host, Details));
        Assert.Equal(Me, FakeSql.Arg(args, "ZedId"));
        Assert.Equal("Silver", FakeSql.Arg(args, "CertificationType"));
        Assert.Equal("4405", FakeSql.Arg(args, "CertId"));
        Assert.Equal("T1", FakeSql.Arg(args, "TechnologyCode"));
        Assert.Equal("100001", FakeSql.Arg(args, "AmountPaid"));
        Assert.Equal("80000.8", FakeSql.Arg(args, "EligibleAmount"));
        Assert.Equal(2, MsmeSchemesTestSupport.PhotoList(args).Rows.Count);
    }

    [Fact]
    public async Task A_submitted_technology_can_be_sent_again_with_its_recorded_documents()
    {
        _submitted = true;
        var client = await SignIn();
        var req = await TechnologyAsync(client);
        // The purchased-technology picture recorded earlier (name not generated by this upload) is kept.
        req["documents"]![0]!["fileName"] = "20240101100000000aaaaaaaa.jpg";
        var r = await client.PostAsJsonAsync("/api/msme/schemes/tu/technologies/T1", req);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var rows = MsmeSchemesTestSupport.PhotoList(Assert.Single(MsmeSchemesTestSupport.CallsTo(_host, Details))).Rows.Cast<DataRow>().ToList();
        Assert.Equal("20240101100000000aaaaaaaa.jpg", rows[0]["PhotoId"]);

        // A recorded document of another technology is not accepted.
        var t2 = await TechnologyAsync(client);
        t2["documents"]![0]!["fileName"] = "20240101100000000aaaaaaaa.jpg";
        Assert.Equal("Please upload the required documents.", await (await client.PostAsJsonAsync("/api/msme/schemes/tu/technologies/T2", t2)).ProblemTitle());
    }

    [Fact]
    public async Task Technology_details_are_checked()
    {
        var client = await SignIn();
        var req = await TechnologyAsync(client);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync("/api/msme/schemes/tu/technologies/T9", req)).StatusCode);

        var old = req.DeepClone();
        old["dateOfPurchase"] = DateTime.Today.AddDays(-31).ToString("yyyy-MM-dd");
        Assert.Contains("date of purchase", await (await client.PostAsJsonAsync("/api/msme/schemes/tu/technologies/T1", old)).ProblemTitle());

        var oneDoc = req.DeepClone();
        oneDoc["documents"]!.AsArray().RemoveAt(1);
        Assert.Equal("Please upload the required documents.", await (await client.PostAsJsonAsync("/api/msme/schemes/tu/technologies/T1", oneDoc)).ProblemTitle());

        var cheque = req.DeepClone();
        cheque["documents"]![1]!["type"] = "Copy of Cancelled Cheque";
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/msme/schemes/tu/technologies/T1", cheque)).StatusCode);
        Assert.Empty(MsmeSchemesTestSupport.CallsTo(_host, Details));

        _host.Sql.Procs[Details] = _ => FakeSql.Sets([new { Status = 0, ErrorMessage = "Not eligible to submit the data for this Unit." }]);
        var refused = await client.PostAsJsonAsync("/api/msme/schemes/tu/technologies/T1", req);
        Assert.Equal("Not eligible to submit the data for this Unit.", await refused.ProblemTitle());
    }

    [Fact]
    public async Task Final_submission_needs_a_submitted_technology_and_mails_the_msme()
    {
        var client = await SignIn();
        var cheque = await UploadAsync(client, "Copy of Cancelled Cheque");
        var req = new
        {
            account = new { accountNo = "123456789012", confirmAccountNo = "123456789012", ifscCode = "SBIN0001234", branchAddress = "MG Road", bankName = "SBI" },
            documents = new[] { new { fileName = cheque, type = "Copy of Cancelled Cheque" } },
            declaration = true,
        };
        var none = await client.PostAsJsonAsync("/api/msme/schemes/tu", req);
        Assert.Equal("Please submit the details of at least one technology.", await none.ProblemTitle());
        Assert.Empty(MsmeSchemesTestSupport.CallsTo(_host, Final));

        _submitted = true;
        var r = await client.PostAsJsonAsync("/api/msme/schemes/tu", req);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var args = Assert.Single(MsmeSchemesTestSupport.CallsTo(_host, Final));
        Assert.Equal(Me, FakeSql.Arg(args, "ZedId"));
        Assert.Equal("4405", FakeSql.Arg(args, "CertId"));
        Assert.Equal("Silver", FakeSql.Arg(args, "CertificationType"));
        var photo = Assert.Single(MsmeSchemesTestSupport.PhotoList(args).Rows.Cast<DataRow>());
        Assert.Equal("Copy of Cancelled Cheque", photo["Name"]);

        var mail = Assert.Single(_host.Email.Sent);
        Assert.Equal("msme@acme.test", mail.To);
        Assert.Equal($"Confirmation of Application for Financial Support for Zero Effect Solution - {Me}", mail.Subject);
        Assert.DoesNotContain("Secret#123", mail.HtmlBody);
    }

    [Fact]
    public async Task Final_submission_is_refused_once_submitted_and_hides_procedure_errors()
    {
        _submitted = true;
        var client = await SignIn();
        var req = new
        {
            account = new { accountNo = "123456789012", confirmAccountNo = "123456789012", ifscCode = "SBIN0001234", branchAddress = "MG Road", bankName = "SBI" },
            documents = new[] { new { fileName = await UploadAsync(client, "Copy of Cancelled Cheque"), type = "Copy of Cancelled Cheque" } },
            declaration = true,
        };
        _host.Sql.Procs[Final] = _ => throw new MsmeSchemesTestSupport.FakeDbException("Conversion failed when converting the varchar value 'ABC' to data type bit.");
        var r = await client.PostAsJsonAsync("/api/msme/schemes/tu", req);
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.DoesNotContain("Conversion", await r.ProblemTitle());

        _tuFlag = 0;
        Assert.Equal("Data already submitted.", await (await client.PostAsJsonAsync("/api/msme/schemes/tu", req)).ProblemTitle());
        Assert.Empty(_host.Email.Sent);
    }
}
