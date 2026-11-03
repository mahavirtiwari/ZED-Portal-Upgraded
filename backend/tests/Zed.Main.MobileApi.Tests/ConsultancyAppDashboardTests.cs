using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Zed.Core.Assessment;
using Zed.Core.Mobile;
using Zed.Core.Security;
using Zed.Main.MobileApi.Controllers;
using Zed.Main.MobileApi.Controllers.Consultancy;

namespace Zed.Main.MobileApi.Tests;

/// <summary>
/// The redesigned consultant app on the Consultancy host: SA/SignIn without a ZED ID, the dashboard reads (SA/Assessments,
/// SA/Assessment, SA/Notifications, SA/Reports), the NIC sector name and the site tour sections of milestone 1.
/// </summary>
public sealed class ConsultancyAppDashboardTests : IDisposable
{
    private const string Password = "Consult#1";
    private const string Lead = "ZEDCC0001";
    private const string Co = "ZEDCC1019";
    private const string Zed = "ZEDMSME000001";
    private const string Co1 = "ZEDCO0001";
    private readonly ConsultancyAppHost _t = new();
    private int _milestone = 1;
    private int _status = 9;
    private int _open = 1;
    private int _role = 3;
    private bool _active = true;
    private bool _siteVerification = true;
    private readonly DateTime _tomorrow = DateTime.Today.AddDays(1).AddHours(10);
    private readonly Dictionary<string, object?> _flags = new()
    {
        ["OpenMeetingSubmitted"] = true, ["AllParametersSyncedByLead"] = true, ["AllParametersSyncedByCo"] = true,
        ["FinalSubmissionDone"] = true, ["ClosingMeetingSubmitted"] = false,
    };

    public ConsultancyAppDashboardTests()
    {
        _t.Settings["Mobile:AppTokenKey"] = AppTokenTests.Key;
        _t.Sql.Allot(Zed, "Silver", "Lead", Lead);
        _t.Sql.Allot(Zed, "Silver", "Co", Co);

        // SP_APP_SA_CHECK_LOGIN_V2: without a unit, the "not yet allocated" branch for a valid account (the master value too);
        // with the unit, the Users row and the consultant sub-procedure's sets.
        _t.Fake.Procs["SP_APP_SA_CHECK_LOGIN_V2"] = args =>
        {
            var pw = FakeSql.Arg(args, "Password");
            if (pw is not (Password or "MASTER"))
                return FakeSql.Sets([new Dictionary<string, object?> { ["StatusCode"] = "0", ["ErrorMessage"] = "Invalid Credentials. Please check" }]);
            var zedId = FakeSql.Arg(args, "ZedId");
            if (zedId is null)
                return FakeSql.Sets([new Dictionary<string, object?>
                {
                    ["StatusCode"] = "0",
                    ["ErrorMessage"] = _siteVerification ? ConsultancySAController.NotAllocated : ConsultancySAController.DfoNotAllocated,
                }]);
            return FakeSql.Sets([[UserRow(FakeSql.Arg(args, "UserId")!, "1")], .. UnitSets(FakeSql.Arg(args, "UserId")!)]);
        };
        _t.Fake.Procs["SP_APP_SA_CONSULTANCY_CHECK_LOGIN"] = args => FakeSql.Sets(UnitSets(FakeSql.Arg(args, "UserId")!));
        _t.Fake.Queries[ConsultancySAController.SignInUserSql] = args => FakeSql.Arg(args, "Password") is Password or "MASTER"
            ? [UserRow(FakeSql.Arg(args, "UserId")!, null)] : [];
        _t.Fake.Queries[ConsultancySAController.OpenUnitSql] = args => [FakeSql.Arg(args, "ZedId") == Zed ? _open : 0];
        _t.Fake.Queries[ConsultancySAController.CurrentMilestoneSql] = _ => [_milestone];
        _t.Fake.Queries[SaAppData.AssessorSql] = args => FakeSql.Arg(args, "UserId") is Lead or Co
            ? [new { UserId = FakeSql.Arg(args, "UserId"), RoleId = 3, IsActive = _active, SiteVerification = true }]
            : [];
        _t.Fake.Queries[SaAppData.AgencySql] = args => FakeSql.Arg(args, "UserId") == Co1
            ? [new { UserName = "Acme Consulting LLP", Email = "help@acme-consult.example", MobileNo = "9810000000" }] : [];
        _t.Fake.Queries[SAController.SectorNameSql] = args => FakeSql.Arg(args, "Code") == "24" ? ["Manufacture of basic metals"] : [];
        _t.Fake.Queries[ConsultancyAppData.CasesSql] = _ =>
        [
            // Milestone 1 completed and milestone 2 started: one case, at milestone 2.
            Row(Zed, "Silver", 1, 16, statusDate: DateTime.Now.AddDays(-20)),
            Row(Zed, "Silver", 2, 9, open: true, representative: "Rajeev Khanna", latitude: "18.52"),
            Row("ZEDMSME000002", "Gold", 1, 9, lead: "ZEDCC0003", date: _tomorrow),
            Row("ZEDMSME000003", "Silver", 3, 15),
            Row("ZEDMSME000004", "Gold", 2, 13, sentBack: 1),
            Row("ZEDMSME000005", "Silver", 3, 100, statusDate: DateTime.Now.AddDays(-2)),
        ];
        _t.Fake.Queries[ConsultancyAppData.TeamSql] = _ =>
        [
            new { ZedId = Zed, Certification = "Silver", NcCount = 2, CoAssessorId = Co, UserName = "Co Name", Email = "co@zed.test", MobileNo = "9850499001" },
            new { ZedId = Zed, Certification = "Silver", NcCount = 2, CoAssessorId = "ZEDCC0007", UserName = "Second Co", Email = (string?)null, MobileNo = (string?)null },
            new { ZedId = "ZEDMSME000002", Certification = "Gold", NcCount = 1, CoAssessorId = Lead, UserName = "Lead Name", Email = "lead@zed.test", MobileNo = "9810011122" },
        ];
        _t.Fake.Queries[ConsultancyAppData.HistorySql] = _ =>
        [
            History(104, "ZEDMSME000004", "Gold", "CO Send back to Consultant", "CO send back to Consultant On November 1, 2026", -2, 2),
            History(103, Zed, "Silver", "Completed", "Agency Completed On October 14, 2026", -20, 1),
            History(101, "ZEDMSME000002", "Gold", "ScheduledOn", "Scheduled on  2026-11-04", -6, 1),
        ];
        _t.Fake.Queries[ConsultancyAppData.ReportsSql] = _ =>
        [
            Row("ZEDMSME000005", "Silver", 3, 100, statusDate: DateTime.Now.AddDays(-2)),
            Row(Zed, "Silver", 1, 16, statusDate: DateTime.Now.AddDays(-20)),
            Row("ZEDMSME000004", "Gold", 2, 13),
            Row("ZEDMSME000006", "Bronze", 1, 16),
        ];
    }

