using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Portal.Features.Staff.Assessment;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>
/// 2026-11-18 (the user: "accept, reject, view details ... similar to combination one"): the agency rejects a unit of its
/// site-assessment allotment list, as it rejects a desktop allotment; the unit comes back to the Master Admin's Allot list.
/// </summary>
public sealed class SiteAllotmentRejectTests : IDisposable
{
    private const string Url = "/api/staff/site-assessment/allotments/reject";
    private readonly TestHost _host = new();
    private string? _assessor;
    private string? _reason;

    public SiteAllotmentRejectTests()
    {
        SiteAssessmentTestUsers.Register(_host);
        // The SA branch is scoped by @UserId: AGENCY1's list holds ZEDMSME000001 Silver (status 6, no desktop step).
        _host.Sql.Procs["SP_ASSESSMENT_ALLOT_LIST"] = args =>
            FakeSql.Arg(args, "UserId") == "AGENCY1" && FakeSql.Arg(args, "AllotmentType") == "SA" && FakeSql.Arg(args, "ZedId") is null or "ZEDMSME000001"
                ? FakeSql.Sets([new { ZedId = "ZEDMSME000001", Certification = "Silver", PUnitName = "Acme Unit", SiteAssessorId = _assessor, ReasonForRejection = _reason, CertificationStatus = 6 }],
                    [new { UserId = "ASR1", UserName = "Lead One" }], [])
                : FakeSql.Sets([], [], []);
        _host.Sql.Procs["SP_EMAIL_GET_DETAILS"] = _ => FakeSql.Sets([new { EnterpriseName = "Acme", AgencyName = "Agency One", AgencyUserId = "AGENCY1" }]);
    }

    public void Dispose() => _host.Dispose();

    private Task<HttpClient> SignIn(string user) => SiteAssessmentTestUsers.SignInAsync(_host, user);

    /// <summary>2026-11-19: a reason of Admin → Rejection Reasons ("other": the Master Admin allots) and optional remarks.</summary>
    private static object Body(string reasonId = "other", string? remarks = "Outside our sector", string zedId = "ZEDMSME000001") =>
        new { zedId, certification = "Silver", reasonId, remarks };

    private IEnumerable<object?> Rejections() => _host.Sql.Calls.Where(c => c.Name == "SP_ASSESSMENT_REJECT_UNIT_FOR_SA").Select(c => c.Args);

    [Fact]
    public async Task Agency_rejects_a_waiting_unit_with_its_reason_and_the_zed_team_is_told()
    {
        var r = await (await SignIn("AGENCY1")).PostAsJsonAsync(Url, Body());
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var call = Assert.Single(Rejections());
        Assert.Equal("ZEDMSME000001", FakeSql.Arg(call, "ZedId"));
        Assert.Equal("Silver", FakeSql.Arg(call, "Certification"));
        Assert.Equal("Other – Outside our sector", FakeSql.Arg(call, "ReasonForRejection"));
        // A "Master Admin allots" reason: no automatic re-allotment; the reason and remarks are recorded.
        Assert.False((await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("reallotted").GetBoolean());
        Assert.Empty(_host.Sql.Calls.Where(c => c.Name == "SP_ASSESSMENT_ALLOT_TO_AGENCY"));
        var record = Assert.Single(_host.Sql.Calls, c => c.Name == AgencyRejections.RecordSql);
        Assert.Equal("other", FakeSql.Arg(record.Args, "ReasonId"));
        Assert.Equal("Outside our sector", FakeSql.Arg(record.Args, "Remarks"));
        Assert.Equal("AGENCY1", FakeSql.Arg(record.Args, "Agency"));
        var mail = Assert.Single(_host.Email.Sent);
        Assert.Contains("Rejection by Agency", mail.Subject);
        Assert.Contains("Outside our sector", mail.HtmlBody);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("no-such-reason")]
    public async Task A_reason_is_required(string reason)
    {
        var r = await (await SignIn("AGENCY1")).PostAsJsonAsync(Url, Body(reason));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Contains("reason for rejection", await r.ProblemTitle());
        Assert.Empty(Rejections());
    }

    [Fact]
    public async Task The_reason_fits_the_procedure_and_long_remarks_are_refused()
    {
        var client = await SignIn("AGENCY1");
        var tooLong = await client.PostAsJsonAsync(Url, Body(remarks: new string('x', 1001)));
        Assert.Equal(HttpStatusCode.BadRequest, tooLong.StatusCode);
        Assert.Empty(Rejections());

        var r = await client.PostAsJsonAsync(Url, Body(remarks: new string('x', 900)));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal(100, FakeSql.Arg(Assert.Single(Rejections()), "ReasonForRejection")!.Length);
        Assert.Equal(900, FakeSql.Arg(Assert.Single(_host.Sql.Calls, c => c.Name == AgencyRejections.RecordSql).Args, "Remarks")!.Length);
    }

    [Fact]
    public async Task Another_agencys_unit_cannot_be_rejected()
    {
        var r = await (await SignIn("AGENCY2")).PostAsJsonAsync(Url, Body());
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
        Assert.Empty(Rejections());
    }

    [Theory]
    [InlineData("ASR1", null)]
    [InlineData(null, "Busy")]
    public async Task Only_before_a_site_assessor_is_allotted_and_only_once(string? assessor, string? reason)
    {
        _assessor = assessor;
        _reason = reason;
        var r = await (await SignIn("AGENCY1")).PostAsJsonAsync(Url, Body());
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Empty(Rejections());
    }

    [Theory]
    [InlineData("AGENCYDA")] // an agency without site verification
    [InlineData("ASSESSOR1")]
    [InlineData("ADMIN1")]
    public async Task Only_site_verification_agencies_reject(string user)
    {
        var r = await (await SignIn(user)).PostAsJsonAsync(Url, Body());
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
        Assert.Empty(Rejections());
    }
}

/// <summary>The unit rejected at the site allotment back on the Master Admin's Allot list (main), and its re-allotment.</summary>
public sealed class SiteRejectionsAllotListTests : IDisposable
{
    private readonly TestHost _host = new();

