using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Core.Data;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>
/// Staff accounts for the site-assessment and monitoring tests: SP_GET_USER_DETAILS gives the role,
/// SP_GET_SUB_ROLE the sub-roles (as in StaffAuthTests).
/// </summary>
internal static class SiteAssessmentTestUsers
{
    // UserId → (RoleId, Desktop, Site, Financial)
    public static readonly Dictionary<string, (int Role, int Da, int Sa, int Fa)> Users = new(StringComparer.OrdinalIgnoreCase)
    {
        ["AGENCY1"] = (2, 1, 1, 0),
        ["AGENCY2"] = (2, 0, 1, 0),
        ["AGENCYDA"] = (2, 1, 0, 0),
        ["AGENCYFA"] = (2, 0, 0, 1),
        ["ASSESSOR1"] = (3, 0, 1, 0),
        ["ASSESSORDA"] = (3, 1, 0, 0),
        ["ADMIN1"] = (7, 1, 1, 1),
        ["SUPER1"] = (10, 1, 1, 1),
    };

    public static void Register(TestHost host)
    {
        host.Sql.Procs["SP_GET_USER_DETAILS"] = args =>
            FakeSql.Arg(args, "UserId") is { } id && Users.TryGetValue(id, out var u)
                ? FakeSql.Sets([new { UserId = id, UserName = id + " name", RoleId = u.Role, Email = "x@y.test" }], [new { ERRORMSG = "SUCCESS" }])
                : FakeSql.Sets([], [new { ERRORMSG = "INVALID CREDENTIAILS" }]);
        host.Sql.Procs["SP_GET_SUB_ROLE"] = args =>
        {
            var u = Users[FakeSql.Arg(args, "UserId")!];
            return FakeSql.Sets([new { DesktopVerification = u.Da, SiteVerification = u.Sa, FinancialVerification = u.Fa }]);
        };
    }

    public static async Task<HttpClient> SignInAsync(TestHost host, string userId)
    {
        var client = await host.CreateBrowserAsync();
        (await client.PostAsJsonAsync("/api/staff/auth/login", new { userId, password = "Right#Pass1" })).EnsureSuccessStatusCode();
        return client;
    }
}

public sealed class SiteAssessmentTests : IDisposable
{
    private readonly TestHost _host = new();
    private static readonly string Tomorrow = DateTime.Today.AddDays(1).ToString("yyyy-MM-dd");

    public SiteAssessmentTests()
    {
        SiteAssessmentTestUsers.Register(_host);
        _host.Sql.Procs["SP_ASSESSMENT_ALLOT_LIST"] = args =>
        {
            var user = FakeSql.Arg(args, "UserId");
            var zed = FakeSql.Arg(args, "ZedId");
            if (FakeSql.Arg(args, "RoleId") == "3")
                return FakeSql.Sets(user == "ASSESSOR1"
                    ? [new { ZedId = "ZEDMSME000001", Certification = "Silver", EnterpriseName = "Acme", ModeOfAssessment = "Onsite Assessment", AssessmentDate = "October 21, 2026", AgencyEmail = "agency@x.test", MobileNo = "9999999999" }]
                    : []);

            var units = new List<object>();
            if (user == "AGENCY1")
                units.Add(new { ZedId = "ZEDMSME000001", Certification = "Silver", PUnitName = "Acme Unit", UnitAddress = "Plot 4", SiteAssessorId = (string?)null, ReasonForRejection = (string?)null, AgencyEmail = "agency@x.test", MobileNo = "9999999999", OwnerName = "A Kumar" });
            if (user == "AGENCY2")
                units.Add(new { ZedId = "ZEDMSME000002", Certification = "Gold", PUnitName = "Other Unit", UnitAddress = "Plot 9", SiteAssessorId = (string?)null, ReasonForRejection = (string?)null, AgencyEmail = "a2@x.test", MobileNo = "8888888888", OwnerName = "B" });
            if (zed is not null) units = units.Where(u => (string)u.GetType().GetProperty("ZedId")!.GetValue(u)! == zed).ToList();

            object[] assessors = user switch
            {
                "AGENCY1" => [new { UserId = "ASR1", UserName = "Lead One" }, new { UserId = "ASR2", UserName = "Co Two" }],
                "AGENCY2" => [new { UserId = "ASR9", UserName = "Nine" }],
                _ => [],
            };
            return FakeSql.Sets(units, assessors, []);
        };
        _host.Sql.Procs["SP_EMAIL_GET_DETAILS"] = _ => FakeSql.Sets([new
        {
            EmailId = "unit@acme.test", EnterpriseName = "Acme <b>Castings</b>", Address = "Plot 4", AgencyName = "<script>alert(1)</script>",
            SpocName = "Spoc", AgencyEmailId = "agency@x.test", AgencyMobileNo = "9000000000", FinalSaDate = "October 21, 2026",
            AssessorEmailId = "lead@x.test", AssessorUserId = "ASR1", Password = "LeadSecret#1",
            CoAssessorUserId = "ASR2", CoAssessorEmailId = "co@x.test", CoAssessorPassword = "CoSecret#2", MsmePassword = "MsmeSecret#3",
            ModeOfAssessment = "Onsite Assessment",
        }]);
    }

