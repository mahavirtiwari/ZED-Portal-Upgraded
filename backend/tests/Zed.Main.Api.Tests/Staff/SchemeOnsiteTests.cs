using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Incentives;
using Zed.Portal.Features.Incentives.Onsite;
using Zed.Portal.Features.Incentives.Staff;
using Zed.Portal.Features.Staff.SubUsers;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>2026-11-20 (the user, phase 2 of the incentive schemes): onsite verification of Desktop + Onsite schemes (part D, web).</summary>
public sealed class SchemeOnsiteTests : IDisposable
{
    private const string Zed = "ZEDMSME000030";
    private const string Code = "ONSITESCH";
    private readonly TestHost _host = new();
    private readonly Dictionary<string, object?> _app;
    private string? _lastOnsite;

    // (role, agency kind, created by)
    private static readonly Dictionary<string, (int Role, string? Kind, string? CreatedBy)> Users = new(StringComparer.OrdinalIgnoreCase)
    {
        ["MADMIN"] = (7, null, null),
        ["AGENCY1"] = (2, null, "MADMIN"),
        ["DA1"] = (3, null, "AGENCY1"),
        ["ONSITE1"] = (2, "SchemeOnsite", "MADMIN"),
        ["ONSITE2"] = (2, "SchemeOnsite", "MADMIN"),
        ["OSA1"] = (3, null, "ONSITE1"),
        ["OSA9"] = (3, null, "ONSITE1"),
    };

    private static SchemeDefinition Definition(string flow) => new()
    {
        Code = Code, Name = "Onsite Scheme", Active = true,
        Card = new() { Title = "Onsite Scheme" },
        Activation = new() { Mode = SchemeRules.Levels, Levels = ["Bronze"] },
        Grading = new() { Mode = SchemeRules.ByLevel, Rows = [new("Bronze", 75, 50000)] },
        Form = new()
        {
            Sections =
            [
                new()
                {
                    Key = "items", Title = "Machines", Repeating = true, MinItems = 1, MaxItems = 5,
                    Fields =
                    [
                        new() { Key = "invoice_no", Label = "Invoice No", Type = "text", AssessorChecks = true },
                        new() { Key = "amount", Label = "Amount", Type = "amount", IsClaim = true, AssessorChecks = true, CheckStage = SchemeRules.StageBoth },
                        new() { Key = "installed", Label = "Machine installed", Type = "yesno", AssessorChecks = true, CheckStage = SchemeRules.StageOnsite },
                        new() { Key = "invoice", Label = "Invoice", Type = "document", MaxFiles = 2 },
                    ],
                },
            ],
        },
        Verification = new() { Flow = flow, CorrectionRounds = 2, CorrectionDays = 30, AutoAllot = true, OnsitePhotosMin = 1, OnsitePhotosMax = 3 },
    };

    private string _flow = SchemeRules.DesktopOnsite;

    private static string Answers() => new FormAnswers
    {
        Sections = new()
        {
            ["items"] =
            [
                new FormItem { Saved = true, Values = new() { ["invoice_no"] = "INV-1", ["amount"] = "40000", ["installed"] = "Yes", ["invoice"] = "[\"20261120101010000aabbccdd.pdf\"]" } },
                new FormItem { Saved = true, Values = new() { ["invoice_no"] = "INV-2", ["amount"] = "30000", ["installed"] = "Yes", ["invoice"] = "[\"20261120101010000aabbcc01.jpg\"]" } },
            ],
        },
    }.Serialize();

    private static readonly string[] DesktopPaths =
        ["items/0/invoice_no", "items/0/amount", "items/0/invoice", "items/1/invoice_no", "items/1/amount", "items/1/invoice"];

