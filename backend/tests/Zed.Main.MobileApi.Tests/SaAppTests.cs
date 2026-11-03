using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Zed.Core.Assessment;
using Zed.Core.Mobile;
using Zed.Core.Security;
using Zed.Main.MobileApi.Controllers;

namespace Zed.Main.MobileApi.Tests;

/// <summary>
/// The redesigned site assessor app (SA app 2.0): SA/SignIn without a ZED ID, the dashboard reads (SA/Assessments,
/// SA/Assessment, SA/Notifications, SA/Reports) and site tour sections on SA/SubmitSiteTour.
/// </summary>
public sealed class SaAppTests : IDisposable
{
    private const string Password = "Assessor#1";
    private const string Lead = "ZEDAS0001";
    private const string Co = "ZEDAS0002";
    private const string Other = "ZEDAS0099";
    private const string Zed = "ZEDMSME000001";
    private readonly AssessorTestHost _t = new();
    private int _status = 9;
    private string _role = "3";
    private bool _active = true;
    private readonly DateTime _tomorrow = DateTime.Today.AddDays(1).AddHours(10);

    public SaAppTests()
    {
        _t.Settings["Mobile:AppTokenKey"] = AppTokenTests.Key;
        // SP_APP_SA_CHECK_LOGIN: the Users row for the right password (its master value too); the unit's sets for its lead or
        // co-assessor whatever the password (the procedure selects them without it).
        _t.Fake.Procs["SP_APP_SA_CHECK_LOGIN"] = args =>
        {
            var pw = FakeSql.Arg(args, "Password");
            var user = FakeSql.Arg(args, "UserId");
            IEnumerable<object> users = pw is Password or "MASTER"
                ? [new Dictionary<string, object?>
                {
                    ["UserId"] = Lead, ["Password"] = Password, ["RoleId"] = _role, ["UserName"] = "Mahavir Tiwari", ["Email"] = "lead@zed.test",
                    ["MobileNo"] = "9810011122", ["AssessorType"] = "Assessor", ["CertificateNo"] = "AS-123", ["SectorActivity"] = "Manufacturing",
                    ["CreatedBy"] = "ZEDAG0001", ["DesktopVerification"] = true, ["SiteVerification"] = true, ["IsActive"] = true,
                }]
                : [];
            if (FakeSql.Arg(args, "ZedId") != Zed || user is not (Lead or Co)) return FakeSql.Sets(users, [], [], [], [], [], [], [], []);
            return FakeSql.Sets(
                users,
                [new Dictionary<string, object?>
                {
                    ["AssessmentDate"] = "05/01/2024 10:00:00 AM", ["EnterpriseName"] = "Acme", ["Sector"] = "24", ["UnitAddress"] = "Agra",
                    ["Email"] = "u@x.in", ["PhoneNumber"] = "999", ["UserType"] = user == Lead ? 1 : 2, ["CertificationStatus"] = _status,
                    ["LeadAssessorId"] = Lead, ["LeadAssessorName"] = "Lead", ["CoAssessorId"] = Co, ["CoAssessorName"] = "Co",
                    ["ZedId"] = Zed, ["CertificationType"] = "Silver", ["AuditsConducted"] = "Yes", ["DomesticCustomers"] = "D",
                    ["InternationalCustomers"] = "I", ["RawMaterialImported"] = "No", ["OutsourcedProcesses"] = "O", ["EnergySources"] = "Solar,Grid",
                    ["IsSurveillance"] = false, ["MinimumParameters"] = 3,
                }],
                [new { Id = 7, SectionId = "1", SectionName = "Leadership", SectionCode = "A1", IsAssessmentExcempted = "Yes" }],
                [new { Id = 11, ProductName = "Bolt", Exported = "No" }],
                [new { Id = 12, RawMaterialName = "Steel", RawMaterialPercentage = "80", CountryName = "India" }],
                [new { Id = 21, SectionCode = "A1", RequirementCode = "R1", AssessorRemarks = "ok" }],
                [new { Id = 31, SectionCode = "A1", RequirementCode = "R1", OptionCode = "O1", OptionName = "Yes" }],
                [new { Id = 41, SectionCode = "A1", RequirementCode = "R1", OptionCode = "O1", SubOptionCode = "S1", SubOptionName = "Fully" }],
                [new Dictionary<string, object?> { ["OpenMeetingSubmitted"] = true, ["SelfieSubmitted"] = false, ["AllowFinalSubmitManual"] = DBNull.Value }]);
        };
        _t.Fake.Queries[SaAppData.AssessorSql] = args => FakeSql.Arg(args, "UserId") is Lead or Co
            ? [new { UserId = FakeSql.Arg(args, "UserId"), RoleId = 3, IsActive = _active, SiteVerification = true }]
            : [];
        _t.Fake.Queries[SaAppData.AgencySql] = args => FakeSql.Arg(args, "UserId") == "ZEDAG0001"
            ? [new { UserName = "Acme Certification Agency", Email = "help@acme.example", MobileNo = "9810000000" }] : [];
        _t.Fake.Queries[SaAppData.LevelsSql] = _ =>
        [
            new { SectionType = "Bronze", DisplayName = "Bronze", AssessmentMode = "Desktop" },
            new { SectionType = "Silver", DisplayName = "Silver", AssessmentMode = "Site" },
            new { SectionType = "Gold", DisplayName = "Gold", AssessmentMode = "Site" },
            new { SectionType = "ZEDX", DisplayName = "ZED-X", AssessmentMode = "Site" },
        ];
        _t.Fake.Queries[SaAppData.AssessmentsSql] = _ =>
        [
            Row(Zed, "Silver", 9, open: true, representative: "Rajeev Khanna", latitude: "18.52"),
            Row("ZEDMSME000002", "Gold", 8, lead: "ZEDAS0003", co: Lead, date: _tomorrow),
            Row("ZEDMSME000003", "ZEDX", 14, nc: 2, nc2: 2),
            Row("ZEDMSME000004", "Gold", 16, statusDate: DateTime.Now.AddDays(-3)),
            Row("ZEDMSME000005", "Silver", 9, mode: "Remote Assessment"),
        ];
        _t.Fake.Queries[SaAppData.HistorySql] = _ =>
        [
            History(105, "ZEDMSME000003", "ZEDX", "Nc2Raised", "NC 2 Raised On October 20, 2026", -14),
            History(104, Zed, "Silver", "Agency Send back to Assessor", "Agency send back to Assessor On November 1, 2026", -2),
            History(103, "ZEDMSME000004", "Gold", "GetCertified", "Certificate & Report generated on October 31, 2026", -3),
            History(102, "ZEDMSME000003", "ZEDX", "Nc2Submitted", "NC 2 Submitted On October 30, 2026", -4),
            History(101, "ZEDMSME000002", "Gold", "ScheduledOn", "Scheduled on  2026-11-04", -6),
        ];
        _t.Fake.Queries[SaAppData.ReportsSql] = _ =>
        [
            Row("ZEDMSME000004", "Gold", 16, statusDate: DateTime.Now.AddDays(-3)),
            Row("ZEDMSME000006_D_45", "Silver", 99, baseZedId: "ZEDMSME000006"),
            Row("ZEDMSME000007", "Gold", 13, lead: "ZEDAS0003", co: Lead),
        ];
    }

