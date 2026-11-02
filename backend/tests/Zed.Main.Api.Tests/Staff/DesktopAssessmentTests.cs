using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Zed.Core.Assessment;
using Zed.Core.Data;
using Zed.Portal.Features.Staff.Assessment;

namespace Zed.Main.Api.Tests.Staff;

public sealed class DesktopAssessmentTests : IDisposable
{
    private const string Zed = "ZEDMSME000001";
    private const string Base = "/api/staff/assessment/da/ZEDMSME000001/Bronze";
    private readonly TestHost _host = new();

    /// <summary>MsmeCertifications row of ZEDMSME000001/Bronze: allotted to AGENCY1 and its accepted desktop assessor ASSESSOR1.</summary>
    private object _record = Record(status: 3);

    private static object Record(int status, int nc = 0, int nc1 = 0) => new
    {
        ZedId = Zed, Certification = "Bronze", CertificationStatus = status, NcCount = nc, NcStatus = 0, Nc1Status = nc1, Nc2Status = 0, Nc3Status = 0, Nc4Status = 0, Nc5Status = 0,
        DesktopAssessorId = "ASSESSOR1", DesktopAccepted = true, DesktopReasonForRejection = (string?)null, CertificationBodyUserId = "AGENCY1",
        SiteAssessorId = (string?)null, CoAssessorId = (string?)null,
    };

    public DesktopAssessmentTests()
    {
        DaTestUsers.Install(_host.Sql);
        var q = _host.Sql.Queries;
        q[AssessmentRecords.CertificationSql] = args => FakeSql.Arg(args, "ZedId") == Zed && FakeSql.Arg(args, "Certification") == "Bronze" ? [_record] : [];
        // Requirement 11 belongs to the record; 99 to another MSME.
        q[AssessmentRecords.RequirementSql] = args => Mine(args, 11) ? [new { Id = 11L, NcCount = 0 }] : [];
        q[AssessmentRecords.ProductSql] = args => Mine(args, 21) ? [new { Id = 21L, NcCount = 0 }] : [];
        q[AssessmentRecords.EvidenceSql] = args => Mine(args, 31)
            ? [new { Id = 31L, NcCount = 0, SectionCode = "1", RequirementCode = "2", EvidenceCode = "3", ValidationRequired = true }]
            : [];
        q[AssessmentRecords.SectionSql] = args => Mine(args, 41) ? [new { Id = 41L, NcCount = 0, IsAssessmentExcempted = "Yes" }] : [];

        _host.Sql.Procs["SP_ASSESSMENT_DA_DETAILS"] = args =>
        {
            // The procedure's own rule: an assessor sees the records it is allotted to (otherwise ZED ID '000').
            var user = FakeSql.Arg(args, "UserId");
            if (user is "ASSESSOR2" || FakeSql.Arg(args, "ZedId") != Zed) return FakeSql.Sets([]);
            return FakeSql.Sets(
                [new { ZedId = Zed, Certification = "Bronze", PUnitName = "Unit 1", CertificationStatus = 3, NcCount = 0, PhotosPath = (string?)null,
                       DesktopAssessorId = "ASSESSOR1", DesktopAssessorName = "Assessor One", CertificationBodyUserId = "AGENCY1", UserName = "Agency One", AssessorRemarks = "ok" }],
                [new { Id = 21, ZedId = Zed, Certification = "Bronze", ProductName = "Bolt", ProductPhoto = "p1.jpg", ProductDescriptionPhoto = "d1.pdf", ProductOpenedTime = DateTime.Now, NcCount = 0 }],
                [],
                [new { Id = 41, SectionCode = "1", SectionName = "Leadership", ValidationRequired = 1, IsAssessmentExcempted = "Yes", AllotedAssessorId = "X" }],
                [new { Id = 11, SectionCode = "1", RequirementCode = "2", Conformance = (string?)null, OpenedFlag = true }],
                [], [],
                [new { Id = 31, ZedId = Zed, SectionCode = "1", RequirementCode = "2", EvidenceId = 5551, EvidenceCode = "3", EvidenceName = "Policy", ValidationRequired = true, SyncedDate = "May 01, 2024" }],
                [new { Id = 61, PhotoId = "777", PhotoType = "SiteExteriorPhotos", Latitude = "28.6", Longitude = "77.2", DocumentOpenedTime = 0 }],
                [new { Latitude = "28.6", Longitude = "77.2", SaLatitude = "1" }],
                [new { RefEvidenceId = 31, FileName = "Screenshot_1.pdf" }],
                [new { Code = "E1", Question = "Q", Answer = "Yes", CheckListType = "ESG", SubmissionDate = DateTime.Now }]);
        };
        _host.Sql.Procs["SP_ASSESSMENT_DA_CONFIRM_FINAL_SUBMIT"] = _ => FakeSql.Sets([new { AllowFinalSubmit = 1, ErrorMessage = "" }], [new { RaisedForNc = 1 }]);
        _host.Sql.Procs["SP_EMAIL_GET_DETAILS"] = _ => FakeSql.Sets([new { EmailId = "unit@x.test", EnterpriseName = "Acme", NcCount = 1, NcFinalClosureDt = "May 01, 2026", MsmePassword = "Msme#Secret1" }]);
    }

