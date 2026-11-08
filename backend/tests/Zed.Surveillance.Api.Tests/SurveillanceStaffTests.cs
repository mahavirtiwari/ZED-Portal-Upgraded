using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Zed.Main.Api.Tests;

namespace Zed.Surveillance.Api.Tests;

internal static class SurveillanceLogin
{
    public static readonly Dictionary<string, int> Users = new(StringComparer.OrdinalIgnoreCase)
    {
        ["ADMIN1"] = 1, ["AGENCY1"] = 2, ["AGENCY2"] = 2, ["ASSESSOR1"] = 3, ["COORD1"] = 6, ["MASTER1"] = 7, ["MIN1"] = 8, ["SUPER1"] = 10, ["CF1"] = 11,
    };

    public static void Setup(TestHost host)
    {
        host.Sql.Procs["SP_GET_USER_DETAILS"] = args =>
        {
            var id = FakeSql.Arg(args, "UserId") ?? "";
            return Users.TryGetValue(id, out var role)
                ? FakeSql.Sets([new { UserId = id.ToUpperInvariant(), UserName = id + " name", RoleId = role, Email = id.ToLowerInvariant() + "@zed.test", Password = "Right#Pass1" }], [new { ERRORMSG = "SUCCESS" }])
                : FakeSql.Sets([], [new { ERRORMSG = "INVALID CREDENTIAILS" }]);
        };
        host.Sql.Procs["SP_GET_SUB_ROLE"] = _ => FakeSql.Sets([new { DesktopVerification = 1, SiteVerification = 1, FinancialVerification = 0 }]);
    }

    public static async Task<HttpClient> SignInAsync(TestHost host, string userId)
    {
        // One Admin: the Admin works here through the main portal's hand-over, which issues the same cookie as this test
        // sign-in; a password sign-in of the Admin is refused here.
        if (Users.TryGetValue(userId, out var role) && role == 1)
            return await ReviewTestHost.SignInAsync(ReviewTestHost.With(host, new ReviewFakeDocuments(), null), userId.ToUpperInvariant(), Zed.Core.Security.UserRole.Admin);
        var client = await host.CreateBrowserAsync();
        (await client.PostAsJsonAsync("/api/staff/auth/login", new { userId, password = "Right#Pass1" })).EnsureSuccessStatusCode();
        return client;
    }
}

public sealed class SurveillanceStaffTests : IDisposable
{
    private readonly TestHost _host = new();
    private readonly Dictionary<string, Dictionary<string, object?>> _users = new(StringComparer.OrdinalIgnoreCase);

    public SurveillanceStaffTests()
    {
        SurveillanceLogin.Setup(_host);
        _users["ZEDAA0001"] = new() { ["UserId"] = "ZEDAA0001", ["UserName"] = "Acme", ["RoleId"] = 2, ["IsActive"] = true, ["Email"] = "a@acme.test", ["Password"] = "pw" };
        _users["ZEDAS0001"] = new() { ["UserId"] = "ZEDAS0001", ["UserName"] = "Asr", ["RoleId"] = 3, ["CreatedBy"] = "AGENCY1", ["IsActive"] = false, ["Email"] = "s@acme.test", ["Password"] = "pw" };
        _users["ZEDAS0002"] = new() { ["UserId"] = "ZEDAS0002", ["UserName"] = "Other", ["RoleId"] = 3, ["CreatedBy"] = "AGENCY2", ["IsActive"] = true, ["Email"] = "o@acme.test" };
        _host.Sql.Procs["SP_GET_USER_DETAILS_BY_USER_ID"] = args =>
            _users.TryGetValue(FakeSql.Arg(args, "UserId") ?? "", out var u) ? FakeSql.Sets([u], [], [], []) : FakeSql.Sets([], [], [], []);
        _host.Sql.Queries["SELECT DistrictCode, DistrictName FROM Districts"] = args =>
            FakeSql.Arg(args, "StateCode") == "9" ? [new { DistrictCode = "160", DistrictName = "Agra" }] : [];
    }

    public void Dispose() => _host.Dispose();

    [Fact]
    public async Task Staff_sign_in_and_the_old_path_base_work_here()
    {
        await SurveillanceLogin.SignInAsync(_host, "MASTER1");
        using var factory = _host.WithWebHostBuilder(b => b.UseSetting("Portal:PathBase", "/surveillance"));
        Assert.Equal(HttpStatusCode.OK, (await factory.CreateClient().GetAsync("/surveillance/api/health")).StatusCode);
    }