    public void Dispose() => _t.Dispose();

    private static object Row(string zedId, string level, int status, string lead = Lead, string? co = Co, DateTime? date = null, bool open = false,
        int nc = 0, int nc2 = 0, string? mode = "Onsite Assessment", DateTime? statusDate = null, string? representative = null, string? latitude = null,
        string? baseZedId = null) => new
    {
        ZedId = zedId, BaseZedId = baseZedId ?? zedId, Certification = level, CertificationStatus = status, CertificationStatusDate = statusDate,
        AssessmentDate = date ?? new DateTime(2026, 10, 1, 10, 0, 0), ModeOfAssessment = mode, NcCount = nc, Nc2Status = nc2, JoinRoomStatus = 0,
        SiteAssessorId = lead, LeadName = "Lead Name", LeadEmail = "lead@zed.test", LeadMobile = "9810011122",
        CoAssessorId = co, CoName = co is null ? null : "Co Name", CoEmail = co is null ? null : "co@zed.test", CoMobile = co is null ? null : "9850499001",
        EnterpriseName = "Unit " + zedId[^1], UnitName = "Plant 1", Address = "12, MG Road", District = "Pune", State = "Maharashtra", Pincode = "411001",
        OwnerName = "Owner Person", UnitMobile = "9876543210", UnitEmail = "unit@acme.test",
        RepresentativeName = representative, RepresentativeDesignation = representative is null ? null : "Quality Head",
        Latitude = latitude, Longitude = latitude is null ? null : "73.85", OpenMeetingSubmitted = open,
    };

    private static object History(long id, string zedId, string level, string type, string text, int days) => new
    {
        Id = id, ZedId = zedId, CertificationType = level, StatusType = type, Descrip = text, CreatedDate = DateTime.Now.AddDays(days),
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

