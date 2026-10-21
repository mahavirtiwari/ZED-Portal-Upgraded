using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Zed.Core.Data;
using Zed.Main.Api.Tests;

namespace Zed.Consultancy.Api.Tests;

/// <summary>Signs test clients in through the real staff login of this host (SP_GET_USER_DETAILS faked).</summary>
internal static class ConsultancyLogin
{
    public static readonly Dictionary<string, int> Users = new(StringComparer.OrdinalIgnoreCase)
    {
        ["ADMIN1"] = 1, ["CO1"] = 2, ["CO2"] = 2, ["CONS1"] = 3, ["COORD1"] = 6, ["MASTER1"] = 7, ["MIN1"] = 8, ["SUPER1"] = 10, ["CF1"] = 11,
    };

    public static void Setup(TestHost host, int desktop = 1, int site = 1, int financial = 1)
    {
        host.Sql.Procs["SP_GET_USER_DETAILS"] = args =>
        {
            var id = FakeSql.Arg(args, "UserId") ?? "";
            return Users.TryGetValue(id, out var role)
                ? FakeSql.Sets([new { UserId = id.ToUpperInvariant(), UserName = id + " name", RoleId = role, Email = id.ToLowerInvariant() + "@zed.test", Password = "Right#Pass1" }], [new { ERRORMSG = "SUCCESS" }])
                : FakeSql.Sets([], [new { ERRORMSG = "INVALID CREDENTIAILS" }]);
        };
        host.Sql.Procs["SP_GET_SUB_ROLE"] = _ => FakeSql.Sets([new { DesktopVerification = desktop, SiteVerification = site, FinancialVerification = financial }]);
    }

    public static async Task<HttpClient> SignInAsync(TestHost host, string userId)
    {
        var client = await host.CreateBrowserAsync();
        (await client.PostAsJsonAsync("/api/staff/auth/login", new { userId, password = "Right#Pass1" })).EnsureSuccessStatusCode();
        return client;
    }

    public static bool Has(object? args, string name) => args?.GetType().GetProperty(name) is not null;
}

public sealed class ConsultancyStaffTests : IDisposable
{
    private readonly TestHost _host = new();
    private readonly Dictionary<string, Dictionary<string, object?>> _users = new(StringComparer.OrdinalIgnoreCase);

    public ConsultancyStaffTests()
    {
        ConsultancyLogin.Setup(_host);
        _users["ZEDCO0001"] = new()
        {
            ["UserId"] = "ZEDCO0001", ["UserName"] = "Acme Consultants", ["RoleId"] = 2, ["CreatedBy"] = "MASTER1", ["IsActive"] = true,
            ["Email"] = "co@acme.test", ["MobileNo"] = "9876543210", ["SpocName"] = "Spoc", ["Address"] = "Plot 1", ["Pincode"] = "110001",
            ["Password"] = "copw", ["SiteVerification"] = true, ["FinancialVerification"] = true, ["DesktopVerification"] = true, ["TuPreferredState"] = "28",
        };
        _users["ZEDCC0001"] = Person("ZEDCC0001", 3, "CO1");
        _users["ZEDCT0001"] = Person("ZEDCT0001", 33, "CO1");
        _users["ZEDCC0002"] = Person("ZEDCC0002", 3, "CO2");
        _host.Sql.Procs["SP_GET_USER_DETAILS_BY_USER_ID"] = args =>
            _users.TryGetValue(FakeSql.Arg(args, "UserId") ?? "", out var u)
                ? FakeSql.Sets([u], [new { States = "DELHI" }], [new { States = "24" }], [new { States = "Quality" }])
                : FakeSql.Sets([], [], [], []);
        _host.Sql.Procs["SP_MASTER_GET_SECTORS"] = _ => FakeSql.Sets([new { SectorCode = "24", SectorName = "Basic metals" }]);
        _host.Sql.Procs["SP_MASTER_GET_AREA_OF_KNOWLEDGE"] = _ => FakeSql.Sets([new { AreaOfknowledge = "Quality" }]);
        _host.Sql.Queries["SELECT DistrictCode, DistrictName FROM Districts"] = args =>
            FakeSql.Arg(args, "StateCode") == "28" ? [new { DistrictCode = "502", DistrictName = "Guntur" }, new { DistrictCode = "503", DistrictName = "Krishna" }] : [];
        _host.Sql.Queries["SELECT Districts FROM TuAgencyUserDistricts"] = _ => ["502"];
    }