    public void Dispose() => _t.Dispose();

    private Dictionary<string, object?> UserRow(string user, string? statusCode)
    {
        var row = new Dictionary<string, object?>
        {
            ["UserId"] = user, ["Password"] = Password, ["RoleId"] = _role, ["UserName"] = "Mahavir Tiwari", ["Email"] = "lead@zed.test",
            ["MobileNo"] = "9810011122", ["CreatedBy"] = Co1, ["IsActive"] = true,
            ["SiteVerification"] = _siteVerification, ["FinancialVerification"] = !_siteVerification,
        };
        if (statusCode is not null)
        {
            row["StatusCode"] = statusCode;
            row["ErrorMessage"] = "";
        }
        return row;
    }

    /// <summary>SP_APP_SA_CONSULTANCY_CHECK_LOGIN's nine sets (SP_APP_SA_CHECK_LOGIN_V2's sets 1 to 9).</summary>
    private IEnumerable<object>[] UnitSets(string user) =>
    [
        user is Lead or Co
            ? [new Dictionary<string, object?>
            {
                ["AssessmentDate"] = "05/01/2024 10:00:00 AM", ["EnterpriseName"] = "Acme", ["Sector"] = "24", ["UnitAddress"] = "Plot 1AgraUP282001",
                ["Email"] = "u@x.in", ["PhoneNumber"] = "999", ["UserType"] = user == Lead ? 1 : 2, ["CertificationStatus"] = _status,
                ["LeadAssessorId"] = Lead, ["LeadAssessorName"] = "Lead", ["CoAssessorId"] = Co, ["CoAssessorName"] = "Co One",
                ["ZedId"] = Zed, ["CertificationType"] = "Silver", ["AuditsConducted"] = "Yes", ["DomesticCustomers"] = "D",
                ["InternationalCustomers"] = "I", ["RawMaterialImported"] = "No", ["OutsourcedProcesses"] = "O", ["EnergySources"] = "Solar,Grid",
                ["Milestone"] = _milestone, ["BdsFromDate"] = "01-02-2024", ["BdsToDate"] = "02-02-2024", ["HapFromDate"] = "03-02-2024",
                ["HapToDate"] = "04-02-2024", ["PAddress"] = "Plot 1", ["PDistrictName"] = "Agra", ["PStateName"] = "UP", ["PPincode"] = "282001",
            }]
            : [],
        [new { Id = 7, SectionId = "1", SectionName = "Leadership", SectionCode = "1", IsAssessmentExcempted = "No" }],
        [new { Id = 11, ProductName = "Bolt", Exported = "No" }],
        [new { Id = 12, RawMaterialName = "Steel", RawMaterialPercentage = "80", CountryName = "India" }],
        [new Dictionary<string, object?> { ["Id"] = 210, ["SectionCode"] = "1", ["RequirementCode"] = "R1", ["PrevReqId"] = 21, ["SaConformance"] = "Yes" }],
        [new { Id = 31, SectionCode = "1", RequirementCode = "R1", OptionCode = "O1", OptionName = "Yes" }],
        [],
        [new Dictionary<string, object?> { ["OpenMeetingSubmitted"] = true, ["SelfieSubmitted"] = false }],
        [new { Id = 1, RequirementId = 21, BulletPoints = "Gap A", ReqType = "BaselineDiagnostic" }],
    ];