    private static bool Mine(object? args, long id) =>
        FakeSql.Arg(args, "Id") == id.ToString() && FakeSql.Arg(args, "ZedId") == Zed && FakeSql.Arg(args, "Certification") == "Bronze";

    public void Dispose() => _host.Dispose();

    private Task<HttpClient> As(string user) => DaTestUsers.SignInAsync(_host, user);

    // ------------------------------------------------------------------ who may read

    [Fact]
    public async Task Review_page_needs_a_signed_in_user()
    {
        var client = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(Base)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(Base + "/files/mobileapi/Photos/ZEDMSME000001/Bronze/Evidences/5551.pdf")).StatusCode);
    }

    [Fact]
    public async Task Roles_without_the_review_page_are_forbidden()
    {
        var admin = await As("ADMIN1");
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.GetAsync(Base)).StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_ASSESSMENT_DA_DETAILS");
    }

    [Fact]
    public async Task Assessor_cannot_open_a_record_not_allotted_to_it()
    {
        var other = await As("ASSESSOR2");
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync(Base)).StatusCode);
        var call = DaTestUsers.CallsTo(_host.Sql, "SP_ASSESSMENT_DA_DETAILS").Single();
        Assert.Equal("ASSESSOR2", FakeSql.Arg(call.Args, "UserId"));
        Assert.Equal("3", FakeSql.Arg(call.Args, "RoleId"));
    }

    [Fact]
    public async Task Agency_cannot_open_a_record_of_another_agency()
    {
        var other = await As("AGENCY2");
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync(Base)).StatusCode);
    }

    [Fact]
    public async Task Review_page_returns_shown_columns_and_authorised_file_addresses()
    {
        var client = await As("ASSESSOR1");
        var json = await client.GetFromJsonAsync<JsonElement>(Base);

        Assert.True(json.GetProperty("permissions").GetProperty("canAssess").GetBoolean());
        Assert.True(json.GetProperty("permissions").GetProperty("canFinalSubmit").GetBoolean());
        Assert.Equal("Agency One", json.GetProperty("msme").GetProperty("AgencyName").GetString());
        Assert.False(json.GetProperty("msme").TryGetProperty("PhotosPath", out _));

        var evidence = json.GetProperty("evidences")[0];
        Assert.Equal(Base + "/files/mobileapi/Photos/ZEDMSME000001/Bronze/Evidences/5551.pdf", evidence.GetProperty("FileUrl").GetString());
        Assert.Equal(Base + "/files/Uploads/DA/ZEDMSME000001/Bronze/1.2.3/Screenshot_1.pdf", evidence.GetProperty("Screenshots")[0].GetString());

        var photo = json.GetProperty("photos")[0];
        Assert.Equal(Base + "/files/mobileapi/Photos/ZEDMSME000001/Bronze/SiteExteriorPhotos/777.jpg", photo.GetProperty("Url").GetString());
        Assert.False(photo.TryGetProperty("Latitude", out _));

        var product = json.GetProperty("products")[0];
        Assert.True(product.GetProperty("ProductOpened").GetBoolean());
        Assert.False(product.GetProperty("DescriptionOpened").GetBoolean());
        Assert.Equal("pdf", product.GetProperty("DescriptionKind").GetString());
        Assert.False(json.GetProperty("sections")[0].TryGetProperty("AllotedAssessorId", out _));
        Assert.Equal("28.6", json.GetProperty("location").GetProperty("Latitude").GetString());
    }

    [Fact]
    public async Task Qc_users_do_not_see_agency_and_assessor_names()
    {
        var qc = await As("QC1");
        var json = await qc.GetFromJsonAsync<JsonElement>(Base);
        Assert.False(json.GetProperty("msme").TryGetProperty("AgencyName", out _));
        Assert.False(json.GetProperty("msme").TryGetProperty("DesktopAssessorName", out _));
        Assert.False(json.GetProperty("permissions").GetProperty("canAssess").GetBoolean());
    }

    // ------------------------------------------------------------------ who may change

    [Fact]
    public async Task Changes_need_a_signed_in_user()
    {
        var client = await _host.CreateBrowserAsync();
        var r = await client.PostAsJsonAsync(Base + "/requirements/11/conformance", new { conformance = "Yes" });
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_ASSESSMENT_DA_UPDATE_REQUIREMENT");
    }

    [Theory]
    [InlineData("QC1")]
    [InlineData("AGENCY1")]
    [InlineData("MADMIN")]
    public async Task Only_desktop_assessors_change_conformance(string user)
    {
        var client = await As(user);
        var r = await client.PostAsJsonAsync(Base + "/requirements/11/conformance", new { conformance = "Yes" });
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_ASSESSMENT_DA_UPDATE_REQUIREMENT");
    }

    [Fact]
    public async Task Assessor_without_desktop_verification_sub_role_is_forbidden()
    {
        var client = await As("ASSESSORSV");
        var r = await client.PostAsJsonAsync(Base + "/final-submit", new { remarks = "Done" });
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_ASSESSMENT_DA_FINAL_SUBMIT");
    }

    [Theory]
    [InlineData("/requirements/11/conformance")]
    [InlineData("/products/21/validate")]
    [InlineData("/site-exterior/validate")]
    [InlineData("/final-submit")]
    public async Task Assessor_cannot_change_a_record_not_allotted_to_it(string action)
    {
        var other = await As("ASSESSOR2");
        var r = await other.PostAsJsonAsync(Base + action, new { conformance = "Yes", isVerified = "Yes", remarks = "x" });
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.StartsWith("SP_ASSESSMENT_DA_UPDATE") || c.Name == "SP_ASSESSMENT_DA_FINAL_SUBMIT");
    }

    [Fact]
    public async Task Ids_of_another_record_are_refused()
    {
        var client = await As("ASSESSOR1");
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync(Base + "/requirements/99/conformance", new { conformance = "Yes" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync(Base + "/products/99/validate", new { isVerified = "Yes" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync(Base + "/opened", new { type = "Evidence", id = 99 })).StatusCode);
        // A requirement id of this record sent with another ZED ID.
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync("/api/staff/assessment/da/ZEDMSME000002/Bronze/requirements/11/conformance", new { conformance = "Yes" })).StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.StartsWith("SP_ASSESSMENT_DA_UPDATE"));
    }

    [Fact]
    public async Task Assessor_updates_conformance_of_its_record()
    {
        var client = await As("ASSESSOR1");
        var bad = await client.PostAsJsonAsync(Base + "/requirements/11/conformance", new { conformance = "No", remarks = "" });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);

        var r = await client.PostAsJsonAsync(Base + "/requirements/11/conformance", new { conformance = "No", remarks = "Policy missing" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var call = DaTestUsers.CallsTo(_host.Sql, "SP_ASSESSMENT_DA_UPDATE_REQUIREMENT").Single();
        Assert.Equal("11", FakeSql.Arg(call.Args, "Id"));
        Assert.Equal("No", FakeSql.Arg(call.Args, "Conformance"));
        Assert.Equal("Policy missing", FakeSql.Arg(call.Args, "AssessorRemark"));
    }

    /// <summary>Requirement 11's checkpoints: 1 with a mandatory evidence (uploaded, verified), 2 without evidence.</summary>
    private void Checkpoints()
    {
        _host.Sql.Queries[CheckpointAnswers.CheckpointSql("dbo")] = args => FakeSql.Arg(args, "ZedId") == Zed
            ? [new { RequirementRowId = 11L, Id = 501L, OptionCode = "1", OptionName = "Has a quality policy", ActionsNeeded = "Write the policy\nDisplay it", DaAnswer = (string?)null },
               new { RequirementRowId = 11L, Id = 502L, OptionCode = "2", OptionName = "Staff know it", ActionsNeeded = "Train the staff", DaAnswer = "Partial" }]
            : [];
        _host.Sql.Queries[CheckpointAnswers.EvidenceSql("dbo")] = _ =>
            [new { RequirementRowId = 11L, Id = 31L, OptionCode = "1", EvidenceName = "Policy", Mandatory = true, Uploaded = true, IsVerified = "Yes" }];
    }

    [Fact]
    public async Task The_page_gets_the_checkpoints_with_their_evidence_and_actions()
    {
        Checkpoints();
        var json = await (await As("ASSESSOR1")).GetFromJsonAsync<JsonElement>(Base);
        var list = json.GetProperty("checkpoints");
        Assert.Equal(2, list.GetArrayLength());
        Assert.Equal(11, list[0].GetProperty("requirementId").GetInt64());
        Assert.Equal(["Write the policy", "Display it"], list[0].GetProperty("actions").EnumerateArray().Select(a => a.GetString()));
        Assert.True(list[0].GetProperty("evidences")[0].GetProperty("mandatory").GetBoolean());
        Assert.Equal("Partial", list[1].GetProperty("desktop").GetProperty("value").GetString());
        Assert.Equal(JsonValueKind.Null, list[0].GetProperty("desktop").ValueKind);
    }

    [Fact]
    public async Task Assessor_answers_the_checkpoints_and_the_conformance_follows()
    {
        Checkpoints();
        var client = await As("ASSESSOR1");
        var missing = await client.PostAsJsonAsync(Base + "/requirements/11/checkpoints", new { answers = new[] { new { id = 501, answer = "Yes" } } });
        Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
        Assert.Contains("Checkpoint 2", await missing.ProblemTitle());
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_ASSESSMENT_DA_UPDATE_REQUIREMENT");

        var r = await client.PostAsJsonAsync(Base + "/requirements/11/checkpoints", new
        {
            answers = new object[]
            {
                new { id = 501, answer = "Yes" },
                new { id = 502, answer = "Partial", actions = new[] { "Train the staff" } },
            },
        });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        // The answers and the requirement's conformance in one batch, one transaction.
        var save = Assert.Single(_host.Sql.Calls, c => c.Name.StartsWith(CheckpointAnswers.SaveBatchStart, StringComparison.Ordinal));
        Assert.Contains(CheckpointAnswers.UpdateSql(CheckpointAnswers.Stage.Desktop, 1), save.Name);
        Assert.Contains("EXEC dbo.SP_ASSESSMENT_DA_UPDATE_REQUIREMENT @Id = @cId, @Conformance = @cConformance, @AssessorRemark = @cAssessorRemark;", save.Name);
        Assert.EndsWith("COMMIT;", save.Name);
        Assert.Equal(["501:Yes", "502:Partial"], new[] { 0, 1 }.Select(i => FakeSql.Arg(save.Args, "Id" + i) + ":" + FakeSql.Arg(save.Args, "Answer" + i)));
        Assert.Equal("Train the staff", FakeSql.Arg(save.Args, "Actions1"));
        Assert.Equal("ASSESSOR1", FakeSql.Arg(save.Args, "AnsweredBy"));
        Assert.Equal(("11", "No", "2. Partial: Train the staff."),
            (FakeSql.Arg(save.Args, "cId"), FakeSql.Arg(save.Args, "cConformance"), FakeSql.Arg(save.Args, "cAssessorRemark")));

        // The old Yes / No conformance is refused for a requirement with checkpoints.
        var direct = await client.PostAsJsonAsync(Base + "/requirements/11/conformance", new { conformance = "Yes" });
        Assert.Contains("checkpoint by checkpoint", await direct.ProblemTitle());

        // Another assessor's record, and a requirement of another unit, are refused.
        Assert.Equal(HttpStatusCode.NotFound, (await (await As("ASSESSOR2")).PostAsJsonAsync(Base + "/requirements/11/checkpoints", new { answers = Array.Empty<object>() })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync(Base + "/requirements/99/checkpoints", new { answers = Array.Empty<object>() })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await (await As("AGENCY1")).PostAsJsonAsync(Base + "/requirements/11/checkpoints", new { answers = Array.Empty<object>() })).StatusCode);
        Assert.Single(_host.Sql.Calls, c => c.Name.StartsWith(CheckpointAnswers.SaveBatchStart, StringComparison.Ordinal));
        Assert.Empty(DaTestUsers.CallsTo(_host.Sql, "SP_ASSESSMENT_DA_UPDATE_REQUIREMENT"));
    }

    [Theory]
    [InlineData(5, 0, 0)]  // submitted to the agency
    [InlineData(4, 1, 1)]  // NC 1 raised, not yet answered by the MSME
    [InlineData(1, 0, 0)]  // MSME has not submitted yet
    public async Task Changes_are_refused_when_the_desktop_verification_is_closed(int status, int nc, int nc1)
    {
        _record = Record(status, nc, nc1);
        var client = await As("ASSESSOR1");
        var r = await client.PostAsJsonAsync(Base + "/requirements/11/conformance", new { conformance = "Yes" });
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync(Base + "/final-submit", new { remarks = "Done" })).StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.StartsWith("SP_ASSESSMENT_DA_UPDATE") || c.Name == "SP_ASSESSMENT_DA_FINAL_SUBMIT");
    }

    [Fact]
    public async Task Nc_round_answered_by_the_msme_is_open_but_only_for_ids_of_that_round()
    {
        _record = Record(status: 4, nc: 1, nc1: 2);
        var client = await As("ASSESSOR1");
        // Requirement 11 is of round 0, so it can no longer be changed.
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync(Base + "/requirements/11/conformance", new { conformance = "Yes" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync(Base + "/site-exterior/validate", new { isVerified = "Yes" })).StatusCode);
    }

    [Fact]
    public async Task Final_submit_uses_the_procedures_nc_decision_and_mails_the_msme_without_a_password()
    {
        var client = await As("ASSESSOR1");
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync(Base + "/final-submit", new { remarks = "" })).StatusCode);

        var r = await client.PostAsJsonAsync(Base + "/final-submit", new { remarks = "All checked", isNcRaised = "0" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var call = DaTestUsers.CallsTo(_host.Sql, "SP_ASSESSMENT_DA_FINAL_SUBMIT").Single();
        Assert.Equal(Zed, FakeSql.Arg(call.Args, "ZedId"));
        Assert.Equal("All checked", FakeSql.Arg(call.Args, "AssessorRemarks"));
        var mail = Assert.Single(_host.Email.Sent);
        Assert.Equal("unit@x.test", mail.To);
        Assert.StartsWith("First Non-conformance(s) raised", mail.Subject);
        Assert.DoesNotContain("Msme#Secret1", mail.HtmlBody);
    }

    [Fact]
    public async Task Final_submit_is_refused_while_the_procedure_reports_missing_checks()
    {
        _host.Sql.Procs["SP_ASSESSMENT_DA_CONFIRM_FINAL_SUBMIT"] = _ => FakeSql.Sets(
            [new { AllowFinalSubmit = 0, ErrorMessage = "You may have missed assessment of one or more products. Please review." }], [new { RaisedForNc = 0 }]);
        var client = await As("ASSESSOR1");
        var r = await client.PostAsJsonAsync(Base + "/final-submit", new { remarks = "Done" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Contains("missed assessment of one or more products", await r.ProblemTitle());
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_ASSESSMENT_DA_FINAL_SUBMIT");
    }

    [Fact]
    public async Task A_second_final_submit_that_waited_for_the_first_is_refused_and_the_procedure_runs_once()
    {
        using var submitting = new ManualResetEventSlim();
        using var release = new ManualResetEventSlim();
        _host.Sql.Procs["SP_ASSESSMENT_DA_FINAL_SUBMIT"] = _ =>
        {
            submitting.Set();
            release.Wait(TimeSpan.FromSeconds(10));
            _record = Record(status: 4, nc: 1, nc1: 1);   // NC 1 raised, waiting for the MSME
            return FakeSql.Sets();
        };
        var reads = 0;
        var records = _host.Sql.Queries[AssessmentRecords.CertificationSql];
        _host.Sql.Queries[AssessmentRecords.CertificationSql] = args =>
        {
            var rows = records(args).ToList();
            Interlocked.Increment(ref reads);
            return rows;
        };
        var client = await As("ASSESSOR1");
        var body = new { remarks = "All checked" };

        var first = Task.Run(() => client.PostAsJsonAsync(Base + "/final-submit", body));
        Assert.True(submitting.Wait(TimeSpan.FromSeconds(10)));
        var before = Volatile.Read(ref reads);
        // The double click: it passes the state check (still status 3) while the first submit runs, and waits for it.
        var second = Task.Run(() => client.PostAsJsonAsync(Base + "/final-submit", body));
        for (var i = 0; i < 400 && Volatile.Read(ref reads) == before; i++) await Task.Delay(25);
        release.Set();

        Assert.Equal(HttpStatusCode.OK, (await first).StatusCode);
        var r = await second;
        Assert.Equal(HttpStatusCode.Conflict, r.StatusCode);
        Assert.Equal(DesktopAssessmentController.AlreadySubmitted, await r.ProblemTitle());
        // One submit: the procedure ran once (no second run in the fresh NC round) and one NC mail went out.
        Assert.Single(DaTestUsers.CallsTo(_host.Sql, "SP_ASSESSMENT_DA_FINAL_SUBMIT"));
        Assert.Single(_host.Email.Sent);
    }

    [Fact]
    public async Task Master_admin_may_only_withdraw_an_exemption_of_a_silver_or_gold_record_under_review()
    {
        var admin = await As("MADMIN");
        // Bronze at status 3: not allowed for the master admin.
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.PostAsJsonAsync(Base + "/sections/41/exemption", new { isAssessmentExcempted = "No" })).StatusCode);

        var assessor = await As("ASSESSOR1");
        Assert.Equal(HttpStatusCode.OK, (await assessor.PostAsJsonAsync(Base + "/sections/41/exemption", new { isAssessmentExcempted = "No" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await assessor.PostAsJsonAsync(Base + "/sections/99/exemption", new { isAssessmentExcempted = "No" })).StatusCode);
        var call = DaTestUsers.CallsTo(_host.Sql, "SP_ASSESSMENT_DA_UPDATE_PARAMETER").Single();
        Assert.Equal("41", FakeSql.Arg(call.Args, "Id"));
    }

    [Fact]
    public async Task Opening_a_document_is_recorded_for_the_assessor_with_its_cookie_identity()
    {
        var client = await As("ASSESSOR1");
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync(Base + "/opened", new { type = "Other", id = 31 })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync(Base + "/opened", new { type = "Evidence", id = 31 })).StatusCode);
        var call = DaTestUsers.CallsTo(_host.Sql, "SP_ASSESSMENT_DA_UPDATE_TIMESTAMP").Single();
        Assert.Equal("ASSESSOR1", FakeSql.Arg(call.Args, "UserId"));
        Assert.Equal("3", FakeSql.Arg(call.Args, "RoleId"));
        Assert.Null(FakeSql.Arg(call.Args, "PhotoType"));
    }

    // ------------------------------------------------------------------ evidence upload

    private static MultipartFormDataContent EvidenceForm(string verified, string? source, string? remarks, params (string Name, byte[] Content)[] files)
    {
        var form = new MultipartFormDataContent { { new StringContent(verified), "IsVerified" } };
        if (source is not null) form.Add(new StringContent(source), "SourceOfValidation");
        if (remarks is not null) form.Add(new StringContent(remarks), "Remarks");
        foreach (var (name, content) in files)
        {
            var part = new ByteArrayContent(content);
            part.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
            form.Add(part, "Files", name);
        }
        return form;
    }

    private static readonly byte[] Pdf = Encoding.ASCII.GetBytes("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF");

    [Fact]
    public async Task Evidence_upload_accepts_only_pdf_and_images_up_to_2_mb()
    {
        var client = await As("ASSESSOR1");
        var url = Base + "/evidences/31/validate";

        var noFile = await client.PostAsync(url, EvidenceForm("Yes", "GST portal", null));
        Assert.Equal(HttpStatusCode.BadRequest, noFile.StatusCode);

        var fake = await client.PostAsync(url, EvidenceForm("Yes", "GST portal", null, ("report.pdf", Encoding.ASCII.GetBytes("MZ this is an exe"))));
        Assert.Equal(HttpStatusCode.BadRequest, fake.StatusCode);

        var wrongName = await client.PostAsync(url, EvidenceForm("Yes", "GST portal", null, ("report.html", Pdf)));
        Assert.Equal(HttpStatusCode.BadRequest, wrongName.StatusCode);

        var big = new byte[EvidenceUploads.MaxFileBytes + 1];
        Pdf.CopyTo(big, 0);
        var tooBig = await client.PostAsync(url, EvidenceForm("Yes", "GST portal", null, ("big.pdf", big)));
        Assert.Equal(HttpStatusCode.BadRequest, tooBig.StatusCode);

        var noSource = await client.PostAsync(url, EvidenceForm("Yes", null, null, ("report.pdf", Pdf)));
        Assert.Equal(HttpStatusCode.BadRequest, noSource.StatusCode);

        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_ASSESSMENT_DA_UPDATE_EVIDENCES");
        Assert.False(Directory.Exists(Path.Combine(_host.StorageRoot, "Uploads")));
    }

    [Fact]
    public async Task Evidence_upload_is_stored_under_a_generated_name_in_the_legacy_folder()
    {
        var client = await As("ASSESSOR1");
        var r = await client.PostAsync(Base + "/evidences/31/validate", EvidenceForm("Yes", "GST portal", null, ("..\\..\\evil.pdf", Pdf)));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);

        var folder = Path.Combine(_host.StorageRoot, "Uploads", "DA", Zed, "Bronze", "1.2.3");
        var file = Assert.Single(Directory.GetFiles(folder));
        Assert.Matches(@"^Screenshot_\d{17}_1\.pdf$", Path.GetFileName(file));
        Assert.Equal(Pdf, await File.ReadAllBytesAsync(file));
        Assert.False(File.Exists(Path.Combine(_host.StorageRoot, "evil.pdf")));

        var call = DaTestUsers.CallsTo(_host.Sql, "SP_ASSESSMENT_DA_UPDATE_EVIDENCES").Single();
        Assert.Equal("31", FakeSql.Arg(call.Args, "Id"));
        Assert.Equal(Zed, FakeSql.Arg(call.Args, "ZedId"));
        Assert.Equal("Yes", FakeSql.Arg(call.Args, "IsVerified"));
        Assert.Equal("GST portal", FakeSql.Arg(call.Args, "SourceOfValidation"));

        // The stored screenshot is served to users who may see the record, and only to them.
        var path = "/files/Uploads/DA/ZEDMSME000001/Bronze/1.2.3/" + Path.GetFileName(file);
        var get = await client.GetAsync(Base + path);
        Assert.Equal(HttpStatusCode.OK, get.StatusCode);
        Assert.Equal("nosniff", get.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Equal(HttpStatusCode.NotFound, (await (await As("ASSESSOR2")).GetAsync(Base + path)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await (await As("AGENCY1")).GetAsync(Base + path)).StatusCode);
    }

    [Fact]
    public async Task Evidence_upload_of_an_evidence_of_another_record_is_refused()
    {
        var client = await As("ASSESSOR1");
        var r = await client.PostAsync(Base + "/evidences/99/validate", EvidenceForm("Yes", "GST portal", null, ("report.pdf", Pdf)));
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
        Assert.False(Directory.Exists(Path.Combine(_host.StorageRoot, "Uploads")));
    }

    [Theory]
    [InlineData("/files/mobileapi/Photos/ZEDMSME000002/Bronze/Evidences/1.pdf")]   // another MSME's folder
    [InlineData("/files/mobileapi/Photos/ZEDMSME000001/Silver/Evidences/1.pdf")]   // another certification
    [InlineData("/files/Uploads/Documents/ZEDMSME000001/Bronze/x/a.pdf")]          // not an assessment folder
    [InlineData("/files/mobileapi/Photos/ZEDMSME000001/Bronze/..%2F..%2F..%2Fweb.config")]
    [InlineData("/files/mobileapi/Photos/ZEDMSME000001/Bronze/Evidences/1.exe")]
    public async Task File_requests_outside_the_records_folders_are_not_found(string path)
    {
        var client = await As("ASSESSOR1");
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(Base + path)).StatusCode);
    }

    [Fact]
    public async Task Moved_photos_are_found_in_the_certified_folder()
    {
        var dir = Path.Combine(_host.StorageRoot, "mobileapi", "CertifiedPhotos", Zed, "Bronze", "Evidences");
        Directory.CreateDirectory(dir);
        await File.WriteAllBytesAsync(Path.Combine(dir, "5551.pdf"), Pdf);
        var client = await As("ASSESSOR1");
        var r = await client.GetAsync(Base + "/files/mobileapi/Photos/ZEDMSME000001/Bronze/Evidences/5551.pdf");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("application/pdf", r.Content.Headers.ContentType?.MediaType);
    }
}