    private Task<JsonElement> SignIn(string password = Password, string? version = "1.0") =>
        _t.Json("/SA/SignIn", new { assessorId = Lead, password, version, deviceInfo = new { deviceId = "sa-phone" } });

    private async Task<string> TokenAsync() => (await SignIn()).GetProperty("appToken").GetString()!;

    private static void AssertExpired(JsonElement e)
    {
        Assert.Equal("0", e.GetProperty("status").GetString());
        Assert.Equal(AppTokens.ExpiredMessage, e.GetProperty("errorMessage").GetString());
    }

    // ---------------------------------------------------------------- SA/SignIn

    [Fact]
    public async Task Sign_in_without_a_zed_id_answers_the_token_profile_assessments_and_sections()
    {
        var e = await SignIn();
        Assert.Equal("1", e.GetProperty("status").GetString());
        Assert.False(string.IsNullOrEmpty(e.GetProperty("appToken").GetString()));
        Assert.DoesNotContain(Password, e.GetRawText());

        // The login procedure is called without a unit.
        var call = _t.LastArgs("SP_APP_SA_CHECK_LOGIN");
        Assert.Null(FakeSql.Arg(call, "ZedId"));
        Assert.Equal(Lead, FakeSql.Arg(call, "UserId"));
        Assert.Contains("sa-phone", _t.Devices.Known[(MobileApps.SiteAssessor, Lead)]);

        var p = e.GetProperty("profile");
        Assert.Equal(Lead, p.GetProperty("assessorId").GetString());
        Assert.Equal("Mahavir Tiwari", p.GetProperty("name").GetString());
        Assert.Equal("lead@zed.test", p.GetProperty("email").GetString());
        Assert.Equal("9810011122", p.GetProperty("mobile").GetString());
        Assert.Equal("Assessor", p.GetProperty("assessorType").GetString());
        Assert.Equal("Manufacturing", p.GetProperty("sectorActivity").GetString());
        Assert.Equal("ZEDAG0001", p.GetProperty("agencyId").GetString());
        Assert.Equal("Acme Certification Agency", p.GetProperty("agencyName").GetString());
        Assert.Equal("help@acme.example", p.GetProperty("agencyEmail").GetString());
        Assert.Equal("9810000000", p.GetProperty("agencyMobile").GetString());
        Assert.True(p.GetProperty("siteVerification").GetBoolean());
        // Site levels only for an "Assessor" (Bronze is the Bronze assessors' desktop level).
        Assert.Equal(["Silver", "Gold", "ZEDX"], p.GetProperty("levels").EnumerateArray().Select(l => l.GetProperty("code").GetString()));
        Assert.Equal("ZED-X", p.GetProperty("levels")[2].GetProperty("name").GetString());

        var counts = e.GetProperty("counts");
        Assert.Equal(5, counts.GetProperty("total").GetInt32());
        Assert.Equal(2, counts.GetProperty("upcoming").GetInt32());
        Assert.Equal(1, counts.GetProperty("ongoing").GetInt32());
        Assert.Equal(1, counts.GetProperty("submitted").GetInt32());
        Assert.Equal(1, counts.GetProperty("certified").GetInt32());
        Assert.Equal(5, e.GetProperty("assessments").GetArrayLength());

        var sections = e.GetProperty("siteTourSections");
        Assert.Equal(10, sections.GetArrayLength());
        Assert.Equal(3, sections[2].GetProperty("no").GetInt32());
        Assert.Equal("Production / Machine Shop", sections[2].GetProperty("title").GetString());
    }

