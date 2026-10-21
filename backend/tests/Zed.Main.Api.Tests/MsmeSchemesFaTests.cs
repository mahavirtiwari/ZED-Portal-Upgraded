using System.Data;
using System.Data.Common;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Reflection;
using System.Text.Json;
using Zed.Core.Data;

namespace Zed.Main.Api.Tests;

/// <summary>Users and helpers of the MSME scheme tests (FA, TU, incentives).</summary>
internal static class MsmeSchemesTestSupport
{
    public const string Me = "ZEDMSME000001";
    public const string Other = "ZEDMSME000002";
    public const string Staff = "MADMIN";

    public static readonly byte[] Pdf = "%PDF-1.4\n%test\n"u8.ToArray();
    public static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3];

    /// <summary>MSMEs Me and Other (role 5), a master admin (role 7) with every sub-role.</summary>
    public static void RegisterUsers(TestHost host)
    {
        host.Sql.Procs["SP_GET_USER_DETAILS"] = args => FakeSql.Arg(args, "UserId") switch
        {
            Me or Other => FakeSql.Sets([new { UserId = FakeSql.Arg(args, "UserId"), UserName = "Acme", RoleId = 5, Email = "a@acme.test" }], [new { ERRORMSG = "SUCCESS" }]),
            Staff => FakeSql.Sets([new { UserId = Staff, UserName = "Master", RoleId = 7, Email = "m@x.test" }], [new { ERRORMSG = "SUCCESS" }]),
            _ => FakeSql.Sets([], [new { ERRORMSG = "INVALID CREDENTIAILS" }]),
        };
        host.Sql.Procs["SP_GET_SUB_ROLE"] = _ => FakeSql.Sets([new { DesktopVerification = 1, SiteVerification = 1, FinancialVerification = 1 }]);
    }

    public static async Task<HttpClient> MsmeAsync(TestHost host, string zedId = Me)
    {
        var client = await host.CreateBrowserAsync();
        (await client.PostAsJsonAsync("/api/msme/auth/login", new { userId = zedId, password = "Right#Pass1" })).EnsureSuccessStatusCode();
        return client;
    }

    public static async Task<HttpClient> StaffAsync(TestHost host)
    {
        var client = await host.CreateBrowserAsync();
        (await client.PostAsJsonAsync("/api/staff/auth/login", new { userId = Staff, password = "Right#Pass1" })).EnsureSuccessStatusCode();
        return client;
    }

    /// <summary>SP_MSME_GET_DETAILS (no certification type) for the dashboard-like panel and flags.</summary>
    public static ResultSets MsmeDetails(string zedId, int? isEligibleForFinancial = 1, int? isEligibleForBenefits = 1, int? faStatus = 1, int? tuFlag = 1) =>
        FakeSql.Sets(
            [new Dictionary<string, object?>
            {
                ["ZedId"] = zedId, ["EnterpriseName"] = "Acme Castings", ["EnterpriseType"] = "Micro", ["RegistrationType"] = "UDYAM",
                ["PUnitName"] = "Unit 1", ["PAddress"] = "Plot 4", ["PStateName"] = "UTTAR PRADESH", ["Password"] = "Secret#1",
                ["MobileNo"] = "9999999999", ["PledgeEmailId"] = "a@acme.test",
            }],
            [new Dictionary<string, object?>
            {
                ["UdyogAadharNo"] = "UDYAM-UP-29-0003915", ["PanNo"] = "ABCDE1234F",
                ["IsEligibleForFinancial"] = isEligibleForFinancial, ["IsEligibleForBenefits"] = isEligibleForBenefits,
            }],
            [new Dictionary<string, object?> { ["FinancialAssistanceStatus"] = faStatus, ["TechnologyUpgradationStatus"] = tuFlag }]);

    public static MultipartFormDataContent Upload(string type, byte[] content, string fileName = "doc.pdf", string contentType = "application/pdf")
    {
        var file = new ByteArrayContent(content);
        file.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        return new MultipartFormDataContent { { new StringContent(type), "type" }, { file, "file", fileName } };
    }

    public static string WriteFile(TestHost host, string relative, byte[] content)
    {
        var path = Path.Combine(host.StorageRoot, relative.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllBytes(path, content);
        return path;
    }

    /// <summary>The rows of the DynamicPhotoList table-valued parameter passed to a procedure.</summary>
    public static DataTable PhotoList(object? args)
    {
        var tvp = args!.GetType().GetProperty("PhotoListWeb")!.GetValue(args)!;
        var field = tvp.GetType().GetFields(BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public)
            .First(f => f.FieldType == typeof(DataTable));
        return (DataTable)field.GetValue(tvp)!;
    }

    public static IEnumerable<object?> CallsTo(TestHost host, string proc) => host.Sql.Calls.Where(c => c.Name == proc).Select(c => c.Args);

    public sealed class FakeDbException(string message) : DbException(message);
}