    private static object Row(string zedId, string level, int milestone, int status, string lead = Lead, DateTime? date = null, bool open = false,
        DateTime? statusDate = null, string? representative = null, string? latitude = null, int sentBack = 0) => new
    {
        ZedId = zedId, Certification = level, NcCount = milestone, CertificationStatus = status, CertificationStatusDate = statusDate,
        AssessmentDate = date ?? new DateTime(2026, 10, 1, 10, 0, 0), SendBackStatus = sentBack,
        SiteAssessorId = lead, LeadName = "Lead Name", LeadEmail = "lead@zed.test", LeadMobile = "9810011122",
        EnterpriseName = "Unit " + zedId[^1], UnitName = "Plant 1", Address = "12, MG Road", District = "Pune", State = "Maharashtra", Pincode = "411001",
        OwnerName = "Owner Person", UnitMobile = "9876543210", UnitEmail = "unit@acme.test",
        RepresentativeName = representative, RepresentativeDesignation = representative is null ? null : "Quality Head",
        Latitude = latitude, Longitude = latitude is null ? null : "73.85", OpenMeetingSubmitted = open,
        Milestone1Status = milestone == 1 ? status : 16, Milestone2Status = milestone == 2 ? status : milestone > 2 ? 100 : (int?)null,
        Milestone3Status = milestone == 3 ? status : (int?)null, LatestMilestone = milestone,
    };

    private static object History(long id, string zedId, string level, string type, string text, int days, int milestone) => new
    {
        Id = id, ZedId = zedId, CertificationType = level, StatusType = type, Descrip = text, CreatedDate = DateTime.Now.AddDays(days), NcCount = milestone,
    };

