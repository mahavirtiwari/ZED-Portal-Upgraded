using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Zed.Core.Data;
using Zed.Main.Api.Tests;

namespace Zed.Consultancy.Api.Tests;

/// <summary>Staff users of the TU tests, signed in through the real staff login endpoint of the consultancy host.</summary>
internal static class TuTestUsers
{
    // (role, state, financial verification, site verification)
    private static readonly Dictionary<string, (int Role, string? State, bool Fv, bool Sv)> Users = new(StringComparer.OrdinalIgnoreCase)
    {
        ["MADMIN"] = (7, null, false, false),
        ["CO1"] = (2, null, true, true),
        ["CO2"] = (2, null, true, true),
        ["CONOFV"] = (2, null, false, true),
        ["DFO1"] = (3, null, true, false),
        ["DFO2"] = (3, null, true, false),
        ["CC1"] = (3, null, false, true),
        ["CC2"] = (3, null, false, true),
        ["SC_UP"] = (6, "9", false, false),
        ["SC_MH"] = (6, "27", false, false),
    };

    public static void Register(TestHost host)
    {
        host.Sql.Procs["SP_GET_USER_DETAILS"] = args =>
            FakeSql.Arg(args, "UserId") is { } id && Users.TryGetValue(id, out var u)
                ? FakeSql.Sets([new { UserId = id, UserName = id + " name", RoleId = u.Role, Email = id + "@x.test", StateCode = u.State }], [new { ERRORMSG = "SUCCESS" }])
                : FakeSql.Sets([], [new { ERRORMSG = "INVALID CREDENTIAILS" }]);
        host.Sql.Procs["SP_GET_SUB_ROLE"] = args =>
        {
            var found = Users.TryGetValue(FakeSql.Arg(args, "UserId") ?? "", out var u);
            return FakeSql.Sets([new { DesktopVerification = 0, SiteVerification = found && u.Sv ? 1 : 0, FinancialVerification = found && u.Fv ? 1 : 0 }]);
        };
    }

    public static async Task<HttpClient> SignInAsync(TestHost host, string userId)
    {
        var client = await host.CreateBrowserAsync();
        (await client.PostAsJsonAsync("/api/staff/auth/login", new { userId, password = "Right#Pass1" })).EnsureSuccessStatusCode();
        return client;
    }
}

/// <summary>Technology upgradation staff review on the consultancy host (finding #88).</summary>
public sealed class TechnologyUpgradationTests : IDisposable
{
    private const string Zed = "ZEDMSME000500";
    private const string Base = "/api/staff/consultancy/tu";
    private readonly TestHost _host = new();

    private readonly Dictionary<string, object?> _fa = new()
    {
        ["Id"] = 41, ["ZedId"] = Zed, ["CertificationType"] = "Silver", ["VerificationStatus"] = 1, ["TechUpgradeStatus"] = 2, ["IsApproved"] = 0,
        ["CertificationBodyUserId"] = "CO1", ["FinancialAssessorId"] = null, ["ReasonForRejection"] = null, ["FinancialAssistanceId"] = 900,
        ["AccountNo"] = "123456789012", ["IfscCode"] = "SBIN0001234", ["BranchAddress"] = "Main Road", ["BankName"] = "SBI",
        ["EligibleSubsidyPer"] = 80, ["MaxEligibleSubsidy"] = 300000, ["TotalPaidAfterQc"] = "100000.00", ["EligibleAmount"] = "80000.00",
        ["MeetingSubmitted"] = 0, ["TransactionStatus"] = null, ["Password"] = "leak",
    };

    private readonly List<Dictionary<string, object?>> _photos =
    [
        new() { ["Id"] = 7001, ["ZedId"] = Zed, ["PhotoId"] = "20250101.pdf", ["PhotoType"] = "Purchased Technology", ["TechnologyCode"] = "12", ["CertificationType"] = "Silver", ["FinancialAssistanceId"] = 900, ["IsVerified"] = null, ["DocumentOpenedTime"] = null },
        new() { ["Id"] = 7002, ["ZedId"] = Zed, ["PhotoId"] = "20250102.jpg", ["PhotoType"] = "Copy of Invoice", ["TechnologyCode"] = "12", ["CertificationType"] = "Silver", ["FinancialAssistanceId"] = 900, ["IsVerified"] = null, ["DocumentOpenedTime"] = null },
    ];

    private readonly List<Dictionary<string, object?>> _techs =
    [
        new() { ["Id"] = 301, ["ZedId"] = Zed, ["TechnologyCode"] = "12", ["TechnologyName"] = "Solar dryer", ["MsmeAmountPaid"] = "125000", ["AmountPaid"] = "125000", ["IsEligible"] = true, ["FinancialAssistanceId"] = 900, ["CertificationType"] = "Silver" },
    ];

    private readonly List<Dictionary<string, object?>> _meetings = [];
    private readonly List<object> _neftRows = [];