    public SchemeOnsiteTests()
    {
        _host.Sql.Procs["SP_GET_USER_DETAILS"] = args =>
            FakeSql.Arg(args, "UserId") is { } id && Users.TryGetValue(id, out var u)
                ? FakeSql.Sets([new { UserId = id, UserName = id + " name", RoleId = u.Role, Email = id + "@x.test" }], [new { ERRORMSG = "SUCCESS" }])
                : FakeSql.Sets([], [new { ERRORMSG = "INVALID CREDENTIAILS" }]);
        // Onsite agencies and their assessors have no verification sub-role (their flags are cleared).
        _host.Sql.Procs["SP_GET_SUB_ROLE"] = args =>
            FakeSql.Arg(args, "UserId") is { } id && (id.StartsWith("ONSITE") || id.StartsWith("OSA"))
                ? FakeSql.Sets([new { DesktopVerification = 0, SiteVerification = 0, FinancialVerification = 0 }])
                : FakeSql.Sets([new { DesktopVerification = 1, SiteVerification = 1, FinancialVerification = 1 }]);

        _app = new()
        {
            ["Id"] = 900, ["ZedId"] = Zed, ["SchemeCode"] = Code, ["SchemeLevel"] = "Bronze", ["SchemeCertNo"] = "B-1", ["SchemeStatus"] = "Verifying",
            ["VerificationStatus"] = 2, ["FormAnswers"] = Answers(), ["FormChecks"] = null, ["ClaimAmount"] = 70000m, ["SharePercent"] = 75m,
            ["MaxAmount"] = 50000m, ["EligibleAmount"] = null, ["ApprovedAmount"] = null, ["CorrectionRound"] = 0, ["SubmittedOn"] = new DateTime(2026, 11, 18),
            ["CertificationBodyUserId"] = "AGENCY1", ["FinancialAssessorId"] = "DA1", ["AssessorAcceptedOn"] = new DateTime(2026, 11, 19),
            ["OnsiteAgencyId"] = null, ["OnsiteAssessorId"] = null, ["OnsiteAllotmentType"] = null, ["OnsiteRejectedAgencies"] = null,
            ["VisitStartedOn"] = null, ["OnsiteVerifiedClaim"] = null,
        };
        var q = _host.Sql.Queries;
        q[SchemeApplications.ByIdWithOnsiteSql] = args => FakeSql.Arg(args, "Id") == "900" ? [new Dictionary<string, object?>(_app)] : [];
        q[SchemeStore.AllSql] = _ => [new { Id = 1L, SchemeCode = Code, SchemeJson = SchemeRules.Serialize(Definition(_flow)), Active = true, OrderNo = (int?)1 }];
        _host.Sql.Procs[SchemeCases.SaveSql] = args =>
        {
            if (FakeSql.Arg(args, "Expected") != (_app["SchemeStatus"]?.ToString() ?? "Draft")) return FakeSql.Sets();
            foreach (var p in args!.GetType().GetProperties())
                if (p.Name is not ("Expected" or "Id")) _app[p.Name] = p.GetValue(args);
            return FakeSql.Sets();
        };
        q[SchemeCases.UnitSql] = _ => [new { EnterpriseName = "Acme Castings", EmailId = "msme@acme.test", PAddress = "Plot 4", PCity = "Kanpur", PStateName = "UTTAR PRADESH" }];
        q[SchemeCases.UserSql] = args => FakeSql.Arg(args, "UserId") is { } id && Users.TryGetValue(id, out var u)
            ? [new { UserId = id, UserName = id + " name", Email = id.ToLowerInvariant() + "@x.test", RoleId = u.Role, IsActive = true, CreatedBy = u.CreatedBy,
                SchemeVerification = u.Kind is null ? Code + ":D" : Code + ":O", AgencyKind = u.Kind }]
            : [];
        q[OnsiteAgencies.KindOfSql] = args => FakeSql.Arg(args, "UserId") is { } id && Users.TryGetValue(id, out var u)
            ? [new { RoleId = u.Role, AgencyKind = u.Kind, CreatorKind = u.CreatedBy is { } c && Users.TryGetValue(c, out var cu) ? cu.Kind : null }]
            : [];

        // Onsite agencies (the query itself keeps to AgencyKind = 'SchemeOnsite'): ONSITE1 serves two districts of UP, ONSITE2 the whole of UP,
        // ONSITE3 Maharashtra, ONSITE4 is ticked for the desktop only, ONSITE5 another district of UP.
        q[OnsiteAllotment.CandidatesSql] = _ =>
        [
            new { Id = 10L, UserId = "ONSITE1", UserName = "Onsite One", SchemeVerification = $"{Code}:O" },
            new { Id = 20L, UserId = "ONSITE2", UserName = "Onsite Two", SchemeVerification = $"OTHER:O,{Code.ToLowerInvariant()}:o" },
            new { Id = 30L, UserId = "ONSITE3", UserName = "Other state", SchemeVerification = $"{Code}:O" },
            new { Id = 40L, UserId = "ONSITE4", UserName = "Desktop tick", SchemeVerification = $"{Code}:D" },
            new { Id = 50L, UserId = "ONSITE5", UserName = "Other district", SchemeVerification = $"{Code}:O" },
        ];
        q[OnsiteAllotment.UnitPlaceSql] = _ => [new { PStateName = "Uttar Pradesh", PDistrictName = "KANPUR NAGAR", PLgDistrictCode = "164" }];
        q[OnsiteAllotment.StatesSql] = _ =>
        [
            new { UserId = "ONSITE1", States = "UTTAR PRADESH", Districts = (string?)"163,164" },
            new { UserId = "ONSITE2", States = "UTTAR PRADESH", Districts = (string?)null },
            new { UserId = "ONSITE3", States = "MAHARASHTRA", Districts = (string?)null },
            new { UserId = "ONSITE4", States = "UTTAR PRADESH", Districts = (string?)null },
            new { UserId = "ONSITE5", States = "UTTAR PRADESH", Districts = (string?)"999" },
        ];
        q[OnsiteAllotment.LastSql] = _ => _lastOnsite is { } a ? [new { AgencyId = a }] : [];
        q[OnsiteAgencyController.AssessorsSql] = args => FakeSql.Arg(args, "Agency") != "ONSITE1" ? [] :
        [
            new { Id = 1L, UserId = "OSA1", UserName = "Onsite Assessor", SchemeVerification = $"{Code}:O", CreatedBy = "ONSITE1" },
            new { Id = 2L, UserId = "OSA9", UserName = "Desktop only", SchemeVerification = $"{Code}:D", CreatedBy = "ONSITE1" },
        ];
    }

