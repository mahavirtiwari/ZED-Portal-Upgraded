using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Zed.Core.Security;
using Zed.Main.Api.Tests;
using Zed.Portal.Features.Consultancy.Milestones;

namespace Zed.Consultancy.Api.Tests;

/// <summary>The handholding milestone page and its decisions (Consultancy/Milestones) against fakes of the ZED_CONSULTANT procedures.</summary>
public sealed class MilestoneReviewTests : IDisposable
{
    private const string Zed = "ZEDMSME000836";
    private const string Base = "/api/consultancy/milestones/ZEDMSME000836/Silver";
    private const string Lead = "ZEDCC0015";
    private const string CoConsultant = "ZEDCC1019";
    /// <summary>A prefix of the co-consultant's id: the old LIKE match let it in (#93).</summary>
    private const string Prefix = "ZEDCC101";
    private const string Co = "ZEDCO0001";

    private readonly TestHost _host = new();
    private readonly MilestoneFakeDocuments _docs = new();
    private readonly WebApplicationFactory<Program> _app;

    private int _status = 13;
    private int _milestone = 1;
    private int? _coSubmitted;

    public MilestoneReviewTests()
    {
        _app = MilestoneTestHost.With(_host, _docs);
        var q = _host.Sql.Queries;
        q[MilestoneContext.RecordSql] = args => FakeSql.Arg(args, "ZedId") == Zed && FakeSql.Arg(args, "Certification") == "Silver"
            ? [new { Id = 7L, ZedId = Zed, Certification = "Silver", CertificationStatus = _status, NcCount = _milestone,
                CertificationBodyUserId = Co, SiteAssessorId = Lead, CoAssessorId = CoConsultant + ",ZEDCC2000", TechExpert = "ZEDTE01" }]
            : [];
        q[MilestoneContext.CoConsultantsSql] = _ =>
            [new { CoAssessorId = CoConsultant, WebFinalSubmitStatus = _coSubmitted }, new { CoAssessorId = "ZEDCC2000", WebFinalSubmitStatus = (int?)null }];
        q[MilestoneContext.OwnSectionsSql] = args => FakeSql.Arg(args, "UserId") == CoConsultant ? [new { SectionCode = "2" }] : [];
        // Requirement 11 is in section 1, 12 in section 2 (the co-consultant's); 13 belongs to another unit.
        q[MilestoneFields.RequirementSql] = args => FakeSql.Arg(args, "ZedId") != Zed ? [] : FakeSql.Arg(args, "Id") switch
        {
            "11" => [new { Id = 11L, NcCount = 1, SectionCode = "1" }],
            "12" => [new { Id = 12L, NcCount = 1, SectionCode = "2" }],
            _ => [],
        };
        q[MilestoneFields.BulletSql] = args => FakeSql.Arg(args, "ZedId") != Zed ? [] : FakeSql.Arg(args, "Id") switch
        {
            "501" => [new { Id = 501L, NcCount = 1, RequirementId = "11", ReqType = "BaselineDiagnostic" }],
            "502" => [new { Id = 502L, NcCount = 1, RequirementId = "12", ReqType = "TechnologyIntervention" }],
            _ => [],
        };
        q[MilestoneFields.TrainingSql] = args => FakeSql.Arg(args, "ZedId") == Zed && FakeSql.Arg(args, "Id") == "31"
            ? [new { Id = 31L, NcCount = 1, TrainingType = "ZedTraining", AssessorId = Lead }] : [];

        _host.Sql.Procs["SP_ASSESSMENT_DA_DETAILS"] = _ => FakeSql.Sets(
            [new { ZedId = Zed, Certification = "Silver", NcCount = 1, CertificationStatus = _status, PUnitName = "ACME", Password = "secret", BdsFromDate = "May 1, 2025" }],
            [], [],
            [new { Id = 41L, SectionCode = "1", SectionName = "Leadership", NcCount = 1 }, new { Id = 42L, SectionCode = "2", SectionName = "Quality", NcCount = 1 }],
            [new { Id = 11L, SectionCode = "1", RequirementCode = "1", RequirementId = "101", BaselineRemarks = "old", ProgressReviewRemarks2 = (string?)null },
             new { Id = 12L, SectionCode = "2", RequirementCode = "1", RequirementId = "102", BaselineRemarks = "b" }],
            [], [], [], [], [], [], [], [], [], [], [], [], [], [], [],
            [new { ConsultantId = Lead, MileStoneNo = 1, LoginPhotoId1 = "77", LoginPhotoId = "https://loginzed.msme.gov.in/consultancymobileapi/Attendance/" + Zed + "/Silver/77.jpg" }],
            [new { ConsultantId = Lead, AssessorType = "Consultant" }]);
        _host.Sql.Procs["SP_ASSESSMENT_SA_DETAILS"] = _ => FakeSql.Sets(
            [], [new { Id = 1L, NcCount = 1, Comments = "open" }], [new { Name = "Owner", Designation = "MD", NcCount = 1, MobileNo = "999" }], [], [],
            [new { Id = 5L, NcCount = 1, name = "Opening Meeting Photo", src = "https://loginzed.msme.gov.in/consultancymobileapi/SaPhotos/" + Zed + "/Silver/Opening Meeting Photo_1.jpg" }],
            [new { Id = 6L, src = "https://loginzed.msme.gov.in/consultancymobileapi/SaPhotos/ZEDMSME999999/Silver/SiteTour/1.jpg" }],
            [], [], [], [], [], [],
            [new { Id = 31L, TrainingType = "ZedTraining", TrainingTopic = "ZED", Remarks = "r", NcCount = 1, AssessorId = Lead }],
            [], [], [],
            [new { NcCount = 1, TurnOver = "10" }],
            [new { Id = 501L, RequirementId = "11", ReqType = "BaselineDiagnostic", BulletPoints = "gap", NcCount = 1 },
             new { Id = 502L, RequirementId = "12", ReqType = "TechnologyIntervention", BulletPoints = "tech", NcCount = 1 },
             new { Id = 999999999L, RequirementId = "11", ReqType = "HandholdingActionPlan", BulletPoints = (string?)null, NcCount = 1 }],
            [new { SectionCode = "1", AllotedAssessorId = Lead, AllotedAssessorName = "LEAD", NcCount = 1, AssessorRank = "Lead Consultant" }]);
        _host.Sql.Procs["SP_ASSESSMENT_RA_CONFIRM_FINAL_SUBMIT"] = _ => FakeSql.Sets([new { AllowFinalSubmit = 1, ErrorMessage = "" }], [new { RaisedForNc = 0 }]);
        _host.Sql.Procs["SP_RA_GET_CERTIFICATE_DETAILS"] = _ => FakeSql.Sets([new { EmailId = "unit@x.test", EstablishmentName = "Acme <Castings>", NcCount = _milestone, MobileNo = "9" }]);
    }