    public TechnologyUpgradationTests()
    {
        TuTestUsers.Register(_host);
        _host.Sql.Procs["SP_FINANCIAL_ASSISTANCE_GET_DETAILS"] = args =>
        {
            if (FakeSql.Arg(args, "ZedId") != Zed) return FakeSql.Sets();
            return FakeSql.Sets([], [_fa], [], [], _photos, [], [], [], [], [], _techs, [], _meetings,
                [new { Name = "A Person", Designation = "Owner", CertificationType = "Silver", FinancialAssistanceId = 900 }],
                [new { Id = 55, Name = "Opening Meeting Photo", PhotoId = "p1", Certification = "Silver", FinancialAssistanceId = 900, TimeStamp = "now" }],
                [new { Certification = "Silver", TimeStamps = "05-Jan-2026", LoginTime = "10:00:00", LogoutTime = "17:30:00", NoOfHours = 7, NoOfMinutes = 30,
                       LoginPhotoId1 = "in1", LogoutPhotoId1 = "../x", LoginPhotoId = "https://loginzed.msme.gov.in/consultancymobileapi/Attendance/x.jpg" },
                 new { Certification = "Gold", TimeStamps = "06-Jan-2026", LoginTime = "10:00:00", LogoutTime = (string?)null, NoOfHours = (int?)null, NoOfMinutes = (int?)null,
                       LoginPhotoId1 = "in2", LogoutPhotoId1 = (string?)null, LoginPhotoId = (string?)null }],
                [new { ZedId = Zed, PUnitName = "Acme Unit", UdyogAadharNo = "UDYAM-XX-00-0000001", Certification = "Silver", PlantAddress = "Plot 4", Milestone3Date = "May 1, 2026", EnterpriseName = "Acme" }],
                [new { Latitude = "28.61", Longitude = "77.20", NcCount = 3 }],
                [new { TechnologyCode = "12", TechnologyName = "Solar dryer", Certification = "Silver", Description = "Dries produce" }]);
        };
        _host.Sql.Procs["SP_FINANCIAL_ASSISTANCE_GET_LIST"] = _ => FakeSql.Sets(
            [new { Id = 41, ZedId = Zed, PUnitName = "Acme", CertificationType = "Silver", TechUpgradeStatus = 2, Password = "leak", RoleId = 7 }],
            [new { New = 1, InProgress = 0, Qc = 0, Approved = 0, Rejected = 0 }]);
        _host.Sql.Procs["SP_ASSESSMENT_AGENCIES_TO_ALLOT"] = _ => FakeSql.Sets(
        [
            new { UserId = "CO1", UserName = "CO One", FinancialVerification = true },
            new { UserId = "CO2", UserName = "CO Two", FinancialVerification = false },
        ]);
        _host.Sql.Procs["SP_ASSESSMENT_ASSESSORS_TO_ALLOT"] = args => FakeSql.Arg(args, "UserId") == "CO1"
            ? FakeSql.Sets([new { UserId = "DFO1", UserName = "Dfo One" }, new { UserId = "DFO2", UserName = "Dfo Two" }])
            : FakeSql.Sets([]);
        _host.Sql.Procs["SP_EMAIL_GET_DETAILS_FA"] = _ => FakeSql.Sets([new
        {
            EmailId = "msme@acme.test", EnterpriseName = "Acme", PUnitName = "Acme Unit", Address = "Plot 4", AgencyEmailId = "co1@x.test",
            AgencyName = "CO One", AssessorEmailId = "dfo1@x.test", Password = "Secret#123", SpocName = "Spoc", AgencyMobileNo = "9999999999",
        }]);
        _host.Sql.Procs["SP_NEFT_TRANSACTIONS_BY_STATUS"] = _ => FakeSql.Sets(_neftRows);
    }

    public void Dispose() => _host.Dispose();

    private Task<HttpClient> SignIn(string user) => TuTestUsers.SignInAsync(_host, user);

    private IEnumerable<object?> CallsTo(string proc) => _host.Sql.Calls.Where(c => c.Name == proc).Select(c => c.Args);

    private void At(int status, int tu, string? dfo = null, int isApproved = 0)
    {
        _fa["VerificationStatus"] = status;
        _fa["TechUpgradeStatus"] = tu;
        _fa["FinancialAssessorId"] = dfo;
        _fa["IsApproved"] = isApproved;
    }