    public void Dispose() => _host.Dispose();

    private async Task<HttpClient> SignIn(string user)
    {
        var client = await _host.CreateBrowserAsync();
        (await client.PostAsJsonAsync("/api/staff/auth/login", new { userId = user, password = "Right#Pass1" })).EnsureSuccessStatusCode();
        return client;
    }

    private string Status => _app["SchemeStatus"]?.ToString() ?? "";

    private void At(string status, string? onsiteAgency = null, string? onsiteAssessor = null)
    {
        _app["SchemeStatus"] = status;
        _app["VerificationStatus"] = SchemeApplications.VerificationStatus(status);
        _app["OnsiteAgencyId"] = onsiteAgency;
        _app["OnsiteAssessorId"] = onsiteAssessor;
    }

    private async Task<string?> OnsiteAllotAsync()
    {
        using var scope = _host.Services.CreateScope();
        return await SchemeServices.Get<OnsiteAllotment>(scope.ServiceProvider).AutoAllotAsync(900, CancellationToken.None);
    }

    private IEnumerable<string> History => _host.Sql.Calls.Where(c => c.Name.StartsWith("INSERT INTO MsmeHistory")).Select(c => FakeSql.Arg(c.Args, "Descrip") ?? "");

    // ----- the onsite round robin -----

    [Fact]
    public async Task Onsite_round_robin_takes_the_agencies_of_the_units_state_and_district_in_turn()
    {
        Assert.Contains("AgencyKind = 'SchemeOnsite'", OnsiteAllotment.CandidatesSql);
        At("OnsiteAllot");
        Assert.Equal("ONSITE1", await OnsiteAllotAsync());
        Assert.Equal(("OnsiteWithAgency", "ONSITE1", "RoundRobin", 2), (Status, _app["OnsiteAgencyId"], _app["OnsiteAllotmentType"], (int)_app["VerificationStatus"]!));
        Assert.Contains(_host.Email.Sent, m => m.To == "onsite1@x.test" && m.Subject.Contains("Onsite"));
        var history = _host.Sql.Calls.Last(c => c.Name == OnsiteAllotment.HistorySql);
        Assert.Equal(("ONSITE1", Code), (FakeSql.Arg(history.Args, "AgencyId"), FakeSql.Arg(history.Args, "SchemeCode")));

        // After ONSITE1 comes ONSITE2 (the whole state: no districts); ONSITE3 (another state), ONSITE4 (desktop tick) and
        // ONSITE5 (another district) never; after ONSITE2 it wraps to ONSITE1.
        At("OnsiteAllot");
        _lastOnsite = "ONSITE1";
        Assert.Equal("ONSITE2", await OnsiteAllotAsync());
        At("OnsiteAllot");
        _lastOnsite = "ONSITE2";
        Assert.Equal("ONSITE1", await OnsiteAllotAsync());

        // Only an application waiting for an onsite agency.
        At("OnsiteWithAgency", "ONSITE1");
        Assert.Null(await OnsiteAllotAsync());
    }