    public void Dispose()
    {
        _app.Dispose();
        _host.Dispose();
    }

    private Task<HttpClient> As(string user, UserRole role = UserRole.DesktopAssessor, string[]? subRoles = null) =>
        MilestoneTestHost.SignInAsync(_app, user, role, subRoles);

    private IEnumerable<object?> CallsTo(string name) => _host.Sql.Calls.Where(c => c.Name == name).Select(c => c.Args);

    private static readonly string[] Writes =
    [
        "SP_ASSESSMENT_RA_FINAL_SUBMIT", "SP_MONITORING_RA_FINAL_SUBMIT", "SP_MONITORING_SEND_BACK_TO_ASSESSOR", "SP_MONITORING_REJECT_FINAL_SUBMIT",
        "SP_MONITORING_REJECT_CERTIFICATION", "SP_CONSULTANCY_INSERT_BULLETS", "SP_CONSULTANCY_UPDATE_COLUMN_VALUE",
    ];

    private bool NothingWritten() =>
        !_host.Sql.Calls.Any(c => Writes.Contains(c.Name) || c.Name.StartsWith("UPDATE ", StringComparison.Ordinal));

    // ------------------------------------------------------------------ page

    [Fact]
    public async Task The_lead_consultant_gets_the_milestone_page_with_only_shown_columns()
    {
        var client = await As(Lead);
        var res = await client.GetAsync(Base);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadAsStringAsync();
        Assert.DoesNotContain("secret", body);
        Assert.DoesNotContain("999", body.Replace("999999", "")); // participant mobile numbers are not sent
        var json = JsonDocument.Parse(body).RootElement;
        Assert.Equal(1, json.GetProperty("milestone").GetInt32());
        Assert.Equal("Lead", json.GetProperty("party").GetString());
        // The "add more" placeholder rows of the procedure are not bullets.
        Assert.Equal(2, json.GetProperty("bullets").GetArrayLength());
        Assert.True(json.GetProperty("permissions").GetProperty("canEdit").GetBoolean());
        var fields = json.GetProperty("permissions").GetProperty("editableFields").EnumerateArray().Select(e => e.GetString()).ToList();
        Assert.Contains("BaselineRemarks", fields);
        Assert.DoesNotContain("ProgressReviewRemarks", fields);
        // Photos are served by the API; a photo of another unit's folder is not.
        Assert.StartsWith("/api/consultancy/milestones/ZEDMSME000836/Silver/files/consultancymobileapi/Attendance/",
            json.GetProperty("attendance")[0].GetProperty("LoginPhotoUrl").GetString());
        Assert.Equal(JsonValueKind.Null, json.GetProperty("siteTour")[0].GetProperty("url").ValueKind);

        // The procedures get the milestone (DA: @Milestone, SA: @MileStone, as declared in ZED_CONSULTANT).
        Assert.Equal("1", FakeSql.Arg(CallsTo("SP_ASSESSMENT_DA_DETAILS").Single(), "Milestone"));
        Assert.Equal("1", FakeSql.Arg(CallsTo("SP_ASSESSMENT_SA_DETAILS").Single(), "MileStone"));
        Assert.Equal(Lead, FakeSql.Arg(CallsTo("SP_ASSESSMENT_SA_DETAILS").Single(), "UserId"));
    }

