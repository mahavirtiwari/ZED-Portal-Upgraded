using System.Text.Json;
using Zed.Core.Mobile;

namespace Zed.Main.MobileApi.Tests;

public sealed class SaLoginTests : IDisposable
{
    private const string Password = "Assessor#1";
    private readonly AssessorTestHost _t = new();
    private int _status = 9;
    private string _role = "3";

    public SaLoginTests()
    {
        // SP_APP_SA_CHECK_LOGIN: Users row (accepts its master password too), unit, sections,
        // products, raw materials, requirements, options, sub-options, flags.
        _t.Fake.Procs["SP_APP_SA_CHECK_LOGIN"] = args =>
        {
            var pw = FakeSql.Arg(args, "Password");
            var user = FakeSql.Arg(args, "UserId");
            if (pw is not (Password or "MASTER")) return FakeSql.Sets([], [], [], [], [], [], [], [], []);
            var users = new[] { new Dictionary<string, object?> { ["UserId"] = "ZEDAS0001", ["Password"] = Password, ["RoleId"] = _role } };
            if (FakeSql.Arg(args, "ZedId") != "ZEDMSME000001") return FakeSql.Sets(users, [], [], [], [], [], [], [], []);
            return FakeSql.Sets(
                users,
                [new Dictionary<string, object?>
                {
                    ["AssessmentDate"] = "05/01/2024 10:00:00 AM", ["EnterpriseName"] = "Acme", ["Sector"] = "24", ["UnitAddress"] = "Agra",
                    ["Email"] = "u@x.in", ["PhoneNumber"] = "999", ["UserType"] = 1, ["CertificationStatus"] = _status,
                    ["LeadAssessorId"] = "ZEDAS0001", ["LeadAssessorName"] = "Lead", ["CoAssessorId"] = "ZEDAS0002", ["CoAssessorName"] = "Co",
                    ["ZedId"] = "ZEDMSME000001", ["CertificationType"] = "Silver", ["AuditsConducted"] = "Yes", ["DomesticCustomers"] = "D",
                    ["InternationalCustomers"] = "I", ["RawMaterialImported"] = "No", ["OutsourcedProcesses"] = "O", ["EnergySources"] = "Solar,Grid",
                    ["IsSurveillance"] = false, ["MinimumParameters"] = 3,
                }],
                [new { Id = 7, SectionId = "1", SectionName = "Leadership", SectionCode = "A1", IsAssessmentExcempted = "Yes" }],
                [new { Id = 11, ProductName = "Bolt", Exported = "No" }],
                [new { Id = 12, RawMaterialName = "Steel", RawMaterialPercentage = "80", CountryName = "India" }],
                [new { Id = 21, SectionCode = "A1", RequirementCode = "R1", AssessorRemarks = "ok" }, new { Id = 22, SectionCode = "B2", RequirementCode = "R9", AssessorRemarks = "" }],
                [new { Id = 31, SectionCode = "A1", RequirementCode = "R1", OptionCode = "O1", OptionName = "Yes" }],
                [new { Id = 41, SectionCode = "A1", RequirementCode = "R1", OptionCode = "O1", SubOptionCode = "S1", SubOptionName = "Fully" }],
                [new Dictionary<string, object?> { ["OpenMeetingSubmitted"] = true, ["SelfieSubmitted"] = false, ["AllowFinalSubmitManual"] = DBNull.Value }]);
        };
    }

    public void Dispose() => _t.Dispose();

    private Task<JsonElement> Login(string password, string zedId = "ZEDMSME000001", string? version = "1.0") =>
        _t.Json("/SA/Login", new { zedId, assessorId = "ZEDAS0001", password, version, deviceInfo = new { deviceId = "sa-phone" } });

    [Fact]
    public async Task Successful_login_returns_the_legacy_shape_and_remembers_the_device()
    {
        var e = await Login(Password);
        Assert.Equal("1", e.GetProperty("status").GetString());
        Assert.Equal(1, e.GetProperty("userType").GetInt32());
        Assert.Equal("Silver", e.GetProperty("certificationType").GetString());
        Assert.True(e.GetProperty("isOpenMeetingSubmitted").GetBoolean());
        Assert.False(e.GetProperty("isSelfieSubmitted").GetBoolean());
        Assert.False(e.GetProperty("allowFinalSubmit").GetBoolean());
        Assert.Equal(3, e.GetProperty("minimumParameters").GetInt32());
        Assert.Equal(JsonValueKind.Null, e.GetProperty("products").ValueKind);
        Assert.Equal(JsonValueKind.Null, e.GetProperty("inputParameters").ValueKind);

        var profile = e.GetProperty("companyProfile");
        Assert.Equal("ZEDMSME000001", profile.GetProperty("zedId").GetString());
        Assert.Equal("Acme", profile.GetProperty("msmeName").GetString());
        Assert.Equal("24", profile.GetProperty("sectorName").GetString());
        Assert.Equal(JsonValueKind.Null, profile.GetProperty("sectorId").ValueKind);

        var info = e.GetProperty("basicInformation");
        Assert.Equal(["Solar", "Grid"], info.GetProperty("energySources").EnumerateArray().Select(x => x.GetString()));
        Assert.Equal("Bolt", info.GetProperty("productDetailsList")[0].GetProperty("productName").GetString());
        Assert.Equal(11, info.GetProperty("productDetailsList")[0].GetProperty("productId").GetInt32());
        Assert.Equal("80", info.GetProperty("rawMaterialsList")[0].GetProperty("rawMaterialPercentage").GetString());

        var assessors = e.GetProperty("assessors");
        Assert.Equal(2, assessors.GetArrayLength());
        Assert.Equal("2", assessors[1].GetProperty("userType").GetString());
        Assert.Equal("ZEDAS0002", assessors[1].GetProperty("assessorId").GetString());

        var p = e.GetProperty("allottedParameters")[0];
        Assert.Equal("7", p.GetProperty("Id").GetString());
        Assert.Equal("A1", p.GetProperty("parameterCode").GetString());
        Assert.Equal("Mandatory", p.GetProperty("parameterType").GetString());
        var req = Assert.Single(p.GetProperty("requirements").EnumerateArray());
        Assert.Equal(21, req.GetProperty("id").GetInt32());
        Assert.Equal(0, req.GetProperty("evidences").GetArrayLength());
        var opt = Assert.Single(req.GetProperty("options").EnumerateArray());
        Assert.Equal("Yes", opt.GetProperty("label").GetString());
        Assert.Equal("Fully", opt.GetProperty("subOptions")[0].GetProperty("label").GetString());

        Assert.Contains("sa-phone", _t.Devices.Known[(MobileApps.SiteAssessor, "ZEDAS0001")]);
    }