    public void Dispose() => _host.Dispose();

    private Task<HttpClient> SignIn(string user) => SiteAssessmentTestUsers.SignInAsync(_host, user);

    private static object Allotment(string zedId = "ZEDMSME000001", string certification = "Silver", string lead = "ASR1", string? co = "ASR2",
        string? date = null, string mode = "Onsite Assessment") =>
        new { zedId, certification, siteAssessorId = lead, coAssessorId = co, assessmentDate = date ?? Tomorrow, modeOfAssessment = mode };

    private IEnumerable<object?> CallsTo(string proc) => _host.Sql.Calls.Where(c => c.Name == proc).Select(c => c.Args);

    // ----- access -----

    [Fact]
    public async Task Endpoints_require_sign_in()
    {
        var client = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/staff/site-assessment/allotments")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/staff/site-assessment/allotments", Allotment())).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/staff/site-assessment/remote-assessments")).StatusCode);
        Assert.Empty(CallsTo("SP_ASSESSMENT_ALLOT_LIST"));
    }

    [Theory]
    [InlineData("ADMIN1", "/api/staff/site-assessment/allotments")]
    [InlineData("ASSESSOR1", "/api/staff/site-assessment/allotments")]
    [InlineData("SUPER1", "/api/staff/site-assessment/allotments")]
    [InlineData("AGENCY1", "/api/staff/site-assessment/remote-assessments")]
    [InlineData("ADMIN1", "/api/staff/site-assessment/remote-assessments")]
    public async Task Other_roles_are_forbidden(string user, string url)
    {
        var client = await SignIn(user);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync(url)).StatusCode);
        Assert.Empty(CallsTo("SP_ASSESSMENT_ALLOT_LIST"));
    }

    [Fact]
    public async Task Agency_without_site_verification_cannot_allot()
    {
        var client = await SignIn("AGENCYDA");
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/staff/site-assessment/allotments")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync("/api/staff/site-assessment/allotments", Allotment())).StatusCode);
        Assert.Empty(CallsTo("SP_ASSESSMENT_ACCEPT_UNIT_FOR_SA"));
    }

    [Fact]
    public async Task Assessor_without_site_verification_cannot_list_remote_assessments()
    {
        var client = await SignIn("ASSESSORDA");
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/staff/site-assessment/remote-assessments")).StatusCode);
    }

    // ----- lists -----

    [Fact]
    public async Task Agency_list_is_the_agencys_own_and_omits_other_columns()
    {
        var client = await SignIn("AGENCY1");
        var body = await client.GetFromJsonAsync<JsonElement>("/api/staff/site-assessment/allotments?userId=AGENCY2&roleId=7");

        var call = Assert.Single(CallsTo("SP_ASSESSMENT_ALLOT_LIST"));
        Assert.Equal("AGENCY1", FakeSql.Arg(call, "UserId"));
        Assert.Equal("2", FakeSql.Arg(call, "RoleId"));
        Assert.Equal("SA", FakeSql.Arg(call, "AllotmentType"));

        var unit = Assert.Single(body.GetProperty("units").EnumerateArray());
        Assert.Equal("ZEDMSME000001", unit.GetProperty("ZedId").GetString());
        Assert.False(unit.TryGetProperty("AgencyEmail", out _));
        Assert.False(unit.TryGetProperty("MobileNo", out _));
        Assert.Equal(["ASR1", "ASR2"], body.GetProperty("assessors").EnumerateArray().Select(a => a.GetProperty("userId").GetString()));
    }

    [Fact]
    public async Task Assessor_list_is_scoped_to_the_signed_in_assessor()
    {
        var client = await SignIn("ASSESSOR1");
        var rows = await client.GetFromJsonAsync<JsonElement>("/api/staff/site-assessment/remote-assessments");

        var call = Assert.Single(CallsTo("SP_ASSESSMENT_ALLOT_LIST"));
        Assert.Equal("ASSESSOR1", FakeSql.Arg(call, "UserId"));
        Assert.Equal("3", FakeSql.Arg(call, "RoleId"));
        Assert.Equal("RA", FakeSql.Arg(call, "AllotmentType"));
        var row = Assert.Single(rows.EnumerateArray());
        Assert.Equal("Onsite Assessment", row.GetProperty("ModeOfAssessment").GetString());
        Assert.False(row.TryGetProperty("AgencyEmail", out _));
    }

    // ----- allotment -----

    [Fact]
    public async Task Agency_allots_its_unit_and_mails_go_out_without_passwords()
    {
        var client = await SignIn("AGENCY1");
        var r = await client.PostAsJsonAsync("/api/staff/site-assessment/allotments", Allotment());
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);

        var call = Assert.Single(CallsTo("SP_ASSESSMENT_ACCEPT_UNIT_FOR_SA"));
        Assert.Equal("ZEDMSME000001", FakeSql.Arg(call, "ZedId"));
        Assert.Equal("Silver", FakeSql.Arg(call, "Certification"));
        Assert.Equal("ASR1", FakeSql.Arg(call, "SiteAssessorId"));
        Assert.Equal("ASR2", FakeSql.Arg(call, "CoAssessorId"));
        Assert.Equal(Tomorrow, FakeSql.Arg(call, "AssessmentDate"));
        Assert.Equal("Onsite Assessment", FakeSql.Arg(call, "ModeOfAssessment"));

        var mails = _host.Email.Sent.ToList();
        Assert.Equal(["unit@acme.test", "lead@x.test", "co@x.test"], mails.Select(m => m.To));
        Assert.All(mails, m =>
        {
            Assert.DoesNotContain("Secret#", m.HtmlBody);
            Assert.DoesNotContain("<script>", m.HtmlBody);
            Assert.EndsWith("ZEDMSME000001", m.Subject);
        });
        Assert.Contains("&lt;script&gt;", mails[0].HtmlBody);
        Assert.Contains("Acme &lt;b&gt;Castings&lt;/b&gt;", mails[1].HtmlBody);
    }

    [Fact]
    public async Task Agency_cannot_allot_another_agencys_unit()
    {
        var client = await SignIn("AGENCY1");
        var r = await client.PostAsJsonAsync("/api/staff/site-assessment/allotments",
            new { zedId = "ZEDMSME000002", certification = "Gold", siteAssessorId = "ASR1", assessmentDate = Tomorrow, modeOfAssessment = "Onsite Assessment", userId = "AGENCY2" });
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
        Assert.All(CallsTo("SP_ASSESSMENT_ALLOT_LIST"), c => Assert.Equal("AGENCY1", FakeSql.Arg(c, "UserId")));
        Assert.Empty(CallsTo("SP_ASSESSMENT_ACCEPT_UNIT_FOR_SA"));
        Assert.Empty(_host.Email.Sent);
    }

    [Theory]
    [InlineData("ASR9", null)]   // lead assessor of another agency
    [InlineData("ASR1", "ASR9")] // co-assessor of another agency
    public async Task Agency_cannot_allot_another_agencys_assessor(string lead, string? co)
    {
        var client = await SignIn("AGENCY1");
        var r = await client.PostAsJsonAsync("/api/staff/site-assessment/allotments", Allotment(lead: lead, co: co));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Empty(CallsTo("SP_ASSESSMENT_ACCEPT_UNIT_FOR_SA"));
    }

    public static TheoryData<object> InvalidAllotments => new()
    {
        Allotment(date: DateTime.Today.AddDays(-1).ToString("yyyy-MM-dd")),
        Allotment(date: "21/10/2026"),
        Allotment(mode: "Remote Assessment"),
        Allotment(co: "ASR1"),
        Allotment(zedId: "ZED'; DROP TABLE Msme;--"),
        Allotment(certification: "Bronze"),
        Allotment(lead: ""),
    };

    [Theory]
    [MemberData(nameof(InvalidAllotments))]
    public async Task Invalid_allotments_are_refused(object request)
    {
        var client = await SignIn("AGENCY1");
        var r = await client.PostAsJsonAsync("/api/staff/site-assessment/allotments", request);
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Empty(CallsTo("SP_ASSESSMENT_ACCEPT_UNIT_FOR_SA"));
    }
}