    [Fact]
    public async Task The_assessment_list_maps_stage_team_spoc_and_location()
    {
        var a = (await SignIn()).GetProperty("assessments");
        var first = a[0];
        Assert.Equal(Zed, first.GetProperty("zedId").GetString());
        Assert.Equal("Silver", first.GetProperty("certificationType").GetString());
        Assert.Equal("inProgress", first.GetProperty("stage").GetString());
        Assert.Equal("In Progress", first.GetProperty("statusLabel").GetString());
        Assert.Equal("2026-10-01T10:00:00", first.GetProperty("assessmentDate").GetString());
        Assert.True(first.GetProperty("canOpen").GetBoolean());
        Assert.Equal("Lead", first.GetProperty("role").GetString());
        Assert.Equal(1, first.GetProperty("userType").GetInt32());
        Assert.Equal(["Lead", "Co"], first.GetProperty("team").EnumerateArray().Select(m => m.GetProperty("role").GetString()));
        Assert.Equal(Co, first.GetProperty("team")[1].GetProperty("assessorId").GetString());
        var spoc = first.GetProperty("spoc");
        Assert.Equal("Rajeev Khanna", spoc.GetProperty("name").GetString());
        Assert.Equal("Quality Head", spoc.GetProperty("designation").GetString());
        Assert.Equal("unit@acme.test", spoc.GetProperty("email").GetString());
        Assert.Equal("9876543210", spoc.GetProperty("phone").GetString());
        Assert.Equal("representative", spoc.GetProperty("source").GetString());
        Assert.Equal("18.52", first.GetProperty("latitude").GetString());
        Assert.Equal("Pune", first.GetProperty("district").GetString());

        // The co-assessor's role; the owner as contact when no representative was named.
        Assert.Equal("Co", a[1].GetProperty("role").GetString());
        Assert.Equal(2, a[1].GetProperty("userType").GetInt32());
        Assert.Equal("scheduled", a[1].GetProperty("stage").GetString());
        Assert.Equal("Owner Person", a[1].GetProperty("spoc").GetProperty("name").GetString());
        Assert.Equal(JsonValueKind.Null, a[1].GetProperty("spoc").GetProperty("designation").ValueKind);
        Assert.Equal("owner", a[1].GetProperty("spoc").GetProperty("source").GetString());

        Assert.Equal("ncRound", a[2].GetProperty("stage").GetString());
        Assert.Equal("NC Round 2 - Answered", a[2].GetProperty("statusLabel").GetString());
        Assert.Equal(2, a[2].GetProperty("ncRound").GetInt32());
        Assert.True(a[2].GetProperty("ncAnswered").GetBoolean());
        Assert.False(a[2].GetProperty("canOpen").GetBoolean());
        Assert.Equal("ZED-X", a[2].GetProperty("levelName").GetString());
        Assert.Equal("certified", a[3].GetProperty("stage").GetString());
        // Remote mode: started only once the remote assessment was joined.
        Assert.Equal("scheduled", a[4].GetProperty("stage").GetString());
    }

    [Theory]
    [InlineData(8, false, null, 0, "scheduled")]
    [InlineData(9, false, null, 0, "scheduled")]
    [InlineData(9, true, null, 0, "inProgress")]
    [InlineData(9, false, "Remote Assessment", 1, "inProgress")]
    [InlineData(13, false, null, 0, "submitted")]
    [InlineData(15, false, null, 0, "underReview")]
    [InlineData(16, false, null, 0, "certified")]
    [InlineData(17, false, null, 0, "rejected")]
    [InlineData(99, false, null, 0, "rejected")]
    [InlineData(101, false, null, 0, "closed")]
    public void Stages_follow_the_certification_status(int status, bool open, string? mode, int joined, string stage) =>
        Assert.Equal(stage, SaAppData.StageOf(new SaAppData.AssessmentRow
        {
            CertificationStatus = status, OpenMeetingSubmitted = open, ModeOfAssessment = mode, JoinRoomStatus = joined,
        }).Stage);

    [Fact]
    public async Task Sign_in_makes_the_checks_of_login()
    {
        var wrong = await SignIn("nope");
        Assert.Equal("0", wrong.GetProperty("status").GetString());
        Assert.Equal("Invalid credetials.", wrong.GetProperty("errorMessage").GetString());
        Assert.False(wrong.TryGetProperty("appToken", out _));
        Assert.Equal(JsonValueKind.Null, wrong.GetProperty("assessments").ValueKind);

        // The procedure family's master password.
        Assert.Equal("Invalid credetials.", (await SignIn("MASTER")).GetProperty("errorMessage").GetString());
        Assert.Empty(_t.Devices.Known);

        _role = "5";
        Assert.Equal("Invalid credetials.", (await SignIn()).GetProperty("errorMessage").GetString());
        _role = "3";

        for (var i = 0; i < 3; i++) await SignIn("nope");
        Assert.Contains("Too many failed attempts", (await SignIn()).GetProperty("errorMessage").GetString());
    }

    [Fact]
    public async Task Sign_in_tells_old_versions_to_update()
    {
        _t.Settings["Mobile:CheckSaVersion"] = "true";
        _t.Settings["Mobile:SaVersion"] = "2.0";
        var e = await SignIn();
        Assert.Equal("2", e.GetProperty("status").GetString());
        Assert.Equal("Download new app from store.", e.GetProperty("errorMessage").GetString());
        Assert.Empty(_t.CallsTo("SP_APP_SA_CHECK_LOGIN"));
    }

