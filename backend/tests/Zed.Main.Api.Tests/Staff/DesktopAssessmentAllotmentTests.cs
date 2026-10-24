using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Core.Data;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>Staff accounts used by the desktop-assessment tests, signed in through /api/staff/auth/login.</summary>
public static class DaTestUsers
{
    /// <summary>UserId → (RoleId, DesktopVerification, SiteVerification).</summary>
    public static readonly Dictionary<string, (int Role, int Dv, int Sv)> Users = new(StringComparer.OrdinalIgnoreCase)
    {
        ["MADMIN"] = (7, 1, 1),
        ["ADMIN1"] = (1, 1, 1),
        ["QC1"] = (17, 1, 1),
        ["AGENCY1"] = (2, 1, 0),
        ["AGENCY2"] = (2, 1, 0),
        ["AGENCYSV"] = (2, 0, 1),
        ["AGENCYFIN"] = (2, 0, 0),
        ["ASSESSOR1"] = (3, 1, 0),
        ["ASSESSOR2"] = (3, 1, 0),
        ["ASSESSORSV"] = (3, 0, 1),
    };

    public static void Install(FakeSql sql)
    {
        sql.Procs["SP_GET_USER_DETAILS"] = args =>
            FakeSql.Arg(args, "UserId") is { } id && Users.TryGetValue(id, out var u)
                ? FakeSql.Sets([new { UserId = id, UserName = id + " name", RoleId = u.Role, Email = id + "@x.test" }], [new { ERRORMSG = "SUCCESS" }])
                : FakeSql.Sets([], [new { ERRORMSG = "INVALID CREDENTIAILS" }]);
        sql.Procs["SP_GET_SUB_ROLE"] = args =>
        {
            var u = Users[FakeSql.Arg(args, "UserId")!];
            return FakeSql.Sets([new { DesktopVerification = u.Dv, SiteVerification = u.Sv, FinancialVerification = 0 }]);
        };
    }

    public static async Task<HttpClient> SignInAsync(TestHost host, string userId)
    {
        var client = await host.CreateBrowserAsync();
        (await client.PostAsJsonAsync("/api/staff/auth/login", new { userId, password = "Right#Pass1" })).EnsureSuccessStatusCode();
        // The anti-forgery token is bound to the user: fetch a fresh one, as the Angular app does.
        (await client.GetAsync("/api/auth/me")).EnsureSuccessStatusCode();
        return client;
    }

    public static IEnumerable<(string Name, object? Args)> CallsTo(FakeSql sql, string name) => sql.Calls.Where(c => c.Name == name);
}

public sealed class DesktopAssessmentAllotmentTests : IDisposable
{
    private readonly TestHost _host = new();