    [Fact]
    public async Task Before_allotment_the_lead_gets_input_parameters()
    {
        _status = 8;
        var e = await Login(Password);
        Assert.Equal(JsonValueKind.Null, e.GetProperty("allottedParameters").ValueKind);
        var p = e.GetProperty("inputParameters")[0];
        Assert.Equal("1", p.GetProperty("parameterId").GetString());
        Assert.True(p.GetProperty("isExcemptedFromSa").GetBoolean());
        Assert.Equal(JsonValueKind.Null, p.GetProperty("assigneeId").ValueKind);
    }

    [Fact]
    public async Task Wrong_password_gets_the_old_text_in_the_full_shape()
    {
        var e = await Login("nope");
        Assert.Equal("0", e.GetProperty("status").GetString());
        Assert.Equal("Invalid credetials.", e.GetProperty("errorMessage").GetString());
        Assert.Equal(0, e.GetProperty("userType").GetInt32());
        Assert.Equal(JsonValueKind.Null, e.GetProperty("companyProfile").ValueKind);
    }

    [Fact]
    public async Task The_procedures_master_password_is_refused()
    {
        var e = await Login("MASTER");
        Assert.Equal("Invalid credetials.", e.GetProperty("errorMessage").GetString());
        Assert.Empty(_t.Devices.Known);
    }

    [Fact]
    public async Task A_user_row_with_another_role_is_refused()
    {
        _role = "5";
        Assert.Equal("Invalid credetials.", (await Login(Password)).GetProperty("errorMessage").GetString());
    }

    [Fact]
    public async Task Five_failures_lock_the_assessor()
    {
        for (var i = 0; i < 5; i++) await Login("nope");
        var e = await Login(Password);
        Assert.Equal("0", e.GetProperty("status").GetString());
        Assert.Contains("Too many failed attempts", e.GetProperty("errorMessage").GetString());
    }

    [Fact]
    public async Task A_unit_the_assessor_is_not_allotted_to_gets_the_old_message()
    {
        var e = await Login(Password, "ZEDMSME000099");
        Assert.Equal("0", e.GetProperty("status").GetString());
        Assert.Equal("Site Assessment data not yet allocated for the ZEDID: ZEDMSME000099", e.GetProperty("errorMessage").GetString());
        Assert.Empty(_t.Devices.Known);
    }

    [Fact]
    public async Task A_closed_assessment_gets_the_old_message()
    {
        _status = 13;
        var e = await Login(Password);
        Assert.Equal("SA Closing Meeting Submitted, hence SA is deemed completed for the ZEDID: ZEDMSME000001", e.GetProperty("errorMessage").GetString());
    }

    [Fact]
    public async Task Old_app_versions_are_told_to_update_when_the_check_is_on()
    {
        _t.Settings["Mobile:CheckSaVersion"] = "true";
        _t.Settings["Mobile:SaVersion"] = "2.0";
        var e = await Login(Password);
        Assert.Equal("2", e.GetProperty("status").GetString());
        Assert.Equal("Download new app from store.", e.GetProperty("errorMessage").GetString());
        Assert.Empty(_t.CallsTo("SP_APP_SA_CHECK_LOGIN"));
    }
    [Fact]
    public async Task Sa_login_records_a_hash_under_Dual()
    {
        var passwords = new global::Zed.TestSupport.FakePasswords().Attach(_t.Fake.Procs);
        AssertOkStatus(await Login(Password));
        Assert.True(passwords.HashMatches("ZEDAS0001", Password));
    }

    [Fact]
    public async Task Sa_login_under_Migrate_moves_an_account_without_a_hash_and_then_needs_the_hash()
    {
        var passwords = new global::Zed.TestSupport.FakePasswords().Attach(_t.Fake.Procs);
        _t.Settings[global::Zed.Core.Security.PasswordStore.Setting] = "Migrate";
        passwords.Add("ZEDAS0001", "3", Password);
        AssertOkStatus(await Login(Password));
        var write = Assert.Single(passwords.Writes);
        Assert.True(global::Zed.Core.Security.PasswordStore.IsReplacement(write.Replace));
        Assert.True(passwords.HashMatches("ZEDAS0001", Password));
        // The master value the procedure accepts is no longer sent to it.
        Assert.Equal("0", (await Login("MASTER")).GetProperty("status").GetString());
        Assert.Equal(global::Zed.Core.Security.PasswordStore.RefusedValue, FakeSql.Arg(_t.Fake.Calls.Last(c => c.Name == "SP_APP_SA_CHECK_LOGIN").Args, "Password"));
    }

    private static void AssertOkStatus(JsonElement e) => Assert.Equal("1", e.GetProperty("status").GetString());
}