public sealed class MsmeSchemesFaTests : IDisposable
{
    private const string Me = MsmeSchemesTestSupport.Me;
    private const string Other = MsmeSchemesTestSupport.Other;
    private const string Proc = "SP_APP_MSME_INSERT_FINANCIAL_ASSISTANCE";
    private readonly TestHost _host = new();

    private int? _eligibleFinancial = 1;
    private int? _eligibleBenefits = 1;
    private int? _faStatus = 1;
    private string? _current = "Silver";

    public MsmeSchemesFaTests()
    {
        MsmeSchemesTestSupport.RegisterUsers(_host);
        _host.Sql.Procs["SP_MSME_GET_DETAILS"] = args =>
            MsmeSchemesTestSupport.MsmeDetails(FakeSql.Arg(args, "ZedId")!, _eligibleFinancial, _eligibleBenefits, _faStatus);
        _host.Sql.Procs["SP_FINANCIAL_ASSISTANCE_GET_CURRENT_CERTIFICATE"] = _ =>
            _current is null ? FakeSql.Sets() : FakeSql.Sets([new { CertificationType = _current }]);
        _host.Sql.Procs["SP_FINANCIAL_ASSISTANCE_GET_DETAILS"] = args => FakeSql.Arg(args, "ZedId") != Me
            ? FakeSql.Sets([], [], [], [], [], [], [], [], [])
            : FakeSql.Sets(
                [],
                [new Dictionary<string, object?>
                {
                    ["Id"] = 501, ["ZedId"] = Me, ["CertificationType"] = "Silver", ["VerificationStatus"] = 2, ["FinancialAssistanceId"] = 77,
                    ["CategoryOfCertificate"] = "Quality", ["NameOfCertficate"] = "ISO 9001", ["AmountPaid"] = "40000", ["EligibleAmount"] = "30000",
                    ["AccountNo"] = "123456789012", ["FinancialAssessorId"] = "DA1", ["CertificationBodyUserId"] = "AGENCY1",
                    ["ReasonForRejectionAgency"] = "internal note", ["Comments"] = "internal",
                }],
                [], [],
                [
                    new Dictionary<string, object?> { ["Id"] = 1, ["PhotoId"] = "20240101100000.pdf", ["PhotoType"] = "Copy of Certificate", ["FinancialAssistanceId"] = 77, ["AssessorRemarks"] = "internal" },
                    new Dictionary<string, object?> { ["Id"] = 2, ["PhotoId"] = "../../web.config", ["PhotoType"] = "Copy of Invoice", ["FinancialAssistanceId"] = 77 },
                ],
                [], [], [], []);
        _host.Sql.Procs["SP_EMAIL_GET_DETAILS_FA"] = _ => FakeSql.Sets([new
        {
            EmailId = "msme@acme.test", EnterpriseName = "Acme", CategoryOfCertificate = "Quality", Password = "Secret#123", MsmePassword = "Msme#Pass1",
        }]);
    }

    public void Dispose() => _host.Dispose();

    private Task<HttpClient> SignIn(string zedId = Me) => MsmeSchemesTestSupport.MsmeAsync(_host, zedId);

