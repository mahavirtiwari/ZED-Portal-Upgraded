using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Zed.Portal.Features.Incentives;
using Zed.Portal.Features.Incentives.Agencies;
using Zed.Portal.Features.Incentives.Staff;
using Zed.Portal.Features.Staff.Schemes;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>2026-11-20 (approved design): the staff verification of incentive scheme applications (Part C).</summary>
public sealed class SchemeVerificationTests : IDisposable
{
    private const string Zed = "ZEDMSME000020";
    private const string Code = "TESTSCH";
    private readonly TestHost _host = new();

    /// <summary>The application (dbo.FinancialAssistance row with SchemeCode); the save statement changes it.</summary>
    private readonly Dictionary<string, object?> _app;
    private long? _lastRoundRobinAgencyId;
    private readonly List<Dictionary<string, object?>> _overdue = [];
    private readonly List<Dictionary<string, object?>> _inProgress = [];
    private readonly List<object> _heldCertificates = [];
    private readonly List<object> _unitCertificates = [];
    private bool _autoAllot = true;

    private static readonly SchemeDefinition BaseDefinition = new()
    {
        Code = Code, Name = "Test Scheme", Active = true,
        Card = new() { Title = "Test Scheme" },
        Activation = new() { Mode = SchemeRules.Levels, Levels = ["Bronze"] },
        Grading = new() { Mode = SchemeRules.ByLevel, Rows = [new("Bronze", 75, 50000)] },
        Form = new()
        {
            Sections =
            [
                new()
                {
                    Key = "items", Title = "Items", Repeating = true, MinItems = 1, MaxItems = 5,
                    Fields =
                    [
                        new() { Key = "invoice_no", Label = "Invoice No", Type = "text", AssessorChecks = true },
                        new() { Key = "amount", Label = "Amount", Type = "amount", IsClaim = true, AssessorChecks = true },
                        new() { Key = "note", Label = "Note", Type = "text", Required = false },
                        new() { Key = "invoice", Label = "Invoice", Type = "document", MaxFiles = 2 },
                    ],
                },
            ],
        },
        Verification = new() { Flow = SchemeRules.Desktop, CorrectionRounds = 2, CorrectionDays = 30, AutoAllot = true },
    };

    private static string Answers(decimal a1, decimal a2) => new FormAnswers
    {
        Sections = new()
        {
            ["items"] =
            [
                new FormItem { Saved = true, Values = new() { ["invoice_no"] = "INV-1", ["amount"] = a1.ToString(System.Globalization.CultureInfo.InvariantCulture), ["invoice"] = "[\"20261120101010000aabbccdd.pdf\"]" } },
                new FormItem { Saved = true, Values = new() { ["invoice_no"] = "INV-2", ["amount"] = a2.ToString(System.Globalization.CultureInfo.InvariantCulture), ["invoice"] = "[\"20261120101010000aabbcc01.jpg\"]" } },
            ],
        },
    }.Serialize();

    private SchemeDefinition Definition => BaseDefinition with { Verification = BaseDefinition.Verification with { AutoAllot = _autoAllot } };

    private const string AccountPath = "_bank/0/account";

    // The bank block is on (the default): the account details are checked too (2026-11-20, the product owner).
    private static readonly string[] AllPaths =
        ["items/0/invoice_no", "items/0/amount", "items/0/invoice", "items/1/invoice_no", "items/1/amount", "items/1/invoice", AccountPath];

