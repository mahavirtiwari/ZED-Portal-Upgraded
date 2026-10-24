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
        Assert.Equal(8, names.Count);
        Assert.Contains("List Of Surveillance Inprogress", names);
    }

    [Fact]
    public async Task The_fee_master_is_served_unchanged_and_neft_is_not()
    {
        _host.Sql.Procs["SP_MASTER_GET_ASSESSMENT_FEE"] = _ => FakeSql.Sets([new { Id = 1, EnterpriseTypee = "Micro", Certification = "Bronze", AssessmentFee = 100m, SubsidyPercentage = 100m }]);
        var admin = await SurveillanceLogin.SignInAsync(_host, "ADMIN1");
        var fees = await admin.GetFromJsonAsync<JsonElement>("/api/staff/fees/Micro");
        Assert.Equal("Certification", fees.GetProperty("groupBy").GetString());
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
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync("/api/staff/masters/documents")).StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.Contains("CATEGOR", StringComparison.Ordinal) || c.Name.Contains("TECHNOLOG", StringComparison.Ordinal));

        var master = await SurveillanceLogin.SignInAsync(_host, "MASTER1");
        Assert.Equal(HttpStatusCode.Forbidden, (await master.GetAsync("/api/staff/masters/sectors")).StatusCode);
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