    private static Dictionary<string, object?> Person(string id, int role, string createdBy) => new()
    {
        ["UserId"] = id, ["UserName"] = id + " name", ["RoleId"] = role, ["CreatedBy"] = createdBy, ["IsActive"] = true,
        ["Email"] = id.ToLowerInvariant() + "@zed.test", ["MobileNo"] = "9000000001", ["Address"] = "Street", ["Pincode"] = "560001",
        ["IdProofType"] = "PAN Card", ["IdProofNumber"] = "ABCDE1234F", ["Password"] = "pw", ["CertificateNo"] = "CO1234",
    };

    public void Dispose() => _host.Dispose();

    private (string Name, object? Args) Call(string proc) => _host.Sql.Calls.Last(c => c.Name == proc);

    // ---- hosting and sign-in -------------------------------------------------------------

    [Fact]
    public async Task Staff_sign_in_change_password_and_logout_are_served_here()
    {
        var client = await ConsultancyLogin.SignInAsync(_host, "MASTER1");
        var me = await client.GetFromJsonAsync<JsonElement>("/api/auth/me");
        Assert.Equal("MASTER1", me.GetProperty("userId").GetString());
        var r = await client.PostAsJsonAsync("/api/account/change-password", new { oldPassword = "", newPassword = "x", confirmPassword = "x" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync("/api/auth/logout", null)).StatusCode);
    }