    public SchemeVerificationTests()
    {
        SchemesTestUsers.Register(_host);
        _app = new()
        {
            ["Id"] = 900, ["ZedId"] = Zed, ["SchemeCode"] = Code, ["SchemeLevel"] = "Bronze", ["SchemeCertNo"] = "B-1", ["SchemeStatus"] = "Submitted",
            ["VerificationStatus"] = 1, ["FormAnswers"] = Answers(40000, 30000), ["FormChecks"] = null, ["ClaimAmount"] = 70000m, ["SharePercent"] = 75m,
            ["MaxAmount"] = 50000m, ["EligibleAmount"] = null, ["ApprovedAmount"] = null, ["CorrectionRound"] = 0, ["CorrectionDueOn"] = null,
            ["SubmittedOn"] = new DateTime(2026, 11, 18), ["DecidedOn"] = null, ["HoldReason"] = null, ["CertificationBodyUserId"] = null,
            ["FinancialAssessorId"] = null, ["AssessorAcceptedOn"] = null, ["ReasonForRejection"] = null, ["ReasonForRejectionAgency"] = null,
            ["AccountNo"] = "123456789012", ["IfscCode"] = "SBIN0001234", ["BranchAddress"] = "Kanpur", ["BankName"] = "SBI",
            ["CreatedDate"] = new DateTime(2026, 11, 17), ["AllotmentType"] = null, ["AllotmentDate"] = null, ["RejectedAgencies"] = null,
        };
        var q = _host.Sql.Queries;
        q[SchemeApplications.ByIdWithOnsiteSql] = args => FakeSql.Arg(args, "Id") == "900" ? [new Dictionary<string, object?>(_app)] : [];
        q[SchemeStore.AllSql] = _ => [new { Id = 1L, SchemeCode = Code, SchemeJson = SchemeRules.Serialize(Definition), Active = true, OrderNo = (int?)1 }];
        _host.Sql.Procs[SchemeCases.SaveSql] = args =>
        {
            if (FakeSql.Arg(args, "Expected") != (_app["SchemeStatus"]?.ToString() ?? "Draft")) return FakeSql.Sets();
            foreach (var p in args!.GetType().GetProperties())
            {
                var name = p.Name switch { "Expected" or "Id" => null, _ => p.Name };
                if (name is not null) _app[name] = p.GetValue(args);
            }
            return FakeSql.Sets();
        };
        q[SchemeCases.UnitSql] = _ => [new { EnterpriseName = "Acme Castings", EmailId = "msme@acme.test", PUnitName = "Acme", PAddress = "Plot 4", PCity = "Kanpur", PStateName = "UTTAR PRADESH" }];
        // AGENCY1 and AGENCY2 are desktop verification agencies (migration 0107); AGENCYNOFV is an assessment agency.
        q[SchemeCases.UserSql] = args => FakeSql.Arg(args, "UserId") is { } id
            ? [new { UserId = id, UserName = id + " name", Email = id.ToLowerInvariant() + "@x.test", RoleId = id.StartsWith("DA") ? 3 : 2, IsActive = true,
                CreatedBy = id.StartsWith("DA") ? "AGENCY1" : "MADMIN", SchemeVerification = id is "AGENCY1" or "AGENCYNOFV" ? Code + ":D" : null,
                AgencyKind = id is "AGENCY1" or "AGENCY2" ? IncentiveAgencies.DesktopKind : null }]
            : [];
        // 2026-11-27: the sign-in's kind (IncentiveKind on the agency and assessor controllers): AGENCY1, AGENCY2 and AGENCY6 are desktop
        // verification agencies, the DA* assessors are AGENCY1's; AGENCYNOFV is an assessment agency.
        q[IncentiveAgencies.KindOfSql] = args => FakeSql.Arg(args, "UserId") is { } who
            ? [new { RoleId = who.StartsWith("DA") ? 3 : 2, AgencyKind = who is "AGENCY1" or "AGENCY2" or "AGENCY6" ? IncentiveAgencies.DesktopKind : null,
                CreatorKind = who.StartsWith("DA") ? IncentiveAgencies.DesktopKind : null }]
            : [];

        // Desktop verification agencies (the query itself keeps to AgencyKind = 'SchemeDesktop'): AGENCY1 (the whole of UP), AGENCY2 (two
        // districts of UP, the unit's among them) and AGENCY6 (the whole of UP) are eligible; the others are not: AGENCYX (not ticked),
        // AGENCY3 (Maharashtra), AGENCY4 (another district of UP), AGENCY5 (ticked onsite only), AGENCY7 (no state chosen).
        q[SchemeAllotment.CandidatesSql] = _ =>
        [
            new { Id = 10L, UserId = "AGENCY1", UserName = "Agency One", SchemeVerification = $"{Code}:D" },
            new { Id = 15L, UserId = "AGENCYX", UserName = "Not ticked", SchemeVerification = "OTHER:D" },
            new { Id = 20L, UserId = "AGENCY2", UserName = "Agency Two", SchemeVerification = $"OTHER:O,{Code.ToLowerInvariant()}:d" },
            new { Id = 30L, UserId = "AGENCY3", UserName = "Other state", SchemeVerification = $"{Code}:D" },
            new { Id = 40L, UserId = "AGENCY4", UserName = "Other district", SchemeVerification = $"{Code}:D" },
            new { Id = 5L, UserId = "AGENCY5", UserName = "Onsite only", SchemeVerification = $"{Code}:O" },
            new { Id = 60L, UserId = "AGENCY6", UserName = "Agency Six", SchemeVerification = $"{Code}:D" },
            new { Id = 70L, UserId = "AGENCY7", UserName = "No state", SchemeVerification = $"{Code}:D" },
        ];
        q[IncentiveAgencies.UnitPlaceSql] = _ => [new { PStateName = "Uttar Pradesh", PDistrictName = "KANPUR NAGAR", PLgDistrictCode = "164" }];
        q[IncentiveAgencies.StatesSql] = _ =>
        [
            new { UserId = "AGENCY1", States = "UTTAR PRADESH", Districts = (string?)null },
            new { UserId = "AGENCY2", States = "UTTAR PRADESH", Districts = (string?)"163,164" },
            new { UserId = "AGENCY3", States = "MAHARASHTRA", Districts = (string?)null },
            new { UserId = "AGENCY4", States = "UTTAR PRADESH", Districts = (string?)"999" },
            new { UserId = "AGENCY5", States = "UTTAR PRADESH", Districts = (string?)null },
            new { UserId = "AGENCY6", States = "UTTAR PRADESH", Districts = (string?)null },
        ];
        q[SchemeAllotment.LastSql] = _ => _lastRoundRobinAgencyId is { } id ? [new { Id = id }] : [];

        q[SchemeAgencyController.AssessorsSql] = args => FakeSql.Arg(args, "Agency") != "AGENCY1" ? [] :
        [
            new { Id = 1L, UserId = "DA1", UserName = "Assessor One", SchemeVerification = $"{Code}:D", CreatedBy = "AGENCY1" },
            new { Id = 2L, UserId = "DA9", UserName = "Other scheme", SchemeVerification = "OTHER:D", CreatedBy = "AGENCY1" },
        ];
        q[SchemeSweep.OverdueSql] = _ => _overdue;
        q[SchemeSweep.InProgressSql] = _ => _inProgress;
        q[SchemeSweep.HeldCertificatesSql] = _ => _heldCertificates;
        q[SchemeSweep.UnitCertificatesSql] = _ => _unitCertificates;
    }

    public void Dispose() => _host.Dispose();

    private Task<HttpClient> SignIn(string user) => SchemesTestUsers.SignInAsync(_host, user);

    private void At(string status, string? agency = null, string? assessor = null, bool accepted = false)
    {
        _app["SchemeStatus"] = status;
        _app["VerificationStatus"] = SchemeApplications.VerificationStatus(status);
        _app["CertificationBodyUserId"] = agency;
        _app["FinancialAssessorId"] = assessor;
        _app["AssessorAcceptedOn"] = accepted ? DateTime.Now : null;
    }

    private string Status => _app["SchemeStatus"]?.ToString() ?? "";

    private int Saves => _host.Sql.Calls.Count(c => c.Name == SchemeCases.SaveSql);

    private IEnumerable<string> History => _host.Sql.Calls.Where(c => c.Name.StartsWith("INSERT INTO MsmeHistory")).Select(c => FakeSql.Arg(c.Args, "Descrip") ?? "");

    private async Task<string?> AllotAsync()
    {
        using var scope = _host.Services.CreateScope();
        return await SchemeServices.Get<SchemeAllotment>(scope.ServiceProvider).AutoAllotAsync(900, CancellationToken.None);
    }

    private Dictionary<string, FieldCheck> Checks => FieldCheck.Parse(_app["FormChecks"] as string);

    private static object CheckAll(string status = "Yes", params string[] notValid) => new
    {
        checks = AllPaths.Select(p => new { path = p, status = notValid.Contains(p) ? "No" : status, remarks = notValid.Contains(p) ? "Invoice amount does not match" : null }).ToArray(),
    };

    // ----- round robin -----

