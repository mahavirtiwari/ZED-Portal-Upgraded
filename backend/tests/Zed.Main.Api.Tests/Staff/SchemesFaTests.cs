using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Core.Data;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>Staff users of the scheme / NEFT tests (signed in through the real staff login endpoint).</summary>
internal static class SchemesTestUsers
{
    // (role, state, financial verification sub-role)
    private static readonly Dictionary<string, (int Role, string? State, bool Fv)> Users = new(StringComparer.OrdinalIgnoreCase)
    {
        ["MADMIN"] = (7, null, true),
        ["AGENCY1"] = (2, null, true),
        ["AGENCY2"] = (2, null, true),
        ["AGENCYNOFV"] = (2, null, false),
        ["DA1"] = (3, null, true),
        ["DA2"] = (3, null, true),
        ["DANOFV"] = (3, null, false),
        ["SC_UP"] = (6, "9", true),
        ["SC_MH"] = (6, "27", true),
        ["SC_NONE"] = (6, null, true),
        ["SUPER1"] = (10, null, true),
        ["ADMIN1"] = (1, null, true),
    };

    public static void Register(TestHost host)
    {
        host.Sql.Procs["SP_GET_USER_DETAILS"] = args =>
            FakeSql.Arg(args, "UserId") is { } id && Users.TryGetValue(id, out var u)
                ? FakeSql.Sets([new { UserId = id, UserName = id + " name", RoleId = u.Role, Email = id + "@x.test", StateCode = u.State }], [new { ERRORMSG = "SUCCESS" }])
                : FakeSql.Sets([], [new { ERRORMSG = "INVALID CREDENTIAILS" }]);
        host.Sql.Procs["SP_GET_SUB_ROLE"] = args =>
        {
            var fv = FakeSql.Arg(args, "UserId") is { } id && Users.TryGetValue(id, out var u) && u.Fv;
            return FakeSql.Sets([new { DesktopVerification = 1, SiteVerification = 1, FinancialVerification = fv ? 1 : 0 }]);
        };
    }

    public static async Task<HttpClient> SignInAsync(TestHost host, string userId)
    {
        var client = await host.CreateBrowserAsync();
        (await client.PostAsJsonAsync("/api/staff/auth/login", new { userId, password = "Right#Pass1" })).EnsureSuccessStatusCode();
        (await client.GetAsync("/api/auth/me")).EnsureSuccessStatusCode();
        return client;
    }
}

public sealed class SchemesFaTests : IDisposable
{
    private const string Zed = "ZEDMSME000010";
    private readonly TestHost _host = new();

    // The current FinancialAssistance row (Bronze) and its documents; tests change them.
    private Dictionary<string, object?> _fa = new()
    {
        ["Id"] = 501, ["ZedId"] = Zed, ["CertificationType"] = "Bronze", ["VerificationStatus"] = 1, ["IsApproved"] = null,
        ["CertificationBodyUserId"] = null, ["FinancialAssessorId"] = null, ["ReasonForRejection"] = null,
        ["FinancialAssistanceId"] = 77, ["AccountNo"] = "123456789012", ["IfscCode"] = "SBIN0001234", ["AmountPaid"] = "50000",
        ["CategoryOfCertificate"] = "Quality",
    };

    private readonly List<Dictionary<string, object?>> _photos =
    [
        new() { ["Id"] = 9001, ["ZedId"] = Zed, ["PhotoId"] = "20240101.pdf", ["PhotoType"] = "Copy of Certificate", ["CertificationType"] = "Bronze", ["FinancialAssistanceId"] = 77, ["IsVerified"] = null, ["DocumentOpenedTime"] = null },
        new() { ["Id"] = 9002, ["ZedId"] = Zed, ["PhotoId"] = "20240102.jpg", ["PhotoType"] = "Copy of Invoice", ["CertificationType"] = "Bronze", ["FinancialAssistanceId"] = 77, ["IsVerified"] = null, ["DocumentOpenedTime"] = null },
        // Another (older) application's document: never shown with this one.
        new() { ["Id"] = 8000, ["ZedId"] = Zed, ["PhotoId"] = "old.pdf", ["PhotoType"] = "Copy of Invoice", ["CertificationType"] = "Bronze", ["FinancialAssistanceId"] = 12, ["IsVerified"] = null },
    ];