    [Fact]
    public async Task Account_creation_and_the_main_user_endpoints_are_not_served()
    {
        var client = await SurveillanceLogin.SignInAsync(_host, "MASTER1");
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/staff/users/agencies")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync("/api/staff/users/agencies", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync("/api/staff/surveillance-users/agencies", new { })).StatusCode);
    }

    [Fact]
    public async Task Master_admin_lists_every_agency_with_explicit_columns()
    {
        _host.Sql.Queries["SELECT U.UserId, U.UserName"] = _ => [new { UserId = "ZEDAA0001", UserName = "Acme", AllowBronzeSurveillance = false, NoOfUsers = 2 }];
        var client = await SurveillanceLogin.SignInAsync(_host, "MASTER1");
        var r = await client.GetFromJsonAsync<JsonElement>("/api/staff/surveillance-users/agencies");
        Assert.Equal("ZEDAA0001", r[0].GetProperty("userId").GetString());
        var sql = _host.Sql.Calls.Last(c => c.Name.StartsWith("SELECT U.UserId", StringComparison.Ordinal)).Name;
        Assert.DoesNotContain("Password", sql);
        Assert.DoesNotContain("*", sql.Replace("COUNT(*)", ""));

        var agency = await SurveillanceLogin.SignInAsync(_host, "AGENCY1");
        Assert.Equal(HttpStatusCode.Forbidden, (await agency.GetAsync("/api/staff/surveillance-users/agencies")).StatusCode);
    }

    [Fact]
    public async Task Lists_carry_the_address_pincode_and_id_proof_the_old_lists_showed()
    {
        _host.Sql.Queries["SELECT U.UserId, U.UserName"] = _ => [new { UserId = "ZEDAA0001", UserName = "Acme", Address = "Plot 4, Okhla", PinCode = "110020" }];
        _host.Sql.Queries["SELECT A.UserId"] = _ => [new { UserId = "ZEDAS0001", UserName = "Asr", Address = "12 MG Road", IdProofNumber = "ABCDE1234F" }];
        var client = await SurveillanceLogin.SignInAsync(_host, "MASTER1");

        var agency = (await client.GetFromJsonAsync<JsonElement>("/api/staff/surveillance-users/agencies"))[0];
        Assert.Equal("Plot 4, Okhla", agency.GetProperty("address").GetString());
        Assert.Equal("110020", agency.GetProperty("pinCode").GetString());
        Assert.Contains("U.Address, U.Pincode AS PinCode", _host.Sql.Calls.Last(c => c.Name.StartsWith("SELECT U.UserId", StringComparison.Ordinal)).Name);

        var assessor = (await client.GetFromJsonAsync<JsonElement>("/api/staff/surveillance-users/assessors"))[0];
        Assert.Equal("12 MG Road", assessor.GetProperty("address").GetString());
        Assert.Equal("ABCDE1234F", assessor.GetProperty("idProofNumber").GetString());
        var sql = _host.Sql.Calls.Last(c => c.Name.StartsWith("SELECT A.UserId", StringComparison.Ordinal)).Name;
        Assert.Contains("A.Address, A.IdProofNumber", sql);
        Assert.DoesNotContain("Password", sql);
    }

    [Fact]
    public async Task Bronze_surveillance_needs_a_state_valid_districts_and_a_reason_to_disable()
    {
        var client = await SurveillanceLogin.SignInAsync(_host, "MASTER1");
        var noState = await client.PutAsJsonAsync("/api/staff/surveillance-users/agencies/ZEDAA0001/bronze-surveillance", new { allow = true });
        Assert.Equal(HttpStatusCode.BadRequest, noState.StatusCode);
        var badDistrict = await client.PutAsJsonAsync("/api/staff/surveillance-users/agencies/ZEDAA0001/bronze-surveillance",
            new { allow = true, preferredState = "9", districts = new[] { "999" } });
        Assert.Equal(HttpStatusCode.BadRequest, badDistrict.StatusCode);
        var noReason = await client.PutAsJsonAsync("/api/staff/surveillance-users/agencies/ZEDAA0001/bronze-surveillance", new { allow = false });
        Assert.Equal(HttpStatusCode.BadRequest, noReason.StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.Contains("AllowBronzeSurveillance = @Allow", StringComparison.Ordinal));

        var ok = await client.PutAsJsonAsync("/api/staff/surveillance-users/agencies/ZEDAA0001/bronze-surveillance",
            new { allow = true, preferredState = "9", districts = new[] { "160" } });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var update = _host.Sql.Calls.Last(c => c.Name.Contains("AllowBronzeSurveillance = @Allow", StringComparison.Ordinal));
        Assert.Contains("RoleId = 2", update.Name);
        Assert.Equal("9", FakeSql.Arg(update.Args, "State"));
        Assert.Equal("160", FakeSql.Arg(update.Args, "Districts"));
        Assert.Equal("ZEDAA0001", FakeSql.Arg(update.Args, "UserId"));

        Assert.Equal(HttpStatusCode.NotFound, (await client.PutAsJsonAsync("/api/staff/surveillance-users/agencies/ZEDAS0001/bronze-surveillance",
            new { allow = true, preferredState = "9" })).StatusCode);
    }