    [Fact]
    public async Task Onsite_round_robin_skips_agencies_that_rejected_it_and_waits_when_none_is_left()
    {
        At("OnsiteAllot");
        _app["OnsiteRejectedAgencies"] = "ONSITE1";
        Assert.Equal("ONSITE2", await OnsiteAllotAsync());
        At("OnsiteAllot");
        _app["OnsiteRejectedAgencies"] = "ONSITE1,ONSITE2";
        Assert.Null(await OnsiteAllotAsync());
        Assert.Equal("OnsiteAllot", Status);
        Assert.Null(_app["OnsiteAgencyId"]);
    }

    [Fact]
    public void Districts_none_means_the_whole_state_and_match_by_lgd_code_or_name()
    {
        Assert.True(OnsiteAgencies.CoversDistrict(null, "164", "KANPUR NAGAR"));
        Assert.True(OnsiteAgencies.CoversDistrict(" ", "164", null));
        Assert.True(OnsiteAgencies.CoversDistrict("163, 0164", "164", null));
        Assert.True(OnsiteAgencies.CoversDistrict("Kanpur Nagar,Lucknow", null, "KANPUR NAGAR"));
        Assert.False(OnsiteAgencies.CoversDistrict("163", "164", "KANPUR NAGAR"));
        Assert.False(OnsiteAgencies.CoversDistrict("163", null, null));
    }

    [Fact]
    public async Task Sweep_retries_the_onsite_allotment_but_not_one_left_to_the_master_admin()
    {
        _host.Sql.Queries[SchemeSweep.OnsiteWaitingSql] = _ => [new { Id = 900 }];
        At("OnsiteAllot");
        using (var scope = _host.Services.CreateScope())
            Assert.Equal(1, (await SchemeServices.Get<SchemeSweep>(scope.ServiceProvider).RunAsync(CancellationToken.None)).OnsiteAllotted);
        Assert.Equal(("OnsiteWithAgency", "ONSITE1"), (Status, _app["OnsiteAgencyId"]));
        Assert.Contains("'MasterAdmin'", SchemeSweep.OnsiteWaitingSql);
    }

    [Fact]
    public async Task Sweep_mails_the_assessor_apps_onsite_decisions_once()
    {
        // The mobile API has no scheme mail templates: the sweep tells the onsite agency of a recommendation, the unit of a rejection.
        var marked = new List<int>();
        _host.Sql.Queries[SchemeSweep.OnsiteDecidedSql] = _ => marked.Count == 0 ? [new { Id = 900 }] : [];
        _host.Sql.Procs[SchemeSweep.OnsiteNotifiedSql] = a => { marked.Add(900); return FakeSql.Sets(); };
        At("Qc", "ONSITE1", "OSA1");
        using (var scope = _host.Services.CreateScope())
            await SchemeServices.Get<SchemeSweep>(scope.ServiceProvider).RunAsync(CancellationToken.None);
        Assert.Equal([900], marked);
        Assert.Contains(_host.Email.Sent, m => m.To == "onsite1@x.test" && m.Subject.Contains("Onsite verification submitted"));
        var sent = _host.Email.Sent.Count;
        using (var scope = _host.Services.CreateScope())
            await SchemeServices.Get<SchemeSweep>(scope.ServiceProvider).RunAsync(CancellationToken.None);
        Assert.Equal(sent, _host.Email.Sent.Count);
        Assert.Contains("OnsiteNotifiedOn < VisitSubmittedOn", SchemeSweep.OnsiteDecidedSql);
    }

    // ----- the desktop side -----

    [Fact]
    public void Desktop_checks_leave_out_the_fields_checked_only_at_the_visit()
    {
        var def = Definition(SchemeRules.DesktopOnsite);
        var answers = FormAnswers.Parse(Answers());
        Assert.Equal(DesktopPaths, SchemeReview.CheckablesOf(def, answers).Select(c => c.Path).ToArray());
        Assert.Equal(["items/0/amount", "items/0/installed", "items/1/amount", "items/1/installed"], SchemeApplications.OnsitePlacesOf(def, answers).Select(p => p.Path).ToArray());
        // The Desktop flow checks every checked field at the desktop.
        Assert.Contains("items/0/installed", SchemeReview.CheckablesOf(Definition(SchemeRules.Desktop), answers).Select(c => c.Path));
    }

    private void AllDesktopChecksValid() =>
        _app["FormChecks"] = FieldCheck.Serialize(DesktopPaths.ToDictionary(p => p, _ => new FieldCheck("Yes", null, 0, "DA1", DateTime.Now)));

