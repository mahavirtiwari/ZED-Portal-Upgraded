using System.Net;
using System.Net.Http.Json;
using System.Text;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.Settings;

namespace Zed.Main.Api.Tests.Staff;

public sealed class CaptchaSettingsTests : IDisposable
{
    private readonly TestHost _host = new();

    public CaptchaSettingsTests() => UsersMastersLogin.Setup(_host);

    public void Dispose() => _host.Dispose();

    private void Stored(string mode) => _host.Sql.Queries["SELECT SettingValue FROM dbo.V4Settings"] = _ => [mode];

    private sealed record Challenge(string Id, string Image);

    private async Task<string> AnswerAsync(string id) =>
        Encoding.ASCII.GetString((await _host.Services.GetRequiredService<IDistributedCache>().GetAsync("captcha:" + id))!);

    [Fact]
    public async Task Without_a_stored_setting_the_configuration_decides()
    {
        var client = await _host.CreateBrowserAsync();
        var config = await client.GetFromJsonAsync<SessionController.ClientConfig>("/api/config");
        Assert.False(config!.CaptchaEnabled);
        Assert.Equal("off", config.CaptchaMode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/captcha")).StatusCode);
    }

    [Fact]
    public async Task Text_captcha_is_asked_for_checked_once_and_case_insensitive()
    {
        Stored("Text");
        var client = await _host.CreateBrowserAsync();
        var config = await client.GetFromJsonAsync<SessionController.ClientConfig>("/api/config");
        Assert.True(config!.CaptchaEnabled);
        Assert.Equal("text", config.CaptchaMode);
        Assert.Equal("", config.CaptchaSiteKey);

        // No captcha, or a wrong one: refused before the password is checked.
        var r = await client.PostAsJsonAsync("/api/staff/auth/login", new { userId = "ADMIN1", password = "Right#Pass1" });
        Assert.Equal("Invalid Captcha.", await r.ProblemTitle());
        var wrong = (await client.GetFromJsonAsync<Challenge>("/api/captcha"))!;
        r = await client.PostAsJsonAsync("/api/staff/auth/login", new { userId = "ADMIN1", password = "Right#Pass1", captchaToken = wrong.Id + ".AAAAAA" });
        Assert.Equal("Invalid Captcha.", await r.ProblemTitle());
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_GET_USER_DETAILS");

        var c = await client.GetAsync("/api/captcha");
        Assert.Equal("no-store", c.Headers.CacheControl?.ToString());
        var challenge = (await c.Content.ReadFromJsonAsync<Challenge>())!;
        Assert.StartsWith("data:image/png;base64,", challenge.Image);
        var answer = await AnswerAsync(challenge.Id);
        Assert.Matches("^[A-HJKMNP-Z2-9]{6}$", answer);

        r = await client.PostAsJsonAsync("/api/staff/auth/login", new { userId = "ADMIN1", password = "Right#Pass1", captchaToken = challenge.Id + "." + answer.ToLowerInvariant() });
        r.EnsureSuccessStatusCode();
        // The same captcha does not work twice.
        r = await client.PostAsJsonAsync("/api/staff/auth/login", new { userId = "ADMIN1", password = "Right#Pass1", captchaToken = challenge.Id + "." + answer });
        Assert.Equal("Invalid Captcha.", await r.ProblemTitle());
    }

    [Fact]
    public async Task Google_without_keys_is_served_as_text()
    {
        Stored("Google");
        var client = await _host.CreateBrowserAsync();
        var config = await client.GetFromJsonAsync<SessionController.ClientConfig>("/api/config");
        Assert.Equal("text", config!.CaptchaMode);
    }

    [Fact]
    public async Task Only_the_Admin_changes_the_setting()
    {
        var anonymous = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/staff/settings/captcha")).StatusCode);
        foreach (var user in new[] { "MASTER1", "AGENCY1", "ASSESSOR1" })
        {
            var other = await UsersMastersLogin.SignInAsync(_host, user);
            Assert.Equal(HttpStatusCode.Forbidden, (await other.PutAsJsonAsync("/api/staff/settings/captcha", new { mode = "off" })).StatusCode);
        }

        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var current = await admin.GetFromJsonAsync<CaptchaSettingsController.CaptchaSettingsResponse>("/api/staff/settings/captcha");
        Assert.Equal(new CaptchaSettingsController.CaptchaSettingsResponse("off", false), current);

        Assert.Equal("Please select a captcha option.", await (await admin.PutAsJsonAsync("/api/staff/settings/captcha", new { mode = "7" })).ProblemTitle());
        Assert.Equal("Google reCAPTCHA keys are not configured on this server.",
            await (await admin.PutAsJsonAsync("/api/staff/settings/captcha", new { mode = "google" })).ProblemTitle());
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.StartsWith("MERGE dbo.V4Settings"));

        var r = await admin.PutAsJsonAsync("/api/staff/settings/captcha", new { mode = "text" });
        r.EnsureSuccessStatusCode();
        var merge = Assert.Single(_host.Sql.Calls, c => c.Name.StartsWith("MERGE dbo.V4Settings"));
        Assert.Equal("Text", FakeSql.Arg(merge.Args, "SettingValue"));
        Assert.Equal("ADMIN1", FakeSql.Arg(merge.Args, "UpdatedBy"));
        // In force at once on this server.
        Assert.Equal("text", (await anonymous.GetFromJsonAsync<SessionController.ClientConfig>("/api/config"))!.CaptchaMode);
    }

    [Fact]
    public async Task Picture_is_a_png_and_unknown_or_malformed_tokens_fail()
    {
        var text = new TextCaptcha(new MemoryDistributedCache(Options.Create(new MemoryDistributedCacheOptions())));
        Assert.Equal([0x89, 0x50, 0x4E, 0x47], TextCaptcha.Render("AB23CD")[..4]);
        foreach (var token in new[] { null, "", "nodot", "XYZ.ABCDEF", new string('a', 32) + ".ABCDEF" })
            Assert.False(await text.VerifyAsync(token));
    }
}
