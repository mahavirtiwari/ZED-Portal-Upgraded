using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;

namespace Zed.Main.Api.Tests;

/// <summary>Change of the registered e-mail with an OTP to the new address (web profile and the ZED MSME app), and the app's profile / history.</summary>
public sealed partial class MsmeProfileEmailTests : IDisposable
{
    private const string Me = "ZEDM000001";
    private readonly TestHost _host = new();

    public MsmeProfileEmailTests()
    {
        var resets = new Zed.TestSupport.FakeStaffResets().Attach(_host.Sql.Procs);
        resets.Users[Me] = new Zed.TestSupport.FakeStaffResets.User(Me, 5, true, "old@acme.test", "Pump Engineers");
        _host.Sql.Procs["SP_GET_USER_DETAILS"] = _ => FakeSql.Sets(
            [new { UserId = Me, UserName = "Pump Engineers", RoleId = 5, Email = "old@acme.test", MobileNo = "9999999999", StateCode = "9", DistrictCode = "160" }],
            [new { ERRORMSG = "SUCCESS" }]);
        _host.Sql.Procs["SP_MSME_GET_DETAILS"] = _ => FakeSql.Sets(
            [new Dictionary<string, object?> { ["ZedId"] = Me, ["PUnitName"] = "Pump Engineers", ["TwoDigitActivity"] = "10-Food" }],
            [new { UdyogAadharNo = "UDYAM-UP-16-0001476", EnterpriseName = "Pump Enterprise Private Limited" }],
            []);
        _host.Sql.Procs["SP_MSME_VALIDATE_UDYAM_DETAILS"] = args => FakeSql.Sets([], [],
            FakeSql.Arg(args, "EmailId") == "assessor@zed.test"
                ? [new { EmailCountStatus = "1", ErrorMessage = "Email ID already registered as Assessor." }]
                : [new { EmailCountStatus = "0", ErrorMessage = "" }]);
    }

    public void Dispose() => _host.Dispose();

    [GeneratedRegex(@"<b>\s*([0-9]{6})\s*</b>")] private static partial Regex OtpIn();

    private async Task<HttpClient> SignedInAsync()
    {
        var client = await _host.CreateBrowserAsync();
        (await client.PostAsJsonAsync("/api/msme/auth/login", new { userId = Me, password = "Right#Pass1" })).EnsureSuccessStatusCode();
        (await client.GetAsync("/api/auth/me")).EnsureSuccessStatusCode();
        return client;
    }

    [Fact]
    public async Task Web_changes_the_registered_email_only_after_the_otp_sent_to_the_new_address()
    {
        var client = await SignedInAsync();
        var profile = await client.GetFromJsonAsync<JsonElement>("/api/msme/profile");
        Assert.Equal("old@acme.test", profile.GetProperty("registeredEmail").GetString());

        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/msme/profile/email/otp", new { email = "not-an-address" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/msme/profile/email/otp", new { email = "assessor@zed.test" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/msme/profile/email/otp", new { email = "old@acme.test" })).StatusCode);

        var sent = await client.PostAsJsonAsync("/api/msme/profile/email/otp", new { email = "new@acme.test" });
        Assert.Equal(HttpStatusCode.OK, sent.StatusCode);
        var otpMail = _host.Email.Sent.Last();
        Assert.Equal("new@acme.test", otpMail.To);
        var otp = OtpIn().Match(otpMail.HtmlBody).Groups[1].Value;
        Assert.Matches("^[0-9]{6}$", otp);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.Contains("SET PledgeEmailId"));

        var wrong = await client.PostAsJsonAsync("/api/msme/profile/email/verify", new { otp = otp == "000000" ? "111111" : "000000" });
        Assert.Equal("Invalid OTP.", await wrong.ProblemTitle());
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.Contains("SET PledgeEmailId"));