    [Fact]
    public async Task A_consultant_whose_id_only_prefixes_a_co_consultant_gets_nothing()
    {
        var client = await As(Prefix);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(Base)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync(Base + "/requirements/11", new { field = "BaselineRemarks", value = "x" })).StatusCode);
        Assert.Empty(CallsTo("SP_ASSESSMENT_DA_DETAILS"));
        Assert.True(NothingWritten());
    }

    [Fact]
    public async Task Another_CO_and_unknown_units_get_404_and_bad_input_400()
    {
        var other = await As("ZEDCO0002", UserRole.Agency);
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync(Base)).StatusCode);
        var lead = await As(Lead);
        Assert.Equal(HttpStatusCode.NotFound, (await lead.GetAsync("/api/consultancy/milestones/ZEDMSME000999/Silver")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await lead.GetAsync("/api/consultancy/milestones/ZEDMSME000836/Bronze")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await lead.GetAsync("/api/consultancy/milestones/ZED'1/Silver")).StatusCode);
    }

    [Fact]
    public async Task The_master_admin_reads_but_cannot_decide_or_edit()
    {
        _status = 15;
        var admin = await As("MADMIN", UserRole.MasterAdmin);
        var res = await admin.GetFromJsonAsync<JsonElement>(Base);
        Assert.False(res.GetProperty("permissions").GetProperty("canEdit").GetBoolean());
        Assert.False(res.GetProperty("permissions").GetProperty("canCoFinalSubmit").GetBoolean());
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.PostAsJsonAsync(Base + "/final-submit", new { confirmed = true })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.PostAsJsonAsync(Base + "/requirements/11", new { field = "BaselineRemarks", value = "x" })).StatusCode);
        Assert.True(NothingWritten());
    }

    // ------------------------------------------------------------------ edits

    [Fact]
    public async Task Requirement_edits_use_a_constant_statement_for_an_allow_listed_column()
    {
        var lead = await As(Lead);
        var res = await lead.PostAsJsonAsync(Base + "/requirements/11", new { field = "baselineremarks", value = "  New'; DROP TABLE Users;--  " });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var (sql, args) = _host.Sql.Calls.Single(c => c.Name.StartsWith("UPDATE ", StringComparison.Ordinal));
        Assert.Equal(MilestoneFields.Requirements["BaselineRemarks"].Sql, sql);
        Assert.Equal("New'; DROP TABLE Users;--", FakeSql.Arg(args, "Value"));
        Assert.Equal("11", FakeSql.Arg(args, "Id"));
        Assert.Equal(Zed, FakeSql.Arg(args, "ZedId"));

        foreach (var field in new[] { "Password", "CertificationStatus", "BaselineRemarks]=1--", "" })
            Assert.Equal(HttpStatusCode.BadRequest, (await lead.PostAsJsonAsync(Base + "/requirements/11", new { field, value = "x" })).StatusCode);
        // Progress review 1 belongs to milestone 2.
        Assert.Equal(HttpStatusCode.Forbidden, (await lead.PostAsJsonAsync(Base + "/requirements/11", new { field = "ProgressReviewRemarks", value = "x" })).StatusCode);
        // A requirement of another unit.
        Assert.Equal(HttpStatusCode.NotFound, (await lead.PostAsJsonAsync(Base + "/requirements/13", new { field = "Intervention", value = "x" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await lead.PostAsJsonAsync(Base + "/requirements/11", new { field = "EstimatedTimeInDays", value = new string('9', 51) })).StatusCode);
        Assert.Single(_host.Sql.Calls, c => c.Name.StartsWith("UPDATE ", StringComparison.Ordinal));
        Assert.Empty(CallsTo("SP_CONSULTANCY_UPDATE_COLUMN_VALUE"));
    }

    [Fact]
    public async Task Milestone_three_edits_progress_review_2_only()
    {
        _milestone = 3;
        var lead = await As(Lead);
        Assert.Equal(HttpStatusCode.Forbidden, (await lead.PostAsJsonAsync(Base + "/requirements/11", new { field = "BaselineRemarks", value = "x" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await lead.PostAsJsonAsync(Base + "/requirements/11", new { field = "ProgressReviewRemarks2", value = "done" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await lead.PostAsJsonAsync(Base + "/bullets", new { requirementId = 11, reqType = "BaselineDiagnostic", text = "x" })).StatusCode);
    }

    [Fact]
    public async Task A_co_consultant_edits_its_own_sections_until_its_final_submit()
    {
        var co = await As(CoConsultant);
        Assert.Equal(HttpStatusCode.OK, (await co.PostAsJsonAsync(Base + "/requirements/12", new { field = "Intervention", value = "x" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await co.PostAsJsonAsync(Base + "/requirements/11", new { field = "Intervention", value = "x" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await co.DeleteAsync(Base + "/bullets/501")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await co.DeleteAsync(Base + "/bullets/502")).StatusCode);
        // Trainings are the lead's.
        Assert.Equal(HttpStatusCode.Forbidden, (await co.PostAsJsonAsync(Base + "/trainings/31/remarks", new { remarks = "x" })).StatusCode);

        _coSubmitted = 1;
        Assert.Equal(HttpStatusCode.Forbidden, (await co.PostAsJsonAsync(Base + "/requirements/12", new { field = "Intervention", value = "y" })).StatusCode);
        Assert.Equal(2, _host.Sql.Calls.Count(c => c.Name.StartsWith("UPDATE ", StringComparison.Ordinal)));
    }

    [Fact]
    public async Task Bullets_are_added_through_the_procedure_and_soft_deleted()
    {
        var lead = await As(Lead);
        Assert.Equal(HttpStatusCode.OK, (await lead.PostAsJsonAsync(Base + "/bullets", new { requirementId = 11, reqType = "handholdingactionplan", text = " Plan A " })).StatusCode);
        var add = CallsTo("SP_CONSULTANCY_INSERT_BULLETS").Single();
        Assert.Equal("HandholdingActionPlan", FakeSql.Arg(add, "ReqType"));
        Assert.Equal("11", FakeSql.Arg(add, "RequirementId"));
        Assert.Equal("Plan A", FakeSql.Arg(add, "BulletPoints"));
        Assert.Equal(Lead, FakeSql.Arg(add, "UserId"));

        Assert.Equal(HttpStatusCode.BadRequest, (await lead.PostAsJsonAsync(Base + "/bullets", new { requirementId = 11, reqType = "Users", text = "x" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await lead.PostAsJsonAsync(Base + "/bullets", new { requirementId = 13, reqType = "BaselineDiagnostic", text = "x" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await lead.PostAsJsonAsync(Base + "/bullets", new { requirementId = 11, reqType = "BaselineDiagnostic", text = new string('x', 501) })).StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await lead.PutAsJsonAsync(Base + "/bullets/501", new { text = "gap 2" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await lead.DeleteAsync(Base + "/bullets/501")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await lead.DeleteAsync(Base + "/bullets/999999999")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await lead.DeleteAsync(Base + "/bullets/503")).StatusCode);
        Assert.Contains(_host.Sql.Calls, c => c.Name == MilestoneFields.UpdateBulletSql && FakeSql.Arg(c.Args, "Value") == "gap 2");
        Assert.Single(_host.Sql.Calls, c => c.Name == MilestoneFields.DeleteBulletSql);
    }

    [Fact]
    public async Task Edits_follow_the_status_consultants_at_13_the_co_at_15()
    {
        var co = await As(Co, UserRole.Agency);
        Assert.Equal(HttpStatusCode.Forbidden, (await co.PostAsJsonAsync(Base + "/requirements/11", new { field = "BaselineRemarks", value = "x" })).StatusCode);
        _status = 15;
        Assert.Equal(HttpStatusCode.OK, (await co.PostAsJsonAsync(Base + "/requirements/11", new { field = "BaselineRemarks", value = "x" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await co.PostAsJsonAsync(Base + "/trainings/31/remarks", new { remarks = "ok" })).StatusCode);
        var lead = await As(Lead);
        Assert.Equal(HttpStatusCode.Forbidden, (await lead.PostAsJsonAsync(Base + "/requirements/11", new { field = "BaselineRemarks", value = "y" })).StatusCode);
        // A CO without the site verification sub-role does not review.
        var finOnly = await As(Co, UserRole.Agency, [SubRoles.FinancialVerification]);
        Assert.Equal(HttpStatusCode.Forbidden, (await finOnly.PostAsJsonAsync(Base + "/send-back", new { remarks = "x" })).StatusCode);
    }

    // ------------------------------------------------------------------ consultant final submit

    [Fact]
    public async Task Consultant_final_submit_runs_the_procedure_checks_with_the_user_id()
    {
        _host.Sql.Procs["SP_ASSESSMENT_RA_CONFIRM_FINAL_SUBMIT"] = _ =>
            FakeSql.Sets([new { AllowFinalSubmit = 0, ErrorMessage = "You may have missed one or more estimated time. Please review." }], [new { RaisedForNc = 0 }]);
        var lead = await As(Lead);
        var check = await (await lead.PostAsync(Base + "/consultant/check", null)).Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(check.GetProperty("allowed").GetBoolean());
        var res = await lead.PostAsJsonAsync(Base + "/consultant/final-submit", new { remarks = "done" });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains("estimated time", await res.ProblemTitle());
        Assert.Empty(CallsTo("SP_ASSESSMENT_RA_FINAL_SUBMIT"));

        _host.Sql.Procs["SP_ASSESSMENT_RA_CONFIRM_FINAL_SUBMIT"] = _ => FakeSql.Sets([new { AllowFinalSubmit = 1, ErrorMessage = "" }], [new { RaisedForNc = 0 }]);
        Assert.Equal(HttpStatusCode.BadRequest, (await lead.PostAsJsonAsync(Base + "/consultant/final-submit", new { remarks = " " })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await lead.PostAsJsonAsync(Base + "/consultant/final-submit", new { remarks = "Milestone done" })).StatusCode);
        var call = CallsTo("SP_ASSESSMENT_RA_FINAL_SUBMIT").Single();
        Assert.Equal(Lead, FakeSql.Arg(call, "UserId"));
        Assert.Equal("Milestone done", FakeSql.Arg(call, "AssessorRemarks"));
        Assert.All(CallsTo("SP_ASSESSMENT_RA_CONFIRM_FINAL_SUBMIT"), a => Assert.Equal(Lead, FakeSql.Arg(a, "UserId")));
    }

    [Fact]
    public async Task Consultant_final_submit_is_refused_outside_status_13_and_after_the_co_consultants_own_submit()
    {
        var co = await As(CoConsultant);
        _coSubmitted = 1;
        Assert.Equal(HttpStatusCode.Forbidden, (await co.PostAsJsonAsync(Base + "/consultant/final-submit", new { remarks = "x" })).StatusCode);
        _coSubmitted = null;
        _status = 15;
        Assert.Equal(HttpStatusCode.Forbidden, (await co.PostAsJsonAsync(Base + "/consultant/final-submit", new { remarks = "x" })).StatusCode);
        var coOrg = await As(Co, UserRole.Agency);
        Assert.Equal(HttpStatusCode.Forbidden, (await coOrg.PostAsJsonAsync(Base + "/consultant/final-submit", new { remarks = "x" })).StatusCode);
        Assert.Empty(CallsTo("SP_ASSESSMENT_RA_CONFIRM_FINAL_SUBMIT"));
        Assert.True(NothingWritten());
    }

    // ------------------------------------------------------------------ CO decisions

    [Fact]
    public async Task CO_final_submit_only_at_15_completes_and_mails_the_milestone_report()
    {
        _milestone = 2;
        var co = await As(Co, UserRole.Agency);
        Assert.Equal(HttpStatusCode.Forbidden, (await co.PostAsJsonAsync(Base + "/final-submit", new { confirmed = true })).StatusCode);
        Assert.True(NothingWritten());

        _status = 15;
        Assert.Equal(HttpStatusCode.BadRequest, (await co.PostAsJsonAsync(Base + "/final-submit", new { confirmed = false })).StatusCode);
        var res = await co.PostAsJsonAsync(Base + "/final-submit", new { confirmed = true });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var call = CallsTo("SP_MONITORING_RA_FINAL_SUBMIT").Single();
        Assert.Equal(Co, FakeSql.Arg(call, "UserId"));
        Assert.Matches("^[1-9a-z]{4}$", FakeSql.Arg(call, "QrCodeSeqNo"));
        Assert.Contains(("report", Zed, "SilverMilestone2"), _docs.Calls);
        var mail = Assert.Single(_host.Email.Sent);
        Assert.Equal("unit@x.test", mail.To);
        Assert.Contains("Handholding Support (Milestone 2) Report", mail.Subject);
        Assert.Contains("Acme &lt;Castings&gt;", mail.HtmlBody);
        Assert.Equal($"{Zed}_Silver_Milestone2_Report.pdf", Assert.Single(mail.Attachments!).FileName);
    }

    [Fact]
    public async Task CO_final_submit_still_succeeds_when_the_report_cannot_be_generated()
    {
        _status = 15;
        _docs.FailReports = true;
        var co = await As(Co, UserRole.Agency);
        var res = await co.PostAsJsonAsync(Base + "/final-submit", new { confirmed = true });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Null(Assert.Single(_host.Email.Sent).Attachments);
    }

    [Fact]
    public async Task CO_sends_back_and_rejects_only_at_15()
    {
        var co = await As(Co, UserRole.Agency);
        Assert.Equal(HttpStatusCode.Forbidden, (await co.PostAsJsonAsync(Base + "/send-back", new { remarks = "x" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await co.PostAsJsonAsync(Base + "/reject", new { confirmed = true })).StatusCode);
        Assert.True(NothingWritten());

        _status = 15;
        Assert.Equal(HttpStatusCode.BadRequest, (await co.PostAsJsonAsync(Base + "/send-back", new { remarks = "" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await co.PostAsJsonAsync(Base + "/send-back", new { remarks = "Please add bullets" })).StatusCode);
        Assert.Equal("Please add bullets", FakeSql.Arg(CallsTo("SP_MONITORING_SEND_BACK_TO_ASSESSOR").Single(), "SendBackRemarks"));

        Assert.Equal(HttpStatusCode.OK, (await co.PostAsJsonAsync(Base + "/reject", new { confirmed = true })).StatusCode);
        Assert.Single(CallsTo("SP_MONITORING_REJECT_FINAL_SUBMIT"));
        Assert.Single(CallsTo("SP_MONITORING_REJECT_CERTIFICATION"));
        var mail = Assert.Single(_host.Email.Sent);
        Assert.StartsWith("Rejection of your application", mail.Subject);
        Assert.Equal($"{Zed}_Silver_Reject_Report.pdf", Assert.Single(mail.Attachments!).FileName);
        Assert.DoesNotContain(mail.Bcc ?? [], b => b.Contains("geostat", StringComparison.OrdinalIgnoreCase));
    }

    // ------------------------------------------------------------------ files

    [Fact]
    public async Task Files_are_served_only_from_the_units_consultant_app_folders()
    {
        var folder = Path.Combine(_host.StorageRoot, "consultancymobileapi", "SaPhotos", Zed, "Silver", "SiteTour");
        Directory.CreateDirectory(folder);
        await File.WriteAllBytesAsync(Path.Combine(folder, "1.jpg"), [0xFF, 0xD8, 0xFF]);
        var lead = await As(Lead);
        var ok = await lead.GetAsync(Base + "/files/consultancymobileapi/SaPhotos/" + Zed + "/Silver/SiteTour/1.jpg");
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        Assert.Equal("nosniff", ok.Headers.GetValues("X-Content-Type-Options").Single());
        foreach (var path in new[]
                 {
                     "consultancymobileapi/SaPhotos/ZEDMSME000999/Silver/SiteTour/1.jpg",
                     "consultancymobileapi/SaPhotos/" + Zed + "/../ZEDMSME000999/1.jpg",
                     "mobileapi/SaPhotos/" + Zed + "/Silver/SiteTour/1.jpg",
                     "consultancymobileapi/SaPhotos/" + Zed + "/Silver/SiteTour/1.aspx",
                 })
            Assert.Equal(HttpStatusCode.NotFound, (await lead.GetAsync(Base + "/files/" + path)).StatusCode);
        var stranger = await As(Prefix);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync(Base + "/files/consultancymobileapi/SaPhotos/" + Zed + "/Silver/SiteTour/1.jpg")).StatusCode);
    }

    [Fact]
    public async Task The_milestone_endpoints_need_a_signed_in_staff_user()
    {
        var anonymous = await MilestoneTestHost.SignInAsync(_app, null);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(Base)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.PostAsJsonAsync(Base + "/final-submit", new { confirmed = true })).StatusCode);
    }
}
