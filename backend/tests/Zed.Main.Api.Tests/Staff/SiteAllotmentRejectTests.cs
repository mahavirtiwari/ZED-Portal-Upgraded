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

    private static object Body(string reason = "Outside our sector", string zedId = "ZEDMSME000001") =>
        new { zedId, certification = "Silver", reasonForRejection = reason };

    private IEnumerable<object?> Rejections() => _host.Sql.Calls.Where(c => c.Name == "SP_ASSESSMENT_REJECT_UNIT_FOR_SA").Select(c => c.Args);

    [Fact]
    public async Task Agency_rejects_a_waiting_unit_with_its_reason_and_the_zed_team_is_told()
    {
        var r = await (await SignIn("AGENCY1")).PostAsJsonAsync(Url, Body());
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var call = Assert.Single(Rejections());
        Assert.Equal("ZEDMSME000001", FakeSql.Arg(call, "ZedId"));
        Assert.Equal("Silver", FakeSql.Arg(call, "Certification"));
        Assert.Equal("Outside our sector", FakeSql.Arg(call, "ReasonForRejection"));
        var mail = Assert.Single(_host.Email.Sent);
        Assert.Contains("Rejection by Agency", mail.Subject);
        Assert.Contains("Outside our sector", mail.HtmlBody);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task A_reason_is_required(string reason)
    {
        var r = await (await SignIn("AGENCY1")).PostAsJsonAsync(Url, Body(reason));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Contains("reason for rejection", await r.ProblemTitle());
        Assert.Empty(Rejections());
    }

    [Fact]
    public async Task The_reason_fits_the_procedure()
    {
        var r = await (await SignIn("AGENCY1")).PostAsJsonAsync(Url, Body(new string('x', 101)));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Empty(Rejections());
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
    public async Task A_unit_in_neither_list_still_cannot_be_allotted()
    {
        var client = await DaTestUsers.SignInAsync(_host, "MADMIN");
        var r = await client.PostAsJsonAsync("/api/staff/assessment/allot", new { zedId = "ZEDMSME000099", certification = "Silver", agencyUserId = "AGENCY2" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Empty(DaTestUsers.CallsTo(_host.Sql, "SP_ASSESSMENT_ALLOT_TO_AGENCY"));
    }
}