    public DesktopAssessmentAllotmentTests()
    {
        DaTestUsers.Install(_host.Sql);
        _host.Sql.Procs["SP_ASSESSMENT_ALLOT_LIST"] = args =>
        {
            var user = FakeSql.Arg(args, "UserId");
            var zed = FakeSql.Arg(args, "ZedId");
            var type = FakeSql.Arg(args, "AllotmentType");
            IEnumerable<object> Only(params object[] rows) => rows.Where(r => zed is null || ((dynamic)r).ZedId == zed);
            return (FakeSql.Arg(args, "RoleId"), type) switch
            {
                ("7", _) => FakeSql.Sets(Only(
                    new { ZedId = "ZEDMSME000001", Certification = "Bronze", PUnitName = "Unit 1", MobileNo = "9999999999", AgencyEmail = "a@x.test", CertificationStatus = 2 }), []),
                // The procedure filters by CertificationBodyUserId = @UserId: AGENCY1 has one record, AGENCY2 none.
                ("2", "DA") when user == "AGENCY1" => FakeSql.Sets(
                    Only(new { ZedId = "ZEDMSME000001", Certification = "Bronze", PUnitName = "Unit 1", AgencyEmail = "a@x.test", DaAssessorEmail = "d@x.test", DesktopAssessorId = (string?)null }),
                    [new { UserId = "ASSESSOR9", UserName = "Silver assessor" }],
                    [new { UserId = "ASSESSOR1", UserName = "Bronze assessor", NoOfAllocationsInDay = 2 }]),
                ("2", "DA") => FakeSql.Sets([], [], []),
                ("3", null) when user == "ASSESSOR1" => FakeSql.Sets(Only(
                    new { ZedId = "ZEDMSME000001", Certification = "Bronze", DesktopAssessorId = "ASSESSOR1", DesktopAccepted = (bool?)null, DesktopReasonForRejection = (string?)null },
                    new { ZedId = "ZEDMSME000002", Certification = "Bronze", DesktopAssessorId = "ASSESSOR1", DesktopAccepted = (bool?)true, DesktopReasonForRejection = (string?)null })),
                _ => FakeSql.Sets([]),
            };
        };
        _host.Sql.Procs["SP_ASSESSMENT_AGENCIES_TO_ALLOT"] = _ => FakeSql.Sets([
            new { UserId = "AGENCY1", UserName = "Agency One", DesktopVerification = true, SiteVerification = false, FinancialVerification = false },
            new { UserId = "AGENCYSV", UserName = "Site Agency", DesktopVerification = false, SiteVerification = true, FinancialVerification = false },
        ]);
        _host.Sql.Procs["SP_EMAIL_GET_DETAILS"] = _ => FakeSql.Sets([new
        {
            EmailId = "unit@x.test", EnterpriseName = "Acme", Address = "Plot 4", AgencyEmailId = "agency@x.test", AgencyName = "Agency One",
            AgencyUserId = "AGENCY1", AssessorEmailId = "assessor@x.test", AssessorUserId = "ASSESSOR1", AssessorName = "Assessor", PUnitName = "Unit 1",
            Password = "Secret#1", MsmePassword = "Secret#2", NcCount = 1, NcFinalClosureDt = "May 01, 2026",
        }]);
    }

    public void Dispose() => _host.Dispose();