    [Fact]
    public async Task The_old_virtual_directory_works_as_path_base()
    {
        using var factory = _host.WithWebHostBuilder(b => b.UseSetting("Portal:PathBase", "/Consultancy"));
        var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/Consultancy/api/health")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.GetAsync("/consultancy/api/auth/me")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/Consultancy/api/nothing-here")).StatusCode);
    }

    // ---- Consultant Organisations ---------------------------------------------------------

    [Fact]
    public async Task Creating_a_consultant_organisation_uses_the_consultancy_parameters_and_wording()
    {
        _host.Sql.Procs["SP_INSERT_USER"] = _ => FakeSql.Sets([new Dictionary<string, object?> { [""] = "ZEDCO0099" }]);
        var client = await ConsultancyLogin.SignInAsync(_host, "MASTER1");
        var r = await client.PostAsJsonAsync("/api/staff/users/agencies", new
        {
            userName = "New CO", spocName = "Spoc", emailId = "new@co.test", mobileNo = "9876501234", address = "Addr", pinCode = "110002",
            states = new[] { "DELHI" }, nicSectors = new[] { "24" }, desktopVerification = false, siteVerification = true, financialVerification = true,
            tuPreferredState = "28", tuPreferredDistricts = new[] { "502", "503" },
        });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var args = Call("SP_INSERT_USER").Args;
        Assert.False(ConsultancyLogin.Has(args, "AssessorType"));
        Assert.False(ConsultancyLogin.Has(args, "OrgPartnerId"));
        Assert.Equal("28", FakeSql.Arg(args, "TuPreferredState"));
        Assert.Equal("502,503", FakeSql.Arg(args, "TuPreferredDistricts"));
        var mail = Assert.Single(_host.Email.Sent);
        Assert.StartsWith("Consultant Organisation Login Details", mail.Subject);
        Assert.Contains("Consultant Organisation", mail.HtmlBody);
        Assert.DoesNotContain("Assessment Agency", mail.HtmlBody);
    }

    [Fact]
    public async Task Tu_districts_must_belong_to_the_state_and_partners_are_refused()
    {
        var client = await ConsultancyLogin.SignInAsync(_host, "MASTER1");
        var bad = await client.PostAsJsonAsync("/api/staff/users/agencies", new
        {
            userName = "New CO", spocName = "Spoc", emailId = "new@co.test", mobileNo = "9876501234", address = "Addr", pinCode = "110002",
            states = new[] { "DELHI" }, nicSectors = new[] { "24" }, siteVerification = true, financialVerification = true,
            tuPreferredState = "28", tuPreferredDistricts = new[] { "999" },
        });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        Assert.Equal("Please select valid districts of the applicable state.", await bad.ProblemTitle());
        var partner = await client.PostAsJsonAsync("/api/staff/users/agencies", new
        {
            userName = "New CO", spocName = "Spoc", emailId = "new@co.test", mobileNo = "9876501234", address = "Addr", pinCode = "110002",
            states = new[] { "DELHI" }, nicSectors = new[] { "24" }, siteVerification = true, orgPartnerId = "OP1",
        });
        Assert.Equal(HttpStatusCode.BadRequest, partner.StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_INSERT_USER");
    }

    [Fact]
    public async Task Updating_a_co_cannot_drop_both_handholding_and_tu_and_returns_its_districts()
    {
        var client = await ConsultancyLogin.SignInAsync(_host, "MASTER1");
        var details = await client.GetFromJsonAsync<JsonElement>("/api/staff/users/agencies/ZEDCO0001");
        Assert.Equal("28", details.GetProperty("tuPreferredState").GetString());
        Assert.Equal("502", details.GetProperty("tuPreferredDistricts")[0].GetString());
        Assert.DoesNotContain("copw", details.GetRawText());

        var r = await client.PutAsJsonAsync("/api/staff/users/agencies/ZEDCO0001", new
        {
            userName = "Acme", spocName = "Spoc", emailId = "co@acme.test", mobileNo = "9876543210", address = "Addr", pinCode = "110001",
            desktopVerification = true, siteVerification = false, financialVerification = false,
        });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_UPDATE_USER");

        var ok = await client.PutAsJsonAsync("/api/staff/users/agencies/ZEDCO0001", new
        {
            userName = "Acme", spocName = "Spoc", emailId = "co@acme.test", mobileNo = "9876543210", address = "Addr", pinCode = "110001",
            desktopVerification = true, siteVerification = true, financialVerification = false, tuPreferredState = "28",
        });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var args = Call("SP_UPDATE_USER").Args;
        Assert.Equal("ZEDCO0001", FakeSql.Arg(args, "UserId"));
        Assert.Null(FakeSql.Arg(args, "TuPreferredState")); // no TU verification, no TU preference
        Assert.False(ConsultancyLogin.Has(args, "AssessorType"));
    }

    [Fact]
    public async Task Block_is_an_inline_update_of_that_role_with_a_blocked_mail_and_bronze_does_not_exist()
    {
        var client = await ConsultancyLogin.SignInAsync(_host, "MASTER1");
        var r = await client.PostAsJsonAsync("/api/staff/users/agencies/ZEDCO0001/block", new { reason = "Inactive" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var update = _host.Sql.Calls.Last(c => c.Name.StartsWith("UPDATE Users SET IsActive", StringComparison.Ordinal));
        Assert.Contains("AND RoleId = @RoleId", update.Name);
        Assert.Equal("2", FakeSql.Arg(update.Args, "RoleId"));
        Assert.Equal("False", FakeSql.Arg(update.Args, "IsActive"));
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_BLOCK_UNBLOCK_USER");
        var mail = Assert.Single(_host.Email.Sent);
        Assert.Contains("Blocked", mail.HtmlBody);
        Assert.DoesNotContain("copw", mail.HtmlBody);

        Assert.Equal(HttpStatusCode.NotFound,
            (await client.PostAsJsonAsync("/api/staff/users/agencies/ZEDCO0001/bronze-assessments", new { allow = true })).StatusCode);
    }

    // ---- Consultants / Experts -----------------------------------------------------------

    [Fact]
    public async Task A_co_creates_a_consultant_through_the_lookup_with_type_3()
    {
        _host.Sql.Procs["SP_GET_PROFESSIONAL_DETAILS_BY_CERT_NO_duplicatetest"] = args => FakeSql.Arg(args, "AssessorType") == "3"
            ? FakeSql.Sets([new { Email = "pro@zed.test", ContactNumber = "9111111111", Name = "Real Consultant", CertificateNo = "{}" }],
                [new { Status = 1, ErrorMessage = "ok" }])
            : FakeSql.Sets([], [new { Status = 0, ErrorMessage = "Unauthorised User." }]);
        _host.Sql.Procs["SP_GET_USER_DETAILS_BY_NAME"] = _ => FakeSql.Sets([new { UserId = "ZEDCC0099" }]);
        var client = await ConsultancyLogin.SignInAsync(_host, "CO1");
        var r = await client.PostAsJsonAsync("/api/staff/users/assessors", new
        {
            assessorType = "Consultant", certificateNo = "CO1234", professionalEmail = "pro@zed.test", address = "Addr", pinCode = "560001",
            idProofType = "PAN Card", idProofNumber = "ABCDE1234F", states = new[] { "DELHI" },
        });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("ZEDCC0099", (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("userId").GetString());
        var args = Call("SP_INSERT_USER").Args;
        Assert.Equal("3", FakeSql.Arg(args, "RoleId"));
        Assert.Equal("Real Consultant", FakeSql.Arg(args, "UserName"));
        Assert.Equal("CO1", FakeSql.Arg(args, "CreatedBy"));
        Assert.False(ConsultancyLogin.Has(args, "AssessorType"));
        Assert.StartsWith("Consultant/Expert Login Details", Assert.Single(_host.Email.Sent).Subject);
    }

    [Fact]
    public async Task A_co_creates_a_technical_expert_with_typed_details_as_role_33()
    {
        _host.Sql.Procs["SP_GET_USER_DETAILS_BY_NAME"] = _ => FakeSql.Sets([new { UserId = "ZEDCT0099" }]);
        var client = await ConsultancyLogin.SignInAsync(_host, "CO1");
        var bad = await client.PostAsJsonAsync("/api/staff/users/assessors", new { assessorType = "TechnicalExpert", userName = "X", emailId = "bad", mobileNo = "1" });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        var r = await client.PostAsJsonAsync("/api/staff/users/assessors", new
        {
            assessorType = "TechnicalExpert", userName = "Tech Expert", emailId = "tech@zed.test", mobileNo = "9222222222", address = "Addr",
            pinCode = "560001", idProofType = "PAN Card", idProofNumber = "ABCDE1234F",
        });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var args = Call("SP_INSERT_USER").Args;
        Assert.Equal("33", FakeSql.Arg(args, "RoleId"));
        Assert.Equal("Tech Expert", FakeSql.Arg(args, "UserName"));
        Assert.Null(FakeSql.Arg(args, "CertificateNo"));
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_GET_PROFESSIONAL_DETAILS_BY_CERT_NO_duplicatetest");
    }

    [Fact]
    public async Task A_co_manages_only_its_own_consultants_and_experts()
    {
        var client = await ConsultancyLogin.SignInAsync(_host, "CO1");
        var expert = await client.GetFromJsonAsync<JsonElement>("/api/staff/users/assessors/ZEDCT0001");
        Assert.Equal("TechnicalExpert", expert.GetProperty("userType").GetString());
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/staff/users/assessors/ZEDCC0002")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync("/api/staff/users/assessors/ZEDCC0002/block", new { reason = "x" })).StatusCode);

        var r = await client.PostAsJsonAsync("/api/staff/users/assessors/ZEDCT0001/block", new { reason = "Left" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var update = _host.Sql.Calls.Last(c => c.Name.StartsWith("UPDATE Users SET IsActive", StringComparison.Ordinal));
        Assert.Equal("33", FakeSql.Arg(update.Args, "RoleId"));
    }

    // ---- masters, fees, dashboards, reports, NEFT ----------------------------------------

    [Fact]
    public async Task Categories_and_technologies_do_not_exist_here_but_sectors_do()
    {
        var client = await ConsultancyLogin.SignInAsync(_host, "ADMIN1");
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/staff/masters/sectors")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/staff/masters/categories")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/staff/masters/technologies")).StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.Contains("CATEGOR", StringComparison.Ordinal) || c.Name.Contains("TECHNOLOG", StringComparison.Ordinal));
    }

    private static Dictionary<string, object?> FeeRow(int id, string cert, string milestone, decimal? coupon) => new()
    {
        ["Id"] = id, ["EnterpriseTypee"] = "Micro", ["Certification"] = cert, ["MileStone"] = milestone, ["SubsidyPercentage"] = 80m,
        ["AssessmentFee"] = 1000m, ["Coupon"] = coupon, ["IsActive"] = true,
    };

    [Fact]
    public async Task The_fee_master_sets_one_fee_per_milestone_and_keeps_the_coupon()
    {
        _host.Sql.Procs["SP_MASTER_GET_ASSESSMENT_FEE"] = _ => FakeSql.Sets(
            [FeeRow(1, "Silver", "MileStone1", null), FeeRow(2, "Silver", "MileStone2", null), FeeRow(3, "Gold", "MileStone1", 100m)]);
        var client = await ConsultancyLogin.SignInAsync(_host, "ADMIN1");
        var get = await client.GetFromJsonAsync<JsonElement>("/api/staff/fees/Micro");
        Assert.Equal("MileStone", get.GetProperty("groupBy").GetString());
        Assert.Equal(2, get.GetProperty("levels").GetArrayLength());
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/staff/fees/Rejected")).StatusCode);

        var r = await client.PutAsJsonAsync("/api/staff/fees/Micro", new { levels = new[] { new { certification = "MileStone1", assessmentFee = 2000m } } });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var updates = _host.Sql.Calls.Where(c => c.Name == "SP_MASTER_UPDATE_ASSESSMENT_FEE").ToList();
        Assert.Equal(new[] { "1", "3" }, updates.Select(u => FakeSql.Arg(u.Args, "Id") ?? "").ToArray());
        Assert.Equal(100m, decimal.Parse(FakeSql.Arg(updates[1].Args, "Coupon")!, System.Globalization.CultureInfo.InvariantCulture));
        Assert.Equal(2000m, decimal.Parse(FakeSql.Arg(updates[0].Args, "AssessmentFee")!, System.Globalization.CultureInfo.InvariantCulture));

        var badCoupon = await client.PutAsJsonAsync("/api/staff/fees/Micro", new { levels = new[] { new { certification = "MileStone1", assessmentFee = 50m } } });
        Assert.Equal(HttpStatusCode.BadRequest, badCoupon.StatusCode);
    }

    [Fact]
    public async Task Dashboard_cards_use_the_handholding_columns()
    {
        _host.Sql.Procs["SP_DASHBOARD_GET_DETAILS"] = _ => FakeSql.Sets([new { AssessmentAgencies = 4, SiteAssessors = 9, SilverM1PaymentDone = 3, BronzeTotal = 99 }]);
        var master = await ConsultancyLogin.SignInAsync(_host, "MASTER1");
        var m = await master.GetFromJsonAsync<JsonElement>("/api/staff/dashboard");
        Assert.Equal(4, m.GetProperty("AssessmentAgencies").GetInt32());
        Assert.Equal(3, m.GetProperty("SilverM1PaymentDone").GetInt32());
        Assert.False(m.TryGetProperty("BronzeTotal", out _));
        var super = await ConsultancyLogin.SignInAsync(_host, "SUPER1");
        Assert.False((await super.GetFromJsonAsync<JsonElement>("/api/staff/dashboard")).TryGetProperty("AssessmentAgencies", out _));
    }

    [Fact]
    public async Task Registered_msme_passes_NoOfRecords_and_has_the_consultancy_roles_without_resend()
    {
        _host.Sql.Procs["SP_DASHBOARD_REGISTERED_MSME"] = _ => FakeSql.Sets([new { ZedId = "ZEDMSME1", MileStoneNo = 2, Password = "x" }], [new { TotalCounts = 1 }]);
        var master = await ConsultancyLogin.SignInAsync(_host, "MASTER1");
        var r = await master.GetFromJsonAsync<JsonElement>("/api/staff/dashboard/registered-msme?pageSize=20");
        Assert.Equal(2, r.GetProperty("rows")[0].GetProperty("MileStoneNo").GetInt32());
        Assert.DoesNotContain("Password", r.GetRawText());
        var args = Call("SP_DASHBOARD_REGISTERED_MSME").Args;
        Assert.Equal("20", FakeSql.Arg(args, "NoOfRecords"));
        Assert.False(ConsultancyLogin.Has(args, "PageSize"));

        var cf = await ConsultancyLogin.SignInAsync(_host, "CF1");
        Assert.Equal(HttpStatusCode.Forbidden, (await cf.GetAsync("/api/staff/dashboard/registered-msme")).StatusCode);
        var super = await ConsultancyLogin.SignInAsync(_host, "SUPER1");
        Assert.Equal(HttpStatusCode.NotFound, (await super.PostAsync("/api/staff/dashboard/registered-msme/ZEDMSME1/resend", null)).StatusCode);
    }

    [Fact]
    public async Task Master_admin_may_fix_a_failed_payment_and_nothing_is_posted_to_the_erp()
    {
        _host.Sql.Procs["SP_DASHBOARD_PAYMENT_FAILED_TRANSACTIONS"] = _ => FakeSql.Sets([new
        {
            ZedId = "ZEDMSME1", TransactionId = "T1", Certification = "Silver", AllowManualUpdate = 1, IsCouponUsed = 0, MileStoneNumber = 2,
        }]);
        var master = await ConsultancyLogin.SignInAsync(_host, "MASTER1");
        var list = await master.GetFromJsonAsync<JsonElement>("/api/staff/dashboard/failed-transactions");
        Assert.Equal(2, list[0].GetProperty("MileStoneNumber").GetInt32());
        var r = await master.PostAsJsonAsync("/api/staff/dashboard/failed-transactions/update-payment", new
        {
            zedId = "ZEDMSME1", transactionId = "T1", certification = "Silver", pgType = "Net Banking", trackingId = "123456789012",
            bankRefNumber = "B1", paymentReceivedDate = DateTime.UtcNow.ToString("yyyy-MM-dd"), paymentRemarks = "Bank confirmed",
        });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Contains(_host.Sql.Calls, c => c.Name == "SP_MSME_MANUAL_UPDATE_PAYMENT_GATEWAY_DETAILS_WITH_INFO");
        await Task.Delay(200);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.StartsWith("SP_API_FINANCE", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Reports_are_the_consultancy_catalogue_and_depend_on_the_sub_role()
    {
        var super = await ConsultancyLogin.SignInAsync(_host, "SUPER1");
        var names = (await super.GetFromJsonAsync<JsonElement>("/api/staff/reports")).EnumerateArray().Select(e => e.GetProperty("name").GetString()).ToList();
        Assert.Contains("List Of Consultant Organisations", names);
        Assert.DoesNotContain("List Of KAWACH Registered Msme", names);
        Assert.Equal(16, names.Count);

        var co = await ConsultancyLogin.SignInAsync(_host, "CO1");
        var coNames = (await co.GetFromJsonAsync<JsonElement>("/api/staff/reports")).EnumerateArray().Select(e => e.GetProperty("name").GetString()).ToList();
        Assert.Equal(6, coNames.Count); // site verification: the milestone lists only
        Assert.Equal(HttpStatusCode.NotFound, (await co.GetAsync("/api/staff/reports/list-of-consultancy-payment-received/download")).StatusCode);
    }

    [Fact]
    public async Task Neft_rows_carry_the_technology_upgradation_columns()
    {
        var host = new TestHost();
        try
        {
            ConsultancyLogin.Setup(host);
            host.Sql.Procs["SP_GET_USER_DETAILS"] = _ => FakeSql.Sets([new { UserId = "COORD1", UserName = "Coord", RoleId = 6, StateCode = "28", Password = "Right#Pass1" }]);
            host.Sql.Procs["SP_NEFT_TRANSACTIONS_BY_STATUS"] = _ => FakeSql.Sets([new
            {
                TransactionId = 7, ZedId = "ZEDMSME1", StateId = "28", VerificationStatus = 4, TransactionStatus = 0, CertId = "C1",
                TechnologyName = "T01-Solar", TechUpgradeStatus = 5, AccountNo = "123",
            }]);
            var client = await ConsultancyLogin.SignInAsync(host, "COORD1");
            var r = await client.GetFromJsonAsync<JsonElement>("/api/staff/neft/transactions?list=new");
            var row = r.GetProperty("transactions")[0];
            Assert.Equal("T01-Solar", row.GetProperty("TechnologyName").GetString());
            Assert.Equal("C1", row.GetProperty("CertId").GetString());
        }
        finally { host.Dispose(); }
    }

    // ---- staff MSME profile ---------------------------------------------------------------

    [Fact]
    public async Task A_co_consultant_of_the_allotment_sees_the_profile_and_others_do_not()
    {
        _host.Sql.Queries["SELECT Certification, CertificationBodyUserId"] = _ => [new { Certification = "Silver", CertificationBodyUserId = "CO1", SiteAssessorId = "LEAD1" }];
        _host.Sql.Queries["SELECT (SELECT COUNT(*) FROM AllotedCoAssessors"] = args => [FakeSql.Arg(args, "UserId") == "CONS1" ? 1 : 0];
        _host.Sql.Queries["SELECT ZedId, PUnitName"] = _ => [new { ZedId = "ZEDMSME1", PUnitName = "Unit One" }];
        _host.Sql.Queries["SELECT UdyogAadharNo"] = _ => [new { UdyogAadharNo = "UDYAM-1", PanNo = "ABCDE1234F" }];
        var client = await ConsultancyLogin.SignInAsync(_host, "CONS1");
        var r = await client.GetFromJsonAsync<JsonElement>("/api/staff/msme-profile/ZEDMSME1");
        Assert.Equal("Unit One", r.GetProperty("unit").GetProperty("PUnitName").GetString());
        Assert.Equal("XXXXXX234F", r.GetProperty("enterprise").GetProperty("PanNo").GetString());

        var other = await ConsultancyLogin.SignInAsync(_host, "CO2");
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync("/api/staff/msme-profile/ZEDMSME1")).StatusCode);
        var admin = await ConsultancyLogin.SignInAsync(_host, "ADMIN1");
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.GetAsync("/api/staff/msme-profile/ZEDMSME1")).StatusCode);
    }
}
