using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>The shared staff "View Profile" (api/staff/msme-profile) on the Main host.</summary>
public sealed class StaffMsmeProfileTests : IDisposable
{
    private readonly TestHost _host = new();

    public StaffMsmeProfileTests()
    {
        UsersMastersLogin.Setup(_host);
        _host.Sql.Queries["SELECT Certification, CertificationBodyUserId"] = args => FakeSql.Arg(args, "ZedId") == "ZEDMSME000001"
            ? [new { Certification = "Bronze", CertificationBodyUserId = "AGENCY1", DesktopAssessorId = "ASSESSOR1" }, new { Certification = "Silver" }]
            : [];
        _host.Sql.Procs["SP_ASSESSMENT_VIEW_PROFILE"] = args => FakeSql.Sets(
            [new { ZedId = FakeSql.Arg(args, "ZedId"), PUnitName = "Unit One", PAddress = "Plot 1", MobileNo = "9999999999", PledgeEmailId = "x@y.z" }],
            [new { UdyogAadharNo = "UDYAM-UP-01", OwnerName = "Owner", PanNo = "ABCDE1234F", EmailId = "owner@unit.test" }]);
    }

    public void Dispose() => _host.Dispose();

    [Fact]
    public async Task Signed_out_users_get_401_and_roles_without_the_page_403()
    {
        var anon = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.GetAsync("/api/staff/msme-profile/ZEDMSME000001")).StatusCode);
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.GetAsync("/api/staff/msme-profile/ZEDMSME000001")).StatusCode);
    }

    [Fact]
    public async Task Master_admin_sees_the_page_fields_only_with_a_masked_pan()
    {
        var client = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        var r = await client.GetFromJsonAsync<JsonElement>("/api/staff/msme-profile/ZEDMSME000001");
        Assert.Equal("Unit One", r.GetProperty("unit").GetProperty("PUnitName").GetString());
        Assert.False(r.GetProperty("unit").TryGetProperty("MobileNo", out _));
        Assert.False(r.GetProperty("unit").TryGetProperty("PledgeEmailId", out _));
        Assert.Equal("XXXXXX234F", r.GetProperty("enterprise").GetProperty("PanNo").GetString());
        Assert.Equal(2, r.GetProperty("certifications").GetArrayLength());
        var call = _host.Sql.Calls.Last(c => c.Name == "SP_ASSESSMENT_VIEW_PROFILE");
        Assert.Equal("MASTER1", FakeSql.Arg(call.Args, "UserId"));
        Assert.Equal("7", FakeSql.Arg(call.Args, "RoleId"));
    }

    [Fact]
    public async Task Agencies_and_assessors_see_only_units_allotted_to_them()
    {
        var agency = await UsersMastersLogin.SignInAsync(_host, "AGENCY1");
        Assert.Equal(HttpStatusCode.OK, (await agency.GetAsync("/api/staff/msme-profile/ZEDMSME000001")).StatusCode);
        var assessor = await UsersMastersLogin.SignInAsync(_host, "ASSESSOR1");
        Assert.Equal(HttpStatusCode.OK, (await assessor.GetAsync("/api/staff/msme-profile/ZEDMSME000001")).StatusCode);
        var other = await UsersMastersLogin.SignInAsync(_host, "AGENCY2");
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync("/api/staff/msme-profile/ZEDMSME000001")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await agency.GetAsync("/api/staff/msme-profile/ZEDMSME000002")).StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_ASSESSMENT_VIEW_PROFILE" && FakeSql.Arg(c.Args, "UserId") == "AGENCY2");
    }

    [Fact]
    public async Task A_rejected_copy_id_opens_the_units_profile_and_bad_ids_are_refused()
    {
        var client = await UsersMastersLogin.SignInAsync(_host, "SUPER1");
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/staff/msme-profile/ZEDMSME000001_D_45")).StatusCode);
        Assert.Equal("ZEDMSME000001", FakeSql.Arg(_host.Sql.Calls.Last(c => c.Name == "SP_ASSESSMENT_VIEW_PROFILE").Args, "ZedId"));
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/staff/msme-profile/ZED%27--")).StatusCode);
    }

    private static readonly object Edit = new
    {
        ownerName = " New Owner ", enterpriseName = "New Enterprise", emailId = "new@unit.test", pUnitName = "Unit One",
        twoDigitActivity = "24-Manufacture of basic metals", fourDigitActivity = "2431", fiveDigitActivity = "",
    };

    private void SetupEdit()
    {
        _host.Sql.Queries["SELECT b.OwnerName"] = args => FakeSql.Arg(args, "ZedId") == "ZEDMSME000001"
            ? [new { OwnerName = "Owner", EnterpriseName = "Old Enterprise", EmailId = "owner@unit.test", PUnitName = "Unit One", TwoDigitActivity = "10-Food", FourDigitActivity = "1010", FiveDigitActivity = "10101" }]
            : [];
        _host.Sql.Procs["SP_MASTER_GET_SECTORS"] = _ => FakeSql.Sets(
            [new { Id = 1, SectorCode = "10", SectorName = "Food" }, new { Id = 2, SectorCode = "24", SectorName = "Manufacture of basic metals" }]);
    }

    [Fact]
    public async Task Only_the_super_admin_can_edit_the_profile()
    {
        SetupEdit();
        foreach (var user in new[] { "MASTER1", "AGENCY1", "ASSESSOR1" })
        {
            var client = await UsersMastersLogin.SignInAsync(_host, user);
            Assert.Equal(HttpStatusCode.Forbidden, (await client.PutAsJsonAsync("/api/staff/msme-profile/ZEDMSME000001", Edit)).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/staff/msme-profile/sectors")).StatusCode);
        }
        var anon = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.PutAsJsonAsync("/api/staff/msme-profile/ZEDMSME000001", Edit)).StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_MSME_UPDATE_PROFILE");

        var super = await UsersMastersLogin.SignInAsync(_host, "SUPER1");
        var sectors = await super.GetFromJsonAsync<string[]>("/api/staff/msme-profile/sectors");
        Assert.Equal(["10-Food", "24-Manufacture of basic metals"], sectors);
        (await super.PutAsJsonAsync("/api/staff/msme-profile/ZEDMSME000001", Edit)).EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task The_edit_passes_the_legacy_parameters_to_the_procedure()
    {
        SetupEdit();
        var super = await UsersMastersLogin.SignInAsync(_host, "SUPER1");
        (await super.PutAsJsonAsync("/api/staff/msme-profile/ZEDMSME000001", Edit)).EnsureSuccessStatusCode();
        var call = _host.Sql.Calls.Single(c => c.Name == "SP_MSME_UPDATE_PROFILE");
        Assert.Equal("SUPER1", FakeSql.Arg(call.Args, "UserId"));
        Assert.Equal("10", FakeSql.Arg(call.Args, "RoleId"));
        Assert.Equal("ZEDMSME000001", FakeSql.Arg(call.Args, "ZedId"));
        Assert.Equal("New Owner", FakeSql.Arg(call.Args, "OwnerName"));
        Assert.Equal("New Enterprise", FakeSql.Arg(call.Args, "EnterpriseName"));
        Assert.Equal("new@unit.test", FakeSql.Arg(call.Args, "EmailId"));
        Assert.Equal("Unit One", FakeSql.Arg(call.Args, "PUnitName"));
        Assert.Equal("24-Manufacture of basic metals", FakeSql.Arg(call.Args, "TwoDigitActivity"));
        Assert.Equal("2431", FakeSql.Arg(call.Args, "FourDigitActivity"));
        Assert.Null(FakeSql.Arg(call.Args, "FiveDigitActivity"));
    }

    [Fact]
    public async Task Bad_edits_are_refused_before_the_procedure()
    {
        SetupEdit();
        var super = await UsersMastersLogin.SignInAsync(_host, "SUPER1");
        async Task<HttpStatusCode> Put(string zedId, object body) => (await super.PutAsJsonAsync("/api/staff/msme-profile/" + zedId, body)).StatusCode;
        object With(string field, string? value)
        {
            var d = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, string?>>(System.Text.Json.JsonSerializer.Serialize(Edit))!;
            d[field] = value;
            return d;
        }
        Assert.Equal(HttpStatusCode.BadRequest, await Put("ZEDMSME000001", With("emailId", "not-an-email")));
        Assert.Equal(HttpStatusCode.BadRequest, await Put("ZEDMSME000001", With("ownerName", " ")));
        Assert.Equal(HttpStatusCode.BadRequest, await Put("ZEDMSME000001", With("ownerName", new string('a', 201))));
        Assert.Equal(HttpStatusCode.BadRequest, await Put("ZEDMSME000001", With("enterpriseName", new string('a', 251))));
        Assert.Equal(HttpStatusCode.BadRequest, await Put("ZEDMSME000001", With("pUnitName", null)));
        Assert.Equal(HttpStatusCode.BadRequest, await Put("ZEDMSME000001", With("fourDigitActivity", new string('1', 251))));
        Assert.Equal(HttpStatusCode.BadRequest, await Put("ZEDMSME000001", With("twoDigitActivity", "99-Not a sector")));
        Assert.Equal(HttpStatusCode.BadRequest, await Put("ZEDMSME000001_D_45", Edit));
        Assert.Equal(HttpStatusCode.NotFound, await Put("ZEDMSME000002", Edit));
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_MSME_UPDATE_PROFILE");

        // The unit's present NIC 2 digit value is accepted even when it is not in the master.
        _host.Sql.Queries["SELECT b.OwnerName"] = _ => [new { OwnerName = "Owner", TwoDigitActivity = "99-Old sector" }];
        Assert.Equal(HttpStatusCode.OK, await Put("ZEDMSME000001", With("twoDigitActivity", "99-Old sector")));
    }
}
