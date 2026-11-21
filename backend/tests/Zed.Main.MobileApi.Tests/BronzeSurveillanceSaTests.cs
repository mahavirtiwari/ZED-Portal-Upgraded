using System.Text;
using System.Text.Json;
using Zed.Core.Mobile;
using Zed.Main.MobileApi.Controllers;

namespace Zed.Main.MobileApi.Tests;

/// <summary>
/// 2026-11-21: Bronze surveillance in ZED SA (Surveillance deployment). A Bronze surveillance desktop assessor without site
/// verification signs in to ZED SA by the ZED Surveillance app's user check, sees its Bronze cases (SA/BronzeSurveillance) and
/// opens one with SA/BronzeSurveillanceSession, which answers Surveillance/Login's JSON and a "SURV" token for that unit.
/// </summary>
public sealed class BronzeSurveillanceSaTests : IDisposable
{
    private const string Assessor = "ZEDBAS0001";
    private const string OtherAssessor = "ZEDBAS0002";
    private const string Password = "Desk#1";
    private const string Zed = "ZEDMSME000001";
    private const string OtherUnit = "ZEDMSME000002";
    private readonly SurveillanceAppHost _t = new();
    private bool _hasCases = true;
    private const string InvalidCredentials = "Invalid credetials.";
    private const string NotAllocated = "Bronze Surveillance Assessment data not yet allocated for the ZEDID: ";

    public BronzeSurveillanceSaTests()
    {
        _t.Settings["Mobile:AppTokenKey"] = AppTokenTests.Key;
        _t.Settings["Mobile:AppTokens:Apps:SURV"] = "Enforce";
        // SP_APP_SA_CHECK_LOGIN asks for SiteVerification = 1: a desktop-only assessor has no row there.
        _t.Fake.Procs["SP_APP_SA_CHECK_LOGIN"] = _ => FakeSql.Sets([], [], [], [], [], [], [], [], []);
        // SP_APP_SURVEILLANCE_CHECK_LOGIN: set 0 for the right password; the unit sets for its desktop assessor whatever the password.
        _t.Fake.Procs["SP_APP_SURVEILLANCE_CHECK_LOGIN"] = args =>
        {
            var user = FakeSql.Arg(args, "AssessorId");
            var zed = FakeSql.Arg(args, "ZedId");
            IEnumerable<object> users = FakeSql.Arg(args, "Password") == Password && user is Assessor or OtherAssessor
                ? [new Dictionary<string, object?> { ["UserId"] = user, ["Password"] = Password, ["RoleId"] = 3, ["IsActive"] = true, ["UserName"] = "Desk Assessor" }]
                : [];
            if (zed is null) return FakeSql.Sets(users, [], [], [new { BronzeStatus = 1 }], []);
            var mine = user == Assessor && zed == Zed;
            return FakeSql.Sets(users,
                [new { MsmeId = "11", ZedId = zed, PledgeCertificateNo = zed, PUnitName = "Plant 1" }],
                [new { EnterpriseName = "Acme Forgings", OwnerName = "Owner", MobileNo = "9876543210", EmailId = "unit@acme.test" }],
                [new { BronzeStatus = 1, SilverStatus = 0, GoldStatus = 0 }],
                mine ? [new { ZedId = zed, Certification = "Bronze", CertificationStatus = 1, DesktopAssessorId = Assessor }] : []);
        };
        _t.Fake.Queries[BronzeSurveillanceData.CasesSql] = args => FakeSql.Arg(args, "UserId") == Assessor && _hasCases
            ? [new { ZedId = Zed, Certification = "Bronze", CertificationStatus = 1, StatusDate = new DateTime(2026, 11, 2, 10, 0, 0),
                     EnterpriseName = "Acme Forgings", UnitName = "Plant 1", Address = "12, MG Road", District = "Pune", State = "Maharashtra", Pincode = "411001" }]
            : [];
        _t.Fake.Queries[SaAppData.AssessorSql] = args => FakeSql.Arg(args, "UserId") is Assessor or OtherAssessor
            ? [new { UserId = FakeSql.Arg(args, "UserId"), RoleId = 3, IsActive = true, SiteVerification = (bool?)null }]
            : [];
        // The unit rows of the Surveillance/* per-call check.
        _t.Sql.Unit(Zed, "Bronze", Assessor);
        _t.Sql.Unit(OtherUnit, "Bronze", OtherAssessor);
    }

    public void Dispose() => _t.Dispose();