    public SiteRejectionsAllotListTests()
    {
        DaTestUsers.Install(_host.Sql);
        // Main's procedure gives the Master Admin status 2/3 only.
        _host.Sql.Procs["SP_ASSESSMENT_ALLOT_LIST"] = _ => FakeSql.Sets([new { ZedId = "ZEDMSME000001", Certification = "Bronze", PUnitName = "Unit 1", CertificationStatus = 2 }], []);
        _host.Sql.Queries[SiteRejections.Sql] = args => FakeSql.Arg(args, "ZedId") is null or "ZEDMSME000007"
            ? [new { ZedId = "ZEDMSME000007", Certification = "Silver", PUnitName = "Unit 7", CertificationBodyUserId = "AGENCYSV", AgencyName = "Site Agency",
                     ReasonForRejection = "Outside our sector", CertificationStatus = 6, UnitSpocMobileNo = "9876543210" }]
            : [];
        _host.Sql.Procs["SP_ASSESSMENT_AGENCIES_TO_ALLOT"] = _ => FakeSql.Sets([
            new { UserId = "AGENCY2", UserName = "Agency Two", DesktopVerification = false, SiteVerification = true },
        ]);
        _host.Sql.Procs["SP_EMAIL_GET_DETAILS"] = _ => FakeSql.Sets([new { EnterpriseName = "Acme", AgencyEmailId = "agency2@x.test", AgencyName = "Agency Two", PUnitName = "Unit 7" }]);
    }

    public void Dispose() => _host.Dispose();

    [Fact]
    public async Task The_rejected_unit_is_listed_for_re_allotment_with_the_reason()
    {
        var client = await DaTestUsers.SignInAsync(_host, "MADMIN");
        var rows = (await client.GetFromJsonAsync<JsonElement>("/api/staff/assessment/allot")).GetProperty("rows");
        Assert.Equal(["ZEDMSME000001", "ZEDMSME000007"], rows.EnumerateArray().Select(r => r.GetProperty("ZedId").GetString()));
        var rejected = rows[1];
        Assert.Equal("Outside our sector", rejected.GetProperty("ReasonForRejection").GetString());
        Assert.Equal("AGENCYSV", rejected.GetProperty("CertificationBodyUserId").GetString());

        var reallot = (await client.GetFromJsonAsync<JsonElement>("/api/staff/assessment/allot?allotmentType=REALLOT")).GetProperty("rows");
        Assert.Contains(reallot.EnumerateArray(), r => r.GetProperty("ZedId").GetString() == "ZEDMSME000007");
        // "Allot" lists the units without an agency: never a rejected one.
        var allot = (await client.GetFromJsonAsync<JsonElement>("/api/staff/assessment/allot?allotmentType=ALLOT")).GetProperty("rows");
        Assert.DoesNotContain(allot.EnumerateArray(), r => r.GetProperty("ZedId").GetString() == "ZEDMSME000007");
    }