    [Fact]
    public async Task Desktop_recommend_of_a_desktop_onsite_scheme_goes_to_the_onsite_round_robin_without_agency_qc()
    {
        AllDesktopChecksValid();
        var da = await SignIn("DA1");
        var r = await da.PostAsJsonAsync("/api/staff/scheme-verification/assessor/900/decision", new { decision = "recommend" });
        r.EnsureSuccessStatusCode();
        Assert.Contains("onsite", (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("message").GetString());
        Assert.Equal(("OnsiteWithAgency", "ONSITE1", "50000.00"), (Status, _app["OnsiteAgencyId"], _app["EligibleAmount"]));
        Assert.Contains(History, h => h.Contains("onsite verification"));
    }

    [Fact]
    public async Task Desktop_recommend_of_a_desktop_scheme_still_goes_to_the_agency_qc()
    {
        _flow = SchemeRules.Desktop;
        _app["FormChecks"] = FieldCheck.Serialize(DesktopPaths.Concat(["items/0/installed", "items/1/installed"])
            .ToDictionary(p => p, _ => new FieldCheck("Yes", null, 0, "DA1", DateTime.Now)));
        (await (await SignIn("DA1")).PostAsJsonAsync("/api/staff/scheme-verification/assessor/900/decision", new { decision = "recommend" })).EnsureSuccessStatusCode();
        Assert.Equal("Qc", Status);
        Assert.Null(_app["OnsiteAgencyId"]);
        // The agency is told its QC is due (its own Incentive mail).
        Assert.Contains(_host.Email.Sent, m => m.To == "agency1@x.test" && m.Subject.StartsWith("Application recommended for QC"));
    }

    [Fact]
    public async Task Desktop_agency_cannot_do_the_qc_of_the_onsite_stage_and_its_list_leaves_it_out()
    {
        At("Qc", "ONSITE1", "OSA1");
        _app["OnsiteVerifiedClaim"] = 60000m;
        var agency = await SignIn("AGENCY1");
        Assert.Equal(HttpStatusCode.BadRequest, (await agency.PostAsJsonAsync("/api/staff/scheme-verification/agency/900/approve", new { amount = 1000 })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await agency.PostAsJsonAsync("/api/staff/scheme-verification/agency/900/back", new { remarks = "x" })).StatusCode);
        var d = await agency.GetFromJsonAsync<JsonElement>("/api/staff/scheme-verification/agency/900");
        Assert.False(d.GetProperty("actions").GetProperty("qc").GetBoolean());
        Assert.Contains("NOT (F.SchemeStatus = 'Qc' AND F.OnsiteAgencyId IS NOT NULL)", SchemeReview.ListAgencySql);
        Assert.Contains("'OnsiteWithAgency'", SchemeReview.ListAgencySql);
        Assert.Contains("F.OnsiteAgencyId = @UserId", SchemeReview.ListOnsiteAgencySql);
    }

    // ----- the onsite agency -----

    [Fact]
    public async Task Onsite_agency_names_one_of_its_onsite_assessors_without_a_date()
    {
        At("OnsiteWithAgency", "ONSITE1");
        var onsite = await SignIn("ONSITE1");
        var options = await onsite.GetFromJsonAsync<JsonElement>("/api/staff/scheme-onsite/agency/900/assessors");
        Assert.Equal("OSA1", Assert.Single(options.EnumerateArray()).GetProperty("userId").GetString());
        Assert.Equal(HttpStatusCode.BadRequest, (await onsite.PostAsJsonAsync("/api/staff/scheme-onsite/agency/900/accept", new { assessorUserId = "OSA9" })).StatusCode);
        (await onsite.PostAsJsonAsync("/api/staff/scheme-onsite/agency/900/accept", new { assessorUserId = "OSA1" })).EnsureSuccessStatusCode();
        Assert.Equal(("OnsiteWithAssessor", "OSA1", 2), (Status, _app["OnsiteAssessorId"], (int)_app["VerificationStatus"]!));
        Assert.Contains(_host.Email.Sent, m => m.To == "osa1@x.test" && m.Subject.StartsWith("Allocation of Application for Onsite Verification"));
        // The unit is told a visit is due, with the assessor's name.
        Assert.Contains(_host.Email.Sent, m => m.To == "msme@acme.test" && m.Subject.StartsWith("Onsite verification of your application") && m.HtmlBody.Contains("OSA1 name"));
        // The desktop assessor and agency stay as they were.
        Assert.Equal(("AGENCY1", "DA1"), (_app["CertificationBodyUserId"], _app["FinancialAssessorId"]));

        // Another assessor may be named while the visit has not started; not once it has.
        (await onsite.PostAsJsonAsync("/api/staff/scheme-onsite/agency/900/accept", new { assessorUserId = "OSA1" })).EnsureSuccessStatusCode();
        _app["VisitStartedOn"] = DateTime.Now;
        Assert.Equal(HttpStatusCode.BadRequest, (await onsite.PostAsJsonAsync("/api/staff/scheme-onsite/agency/900/accept", new { assessorUserId = "OSA1" })).StatusCode);
    }

    [Fact]
    public async Task Onsite_agency_rejection_with_an_auto_reason_reallots_to_another_onsite_agency()
    {
        At("OnsiteWithAgency", "ONSITE1");
        var onsite = await SignIn("ONSITE1");
        var r = await onsite.PostAsJsonAsync("/api/staff/scheme-onsite/agency/900/reject", new { reasonId = "conflict", remarks = "Related party" });
        r.EnsureSuccessStatusCode();
        Assert.Contains("another agency", (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("message").GetString());
        Assert.Equal(("OnsiteWithAgency", "ONSITE2", "ONSITE1"), (Status, _app["OnsiteAgencyId"], _app["OnsiteRejectedAgencies"]));
        Assert.Equal(HttpStatusCode.NotFound, (await onsite.GetAsync("/api/staff/scheme-onsite/agency/900")).StatusCode);
    }

    [Fact]
    public async Task Onsite_agency_rejection_with_a_master_admin_reason_waits_for_the_master_admin()
    {
        At("OnsiteWithAgency", "ONSITE1");
        var r = await (await SignIn("ONSITE1")).PostAsJsonAsync("/api/staff/scheme-onsite/agency/900/reject", new { reasonId = "other" });
        r.EnsureSuccessStatusCode();
        Assert.Equal(("OnsiteAllot", (object?)null, (object?)"MasterAdmin", (object?)"ONSITE1"), (Status, _app["OnsiteAgencyId"], _app["OnsiteAllotmentType"], _app["OnsiteRejectedAgencies"]));

        // The Master Admin allots it by hand (an agency that rejected it is still offered, marked).
        var admin = await SignIn("MADMIN");
        var options = await admin.GetFromJsonAsync<JsonElement>("/api/staff/scheme-applications/900/onsite-agencies");
        Assert.Equal(["ONSITE1", "ONSITE2"], options.EnumerateArray().Select(o => o.GetProperty("userId").GetString()!).ToArray());
        Assert.True(options[0].GetProperty("rejectedBefore").GetBoolean());
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/staff/scheme-applications/900/onsite-allot", new { agencyUserId = "ONSITE3" })).StatusCode);
        (await admin.PostAsJsonAsync("/api/staff/scheme-applications/900/onsite-allot", new { agencyUserId = "ONSITE2" })).EnsureSuccessStatusCode();
        Assert.Equal(("OnsiteWithAgency", "ONSITE2", "Manual"), (Status, _app["OnsiteAgencyId"], _app["OnsiteAllotmentType"]));
        var d = await admin.GetFromJsonAsync<JsonElement>("/api/staff/scheme-applications/900");
        Assert.True(d.GetProperty("actions").GetProperty("onsiteAllot").GetBoolean());
        Assert.Equal("ONSITE2", d.GetProperty("onsite").GetProperty("agency").GetProperty("userId").GetString());
    }

    [Fact]
    public async Task Onsite_qc_approves_up_to_the_eligible_amount_of_the_onsite_verified_claim_or_sends_back()
    {
        At("Qc", "ONSITE1", "OSA1");
        _app["VisitStartedOn"] = new DateTime(2026, 11, 20, 10, 30, 0);
        _app["OnsiteVerifiedClaim"] = 60000m;
        _app["RepresentativeName"] = "R Sharma";
        _host.Sql.Queries[OnsiteReports.PhotosSql] = _ => [new { PhotoId = "20261120103000000aabbcc11.jpg", Name = "onsite/items/0", Latitude = "26.4", Longitude = "80.3" }];
        var onsite = await SignIn("ONSITE1");
        var d = await onsite.GetFromJsonAsync<JsonElement>("/api/staff/scheme-onsite/agency/900");
        Assert.True(d.GetProperty("actions").GetProperty("onsiteQc").GetBoolean());
        var report = d.GetProperty("onsite");
        Assert.Equal(45000m, report.GetProperty("eligible").GetDecimal());
        Assert.Equal("R Sharma", report.GetProperty("representativeName").GetString());
        Assert.Equal("Machines 1", report.GetProperty("photos")[0].GetProperty("title").GetString());
        Assert.Equal(4, report.GetProperty("checks").GetArrayLength());

        Assert.Equal(HttpStatusCode.BadRequest, (await onsite.PostAsJsonAsync("/api/staff/scheme-onsite/agency/900/approve", new { amount = 45001 })).StatusCode);
        (await onsite.PostAsJsonAsync("/api/staff/scheme-onsite/agency/900/approve", new { amount = 45000 })).EnsureSuccessStatusCode();
        Assert.Equal(("Approved", 45000m, 4), (Status, (decimal)_app["ApprovedAmount"]!, (int)_app["VerificationStatus"]!));

        At("Qc", "ONSITE1", "OSA1");
        Assert.Equal(HttpStatusCode.BadRequest, (await onsite.PostAsJsonAsync("/api/staff/scheme-onsite/agency/900/back", new { remarks = "" })).StatusCode);
        (await onsite.PostAsJsonAsync("/api/staff/scheme-onsite/agency/900/back", new { remarks = "Photo of item 2 missing" })).EnsureSuccessStatusCode();
        Assert.Equal("OnsiteWithAssessor", Status);
        Assert.Contains(_host.Email.Sent, m => m.To == "osa1@x.test" && m.Subject.Contains("onsite QC"));
    }

    [Fact]
    public async Task Only_an_onsite_agency_uses_the_onsite_pages_and_only_for_its_own_applications()
    {
        At("OnsiteWithAgency", "ONSITE1");
        _host.Sql.Queries[SchemeReview.ListOnsiteAgencySql] = _ => [new { Id = 900, ZedId = Zed, SchemeCode = Code, SchemeLevel = "Bronze", SchemeStatus = "OnsiteWithAgency", VerificationStatus = 2 }];
        Assert.Equal(HttpStatusCode.OK, (await (await SignIn("ONSITE1")).GetAsync("/api/staff/scheme-onsite/agency")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await (await SignIn("ONSITE2")).GetAsync("/api/staff/scheme-onsite/agency/900")).StatusCode);
        var normal = await SignIn("AGENCY1");
        Assert.Equal(HttpStatusCode.NotFound, (await normal.GetAsync("/api/staff/scheme-onsite/agency")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await normal.GetAsync("/api/staff/scheme-onsite/agency/900")).StatusCode);
    }

    // ----- sign-in, menu kind, sub-users -----

    [Fact]
    public async Task An_onsite_agency_and_its_assessors_sign_in_with_the_onsite_kind()
    {
        async Task<string[]> SubRoles(string user)
        {
            var me = await (await SignIn(user)).GetFromJsonAsync<JsonElement>("/api/auth/me");
            return me.GetProperty("subRoles").EnumerateArray().Select(s => s.GetString()!).ToArray();
        }
        Assert.Equal([OnsiteAgencies.SubRole], await SubRoles("ONSITE1"));
        Assert.Equal([OnsiteAgencies.SubRole], await SubRoles("OSA1"));
        Assert.DoesNotContain(OnsiteAgencies.SubRole, await SubRoles("AGENCY1"));
        Assert.DoesNotContain(OnsiteAgencies.SubRole, await SubRoles("DA1"));
    }

    [Fact]
    public void An_onsite_agency_gives_its_sub_users_only_its_assessors_and_the_scheme_onsite_screens()
    {
        var onsite = SubUserPermissions.For((int)UserRole.Agency, [OnsiteAgencies.SubRole], PortalSystem.Main).Select(p => p.Key).ToArray();
        Assert.Equal(["assessors", "scheme-onsite"], onsite);
        var normal = SubUserPermissions.For((int)UserRole.Agency, [SubRoles.DesktopVerification], PortalSystem.Main).Select(p => p.Key).ToList();
        Assert.DoesNotContain("scheme-onsite", normal);
        Assert.Contains("scheme-verification", normal);
        Assert.Contains("scheme-onsite-agencies", SubUserPermissions.For((int)UserRole.MasterAdmin, [], PortalSystem.Main).Select(p => p.Key));
    }

    // ----- the normal Assessment Agencies page -----

    [Fact]
    public async Task Normal_agency_list_leaves_out_onsite_agencies_and_refuses_to_edit_them()
    {
        _host.Sql.Procs["SP_GET_USERS_BY_ROLE"] = _ => FakeSql.Sets(
            [new { Id = 1, UserId = "AGENCY1", UserName = "Agency One", IsActive = true }, new { Id = 2, UserId = "ONSITE1", UserName = "Onsite One", IsActive = true }]);
        _host.Sql.Queries[OnsiteAgencies.IdsSql] = _ => [new { UserId = "ONSITE1" }];
        _host.Sql.Procs["SP_GET_USER_DETAILS_BY_USER_ID"] = args => FakeSql.Sets(
            [new { UserId = FakeSql.Arg(args, "UserId"), UserName = "x", RoleId = 2, IsActive = true, CreatedBy = "MADMIN" }], [], [], []);
        var admin = await SignIn("MADMIN");
        var list = await admin.GetFromJsonAsync<JsonElement>("/api/staff/users/agencies");
        Assert.Equal(["AGENCY1"], list.EnumerateArray().Select(a => a.GetProperty("UserId").GetString()!).ToArray());
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync("/api/staff/users/agencies/ONSITE1")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PutAsJsonAsync("/api/staff/users/agencies/ONSITE1", new { userName = "x" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync("/api/staff/users/agencies/AGENCY1")).StatusCode);
    }

    // ----- the Master Admin's Onsite Verification Agencies -----

    [Fact]
    public async Task Master_admin_creates_an_onsite_agency_with_states_districts_and_schemes()
    {
        _host.Sql.Queries[OnsiteAgenciesController.DistrictsSql] = args => [new { Code = "163", Name = "KANPUR DEHAT" }, new { Code = "164", Name = "KANPUR NAGAR" }];
        _host.Sql.Procs["SP_INSERT_USER"] = _ => FakeSql.Sets([new { Id = "ZEDAA0099" }]);
        var admin = await SignIn("MADMIN");
        var options = await admin.GetFromJsonAsync<JsonElement>("/api/staff/scheme-onsite/agencies/options");
        Assert.Equal(Code, Assert.Single(options.GetProperty("schemes").EnumerateArray()).GetProperty("code").GetString());

        object Body(string district, string scheme) => new
        {
            userName = "Onsite Partners", spocName = "S K", emailId = "spoc@onsite.test", mobileNo = "9876543210", address = "Kanpur", pinCode = "208001",
            states = new object[] { new { state = "Uttar Pradesh", districts = new[] { district } }, new { state = "GOA", districts = Array.Empty<string>() } },
            schemes = new[] { scheme },
        };
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/staff/scheme-onsite/agencies", Body("999", Code))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/staff/scheme-onsite/agencies", Body("164", "NOPE"))).StatusCode);
        (await admin.PostAsJsonAsync("/api/staff/scheme-onsite/agencies", Body("164", Code))).EnsureSuccessStatusCode();