    private async Task<JsonElement> Call(string path, object body, string? token)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, path)
        {
            Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"),
        };
        if (token is not null) request.Headers.Add(AppTokens.Header, token);
        var r = await _t.Client.SendAsync(request);
        return JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement.Clone();
    }

    private Task<JsonElement> SignIn(string password = Password, string? version = "1.0", string user = Lead) =>
        _t.Json("/SA/SignIn", new { assessorId = user, password, version, deviceInfo = new { deviceId = "cc-phone" } });

    private async Task<string> TokenAsync(string user = Lead) => (await SignIn(user: user)).GetProperty("appToken").GetString()!;

    private static void AssertFail(JsonElement e, string message)
    {
        Assert.Equal("0", e.GetProperty("status").GetString());
        Assert.Equal(message, e.GetProperty("errorMessage").GetString());
    }

    private static void AssertExpired(JsonElement e) => AssertFail(e, AppTokens.ExpiredMessage);

    // ---------------------------------------------------------------- SA/SignIn

    [Fact]
    public async Task Sign_in_without_a_zed_id_answers_the_token_profile_cases_and_sections()
    {
        var e = await SignIn();
        Assert.Equal("1", e.GetProperty("status").GetString());
        Assert.False(string.IsNullOrEmpty(e.GetProperty("appToken").GetString()));
        Assert.DoesNotContain(Password, e.GetRawText());

        // The login procedure is called without a unit; the Users row is read as it selects it.
        var call = _t.LastArgs("SP_APP_SA_CHECK_LOGIN_V2");
        Assert.Null(FakeSql.Arg(call, "ZedId"));
        Assert.Equal(Lead, FakeSql.Arg(call, "UserId"));
        Assert.Equal(Lead, FakeSql.Arg(_t.LastArgs(ConsultancySAController.SignInUserSql), "UserId"));
        Assert.Contains("cc-phone", _t.Devices.Known[(MobileApps.SiteAssessor, Lead)]);
        // No unit: nothing recorded for the technology upgradation calls.
        Assert.DoesNotContain(_t.Fake.Calls, c => c.Name.Contains("V4AppSessions", StringComparison.Ordinal));

        var p = e.GetProperty("profile");
        Assert.Equal(Lead, p.GetProperty("assessorId").GetString());
        Assert.Equal("Mahavir Tiwari", p.GetProperty("name").GetString());
        Assert.Equal("lead@zed.test", p.GetProperty("email").GetString());
        Assert.Equal("9810011122", p.GetProperty("mobile").GetString());
        Assert.Equal(Co1, p.GetProperty("agencyId").GetString());
        Assert.Equal("Acme Consulting LLP", p.GetProperty("agencyName").GetString());
        Assert.Equal("help@acme-consult.example", p.GetProperty("agencyEmail").GetString());
        Assert.Equal("9810000000", p.GetProperty("agencyMobile").GetString());

        var counts = e.GetProperty("counts");
        Assert.Equal(5, counts.GetProperty("total").GetInt32());
        Assert.Equal(1, counts.GetProperty("upcoming").GetInt32());
        Assert.Equal(2, counts.GetProperty("ongoing").GetInt32());
        Assert.Equal(1, counts.GetProperty("submitted").GetInt32());
        Assert.Equal(1, counts.GetProperty("completed").GetInt32());
        Assert.Equal(0, counts.GetProperty("closed").GetInt32());
        Assert.Equal(5, e.GetProperty("assessments").GetArrayLength());

        var sections = e.GetProperty("siteTourSections");
        Assert.Equal(10, sections.GetArrayLength());
        Assert.Equal("Production / Machine Shop", sections[2].GetProperty("title").GetString());
        Assert.Equal(0, sections[2].GetProperty("uploaded").GetInt32());
    }

    [Fact]
    public async Task A_case_is_the_latest_milestone_with_its_progress_team_spoc_and_location()
    {
        var a = (await SignIn()).GetProperty("assessments");
        var first = a.EnumerateArray().Single(c => c.GetProperty("zedId").GetString() == Zed);
        Assert.Equal(2, first.GetProperty("milestone").GetInt32());
        Assert.Equal("Silver", first.GetProperty("certificationType").GetString());
        Assert.Equal("inProgress", first.GetProperty("stage").GetString());
        Assert.Equal("In Progress", first.GetProperty("statusLabel").GetString());
        Assert.Equal("2026-10-01T10:00:00", first.GetProperty("assessmentDate").GetString());
        Assert.True(first.GetProperty("canOpen").GetBoolean());
        Assert.Equal("Lead", first.GetProperty("role").GetString());
        Assert.Equal(1, first.GetProperty("userType").GetInt32());
        var steps = first.GetProperty("milestones").EnumerateArray().ToList();
        Assert.Equal(["done", "current", "locked"], steps.Select(s => s.GetProperty("status").GetString()));
        Assert.Equal([1, 2, 3], steps.Select(s => s.GetProperty("no").GetInt32()));
        Assert.Equal("Progress Review 1", steps[1].GetProperty("label").GetString());

        var team = first.GetProperty("team").EnumerateArray().ToList();
        Assert.Equal([Lead, Co, "ZEDCC0007"], team.Select(m => m.GetProperty("assessorId").GetString()));
        Assert.Equal(["Lead", "Co", "Co"], team.Select(m => m.GetProperty("role").GetString()));
        Assert.Equal("co@zed.test", team[1].GetProperty("email").GetString());
        var spoc = first.GetProperty("spoc");
        Assert.Equal("Rajeev Khanna", spoc.GetProperty("name").GetString());
        Assert.Equal("representative", spoc.GetProperty("source").GetString());
        Assert.Equal("18.52", first.GetProperty("latitude").GetString());
        Assert.Equal("Pune", first.GetProperty("district").GetString());

        // A co-consultant's case, before its open meeting: the owner as contact.
        var co = a.EnumerateArray().Single(c => c.GetProperty("zedId").GetString() == "ZEDMSME000002");
        Assert.Equal("Co", co.GetProperty("role").GetString());
        Assert.Equal(2, co.GetProperty("userType").GetInt32());
        Assert.Equal("scheduled", co.GetProperty("stage").GetString());
        Assert.Equal("owner", co.GetProperty("spoc").GetProperty("source").GetString());
        Assert.Equal(["current", "locked", "locked"], co.GetProperty("milestones").EnumerateArray().Select(s => s.GetProperty("status").GetString()));

        var sentBack = a.EnumerateArray().Single(c => c.GetProperty("zedId").GetString() == "ZEDMSME000004");
        Assert.Equal("sentBack", sentBack.GetProperty("stage").GetString());
        Assert.False(sentBack.GetProperty("canOpen").GetBoolean());
        var accepted = a.EnumerateArray().Single(c => c.GetProperty("zedId").GetString() == "ZEDMSME000005");
        Assert.Equal("completed", accepted.GetProperty("stage").GetString());
        Assert.Equal("Accepted", accepted.GetProperty("statusLabel").GetString());
        Assert.Equal(["done", "done", "done"], accepted.GetProperty("milestones").EnumerateArray().Select(s => s.GetProperty("status").GetString()));
    }

    [Theory]
    [InlineData(8, false, 0, "scheduled")]
    [InlineData(9, false, 0, "scheduled")]
    [InlineData(9, true, 0, "inProgress")]
    [InlineData(13, true, 0, "submitted")]
    [InlineData(13, true, 1, "sentBack")]
    [InlineData(15, true, 0, "underReview")]
    [InlineData(16, true, 0, "completed")]
    [InlineData(100, true, 0, "completed")]
    [InlineData(99, true, 0, "rejected")]
    [InlineData(6, false, 0, "closed")]
    public void Stages_follow_the_milestone_status(int status, bool open, int sentBack, string stage) =>
        Assert.Equal(stage, ConsultancyAppData.StageOf(new ConsultancyAppData.CaseRow
        {
            CertificationStatus = status, OpenMeetingSubmitted = open, SendBackStatus = sentBack,
        }).Stage);

    [Fact]
    public async Task Sign_in_makes_the_checks_of_login()
    {
        var wrong = await SignIn("nope");
        AssertFail(wrong, "Invalid Credentials. Please check");
        Assert.False(wrong.TryGetProperty("appToken", out _));
        Assert.Equal(JsonValueKind.Null, wrong.GetProperty("assessments").ValueKind);

        // The procedure family's master password: the row's own password differs.
        AssertFail(await SignIn("MASTER"), ConsultancySAController.InvalidCredentials);
        Assert.Empty(_t.Devices.Known);

        _role = 5;
        AssertFail(await SignIn(), ConsultancySAController.InvalidCredentials);
        _role = 3;

        for (var i = 0; i < 2; i++) await SignIn("nope");
        AssertFail(await SignIn(), ConsultancySAController.TooManyAttempts);
    }

    [Fact]
    public async Task Sign_in_tells_old_versions_to_update_and_refuses_a_DFO_account()
    {
        _t.Settings["Mobile:CheckSaVersion"] = "true";
        _t.Settings["Mobile:SaVersion"] = "2.0";
        var e = await SignIn();
        Assert.Equal("2", e.GetProperty("status").GetString());
        Assert.Equal(ConsultancySAController.UpdateAppMessage, e.GetProperty("errorMessage").GetString());
        Assert.Empty(_t.CallsTo("SP_APP_SA_CHECK_LOGIN_V2"));

        _siteVerification = false;
        var dfo = await SignIn(version: "2.0");
        AssertFail(dfo, ConsultancySAController.DfoSignIn);
        Assert.False(dfo.TryGetProperty("appToken", out _));
        Assert.Empty(_t.Devices.Known);
    }

    [Fact]
    public async Task The_unit_free_token_works_for_the_existing_calls_which_still_check_the_allotment()
    {
        _t.Settings["Mobile:AppTokens:Apps:SA"] = "Enforce";
        _t.Fake.Procs["SP_SA_APP_CHECK_STATUS"] = _ => FakeSql.Sets([new Dictionary<string, object?>(_flags)]);
        var token = await TokenAsync();
        var photo = new { photoId = "t1", photo = AssessorTestHost.JpegBase64, comment = "gate", timeStamp = "t", latitude = "1", longitude = "2" };

        Assert.Equal("1", (await Call("/SA/SubmitSiteTour", new { saId = Lead, zedId = Zed, certificationType = "Silver", siteTourPhotos = new[] { photo } }, token))
            .GetProperty("status").GetString());
        AssertFail(await Call("/SA/SubmitSiteTour", new { saId = Lead, zedId = "ZEDMSME000099", certificationType = "Silver", siteTourPhotos = new[] { photo } }, token),
            ConsultancySAController.NotAllocated + "ZEDMSME000099");
        AssertExpired(await Call("/SA/SubmitSiteTour", new { saId = Co, zedId = Zed, certificationType = "Silver", siteTourPhotos = new[] { photo } }, token));
        AssertExpired(await Call("/SA/SubmitSiteTour", new { saId = Lead, zedId = Zed, certificationType = "Silver", siteTourPhotos = new[] { photo } }, null));
    }

    // ---------------------------------------------------------------- Reads need the token

    [Theory]
    [InlineData("/SA/Assessments")]
    [InlineData("/SA/Assessment")]
    [InlineData("/SA/Notifications")]
    [InlineData("/SA/Reports")]
    public async Task The_reads_need_the_consultants_token_even_in_monitor_mode(string path)
    {
        var token = await TokenAsync();
        AssertExpired(await Call(path, new { saId = Lead, zedId = Zed }, null));
        AssertExpired(await Call(path, new { saId = Lead, zedId = Zed }, "h1.forged.token"));
        AssertExpired(await Call(path, new { saId = Co, zedId = Zed }, token));
        AssertExpired(await Call(path, new { zedId = Zed }, token));
        Assert.Equal("1", (await Call(path, new { saId = Lead, zedId = Zed }, token)).GetProperty("status").GetString());

        // A Users row that is no longer an active consultant signs the app out.
        _active = false;
        AssertExpired(await Call(path, new { saId = Lead, zedId = Zed }, token));
    }

    [Fact]
    public async Task Assessments_answers_the_list_and_counts_from_index_friendly_queries()
    {
        var e = await Call("/SA/Assessments", new { saId = Lead }, await TokenAsync());
        Assert.Equal(5, e.GetProperty("assessments").GetArrayLength());
        Assert.Equal(5, e.GetProperty("counts").GetProperty("total").GetInt32());
        var args = _t.CallsTo(ConsultancyAppData.CasesSql).Last().Args;
        Assert.Equal(Lead, FakeSql.Arg(args, "UserId"));
        Assert.True(DateTime.Parse(FakeSql.Arg(args, "Since")!, System.Globalization.CultureInfo.CurrentCulture) < DateTime.Now.AddMonths(-11));
        Assert.Contains("UNION SELECT M.Id FROM dbo.AllotedCoAssessors", ConsultancyAppData.CasesSql);
        Assert.Equal(Lead, FakeSql.Arg(_t.CallsTo(ConsultancyAppData.TeamSql).Last().Args, "UserId"));
    }

    // ---------------------------------------------------------------- SA/Assessment

    [Fact]
    public async Task Assessment_is_the_login_answer_for_the_unit_without_the_password()
    {
        var login = JsonNode.Parse((await _t.Json("/SA/Login", new { zedId = Zed, assessorId = Lead, password = Password, version = "1.0", deviceInfo = new { deviceId = "cc-phone" } })).GetRawText())!.AsObject();
        Assert.Equal("1", login["status"]!.GetValue<string>());
        login.Remove("appToken");

        var e = await Call("/SA/Assessment", new { saId = Lead, zedId = Zed, certificationType = "silver" }, await TokenAsync());
        Assert.False(e.TryGetProperty("appToken", out _));
        Assert.Equal(login.ToJsonString(), JsonNode.Parse(e.GetRawText())!.ToJsonString());
        var sub = _t.LastArgs("SP_APP_SA_CONSULTANCY_CHECK_LOGIN");
        Assert.Equal(PasswordStore.RefusedValue, FakeSql.Arg(sub, "Password"));
        Assert.Equal(Zed, FakeSql.Arg(sub, "ZedId"));
        // Opening the unit records the app sign-in as the login did.
        Assert.Equal(2, _t.Fake.Calls.Count(c => c.Name.Contains("INSERT INTO dbo.V4AppSessions", StringComparison.Ordinal)));
    }

    [Fact]
    public async Task Assessment_refuses_as_login_did()
    {
        var token = await TokenAsync();
        AssertFail(await Call("/SA/Assessment", new { saId = Lead, zedId = "ZEDMSME000099" }, token), ConsultancySAController.NotAllocated + "ZEDMSME000099");
        // A level that is not the unit's open one.
        AssertFail(await Call("/SA/Assessment", new { saId = Lead, zedId = Zed, certificationType = "Gold" }, token), ConsultancySAController.NotAllocated + Zed);
        // A co-consultant the procedure lets through but who is not allotted by exact id.
        _t.Sql.Allotments.Clear();
        _t.Sql.Allot(Zed, "Silver", "Lead", Lead);
        AssertFail(await Call("/SA/Assessment", new { saId = Co, zedId = Zed }, await TokenAsync(Co)), ConsultancySAController.NotAllocated + Zed);
        // Past the consultants' visit (status above 9).
        _open = 2;
        var e = await Call("/SA/Assessment", new { saId = Lead, zedId = Zed }, token);
        AssertFail(e, ConsultancySAController.LoginClosed + Zed);
        Assert.Equal(JsonValueKind.Null, e.GetProperty("companyProfile").ValueKind);
        // Of the lead's calls only the other-level one reached the unit procedure (not the unknown unit, not the closed one).
        Assert.Single(_t.CallsTo("SP_APP_SA_CONSULTANCY_CHECK_LOGIN"), c => FakeSql.Arg(c.Args, "UserId") == Lead);
    }

    [Fact]
    public async Task The_unit_answer_names_the_NIC_sector()
    {
        var profile = (await _t.Json("/SA/Login", new { zedId = Zed, assessorId = Lead, password = Password, version = "1.0" })).GetProperty("companyProfile");
        Assert.Equal("24", profile.GetProperty("sectorId").GetString());
        Assert.Equal("Manufacture of basic metals", profile.GetProperty("sectorName").GetString());

        // Not in the master: the code stays, as before.
        _t.Fake.Queries[SAController.SectorNameSql] = _ => [];
        profile = (await Call("/SA/Assessment", new { saId = Lead, zedId = Zed }, await TokenAsync())).GetProperty("companyProfile");
        Assert.Equal("24", profile.GetProperty("sectorName").GetString());
        Assert.Equal(JsonValueKind.Null, profile.GetProperty("sectorId").ValueKind);
    }

    // ---------------------------------------------------------------- SA/Notifications, SA/Reports

    [Fact]
    public async Task Notifications_are_made_from_the_history_and_the_cases()
    {
        var e = await Call("/SA/Notifications", new { saId = Lead }, await TokenAsync());
        var list = e.GetProperty("notifications").EnumerateArray().ToList();
        var types = list.Select(n => n.GetProperty("type").GetString()).ToList();
        Assert.Equal(["accepted", "allotted", "completed", "reminder", "sentBack"], types.Order(StringComparer.Ordinal));

        // Newest first: the reminder is made now.
        Assert.Equal("reminder", types[0]);
        Assert.Equal("Milestone visit tomorrow", list[0].GetProperty("title").GetString());
        Assert.Equal($"r-ZEDMSME000002-Gold-1-{_tomorrow:yyyyMMdd}", list[0].GetProperty("id").GetString());

        var allotted = list.Single(n => n.GetProperty("type").GetString() == "allotted");
        Assert.Equal("h101", allotted.GetProperty("id").GetString());
        Assert.StartsWith("Co-Consultant · Unit 2 (ZEDMSME000002) · ZED Gold · Milestone 1.", allotted.GetProperty("text").GetString());
        Assert.Equal("Milestone 1 completed", list.Single(n => n.GetProperty("type").GetString() == "completed").GetProperty("title").GetString());
        Assert.Contains("CO send back to Consultant On November 1, 2026", list.Single(n => n.GetProperty("type").GetString() == "sentBack").GetProperty("text").GetString());
        Assert.Equal("a-ZEDMSME000005-Silver-3", list.Single(n => n.GetProperty("type").GetString() == "accepted").GetProperty("id").GetString());
        Assert.Equal(Lead, FakeSql.Arg(_t.CallsTo(ConsultancyAppData.HistorySql).Last().Args, "UserId"));
    }

    [Fact]
    public async Task Reports_list_the_milestones_and_where_the_pdf_is()
    {
        var reports = (await Call("/SA/Reports", new { saId = Lead }, await TokenAsync())).GetProperty("reports");
        Assert.Equal(4, reports.GetArrayLength());

        Assert.True(reports[0].GetProperty("reportAvailable").GetBoolean());
        Assert.Equal("SA/AppReport?zedId=ZEDMSME000005&certificationType=Silver&milestone=3", reports[0].GetProperty("reportPath").GetString());
        Assert.Equal(3, reports[0].GetProperty("milestone").GetInt32());
        Assert.Equal("Progress Review 2", reports[0].GetProperty("milestoneLabel").GetString());
        Assert.Equal("SA/AppReport?zedId=ZEDMSME000001&certificationType=Silver&milestone=1", reports[1].GetProperty("reportPath").GetString());
        // The co-consultants of milestone 2 were not on milestone 1.
        Assert.Equal([Lead], reports[1].GetProperty("team").EnumerateArray().Select(m => m.GetProperty("assessorId").GetString()));

        // Closing meeting done, not completed: no report; a Bronze milestone has none either.
        Assert.False(reports[2].GetProperty("reportAvailable").GetBoolean());
        Assert.Equal(JsonValueKind.Null, reports[2].GetProperty("reportPath").ValueKind);
        Assert.False(reports[3].GetProperty("reportAvailable").GetBoolean());
    }

    // ---------------------------------------------------------------- Site tour sections

    private static object TourPhoto(string photoId, string? section, string? comment) => new
    {
        photoId, photo = AssessorTestHost.JpegBase64, comment, section, timeStamp = "t", latitude = "1", longitude = "2",
    };

    private void OpenSiteTour() => _t.Fake.Procs["SP_SA_APP_CHECK_STATUS"] = _ => FakeSql.Sets([new Dictionary<string, object?>(_flags)]);

    [Fact]
    public async Task Milestone_1_answers_the_units_sections_with_the_photos_uploaded()
    {
        var sections = new[]
        {
            new SiteTourSection("gate", "Gate", "Name board", 1, 2, [], []),
            new SiteTourSection("gold", "Gold only", null, 1, 2, ["Gold"], []),
            new SiteTourSection("forge", "Forge shop", "Furnaces", 2, 4, [], ["24"]),
            new SiteTourSection("off", "Old section", null, 1, 1, [], [], Active: false),
        };
        _t.Fake.Queries["SELECT SettingKey, SettingValue FROM dbo.V4Settings"] = _ => [new { SettingKey = SiteTourSections.Key, SettingValue = JsonSerializer.Serialize(sections, new JsonSerializerOptions(JsonSerializerDefaults.Web)) }];
        _t.Fake.Queries[global::Zed.Core.Forms.AppFormUnit.SectorSql] = _ => ["24 - Manufacture of basic metals"];
        _t.Fake.Queries[ConsultancySAController.SiteTourPhotosSql] = _ => [new { PhotoId = "a", Name = "2. Forge shop - furnace" }, new { PhotoId = "b", Name = "1. Gate" }];

        var d = await Call("/SA/Assessment", new { saId = Lead, zedId = Zed, certificationType = "Silver" }, await TokenAsync());
        var list = d.GetProperty("siteTourSections");
        Assert.Equal(2, list.GetArrayLength());
        Assert.Equal("gate", list[0].GetProperty("id").GetString());
        Assert.Equal(1, list[0].GetProperty("uploaded").GetInt32());
        Assert.Equal("Forge shop", list[1].GetProperty("title").GetString());
        Assert.Equal(2, list[1].GetProperty("no").GetInt32());
        Assert.Equal(4, list[1].GetProperty("max").GetInt32());
        Assert.Equal(1, list[1].GetProperty("uploaded").GetInt32());
        var photoArgs = _t.CallsTo(ConsultancySAController.SiteTourPhotosSql).Last().Args;
        Assert.Equal(Zed, FakeSql.Arg(photoArgs, "ZedId"));
        Assert.Equal("Silver", FakeSql.Arg(photoArgs, "Certification"));

        // Milestones 2 and 3 have no site tour.
        _milestone = 2;
        Assert.Equal(0, (await Call("/SA/Assessment", new { saId = Lead, zedId = Zed }, await TokenAsync())).GetProperty("siteTourSections").GetArrayLength());
    }

    [Fact]
    public async Task Site_tour_photos_carry_their_section_in_the_stored_name()
    {
        OpenSiteTour();
        var e = await _t.Json("/SA/SubmitSiteTour", new
        {
            saId = Co, zedId = Zed, certificationType = "Silver",
            siteTourPhotos = new[]
            {
                TourPhoto("t1", "3", "CNC line"), TourPhoto("t2", "safety & fire", null), TourPhoto("t3", null, "old app"),
                TourPhoto("t4", "10", new string('x', 300)),
            },
        });
        Assert.Equal("1", e.GetProperty("status").GetString());
        var args = _t.LastArgs("SP_APP_SA_SAVE_PHOTOS");
        Assert.Equal("SiteTour", FakeSql.Arg(args, "PhotoType"));
        var rows = AssessorTestHost.Tvp(args, "PhotoList")!;
        Assert.Equal("3. Production / Machine Shop - CNC line", rows.Rows[0]["Name"]);
        Assert.Equal("9. Safety & Fire", rows.Rows[1]["Name"]);
        Assert.Equal("old app", rows.Rows[2]["Name"]);
        var cut = (string)rows.Rows[3]["Name"];
        Assert.Equal(SiteTourSections.MaxName, cut.Length);
        Assert.StartsWith("10. Environment & Housekeeping - xxx", cut);
        Assert.True(File.Exists(_t.FileUnderRoot("SaPhotos", Zed, "Silver", "SiteTour", "t1.jpg")));
    }

    [Fact]
    public async Task An_unknown_section_or_one_over_its_maximum_is_refused_before_anything_is_stored()
    {
        OpenSiteTour();
        foreach (var section in new[] { "11", "0", "Canteen" })
            AssertFail(await _t.Json("/SA/SubmitSiteTour", new
            {
                saId = Lead, zedId = Zed, certificationType = "Silver", siteTourPhotos = new[] { TourPhoto("t1", "1", "ok"), TourPhoto("t2", section, "x") },
            }), SAController.UnknownSiteTourSection);
        Assert.Empty(_t.CallsTo("SP_APP_SA_SAVE_PHOTOS"));
        Assert.Empty(_t.AllFiles());

        // Unit Entrance & Signage takes 2: one stored by the co-consultant, one resent (counted once), one new is too many.
        _t.Fake.Queries[ConsultancySAController.SiteTourPhotosSql] = _ => [new { PhotoId = "co1", Name = "1. Unit Entrance & Signage - gate" }, new { PhotoId = "t1", Name = "1. Unit Entrance & Signage - board" }];
        Assert.Equal("1", (await _t.Json("/SA/SubmitSiteTour", new { saId = Lead, zedId = Zed, certificationType = "Silver", siteTourPhotos = new[] { TourPhoto("t1", "entrance", "board") } }))
            .GetProperty("status").GetString());
        AssertFail(await _t.Json("/SA/SubmitSiteTour", new
        {
            saId = Lead, zedId = Zed, certificationType = "Silver", siteTourPhotos = new[] { TourPhoto("t1", "entrance", "board"), TourPhoto("t2", "1", "name board") },
        }), "Site Tour: \"Unit Entrance & Signage\" takes at most 2 photos. Please remove the extra photos.");
        Assert.Single(_t.CallsTo("SP_APP_SA_SAVE_PHOTOS"));
    }

    [Fact]
    public async Task The_milestone_1_closing_meeting_waits_for_every_sections_minimum()
    {
        OpenSiteTour();
        var close = new { saId = Lead, zedId = Zed, certificationType = "Silver", userType = 1, endComment = "done" };
        _t.Fake.Queries[ConsultancySAController.SiteTourPhotosSql] = _ => [new { PhotoId = "a", Name = "1. Unit Entrance & Signage" }];
        AssertFail(await _t.Json("/SA/SubmitEndAssessment", close),
            "Site Tour: \"Raw Material Inward & Store\" needs at least 2 photos (0 uploaded). Please capture and sync them before the closing meeting.");
        Assert.Empty(_t.CallsTo("SP_SA_APP_INSERT_OPEN_MEETING"));

        // The co-consultant's final submit does not check it.
        _flags["FinalSubmissionDone"] = false;
        Assert.Equal("1", (await _t.Json("/SA/SubmitEndAssessment", new { saId = Co, zedId = Zed, certificationType = "Silver", userType = 2 })).GetProperty("status").GetString());
        _flags["FinalSubmissionDone"] = true;

        // Every minimum met.
        _t.Fake.Queries[ConsultancySAController.SiteTourPhotosSql] = _ => SiteTourSections.Defaults
            .SelectMany((s, i) => Enumerable.Range(0, s.Min).Select(n => (object?)new { PhotoId = $"{s.Id}{n}", Name = $"{i + 1}. {s.Title}" })).ToList();
        Assert.Equal("1", (await _t.Json("/SA/SubmitEndAssessment", close)).GetProperty("status").GetString());

        // Milestones 2 and 3 have no site tour.
        _t.Fake.Queries[ConsultancySAController.SiteTourPhotosSql] = _ => [];
        _milestone = 2;
        Assert.Equal("1", (await _t.Json("/SA/SubmitEndAssessment", close)).GetProperty("status").GetString());
        Assert.Equal(Zed, FakeSql.Arg(_t.CallsTo(ConsultancySAController.CurrentMilestoneSql).Last().Args, "ZedId"));
    }
}