    [Fact]
    public async Task An_agency_manages_only_its_own_assessors_with_an_inline_block()
    {
        var client = await SurveillanceLogin.SignInAsync(_host, "AGENCY1");
        _host.Sql.Queries["SELECT A.UserId"] = args => [new { UserId = "ZEDAS0001", AgencyUserId = FakeSql.Arg(args, "AgencyId") }];
        var list = await client.GetFromJsonAsync<JsonElement>("/api/staff/surveillance-users/assessors?agencyId=AGENCY2");
        Assert.Equal("AGENCY1", list[0].GetProperty("agencyUserId").GetString()); // the agency's own id, whatever was asked

        Assert.Equal(HttpStatusCode.NotFound, (await client.PutAsJsonAsync("/api/staff/surveillance-users/assessors/ZEDAS0002/bronze-surveillance", new { allow = true })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync("/api/staff/surveillance-users/assessors/ZEDAS0001/bronze-surveillance", new { allow = true })).StatusCode);

        var unblock = await client.PostAsync("/api/staff/surveillance-users/assessors/ZEDAS0001/unblock", null);
        Assert.Equal(HttpStatusCode.OK, unblock.StatusCode);
        var update = _host.Sql.Calls.Last(c => c.Name.StartsWith("UPDATE Users SET IsActive", StringComparison.Ordinal));
        Assert.Equal("3", FakeSql.Arg(update.Args, "RoleId"));
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_BLOCK_UNBLOCK_USER");
        Assert.Contains("unblocked", Assert.Single(_host.Email.Sent).HtmlBody);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync("/api/staff/surveillance-users/agencies/ZEDAA0001/block", new { reason = "x" })).StatusCode);
    }

    [Fact]
    public async Task Dashboard_figures_use_the_surveillance_cards()
    {
        _host.Sql.Procs["SP_V4_DASHBOARD_ANALYTICS"] = _ => FakeSql.Sets(
            [new { Registered = 20, Certified = 8, Bronze = 5, Silver = 2, Gold = 1 }], [], [], [], [], [], [], [], [],
            [new { BronzeTotal = 6, SaSilverNcRaised = 2, FaTotal = 9, BronzeNcRaised = 3 }], []);
        var master = await SurveillanceLogin.SignInAsync(_host, "MASTER1");
        var r = await master.GetFromJsonAsync<Zed.Portal.Features.Staff.Dashboard.StaffDashboardController.AnalyticsResponse>(
            "/api/staff/dashboard/analytics?certification=Bronze");
        Assert.Equal(8, r!.Totals.Certified);
        Assert.Equal(Zed.Portal.Features.Staff.Dashboard.StaffDashboardController.SurveillanceSummaryColumns, r.StatusCards.Keys);
        Assert.Equal("2", r.StatusCards["SaSilverNcRaised"]!.ToString());
        Assert.Equal("Bronze", FakeSql.Arg(_host.Sql.Calls.Last(c => c.Name == "SP_V4_DASHBOARD_ANALYTICS").Args, "Certification"));
    }

    [Fact]
    public async Task Dashboard_lists_and_reports_use_the_surveillance_shape()
    {
        _host.Sql.Procs["SP_DASHBOARD_GET_DETAILS"] = _ => FakeSql.Sets([new { BronzeTotal = 5, SaSilverNcRaised = 2, FaTotal = 9 }]);
        _host.Sql.Procs["SP_DASHBOARD_REGISTERED_MSME"] = _ => FakeSql.Sets([new { ZedId = "ZEDMSME1", SurveillanceNo = "2" }], [new { TotalCounts = 1 }]);
        var master = await SurveillanceLogin.SignInAsync(_host, "MASTER1");
        var d = await master.GetFromJsonAsync<JsonElement>("/api/staff/dashboard");
        Assert.Equal(2, d.GetProperty("SaSilverNcRaised").GetInt32());
        Assert.False(d.TryGetProperty("FaTotal", out _));
        var reg = await master.GetFromJsonAsync<JsonElement>("/api/staff/dashboard/registered-msme");
        Assert.Equal("2", reg.GetProperty("rows")[0].GetProperty("SurveillanceNo").GetString());
        Assert.False(reg.GetProperty("rows")[0].TryGetProperty("FirstSurveDueDate", out _));
        Assert.Equal("10", FakeSql.Arg(_host.Sql.Calls.Last(c => c.Name == "SP_DASHBOARD_REGISTERED_MSME").Args, "PageSize"));
        Assert.Equal(HttpStatusCode.OK, (await master.GetAsync("/api/staff/dashboard/failed-transactions")).StatusCode);

        var cf = await SurveillanceLogin.SignInAsync(_host, "CF1");
        Assert.Equal(HttpStatusCode.OK, (await cf.GetAsync("/api/staff/dashboard/registered-msme")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await cf.GetAsync("/api/staff/dashboard/financial-support")).StatusCode);
        var names = (await cf.GetFromJsonAsync<JsonElement>("/api/staff/reports")).EnumerateArray().Select(e => e.GetProperty("name").GetString()).ToList();
        // 8 before MSME KAWACH was removed (its "List Of KAWACH Registered Msme").
        Assert.Equal(7, names.Count);
        Assert.Contains("List Of Surveillance Inprogress", names);
        Assert.DoesNotContain(names, n => n!.Contains("KAWACH"));
    }

    [Fact]
    public async Task A_manual_zedx_payment_update_runs_the_surveillance_paid_steps()
    {
        _host.Sql.Procs["SP_DASHBOARD_PAYMENT_FAILED_TRANSACTIONS"] = _ => FakeSql.Sets([new
        {
            ZedId = "ZEDMSME1", TransactionId = "T1", Certification = "ZEDX", AllowManualUpdate = 1, IsCouponUsed = 0,
        }]);
        var master = await SurveillanceLogin.SignInAsync(_host, "MASTER1");
        var r = await master.PostAsJsonAsync("/api/staff/dashboard/failed-transactions/update-payment", new
        {
            zedId = "ZEDMSME1", transactionId = "T1", certification = "ZEDX", pgType = "Net Banking", trackingId = "123456789012",
            bankRefNumber = "B1", paymentReceivedDate = DateTime.UtcNow.ToString("yyyy-MM-dd"), paymentRemarks = "Bank confirmed",
        });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Contains(_host.Sql.Calls, c => c.Name == "SP_MSME_MANUAL_UPDATE_PAYMENT_GATEWAY_DETAILS_WITH_INFO");
        // As after a gateway payment (SurveillancePaymentCompletion): ZED-X's flags, questionnaire and minimum parameters.
        var paid = Assert.Single(_host.Sql.Calls, c => c.Name == Zed.Portal.Features.Payments.LevelSurveillance.PaidSql);
        Assert.Equal(("ZEDMSME1", "ZEDX"), (FakeSql.Arg(paid.Args, "ZedId"), FakeSql.Arg(paid.Args, "Certification")));
    }

    [Fact]
    public async Task The_fee_master_is_served_unchanged_and_neft_is_not()
    {
        _host.Sql.Procs["SP_MASTER_GET_ASSESSMENT_FEE"] = _ => FakeSql.Sets([new { Id = 1, EnterpriseTypee = "Micro", Certification = "Bronze", AssessmentFee = 100m, SubsidyPercentage = 100m }]);
        var admin = await SurveillanceLogin.SignInAsync(_host, "ADMIN1");
        var fees = await admin.GetFromJsonAsync<JsonElement>("/api/staff/fees/Micro");
        Assert.Equal("Certification", fees.GetProperty("groupBy").GetString());
        // The Recertification fee is main's (a surveillance unit does not re-certify here).
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync("/api/staff/fees/Recertification")).StatusCode);
        var coord = await SurveillanceLogin.SignInAsync(_host, "COORD1");
        Assert.Equal(HttpStatusCode.NotFound, (await coord.GetAsync("/api/staff/neft/transactions")).StatusCode);
    }

    [Fact]
    public async Task Admin_maintains_sectors_and_the_questionnaire_but_not_categories_technologies_or_documents()
    {
        _host.Sql.Procs["SP_MASTER_GET_SECTORS"] = _ => FakeSql.Sets([new { Id = 1, Code = "S01", Name = "Auto components" }]);
        _host.Sql.Procs["SP_MASTER_GET_SECTIONS"] = _ => FakeSql.Sets([new { Id = 7, SectionCode = "P01", SectionName = "Leadership", Description = "", SectionType = "Bronze" }]);
        var admin = await SurveillanceLogin.SignInAsync(_host, "ADMIN1");
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync("/api/staff/masters/sectors")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync("/api/staff/masters/parameters/Bronze")).StatusCode);
        Assert.Contains(_host.Sql.Calls, c => c.Name == "SP_MASTER_GET_SECTIONS");
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync("/api/staff/masters/categories")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync("/api/staff/masters/technologies")).StatusCode);
        // 2026-11-08: Surveillance staff documents are managed from main through the Surveillance tick; no banner here.
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync("/api/staff/masters/page-settings")).StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.Contains("CATEGOR", StringComparison.Ordinal) || c.Name.Contains("TECHNOLOG", StringComparison.Ordinal));

        var master = await SurveillanceLogin.SignInAsync(_host, "MASTER1");
        Assert.Equal(HttpStatusCode.Forbidden, (await master.GetAsync("/api/staff/masters/sectors")).StatusCode);
    }

    [Fact]
    public async Task The_admin_signs_in_on_the_main_portal_not_here()
    {
        var client = await _host.CreateBrowserAsync();
        var r = await client.PostAsJsonAsync("/api/staff/auth/login", new { userId = "ADMIN1", password = "Right#Pass1" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        var problem = await r.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(problem.GetProperty("adminOnMainPortal").GetBoolean());
        Assert.Contains("main portal", problem.GetProperty("title").GetString());
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_UPDATE_LOGIN");
        // The Dashboard Admin too (2026-11-08): it opens this portal's screens from main.
        var dash = await (await _host.CreateBrowserAsync()).PostAsJsonAsync("/api/staff/auth/login", new { userId = "SUPER1", password = "Right#Pass1" });
        Assert.Equal(HttpStatusCode.BadRequest, dash.StatusCode);
        Assert.Contains("Dashboard Admins", (await dash.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("title").GetString());
        // Other roles still sign in here.
        Assert.Equal(HttpStatusCode.OK, (await (await _host.CreateBrowserAsync()).PostAsJsonAsync("/api/staff/auth/login", new { userId = "MASTER1", password = "Right#Pass1" })).StatusCode);
    }

    [Fact]
    public async Task A_parameter_is_saved_without_the_surveillance_flag_which_only_the_main_database_has()
    {
        _host.Sql.Procs["SP_MASTER_GET_SECTIONS"] = _ => FakeSql.Sets([new { Id = 7, SectionCode = "P01", SectionName = "Leadership", SectionType = "Bronze" }]);
        var admin = await SurveillanceLogin.SignInAsync(_host, "ADMIN1");
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/staff/masters/parameters/Bronze", new { sectionCode = "P02", sectionName = "Safety", inSurveillance = true, inConsultancy = false })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync("/api/staff/masters/parameters/Bronze/7", new { sectionName = "Leadership", inSurveillance = true })).StatusCode);
        Assert.Contains(_host.Sql.Calls, c => c.Name == "SP_MASTER_INSERT_SECTION");
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.Contains("SurveMandatories", StringComparison.Ordinal));
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.Contains("InConsultancy", StringComparison.Ordinal));
    }

    [Fact]
    public async Task The_staff_profile_follows_the_allotment()
    {
        _host.Sql.Queries["SELECT Certification, CertificationBodyUserId"] = _ => [new { Certification = "Bronze", CertificationBodyUserId = "AGENCY1", DesktopAssessorId = "ASSESSOR1" }];
        _host.Sql.Procs["SP_ASSESSMENT_VIEW_PROFILE"] = _ => FakeSql.Sets([new { ZedId = "ZEDMSME1", PUnitName = "Unit", MobileNo = "9999999999" }], [new { PanNo = "ABCDE1234F", OwnerName = "Owner" }]);
        var assessor = await SurveillanceLogin.SignInAsync(_host, "ASSESSOR1");
        var r = await assessor.GetFromJsonAsync<JsonElement>("/api/staff/msme-profile/ZEDMSME1");
        Assert.Equal("Unit", r.GetProperty("unit").GetProperty("PUnitName").GetString());
        Assert.False(r.GetProperty("unit").TryGetProperty("MobileNo", out _));
        Assert.Equal("Owner", r.GetProperty("enterprise").GetProperty("OwnerName").GetString());
        var other = await SurveillanceLogin.SignInAsync(_host, "AGENCY2");
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync("/api/staff/msme-profile/ZEDMSME1")).StatusCode);
    }
}