    [Theory]
    [InlineData("/api/staff/assessment/allot")]
    [InlineData("/api/staff/assessment/da-allotment")]
    [InlineData("/api/staff/assessment/da-verification")]
    [InlineData("/api/staff/assessment/non-conformances")]
    [InlineData("/api/staff/assessment/completed")]
    public async Task Lists_need_a_signed_in_user(string url)
    {
        var client = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(url)).StatusCode);
    }

    [Theory]
    [InlineData("AGENCY1", "/api/staff/assessment/allot")]
    [InlineData("ASSESSOR1", "/api/staff/assessment/allot")]
    [InlineData("MADMIN", "/api/staff/assessment/da-allotment")]
    [InlineData("ASSESSOR1", "/api/staff/assessment/da-allotment")]
    [InlineData("AGENCY1", "/api/staff/assessment/da-verification")]
    [InlineData("QC1", "/api/staff/assessment/non-conformances")]
    [InlineData("ADMIN1", "/api/staff/assessment/completed")]
    [InlineData("AGENCYFIN", "/api/staff/assessment/completed")] // agency without desktop or site verification
    [InlineData("AGENCYFIN", "/api/staff/assessment/rejected")]
    public async Task Each_list_is_limited_to_its_role(string user, string url)
    {
        var client = await DaTestUsers.SignInAsync(_host, user);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync(url)).StatusCode);
    }

    [Theory]
    [InlineData("AGENCYSV", "/api/staff/assessment/da-allotment")]
    [InlineData("ASSESSORSV", "/api/staff/assessment/da-verification")]
    public async Task Desktop_lists_need_the_desktop_verification_sub_role(string user, string url)
    {
        var client = await DaTestUsers.SignInAsync(_host, user);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync(url)).StatusCode);
        var post = await client.PostAsJsonAsync(url + (url.EndsWith("allotment") ? "/allot" : "/accept"),
            new { zedId = "ZEDMSME000001", certification = "Bronze", desktopAssessorId = "ASSESSOR1" });
        Assert.Equal(HttpStatusCode.Forbidden, post.StatusCode);
        Assert.Empty(DaTestUsers.CallsTo(_host.Sql, "SP_ASSESSMENT_ACCEPT_UNIT_FOR_DA"));
    }

    [Fact]
    public async Task Agency_list_is_scoped_to_the_signed_in_agency_and_returns_only_displayed_columns()
    {
        var client = await DaTestUsers.SignInAsync(_host, "AGENCY1");
        var json = await client.GetFromJsonAsync<JsonElement>("/api/staff/assessment/da-allotment");

        var call = DaTestUsers.CallsTo(_host.Sql, "SP_ASSESSMENT_ALLOT_LIST").Single();
        Assert.Equal("AGENCY1", FakeSql.Arg(call.Args, "UserId"));
        Assert.Equal("2", FakeSql.Arg(call.Args, "RoleId"));
        Assert.Equal("DA", FakeSql.Arg(call.Args, "AllotmentType"));

        var row = json.GetProperty("rows")[0];
        Assert.Equal("ZEDMSME000001", row.GetProperty("ZedId").GetString());
        Assert.False(row.TryGetProperty("AgencyEmail", out _));
        Assert.False(row.TryGetProperty("DaAssessorEmail", out _));
        Assert.Equal("ASSESSOR1", json.GetProperty("bronzeAssessors")[0].GetProperty("userId").GetString());
        Assert.False(json.GetProperty("bronzeAssessors")[0].TryGetProperty("noOfAllocationsInDay", out _));

        // Another agency gets its own (empty) list.
        var other = await DaTestUsers.SignInAsync(_host, "AGENCY2");
        var empty = await other.GetFromJsonAsync<JsonElement>("/api/staff/assessment/da-allotment");
        Assert.Equal(0, empty.GetProperty("rows").GetArrayLength());
    }

    [Fact]
    public async Task Agency_cannot_allot_a_record_of_another_agency()
    {
        var client = await DaTestUsers.SignInAsync(_host, "AGENCY2");
        var r = await client.PostAsJsonAsync("/api/staff/assessment/da-allotment/allot",
            new { zedId = "ZEDMSME000001", certification = "Bronze", desktopAssessorId = "ASSESSOR1" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Empty(DaTestUsers.CallsTo(_host.Sql, "SP_ASSESSMENT_ACCEPT_UNIT_FOR_DA"));
    }

    [Theory]
    [InlineData("ASSESSOR9")]   // the agency's Silver/Gold assessor, not one of its Bronze assessors
    [InlineData("SOMEONE")]     // not an assessor of this agency
    public async Task Agency_can_allot_only_to_its_own_eligible_assessors(string assessor)
    {
        var client = await DaTestUsers.SignInAsync(_host, "AGENCY1");
        var r = await client.PostAsJsonAsync("/api/staff/assessment/da-allotment/allot",
            new { zedId = "ZEDMSME000001", certification = "Bronze", desktopAssessorId = assessor });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Empty(DaTestUsers.CallsTo(_host.Sql, "SP_ASSESSMENT_ACCEPT_UNIT_FOR_DA"));
    }

    [Fact]
    public async Task Agency_allots_to_its_assessor_and_the_assessor_is_mailed_without_a_password()
    {
        var client = await DaTestUsers.SignInAsync(_host, "AGENCY1");
        var r = await client.PostAsJsonAsync("/api/staff/assessment/da-allotment/allot",
            new { zedId = "ZEDMSME000001", certification = "bronze", desktopAssessorId = "assessor1" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);

        var call = DaTestUsers.CallsTo(_host.Sql, "SP_ASSESSMENT_ACCEPT_UNIT_FOR_DA").Single();
        Assert.Equal("ZEDMSME000001", FakeSql.Arg(call.Args, "ZedId"));
        Assert.Equal("Bronze", FakeSql.Arg(call.Args, "Certification"));
        Assert.Equal("ASSESSOR1", FakeSql.Arg(call.Args, "DesktopAssessorId"));
        var mail = Assert.Single(_host.Email.Sent);
        Assert.Equal("assessor@x.test", mail.To);
        Assert.DoesNotContain("Secret#1", mail.HtmlBody);
    }

    [Fact]
    public async Task Agency_rejection_needs_a_reason()
    {
        var client = await DaTestUsers.SignInAsync(_host, "AGENCY1");
        var r = await client.PostAsJsonAsync("/api/staff/assessment/da-allotment/reject", new { zedId = "ZEDMSME000001", certification = "Bronze", reasonForRejection = " " });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        r = await client.PostAsJsonAsync("/api/staff/assessment/da-allotment/reject", new { zedId = "ZEDMSME000001", certification = "Bronze", reasonForRejection = "No capacity" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Single(DaTestUsers.CallsTo(_host.Sql, "SP_ASSESSMENT_REJECT_UNIT_FOR_DA"));
        Assert.Equal("zed@qcin.org", Assert.Single(_host.Email.Sent).To);
    }

    [Fact]
    public async Task Master_admin_allots_only_to_an_agency_eligible_for_the_level()
    {
        var client = await DaTestUsers.SignInAsync(_host, "MADMIN");
        var agencies = await client.GetFromJsonAsync<JsonElement>("/api/staff/assessment/allot/agencies?zedId=ZEDMSME000001&certification=Bronze");
        Assert.Equal(["AGENCY1"], agencies.EnumerateArray().Select(a => a.GetProperty("userId").GetString()));

        var bad = await client.PostAsJsonAsync("/api/staff/assessment/allot", new { zedId = "ZEDMSME000001", certification = "Bronze", agencyUserId = "AGENCYSV" });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        var unknown = await client.PostAsJsonAsync("/api/staff/assessment/allot", new { zedId = "ZEDMSME000099", certification = "Bronze", agencyUserId = "AGENCY1" });
        Assert.Equal(HttpStatusCode.BadRequest, unknown.StatusCode);
        Assert.Empty(DaTestUsers.CallsTo(_host.Sql, "SP_ASSESSMENT_ALLOT_TO_AGENCY"));

        var ok = await client.PostAsJsonAsync("/api/staff/assessment/allot", new { zedId = "ZEDMSME000001", certification = "Bronze", agencyUserId = "AGENCY1" });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var call = DaTestUsers.CallsTo(_host.Sql, "SP_ASSESSMENT_ALLOT_TO_AGENCY").Single();
        Assert.Equal("AGENCY1", FakeSql.Arg(call.Args, "CertificationBodyUserId"));
        Assert.Equal("agency@x.test", Assert.Single(_host.Email.Sent).To);
    }

    [Fact]
    public async Task Master_admin_list_returns_only_displayed_columns()
    {
        var client = await DaTestUsers.SignInAsync(_host, "MADMIN");
        var json = await client.GetFromJsonAsync<JsonElement>("/api/staff/assessment/allot?certification=bronze&allotmentType=ALLOT&state=9");
        var row = json.GetProperty("rows")[0];
        Assert.False(row.TryGetProperty("MobileNo", out _));
        Assert.False(row.TryGetProperty("AgencyEmail", out _));
        var call = DaTestUsers.CallsTo(_host.Sql, "SP_ASSESSMENT_ALLOT_LIST").Single();
        Assert.Equal("Bronze", FakeSql.Arg(call.Args, "CertificationType"));
        Assert.Equal("9", FakeSql.Arg(call.Args, "State"));
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/staff/assessment/allot?state=abc")).StatusCode);
    }

    [Fact]
    public async Task Assessor_accepts_only_its_own_pending_allotment()
    {
        var other = await DaTestUsers.SignInAsync(_host, "ASSESSOR2");
        var r = await other.PostAsJsonAsync("/api/staff/assessment/da-verification/accept", new { zedId = "ZEDMSME000001", certification = "Bronze" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);

        var client = await DaTestUsers.SignInAsync(_host, "ASSESSOR1");
        // Already accepted.
        r = await client.PostAsJsonAsync("/api/staff/assessment/da-verification/accept", new { zedId = "ZEDMSME000002", certification = "Bronze" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Empty(DaTestUsers.CallsTo(_host.Sql, "SP_ASSESSMENT_ACCEPT_UNIT_FOR_DA_VERIFICATION"));

        r = await client.PostAsJsonAsync("/api/staff/assessment/da-verification/accept", new { zedId = "ZEDMSME000001", certification = "Bronze" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Single(DaTestUsers.CallsTo(_host.Sql, "SP_ASSESSMENT_ACCEPT_UNIT_FOR_DA_VERIFICATION"));
    }

    [Fact]
    public async Task Completed_list_is_scoped_by_the_procedure_with_the_cookie_user()
    {
        _host.Sql.Procs["SP_MONITORING_GET_LIST_PAGINATION"] = _ => FakeSql.Sets(
            [new { RowNumber = 1, ZedId = "ZEDMSME000001", Certification = "Bronze", EnterpriseName = "Acme", UamNumber = "U1" }],
            [new { TotalCounts = 41, PageNo = 2, PageSize = 20 }]);
        var client = await DaTestUsers.SignInAsync(_host, "AGENCY1");
        var json = await client.GetFromJsonAsync<JsonElement>("/api/staff/assessment/rejected?pageNo=2&pageSize=20&searchBy=Unit%20Name&search=Acme");
        Assert.Equal(41, json.GetProperty("totalCount").GetInt32());
        Assert.False(json.GetProperty("rows")[0].TryGetProperty("UamNumber", out _));
        var call = DaTestUsers.CallsTo(_host.Sql, "SP_MONITORING_GET_LIST_PAGINATION").Single();
        Assert.Equal("AGENCY1", FakeSql.Arg(call.Args, "UserId"));
        Assert.Equal("99", FakeSql.Arg(call.Args, "Status"));
        Assert.Equal("Unit Name", FakeSql.Arg(call.Args, "SearchBy"));
    }

    [Fact]
    public async Task Completed_rows_carry_the_reason_for_rejection_the_page_colours_red()
    {
        _host.Sql.Procs["SP_MONITORING_GET_LIST_PAGINATION"] = _ => FakeSql.Sets(
            [new { RowNumber = 1, ZedId = "ZEDMSME000001", Certification = "Bronze", ReasonForRejection = "Withdrawn by the unit" }],
            [new { TotalCounts = 1, PageNo = 1, PageSize = 20 }]);
        var client = await DaTestUsers.SignInAsync(_host, "AGENCY1");
        var completed = await client.GetFromJsonAsync<JsonElement>("/api/staff/assessment/completed");
        Assert.Equal("Withdrawn by the unit", completed.GetProperty("rows")[0].GetProperty("ReasonForRejection").GetString());
        // Main's procedure ignores @Gender (its condition is commented out): the value is not passed on.
        await client.GetFromJsonAsync<JsonElement>("/api/staff/assessment/completed?gender=female");
        Assert.Null(DaTestUsers.CallsTo(_host.Sql, "SP_MONITORING_GET_LIST_PAGINATION").Last().Args!.GetType().GetProperty("Gender"));

        var rejected = await client.GetFromJsonAsync<JsonElement>("/api/staff/assessment/rejected");
        Assert.False(rejected.GetProperty("rows")[0].TryGetProperty("ReasonForRejection", out _));
    }
}