    [Fact]
    public async Task Round_robin_takes_the_desktop_agencies_of_the_units_state_and_district_in_turn()
    {
        // Only desktop verification agencies (never an assessment agency or an onsite agency), by state and district, no sector rule.
        Assert.Contains("AgencyKind = 'SchemeDesktop'", SchemeAllotment.CandidatesSql);
        Assert.DoesNotContain("UserNicSectors", SchemeAllotment.CandidatesSql);
        Assert.Equal("AGENCY1", await AllotAsync());
        Assert.Equal(("WithAgency", 1, "RoundRobin"), (Status, (int)_app["VerificationStatus"]!, _app["AllotmentType"]));
        Assert.Equal("agency1@x.test", Assert.Single(_host.Email.Sent).To);

        // After the last round-robin agency (AGENCY1, Id 10) comes AGENCY2 (Id 20, its districts list the unit's; AGENCYX is not ticked).
        At("Submitted");
        _lastRoundRobinAgencyId = 10;
        Assert.Equal("AGENCY2", await AllotAsync());

        // After AGENCY2 the next eligible one is AGENCY6: AGENCY3 is of another state, AGENCY4 of another district (AGENCY5 is onsite only).
        At("Submitted");
        _lastRoundRobinAgencyId = 20;
        Assert.Equal("AGENCY6", await AllotAsync());

        // After the last one it wraps to the first.
        At("Submitted");
        _lastRoundRobinAgencyId = 60;
        Assert.Equal("AGENCY1", await AllotAsync());
    }

    [Fact]
    public async Task Round_robin_skips_agencies_that_returned_the_application_and_waits_when_none_is_left()
    {
        _app["RejectedAgencies"] = "AGENCY1";
        Assert.Equal("AGENCY2", await AllotAsync());

        At("Submitted");
        _app["RejectedAgencies"] = "AGENCY1,AGENCY2,AGENCY6";
        Assert.Null(await AllotAsync());
        Assert.Equal("Submitted", Status);
        Assert.Null(_app["CertificationBodyUserId"]);

        // Only a Submitted application without an agency is allotted.
        At("WithAgency", agency: "AGENCY1");
        Assert.Null(await AllotAsync());
    }

    [Fact]
    public async Task After_submit_the_unit_is_mailed_and_the_application_allotted()
    {
        using (var scope = _host.Services.CreateScope())
            await SchemeServices.Get<SchemeWorkflow>(scope.ServiceProvider).AfterSubmitAsync(900, CancellationToken.None);
        Assert.Equal("WithAgency", Status);
        Assert.Equal("AGENCY1", _app["CertificationBodyUserId"]);
        var mails = _host.Email.Sent.ToList();
        Assert.Contains(mails, m => m.To == "msme@acme.test" && m.Subject.Contains("Test Scheme"));
        Assert.Contains(mails, m => m.To == "agency1@x.test");
        Assert.Contains(History, h => h.Contains("submitted"));
    }

    // ----- Master Admin -----