        var ok = await client.PostAsJsonAsync("/api/msme/profile/email/verify", new { otp });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var update = _host.Sql.Calls.First(c => c.Name.StartsWith("UPDATE dbo.Msme SET PledgeEmailId"));
        Assert.Equal("new@acme.test", FakeSql.Arg(update.Args, "Email"));
        Assert.Equal(Me, FakeSql.Arg(update.Args, "ZedId"));
        // The old address is told; the change is in the edit history, the addresses partly hidden.
        Assert.Contains(_host.Email.Sent, m => m.To == "old@acme.test" && m.Subject.Contains("changed"));
        var recorded = _host.Sql.Calls.First(c => c.Name.Contains("V4MsmeEditHistory") && c.Name.StartsWith("INSERT"));
        Assert.Equal("Profile: e-mail changed", FakeSql.Arg(recorded.Args, "Action"));
        Assert.DoesNotContain("new@acme.test", FakeSql.Arg(recorded.Args, "Data"));

        // The OTP works once.
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/msme/profile/email/verify", new { otp })).StatusCode);
    }

    [Fact]
    public async Task App_profile_email_change_and_history_need_the_units_sign_in_token()
    {
        var key = Convert.ToBase64String(Enumerable.Range(1, 32).Select(i => (byte)i).ToArray());
        using var app = _host.WithWebHostBuilder(b => b.UseSetting("Mobile:AppTokenKey", key));
        var client = app.CreateClient();
        var token = await app.Services.GetRequiredService<Zed.Core.Mobile.AppTokens>().IssueAsync(Zed.Core.Mobile.MobileApps.Msme, Me, Me);

        HttpRequestMessage Request(HttpMethod method, string url, object? body = null, string? withToken = null)
        {
            var r = new HttpRequestMessage(method, url);
            if (body is not null) r.Content = JsonContent.Create(body);
            if (withToken is not null) r.Headers.Add(Zed.Core.Mobile.AppTokens.Header, withToken);
            return r;
        }

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.SendAsync(Request(HttpMethod.Get, "/Msme/AppProfile"))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.SendAsync(Request(HttpMethod.Post, "/Msme/AppEmailOtp", new { email = "new@acme.test" }))).StatusCode);

        var profile = JsonDocument.Parse(await (await client.SendAsync(Request(HttpMethod.Get, "/Msme/AppProfile", withToken: token))).Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("1", profile.GetProperty("status").GetString());
        Assert.Equal("Pump Enterprise Private Limited", profile.GetProperty("BasicInfo").GetProperty("EnterpriseName").GetString());
        Assert.Equal("old@acme.test", profile.GetProperty("RegisteredEmail").GetString());

        var sent = JsonDocument.Parse(await (await client.SendAsync(Request(HttpMethod.Post, "/Msme/AppEmailOtp", new { email = "new@acme.test" }, token))).Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("1", sent.GetProperty("status").GetString());
        var otp = OtpIn().Match(_host.Email.Sent.Last(m => m.To == "new@acme.test").HtmlBody).Groups[1].Value;
        var verified = JsonDocument.Parse(await (await client.SendAsync(Request(HttpMethod.Post, "/Msme/AppEmailVerify", new { otp }, token))).Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("1", verified.GetProperty("status").GetString());
        Assert.Equal("new@acme.test", verified.GetProperty("Email").GetString());
        var recorded = _host.Sql.Calls.First(c => c.Name.Contains("V4MsmeEditHistory") && c.Name.StartsWith("INSERT"));
        Assert.Equal("Mobile", FakeSql.Arg(recorded.Args, "Channel"));

        var history = JsonDocument.Parse(await (await client.SendAsync(Request(HttpMethod.Get, "/Msme/AppEditHistory", withToken: token))).Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("1", history.GetProperty("status").GetString());
        Assert.Contains(_host.Sql.Calls, c => c.Name.Contains("FROM ZEDCS_V2_LIVE.dbo.V4MsmeEditHistory") && FakeSql.Arg(c.Args, "ZedId") == Me);
    }
}