    private static readonly byte[] Pdf = "%PDF-1.4\n%test\n"u8.ToArray();
    private static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, 0x4A, 0x46, 0x49, 0x46, 0, 1];

    [Fact]
    public async Task Sign_in_and_the_financial_verification_sub_role_are_required()
    {
        var anonymous = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync($"{Base}/submissions?status=2")).StatusCode);
        var noFv = await SignIn("CONOFV");
        Assert.Equal(HttpStatusCode.Forbidden, (await noFv.GetAsync($"{Base}/submissions?status=2")).StatusCode);
        var sc = await SignIn("SC_UP");
        Assert.Equal(HttpStatusCode.Forbidden, (await sc.GetAsync($"{Base}/submissions?status=2")).StatusCode);
    }

    [Fact]
    public async Task Submissions_use_the_tu_tabs_and_return_only_list_columns()
    {
        var admin = await SignIn("MADMIN");
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.GetAsync($"{Base}/submissions?status=1")).StatusCode);
        var body = await admin.GetStringAsync($"{Base}/submissions?status=2");
        Assert.Contains("ZEDMSME000500", body);
        Assert.DoesNotContain("leak", body);
        Assert.Equal("2", FakeSql.Arg(CallsTo("SP_FINANCIAL_ASSISTANCE_GET_LIST").Last(), "Status"));

        // 99: the master admin's and the CO's landing view on the legacy page, passed on to the procedure.
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync($"{Base}/submissions?status=99")).StatusCode);
        Assert.Equal("99", FakeSql.Arg(CallsTo("SP_FINANCIAL_ASSISTANCE_GET_LIST").Last(), "Status"));
        Assert.Equal(HttpStatusCode.OK, (await (await SignIn("CO1")).GetAsync($"{Base}/submissions?status=99")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.GetAsync($"{Base}/submissions?status=98")).StatusCode);
    }

    [Fact]
    public async Task Master_admin_allots_only_to_a_co_of_the_units_tu_state()
    {
        _fa["CertificationBodyUserId"] = null;
        var admin = await SignIn("MADMIN");
        var refused = await admin.PostAsJsonAsync($"{Base}/allot", new { zedId = Zed, certification = "Silver", agencyUserId = "CO2" });
        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
        var ok = await admin.PostAsJsonAsync($"{Base}/allot", new { zedId = Zed, certification = "silver", agencyUserId = "CO1" });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var call = Assert.Single(CallsTo("SP_FINANCIAL_ASSISTANCE_ALLOT_TO_AGENCY"));
        Assert.Equal("CO1", FakeSql.Arg(call, "CertificationBodyUserId"));
        Assert.Equal("Silver", FakeSql.Arg(call, "Certification"));
        var mail = Assert.Single(_host.Email.Sent);
        Assert.Equal("co1@x.test", mail.To);
        Assert.Contains("Technology Upgradation", mail.Subject);

        At(2, 4, "DFO1");
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync($"{Base}/allot", new { zedId = Zed, certification = "Silver", agencyUserId = "CO1" })).StatusCode);
    }

    [Fact]
    public async Task The_allotted_co_accepts_with_its_own_dfo_and_the_dfo_and_msme_are_mailed_without_passwords()
    {
        var other = await SignIn("CO2");
        Assert.Equal(HttpStatusCode.NotFound, (await other.PostAsJsonAsync($"{Base}/accept", new { zedId = Zed, certification = "Silver", assessorUserId = "DFO1" })).StatusCode);

        var co = await SignIn("CO1");
        Assert.Equal(HttpStatusCode.BadRequest, (await co.PostAsJsonAsync($"{Base}/accept", new { zedId = Zed, certification = "Silver", assessorUserId = "CC1" })).StatusCode);
        var ok = await co.PostAsJsonAsync($"{Base}/accept", new { zedId = Zed, certification = "Silver", assessorUserId = "DFO1" });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        Assert.Equal("DFO1", FakeSql.Arg(Assert.Single(CallsTo("SP_FINANCIAL_ASSESSMENT_ACCEPT_UNIT_FOR_VERIFICATION")), "FinancialAssessorId"));
        var mails = _host.Email.Sent.ToList();
        Assert.Equal(2, mails.Count);
        Assert.Contains(mails, m => m.To == "dfo1@x.test" && m.Subject.Contains("Onsite Verification: Financial Support for Zero Effect Solution"));
        Assert.Contains(mails, m => m.To == "msme@acme.test" && m.Subject.Contains("Onsite Verification for Financial Support for Zero Effect Solution"));
        Assert.All(mails, m => Assert.DoesNotContain("Secret#123", m.HtmlBody));

        // Re-allotment of the DFO before the opening meeting; not after it.
        At(2, 4, "DFO1");
        Assert.Equal(HttpStatusCode.OK, (await co.PostAsJsonAsync($"{Base}/accept", new { zedId = Zed, certification = "Silver", assessorUserId = "DFO2" })).StatusCode);
        At(2, 10, "DFO1");
        Assert.Equal(HttpStatusCode.BadRequest, (await co.PostAsJsonAsync($"{Base}/accept", new { zedId = Zed, certification = "Silver", assessorUserId = "DFO2" })).StatusCode);
    }

    [Fact]
    public async Task The_page_gets_the_unit_overview_the_recommendations_and_the_dfos_attendance_of_the_level()
    {
        At(2, 4, "DFO1");
        var app = (await (await SignIn("DFO1")).GetFromJsonAsync<JsonElement>($"{Base}/{Zed}"))[0];
        Assert.Equal("UDYAM-XX-00-0000001", app.GetProperty("overview").GetProperty("UdyogAadharNo").GetString());
        Assert.False(app.GetProperty("overview").TryGetProperty("EnterpriseName", out _));
        Assert.Equal("28.61", app.GetProperty("location").GetProperty("Latitude").GetString());
        Assert.Equal("Dries produce", app.GetProperty("recommended")[0].GetProperty("description").GetString());
        // Only the level's days; selfies through the API, and only plain photo ids.
        var day = Assert.Single(app.GetProperty("attendance").EnumerateArray());
        Assert.Equal("05-Jan-2026", day.GetProperty("date").GetString());
        Assert.Equal(7, day.GetProperty("hours").GetInt32());
        Assert.Equal($"{Base}/{Zed}/Silver/attendance-photos/in1", day.GetProperty("loginPhotoUrl").GetString());
        Assert.Equal(JsonValueKind.Null, day.GetProperty("logoutPhotoUrl").ValueKind);

        var folder = Path.Combine(_host.StorageRoot, "consultancymobileapi", "Attendance", Zed, "Silver");
        Directory.CreateDirectory(folder);
        await File.WriteAllBytesAsync(Path.Combine(folder, "in1.jpg"), Jpeg);
        var dfo = await SignIn("DFO1");
        Assert.Equal(HttpStatusCode.OK, (await dfo.GetAsync($"{Base}/{Zed}/Silver/attendance-photos/in1")).StatusCode);
        // A photo id that is not in the application's attendance, and a stranger.
        Assert.Equal(HttpStatusCode.NotFound, (await dfo.GetAsync($"{Base}/{Zed}/Silver/attendance-photos/in2")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await (await SignIn("DFO2")).GetAsync($"{Base}/{Zed}/Silver/attendance-photos/in1")).StatusCode);
    }

    [Fact]
    public async Task The_co_rejects_a_new_allotment_and_the_zed_team_is_mailed()
    {
        var co = await SignIn("CO1");
        Assert.Equal(HttpStatusCode.BadRequest, (await co.PostAsJsonAsync($"{Base}/reject", new { zedId = Zed, certification = "Silver", reason = " " })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await co.PostAsJsonAsync($"{Base}/reject", new { zedId = Zed, certification = "Silver", reason = "No capacity" })).StatusCode);
        Assert.Equal("No capacity", FakeSql.Arg(Assert.Single(CallsTo("SP_FINANCIAL_ASSESSMENT_REJECT_UNIT_FOR_VERIFICATION")), "ReasonForRejection"));
        Assert.Equal("zed@qcin.org", Assert.Single(_host.Email.Sent).To);
    }

    [Fact]
    public async Task Only_the_assigned_dfo_the_co_the_admin_and_a_coordinator_in_scope_open_the_application()
    {
        At(2, 4, "DFO1");
        Assert.Equal(HttpStatusCode.NotFound, (await (await SignIn("DFO2")).GetAsync($"{Base}/{Zed}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await (await SignIn("CO2")).GetAsync($"{Base}/{Zed}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await (await SignIn("SC_UP")).GetAsync($"{Base}/{Zed}")).StatusCode);

        var dfo = await SignIn("DFO1");
        var apps = await dfo.GetFromJsonAsync<JsonElement>($"{Base}/{Zed}");
        var app = apps[0];
        Assert.True(app.GetProperty("canValidate").GetBoolean());
        Assert.False(app.GetProperty("canDecide").GetBoolean());
        Assert.Equal(2, app.GetProperty("documents").GetArrayLength());
        Assert.Equal("Solar dryer", app.GetProperty("technologies")[0].GetProperty("details").GetProperty("TechnologyName").GetString());
        Assert.DoesNotContain("leak", apps.GetRawText());

        // A state coordinator sees it only while it is in their NEFT list, for their state.
        At(4, 8, "DFO1", 1);
        _neftRows.Add(new { ZedId = Zed, CertificationType = "Silver", StateId = "09", PStateId = "09" });
        Assert.Equal(HttpStatusCode.NotFound, (await (await SignIn("SC_MH")).GetAsync($"{Base}/{Zed}")).StatusCode);
        var sc = await (await SignIn("SC_UP")).GetFromJsonAsync<JsonElement>($"{Base}/{Zed}");
        Assert.True(sc[0].GetProperty("canEditAmounts").GetBoolean());
        Assert.True(sc[0].GetProperty("canEditAccount").GetBoolean());
        Assert.Equal("0", FakeSql.Arg(CallsTo("SP_NEFT_TRANSACTIONS_BY_STATUS").Last(), "Status"));
    }

    [Fact]
    public async Task The_dfo_validates_an_opened_document_with_a_content_checked_screenshot_under_a_generated_name()
    {
        At(2, 4, "DFO1");
        var doc = Path.Combine(_host.StorageRoot, "mobileapi", "Photos", Zed, "TechnologyUpgradation", "20250101.pdf");
        Directory.CreateDirectory(Path.GetDirectoryName(doc)!);
        File.WriteAllBytes(doc, Pdf);
        var dfo = await SignIn("DFO1");

        MultipartFormDataContent Form(byte[]? file, string name = "shot.aspx")
        {
            var form = new MultipartFormDataContent { { new StringContent("Yes"), "isVerified" }, { new StringContent("GST portal"), "sourceOfValidation" } };
            if (file is not null) form.Add(new ByteArrayContent(file) { Headers = { ContentType = new MediaTypeHeaderValue("application/pdf") } }, "file", name);
            return form;
        }

        // Not opened yet.
        Assert.Equal(HttpStatusCode.BadRequest, (await dfo.PostAsync($"{Base}/{Zed}/Silver/documents/7001/validation", Form(Pdf))).StatusCode);
        var view = await dfo.GetAsync($"{Base}/{Zed}/Silver/documents/7001");
        Assert.Equal(HttpStatusCode.OK, view.StatusCode);
        Assert.Single(CallsTo("SP_FINANCIAL_ASSISTANCE_UPDATE_TIMESTAMP"));
        _photos[0]["DocumentOpenedTime"] = DateTime.Now;

        // A purchased technology needs a screenshot; a script named .pdf is refused by its content.
        Assert.Equal(HttpStatusCode.BadRequest, (await dfo.PostAsync($"{Base}/{Zed}/Silver/documents/7001/validation", Form(null))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await dfo.PostAsync($"{Base}/{Zed}/Silver/documents/7001/validation", Form("<%@ Page %>"u8.ToArray(), "x.pdf"))).StatusCode);

        var ok = await dfo.PostAsync($"{Base}/{Zed}/Silver/documents/7001/validation", Form(Pdf));
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var folder = Path.Combine(_host.StorageRoot, "Uploads", "TechnologyUpgradation", Zed, "Silver", "Screenshots");
        var saved = Assert.Single(Directory.GetFiles(folder));
        Assert.EndsWith(".pdf", saved);
        Assert.StartsWith(DateTime.Now.ToString("yyyyMMdd"), Path.GetFileName(saved));
        var call = Assert.Single(CallsTo("SP_FINANCIAL_ASSISTANCE_VALIDATE_EVIDENCES"));
        Assert.Equal("7001", FakeSql.Arg(call, "Id"));

        // Another DFO cannot.
        var other = await SignIn("DFO2");
        Assert.Equal(HttpStatusCode.NotFound, (await other.PostAsync($"{Base}/{Zed}/Silver/documents/7001/validation", Form(Pdf))).StatusCode);
    }

    [Fact]
    public async Task Amounts_are_checked_on_the_server_and_only_the_coordinator_changes_them_while_the_payout_is_pending()
    {
        At(4, 8, "DFO1", 1);
        _neftRows.Add(new { ZedId = Zed, CertificationType = "Silver", StateId = "9" });
        var dfo = await SignIn("DFO1");
        Assert.Equal(HttpStatusCode.Forbidden, (await dfo.PostAsJsonAsync($"{Base}/{Zed}/Silver/technologies/301/amount", new { amountPaid = "1000" })).StatusCode);

        var sc = await SignIn("SC_UP");
        Assert.Equal(HttpStatusCode.BadRequest, (await sc.PostAsJsonAsync($"{Base}/{Zed}/Silver/technologies/301/amount", new { amountPaid = "130000" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await sc.PostAsJsonAsync($"{Base}/{Zed}/Silver/technologies/301/amount", new { amountPaid = "-5" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await sc.PostAsJsonAsync($"{Base}/{Zed}/Silver/technologies/301/amount", new { amountPaid = "12.345" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await sc.PostAsJsonAsync($"{Base}/{Zed}/Silver/technologies/999/amount", new { amountPaid = "100" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await sc.PostAsJsonAsync($"{Base}/{Zed}/Silver/technologies/301/amount", new { amountPaid = "120000.5" })).StatusCode);
        var call = Assert.Single(CallsTo("SP_FINANCIAL_ASSISTANCE_UPDATE_TECHNOLOGY_DATA"));
        Assert.Equal("301", FakeSql.Arg(call, "Id"));
        Assert.Equal("120000.50", FakeSql.Arg(call, "AmountPaid"));

        Assert.Equal(HttpStatusCode.OK, (await sc.PostAsJsonAsync($"{Base}/{Zed}/Silver/account",
            new { accountNo = "987654321098", ifscCode = "HDFC0000123", branchAddress = "X", bankName = "HDFC" })).StatusCode);
        Assert.Single(CallsTo("SP_FINANCIAL_ASSISTANCE_UPDATE_ACCOUNT_DETAILS"));

        // Once paid, nothing changes.
        _fa["TransactionStatus"] = 1;
        Assert.Equal(HttpStatusCode.BadRequest, (await sc.PostAsJsonAsync($"{Base}/{Zed}/Silver/technologies/301/amount", new { amountPaid = "100" })).StatusCode);
    }

    [Fact]
    public async Task Decisions_follow_the_tu_states()
    {
        // The DFO decides from the consultant app only: the legacy page has its ACCEPT / REJECT commented out.
        At(2, 5, "DFO1");
        _photos.ForEach(p => p["IsVerified"] = "Yes");
        _fa["MeetingSubmitted"] = 1;
        var dfo = await SignIn("DFO1");
        var page = await dfo.GetFromJsonAsync<JsonElement>($"{Base}/{Zed}");
        Assert.False(page[0].GetProperty("canDecide").GetBoolean());
        Assert.Equal(HttpStatusCode.Forbidden, (await dfo.PostAsJsonAsync($"{Base}/{Zed}/Silver/decision", new { decision = "approve" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await dfo.PostAsJsonAsync($"{Base}/{Zed}/Silver/decision", new { decision = "reject", comments = "x" })).StatusCode);
        Assert.Empty(CallsTo("SP_FINANCIAL_ASSISTANCE_FINAL_AUBMIT"));

        // The CO in QC; the master admin may only reject, and only before the DFO's decision while no CO is set.
        At(3, 6, "DFO1", 1);
        var co = await SignIn("CO1");
        Assert.Equal(HttpStatusCode.OK, (await co.PostAsJsonAsync($"{Base}/{Zed}/Silver/decision", new { decision = "reject", comments = "Recheck" })).StatusCode);
        Assert.Equal("2", FakeSql.Arg(CallsTo("SP_FINANCIAL_ASSISTANCE_FINAL_AUBMIT").Last(), "RoleId"));
        Assert.Empty(_host.Email.Sent);
        var admin = await SignIn("MADMIN");
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync($"{Base}/{Zed}/Silver/decision", new { decision = "reject", comments = "x" })).StatusCode);
        At(1, 2);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync($"{Base}/{Zed}/Silver/decision", new { decision = "reject", comments = "x" })).StatusCode);
        _fa["CertificationBodyUserId"] = null;
        Assert.True((await admin.GetFromJsonAsync<JsonElement>($"{Base}/{Zed}"))[0].GetProperty("canDecide").GetBoolean());
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync($"{Base}/{Zed}/Silver/decision", new { decision = "approve" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync($"{Base}/{Zed}/Silver/decision", new { decision = "reject", comments = "Duplicate" })).StatusCode);
        Assert.Equal("7", FakeSql.Arg(CallsTo("SP_FINANCIAL_ASSISTANCE_FINAL_AUBMIT").Last(), "RoleId"));
    }

    [Fact]
    public async Task The_tu_report_is_an_authorised_pdf_once_the_dfo_approved()
    {
        _host.Sql.Procs["SP_REPORT_GET_TECHNOLOGY_UPGRADATION_DETAILS"] = _ => FakeSql.Sets(
            [new { ZedId = Zed, CertificationType = "Silver", PUnitName = "Acme Unit", PlantAddress = "Plot 4", TotalPaidAfterQc = "125000.00", EligibleAmount = "100000.00", AccountNo = "123456789012", MSMEDFOOffice = "CO One", ApproverOfficialName = "Dfo One" }],
            [], [new { TechnologyCode = "12", TechnologyName = "Solar dryer" }],
            [new { TechnologyName = "Solar dryer", AmountPaid = "125000", techCount = 1 }],
            [new { Comments = "Met the owner", CertificationType = "Silver" }],
            [new { Name = "A Person", Designation = "Owner", CertificationType = "Silver" }], [], []);
        At(2, 5, "DFO1");
        var co = await SignIn("CO1");
        Assert.Equal(HttpStatusCode.NotFound, (await co.GetAsync($"{Base}/{Zed}/Silver/report")).StatusCode);
        At(3, 6, "DFO1", 1);
        var anonymous = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync($"{Base}/{Zed}/Silver/report")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await (await SignIn("CO2")).GetAsync($"{Base}/{Zed}/Silver/report")).StatusCode);
        var pdf = await co.GetAsync($"{Base}/{Zed}/Silver/report");
        Assert.Equal(HttpStatusCode.OK, pdf.StatusCode);
        Assert.Equal("application/pdf", pdf.Content.Headers.ContentType?.MediaType);
        Assert.StartsWith("%PDF", Encoding.ASCII.GetString((await pdf.Content.ReadAsByteArrayAsync())[..4]));
        var call = Assert.Single(CallsTo("SP_REPORT_GET_TECHNOLOGY_UPGRADATION_DETAILS"));
        Assert.Equal("3", FakeSql.Arg(call, "NcCount"));
    }

    // ------------------------------------------------------------------ app endpoint

    private static object Meeting(string saId, string name = "Opening Meeting Photo", string photoId = "p1", byte[]? photo = null) => new
    {
        saId, zedId = Zed, certificationType = "Silver", latitude = "26.4", longitude = "80.3", inputComment = "Met the owner",
        deviceInfo = new { deviceId = "dev-1" },
        assessmentPhotos = new[] { new { name, photoId, photo = Convert.ToBase64String(photo ?? Jpeg), timeStamp = "2025-01-01 10:00" } },
        startParticipants = new[] { new { name = "A Person", designation = "Owner" } },
    };

    private async Task<JsonElement> PostMeeting(object body)
    {
        var client = _host.CreateClient();
        var r = await client.PostAsJsonAsync("/FinancialAssistance/SubmitOpenMeeting", body);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        return await r.Content.ReadFromJsonAsync<JsonElement>();
    }

    [Fact]
    public async Task The_app_endpoint_keeps_its_contract_and_requires_the_allotted_dfo()
    {
        _host.Sql.Procs["SP_FINANCIAL_ASSISTANCE_SUBMIT_OPEN_MEETING"] = _ => FakeSql.Sets([new { StatusCode = 200, StatusMessage = "" }]);
        At(2, 4, "DFO1");

        var wrong = await PostMeeting(Meeting("DFO2"));
        Assert.Equal("0", wrong.GetProperty("status").GetString());
        Assert.Empty(CallsTo("SP_FINANCIAL_ASSISTANCE_SUBMIT_OPEN_MEETING"));

        var traversal = await PostMeeting(Meeting("DFO1", name: "..\\..\\web"));
        Assert.Equal("Invalid Data.", traversal.GetProperty("errorMessage").GetString());
        var script = await PostMeeting(Meeting("DFO1", photo: "<%@ Page Language=\"C#\" %>"u8.ToArray()));
        Assert.Equal("0", script.GetProperty("status").GetString());

        var ok = await PostMeeting(Meeting("dfo1"));
        Assert.Equal("1", ok.GetProperty("status").GetString());
        var file = Path.Combine(_host.StorageRoot, "Uploads", "TechnologyUpgradation", Zed, "Silver", "OpenMeeting", "Opening Meeting Photo_p1.jpg");
        Assert.True(File.Exists(file));
        var call = Assert.Single(CallsTo("SP_FINANCIAL_ASSISTANCE_SUBMIT_OPEN_MEETING"));
        Assert.Equal("DFO1", FakeSql.Arg(call, "AssessorId"));
        Assert.Equal("Open Meeting", FakeSql.Arg(call, "PhotoType"));

        // Once submitted, not again; not once the DFO has decided.
        _fa["MeetingSubmitted"] = 1;
        Assert.Equal("0", (await PostMeeting(Meeting("DFO1"))).GetProperty("status").GetString());
        _fa["MeetingSubmitted"] = 0;
        At(3, 6, "DFO1", 1);
        Assert.Equal("0", (await PostMeeting(Meeting("DFO1"))).GetProperty("status").GetString());
    }

    [Fact]
    public async Task A_procedure_failure_removes_the_saved_photos_and_hides_the_sql_error()
    {
        _host.Sql.Procs["SP_FINANCIAL_ASSISTANCE_SUBMIT_OPEN_MEETING"] = _ => FakeSql.Sets([new { StatusCode = 547, StatusMessage = "The INSERT statement conflicted" }]);
        At(2, 4, "DFO1");
        var r = await PostMeeting(Meeting("DFO1"));
        Assert.Equal("0", r.GetProperty("status").GetString());
        Assert.DoesNotContain("INSERT", r.GetRawText());
        Assert.False(File.Exists(Path.Combine(_host.StorageRoot, "Uploads", "TechnologyUpgradation", Zed, "Silver", "OpenMeeting", "Opening Meeting Photo_p1.jpg")));
    }
}

/// <summary>Technology recommendation after milestone 3 (finding #89).</summary>
public sealed class TechnologyRecommendationTests : IDisposable
{
    private const string Zed = "ZEDMSME000600";
    private const string Base = "/api/staff/consultancy/technology";
    private readonly TestHost _host = new();
    private Dictionary<string, object?> _cert = new()
    {
        ["Id"] = 3883, ["ZedId"] = Zed, ["Certification"] = "Silver", ["NcCount"] = 3, ["CertificationStatus"] = 100, ["TuStatus"] = 0,
        ["SiteAssessorId"] = "CC1", ["CertificationBodyUserId"] = "CO1",
    };
    private string _selected = "";
    private string _inProgress = "";

    public TechnologyRecommendationTests()
    {
        TuTestUsers.Register(_host);
        _host.Sql.Queries["SELECT TOP 1 Id, ZedId, Certification, NcCount"] = args => FakeSql.Arg(args, "ZedId") == Zed ? [_cert] : [];
        _host.Sql.Procs["SP_TECHNOLOGIES_GET_LIST"] = _ => FakeSql.Sets(
            Enumerable.Range(1, 12).Select(i => (object)new
            {
                TechnologyCode = i.ToString(), TechnologyName = $"Tech {i}", Description = "d",
                IsSelected = _selected.Split(',').Contains(i.ToString()) ? "Yes" : "No",
            }),
            [new { PreviousRecomInProgress = _inProgress }]);
    }

    public void Dispose() => _host.Dispose();

    private IEnumerable<object?> Inserts => _host.Sql.Calls.Where(c => c.Name == "SP_TECHNOLOGIES_INSERT_TECHNOLOGIES_FOR_UNIT").Select(c => c.Args);

    [Fact]
    public async Task The_lead_consultant_recommends_once_from_the_offered_list()
    {
        var cc = await TuTestUsers.SignInAsync(_host, "CC1");
        var page = await cc.GetFromJsonAsync<JsonElement>($"{Base}/{Zed}/Silver");
        Assert.True(page.GetProperty("canRecommend").GetBoolean());
        Assert.Equal(12, page.GetProperty("technologies").GetArrayLength());

        Assert.Equal(HttpStatusCode.BadRequest, (await cc.PostAsJsonAsync($"{Base}/{Zed}/Silver", new { codes = new[] { "1" }, confirmed = false })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await cc.PostAsJsonAsync($"{Base}/{Zed}/Silver", new { codes = new[] { "99" }, confirmed = true })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await cc.PostAsJsonAsync($"{Base}/{Zed}/Silver",
            new { codes = Enumerable.Range(1, 11).Select(i => i.ToString()), confirmed = true })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await cc.PostAsJsonAsync($"{Base}/{Zed}/Silver", new { codes = new[] { "2", "5", "5" }, confirmed = true })).StatusCode);
        var call = Assert.Single(Inserts);
        Assert.Equal("2,5", FakeSql.Arg(call, "SelectedCode"));
        Assert.Equal("3883", FakeSql.Arg(call, "CertId"));
        Assert.Equal("Silver", FakeSql.Arg(call, "Certification"));

        // Recommended: read-only from now on, for the consultant and the CO.
        _cert["TuStatus"] = 1;
        _selected = "2,5";
        Assert.Equal(HttpStatusCode.BadRequest, (await cc.PostAsJsonAsync($"{Base}/{Zed}/Silver", new { codes = new[] { "3" }, confirmed = true })).StatusCode);
        var co = await TuTestUsers.SignInAsync(_host, "CO1");
        var view = await co.GetFromJsonAsync<JsonElement>($"{Base}/{Zed}/Silver");
        Assert.True(view.GetProperty("recommended").GetBoolean());
        Assert.False(view.GetProperty("canRecommend").GetBoolean());
        Assert.Equal(2, view.GetProperty("technologies").GetArrayLength());
    }

    [Fact]
    public async Task Others_and_early_requests_are_refused()
    {
        var other = await TuTestUsers.SignInAsync(_host, "CC2");
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync($"{Base}/{Zed}/Silver")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.PostAsJsonAsync($"{Base}/{Zed}/Silver", new { codes = new[] { "1" }, confirmed = true })).StatusCode);
        var co = await TuTestUsers.SignInAsync(_host, "CO1");
        Assert.Equal(HttpStatusCode.Forbidden, (await co.PostAsJsonAsync($"{Base}/{Zed}/Silver", new { codes = new[] { "1" }, confirmed = true })).StatusCode);
        var coPage = await co.GetFromJsonAsync<JsonElement>($"{Base}/{Zed}/Silver");
        Assert.Equal(0, coPage.GetProperty("technologies").GetArrayLength());

        var cc = await TuTestUsers.SignInAsync(_host, "CC1");
        _cert["CertificationStatus"] = 16;
        Assert.Equal(HttpStatusCode.BadRequest, (await cc.PostAsJsonAsync($"{Base}/{Zed}/Silver", new { codes = new[] { "1" }, confirmed = true })).StatusCode);
        _cert["CertificationStatus"] = 100;
        _inProgress = "Previous recommendations are in progress. Please try later.";
        var busy = await cc.PostAsJsonAsync($"{Base}/{Zed}/Silver", new { codes = new[] { "1" }, confirmed = true });
        Assert.Equal(HttpStatusCode.BadRequest, busy.StatusCode);
        Assert.Contains("in progress", await busy.ProblemTitle() ?? "");
        Assert.Empty(Inserts);
    }
}
