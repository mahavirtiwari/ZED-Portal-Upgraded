using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Zed.Main.Api.Tests;
using Zed.Portal.Features.Staff.SiteAssessment;

namespace Zed.Consultancy.Api.Tests;

/// <summary>CO allotment of a handholding milestone and the consultants' milestone lists on the Consultancy host.</summary>
public sealed class ConsultancyAllotmentTests : IDisposable
{
    private const string Base = "/api/staff/site-assessment/consultancy";
    private const string Zed = "ZEDMSME000001";
    private static readonly string Tomorrow = DateTime.Today.AddDays(1).ToString("yyyy-MM-dd");
    private static readonly string InAWeek = DateTime.Today.AddDays(7).ToString("yyyy-MM-dd");

    private readonly TestHost _host = new();
    private readonly WebApplicationFactory<Program> _app;
    private int _milestone = 1;
    private string? _siteAssessor;
    private string? _rejected;
    private string? _coCsv = "CC2,CC3";

    public ConsultancyAllotmentTests()
    {
        _app = _host.WithTestSignIn();
        _host.Sql.Procs["SP_ASSESSMENT_ALLOT_LIST"] = args =>
        {
            var user = FakeSql.Arg(args, "UserId");
            if (FakeSql.Arg(args, "RoleId") == "3")
                return FakeSql.Sets(
                [
                    new { ZedId = Zed, Certification = "Silver", NcCount = 2, EnterpriseName = "Acme", ModeOfAssessment = "Onsite Assessment", BdsToDate = "October 30, 2026", AgencyEmail = "co@x.test" },
                    new { ZedId = "ZEDMSME000009", Certification = "Gold", NcCount = 2, EnterpriseName = "Other", ModeOfAssessment = "Onsite Assessment", BdsToDate = "", AgencyEmail = "co@x.test" },
                ]);
            object[] units = user == "CO1"
                ? [new { ZedId = Zed, Certification = "Silver", NcCount = _milestone, PUnitName = "Acme Unit", UnitAddress = "Plot 4", SiteAssessorId = _siteAssessor, CoAssessorId = _siteAssessor is null ? null : _coCsv,
                         TechExpert = _siteAssessor is null ? null : "TE1", ReasonForRejection = _rejected, OwnerName = "A Kumar", AgencyEmail = "co@x.test" }]
                : [];
            if (FakeSql.Arg(args, "ZedId") is { } z && z != Zed) units = [];
            object[] consultants = user == "CO1"
                ? [new { UserId = "CC1", UserName = "Lead One" }, new { UserId = "CC2", UserName = "Co Two" }, new { UserId = "CC3", UserName = "Co Three" }]
                : [new { UserId = "CC9", UserName = "Other" }];
            object[] experts = user == "CO1" ? [new { UserId = "TE1", UserName = "Expert One" }, new { UserId = "TE2", UserName = "Expert Two" }] : [];
            return FakeSql.Sets(units, consultants, experts);
        };
        _host.Sql.Procs["SP_EMAIL_GET_DETAILS"] = _ => FakeSql.Sets(
            [new
            {
                EmailId = "unit@acme.test", EnterpriseName = "Acme <b>Castings</b>", Address = "Plot 4", AgencyName = "<script>CO</script>", AgencyUserId = "CO1",
                SpocName = "Spoc", AgencyEmailId = "co@x.test", AgencyMobileNo = "9000000000", NcCount = _milestone,
                AssessorEmailId = "lead@x.test", AssessorUserId = "CC1", Password = "LeadSecret#1", MsmePassword = "MsmeSecret#3",
                BdsFromDate = "October 22, 2026", BdsToDate = "October 28, 2026", HapFromDate = "October 22, 2026", HapToDate = "October 28, 2026",
            }],
            [new { CoAssessorUserId = "CC2", CoAssessorEmailId = "co2@x.test", CoAssessorPassword = "CoSecret#2" },
             new { CoAssessorUserId = "CC3", CoAssessorEmailId = "co3@x.test", CoAssessorPassword = "CoSecret#3" }]);
        _host.Sql.Queries[ConsultancyAllotmentController.MilestoneMembershipSql[..40]] = _ =>
        [
            new { ZedId = Zed, Certification = "Silver", SiteAssessorId = "CC1", CoAssessorId = "CC10,CC2" },
            // Matched by the procedure's LIKE '%CC1%' only: CC1 is not on this unit.
            new { ZedId = "ZEDMSME000009", Certification = "Gold", SiteAssessorId = "CC19", CoAssessorId = "CC10,CC11" },
        ];
    }

    public void Dispose()
    {
        _app.Dispose();
        _host.Dispose();
    }

