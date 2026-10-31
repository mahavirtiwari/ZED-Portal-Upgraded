using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Zed.Core.Http;
using Zed.Core.Mobile;
using Zed.Core.Security;

namespace Zed.Main.MobileApi.Tests;

/// <summary>
/// The app sign-in token (finding C1): issued by the logins as <c>appToken</c>, sent back in X-Zed-App-Token, checked by
/// <see cref="DeviceBoundAttribute"/> against the user the action acts on (finding H1), per app in Off / Monitor / Enforce.
/// </summary>
public sealed class AppTokenTests : IDisposable
{
    internal static readonly string Key = Convert.ToBase64String(Enumerable.Range(1, 32).Select(i => (byte)i).ToArray());
    private const string UnitA = "ZEDMSME000001";
    private const string UnitB = "ZEDMSME000002";
    private const string Expired = "Your sign-in has expired. Please sign in again.";

    private readonly MobileTestHost _host = new();

    public AppTokenTests() => _host.Settings["Mobile:AppTokenKey"] = Key;

    public void Dispose() => _host.Dispose();

    private AppTokens Tokens => _host.Services.GetRequiredService<AppTokens>();

    private async Task<(JsonElement Body, HttpResponseMessage Response)> Post(string path, string json, string? token = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = new StringContent(json, Encoding.UTF8, "application/json") };
        if (token is not null) request.Headers.Add(AppTokens.Header, token);
        var r = await _host.CreateClient().SendAsync(request);
        return (JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement, r);
    }

    private static void AssertExpired(JsonElement e)
    {
        Assert.Equal("0", e.GetProperty("status").GetString());
        Assert.Equal(Expired, e.GetProperty("errorMessage").GetString());
    }

    /// <summary>An <see cref="AppTokens"/> outside a host: its own cache, so the session stamp is read again.</summary>
    private static AppTokens Standalone(FakeSql sql, string? key = null, PortalSystem system = PortalSystem.Main, TimeProvider? time = null,
        IDataProtectionProvider? protection = null, int days = 30) =>
        new(Options.Create(new MobileOptions { AppTokenKey = key, AppTokenDays = days }), protection ?? new EphemeralDataProtectionProvider(), sql,
            new MemoryCache(new MemoryCacheOptions()), NullLogger<AppTokens>.Instance, new PortalHost(system), time);

    private sealed class Shifted(TimeSpan by) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => TimeProvider.System.GetUtcNow() + by;
    }

    // ---------------------------------------------------------------- Login

    [Fact]
    public async Task Msme_login_answers_a_token_for_the_user_and_unit()
    {
        _host.Sql.Procs["SP_APP_MSME_CHECK_LOGIN"] = _ => FakeSql.Sets(
            [new Dictionary<string, object?> { ["UserId"] = UnitA, ["Password"] = "Right#Pass1", ["RoleId"] = 5 }],
            [new { ZedId = UnitA, MsmeId = "11" }], [new { EnterpriseName = "Acme" }], [new { BronzeStatus = 1 }]);
        var (e, _) = await Post("/Msme/Login", $"{{\"userName\":\"{UnitA}\",\"password\":\"Right#Pass1\"}}");

        Assert.Equal("1", e.GetProperty("status").GetString());
        var token = Tokens.Read(e.GetProperty("appToken").GetString());
        Assert.NotNull(token);
        Assert.Equal(MobileApps.Msme, token.App);
        Assert.Equal(UnitA, token.User);
        Assert.Equal(UnitA, token.Unit);
        Assert.Equal("Main", token.System);
        Assert.InRange(token.ExpiresAt - token.IssuedAt, TimeSpan.FromDays(30) - TimeSpan.FromMinutes(1), TimeSpan.FromDays(30) + TimeSpan.FromMinutes(1));
        // Nothing secret in it.
        Assert.DoesNotContain("Right#Pass1", e.GetProperty("appToken").GetString());
    }

    // ---------------------------------------------------------------- Modes

    [Fact]
    public async Task Monitor_lets_a_call_without_a_token_through_and_records_it()
    {
        var (e, _) = await Post("/probe/guarded", $"{{\"zedId\":\"{UnitA}\"}}");
        Assert.Equal("1", e.GetProperty("status").GetString());
        Assert.Contains(_host.Devices.TokenEvents, ev => ev.App == MobileApps.Msme && ev.User == UnitA && ev.Outcome == AppTokenCheck.Missing && !ev.Refused);
    }

    [Fact]
    public async Task Off_checks_nothing()
    {
        _host.Settings["Mobile:AppTokens:Mode"] = "Off";
        var (e, _) = await Post("/probe/guarded", $"{{\"zedId\":\"{UnitA}\"}}", token: "rubbish");
        Assert.Equal("1", e.GetProperty("status").GetString());
        Assert.Empty(_host.Devices.TokenEvents);
    }

    [Fact]
    public async Task Enforce_refuses_like_the_device_binding_unless_the_token_is_the_units()
    {
        _host.Settings["Mobile:AppTokens:Apps:MSME"] = "Enforce";
        var body = $"{{\"zedId\":\"{UnitA}\"}}";

        var (missing, r) = await Post("/probe/guarded", body);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("application/json", r.Content.Headers.ContentType!.MediaType);
        AssertExpired(missing);
        // The device-binding refusal's layout.
        Assert.Equal(["status", "errorMessage", "refId", "token"], missing.EnumerateObject().Select(p => p.Name));
        Assert.Contains(_host.Devices.TokenEvents, ev => ev.User == UnitA && ev.Outcome == AppTokenCheck.Missing && ev.Refused);

        AssertExpired((await Post("/probe/guarded", body, "h1.rubbish.rubbish")).Body);
        AssertExpired((await Post("/probe/guarded", body, await Tokens.IssueAsync(MobileApps.Msme, UnitB, UnitB))).Body);
        Assert.Contains(_host.Devices.TokenEvents, ev => ev.Outcome == AppTokenCheck.OtherUser && ev.Refused);
        AssertExpired((await Post("/probe/guarded", body, await Tokens.IssueAsync(MobileApps.SiteAssessor, UnitA, UnitA))).Body);
        Assert.Contains(_host.Devices.TokenEvents, ev => ev.Outcome == AppTokenCheck.OtherApp);

        var own = await Tokens.IssueAsync(MobileApps.Msme, UnitA, UnitA);
        Assert.Equal("1", (await Post("/probe/guarded", body, own)).Body.GetProperty("status").GetString());
        // ZED IDs compare as the database does.
        Assert.Equal("1", (await Post("/probe/guarded", $"{{\"zedId\":\" {UnitA.ToLowerInvariant()} \"}}", own)).Body.GetProperty("status").GetString());
    }

    [Fact]
    public async Task Per_app_setting_wins_over_the_mode()
    {
        _host.Settings["Mobile:AppTokens:Mode"] = "Enforce";
        _host.Settings["Mobile:AppTokens:Apps:MSME"] = "Monitor";
        Assert.Equal("1", (await Post("/probe/guarded", $"{{\"zedId\":\"{UnitA}\"}}")).Body.GetProperty("status").GetString());
        Assert.Equal(AppTokenMode.Enforce, Tokens.ModeFor(MobileApps.SiteAssessor));
        Assert.Equal(AppTokenMode.Monitor, Tokens.ModeFor("msme"));
    }

    [Fact]
    public async Task An_assessor_app_compares_the_token_with_the_assessor_named_in_the_call()
    {
        _host.Settings["Mobile:AppTokens:Apps:SA"] = "Enforce";
        var token = await Tokens.IssueAsync(MobileApps.SiteAssessor, "ZEDAS0001", UnitA);
        // A unit the login was not for: the assessor's allotment is checked by the action itself.
        Assert.Equal("1", (await Post("/probe/assessorguarded", $"{{\"saId\":\"ZEDAS0001\",\"zedId\":\"{UnitB}\"}}", token)).Body.GetProperty("status").GetString());
        AssertExpired((await Post("/probe/assessorguarded", $"{{\"saId\":\"ZEDAS0002\",\"zedId\":\"{UnitA}\"}}", token)).Body);
    }

    // ---------------------------------------------------------------- H1: the identity the action acts on

    [Fact]
    public async Task Device_binding_checks_the_nested_request_the_action_acts_on()
    {
        _host.Settings["Mobile:DeviceBinding"] = "Enforce";
        _host.Settings["Mobile:AppTokens:Mode"] = "Off";
        _host.Devices.Known[(MobileApps.Msme, UnitA)] = ["dev-a"];
        _host.Devices.Known[(MobileApps.Msme, UnitB)] = ["dev-b"];

        // Signed in as A on dev-a, naming A at the top, acting on B in the nested request: checked as B, so refused.
        var (e, _) = await Post("/probe/guardedecho",
            $"{{\"zedId\":\"{UnitA}\",\"deviceInfo\":{{\"deviceId\":\"dev-a\"}},\"request\":{{\"zedId\":\"{UnitB}\",\"deviceInfo\":{{\"deviceId\":\"dev-a\"}}}}}}");
        Assert.Equal("0", e.GetProperty("status").GetString());
        Assert.Equal(DeviceBoundAttribute.DeviceNotRegistered, e.GetProperty("errorMessage").GetString());
        Assert.Contains(_host.Devices.Events, ev => ev.User == UnitB && ev.Outcome == DeviceCheck.Unknown && ev.Refused);

        var own = (await Post("/probe/guardedecho",
            $"{{\"zedId\":\"{UnitB}\",\"request\":{{\"zedId\":\"{UnitA}\",\"deviceInfo\":{{\"deviceId\":\"dev-a\"}}}}}}")).Body;
        Assert.Equal(UnitA, own.GetProperty("acted").GetString());
    }

    [Fact]
    public async Task The_token_is_held_against_the_nested_request_and_skips_a_blank_first_field()
    {
        _host.Settings["Mobile:AppTokens:Apps:MSME"] = "Enforce";
        var a = await Tokens.IssueAsync(MobileApps.Msme, UnitA, UnitA);

        AssertExpired((await Post("/probe/guardedecho", $"{{\"zedId\":\"{UnitA}\",\"request\":{{\"zedId\":\"{UnitB}\"}}}}", a)).Body);
        // zedId blank: the action acts on userName (as First(zedId, userName)), so that is what is checked.
        AssertExpired((await Post("/probe/guardedecho", $"{{\"zedId\":\"  \",\"userName\":\"{UnitB}\"}}", a)).Body);

        var ok = (await Post("/probe/guardedecho", $"{{\"zedId\":\"{UnitB}\",\"request\":{{\"zedId\":\"{UnitA}\"}}}}", a)).Body;
        Assert.Equal(UnitA, ok.GetProperty("acted").GetString());
    }

    // ---------------------------------------------------------------- The token itself

    [Fact]
    public async Task A_token_is_good_on_another_host_with_the_same_key_only()
    {
        var sql = new FakeSql();
        var token = await Standalone(sql, Key).IssueAsync(MobileApps.SiteAssessor, "DFO1", UnitA);

        Assert.Equal(AppTokenCheck.Valid, await Standalone(sql, Key).CheckAsync(token, MobileApps.SiteAssessor, "dfo1", UnitA));
        // Another key, another deployment, or no key (Data Protection of another host): not genuine.
        var other = Convert.ToBase64String(Enumerable.Range(2, 32).Select(i => (byte)i).ToArray());
        Assert.Equal(AppTokenCheck.Invalid, await Standalone(sql, other).CheckAsync(token, MobileApps.SiteAssessor, "DFO1", UnitA));
        Assert.Equal(AppTokenCheck.Invalid, await Standalone(sql, Key, PortalSystem.Consultancy).CheckAsync(token, MobileApps.SiteAssessor, "DFO1", UnitA));
        Assert.Equal(AppTokenCheck.Invalid, await Standalone(sql).CheckAsync(token, MobileApps.SiteAssessor, "DFO1", UnitA));
        Assert.Equal(AppTokenCheck.OtherUser, await Standalone(sql, Key).CheckAsync(token, MobileApps.SiteAssessor, "DFO1", UnitB));

        // A changed byte breaks the signature.
        var tampered = token[..5] + (token[5] == 'A' ? 'B' : 'A') + token[6..];
        Assert.Equal(AppTokenCheck.Invalid, await Standalone(sql, Key).CheckAsync(tampered, MobileApps.SiteAssessor, "DFO1", UnitA));
    }

    [Fact]
    public async Task Without_a_key_the_issuing_host_still_reads_its_tokens()
    {
        var sql = new FakeSql();
        var protection = new EphemeralDataProtectionProvider();
        var tokens = Standalone(sql, protection: protection);
        var token = await tokens.IssueAsync(MobileApps.Surveillance, "ZEDBAS0001", UnitA);
        Assert.StartsWith("d1.", token);
        Assert.Equal(AppTokenCheck.Valid, await tokens.CheckAsync(token, MobileApps.Surveillance, "ZEDBAS0001", UnitA));
        // And once a key is set, the tokens issued before it stay good there.
        Assert.Equal(AppTokenCheck.Valid, await Standalone(sql, Key, protection: protection).CheckAsync(token, MobileApps.Surveillance, "ZEDBAS0001", UnitA));
    }

    [Fact]
    public async Task A_token_expires_after_the_configured_days()
    {
        var sql = new FakeSql();
        var token = await Standalone(sql, Key, days: 2).IssueAsync(MobileApps.Surveillance, "ZEDBAS0001", UnitA);
        Assert.Equal(AppTokenCheck.Valid,
            await Standalone(sql, Key, time: new Shifted(TimeSpan.FromDays(1))).CheckAsync(token, MobileApps.Surveillance, "ZEDBAS0001", UnitA));
        Assert.Equal(AppTokenCheck.Expired,
            await Standalone(sql, Key, time: new Shifted(TimeSpan.FromDays(2) + TimeSpan.FromMinutes(1))).CheckAsync(token, MobileApps.Surveillance, "ZEDBAS0001", UnitA));
    }

    [Fact]
    public async Task A_new_session_stamp_ends_the_token()
    {
        var sql = new FakeSql();
        var stamp = "s1";
        sql.Queries[SessionStamps.SelectSql] = _ => [stamp];
        var token = await Standalone(sql, Key).IssueAsync(MobileApps.SiteAssessor, "ZEDAS0001", UnitA);
        Assert.Equal("s1", Standalone(sql, Key).Read(token)!.Stamp);
        Assert.Equal(AppTokenCheck.Valid, await Standalone(sql, Key).CheckAsync(token, MobileApps.SiteAssessor, "ZEDAS0001", null));

        stamp = "s2"; // password changed or account blocked
        Assert.Equal(AppTokenCheck.Revoked, await Standalone(sql, Key).CheckAsync(token, MobileApps.SiteAssessor, "ZEDAS0001", null));

        // A login after the change gets a token with the new stamp, even where the old one was cached.
        var cached = Standalone(sql, Key);
        stamp = "s1";
        Assert.Equal(AppTokenCheck.Valid, await cached.CheckAsync(token, MobileApps.SiteAssessor, "ZEDAS0001", null));
        stamp = "s2";
        var fresh = await Standalone(sql, Key).IssueAsync(MobileApps.SiteAssessor, "ZEDAS0001", UnitA);
        Assert.Equal(AppTokenCheck.Valid, await cached.CheckAsync(fresh, MobileApps.SiteAssessor, "ZEDAS0001", null));
    }
}

