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
}