    private Task<HttpClient> Co(string user = "CO1") => StaffTestSignIn.BrowserAsync(_app, user, 2, "SiteVerification");
    private Task<HttpClient> Consultant(string user = "CC1") => StaffTestSignIn.BrowserAsync(_app, user, 3, "SiteVerification");

    private IEnumerable<object?> CallsTo(string proc) => _host.Sql.Calls.Where(c => c.Name == proc).Select(c => c.Args);

    private static object Allot(string lead = "CC1", string[]? co = null, string[]? experts = null, string? bdsFrom = null, string? bdsTo = null,
        string? hapFrom = null, string? hapTo = null, string zedId = Zed) =>
        new
        {
            zedId, certification = "Silver", leadConsultantId = lead, coConsultantIds = co ?? ["CC2", "CC3"], technicalExpertIds = experts ?? ["TE1"],
            bdsFromDate = bdsFrom ?? Tomorrow, bdsToDate = bdsTo ?? InAWeek, hapFromDate = hapFrom ?? Tomorrow, hapToDate = hapTo ?? InAWeek,
        };

    // ----- access -----

    [Fact]
    public async Task Requires_sign_in_and_the_CO_role()
    {
        var anonymous = await StaffTestSignIn.BrowserAsync(_app, null, 0);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(Base + "/allotments")).StatusCode);
        var consultant = await Consultant();
        Assert.Equal(HttpStatusCode.Forbidden, (await consultant.GetAsync(Base + "/allotments")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await consultant.PostAsJsonAsync(Base + "/allotments", Allot())).StatusCode);
        var tuOnly = await StaffTestSignIn.BrowserAsync(_app, "CO1", 2, "FinancialVerification");
        Assert.Equal(HttpStatusCode.Forbidden, (await tuOnly.GetAsync(Base + "/allotments")).StatusCode);
        Assert.Empty(CallsTo("SP_ASSESSMENT_ACCEPT_UNIT_FOR_SA"));
    }

    [Fact]
    public async Task Main_and_surveillance_site_allotment_is_not_served_here()
    {
        var client = await Co();
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/staff/site-assessment/allotments")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/staff/site-assessment/remote-assessments")).StatusCode);
    }

    // ----- list -----

    [Fact]
    public async Task Lists_the_COs_units_with_its_consultants_and_technical_experts()
    {
        _siteAssessor = "CC1";
        var client = await Co();
        var json = await client.GetFromJsonAsync<JsonElement>(Base + "/allotments");
        var unit = json.GetProperty("units")[0];
        Assert.Equal(Zed, unit.GetProperty("ZedId").GetString());
        Assert.Equal(1, unit.GetProperty("NcCount").GetInt32());
        Assert.Equal(["CC2", "CC3"], unit.GetProperty("CoConsultantIds").EnumerateArray().Select(e => e.GetString()));
        Assert.Equal("Co Two, Co Three", unit.GetProperty("CoConsultantNames").GetString());
        Assert.Equal("Expert One", unit.GetProperty("TechnicalExpertNames").GetString());
        Assert.False(unit.TryGetProperty("OwnerName", out _));
        Assert.False(unit.TryGetProperty("AgencyEmail", out _));
        Assert.Equal(3, json.GetProperty("consultants").GetArrayLength());
        Assert.Equal(2, json.GetProperty("technicalExperts").GetArrayLength());

        var args = Assert.Single(CallsTo("SP_ASSESSMENT_ALLOT_LIST"));
        Assert.Equal("CO1", FakeSql.Arg(args, "UserId"));
        Assert.Equal("2", FakeSql.Arg(args, "RoleId"));
        Assert.Equal("SA", FakeSql.Arg(args, "AllotmentType"));
    }

    // ----- allot -----

    [Fact]
    public async Task Allots_milestone_1_with_the_team_and_both_date_ranges()
    {
        var client = await Co();
        var r = await client.PostAsJsonAsync(Base + "/allotments", Allot(co: ["CC2", "cc3", "CC2"], experts: ["TE1", "TE2"]));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);

        var args = Assert.Single(CallsTo("SP_ASSESSMENT_ACCEPT_UNIT_FOR_SA"))!;
        var names = args.GetType().GetProperties().Select(p => p.Name).OrderBy(n => n).ToList();
        // Exactly the ZED_CONSULTANT parameters used (AssessmentDate is derived by the procedure from BdsFromDate).
        Assert.Equal(["BdsFromDate", "BdsToDate", "Certification", "CoAssessorId", "HapFromDate", "HapToDate", "ModeOfAssessment", "SiteAssessorId", "TechnicalExperts", "ZedId"], names);
        Assert.Equal(Zed, FakeSql.Arg(args, "ZedId"));
        Assert.Equal("CC1", FakeSql.Arg(args, "SiteAssessorId"));
        Assert.Equal("CC2,CC3", FakeSql.Arg(args, "CoAssessorId"));
        Assert.Equal("TE1,TE2", FakeSql.Arg(args, "TechnicalExperts"));
        Assert.Equal(Tomorrow, FakeSql.Arg(args, "BdsFromDate"));
        Assert.Equal(InAWeek, FakeSql.Arg(args, "HapToDate"));
        Assert.Equal("Onsite Assessment", FakeSql.Arg(args, "ModeOfAssessment"));

        // Unit, lead and one mail per co-consultant; never a password; values encoded.
        var mails = _host.Email.Sent.ToList();
        Assert.Equal(["co2@x.test", "co3@x.test", "lead@x.test", "unit@acme.test"], mails.Select(m => m.To).OrderBy(t => t));
        Assert.All(mails, m => Assert.Contains("Allocation of Handholding Support (Milestone 1)", m.Subject));
        Assert.All(mails, m => Assert.DoesNotContain("Secret#", m.HtmlBody));
        Assert.All(mails, m => Assert.DoesNotContain("<script>", m.HtmlBody));
        Assert.Contains("HAP From Date", mails.Single(m => m.To == "unit@acme.test").HtmlBody);
        Assert.Contains("as Co-consultant", mails.Single(m => m.To == "co3@x.test").HtmlBody);
        Assert.Contains("CC3", mails.Single(m => m.To == "co3@x.test").HtmlBody);
        Assert.Contains("as Lead Consultant", mails.Single(m => m.To == "lead@x.test").HtmlBody);
    }

    [Fact]
    public async Task Later_milestones_need_no_HAP_dates_and_do_not_pass_them()
    {
        _milestone = 2;
        var client = await Co();
        var r = await client.PostAsJsonAsync(Base + "/allotments", new
        {
            zedId = Zed, certification = "Silver", leadConsultantId = "CC1", coConsultantIds = Array.Empty<string>(), technicalExpertIds = Array.Empty<string>(),
            bdsFromDate = Tomorrow, bdsToDate = Tomorrow,
        });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var args = Assert.Single(CallsTo("SP_ASSESSMENT_ACCEPT_UNIT_FOR_SA"));
        Assert.Null(FakeSql.Arg(args, "HapFromDate"));
        Assert.Null(FakeSql.Arg(args, "HapToDate"));
        Assert.Null(FakeSql.Arg(args, "CoAssessorId"));
        Assert.Null(FakeSql.Arg(args, "TechnicalExperts"));
        Assert.Contains(_host.Email.Sent, m => m.Subject.Contains("(Milestone 2)"));
        Assert.DoesNotContain("HAP From Date", _host.Email.Sent.Single(m => m.To == "unit@acme.test").HtmlBody);
    }

    public static TheoryData<string, object> Invalid => new()
    {
        { "lead also co", Allot(co: ["CC1"]) },
        { "foreign lead", Allot(lead: "CC9") },
        { "foreign co", Allot(co: ["CC9"]) },
        { "foreign expert", Allot(experts: ["CC2"]) },
        { "bad id", Allot(co: ["CC2'--"]) },
        { "no HAP for milestone 1", Allot(hapFrom: "", hapTo: "") },
        { "BDS reversed", Allot(bdsFrom: InAWeek, bdsTo: Tomorrow) },
        { "HAP reversed", Allot(hapFrom: InAWeek, hapTo: Tomorrow) },
        { "past", Allot(bdsFrom: DateTime.Today.AddDays(-1).ToString("yyyy-MM-dd")) },
        { "too far", Allot(bdsTo: DateTime.Today.AddYears(2).ToString("yyyy-MM-dd")) },
        { "not ISO", Allot(bdsFrom: "10/22/2026") },
    };

    [Theory]
    [MemberData(nameof(Invalid))]
    public async Task Invalid_allotments_are_refused_before_the_procedure(string because, object body)
    {
        var client = await Co();
        var r = await client.PostAsJsonAsync(Base + "/allotments", body);
        Assert.True(r.StatusCode == HttpStatusCode.BadRequest, because);
        Assert.Empty(CallsTo("SP_ASSESSMENT_ACCEPT_UNIT_FOR_SA"));
        Assert.Empty(_host.Email.Sent);
    }

    [Fact]
    public async Task Technical_experts_must_fit_the_TechExpert_column()
    {
        _host.Sql.Procs["SP_ASSESSMENT_ALLOT_LIST"] = _ => FakeSql.Sets(
            [new { ZedId = Zed, Certification = "Silver", NcCount = 1 }],
            [new { UserId = "CC1", UserName = "Lead" }],
            Enumerable.Range(1, 12).Select(i => (object)new { UserId = "TECHEXPERT" + i, UserName = "E" + i }));
        var client = await Co();
        var r = await client.PostAsJsonAsync(Base + "/allotments", Allot(co: [], experts: Enumerable.Range(1, 12).Select(i => "TECHEXPERT" + i).ToArray()));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Contains("technical experts", await r.ProblemTitle());
        Assert.Empty(CallsTo("SP_ASSESSMENT_ACCEPT_UNIT_FOR_SA"));
    }

    [Fact]
    public async Task Units_of_other_COs_and_rejected_units_cannot_be_allotted()
    {
        Assert.Equal(HttpStatusCode.NotFound, (await (await Co("CO2")).PostAsJsonAsync(Base + "/allotments", Allot())).StatusCode);
        _rejected = "Not our area";
        Assert.Equal(HttpStatusCode.BadRequest, (await (await Co()).PostAsJsonAsync(Base + "/allotments", Allot())).StatusCode);
        Assert.Empty(CallsTo("SP_ASSESSMENT_ACCEPT_UNIT_FOR_SA"));
    }

    // ----- reject -----

    [Fact]
    public async Task Rejects_an_unallotted_unit_and_mails_the_ZED_team()
    {
        var client = await Co();
        var r = await client.PostAsJsonAsync(Base + "/allotments/reject", new { zedId = Zed, certification = "silver", reasonForRejection = "Outside <b>our</b> state" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var args = Assert.Single(CallsTo("SP_ASSESSMENT_REJECT_UNIT_FOR_SA"));
        Assert.Equal("Silver", FakeSql.Arg(args, "Certification"));
        Assert.Equal("Outside <b>our</b> state", FakeSql.Arg(args, "ReasonForRejection"));
        var mail = Assert.Single(_host.Email.Sent);
        Assert.Equal("zed@qcin.org", mail.To);
        Assert.Contains("Rejection by Consultant Organization", mail.Subject);
        Assert.Contains("Outside &lt;b&gt;our&lt;/b&gt; state", mail.HtmlBody);
    }

    [Fact]
    public async Task Allotted_or_already_rejected_units_cannot_be_rejected_and_the_reason_is_limited()
    {
        var client = await Co();
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync(Base + "/allotments/reject", new { zedId = Zed, certification = "Silver", reasonForRejection = new string('x', 101) })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync(Base + "/allotments/reject", new { zedId = Zed, certification = "Silver", reasonForRejection = " " })).StatusCode);
        _siteAssessor = "CC1";
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync(Base + "/allotments/reject", new { zedId = Zed, certification = "Silver", reasonForRejection = "No" })).StatusCode);
        Assert.Empty(CallsTo("SP_ASSESSMENT_REJECT_UNIT_FOR_SA"));
        Assert.Empty(_host.Email.Sent);
    }

    // ----- milestone lists -----

    [Fact]
    public async Task Milestone_list_passes_the_milestone_and_keeps_only_exact_lead_or_co_consultant_units()
    {
        var client = await Consultant();
        var rows = await client.GetFromJsonAsync<JsonElement>(Base + "/milestones/2");
        var row = Assert.Single(rows.EnumerateArray());
        Assert.Equal(Zed, row.GetProperty("ZedId").GetString());
        Assert.Equal("Lead Consultant", row.GetProperty("ConsultantRole").GetString());
        Assert.False(row.TryGetProperty("AgencyEmail", out _));

        var args = Assert.Single(CallsTo("SP_ASSESSMENT_ALLOT_LIST"));
        Assert.Equal("RA", FakeSql.Arg(args, "AllotmentType"));
        Assert.Equal("3", FakeSql.Arg(args, "RoleId"));
        Assert.Equal("2", FakeSql.Arg(args, "Milestone"));
    }

    [Fact]
    public async Task Co_consultants_see_their_units()
    {
        var client = await Consultant("CC2");
        var rows = await client.GetFromJsonAsync<JsonElement>(Base + "/milestones/2");
        Assert.Equal("Co-consultant", Assert.Single(rows.EnumerateArray()).GetProperty("ConsultantRole").GetString());
    }

    [Fact]
    public async Task Milestone_lists_are_for_consultants_and_milestones_1_to_3()
    {
        var client = await Consultant();
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(Base + "/milestones/4")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(Base + "/milestones/0")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await (await Co()).GetAsync(Base + "/milestones/1")).StatusCode);
        var noSite = await StaffTestSignIn.BrowserAsync(_app, "CC1", 3, "FinancialVerification");
        Assert.Equal(HttpStatusCode.Forbidden, (await noSite.GetAsync(Base + "/milestones/1")).StatusCode);
    }
}