    [Fact]
    public async Task The_master_admin_re_allots_it_to_another_agency()
    {
        var client = await DaTestUsers.SignInAsync(_host, "MADMIN");
        var r = await client.PostAsJsonAsync("/api/staff/assessment/allot", new { zedId = "ZEDMSME000007", certification = "Silver", agencyUserId = "AGENCY2" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var call = DaTestUsers.CallsTo(_host.Sql, "SP_ASSESSMENT_ALLOT_TO_AGENCY").Single();
        Assert.Equal("ZEDMSME000007", FakeSql.Arg(call.Args, "ZedId"));
        Assert.Equal("AGENCY2", FakeSql.Arg(call.Args, "CertificationBodyUserId"));
    }

    [Fact]
    public async Task An_onsite_only_unit_still_with_its_agency_is_listed_and_re_allotted()
    {
        // 2026-11-26 (the user): Bronze set to Onsite only, auto-allotted to an agency, went to status 6 at once and reached no
        // Master Admin list. Until its agency allots the site assessor it is a re-allotment.
        _host.Sql.Queries[SiteRejections.Sql] = args => FakeSql.Arg(args, "ZedId") is null or "ZEDM000016"
            ? [new { ZedId = "ZEDM000016", Certification = "Bronze", PUnitName = "Ferro Metals", CertificationBodyUserId = "ZEDV4AG01", AgencyName = "Assessment Agency",
                     CertificationStatus = 6, DesktopSkipped = "Onsite" }]
            : [];
        _host.Sql.Queries[Zed.Portal.Features.CertLevels.LevelFlows.ReadSql] = _ => [new { Code = "Bronze", AssessmentFlow = "Onsite", SurveillanceMode = "Remote" }];
        var client = await DaTestUsers.SignInAsync(_host, "MADMIN");

        var reallot = (await client.GetFromJsonAsync<JsonElement>("/api/staff/assessment/allot?allotmentType=REALLOT")).GetProperty("rows");
        var row = reallot.EnumerateArray().Single(r => r.GetProperty("ZedId").GetString() == "ZEDM000016");
        Assert.Equal("Onsite", row.GetProperty("DesktopSkipped").GetString());
        Assert.Equal("ZEDV4AG01", row.GetProperty("CertificationBodyUserId").GetString());

        var r = await client.PostAsJsonAsync("/api/staff/assessment/allot", new { zedId = "ZEDM000016", certification = "Bronze", agencyUserId = "AGENCY2" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("AGENCY2", FakeSql.Arg(DaTestUsers.CallsTo(_host.Sql, "SP_ASSESSMENT_ALLOT_TO_AGENCY").Single().Args, "CertificationBodyUserId"));
    }

    [Fact]
    public async Task A_unit_in_neither_list_still_cannot_be_allotted()
    {
        var client = await DaTestUsers.SignInAsync(_host, "MADMIN");
        var r = await client.PostAsJsonAsync("/api/staff/assessment/allot", new { zedId = "ZEDMSME000099", certification = "Silver", agencyUserId = "AGENCY2" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Empty(DaTestUsers.CallsTo(_host.Sql, "SP_ASSESSMENT_ALLOT_TO_AGENCY"));
    }
}

/// <summary>
/// 2026-11-19 (approved): a reason marked "Auto re-allot" sends the rejected unit at once to the next agency by round robin,
/// among those the Master Admin could allot it to, never one that rejected it.
/// </summary>
public sealed class AgencyRejectionReallotTests : IDisposable
{
    private const string Url = "/api/staff/site-assessment/allotments/reject";
    private readonly TestHost _host = new();
    private object[] _agencies =
    [
        new { UserId = "AGENCY1", UserName = "Agency One", SiteVerification = true },
        new { UserId = "AGENCYX", UserName = "Rejected before", SiteVerification = true },
        new { UserId = "AGENCY2", UserName = "Agency Two", SiteVerification = true },
        new { UserId = "AGENCY3", UserName = "Agency Three", SiteVerification = true },
        new { UserId = "AGENCYDESK", UserName = "Desktop only", DesktopVerification = true },
    ];
    private string? _last = "AGENCY2";

    public AgencyRejectionReallotTests()
    {
        SiteAssessmentTestUsers.Register(_host);
        _host.Sql.Procs["SP_ASSESSMENT_ALLOT_LIST"] = args =>
            FakeSql.Arg(args, "UserId") == "AGENCY1" && FakeSql.Arg(args, "AllotmentType") == "SA"
                ? FakeSql.Sets([new { ZedId = "ZEDMSME000001", Certification = "Silver", PUnitName = "Acme Unit", CertificationStatus = 6 }], [], [])
                : FakeSql.Sets([], [], []);
        _host.Sql.Procs["SP_EMAIL_GET_DETAILS"] = _ => FakeSql.Sets([new { EnterpriseName = "Acme", AgencyEmailId = "agency@x.test", AgencyName = "Agency", PUnitName = "Acme Unit" }]);
        _host.Sql.Procs["SP_ASSESSMENT_AGENCIES_TO_ALLOT"] = _ => FakeSql.Sets(_agencies);
        // The unit was rejected before by AGENCYX.
        _host.Sql.Queries[AgencyRejections.RejectedSql] = _ => [new { RejectedAgencies = "AGENCYX,AGENCY1" }];
        var ids = new Dictionary<string, long> { ["AGENCY1"] = 10, ["AGENCYX"] = 11, ["AGENCY2"] = 12, ["AGENCY3"] = 13, ["AGENCYDESK"] = 14 };
        _host.Sql.Queries[AgencyRejections.AgencyIdsSql] = args =>
            ((string[])args!.GetType().GetProperty("Ids")!.GetValue(args)!).Where(ids.ContainsKey).Select(i => (object)new { UserId = i, Id = ids[i] });
        _host.Sql.Queries[AgencyRejections.LastSql] = _ => _last is null ? [] : [new { AgencyId = _last }];
    }

    public void Dispose() => _host.Dispose();

    private async Task<HttpResponseMessage> Reject(string reasonId = "conflict") =>
        await (await SiteAssessmentTestUsers.SignInAsync(_host, "AGENCY1")).PostAsJsonAsync(Url,
            new { zedId = "ZEDMSME000001", certification = "Silver", reasonId, remarks = "Gap study by our lead assessor" });

    private IEnumerable<object?> Allotments() => _host.Sql.Calls.Where(c => c.Name == "SP_ASSESSMENT_ALLOT_TO_AGENCY").Select(c => c.Args);

    [Fact]
    public async Task An_auto_reason_allots_the_next_agency_by_round_robin_and_mails_it()
    {
        var r = await Reject();
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var body = await r.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.GetProperty("reallotted").GetBoolean());
        Assert.Contains("another agency", body.GetProperty("message").GetString());
        // After AGENCY2 (the last re-allotment) comes AGENCY3; AGENCY1 and AGENCYX rejected it, AGENCYDESK has no site verification.
        var allot = Assert.Single(Allotments());
        Assert.Equal("AGENCY3", FakeSql.Arg(allot, "CertificationBodyUserId"));
        Assert.Equal("Silver", FakeSql.Arg(allot, "Certification"));
        Assert.Equal("AGENCY3", FakeSql.Arg(Assert.Single(_host.Sql.Calls, c => c.Name == AgencyRejections.MarkSql).Args, "Agency"));
        Assert.Contains(_host.Email.Sent, m => m.To == "agency@x.test");
    }

    [Fact]
    public async Task The_rotation_wraps_round_and_skips_every_agency_that_rejected_the_unit()
    {
        _last = "AGENCY3";
        await Reject();
        Assert.Equal("AGENCY2", FakeSql.Arg(Assert.Single(Allotments()), "CertificationBodyUserId"));
    }

    [Fact]
    public async Task An_agency_whose_states_or_sectors_leave_the_unit_out_is_not_offered()
    {
        // 2026-11-27 (the owner): the Master Admin's list (and this round robin) as the automatic allotment, at every level.
        _host.Sql.Queries[AllotmentAgencies.OutsideAreaSql] = _ => [new { UserId = "AGENCY3 " }];
        await Reject();
        Assert.Equal("AGENCY2", FakeSql.Arg(Assert.Single(Allotments()), "CertificationBodyUserId"));
        Assert.Equal("ZEDMSME000001", FakeSql.Arg(Assert.Single(_host.Sql.Calls, c => c.Name == AllotmentAgencies.OutsideAreaSql).Args, "ZedId"));
    }

    [Fact]
    public async Task With_no_other_agency_the_unit_waits_for_the_master_admin()
    {
        _agencies = [new { UserId = "AGENCY1", UserName = "Agency One", SiteVerification = true }, new { UserId = "AGENCYX", UserName = "Rejected before", SiteVerification = true }];
        var r = await Reject();
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.False((await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("reallotted").GetBoolean());
        Assert.Empty(Allotments());
    }

    [Fact]
    public async Task A_master_admin_reason_saved_by_the_admin_is_not_re_allotted()
    {
        _host.Sql.Queries["SELECT SettingKey, SettingValue FROM dbo.V4Settings"] = _ =>
            [new { SettingKey = RejectionReasons.Key, SettingValue = "[{\"id\":\"conflict\",\"text\":\"Conflict of interest\",\"action\":\"MasterAdmin\",\"active\":true}]" }];
        var r = await Reject();
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Empty(Allotments());
    }

    [Fact]
    public async Task The_agency_gets_the_active_reasons_with_what_each_does()
    {
        var reasons = await (await SiteAssessmentTestUsers.SignInAsync(_host, "AGENCY1")).GetFromJsonAsync<JsonElement>("/api/staff/assessment/rejection-reasons");
        var first = reasons[0];
        Assert.Equal("conflict", first.GetProperty("id").GetString());
        Assert.True(first.GetProperty("autoReallot").GetBoolean());
        Assert.Contains(reasons.EnumerateArray(), x => x.GetProperty("id").GetString() == "other" && !x.GetProperty("autoReallot").GetBoolean());
    }
}
