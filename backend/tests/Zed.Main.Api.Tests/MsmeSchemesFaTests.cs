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
        // 2026-11-25: the incentive screens are the Incentives Master Admin's.
        host.Sql.Queries[Zed.Portal.Features.Staff.Users.IncentivesAdmins.ScreenAccessSql] = _ => [new Zed.Portal.Features.Staff.Users.IncentivesAdmins.ScreenRow("incentives")];
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

        // 2026-11-20: the page shows the applications made here; new ones go through the Financial Assistance card.
        Assert.False(json.GetProperty("canApply").GetBoolean());
        Assert.Equal(JsonValueKind.Null, json.GetProperty("certification").ValueKind);
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

    /// <summary>A complete request as the old page sent it (2026-11-20: refused before any check).</summary>
    private static object ValidRequest() => new
    {
        categoryOfCertificate = "Quality", nameOfCertficate = "ISO 9001", certificationAgency = "BIS", certficateNumber = "C-1",
        dateOfIssue = DateTime.Today.AddDays(-10).ToString("yyyy-MM-dd"), validityOfCertificate = 3, anyOtherInformation = "",
        invoiceNo = "INV-1", invoiceBillDate = DateTime.Today.AddDays(-5).ToString("yyyy-MM-dd"), amountPaid = 100000m, modeOfPayment = "Online",
        account = new { accountNo = "123456789012", confirmAccountNo = "123456789012", ifscCode = "sbin0001234", branchAddress = "MG Road", bankName = "SBI" },
        documents = new[] { new { fileName = "20240101120000000abcdef01.pdf", type = "Copy of Certificate" } },
        declaration = true,
    };

    [Fact]
    public async Task Not_eligible_units_are_told_so_and_every_other_is_sent_to_the_card()
    {
        var client = await SignIn();
        _eligibleFinancial = 0;
        var j = await client.GetFromJsonAsync<JsonElement>("/api/msme/schemes/fa");
        Assert.False(j.GetProperty("canApply").GetBoolean());
        Assert.Equal("You are not eligible for benefits. Please contact ZED team.", j.GetProperty("message").GetString());

        // 2026-11-20: whatever the old flags (submitted, certified or not), new applications go through the card.
        foreach (var (status, current) in new[] { (1, "Silver"), (0, "Silver"), (1, (string?)null) })
        {
            _eligibleFinancial = 1; _faStatus = status; _current = current;
            j = await client.GetFromJsonAsync<JsonElement>("/api/msme/schemes/fa");
            Assert.False(j.GetProperty("canApply").GetBoolean());
            Assert.Equal(Zed.Portal.Features.Msme.Schemes.MsmeFinancialAssistanceController.NewApplicationsMessage, j.GetProperty("message").GetString());
        }
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync("/api/msme/schemes/fa/documents",
            MsmeSchemesTestSupport.Upload("Copy of Invoice", MsmeSchemesTestSupport.Pdf))).StatusCode);
    }

    [Fact]
    public async Task Upload_checks_the_content_first_and_files_are_served_only_to_their_owner()
    {
        var client = await SignIn();
        var exe = "MZ\x90\0fake"u8.ToArray();
        var bad = await client.PostAsync("/api/msme/schemes/fa/documents", MsmeSchemesTestSupport.Upload("Copy of Invoice", exe, "invoice.pdf"));
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync("/api/msme/schemes/fa/documents",
            MsmeSchemesTestSupport.Upload("../../x", MsmeSchemesTestSupport.Pdf))).StatusCode);
        // A valid file: refused too (no new application here), nothing saved.
        var r = await client.PostAsync("/api/msme/schemes/fa/documents", MsmeSchemesTestSupport.Upload("Copy of Invoice", MsmeSchemesTestSupport.Pdf));
        Assert.Equal(Zed.Portal.Features.Msme.Schemes.MsmeFinancialAssistanceController.NewApplicationsMessage, await r.ProblemTitle());
        Assert.False(Directory.Exists(Path.Combine(_host.StorageRoot, "mobileapi", "Photos", Me, "FinancialAssistance")));

        // The documents of the applications made here stay readable by their owner only.
        const string name = "20240101100000000abcdef01.pdf";
        MsmeSchemesTestSupport.WriteFile(_host, $"mobileapi/Photos/{Me}/FinancialAssistance/{name}", MsmeSchemesTestSupport.Pdf);
        var file = await client.GetAsync($"/api/msme/schemes/fa/files/{name}");
        Assert.Equal(HttpStatusCode.OK, file.StatusCode);
        Assert.Equal("application/pdf", file.Content.Headers.ContentType?.MediaType);
        Assert.Equal("nosniff", file.Headers.GetValues("X-Content-Type-Options").Single());
        var other = await SignIn(Other);
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync($"/api/msme/schemes/fa/files/{name}")).StatusCode);
        MsmeSchemesTestSupport.WriteFile(_host, "web.config", "<x/>"u8.ToArray());
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/msme/schemes/fa/files/..%2F..%2F..%2F..%2Fweb.config")).StatusCode);
    }

    [Fact]
    public async Task A_new_application_is_refused_before_any_check_and_nothing_is_stored_or_mailed()
    {
        var client = await SignIn();
        var r = await client.PostAsJsonAsync("/api/msme/schemes/fa", ValidRequest());
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Equal(Zed.Portal.Features.Msme.Schemes.MsmeFinancialAssistanceController.NewApplicationsMessage, await r.ProblemTitle());
        // An incomplete one gets the same answer (not a field message).
        Assert.Equal(Zed.Portal.Features.Msme.Schemes.MsmeFinancialAssistanceController.NewApplicationsMessage,
            await (await client.PostAsJsonAsync("/api/msme/schemes/fa", new { declaration = false })).ProblemTitle());
        Assert.Empty(MsmeSchemesTestSupport.CallsTo(_host, Proc));
        Assert.Empty(_host.Email.Sent);
    }
}