/// <summary>The Bronze surveillance app's token: the allotted desktop assessor, for the unit of the login.</summary>
public sealed class SurveillanceAppTokenTests : IDisposable
{
    private const string Zed = "ZEDMSME000001";
    private const string OtherUnit = "ZEDMSME000002";
    private const string Assessor = "ZEDBAS0001";
    private readonly SurveillanceAppHost _t = new();

    public SurveillanceAppTokenTests()
    {
        _t.Settings["Mobile:AppTokenKey"] = AppTokenTests.Key;
        _t.Settings["Mobile:AppTokens:Apps:SURV"] = "Enforce";
        _t.Sql.Unit(Zed, "Bronze", Assessor);
        _t.Sql.Unit(OtherUnit, "Bronze", Assessor);
        _t.Fake.Procs["SP_APP_SURVEILLANCE_CHECK_LOGIN"] = _ => FakeSql.Sets(
            [new { UserId = Assessor, RoleId = 3, Password = "pw" }],
            [new { MsmeId = "11", ZedId = Zed }], [new { EnterpriseName = "Acme" }], [new { BronzeStatus = 1 }],
            [new { ZedId = Zed, Certification = "Bronze", CertificationStatus = 1, DesktopAssessorId = Assessor }]);
    }

    public void Dispose() => _t.Dispose();