    private readonly List<Dictionary<string, object?>> _screenshots = [];

    public SchemesFaTests()
    {
        SchemesTestUsers.Register(_host);
        _host.Sql.Procs["SP_FINANCIAL_ASSISTANCE_GET_DETAILS"] = args =>
        {
            if (FakeSql.Arg(args, "ZedId") != Zed) return FakeSql.Sets([], [], [], [], [], [], [], [], []);
            return FakeSql.Sets([_fa], [], [], _photos, [], [], _screenshots, [], []);
        };
        _host.Sql.Procs["SP_FINANCIAL_ASSISTANCE_GET_LIST"] = _ => FakeSql.Sets(
            [new { Id = 501, ZedId = Zed, EnterpriseName = "Acme", CertificationType = "Bronze", Password = "leak", RoleId = 7 }],
            [new { New = 1, InProgress = 2, Qc = 0, Approved = 3, Rejected = 0 }]);
        _host.Sql.Procs["SP_ASSESSMENT_AGENCIES_TO_ALLOT"] = _ => FakeSql.Sets(
        [
            new { UserId = "AGENCY1", UserName = "Agency One", FinancialVerification = true },
            new { UserId = "AGENCY2", UserName = "Agency Two", FinancialVerification = true },
            new { UserId = "AGENCYNOFV", UserName = "No FV", FinancialVerification = false },
        ]);
        _host.Sql.Procs["SP_ASSESSMENT_ASSESSORS_TO_ALLOT"] = args => FakeSql.Arg(args, "UserId") == "AGENCY1"
            ? FakeSql.Sets([new { UserId = "DA1", UserName = "Assessor One" }])
            : FakeSql.Sets([new { UserId = "DA2", UserName = "Assessor Two" }]);
        _host.Sql.Procs["SP_EMAIL_GET_DETAILS_FA"] = _ => FakeSql.Sets([new
        {
            EmailId = "msme@acme.test", EnterpriseName = "Acme <b>Castings</b>", Address = "Plot 4", AgencyEmailId = "agency1@x.test",
            AgencyName = "Agency One", AssessorEmailId = "da1@x.test", Password = "Secret#123", CategoryOfCertificate = "System (Quality) Certification",
        }]);
    }

    public void Dispose() => _host.Dispose();

    private Task<HttpClient> SignIn(string user) => SchemesTestUsers.SignInAsync(_host, user);

    private IEnumerable<object?> CallsTo(string proc) => _host.Sql.Calls.Where(c => c.Name == proc).Select(c => c.Args);

    private void At(int status, string? agency = null, string? assessor = null, int? isApproved = null, string? rejection = null)
    {
        _fa["VerificationStatus"] = status;
        _fa["CertificationBodyUserId"] = agency;
        _fa["FinancialAssessorId"] = assessor;
        _fa["IsApproved"] = isApproved;
        _fa["ReasonForRejection"] = rejection;
    }

    private string WriteDocument(string file, byte[] content)
    {
        var path = Path.Combine(_host.StorageRoot, "mobileapi", "Photos", Zed, "FinancialAssistance", file);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllBytes(path, content);
        return path;
    }

    private static MultipartFormDataContent Form(string isVerified, string? source = null, string? remarks = null, byte[]? file = null, string fileName = "shot.pdf")
    {
        var form = new MultipartFormDataContent { { new StringContent(isVerified), "isVerified" } };
        if (source is not null) form.Add(new StringContent(source), "sourceOfValidation");
        if (remarks is not null) form.Add(new StringContent(remarks), "remarks");
        if (file is not null)
        {
            var c = new ByteArrayContent(file);
            c.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
            form.Add(c, "file", fileName);
        }
        return form;
    }