        var insert = _host.Sql.Calls.Last(c => c.Name == "SP_INSERT_USER");
        Assert.Equal(("2", "False", "False", "False", "UTTAR PRADESH,GOA"), (FakeSql.Arg(insert.Args, "RoleId"), FakeSql.Arg(insert.Args, "DesktopVerification"),
            FakeSql.Arg(insert.Args, "SiteVerification"), FakeSql.Arg(insert.Args, "FinancialVerification"), FakeSql.Arg(insert.Args, "PreferredStates")));
        Assert.Null(FakeSql.Arg(insert.Args, "OrgPartnerId"));
        var mark = _host.Sql.Calls.Last(c => c.Name == OnsiteAgenciesController.MarkSql);
        Assert.Equal(("ZEDAA0099", $"{Code}:O"), (FakeSql.Arg(mark.Args, "UserId"), FakeSql.Arg(mark.Args, "Ticks")));
        var districts = _host.Sql.Calls.Where(c => c.Name == OnsiteAgenciesController.SetDistrictsSql).Select(c => (FakeSql.Arg(c.Args, "State"), FakeSql.Arg(c.Args, "Districts"))).ToList();
        Assert.Equal(new List<(string?, string?)> { ("UTTAR PRADESH", "164"), ("GOA", null) }, districts);
        Assert.Contains(_host.Email.Sent, m => m.To == "spoc@onsite.test");
    }

    [Fact]
    public void Scheme_ticks_keep_desktop_for_assessment_agencies_and_onsite_for_onsite_agencies()
    {
        // The user's rule: desktop and onsite are always different agencies (SchemeTicksController.KindLimit).
        Assert.True(SchemeTicks.Has($"{Code}:O", Code, SchemeTicks.Onsite));
        Assert.Equal($"{Code}:O,OTHER:D", SchemeTicks.Replace("OTHER:D", [Code], [$"{Code}:O"]));
    }
}