    private async Task<string> UploadAsync(HttpClient client, string type, byte[]? content = null)
    {
        var r = await client.PostAsync("/api/msme/schemes/fa/documents", MsmeSchemesTestSupport.Upload(type, content ?? MsmeSchemesTestSupport.Pdf));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        return (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("fileName").GetString()!;
    }

    private async Task<object> ValidRequestAsync(HttpClient client, decimal amount = 100000m) => new
    {
        categoryOfCertificate = "Quality", nameOfCertficate = "ISO 9001", certificationAgency = "BIS", certficateNumber = "C-1",
        dateOfIssue = DateTime.Today.AddDays(-10).ToString("yyyy-MM-dd"), validityOfCertificate = 3, anyOtherInformation = "",
        invoiceNo = "INV-1", invoiceBillDate = DateTime.Today.AddDays(-5).ToString("yyyy-MM-dd"), amountPaid = amount, modeOfPayment = "Online",
        account = new { accountNo = "123456789012", confirmAccountNo = "123456789012", ifscCode = "sbin0001234", branchAddress = "MG Road", bankName = "SBI" },
        documents = new[]
        {
            new { fileName = await UploadAsync(client, "Copy of Certificate"), type = "Copy of Certificate" },
            new { fileName = await UploadAsync(client, "CA certificate of expenditure"), type = "CA certificate of expenditure" },
            new { fileName = await UploadAsync(client, "Copy of Invoice", MsmeSchemesTestSupport.Png), type = "Copy of Invoice" },
            new { fileName = await UploadAsync(client, "Copy of Cancelled Cheque"), type = "Copy of Cancelled Cheque" },
        },
        declaration = true,
        eligibleAmount = 999999, // ignored: computed on the server
    };

    [Fact]
    public async Task Signed_out_is_401_and_staff_is_403()
    {
        var anonymous = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/msme/schemes/fa")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.PostAsync("/api/msme/schemes/fa/documents",
            MsmeSchemesTestSupport.Upload("Copy of Invoice", MsmeSchemesTestSupport.Pdf))).StatusCode);

        var staff = await MsmeSchemesTestSupport.StaffAsync(_host);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync("/api/msme/schemes/fa")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.PostAsJsonAsync("/api/msme/schemes/fa", new { })).StatusCode);
    }

    [Fact]
    public async Task Page_uses_the_signed_in_unit_and_returns_only_shown_columns()
    {
        var client = await SignIn();
        var r = await client.GetAsync($"/api/msme/schemes/fa?zedId={Other}");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var body = await r.Content.ReadAsStringAsync();
        var json = JsonDocument.Parse(body).RootElement;

        Assert.True(json.GetProperty("canApply").GetBoolean());
        Assert.Equal("Silver", json.GetProperty("certification").GetString());
        Assert.Equal("UDYAM-UP-29-0003915", json.GetProperty("unit").GetProperty("UdyogAadharNo").GetString());
        Assert.All(MsmeSchemesTestSupport.CallsTo(_host, "SP_MSME_GET_DETAILS"), a => Assert.Equal(Me, FakeSql.Arg(a, "ZedId")));
        Assert.All(MsmeSchemesTestSupport.CallsTo(_host, "SP_FINANCIAL_ASSISTANCE_GET_DETAILS"), a => Assert.Equal(Me, FakeSql.Arg(a, "ZedId")));
        foreach (var hidden in new[] { "Secret#1", "9999999999", "ABCDE1234F", "AGENCY1", "DA1", "internal" })
            Assert.DoesNotContain(hidden, body);

        var app = json.GetProperty("applications")[0];
        Assert.Equal("Silver", app.GetProperty("certification").GetString());
        Assert.Equal("30000", app.GetProperty("details").GetProperty("EligibleAmount").GetString());
        // Only the safe document name is listed; the path-like one is dropped.
        var docs = app.GetProperty("documents").EnumerateArray().ToList();
        Assert.Single(docs);
        Assert.Equal("/api/msme/schemes/fa/files/20240101100000.pdf", docs[0].GetProperty("url").GetString());
    }

    [Fact]
    public async Task Not_eligible_already_submitted_or_not_certified_cannot_apply()
    {
        var client = await SignIn();
        _eligibleFinancial = 0;
        var j = await client.GetFromJsonAsync<JsonElement>("/api/msme/schemes/fa");
        Assert.False(j.GetProperty("canApply").GetBoolean());
        Assert.Equal("You are not eligible for benefits. Please contact ZED team.", j.GetProperty("message").GetString());

        _eligibleFinancial = 1; _faStatus = 0;
        j = await client.GetFromJsonAsync<JsonElement>("/api/msme/schemes/fa");
        Assert.Equal("Data already submitted.", j.GetProperty("message").GetString());
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync("/api/msme/schemes/fa/documents",
            MsmeSchemesTestSupport.Upload("Copy of Invoice", MsmeSchemesTestSupport.Pdf))).StatusCode);

        _faStatus = 1; _current = null;
        j = await client.GetFromJsonAsync<JsonElement>("/api/msme/schemes/fa");
        Assert.False(j.GetProperty("canApply").GetBoolean());
        Assert.Contains("ZED certified", j.GetProperty("message").GetString());
    }

    [Fact]
    public async Task Upload_checks_the_content_and_serves_files_only_to_their_owner()
    {
        var client = await SignIn();
        var exe = "MZ\x90\0fake"u8.ToArray();
        var bad = await client.PostAsync("/api/msme/schemes/fa/documents", MsmeSchemesTestSupport.Upload("Copy of Invoice", exe, "invoice.pdf"));
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync("/api/msme/schemes/fa/documents",
            MsmeSchemesTestSupport.Upload("../../x", MsmeSchemesTestSupport.Pdf))).StatusCode);

        var r = await client.PostAsync("/api/msme/schemes/fa/documents", MsmeSchemesTestSupport.Upload("Copy of Invoice", MsmeSchemesTestSupport.Pdf, "../../evil.aspx"));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var j = await r.Content.ReadFromJsonAsync<JsonElement>();
        var name = j.GetProperty("fileName").GetString()!;
        Assert.Matches(@"^\d{17}[0-9a-f]{8}\.pdf$", name);
        Assert.True(File.Exists(Path.Combine(_host.StorageRoot, "mobileapi", "Photos", Me, "FinancialAssistance", name)));

        var file = await client.GetAsync(j.GetProperty("url").GetString());
        Assert.Equal(HttpStatusCode.OK, file.StatusCode);
        Assert.Equal("application/pdf", file.Content.Headers.ContentType?.MediaType);
        Assert.Equal("nosniff", file.Headers.GetValues("X-Content-Type-Options").Single());

        var other = await SignIn(Other);
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync(j.GetProperty("url").GetString())).StatusCode);
        MsmeSchemesTestSupport.WriteFile(_host, "web.config", "<x/>"u8.ToArray());
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/msme/schemes/fa/files/..%2F..%2F..%2F..%2Fweb.config")).StatusCode);
    }

    [Fact]
    public async Task Submit_computes_the_amount_on_the_server_and_mails_the_msme_without_passwords()
    {
        var client = await SignIn();
        var r = await client.PostAsJsonAsync("/api/msme/schemes/fa", await ValidRequestAsync(client, 100000m));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var j = await r.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(50000m, j.GetProperty("eligibleAmount").GetDecimal());

        var args = Assert.Single(MsmeSchemesTestSupport.CallsTo(_host, Proc));
        Assert.Equal(Me, FakeSql.Arg(args, "ZedId"));
        Assert.Equal("50000", FakeSql.Arg(args, "EligibleAmount"));
        Assert.Equal("100000", FakeSql.Arg(args, "AmountPaid"));
        Assert.Equal("SBIN0001234", FakeSql.Arg(args, "IfscCode"));
        Assert.Equal("ISO 9001", FakeSql.Arg(args, "ExpenditureCertficate"));
        Assert.Equal("BIS", FakeSql.Arg(args, "AgencyOrSupplier"));
        Assert.Equal(DateTime.Today.AddDays(-10).ToString("MM/dd/yyyy", System.Globalization.CultureInfo.InvariantCulture), FakeSql.Arg(args, "DateOfIssue"));
        Assert.Equal("Web", FakeSql.Arg(args, "SubmittedFrom"));
        var photos = MsmeSchemesTestSupport.PhotoList(args);
        Assert.Equal(4, photos.Rows.Count);
        Assert.Equal(["Copy of Certificate", "CA certificate of expenditure", "Copy of Invoice", "Copy of Cancelled Cheque"],
            photos.Rows.Cast<DataRow>().Select(x => (string)x["Name"]).ToArray());

        var mail = Assert.Single(_host.Email.Sent);
        Assert.Equal("msme@acme.test", mail.To);
        Assert.Equal($"Confirmation of Application for Financial Assistance on Quality - {Me}", mail.Subject);
        Assert.DoesNotContain("Secret#123", mail.HtmlBody);
        Assert.DoesNotContain("Msme#Pass1", mail.HtmlBody);
    }

    [Fact]
    public async Task Eligible_amount_is_75_percent_of_the_whole_rupees()
    {
        var client = await SignIn();
        var r = await client.PostAsJsonAsync("/api/msme/schemes/fa", await ValidRequestAsync(client, 20001m));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("15000.75", FakeSql.Arg(Assert.Single(MsmeSchemesTestSupport.CallsTo(_host, Proc)), "EligibleAmount"));
    }

    [Fact]
    public async Task Submit_refuses_documents_of_another_unit_or_not_uploaded()
    {
        var client = await SignIn();
        var req = JsonSerializer.SerializeToNode(await ValidRequestAsync(client))!;
        // A generated-looking name that exists only in another MSME's folder.
        const string foreign = "20240101120000000abcdef01.pdf";
        MsmeSchemesTestSupport.WriteFile(_host, $"mobileapi/Photos/{Other}/FinancialAssistance/{foreign}", MsmeSchemesTestSupport.Pdf);
        req["documents"]![0]!["fileName"] = foreign;
        var r = await client.PostAsJsonAsync("/api/msme/schemes/fa", req);
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Equal("Please upload the required documents.", await r.ProblemTitle());

        req["documents"]![0]!["fileName"] = "../../../web.config";
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/msme/schemes/fa", req)).StatusCode);
        Assert.Empty(MsmeSchemesTestSupport.CallsTo(_host, Proc));
    }

    [Fact]
    public async Task Submit_checks_fields_documents_and_state_on_the_server()
    {
        var client = await SignIn();
        var req = JsonSerializer.SerializeToNode(await ValidRequestAsync(client))!;

        var noCa = req.DeepClone();
        noCa["documents"]!.AsArray().RemoveAt(1);
        Assert.Equal("Please upload the required documents.", await (await client.PostAsJsonAsync("/api/msme/schemes/fa", noCa)).ProblemTitle());

        var mismatch = req.DeepClone();
        mismatch["account"]!["confirmAccountNo"] = "999";
        Assert.Equal("Account Number and Re-Enter Account Number must match.", await (await client.PostAsJsonAsync("/api/msme/schemes/fa", mismatch)).ProblemTitle());

        var future = req.DeepClone();
        future["invoiceBillDate"] = DateTime.Today.AddDays(2).ToString("yyyy-MM-dd");
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/msme/schemes/fa", future)).StatusCode);

        var category = req.DeepClone();
        category["categoryOfCertificate"] = "Gold plating";
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/msme/schemes/fa", category)).StatusCode);

        _faStatus = 0;
        Assert.Equal("Data already submitted.", await (await client.PostAsJsonAsync("/api/msme/schemes/fa", req)).ProblemTitle());
        _faStatus = 1; _current = null;
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/msme/schemes/fa", req)).StatusCode);
        Assert.Empty(MsmeSchemesTestSupport.CallsTo(_host, Proc));
        Assert.Empty(_host.Email.Sent);
    }

    [Fact]
    public async Task Procedure_refusal_is_reported_without_its_text()
    {
        var client = await SignIn();
        var req = await ValidRequestAsync(client);
        _host.Sql.Procs[Proc] = _ => throw new MsmeSchemesTestSupport.FakeDbException("Conversion failed when converting the varchar value 'ABC' to data type bit.");
        var r = await client.PostAsJsonAsync("/api/msme/schemes/fa", req);
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        var title = await r.ProblemTitle();
        Assert.DoesNotContain("Conversion", title);
        Assert.Empty(_host.Email.Sent);
    }
}