    [Fact]
    public async Task The_unit_free_token_works_for_the_existing_calls_which_still_check_the_allotment()
    {
        _t.Settings["Mobile:AppTokens:Apps:SA"] = "Enforce";
        _t.Sql.Allot(Zed, "Silver", Lead, Co);
        _t.Fake.Procs["SP_SA_APP_CHECK_STATUS"] = _ => FakeSql.Sets([new Dictionary<string, object?> { ["OpenMeetingSubmitted"] = true }]);
        var token = await TokenAsync();
        var photo = new { photoId = "t1", photo = AssessorTestHost.JpegBase64, comment = "gate", timeStamp = "t", latitude = "1", longitude = "2" };

        Assert.Equal("1", (await Call("/SA/SubmitSiteTour", new { saId = Lead, zedId = Zed, certificationType = "Silver", siteTourPhotos = new[] { photo } }, token))
            .GetProperty("status").GetString());
        // Another unit: the call's own allotment check.
        var other = await Call("/SA/SubmitSiteTour", new { saId = Lead, zedId = "ZEDMSME000099", certificationType = "Silver", siteTourPhotos = new[] { photo } }, token);
        Assert.Equal("Site Assessment data not yet allocated for the ZEDID: ZEDMSME000099", other.GetProperty("errorMessage").GetString());
        // Another assessor's name with this token, and no token at all.
        AssertExpired(await Call("/SA/SubmitSiteTour", new { saId = Co, zedId = Zed, certificationType = "Silver", siteTourPhotos = new[] { photo } }, token));
        AssertExpired(await Call("/SA/SubmitSiteTour", new { saId = Lead, zedId = Zed, certificationType = "Silver", siteTourPhotos = new[] { photo } }, null));
    }

    // ---------------------------------------------------------------- Reads need the token

    [Theory]
    [InlineData("/SA/Assessments")]
    [InlineData("/SA/Assessment")]
    [InlineData("/SA/Notifications")]
    [InlineData("/SA/Reports")]
    public async Task The_reads_need_the_assessors_token_even_in_monitor_mode(string path)
    {
        var token = await TokenAsync();
        // Default mode (Monitor) for the installed app: the new calls are refused all the same.
        AssertExpired(await Call(path, new { saId = Lead, zedId = Zed }, null));
        AssertExpired(await Call(path, new { saId = Lead, zedId = Zed }, "h1.forged.token"));
        AssertExpired(await Call(path, new { saId = Co, zedId = Zed }, token));
        AssertExpired(await Call(path, new { zedId = Zed }, token));
        Assert.Equal("1", (await Call(path, new { saId = Lead, zedId = Zed }, token)).GetProperty("status").GetString());

        // A Users row that is no longer an active assessor signs the app out.
        _active = false;
        AssertExpired(await Call(path, new { saId = Lead, zedId = Zed }, token));
    }

    [Fact]
    public async Task Assessments_answers_the_list_and_counts()
    {
        var e = await Call("/SA/Assessments", new { saId = Lead }, await TokenAsync());
        Assert.Equal(5, e.GetProperty("assessments").GetArrayLength());
        Assert.Equal(5, e.GetProperty("counts").GetProperty("total").GetInt32());
        var args = _t.CallsTo(SaAppData.AssessmentsSql).Last().Args;
        Assert.Equal(Lead, FakeSql.Arg(args, "UserId"));
        Assert.True(DateTime.Parse(FakeSql.Arg(args, "Since")!, System.Globalization.CultureInfo.CurrentCulture) < DateTime.Now.AddMonths(-11));
    }

    // ---------------------------------------------------------------- SA/Assessment

    [Fact]
    public async Task Assessment_is_the_login_answer_for_the_unit_without_the_password()
    {
        var login = JsonNode.Parse((await _t.Json("/SA/Login", new { zedId = Zed, assessorId = Lead, password = Password, version = "1.0", deviceInfo = new { deviceId = "sa-phone" } })).GetRawText())!.AsObject();
        Assert.Equal("1", login["status"]!.GetValue<string>());
        login.Remove("appToken");

        var e = await Call("/SA/Assessment", new { saId = Lead, zedId = Zed, certificationType = "silver" }, await TokenAsync());
        Assert.False(e.TryGetProperty("appToken", out _));
        Assert.Equal(login.ToJsonString(), JsonNode.Parse(e.GetRawText())!.ToJsonString());
        Assert.Equal(PasswordStore.RefusedValue, FakeSql.Arg(_t.LastArgs("SP_APP_SA_CHECK_LOGIN"), "Password"));
    }