    private static readonly byte[] Pdf = "%PDF-1.4\n%test\n"u8.ToArray();

    // ----- access -----

    [Fact]
    public async Task Endpoints_require_sign_in()
    {
        var client = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/staff/schemes/fa/submissions?status=1")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync($"/api/staff/schemes/fa/{Zed}")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/staff/schemes/fa/allot", new { zedId = Zed, certification = "Bronze", agencyUserId = "AGENCY1" })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync($"/api/staff/schemes/fa/{Zed}/Bronze/decision", new { decision = "approve" })).StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.StartsWith("SP_FINANCIAL"));
    }

    [Theory]
    [InlineData("SC_UP")]      // state coordinator
    [InlineData("SUPER1")]     // super admin
    [InlineData("ADMIN1")]
    [InlineData("AGENCYNOFV")] // agency without the FinancialVerification sub-role
    [InlineData("DANOFV")]
    public async Task Other_roles_and_sub_roles_are_forbidden(string user)
    {
        var client = await SignIn(user);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/staff/schemes/fa/submissions?status=1")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync($"/api/staff/schemes/fa/{Zed}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync("/api/staff/schemes/fa/accept", new { zedId = Zed, certification = "Bronze", assessorUserId = "DA1" })).StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.StartsWith("SP_FINANCIAL"));
    }

    [Fact]
    public async Task Actions_of_another_role_are_forbidden()
    {
        At(1, agency: "AGENCY1");
        var agency = await SignIn("AGENCY1");
        Assert.Equal(HttpStatusCode.Forbidden, (await agency.PostAsJsonAsync("/api/staff/schemes/fa/allot", new { zedId = Zed, certification = "Bronze", agencyUserId = "AGENCY1" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await agency.PostAsJsonAsync($"/api/staff/schemes/fa/{Zed}/Bronze/account", new { accountNo = "123456789", ifscCode = "SBIN0001234", branchAddress = "x", bankName = "y" })).StatusCode);
        var admin = await SignIn("MADMIN");
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.PostAsJsonAsync("/api/staff/schemes/fa/accept", new { zedId = Zed, certification = "Bronze", assessorUserId = "DA1" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.PostAsJsonAsync($"/api/staff/schemes/fa/{Zed}/Bronze/decision", new { decision = "approve" })).StatusCode);
        Assert.Empty(CallsTo("SP_FINANCIAL_ASSISTANCE_ALLOT_TO_AGENCY"));
        Assert.Empty(CallsTo("SP_FINANCIAL_ASSISTANCE_FINAL_AUBMIT"));
    }

    // ----- submissions and allotment -----

    [Fact]
    public async Task Submissions_use_the_signed_in_user_and_drop_unlisted_columns()
    {
        var client = await SignIn("AGENCY1");
        var json = await client.GetFromJsonAsync<JsonElement>("/api/staff/schemes/fa/submissions?status=1&userId=MADMIN");

        var call = Assert.Single(CallsTo("SP_FINANCIAL_ASSISTANCE_GET_LIST"));
        Assert.Equal("AGENCY1", FakeSql.Arg(call, "UserId"));
        Assert.Equal("1", FakeSql.Arg(call, "Status"));
        var row = json.GetProperty("rows")[0];
        Assert.Equal(Zed, row.GetProperty("ZedId").GetString());
        Assert.False(row.TryGetProperty("Password", out _));
        Assert.Equal(3, json.GetProperty("counts").GetProperty("Approved").GetInt32());
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/staff/schemes/fa/submissions?status=9")).StatusCode);
    }

    [Fact]
    public async Task Master_admin_allots_a_new_application_to_an_offered_agency_and_the_agency_is_mailed()
    {
        var admin = await SignIn("MADMIN");
        var agencies = await admin.GetFromJsonAsync<JsonElement>($"/api/staff/schemes/fa/agencies?zedId={Zed}");
        Assert.Equal(["AGENCY1", "AGENCY2"], agencies.EnumerateArray().Select(a => a.GetProperty("userId").GetString()));

        var r = await admin.PostAsJsonAsync("/api/staff/schemes/fa/allot", new { zedId = Zed, certification = "bronze", agencyUserId = "AGENCY2" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);

        var call = Assert.Single(CallsTo("SP_FINANCIAL_ASSISTANCE_ALLOT_TO_AGENCY"));
        Assert.Equal("AGENCY2", FakeSql.Arg(call, "CertificationBodyUserId"));
        Assert.Equal("Bronze", FakeSql.Arg(call, "Certification"));
        var history = Assert.Single(_host.Sql.Calls, c => c.Name.StartsWith("INSERT INTO MsmeHistory"));
        Assert.Contains("MADMIN", FakeSql.Arg(history.Args, "Descrip"));
        var mail = Assert.Single(_host.Email.Sent);
        Assert.Equal("agency1@x.test", mail.To);
        Assert.Contains("Acme &lt;b&gt;Castings&lt;/b&gt;", mail.HtmlBody);
    }

    [Fact]
    public async Task Allotment_is_refused_for_agencies_not_offered_and_after_the_new_stage()
    {
        var admin = await SignIn("MADMIN");
        var r = await admin.PostAsJsonAsync("/api/staff/schemes/fa/allot", new { zedId = Zed, certification = "Bronze", agencyUserId = "AGENCYNOFV" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);

        At(2, agency: "AGENCY1", assessor: "DA1");
        r = await admin.PostAsJsonAsync("/api/staff/schemes/fa/allot", new { zedId = Zed, certification = "Bronze", agencyUserId = "AGENCY2" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/staff/schemes/fa/allot", new { zedId = "../x", certification = "Bronze", agencyUserId = "AGENCY2" })).StatusCode);
        Assert.Empty(CallsTo("SP_FINANCIAL_ASSISTANCE_ALLOT_TO_AGENCY"));
    }

    [Fact]
    public async Task Agency_accepts_its_allotment_with_its_own_assessor_and_the_mail_has_no_password()
    {
        At(1, agency: "AGENCY1");
        var agency = await SignIn("AGENCY1");

        Assert.Equal(HttpStatusCode.BadRequest,
            (await agency.PostAsJsonAsync("/api/staff/schemes/fa/accept", new { zedId = Zed, certification = "Bronze", assessorUserId = "DA2" })).StatusCode);
        var r = await agency.PostAsJsonAsync("/api/staff/schemes/fa/accept", new { zedId = Zed, certification = "Bronze", assessorUserId = "DA1" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);

        var call = Assert.Single(CallsTo("SP_FINANCIAL_ASSESSMENT_ACCEPT_UNIT_FOR_VERIFICATION"));
        Assert.Equal("DA1", FakeSql.Arg(call, "FinancialAssessorId"));
        var mail = Assert.Single(_host.Email.Sent);
        Assert.Equal("da1@x.test", mail.To);
        Assert.DoesNotContain("Secret#123", mail.HtmlBody);
    }

    [Fact]
    public async Task Another_agency_cannot_accept_or_reject_and_a_processed_allotment_cannot_be_redone()
    {
        At(1, agency: "AGENCY1");
        var other = await SignIn("AGENCY2");
        Assert.Equal(HttpStatusCode.NotFound,
            (await other.PostAsJsonAsync("/api/staff/schemes/fa/reject", new { zedId = Zed, certification = "Bronze", reason = "No" })).StatusCode);

        At(1, agency: "AGENCY1", rejection: "Busy");
        var agency = await SignIn("AGENCY1");
        Assert.Equal(HttpStatusCode.BadRequest,
            (await agency.PostAsJsonAsync("/api/staff/schemes/fa/accept", new { zedId = Zed, certification = "Bronze", assessorUserId = "DA1" })).StatusCode);
        Assert.Empty(CallsTo("SP_FINANCIAL_ASSESSMENT_REJECT_UNIT_FOR_VERIFICATION"));
        Assert.Empty(CallsTo("SP_FINANCIAL_ASSESSMENT_ACCEPT_UNIT_FOR_VERIFICATION"));
    }

    [Fact]
    public async Task Agency_rejection_needs_a_reason_that_fits_the_procedure()
    {
        At(1, agency: "AGENCY1");
        var agency = await SignIn("AGENCY1");
        Assert.Equal(HttpStatusCode.BadRequest,
            (await agency.PostAsJsonAsync("/api/staff/schemes/fa/reject", new { zedId = Zed, certification = "Bronze", reason = new string('x', 101) })).StatusCode);
        var r = await agency.PostAsJsonAsync("/api/staff/schemes/fa/reject", new { zedId = Zed, certification = "Bronze", reason = "Not our <sector>" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("Not our <sector>", FakeSql.Arg(Assert.Single(CallsTo("SP_FINANCIAL_ASSESSMENT_REJECT_UNIT_FOR_VERIFICATION")), "ReasonForRejection"));
        var mail = Assert.Single(_host.Email.Sent);
        Assert.Equal("zed@qcin.org", mail.To);
        Assert.Contains("Not our &lt;sector&gt;", mail.HtmlBody);
    }

    // ----- verification -----

    [Fact]
    public async Task Only_the_assigned_reviewers_and_the_master_admin_can_open_an_application()
    {
        At(2, agency: "AGENCY1", assessor: "DA1");
        Assert.Equal(HttpStatusCode.NotFound, (await (await SignIn("DA2")).GetAsync($"/api/staff/schemes/fa/{Zed}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await (await SignIn("AGENCY2")).GetAsync($"/api/staff/schemes/fa/{Zed}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await (await SignIn("MADMIN")).GetAsync($"/api/staff/schemes/fa/{Zed}")).StatusCode);

        var json = await (await SignIn("DA1")).GetFromJsonAsync<JsonElement>($"/api/staff/schemes/fa/{Zed}");
        var app = json[0];
        Assert.Equal("Bronze", app.GetProperty("certification").GetString());
        Assert.True(app.GetProperty("canValidate").GetBoolean());
        Assert.False(app.GetProperty("canDecide").GetBoolean());
        var docs = app.GetProperty("documents");
        Assert.Equal(2, docs.GetArrayLength());
        Assert.Equal($"/api/staff/schemes/fa/{Zed}/Bronze/documents/9001", docs[0].GetProperty("url").GetString());
        Assert.True(docs[0].GetProperty("isPdf").GetBoolean());
    }

    [Fact]
    public async Task Documents_are_served_to_reviewers_and_opening_records_the_time_for_the_assessor()
    {
        At(2, agency: "AGENCY1", assessor: "DA1");
        WriteDocument("20240101.pdf", Pdf);

        var other = await SignIn("DA2");
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync($"/api/staff/schemes/fa/{Zed}/Bronze/documents/9001")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await (await SignIn("DA1")).GetAsync($"/api/staff/schemes/fa/{Zed}/Bronze/documents/8000")).StatusCode);

        var da = await SignIn("DA1");
        var r = await da.GetAsync($"/api/staff/schemes/fa/{Zed}/Bronze/documents/9001");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("application/pdf", r.Content.Headers.ContentType?.MediaType);
        Assert.Equal(Pdf, await r.Content.ReadAsByteArrayAsync());
        var stamp = Assert.Single(CallsTo("SP_FINANCIAL_ASSISTANCE_UPDATE_TIMESTAMP"));
        Assert.Equal("9001", FakeSql.Arg(stamp, "Id"));

        var admin = await SignIn("MADMIN");
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync($"/api/staff/schemes/fa/{Zed}/Bronze/documents/9001")).StatusCode);
        Assert.Single(CallsTo("SP_FINANCIAL_ASSISTANCE_UPDATE_TIMESTAMP"));
    }

    [Fact]
    public async Task Validation_requires_the_document_to_be_opened_and_a_real_pdf_or_image()
    {
        At(2, agency: "AGENCY1", assessor: "DA1");
        var da = await SignIn("DA1");
        var url = $"/api/staff/schemes/fa/{Zed}/Bronze/documents/9001/validation";

        Assert.Equal(HttpStatusCode.BadRequest, (await da.PostAsync(url, Form("Yes", "Portal", file: Pdf))).StatusCode); // not opened
        _photos[0]["DocumentOpenedTime"] = DateTime.Now;

        Assert.Equal(HttpStatusCode.BadRequest, (await da.PostAsync(url, Form("Yes", "Portal", file: "MZ\x90\0exe"u8.ToArray(), fileName: "a.pdf"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await da.PostAsync(url, Form("Yes", source: null, file: Pdf))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await da.PostAsync(url, Form("Yes", "Portal"))).StatusCode); // certificate needs a screenshot
        Assert.Equal(HttpStatusCode.BadRequest, (await da.PostAsync(url, Form("No"))).StatusCode);          // "No" needs remarks
        Assert.Empty(CallsTo("SP_FINANCIAL_ASSISTANCE_VALIDATE_EVIDENCES"));

        var r = await da.PostAsync(url, Form("Yes", "Certification body portal", file: Pdf, fileName: "..\\..\\web.config.pdf"));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var call = Assert.Single(CallsTo("SP_FINANCIAL_ASSISTANCE_VALIDATE_EVIDENCES"));
        Assert.Equal("Yes", FakeSql.Arg(call, "IsVerified"));
        Assert.Equal(Zed, FakeSql.Arg(call, "ZedId"));
        var saved = Directory.GetFiles(Path.Combine(_host.StorageRoot, "Uploads", "FinancialAssistance", Zed, "Bronze"));
        var file = Assert.Single(saved);
        Assert.Matches(@"^\d{17}_9001\.pdf$", Path.GetFileName(file));
        Assert.Equal(Pdf, File.ReadAllBytes(file));
    }

    [Fact]
    public async Task Validation_is_refused_to_other_roles_and_after_the_assessor_stage()
    {
        _photos[0]["DocumentOpenedTime"] = DateTime.Now;
        At(2, agency: "AGENCY1", assessor: "DA1");
        var agency = await SignIn("AGENCY1");
        Assert.Equal(HttpStatusCode.Forbidden, (await agency.PostAsync($"/api/staff/schemes/fa/{Zed}/Bronze/documents/9002/validation", Form("No", remarks: "x"))).StatusCode);

        At(3, agency: "AGENCY1", assessor: "DA1", isApproved: 1);
        var da = await SignIn("DA1");
        Assert.Equal(HttpStatusCode.Forbidden, (await da.PostAsync($"/api/staff/schemes/fa/{Zed}/Bronze/documents/9002/validation", Form("No", remarks: "x"))).StatusCode);
        Assert.Empty(CallsTo("SP_FINANCIAL_ASSISTANCE_VALIDATE_EVIDENCES"));
    }

    [Fact]
    public async Task Assessor_decides_only_when_every_document_is_validated()
    {
        At(2, agency: "AGENCY1", assessor: "DA1");
        var da = await SignIn("DA1");
        var url = $"/api/staff/schemes/fa/{Zed}/Bronze/decision";

        Assert.Equal(HttpStatusCode.BadRequest, (await da.PostAsJsonAsync(url, new { decision = "approve" })).StatusCode);
        foreach (var p in _photos) p["IsVerified"] = "Yes";
        Assert.Equal(HttpStatusCode.BadRequest, (await da.PostAsJsonAsync(url, new { decision = "reject" })).StatusCode); // comments required

        var r = await da.PostAsJsonAsync(url, new { decision = "approve", isApproved = "3", roleId = "2" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var call = Assert.Single(CallsTo("SP_FINANCIAL_ASSISTANCE_FINAL_AUBMIT"));
        Assert.Equal("1", FakeSql.Arg(call, "IsApproved"));
        Assert.Equal("3", FakeSql.Arg(call, "RoleId"));
        Assert.Equal("DA1", FakeSql.Arg(call, "UserId"));
        Assert.Equal("501", FakeSql.Arg(call, "Id"));
        Assert.Empty(_host.Email.Sent);
    }

    [Fact]
    public async Task Assessor_rejection_mails_the_msme()
    {
        At(2, agency: "AGENCY1", assessor: "DA1");
        foreach (var p in _photos) p["IsVerified"] = "No";
        var da = await SignIn("DA1");
        var r = await da.PostAsJsonAsync($"/api/staff/schemes/fa/{Zed}/Bronze/decision", new { decision = "reject", comments = "Invoice <forged>" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("2", FakeSql.Arg(Assert.Single(CallsTo("SP_FINANCIAL_ASSISTANCE_FINAL_AUBMIT")), "IsApproved"));
        var mail = Assert.Single(_host.Email.Sent);
        Assert.Equal("msme@acme.test", mail.To);
        Assert.Contains("Invoice &lt;forged&gt;", mail.HtmlBody);
    }

    [Fact]
    public async Task Agency_approves_only_at_qc_after_the_assessor_and_the_msme_is_mailed()
    {
        At(2, agency: "AGENCY1", assessor: "DA1");
        var agency = await SignIn("AGENCY1");
        var url = $"/api/staff/schemes/fa/{Zed}/Bronze/decision";
        Assert.Equal(HttpStatusCode.BadRequest, (await agency.PostAsJsonAsync(url, new { decision = "approve" })).StatusCode);

        At(3, agency: "AGENCY1", assessor: "DA1", isApproved: 1);
        Assert.Equal(HttpStatusCode.NotFound, (await (await SignIn("AGENCY2")).PostAsJsonAsync(url, new { decision = "approve" })).StatusCode);
        var r = await agency.PostAsJsonAsync(url, new { decision = "approve" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var call = Assert.Single(CallsTo("SP_FINANCIAL_ASSISTANCE_FINAL_AUBMIT"));
        Assert.Equal("2", FakeSql.Arg(call, "RoleId"));
        Assert.Equal("msme@acme.test", Assert.Single(_host.Email.Sent).To);
    }

    [Fact]
    public async Task Account_details_change_only_at_the_allowed_stages_with_valid_values_and_is_audited()
    {
        var body = new { accountNo = "998877665544", ifscCode = "hdfc0001234", branchAddress = "MG Road", bankName = "HDFC" };
        At(2, agency: "AGENCY1", assessor: "DA1");
        var admin = await SignIn("MADMIN");
        var url = $"/api/staff/schemes/fa/{Zed}/Bronze/account";
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync(url, body)).StatusCode);

        At(4, agency: "AGENCY1", assessor: "DA1", isApproved: 1);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync(url, body with { ifscCode = "BAD" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync(url, body with { accountNo = "12AB" })).StatusCode);
        var r = await admin.PostAsJsonAsync(url, body);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);

        var call = Assert.Single(CallsTo("SP_FINANCIAL_ASSISTANCE_UPDATE_ACCOUNT_DETAILS"));
        Assert.Equal("HDFC0001234", FakeSql.Arg(call, "IfscCode"));
        Assert.Equal("501", FakeSql.Arg(call, "Id"));
        var history = Assert.Single(_host.Sql.Calls, c => c.Name.StartsWith("INSERT INTO MsmeHistory"));
        Assert.Contains("MADMIN", FakeSql.Arg(history.Args, "Descrip"));
        Assert.DoesNotContain("998877665544", FakeSql.Arg(history.Args, "Descrip"));
    }
}