    private async Task<JsonElement> Post(string path, object body, string? token)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, path)
        {
            Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"),
        };
        if (token is not null) request.Headers.Add(AppTokens.Header, token);
        var r = await _t.Client.SendAsync(request);
        return JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement;
    }

    private async Task<(JsonElement Body, string Token)> SignIn(string user = Assessor, string device = "dev-1")
    {
        var e = await Post("/SA/SignIn", new { assessorId = user, password = Password, deviceInfo = new { deviceId = device } }, null);
        Assert.Equal("1", e.GetProperty("status").GetString());
        return (e, e.GetProperty("appToken").GetString()!);
    }

    private static string? Error(JsonElement e) => e.TryGetProperty("errorMessage", out var m) ? m.GetString() : null;

    // ---------------------------------------------------------------- Sign-in

    [Fact]
    public async Task A_desktop_assessor_without_site_verification_signs_in_and_gets_its_bronze_cases()
    {
        var (e, _) = await SignIn();
        var cases = e.GetProperty("bronzeSurveillance");
        var c = Assert.Single(cases.EnumerateArray());
        Assert.Equal(Zed, c.GetProperty("zedId").GetString());
        Assert.Equal("Acme Forgings", c.GetProperty("enterpriseName").GetString());
        Assert.Equal("12, MG Road", c.GetProperty("address").GetString());
        Assert.Equal(1, c.GetProperty("status").GetInt32());
        Assert.Contains("dev-1", _t.Devices.Known[(MobileApps.SiteAssessor, Assessor)]);
    }

    [Fact]
    public async Task Without_a_bronze_case_or_with_a_wrong_password_the_sign_in_is_refused()
    {
        var wrong = await Post("/SA/SignIn", new { assessorId = Assessor, password = "nope", deviceInfo = new { deviceId = "dev-1" } }, null);
        Assert.Equal(InvalidCredentials, Error(wrong));
        _hasCases = false;
        var none = await Post("/SA/SignIn", new { assessorId = Assessor, password = Password, deviceInfo = new { deviceId = "dev-1" } }, null);
        Assert.Equal(InvalidCredentials, Error(none));
        Assert.False(none.TryGetProperty("appToken", out _));
    }

    // ---------------------------------------------------------------- Case list

    [Fact]
    public async Task The_list_has_only_my_bronze_desktop_cases_and_needs_my_token()
    {
        var (_, token) = await SignIn();
        var e = await Post("/SA/BronzeSurveillance", new { saId = Assessor, deviceInfo = new { deviceId = "dev-1" } }, token);
        Assert.Equal("1", e.GetProperty("status").GetString());
        Assert.Equal(Zed, Assert.Single(e.GetProperty("cases").EnumerateArray()).GetProperty("zedId").GetString());
        // The query is asked for the token's assessor only.
        Assert.All(_t.CallsTo(BronzeSurveillanceData.CasesSql), c => Assert.Equal(Assessor, FakeSql.Arg(c.Args, "UserId")));

        Assert.Equal(AppTokens.ExpiredMessage, Error(await Post("/SA/BronzeSurveillance", new { saId = Assessor, deviceInfo = new { deviceId = "dev-1" } }, null)));
        // Another assessor's list with my token.
        Assert.Equal(AppTokens.ExpiredMessage,
            Error(await Post("/SA/BronzeSurveillance", new { saId = OtherAssessor, deviceInfo = new { deviceId = "dev-1" } }, token)));
    }

    // ---------------------------------------------------------------- Session exchange

    [Fact]
    public async Task The_session_answers_the_surveillance_login_shape_and_its_token_works_on_the_units_calls()
    {
        var (_, token) = await SignIn();
        var e = await Post("/SA/BronzeSurveillanceSession", new { saId = Assessor, zedId = Zed, deviceInfo = new { deviceId = "dev-1" } }, token);
        Assert.Equal("1", e.GetProperty("status").GetString());
        Assert.Equal(Zed, e.GetProperty("MsmeDetails").GetProperty("ZedId").GetString());
        Assert.Equal("Acme Forgings", e.GetProperty("MsmeDetails").GetProperty("BasicDetails").GetProperty("EnterpriseName").GetString());
        Assert.Equal(1, e.GetProperty("MsmeDetails").GetProperty("msmeStatus").GetProperty("BronzeStatus").GetInt32());
        // No password: the procedure is called with the refused value (set 0 stays empty).
        var args = _t.CallsTo("SP_APP_SURVEILLANCE_CHECK_LOGIN").Last().Args;
        Assert.Equal("V4!REFUSED", FakeSql.Arg(args, "Password"));
        Assert.Contains("dev-1", _t.Devices.Known[(MobileApps.Surveillance, Assessor)]);

        var surv = e.GetProperty("appToken").GetString();
        Assert.False(string.IsNullOrEmpty(surv));
        var docs = await Post("/Surveillance/GetMyDocuments", new { zedId = Zed, deviceInfo = new { deviceId = "dev-1" } }, surv);
        Assert.NotEqual(AppTokens.ExpiredMessage, Error(docs));
        Assert.Single(_t.CallsTo("SP_MSME_GET_MY_DOCUMENTS"));
        // The ZED SA token is not a SURV token, and the SURV token is for this unit only.
        Assert.Equal(AppTokens.ExpiredMessage, Error(await Post("/Surveillance/GetMyDocuments", new { zedId = Zed, deviceInfo = new { deviceId = "dev-1" } }, token)));
        Assert.Single(_t.CallsTo("SP_MSME_GET_MY_DOCUMENTS"));
    }

    [Fact]
    public async Task The_session_is_refused_for_a_unit_not_mine_without_a_token_or_from_another_phone()
    {
        var (_, token) = await SignIn();
        var notMine = await Post("/SA/BronzeSurveillanceSession", new { saId = Assessor, zedId = OtherUnit, deviceInfo = new { deviceId = "dev-1" } }, token);
        Assert.Equal("0", notMine.GetProperty("status").GetString());
        Assert.Equal(NotAllocated + OtherUnit, Error(notMine));
        Assert.False(notMine.TryGetProperty("appToken", out _));

        var noToken = await Post("/SA/BronzeSurveillanceSession", new { saId = Assessor, zedId = Zed, deviceInfo = new { deviceId = "dev-1" } }, null);
        Assert.Equal(AppTokens.ExpiredMessage, Error(noToken));

        var otherPhone = await Post("/SA/BronzeSurveillanceSession", new { saId = Assessor, zedId = Zed, deviceInfo = new { deviceId = "dev-9" } }, token);
        Assert.Equal(DeviceBoundAttribute.DeviceNotRegistered, Error(otherPhone));

        // Another assessor's unit asked with my token under its id.
        var asOther = await Post("/SA/BronzeSurveillanceSession", new { saId = OtherAssessor, zedId = OtherUnit, deviceInfo = new { deviceId = "dev-1" } }, token);
        Assert.Equal(AppTokens.ExpiredMessage, Error(asOther));
        Assert.False(_t.Devices.Known.ContainsKey((MobileApps.Surveillance, Assessor)));
    }

    [Fact]
    public async Task The_session_keeps_the_one_phone_rule_of_the_surveillance_app()
    {
        // The assessor's ZED Surveillance app was registered on another phone.
        _t.Devices.Known.GetOrAdd((MobileApps.Surveillance, Assessor), _ => []).Add("old-phone");
        var (_, token) = await SignIn();
        var e = await Post("/SA/BronzeSurveillanceSession", new { saId = Assessor, zedId = Zed, deviceInfo = new { deviceId = "dev-1" } }, token);
        Assert.Equal("This account is registered on another phone (Test Phone). Ask your Master Admin to release it.", Error(e));
    }

    [Fact]
    public async Task The_old_surveillance_login_is_unchanged()
    {
        var e = await Post("/Surveillance/Login", new { assessorId = Assessor, zedId = Zed, password = Password, deviceInfo = new { deviceId = "dev-1" } }, null);
        Assert.Equal("1", e.GetProperty("status").GetString());
        Assert.Equal(Zed, e.GetProperty("MsmeDetails").GetProperty("ZedId").GetString());
        var surv = e.GetProperty("appToken").GetString();
        Assert.NotEqual(AppTokens.ExpiredMessage, Error(await Post("/Surveillance/GetMyDocuments", new { zedId = Zed, deviceInfo = new { deviceId = "dev-1" } }, surv)));
        var refused = await Post("/Surveillance/Login", new { assessorId = Assessor, zedId = OtherUnit, password = Password }, null);
        Assert.Equal(NotAllocated + OtherUnit, Error(refused));
    }
}

/// <summary>The Bronze surveillance calls of ZED SA are not served by the Main deployment.</summary>
public sealed class BronzeSurveillanceMainHostTests : IDisposable
{
    private readonly AssessorTestHost _t = new();

    public void Dispose() => _t.Dispose();

    [Fact]
    public async Task Main_does_not_open_bronze_surveillance()
    {
        _t.Settings["Mobile:AppTokenKey"] = AppTokenTests.Key;
        // Without a token the attribute refuses first; the host check comes next for a signed-in call.
        var e = await _t.Json("/SA/BronzeSurveillanceSession", new { saId = "ZEDAS0001", zedId = "ZEDMSME000001" });
        Assert.Equal("0", e.GetProperty("status").GetString());
        Assert.Empty(_t.CallsTo("SP_APP_SURVEILLANCE_CHECK_LOGIN"));
    }
}