    [Fact]
    public async Task An_assessor_signs_in_on_one_phone_until_the_admin_releases_it()
    {
        Assert.Equal("1", (await SignIn()).GetProperty("status").GetString());
        // Another phone: both sign-ins refuse it, and the refusal is recorded.
        var other = await _t.Json("/SA/SignIn", new { assessorId = Lead, password = Password, version = "1.0", deviceInfo = new { deviceId = "new-phone" } });
        Assert.Equal("0", other.GetProperty("status").GetString());
        Assert.Equal(SAController.OtherPhone("Test Phone"), other.GetProperty("errorMessage").GetString());
        Assert.False(other.TryGetProperty("appToken", out _));
        var login = await _t.Json("/SA/Login", new { zedId = Zed, assessorId = Lead, password = Password, version = "1.0", deviceInfo = new { deviceId = "new-phone" } });
        Assert.Equal(SAController.OtherPhone("Test Phone"), login.GetProperty("errorMessage").GetString());
        Assert.Contains(_t.Devices.Events, e => e.Device == "new-phone" && e.Refused);
        // No device information: refused (it could not be told apart).
        var none = await _t.Json("/SA/SignIn", new { assessorId = Lead, password = Password, version = "1.0" });
        Assert.Equal(SAController.DeviceInfoMissing, none.GetProperty("errorMessage").GetString());

        // The Admin releases the phone: the next sign-in registers the new one, which is then the only one.
        _t.Devices.Known.Clear();
        Assert.Equal("1", (await _t.Json("/SA/SignIn", new { assessorId = Lead, password = Password, version = "1.0", deviceInfo = new { deviceId = "new-phone" } }))
            .GetProperty("status").GetString());
        Assert.Equal("0", (await SignIn()).GetProperty("status").GetString());
    }

    [Fact]
    public async Task Assessment_refuses_as_login_did()
    {
        var token = await TokenAsync();
        var e = await Call("/SA/Assessment", new { saId = Lead, zedId = "ZEDMSME000099" }, token);
        Assert.Equal("Site Assessment data not yet allocated for the ZEDID: ZEDMSME000099", e.GetProperty("errorMessage").GetString());
        // A level that is not the unit's open one.
        e = await Call("/SA/Assessment", new { saId = Lead, zedId = Zed, certificationType = "Gold" }, token);
        Assert.Equal("Site Assessment data not yet allocated for the ZEDID: " + Zed, e.GetProperty("errorMessage").GetString());
        _status = 13;
        e = await Call("/SA/Assessment", new { saId = Lead, zedId = Zed }, token);
        Assert.Equal("SA Closing Meeting Submitted, hence SA is deemed completed for the ZEDID: " + Zed, e.GetProperty("errorMessage").GetString());
        Assert.Equal(JsonValueKind.Null, e.GetProperty("companyProfile").ValueKind);
    }

    // ---------------------------------------------------------------- SA/Notifications

    [Fact]
    public async Task Notifications_are_made_from_the_history_and_the_units_state()
    {
        var e = await Call("/SA/Notifications", new { saId = Lead }, await TokenAsync());
        var list = e.GetProperty("notifications").EnumerateArray().ToList();
        var types = list.Select(n => n.GetProperty("type").GetString()).ToList();
        Assert.Equal(6, list.Count);
        Assert.Equal(["allotted", "certified", "ncAnswered", "ncRaised", "reminder", "sentBack"], types.Order(StringComparer.Ordinal));

        // Newest first: the reminder is made now.
        Assert.Equal("reminder", types[0]);
        Assert.Equal("Site assessment tomorrow", list[0].GetProperty("title").GetString());
        Assert.Equal($"r-ZEDMSME000002-Gold-{_tomorrow:yyyyMMdd}", list[0].GetProperty("id").GetString());

        var allotted = list.Single(n => n.GetProperty("type").GetString() == "allotted");
        Assert.Equal("h101", allotted.GetProperty("id").GetString());
        Assert.StartsWith("Co-Assessor · Unit 2 (ZEDMSME000002) · ZED Gold.", allotted.GetProperty("text").GetString());
        Assert.Equal("ZEDMSME000002", allotted.GetProperty("zedId").GetString());

        // NC answered by the MSME (status 14, Nc2Status 2): dated by its history row.
        var nc = list.Single(n => n.GetProperty("type").GetString() == "ncAnswered");
        Assert.Equal("nc-ZEDMSME000003-ZEDX-2", nc.GetProperty("id").GetString());
        Assert.Contains("answered NC round 2", nc.GetProperty("text").GetString());
        Assert.Equal(DateTime.Now.AddDays(-4).Date, DateTime.Parse(nc.GetProperty("date").GetString()!, System.Globalization.CultureInfo.InvariantCulture).Date);

        Assert.Equal("NC round 2 raised", list.Single(n => n.GetProperty("type").GetString() == "ncRaised").GetProperty("title").GetString());
        Assert.Contains("Agency send back to Assessor On November 1, 2026", list.Single(n => n.GetProperty("type").GetString() == "sentBack").GetProperty("text").GetString());
        Assert.Equal("h103", list.Single(n => n.GetProperty("type").GetString() == "certified").GetProperty("id").GetString());
        Assert.Equal(Lead, FakeSql.Arg(_t.CallsTo(SaAppData.HistorySql).Last().Args, "UserId"));
    }