    [Fact]
    public async Task Master_admin_lists_with_counts_and_allots_an_eligible_agency()
    {
        _host.Sql.Queries[SchemeReview.ListAllSql] = _ =>
        [
            new { Id = 900, ZedId = Zed, SchemeCode = Code, SchemeLevel = "Bronze", SchemeStatus = "Submitted", VerificationStatus = 1, EnterpriseName = "Acme", PStateName = "UTTAR PRADESH", SubmittedOn = new DateTime(2026, 11, 18) },
            new { Id = 901, ZedId = "ZEDMSME000021", SchemeCode = Code, SchemeLevel = "Bronze", SchemeStatus = "Approved", VerificationStatus = 6, EnterpriseName = "Beta", PStateName = "GOA", SubmittedOn = new DateTime(2026, 10, 1) },
            new { Id = 902, ZedId = "ZEDMSME000022", SchemeCode = Code, SchemeLevel = "Bronze", SchemeStatus = "Verifying", VerificationStatus = 2, EnterpriseName = "Gamma", PStateName = "UTTAR PRADESH", SubmittedOn = new DateTime(2026, 11, 1) },
        ];
        var admin = await SignIn("MADMIN");
        var list = await admin.GetFromJsonAsync<JsonElement>("/api/staff/scheme-applications?state=UTTAR%20PRADESH");
        Assert.Equal(2, list.GetProperty("rows").GetArrayLength());
        Assert.Equal(1, list.GetProperty("counts").GetProperty("Submitted").GetInt32());
        Assert.Equal(0, list.GetProperty("counts").GetProperty("Paid").GetInt32());
        Assert.Equal("Test Scheme", list.GetProperty("rows")[0].GetProperty("schemeName").GetString());
        list = await admin.GetFromJsonAsync<JsonElement>("/api/staff/scheme-applications?status=Paid");
        Assert.Equal(901, list.GetProperty("rows")[0].GetProperty("id").GetInt32());
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.GetAsync("/api/staff/scheme-applications?status=Nope")).StatusCode);

        var options = await admin.GetFromJsonAsync<JsonElement>("/api/staff/scheme-applications/900/agencies");
        Assert.Equal(["AGENCY1", "AGENCY2", "AGENCY6"], options.EnumerateArray().Select(o => o.GetProperty("userId").GetString()!).ToArray());

        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/staff/scheme-applications/900/allot", new { agencyUserId = "AGENCY3" })).StatusCode);
        (await admin.PostAsJsonAsync("/api/staff/scheme-applications/900/allot", new { agencyUserId = "AGENCY6" })).EnsureSuccessStatusCode();
        Assert.Equal(("WithAgency", "AGENCY6", "Manual"), (Status, _app["CertificationBodyUserId"], _app["AllotmentType"]));

        // Re-allot while the agency has not named an assessor; not once it is with the assessor.
        (await admin.PostAsJsonAsync("/api/staff/scheme-applications/900/allot", new { agencyUserId = "AGENCY2" })).EnsureSuccessStatusCode();
        Assert.Equal("AGENCY2", _app["CertificationBodyUserId"]);
        At("WithAssessor", "AGENCY2", "DA1");
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/staff/scheme-applications/900/allot", new { agencyUserId = "AGENCY1" })).StatusCode);
    }

    [Fact]
    public async Task Detail_shows_answers_documents_totals_and_serves_only_the_applications_files()
    {
        At("Verifying", "AGENCY1", "DA1", accepted: true);
        var path = Path.Combine(_host.StorageRoot, "mobileapi", "Photos", Zed, "Schemes", "20261120101010000aabbccdd.pdf");
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await File.WriteAllBytesAsync(path, "%PDF-1.4\n"u8.ToArray());
        await File.WriteAllBytesAsync(Path.Combine(Path.GetDirectoryName(path)!, "20261120101010000aabbcc99.pdf"), "%PDF-1.4\n"u8.ToArray());

        var admin = await SignIn("MADMIN");
        var d = await admin.GetFromJsonAsync<JsonElement>("/api/staff/scheme-applications/900");
        Assert.Equal("Test Scheme", d.GetProperty("application").GetProperty("schemeName").GetString());
        var items = d.GetProperty("sections")[0].GetProperty("items");
        Assert.Equal(2, items.GetArrayLength());
        var invoice = items[0].GetProperty("fields").EnumerateArray().First(f => f.GetProperty("key").GetString() == "invoice");
        Assert.Equal("items/0/invoice", invoice.GetProperty("path").GetString());
        var url = invoice.GetProperty("files")[0].GetProperty("url").GetString()!;
        Assert.Equal(70000m, d.GetProperty("totals").GetProperty("claimed").GetDecimal());
        Assert.Equal(50000m, d.GetProperty("totals").GetProperty("eligible").GetDecimal());
        // A field without checks has no path.
        Assert.Equal(JsonValueKind.Null, items[0].GetProperty("fields").EnumerateArray().First(f => f.GetProperty("key").GetString() == "note").GetProperty("path").ValueKind);

        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync(url)).StatusCode);
        // A file of the unit's folder that the application does not list is not served.
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync("/api/staff/scheme-applications/900/files/20261120101010000aabbcc99.pdf")).StatusCode);

        // The assessor of another application, and another agency, do not see it.
        Assert.Equal(HttpStatusCode.NotFound, (await (await SignIn("DA2")).GetAsync("/api/staff/scheme-verification/assessor/900")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await (await SignIn("AGENCY2")).GetAsync("/api/staff/scheme-verification/agency/900")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await (await SignIn("DA1")).GetAsync("/api/staff/scheme-verification/assessor/900/files/20261120101010000aabbccdd.pdf")).StatusCode);
    }

    // ----- agency -----

    [Fact]
    public async Task Agency_rejection_with_an_auto_reason_reallots_by_round_robin()
    {
        At("WithAgency", agency: "AGENCY1");
        var agency = await SignIn("AGENCY1");
        Assert.Equal(HttpStatusCode.BadRequest, (await agency.PostAsJsonAsync("/api/staff/scheme-verification/agency/900/reject", new { reasonId = "nope" })).StatusCode);
        var r = await agency.PostAsJsonAsync("/api/staff/scheme-verification/agency/900/reject", new { reasonId = "conflict", remarks = "Our consultant advised them" });
        r.EnsureSuccessStatusCode();
        Assert.Contains("another agency", (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("message").GetString());
        Assert.Equal(("WithAgency", "AGENCY2", "RoundRobin"), (Status, _app["CertificationBodyUserId"], _app["AllotmentType"]));
        Assert.Equal("AGENCY1", _app["RejectedAgencies"]);
        Assert.Contains("Conflict of interest", _app["ReasonForRejectionAgency"]?.ToString());
        // AGENCY1 no longer has it.
        Assert.Equal(HttpStatusCode.NotFound, (await agency.GetAsync("/api/staff/scheme-verification/agency/900")).StatusCode);
    }

    [Fact]
    public async Task Agency_rejection_with_an_auto_reason_goes_to_the_master_admin_when_auto_allot_is_off()
    {
        _autoAllot = false;
        At("WithAgency", agency: "AGENCY1");
        var r = await (await SignIn("AGENCY1")).PostAsJsonAsync("/api/staff/scheme-verification/agency/900/reject", new { reasonId = "conflict" });
        r.EnsureSuccessStatusCode();
        Assert.Contains("ZED team", (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("message").GetString());
        Assert.Equal(("Submitted", (object?)null, (object?)"AGENCY1"), (Status, _app["CertificationBodyUserId"], _app["RejectedAgencies"]));
        Assert.Contains(_host.Email.Sent, m => m.Subject.StartsWith("Application waiting for allotment (Desktop verification)")
            && m.HtmlBody.Contains("Automatic allotment is off"));
    }

    [Fact]
    public async Task Agency_rejection_with_a_master_admin_reason_returns_it_to_the_master_admin()
    {
        At("WithAgency", agency: "AGENCY1");
        var agency = await SignIn("AGENCY1");
        var r = await agency.PostAsJsonAsync("/api/staff/scheme-verification/agency/900/reject", new { reasonId = "other" });
        r.EnsureSuccessStatusCode();
        Assert.Contains("ZED team", (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("message").GetString());
        Assert.Equal("Submitted", Status);
        Assert.Null(_app["CertificationBodyUserId"]);
        Assert.Equal("AGENCY1", _app["RejectedAgencies"]);
        // The ZED team inbox is told it waits for the Master Admin's allotment (its own Incentive mail).
        Assert.Contains(_host.Email.Sent, m => m.Subject.StartsWith("Application waiting for allotment (Desktop verification)") && m.HtmlBody.Contains("Rejected by agency AGENCY1"));
    }

    [Fact]
    public async Task Agency_accepts_with_one_of_its_assessors_ticked_for_the_scheme()
    {
        At("WithAgency", agency: "AGENCY1");
        var agency = await SignIn("AGENCY1");
        var options = await agency.GetFromJsonAsync<JsonElement>("/api/staff/scheme-verification/agency/900/assessors");
        Assert.Equal("DA1", Assert.Single(options.EnumerateArray()).GetProperty("userId").GetString());
        Assert.Equal(HttpStatusCode.BadRequest, (await agency.PostAsJsonAsync("/api/staff/scheme-verification/agency/900/accept", new { assessorUserId = "DA9" })).StatusCode);
        (await agency.PostAsJsonAsync("/api/staff/scheme-verification/agency/900/accept", new { assessorUserId = "DA1" })).EnsureSuccessStatusCode();
        Assert.Equal(("WithAssessor", "DA1", 2), (Status, _app["FinancialAssessorId"], (int)_app["VerificationStatus"]!));
        Assert.Contains(_host.Email.Sent, m => m.To == "da1@x.test");
        // Twice: already processed.
        Assert.Equal(HttpStatusCode.BadRequest, (await agency.PostAsJsonAsync("/api/staff/scheme-verification/agency/900/accept", new { assessorUserId = "DA1" })).StatusCode);
    }

    // ----- assessor -----

    [Fact]
    public async Task Assessor_checks_and_sends_for_correction_with_a_due_date_while_rounds_are_left()
    {
        At("WithAssessor", "AGENCY1", "DA1");
        var da = await SignIn("DA1");
        // Not before accepting.
        Assert.Equal(HttpStatusCode.BadRequest, (await da.PutAsJsonAsync("/api/staff/scheme-verification/assessor/900/checks", CheckAll())).StatusCode);
        (await da.PostAsJsonAsync("/api/staff/scheme-verification/assessor/900/accept", new { })).EnsureSuccessStatusCode();
        Assert.Equal("Verifying", Status);
        Assert.NotNull(_app["AssessorAcceptedOn"]);

        Assert.Equal(HttpStatusCode.BadRequest, (await da.PutAsJsonAsync("/api/staff/scheme-verification/assessor/900/checks",
            new { checks = new[] { new { path = "items/0/note", status = "Yes", remarks = (string?)null } } })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await da.PutAsJsonAsync("/api/staff/scheme-verification/assessor/900/checks",
            new { checks = new[] { new { path = "items/1/amount", status = "No", remarks = (string?)null } } })).StatusCode);

        (await da.PutAsJsonAsync("/api/staff/scheme-verification/assessor/900/checks", CheckAll())).EnsureSuccessStatusCode();
        // Correction needs at least one Not valid.
        Assert.Equal(HttpStatusCode.BadRequest, (await da.PostAsJsonAsync("/api/staff/scheme-verification/assessor/900/decision", new { decision = "correction" })).StatusCode);

        (await da.PutAsJsonAsync("/api/staff/scheme-verification/assessor/900/checks",
            new { checks = new[] { new { path = "items/1/amount", status = "No", remarks = "Invoice amount does not match" } } })).EnsureSuccessStatusCode();
        Assert.Equal(("Yes", "No"), (Checks["items/0/amount"].Status, Checks["items/1/amount"].Status));
        var detail = await da.GetFromJsonAsync<JsonElement>("/api/staff/scheme-verification/assessor/900");
        Assert.Equal(40000m, detail.GetProperty("totals").GetProperty("verified").GetDecimal());
        Assert.True(detail.GetProperty("actions").GetProperty("correction").GetBoolean());
        Assert.False(detail.GetProperty("actions").GetProperty("recommend").GetBoolean());

        (await da.PostAsJsonAsync("/api/staff/scheme-verification/assessor/900/decision", new { decision = "correction" })).EnsureSuccessStatusCode();
        Assert.Equal(("Correction", 1, DateTime.Today.AddDays(30)), (Status, (int)_app["CorrectionRound"]!, (DateTime)_app["CorrectionDueOn"]!));
        var mail = Assert.Single(_host.Email.Sent, m => m.To == "msme@acme.test");
        Assert.Contains("Invoice amount does not match", mail.HtmlBody);
        Assert.Contains("round 1 of 2", mail.HtmlBody);

    }

    [Fact]
    public async Task Correction_with_no_round_left_rejects_the_application_automatically()
    {
        // The unit answered the last round (2 of 2) and an amount is still not valid.
        _app["CorrectionRound"] = 2;
        _app["FormChecks"] = FieldCheck.Serialize(AllPaths.ToDictionary(p => p,
            p => p == "items/1/amount" ? new FieldCheck("No", "Invoice amount does not match", 2, "DA1", DateTime.Now) : new FieldCheck("Yes", null, 2, "DA1", DateTime.Now)));
        At("Verifying", "AGENCY1", "DA1", accepted: true);
        var da = await SignIn("DA1");
        // The page is told before the click that Correction now rejects.
        var actions = (await da.GetFromJsonAsync<JsonElement>("/api/staff/scheme-verification/assessor/900")).GetProperty("actions");
        Assert.True(actions.GetProperty("correction").GetBoolean());
        Assert.True(actions.GetProperty("correctionRejects").GetBoolean());
        Assert.Equal(0, actions.GetProperty("roundsLeft").GetInt32());

        var r = await da.PostAsJsonAsync("/api/staff/scheme-verification/assessor/900/decision", new { decision = "correction" });
        r.EnsureSuccessStatusCode();
        Assert.Contains("rejected", (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("message").GetString());
        Assert.Equal(("Rejected", 5, 2), (Status, (int)_app["VerificationStatus"]!, (int)_app["CorrectionRound"]!));
        var reason = _app["ReasonForRejection"]?.ToString() ?? "";
        Assert.StartsWith(SchemeAssessorController.LastRoundReason, reason);
        Assert.Contains("Amount: Invoice amount does not match", reason);
        Assert.NotNull(_app["DecidedOn"]);
        // The unit gets the rejected mail (it may apply again).
        var mail = Assert.Single(_host.Email.Sent, m => m.To == "msme@acme.test");
        Assert.Contains(SchemeAssessorController.LastRoundReason, mail.HtmlBody);
        Assert.Contains(History, h => h.Contains("rejected automatically"));
    }

    [Fact]
    public async Task Bank_account_details_are_checkable_when_the_bank_block_is_on()
    {
        var answers = FormAnswers.Parse(Answers(1, 2));
        Assert.Contains(AccountPath, SchemeReview.CheckablesOf(Definition, answers).Select(c => c.Path));
        var noBank = Definition with { Form = Definition.Form with { Blocks = new SchemeBlocks { BankAccount = false } } };
        Assert.DoesNotContain(AccountPath, SchemeReview.CheckablesOf(noBank, answers).Select(c => c.Path));

        At("Verifying", "AGENCY1", "DA1", accepted: true);
        var da = await SignIn("DA1");
        var d = await da.GetFromJsonAsync<JsonElement>("/api/staff/scheme-verification/assessor/900");
        var bank = d.GetProperty("sections").EnumerateArray().Single(s => s.GetProperty("key").GetString() == "_bank");
        var account = bank.GetProperty("items")[0].GetProperty("fields")[0];
        Assert.Equal((AccountPath, "123456789012, SBIN0001234, SBI, Kanpur"), (account.GetProperty("path").GetString(), account.GetProperty("value").GetString()));

        // Not valid with a remark: the unit corrects it in the next round.
        Assert.Equal(HttpStatusCode.BadRequest, (await da.PutAsJsonAsync("/api/staff/scheme-verification/assessor/900/checks",
            new { checks = new[] { new { path = AccountPath, status = "No", remarks = (string?)null } } })).StatusCode);
        (await da.PutAsJsonAsync("/api/staff/scheme-verification/assessor/900/checks",
            new { checks = new[] { new { path = AccountPath, status = "No", remarks = (string?)"IFSC does not match the cheque" } } })).EnsureSuccessStatusCode();
        Assert.Equal(("No", "IFSC does not match the cheque"), (Checks[AccountPath].Status, Checks[AccountPath].Remarks));
        (await da.PostAsJsonAsync("/api/staff/scheme-verification/assessor/900/decision", new { decision = "correction" })).EnsureSuccessStatusCode();
        Assert.Equal("Correction", Status);
        Assert.Contains("IFSC does not match the cheque", Assert.Single(_host.Email.Sent, m => m.To == "msme@acme.test").HtmlBody);
    }

    [Fact]
    public async Task Assessor_rejects_with_a_reason_and_the_unit_is_told()
    {
        At("Verifying", "AGENCY1", "DA1", accepted: true);
        var da = await SignIn("DA1");
        Assert.Equal(HttpStatusCode.BadRequest, (await da.PostAsJsonAsync("/api/staff/scheme-verification/assessor/900/decision", new { decision = "reject" })).StatusCode);
        (await da.PostAsJsonAsync("/api/staff/scheme-verification/assessor/900/decision", new { decision = "reject", reason = "Invoices are not genuine" })).EnsureSuccessStatusCode();
        Assert.Equal(("Rejected", 5, "Invoices are not genuine"), (Status, (int)_app["VerificationStatus"]!, _app["ReasonForRejection"]));
        Assert.NotNull(_app["DecidedOn"]);
        Assert.Contains("Invoices are not genuine", Assert.Single(_host.Email.Sent).HtmlBody);
    }

    [Theory]
    [InlineData(40000, 30000, "50000.00")] // 75% of 70,000 = 52,500, capped at 50,000
    [InlineData(20000, 10000.50, "22500.00")] // 75% of 30,000 (whole rupees)
    public async Task Recommend_needs_every_check_valid_and_computes_the_eligible_amount(decimal a1, decimal a2, string eligible)
    {
        _app["FormAnswers"] = Answers(a1, a2);
        At("Verifying", "AGENCY1", "DA1", accepted: true);
        var da = await SignIn("DA1");
        (await da.PutAsJsonAsync("/api/staff/scheme-verification/assessor/900/checks", new { checks = new[] { new { path = "items/0/amount", status = "Yes", remarks = (string?)null } } })).EnsureSuccessStatusCode();
        var r = await da.PostAsJsonAsync("/api/staff/scheme-verification/assessor/900/decision", new { decision = "recommend" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Contains("6 left", await r.ProblemTitle());

        (await da.PutAsJsonAsync("/api/staff/scheme-verification/assessor/900/checks", CheckAll())).EnsureSuccessStatusCode();
        (await da.PostAsJsonAsync("/api/staff/scheme-verification/assessor/900/decision", new { decision = "recommend" })).EnsureSuccessStatusCode();
        Assert.Equal(("Qc", 3, eligible), (Status, (int)_app["VerificationStatus"]!, _app["EligibleAmount"]));
    }

    [Fact]
    public async Task Agency_qc_approves_up_to_the_eligible_amount_or_sends_it_back()
    {
        _app["FormChecks"] = FieldCheck.Serialize(AllPaths.ToDictionary(p => p, _ => new FieldCheck("Yes", null, 0, "DA1", DateTime.Now)));
        At("Qc", "AGENCY1", "DA1", accepted: true);
        var agency = await SignIn("AGENCY1");
        var r = await agency.PostAsJsonAsync("/api/staff/scheme-verification/agency/900/approve", new { amount = 50000.01m });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Contains("50000.00", await r.ProblemTitle());

        (await agency.PostAsJsonAsync("/api/staff/scheme-verification/agency/900/back", new { remarks = "Check the second invoice" })).EnsureSuccessStatusCode();
        Assert.Equal("Verifying", Status);
        Assert.Contains("Check the second invoice", _app["ReasonForRejectionAgency"]?.ToString());
        Assert.Contains(_host.Email.Sent, m => m.To == "da1@x.test" && m.Subject.StartsWith("Sent back from QC") && m.HtmlBody.Contains("Check the second invoice"));

        At("Qc", "AGENCY1", "DA1", accepted: true);
        (await agency.PostAsJsonAsync("/api/staff/scheme-verification/agency/900/approve", new { amount = 45000m })).EnsureSuccessStatusCode();
        Assert.Equal(("Approved", 4, 45000m, "50000.00"), (Status, (int)_app["VerificationStatus"]!, (decimal)_app["ApprovedAmount"]!, _app["EligibleAmount"]));
        Assert.Contains(_host.Email.Sent, m => m.To == "msme@acme.test" && m.HtmlBody.Contains("45000.00"));
    }

    // ----- sweep -----

    [Fact]
    public async Task Sweep_rejects_a_late_correction_and_holds_an_application_whose_certificate_is_suspended()
    {
        At("Correction", "AGENCY1", "DA1", accepted: true);
        _app["CorrectionDueOn"] = DateTime.Today.AddDays(-1);
        _overdue.Add(new Dictionary<string, object?>(_app));
        using (var scope = _host.Services.CreateScope())
        {
            var result = await SchemeServices.Get<SchemeSweep>(scope.ServiceProvider).RunAsync(CancellationToken.None);
            Assert.Equal(new SchemeSweep.Result(1, 0), result);
        }
        Assert.Equal(("Rejected", 5, SchemeSweep.LateReason), (Status, (int)_app["VerificationStatus"]!, _app["ReasonForRejection"]));
        Assert.Contains(_host.Email.Sent, m => m.To == "msme@acme.test" && m.HtmlBody.Contains(SchemeSweep.LateReason));

        _overdue.Clear();
        At("Verifying", "AGENCY1", "DA1", accepted: true);
        _inProgress.Add(new Dictionary<string, object?>(_app));
        _heldCertificates.Add(new { ZedId = Zed, Certification = "Bronze", CertNo = "B-2", Phase = "SUSPENDED" }); // another certificate
        using (var scope = _host.Services.CreateScope())
            Assert.Equal(new SchemeSweep.Result(0, 0), await SchemeServices.Get<SchemeSweep>(scope.ServiceProvider).RunAsync(CancellationToken.None));
        _heldCertificates.Add(new { ZedId = Zed, Certification = "Bronze", CertNo = "B-1", Phase = "SUSPENDED" });
        using (var scope = _host.Services.CreateScope())
            Assert.Equal(new SchemeSweep.Result(0, 1), await SchemeServices.Get<SchemeSweep>(scope.ServiceProvider).RunAsync(CancellationToken.None));
        Assert.Equal(("OnHold", "Certificate B-1 SUSPENDED (was Verifying)"), (Status, _app["HoldReason"]));
        // The unit and the ZED team inbox are told (their own Incentive mails).
        var holds = _host.Email.Sent.Where(m => m.Subject.StartsWith("Application on hold")).ToList();
        Assert.Equal(2, holds.Count);
        Assert.Contains(holds, m => m.To == "msme@acme.test" && m.HtmlBody.Contains("Certificate B-1 SUSPENDED"));

        // The Master Admin resumes it where it was.
        var admin = await SignIn("MADMIN");
        (await admin.PostAsJsonAsync("/api/staff/scheme-applications/900/resume", new { })).EnsureSuccessStatusCode();
        Assert.Equal("Verifying", Status);
        Assert.Equal("Resumed: Certificate B-1 SUSPENDED (was Verifying)", _app["HoldReason"]);
        // The Master Admin decided: the next sweep does not hold it again while the certificate stays suspended.
        _inProgress.Clear();
        _inProgress.Add(new Dictionary<string, object?>(_app));
        using (var scope = _host.Services.CreateScope())
            Assert.Equal(0, (await SchemeServices.Get<SchemeSweep>(scope.ServiceProvider).RunAsync(CancellationToken.None)).Held);
        Assert.Equal("Verifying", Status);
        Assert.Contains(_host.Email.Sent, m => m.To == "msme@acme.test" && m.Subject.StartsWith("Application resumed") && m.HtmlBody.Contains("Desktop verification"));
    }

    [Fact]
    public async Task Sweep_holds_an_approved_unpaid_application_and_resume_returns_it_to_approved()
    {
        At("Approved", "AGENCY1", "DA1", accepted: true);
        _app["ApprovedAmount"] = 45000m;
        _inProgress.Add(new Dictionary<string, object?>(_app));
        _heldCertificates.Add(new { ZedId = Zed, Certification = "Bronze", CertNo = "B-1", Phase = "WITHDRAWN" });
        Assert.Contains("'Approved'", SchemeSweep.InProgressSql);
        using (var scope = _host.Services.CreateScope())
            Assert.Equal(new SchemeSweep.Result(0, 1), await SchemeServices.Get<SchemeSweep>(scope.ServiceProvider).RunAsync(CancellationToken.None));
        // On hold: VerificationStatus 2, so the NEFT pages (VerificationStatus 4) no longer list it.
        Assert.Equal(("OnHold", 2, "Certificate B-1 WITHDRAWN (was Approved)"), (Status, (int)_app["VerificationStatus"]!, _app["HoldReason"]));

        (await (await SignIn("MADMIN")).PostAsJsonAsync("/api/staff/scheme-applications/900/resume", new { })).EnsureSuccessStatusCode();
        Assert.Equal(("Approved", 4, 45000m), (Status, (int)_app["VerificationStatus"]!, (decimal)_app["ApprovedAmount"]!));

        // A paid application (VerificationStatus 6) is never held.
        _app["VerificationStatus"] = 6;
        _inProgress.Clear();
        _inProgress.Add(new Dictionary<string, object?>(_app));
        using (var scope = _host.Services.CreateScope())
            Assert.Equal(new SchemeSweep.Result(0, 0), await SchemeServices.Get<SchemeSweep>(scope.ServiceProvider).RunAsync(CancellationToken.None));
    }

    [Fact]
    public async Task Sweep_holds_a_registration_scheme_application_when_the_units_highest_certificate_is_suspended()
    {
        At("Verifying", "AGENCY1", "DA1", accepted: true);
        _app["SchemeLevel"] = SchemeRules.Registration;
        _app["SchemeCertNo"] = Zed;
        _inProgress.Add(new Dictionary<string, object?>(_app));
        // A suspended lower certificate does not hold it while the highest (Silver) is valid.
        _unitCertificates.Add(new { ZedId = Zed, Certification = "Bronze", CertNo = "B-1", Phase = "SUSPENDED", CertifiedOn = new DateTime(2025, 1, 1) });
        _unitCertificates.Add(new { ZedId = Zed, Certification = "Silver", CertNo = "S-1", Phase = (string?)null, CertifiedOn = new DateTime(2026, 1, 1) });
        using (var scope = _host.Services.CreateScope())
            Assert.Equal(new SchemeSweep.Result(0, 0), await SchemeServices.Get<SchemeSweep>(scope.ServiceProvider).RunAsync(CancellationToken.None));
        Assert.Equal("Verifying", Status);

        // The highest becomes suspended: on hold.
        _unitCertificates.Clear();
        _unitCertificates.Add(new { ZedId = Zed, Certification = "Bronze", CertNo = "B-1", Phase = (string?)null, CertifiedOn = new DateTime(2025, 1, 1) });
        _unitCertificates.Add(new { ZedId = Zed, Certification = "Silver", CertNo = "S-1", Phase = (string?)"SUSPENDED", CertifiedOn = new DateTime(2026, 1, 1) });
        using (var scope = _host.Services.CreateScope())
            Assert.Equal(new SchemeSweep.Result(0, 1), await SchemeServices.Get<SchemeSweep>(scope.ServiceProvider).RunAsync(CancellationToken.None));
        Assert.Equal(("OnHold", "Certificate S-1 SUSPENDED (was Verifying)"), (Status, _app["HoldReason"]));
        // An expired higher certificate does not count as the highest.
        Assert.Equal("B-1", SchemeSweep.HighestCertificate(
        [
            new SchemeSweep.CertRow { ZedId = Zed, Certification = "Bronze", CertNo = "B-1", Phase = null },
            new SchemeSweep.CertRow { ZedId = Zed, Certification = "Gold", CertNo = "G-1", Phase = "EXPIRED" },
        ])?.CertNo);
    }

    [Fact]
    public async Task Master_admin_rejects_an_application_on_hold()
    {
        At("OnHold", "AGENCY1", "DA1", accepted: true);
        _app["HoldReason"] = "Certificate B-1 WITHDRAWN (was Qc)";
        var admin = await SignIn("MADMIN");
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/staff/scheme-applications/900/reject", new { reason = "" })).StatusCode);
        (await admin.PostAsJsonAsync("/api/staff/scheme-applications/900/reject", new { reason = "Certificate withdrawn" })).EnsureSuccessStatusCode();
        Assert.Equal(("Rejected", "Certificate withdrawn"), (Status, _app["ReasonForRejection"]));
        At("Verifying", "AGENCY1", "DA1", accepted: true);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/staff/scheme-applications/900/resume", new { })).StatusCode);
    }

    // ----- users' scheme ticks -----

    [Fact]
    public async Task Normal_assessment_agencies_cannot_be_ticked_and_are_not_eligible()
    {
        // The round robin and the manual list read desktop verification agencies only (the SQL), whatever ticks an assessment agency has.
        Assert.DoesNotContain("AgencyKind IS NULL", SchemeAllotment.CandidatesSql);
        var admin = await SignIn("MADMIN");
        var t = await admin.GetFromJsonAsync<JsonElement>("/api/staff/users/agencies/AGENCYNOFV/schemes");
        Assert.False(t.GetProperty("schemes")[0].GetProperty("canDesktop").GetBoolean());
        Assert.False(t.GetProperty("schemes")[0].GetProperty("canOnsite").GetBoolean());
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync("/api/staff/users/agencies/AGENCYNOFV/schemes",
            new { ticks = new[] { new { code = Code, desktop = true, onsite = false } } })).StatusCode);
        var options = await admin.GetFromJsonAsync<JsonElement>("/api/staff/scheme-applications/900/agencies");
        Assert.DoesNotContain("AGENCYNOFV", options.EnumerateArray().Select(o => o.GetProperty("userId").GetString()));
    }

    [Fact]
    public async Task Ticks_master_admin_sets_an_agencys_and_the_agency_its_assessors_within_its_own()
    {
        var admin = await SignIn("MADMIN");
        var t = await admin.GetFromJsonAsync<JsonElement>("/api/staff/users/agencies/AGENCY1/schemes");
        Assert.True(t.GetProperty("schemes")[0].GetProperty("desktop").GetBoolean());
        // A desktop verification agency verifies at the desktop only (onsite is for the onsite verification agencies).
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync("/api/staff/users/agencies/AGENCY2/schemes", new { ticks = new[] { new { code = Code, desktop = true, onsite = true } } })).StatusCode);
        (await admin.PutAsJsonAsync("/api/staff/users/agencies/AGENCY2/schemes", new { ticks = new[] { new { code = Code, desktop = true, onsite = false } } })).EnsureSuccessStatusCode();
        var save = _host.Sql.Calls.Last(c => c.Name == SchemeTicksController.SaveSql);
        Assert.Equal(($"{Code}:D", "2"), (FakeSql.Arg(save.Args, "Value"), FakeSql.Arg(save.Args, "RoleId")));

        var agency = await SignIn("AGENCY1");
        // AGENCY1 is ticked Desktop only: its assessor cannot be ticked Onsite.
        Assert.Equal(HttpStatusCode.BadRequest, (await agency.PutAsJsonAsync("/api/staff/users/assessors/DA1/schemes", new { ticks = new[] { new { code = Code, desktop = true, onsite = true } } })).StatusCode);
        (await agency.PutAsJsonAsync("/api/staff/users/assessors/DA1/schemes", new { ticks = new[] { new { code = Code, desktop = true, onsite = false } } })).EnsureSuccessStatusCode();
        save = _host.Sql.Calls.Last(c => c.Name == SchemeTicksController.SaveSql);
        Assert.Equal(($"{Code}:D", "3"), (FakeSql.Arg(save.Args, "Value"), FakeSql.Arg(save.Args, "RoleId")));
        Assert.Equal(HttpStatusCode.Forbidden, (await agency.PutAsJsonAsync("/api/staff/users/agencies/AGENCY1/schemes", new { ticks = Array.Empty<object>() })).StatusCode);
        // Not another agency's assessor.
        Assert.Equal(HttpStatusCode.NotFound, (await (await SignIn("AGENCY2")).GetAsync("/api/staff/users/assessors/DA1/schemes")).StatusCode);
    }

    [Fact]
    public void Ticks_replace_only_the_schemes_sent()
    {
        Assert.Equal("A:D,B:O", SchemeTicks.Replace("A:D,B:D", ["B"], ["B:O"]));
        Assert.Null(SchemeTicks.Replace("A:D", ["A"], []));
        Assert.True(SchemeTicks.Has("x:d, TU_DIRECT:O", "TU_DIRECT", SchemeTicks.Onsite));
        Assert.False(SchemeTicks.Has("TU_DIRECTX:D", "TU_DIRECT", SchemeTicks.Desktop));
    }

    // ----- FA list, roles -----

    [Fact]
    public async Task Financial_assistance_lists_leave_scheme_rows_out()
    {
        _host.Sql.Procs["SP_FINANCIAL_ASSISTANCE_GET_LIST"] = _ => FakeSql.Sets(
            [new { Id = 1, ZedId = "ZEDMSME000001", CertificationType = "Bronze" }, new { Id = 900, ZedId = Zed, CertificationType = Code, SchemeCode = Code }],
            [new { New = 2, InProgress = 1, Qc = 0, Approved = 3, Rejected = 0 }]);
        _host.Sql.Queries[FinancialAssistanceController.SchemeCountsSql] = _ => [new { VerificationStatus = (int?)1, Cnt = 1 }, new { VerificationStatus = (int?)6, Cnt = 1 }];
        var admin = await SignIn("MADMIN");
        var json = await admin.GetFromJsonAsync<JsonElement>("/api/staff/schemes/fa/submissions?status=1");
        Assert.Equal("ZEDMSME000001", Assert.Single(json.GetProperty("rows").EnumerateArray()).GetProperty("ZedId").GetString());
        Assert.Equal(1, json.GetProperty("counts").GetProperty("New").GetInt32());
        Assert.Equal(2, json.GetProperty("counts").GetProperty("Approved").GetInt32());
    }

    [Fact]
    public async Task Each_role_reaches_only_its_own_endpoints()
    {
        var anonymous = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/staff/scheme-applications")).StatusCode);

        var agency = await SignIn("AGENCY1");
        Assert.Equal(HttpStatusCode.Forbidden, (await agency.GetAsync("/api/staff/scheme-applications")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await agency.GetAsync("/api/staff/scheme-verification/assessor")).StatusCode);
        var da = await SignIn("DA1");
        Assert.Equal(HttpStatusCode.Forbidden, (await da.PostAsJsonAsync("/api/staff/scheme-verification/agency/900/approve", new { amount = 1 })).StatusCode);
        var admin = await SignIn("MADMIN");
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.PostAsJsonAsync("/api/staff/scheme-verification/assessor/900/decision", new { decision = "recommend" })).StatusCode);
        foreach (var other in new[] { "SC_UP", "ADMIN1" })
        {
            var c = await SignIn(other);
            Assert.Equal(HttpStatusCode.Forbidden, (await c.GetAsync("/api/staff/scheme-applications")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await c.GetAsync("/api/staff/scheme-verification/agency")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await c.GetAsync("/api/staff/scheme-verification/assessor")).StatusCode);
        }
        Assert.Equal(0, Saves);
    }
}