    private async Task<JsonElement> Documents(string zedId, string? token)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/Surveillance/GetMyDocuments")
        {
            Content = new StringContent(JsonSerializer.Serialize(new { zedId }), Encoding.UTF8, "application/json"),
        };
        if (token is not null) request.Headers.Add(AppTokens.Header, token);
        var r = await _t.Client.SendAsync(request);
        var text = await r.Content.ReadAsStringAsync();
        return text.Length > 0 ? JsonDocument.Parse(text).RootElement : default;
    }

    private static bool Refused(JsonElement e) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty("errorMessage", out var m) && m.GetString() == AppTokens.ExpiredMessage;

    [Fact]
    public async Task Calls_need_the_assessors_token_for_that_unit()
    {
        var login = await _t.Json("/Surveillance/Login", new { assessorId = Assessor, zedId = Zed, password = "pw" });
        var token = login.GetProperty("appToken").GetString();

        Assert.True(Refused(await Documents(Zed, null)));
        Assert.Empty(_t.CallsTo("SP_MSME_GET_MY_DOCUMENTS"));
        // Allotted to the same assessor, but the login was for another unit.
        Assert.True(Refused(await Documents(OtherUnit, token)));
        Assert.Empty(_t.CallsTo("SP_MSME_GET_MY_DOCUMENTS"));
        Assert.Contains(_t.Devices.TokenEvents, ev => ev.App == MobileApps.Surveillance && ev.User == Assessor && ev.Outcome == AppTokenCheck.OtherUser);

        Assert.False(Refused(await Documents(Zed, token)));
        Assert.Single(_t.CallsTo("SP_MSME_GET_MY_DOCUMENTS"));
    }
}