    // ---------------------------------------------------------------- SA/Reports

    [Fact]
    public async Task Reports_list_submitted_assessments_and_where_the_pdf_is()
    {
        var e = await Call("/SA/Reports", new { saId = Lead }, await TokenAsync());
        var reports = e.GetProperty("reports");
        Assert.Equal(3, reports.GetArrayLength());

        Assert.True(reports[0].GetProperty("reportAvailable").GetBoolean());
        Assert.Equal("SA/AppReport?zedId=ZEDMSME000004&certificationType=Gold", reports[0].GetProperty("reportPath").GetString());
        Assert.Equal("Certified", reports[0].GetProperty("statusLabel").GetString());

        // A rejected copy: its record id for the report, the unit's ZED ID beside it.
        Assert.Equal("ZEDMSME000006_D_45", reports[1].GetProperty("zedId").GetString());
        Assert.Equal("ZEDMSME000006", reports[1].GetProperty("baseZedId").GetString());
        Assert.True(reports[1].GetProperty("reportAvailable").GetBoolean());
        Assert.Equal("rejected", reports[1].GetProperty("stage").GetString());

        // Closing meeting done, not certified yet: no report.
        Assert.False(reports[2].GetProperty("reportAvailable").GetBoolean());
        Assert.Equal(JsonValueKind.Null, reports[2].GetProperty("reportPath").ValueKind);
        Assert.Equal("Co", reports[2].GetProperty("role").GetString());
    }

    // ---------------------------------------------------------------- Site tour sections

    private void OpenSiteTour()
    {
        _t.Sql.Allot(Zed, "Silver", Lead, Co);
        _t.Fake.Procs["SP_SA_APP_CHECK_STATUS"] = _ => FakeSql.Sets([new Dictionary<string, object?> { ["OpenMeetingSubmitted"] = true }]);
    }

    private static object TourPhoto(string photoId, string? section, string? comment) => new
    {
        photoId, photo = AssessorTestHost.JpegBase64, comment, section, timeStamp = "t", latitude = "1", longitude = "2",
    };

    [Fact]
    public async Task Site_tour_photos_carry_their_section_in_the_stored_name()
    {
        OpenSiteTour();
        var e = await _t.Json("/SA/SubmitSiteTour", new
        {
            saId = Lead, zedId = Zed, certificationType = "Silver",
            siteTourPhotos = new[]
            {
                TourPhoto("t1", "3", "CNC line"), TourPhoto("t2", "safety & fire", null), TourPhoto("t3", null, "old app"),
                TourPhoto("t4", "10", new string('x', 300)),
            },
        });
        Assert.Equal("1", e.GetProperty("status").GetString());
        var rows = AssessorTestHost.Tvp(_t.LastArgs("SP_APP_SA_SAVE_PHOTOS"), "PhotoList")!;
        Assert.Equal("3. Production / Machine Shop - CNC line", rows.Rows[0]["Name"]);
        Assert.Equal("9. Safety & Fire", rows.Rows[1]["Name"]);
        Assert.Equal("old app", rows.Rows[2]["Name"]);
        var cut = (string)rows.Rows[3]["Name"];
        Assert.Equal(SiteTourSections.MaxName, cut.Length);
        Assert.StartsWith("10. Environment & Housekeeping - xxx", cut);
        Assert.True(File.Exists(_t.FileUnderRoot("SaPhotos", Zed, "Silver", "SiteTour", "t1.jpg")));
    }

