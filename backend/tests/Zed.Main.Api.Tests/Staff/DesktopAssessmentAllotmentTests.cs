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
        // 2026-11-14: the assessors' levels and modes, from their old type (ASSESSOR1 a Bronze Assessor, ASSESSOR9 an Assessor).
        object[] Scope(string? id) => id?.ToUpperInvariant() switch
        {
            "ASSESSOR1" => [new { UserId = "ASSESSOR1", AssessmentModes = (string?)null, AssessorType = "BronzeAssessor" }],
            "ASSESSOR9" => [new { UserId = "ASSESSOR9", AssessmentModes = (string?)null, AssessorType = "Assessor" }],
            _ => [],
        };
        _host.Sql.Queries[Zed.Portal.Features.Staff.Users.AssessorScope.ByRoleSql] = _ => [.. Scope("ASSESSOR1"), .. Scope("ASSESSOR9")];
        _host.Sql.Queries[Zed.Portal.Features.Staff.Users.AssessorScope.OfUserSql] = args => Scope(FakeSql.Arg(args, "UserId"));
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
        // One list of the agency's assessors with their levels and modes (2026-11-14); the page offers those ticked for the level.
        var bronze = json.GetProperty("bronzeAssessors").EnumerateArray().Single(p => p.GetProperty("userId").GetString() == "ASSESSOR1");
        Assert.False(bronze.TryGetProperty("noOfAllocationsInDay", out _));
        var ticks = bronze.GetProperty("assessments").EnumerateArray().Single();
        Assert.Equal(("Bronze", "Desktop"), (ticks.GetProperty("level").GetString(), ticks.GetProperty("modes")[0].GetString()));

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
        var r = await client.PostAsJsonAsync("/api/staff/assessment/da-allotment/reject", new { zedId = "ZEDMSME000001", certification = "Bronze", reasonId = " " });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        r = await client.PostAsJsonAsync("/api/staff/assessment/da-allotment/reject", new { zedId = "ZEDMSME000001", certification = "Bronze", reasonId = "other", remarks = "No capacity" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Single(DaTestUsers.CallsTo(_host.Sql, "SP_ASSESSMENT_REJECT_UNIT_FOR_DA"));
        Assert.Equal("zed@qcin.org", Assert.Single(_host.Email.Sent).To);
    }

    [Fact]
    public async Task Zedx_goes_only_to_agencies_that_assess_the_units_kind()
    {
        _host.Sql.Procs["SP_ASSESSMENT_AGENCIES_TO_ALLOT"] = _ => FakeSql.Sets([
            new { UserId = "AGENCYM", UserName = "Manufacturing agency", SiteVerification = true },
            new { UserId = "AGENCYS", UserName = "Services agency", SiteVerification = true },
            new { UserId = "AGENCYB", UserName = "Both", SiteVerification = true },
            new { UserId = "AGENCYN", UserName = "Not set yet", SiteVerification = true },
        ]);
        // The unit: NIC 62, a Services sector in Master → Sectors.
        _host.Sql.Queries[Zed.Portal.Features.Staff.Users.UserSectorActivity.UnitSql] = _ => [new { Activity = "Manufacturing", TwoDigitActivity = "62 - IT" }];
        _host.Sql.Queries[Zed.Portal.Features.Staff.Users.UserSectorActivity.SectorTypesSql] = _ => [new { SectorCode = "62", SectorType = "Services" }];
        _host.Sql.Queries[Zed.Portal.Features.Staff.Users.UserSectorActivity.ByRoleSql] = _ =>
            [new { UserId = "AGENCYM", SectorActivity = "Manufacturing" }, new { UserId = "AGENCYS", SectorActivity = "Services" }, new { UserId = "AGENCYB", SectorActivity = "Both" }];
        // The unit waits for an agency on the Allot list.
        _host.Sql.Procs["SP_ASSESSMENT_ALLOT_LIST"] = _ => FakeSql.Sets([new { ZedId = "ZEDMSME000001", Certification = "ZEDX", CertificationStatus = 2 }]);
        var client = await DaTestUsers.SignInAsync(_host, "MADMIN");

        var agencies = await client.GetFromJsonAsync<JsonElement>("/api/staff/assessment/allot/agencies?zedId=ZEDMSME000001&certification=zedx");
        Assert.Equal(["AGENCYS", "AGENCYB", "AGENCYN"], agencies.EnumerateArray().Select(a => a.GetProperty("userId").GetString()));
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/staff/assessment/allot",
            new { zedId = "ZEDMSME000001", certification = "ZEDX", agencyUserId = "AGENCYM" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/staff/assessment/allot",
            new { zedId = "ZEDMSME000001", certification = "ZEDX", agencyUserId = "AGENCYS" })).StatusCode);
        Assert.Equal("ZEDX", FakeSql.Arg(DaTestUsers.CallsTo(_host.Sql, "SP_ASSESSMENT_ALLOT_TO_AGENCY").Single().Args, "Certification"));
        // 2026-11-14: a Remote only / Onsite only level then skips the desktop step (the procedure decides by the level's flow).
        Assert.Equal("ZEDX", FakeSql.Arg(DaTestUsers.CallsTo(_host.Sql, "SP_V4_SKIP_DESKTOP").Single().Args, "Certification"));
    }

    [Fact]
    public async Task Master_admin_cannot_allot_a_level_the_agency_was_disabled_for()
    {
        _host.Sql.Procs["SP_ASSESSMENT_AGENCIES_TO_ALLOT"] = _ => FakeSql.Sets([
            new { UserId = "AGENCYA", UserName = "Gold allowed", SiteVerification = true },
            new { UserId = "AGENCYOFF", UserName = "Gold disabled", SiteVerification = true },
        ]);
        _host.Sql.Queries[Zed.Portal.Features.Staff.Users.AgencyLevels.DisabledSql(Zed.Portal.Features.Staff.Users.AgencyLevels.Find("Gold")!)] = _ =>
            [new { UserId = "AGENCYOFF" }];
        _host.Sql.Procs["SP_ASSESSMENT_ALLOT_LIST"] = _ => FakeSql.Sets([new { ZedId = "ZEDMSME000001", Certification = "Gold", CertificationStatus = 2 }]);
        var client = await DaTestUsers.SignInAsync(_host, "MADMIN");

        var agencies = await client.GetFromJsonAsync<JsonElement>("/api/staff/assessment/allot/agencies?zedId=ZEDMSME000001&certification=Gold");
        Assert.Equal(["AGENCYA"], agencies.EnumerateArray().Select(a => a.GetProperty("userId").GetString()));
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/staff/assessment/allot",
            new { zedId = "ZEDMSME000001", certification = "Gold", agencyUserId = "AGENCYOFF" })).StatusCode);
        Assert.Empty(DaTestUsers.CallsTo(_host.Sql, "SP_ASSESSMENT_ALLOT_TO_AGENCY"));
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

    [Theory]
    // 2026-11-25 (the user: Bronze set to Onsite only, yet every agency was offered): the level's flow decides the permissions.
    [InlineData("Onsite", "AGENCYSV,AGENCYBOTH")]
    [InlineData("Remote", "AGENCYSV,AGENCYBOTH")]
    [InlineData("Desktop", "AGENCY1,AGENCYBOTH")]
    [InlineData("DesktopOnsite", "AGENCYSV,AGENCYBOTH")]
    [InlineData("DesktopRemote", "AGENCYSV,AGENCYBOTH")]
    public async Task Master_admin_is_offered_only_agencies_with_the_permissions_of_the_levels_flow(string flow, string offered)
    {
        _host.Sql.Procs["SP_ASSESSMENT_AGENCIES_TO_ALLOT"] = _ => FakeSql.Sets([
            new { UserId = "AGENCY1", UserName = "Desktop only", DesktopVerification = true, SiteVerification = false },
            new { UserId = "AGENCYSV", UserName = "Remote/Onsite only", DesktopVerification = false, SiteVerification = true },
            new { UserId = "AGENCYBOTH", UserName = "Both", DesktopVerification = true, SiteVerification = true },
        ]);
        _host.Sql.Queries[Zed.Portal.Features.CertLevels.LevelFlows.ReadSql] = _ =>
            [new { Code = "Bronze", AssessmentFlow = flow, SurveillanceMode = "Remote" }];
        var client = await DaTestUsers.SignInAsync(_host, "MADMIN");

        var agencies = await client.GetFromJsonAsync<JsonElement>("/api/staff/assessment/allot/agencies?zedId=ZEDMSME000001&certification=Bronze");
        Assert.Equal(offered.Split(','), agencies.EnumerateArray().Select(a => a.GetProperty("userId").GetString()));
        if (flow == "Onsite")
        {
            // The agency without onsite permission is refused by the server too (the pop-up is not the only guard).
            Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/staff/assessment/allot",
                new { zedId = "ZEDMSME000001", certification = "Bronze", agencyUserId = "AGENCY1" })).StatusCode);
            Assert.Empty(DaTestUsers.CallsTo(_host.Sql, "SP_ASSESSMENT_ALLOT_TO_AGENCY"));
        }
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

        // 2026-11-17 (approved redesign): the Rejected list has its reason column too.
        var rejected = await client.GetFromJsonAsync<JsonElement>("/api/staff/assessment/rejected");
        Assert.Equal("Withdrawn by the unit", rejected.GetProperty("rows")[0].GetProperty("ReasonForRejection").GetString());
    }

    // ----- 2026-11-18 (the user: staff pages 'not aligned with SVG files'): the count cards of staff-11 / staff-12 -----

    [Fact]
    public async Task Completed_counts_read_every_row_of_the_filter()
    {
        var today = DateTime.UtcNow.AddMinutes(330).Date;
        string F(DateTime d) => d.ToString("MMMM d, yyyy", System.Globalization.CultureInfo.InvariantCulture);
        _host.Sql.Procs["SP_MONITORING_GET_LIST_PAGINATION"] = _ => FakeSql.Sets(
            [
                new { ZedId = "ZEDMSME000001", Certification = "Bronze", CertificationStatusDate = F(today), FirstSurveDueDate = F(today.AddDays(30)), SameUdyamAddress = 2 },
                new { ZedId = "ZEDMSME000002", Certification = "Silver", CertificationStatusDate = F(today.AddMonths(-2)), FirstSurveDueDate = F(today.AddDays(200)), SameUdyamAddress = 0 },
                new { ZedId = "ZEDMSME000003", Certification = "Gold", CertificationStatusDate = (string?)null, FirstSurveDueDate = F(today.AddDays(-3)), SameUdyamAddress = 1 },
            ],
            [new { TotalCounts = 3, PageNo = 1, PageSize = 100000 }]);
        var client = await DaTestUsers.SignInAsync(_host, "AGENCY1");
        var json = await client.GetFromJsonAsync<JsonElement>("/api/staff/assessment/completed/counts?certification=Bronze");
        Assert.Equal(3, json.GetProperty("total").GetInt32());
        Assert.Equal(1, json.GetProperty("certifiedThisMonth").GetInt32());
        Assert.Equal(1, json.GetProperty("surveillanceDue90").GetInt32());
        Assert.Equal(2, json.GetProperty("duplicates").GetInt32());
        Assert.Equal(JsonValueKind.Null, json.GetProperty("waitingReallot").ValueKind);
        var call = DaTestUsers.CallsTo(_host.Sql, "SP_MONITORING_GET_LIST_PAGINATION").Last();
        Assert.Equal("6", FakeSql.Arg(call.Args, "Status"));
        Assert.Equal("Bronze", FakeSql.Arg(call.Args, "CertificationType"));
        Assert.Equal("100000", FakeSql.Arg(call.Args, "PageSize"));
        // The list itself still pages at most 200: a larger size from the query string falls back to 20.
        await client.GetFromJsonAsync<JsonElement>("/api/staff/assessment/completed?pageSize=100000");
        Assert.Equal("20", FakeSql.Arg(DaTestUsers.CallsTo(_host.Sql, "SP_MONITORING_GET_LIST_PAGINATION").Last().Args, "PageSize"));
    }

    [Fact]
    public async Task Rejected_counts_tell_waiting_from_reallotted_by_the_live_record()
    {
        _host.Sql.Procs["SP_MONITORING_GET_LIST_PAGINATION"] = _ => FakeSql.Sets(
            [
                new { ZedId = "ZEDMSME000001", RejectedZedId = "ZEDMSME000001_D_7", Certification = "Bronze" },
                new { ZedId = "ZEDMSME000002", RejectedZedId = "ZEDMSME000002_R_8", Certification = "Silver" },
                new { ZedId = "ZEDMSME000003", RejectedZedId = "ZEDMSME000003_R_9", Certification = "Gold" },
            ],
            [new { TotalCounts = 3, PageNo = 1, PageSize = 100000 }]);
        _host.Sql.Queries[Zed.Portal.Features.Staff.Assessment.AssessmentResultsController.LiveStatusSql] = _ =>
        [
            new { ZedId = "ZEDMSME000001", Certification = "Bronze", CertificationStatus = (int?)2 },
            new { ZedId = "ZEDMSME000002", Certification = "Silver", CertificationStatus = (int?)9 },
            // Another level of the unit is not this record's.
            new { ZedId = "ZEDMSME000003", Certification = "Bronze", CertificationStatus = (int?)3 },
        ];
        var client = await DaTestUsers.SignInAsync(_host, "AGENCY1");
        var json = await client.GetFromJsonAsync<JsonElement>("/api/staff/assessment/rejected/counts");
        Assert.Equal(3, json.GetProperty("total").GetInt32());
        Assert.Equal(1, json.GetProperty("waitingReallot").GetInt32());
        Assert.Equal(1, json.GetProperty("reallotted").GetInt32());
        Assert.Equal("99", FakeSql.Arg(DaTestUsers.CallsTo(_host.Sql, "SP_MONITORING_GET_LIST_PAGINATION").Last().Args, "Status"));
    }

    [Fact]
    public async Task Result_rows_carry_district_and_state()
    {
        _host.Sql.Procs["SP_MONITORING_GET_LIST_PAGINATION"] = _ => FakeSql.Sets(
            [new { RowNumber = 1, ZedId = "ZEDMSME000001", Certification = "Bronze", PDistrictName = "Pune", PStateName = "Maharashtra", PPin = "411001" }],
            [new { TotalCounts = 1, PageNo = 1, PageSize = 20 }]);
        var client = await DaTestUsers.SignInAsync(_host, "AGENCY1");
        var row = (await client.GetFromJsonAsync<JsonElement>("/api/staff/assessment/completed")).GetProperty("rows")[0];
        Assert.Equal("Pune", row.GetProperty("PDistrictName").GetString());
        Assert.Equal("Maharashtra", row.GetProperty("PStateName").GetString());
        Assert.False(row.TryGetProperty("PPin", out _));
    }

    [Fact]
    public async Task Assessor_completed_rows_take_the_allotment_and_completion_dates_from_the_history()
    {
        _host.Sql.Procs["SP_MONITORING_GET_LIST_PAGINATION"] = _ => FakeSql.Sets(
            [
                new { ZedId = "ZEDMSME000001", RejectedZedId = "ZEDMSME000001", Certification = "Bronze", DeskAssessment = "D", DocVerifiAllot = "November 12, 2026",
                      DesktopVerificationCompleted = (string?)null, CertificationStatusDate = "November 14, 2026" },
                new { ZedId = "ZEDMSME000002", RejectedZedId = "ZEDMSME000002", Certification = "Silver", DeskAssessment = "", DocVerifiAllot = "November 2, 2026",
                      DesktopVerificationCompleted = (string?)"November 5, 2026", CertificationStatusDate = "November 20, 2026" },
            ],
            [new { TotalCounts = 2, PageNo = 1, PageSize = 20 }]);
        _host.Sql.Queries[Zed.Portal.Features.Staff.Assessment.AssessmentResultsController.HistoryDatesSql] = _ =>
        [
            new { ZedId = "ZEDMSME000001", CertificationType = "Bronze", StatusType = "DocVerifiAllot", CreatedDate = (DateTime?)new DateTime(2026, 11, 10, 9, 0, 0) },
            new { ZedId = "ZEDMSME000001", CertificationType = "Bronze", StatusType = "Completed", CreatedDate = (DateTime?)new DateTime(2026, 11, 14, 9, 0, 0) },
            // Another level's history is not this record's; a site-only row keeps the procedure's allotment date.
            new { ZedId = "ZEDMSME000001", CertificationType = "Silver", StatusType = "DesktopVerification", CreatedDate = (DateTime?)new DateTime(2026, 1, 1) },
            new { ZedId = "ZEDMSME000002", CertificationType = "Silver", StatusType = "DocVerifiAllot", CreatedDate = (DateTime?)new DateTime(2026, 10, 1) },
            new { ZedId = "ZEDMSME000002", CertificationType = "Silver", StatusType = "DesktopVerification", CreatedDate = (DateTime?)new DateTime(2026, 10, 9) },
        ];
        var client = await DaTestUsers.SignInAsync(_host, "ASSESSOR1");
        var rows = (await client.GetFromJsonAsync<JsonElement>("/api/staff/assessment/completed")).GetProperty("rows");
        Assert.Equal("November 10, 2026", rows[0].GetProperty("DocVerifiAllot").GetString());
        Assert.Equal(JsonValueKind.Null, rows[0].GetProperty("DesktopVerificationCompleted").ValueKind);
        Assert.Equal("November 14, 2026", rows[0].GetProperty("CompletedOn").GetString());
        Assert.Equal("November 2, 2026", rows[1].GetProperty("DocVerifiAllot").GetString());
        Assert.Equal("November 5, 2026", rows[1].GetProperty("DesktopVerificationCompleted").GetString());
        var query = _host.Sql.Calls.Single(c => c.Name == Zed.Portal.Features.Staff.Assessment.AssessmentResultsController.HistoryDatesSql);
        Assert.Equal(["ZEDMSME000001", "ZEDMSME000002"], (string[])query.Args!.GetType().GetProperty("ZedIds")!.GetValue(query.Args)!);

        // The agency's list and the counts do not read the history.
        var agency = await DaTestUsers.SignInAsync(_host, "AGENCY1");
        await agency.GetFromJsonAsync<JsonElement>("/api/staff/assessment/completed");
        await client.GetFromJsonAsync<JsonElement>("/api/staff/assessment/completed/counts");
        Assert.Single(_host.Sql.Calls, c => c.Name == Zed.Portal.Features.Staff.Assessment.AssessmentResultsController.HistoryDatesSql);
    }

    // ----- 2026-11-17 (approved redesign): Waiting column and bulk allotment -----

    [Fact]
    public async Task Allot_list_rows_carry_the_payment_date_district_state_and_size()
    {
        _host.Sql.Procs["SP_ASSESSMENT_ALLOT_LIST"] = _ => FakeSql.Sets([
            new { ZedId = "ZEDMSME000001", Certification = "Bronze", CertificationStatus = 2, PDistrictName = "Pune", PStateName = "Maharashtra", EnterpriseTypee = "Small", MobileNo = "9" },
            new { ZedId = "ZEDMSME000002", Certification = "Silver", CertificationStatus = 2, PDistrictName = "Agra", PStateName = "Uttar Pradesh", EnterpriseTypee = "Micro", MobileNo = "9" },
        ], []);
        _host.Sql.Queries[Zed.Portal.Features.Staff.Assessment.AssessmentAllotmentController.PaidOnSql(false)] = _ =>
        [
            new { ZedId = "ZEDMSME000001", Certification = "Bronze", Milestone = (string?)null, PaidOn = (DateTime?)new DateTime(2026, 11, 11, 10, 0, 0) },
            // Another level's payment is not this record's.
            new { ZedId = "ZEDMSME000002", Certification = "Bronze", Milestone = (string?)null, PaidOn = (DateTime?)new DateTime(2026, 1, 1) },
        ];
        var client = await DaTestUsers.SignInAsync(_host, "MADMIN");
        var rows = (await client.GetFromJsonAsync<JsonElement>("/api/staff/assessment/allot")).GetProperty("rows");
        Assert.StartsWith("2026-11-11", rows[0].GetProperty("PaidOn").GetString());
        Assert.Equal("Pune", rows[0].GetProperty("PDistrictName").GetString());
        Assert.Equal("Small", rows[0].GetProperty("EnterpriseTypee").GetString());
        Assert.Equal(JsonValueKind.Null, rows[1].GetProperty("PaidOn").ValueKind);
        Assert.False(rows[0].TryGetProperty("MobileNo", out _));
        var query = _host.Sql.Calls.Single(c => c.Name.StartsWith("SELECT ZedId, Certification, CAST(", StringComparison.Ordinal));
        Assert.Equal(["ZEDMSME000001", "ZEDMSME000002"], (string[])query.Args!.GetType().GetProperty("ZedIds")!.GetValue(query.Args)!);
    }

    [Fact]
    public async Task Bulk_allotment_applies_the_single_rules_to_each_unit_and_answers_per_unit()
    {
        // ZEDMSME000001 waits on the list (Bronze: AGENCY1 is eligible); ZEDMSME000099 is not on it.
        var client = await DaTestUsers.SignInAsync(_host, "MADMIN");
        var r = await client.PostAsJsonAsync("/api/staff/assessment/allot/bulk", new
        {
            units = new[]
            {
                new { zedId = "ZEDMSME000001", certification = "bronze" },
                new { zedId = "ZEDMSME000099", certification = "Bronze" },
                new { zedId = "ZEDMSME000001", certification = "Bronze" },
            },
            agencyUserId = "AGENCY1",
        });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var json = await r.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1, json.GetProperty("allotted").GetInt32());
        Assert.Equal(2, json.GetProperty("refused").GetInt32());
        var results = json.GetProperty("results");
        Assert.True(results[0].GetProperty("allotted").GetBoolean());
        Assert.Equal("Bronze", results[0].GetProperty("certification").GetString());
        Assert.False(results[1].GetProperty("allotted").GetBoolean());
        Assert.Equal("This assessment can no longer be allotted.", results[1].GetProperty("message").GetString());
        Assert.False(results[2].GetProperty("allotted").GetBoolean());
        var call = DaTestUsers.CallsTo(_host.Sql, "SP_ASSESSMENT_ALLOT_TO_AGENCY").Single();
        Assert.Equal("ZEDMSME000001", FakeSql.Arg(call.Args, "ZedId"));
        Assert.Equal("AGENCY1", FakeSql.Arg(call.Args, "CertificationBodyUserId"));
        Assert.Equal("agency@x.test", Assert.Single(_host.Email.Sent).To);
    }

    [Fact]
    public async Task Bulk_allotment_refuses_an_agency_not_offered_for_the_unit()
    {
        var client = await DaTestUsers.SignInAsync(_host, "MADMIN");
        var json = await (await client.PostAsJsonAsync("/api/staff/assessment/allot/bulk", new
        {
            units = new[] { new { zedId = "ZEDMSME000001", certification = "Bronze" } },
            agencyUserId = "AGENCYSV", // site verification only: not offered for Bronze
        })).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(0, json.GetProperty("allotted").GetInt32());
        Assert.Equal("Please select valid data.", json.GetProperty("results")[0].GetProperty("message").GetString());
        Assert.Empty(DaTestUsers.CallsTo(_host.Sql, "SP_ASSESSMENT_ALLOT_TO_AGENCY"));
    }

    [Theory]
    [InlineData("AGENCY1")]
    [InlineData("ASSESSOR1")]
    public async Task Bulk_allotment_is_for_the_master_admin_only(string user)
    {
        var client = await DaTestUsers.SignInAsync(_host, user);
        var r = await client.PostAsJsonAsync("/api/staff/assessment/allot/bulk",
            new { units = new[] { new { zedId = "ZEDMSME000001", certification = "Bronze" } }, agencyUserId = "AGENCY1" });
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
        Assert.Empty(DaTestUsers.CallsTo(_host.Sql, "SP_ASSESSMENT_ALLOT_TO_AGENCY"));
    }

    [Fact]
    public async Task Bulk_allotment_needs_units_an_agency_and_at_most_the_limit()
    {
        var client = await DaTestUsers.SignInAsync(_host, "MADMIN");
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/staff/assessment/allot/bulk",
            new { units = Array.Empty<object>(), agencyUserId = "AGENCY1" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/staff/assessment/allot/bulk",
            new { units = new[] { new { zedId = "ZEDMSME000001", certification = "Bronze" } }, agencyUserId = "bad id!" })).StatusCode);
        var many = Enumerable.Range(0, Zed.Portal.Features.Staff.Assessment.AssessmentAllotmentController.BulkLimit + 1)
            .Select(i => new { zedId = $"ZEDMSME{i:000000}", certification = "Bronze" }).ToArray();
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/staff/assessment/allot/bulk",
            new { units = many, agencyUserId = "AGENCY1" })).StatusCode);
        Assert.Empty(DaTestUsers.CallsTo(_host.Sql, "SP_ASSESSMENT_ALLOT_TO_AGENCY"));
    }
}