    [Fact]
    public async Task An_unknown_section_is_refused_before_anything_is_stored()
    {
        OpenSiteTour();
        foreach (var section in new[] { "11", "0", "Canteen" })
        {
            var e = await _t.Json("/SA/SubmitSiteTour", new
            {
                saId = Lead, zedId = Zed, certificationType = "Silver", siteTourPhotos = new[] { TourPhoto("t1", "1", "ok"), TourPhoto("t2", section, "x") },
            });
            Assert.Equal("0", e.GetProperty("status").GetString());
            Assert.Equal(SAController.UnknownSiteTourSection, e.GetProperty("errorMessage").GetString());
        }
        Assert.Empty(_t.CallsTo("SP_APP_SA_SAVE_PHOTOS"));
        Assert.Empty(_t.AllFiles());
    }

    [Fact]
    public async Task A_section_takes_at_most_its_maximum_counting_the_team_photos()
    {
        OpenSiteTour();
        // Unit Entrance & Signage takes 2: one stored (by the co-assessor), one resent (counted once), one new is too many.
        _t.Fake.Queries[SiteTourSections.PhotosSql] = _ => [new { PhotoId = "co1", Name = "1. Unit Entrance & Signage - gate" }, new { PhotoId = "t1", Name = "1. Unit Entrance & Signage - board" }];
        var ok = await _t.Json("/SA/SubmitSiteTour", new { saId = Lead, zedId = Zed, certificationType = "Silver", siteTourPhotos = new[] { TourPhoto("t1", "entrance", "board") } });
        Assert.Equal("1", ok.GetProperty("status").GetString());

        var e = await _t.Json("/SA/SubmitSiteTour", new
        {
            saId = Lead, zedId = Zed, certificationType = "Silver", siteTourPhotos = new[] { TourPhoto("t1", "entrance", "board"), TourPhoto("t2", "1", "name board") },
        });
        Assert.Equal("0", e.GetProperty("status").GetString());
        Assert.Equal("Site Tour: \"Unit Entrance & Signage\" takes at most 2 photos. Please remove the extra photos.", e.GetProperty("errorMessage").GetString());
        Assert.Single(_t.CallsTo("SP_APP_SA_SAVE_PHOTOS"));
    }

    [Fact]
    public async Task The_unit_gets_the_admin_sections_of_its_level_and_sector_with_the_photos_uploaded()
    {
        // Admin: a Gold-only section, one for NIC 24 (the unit's sector) and one switched off.
        var sections = new[]
        {
            new SiteTourSection("gate", "Gate", "Name board", 1, 2, [], []),
            new SiteTourSection("gold", "Gold only", null, 1, 2, ["Gold"], []),
            new SiteTourSection("forge", "Forge shop", "Furnaces", 2, 4, [], ["24"]),
            new SiteTourSection("off", "Old section", null, 1, 1, [], [], Active: false),
        };
        _t.Fake.Queries["SELECT SettingKey, SettingValue FROM dbo.V4Settings"] = _ => [new { SettingKey = SiteTourSections.Key, SettingValue = JsonSerializer.Serialize(sections, new JsonSerializerOptions(JsonSerializerDefaults.Web)) }];
        _t.Fake.Queries[global::Zed.Core.Forms.AppFormUnit.SectorSql] = _ => ["24 - Manufacture of basic metals"];
        _t.Fake.Queries[SiteTourSections.PhotosSql] = _ => [new { PhotoId = "a", Name = "2. Forge shop - furnace" }, new { PhotoId = "b", Name = "1. Gate" }];

        var d = await Call("/SA/Assessment", new { saId = Lead, zedId = Zed, certificationType = "Silver" }, await TokenAsync());
        var list = d.GetProperty("siteTourSections");
        Assert.Equal(2, list.GetArrayLength());
        Assert.Equal("gate", list[0].GetProperty("id").GetString());
        Assert.Equal(1, list[0].GetProperty("uploaded").GetInt32());
        Assert.Equal("Forge shop", list[1].GetProperty("title").GetString());
        Assert.Equal(2, list[1].GetProperty("no").GetInt32());
        Assert.Equal(4, list[1].GetProperty("max").GetInt32());
        Assert.Equal(1, list[1].GetProperty("uploaded").GetInt32());

        // A photo of a section not asked of the unit is refused.
        OpenSiteTour();
        var e = await _t.Json("/SA/SubmitSiteTour", new { saId = Lead, zedId = Zed, certificationType = "Silver", siteTourPhotos = new[] { TourPhoto("t9", "gold", "x") } });
        Assert.Equal(SAController.UnknownSiteTourSection, e.GetProperty("errorMessage").GetString());
    }
}
