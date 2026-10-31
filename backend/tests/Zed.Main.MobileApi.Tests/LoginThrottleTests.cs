using System.Net;
using System.Text;
using System.Text.Json;

namespace Zed.Main.MobileApi.Tests;

/// <summary>The login lock per user id (LoginThrottle) and the per-IP limit of the login and reset calls (M13).</summary>
public sealed class LoginThrottleTests : IDisposable
{
    private readonly MobileTestHost _host = new();
    private HttpClient? _client;

    private HttpClient Client => _client ??= _host.CreateClient();

    public void Dispose() => _host.Dispose();

    private sealed class Clock : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = new(2026, 10, 31, 9, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => Now;
    }

    private async Task<(JsonElement Body, HttpStatusCode Status)> Post(string path, string userName, string password = "nope")
    {
        var r = await Client.PostAsync(path, new StringContent(
            JsonSerializer.Serialize(new { userName, assessorId = userName, zedId = "ZEDMSME000001", password, version = "1.0.0" }),
            Encoding.UTF8, "application/json"));
        return (JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement, r.StatusCode);
    }

    // ---------------------------------------------------------------- LoginThrottle

    [Theory]
    [InlineData(" zedmsme000001 ")]
    [InlineData("ＺＥＤＭＳＭＥ０００００１")]
    [InlineData("ZedMsme000001　")]
    public void Spellings_of_one_user_id_share_the_counter(string spelling)
    {
        var throttle = new LoginThrottle(new Clock());
        for (var i = 0; i < LoginThrottle.MaxFailures; i++) throttle.Failed("ZEDMSME000001");
        Assert.True(throttle.IsLocked(spelling));
        throttle.Succeeded(spelling);
        Assert.False(throttle.IsLocked("ZEDMSME000001"));
    }

    [Fact]
    public void Reset_requests_have_their_own_counter()
    {
        var throttle = new LoginThrottle(new Clock());
        for (var i = 0; i < LoginThrottle.MaxFailures; i++) throttle.Failed("ZEDMSME000001", LoginThrottle.Counter.PasswordReset);
        Assert.True(throttle.IsLocked("ZEDMSME000001", LoginThrottle.Counter.PasswordReset));
        Assert.False(throttle.IsLocked("ZEDMSME000001"));
    }

    [Fact]
    public void The_lock_ends_after_the_window()
    {
        var clock = new Clock();
        var throttle = new LoginThrottle(clock);
        for (var i = 0; i < LoginThrottle.MaxFailures; i++) throttle.Failed("ZEDAS0001");
        Assert.True(throttle.IsLocked("ZEDAS0001"));
        clock.Now += LoginThrottle.Window + TimeSpan.FromSeconds(1);
        Assert.False(throttle.IsLocked("ZEDAS0001"));
    }

    [Fact]
    public void Flooding_with_made_up_names_does_not_wipe_a_lock()
    {
        var clock = new Clock();
        var throttle = new LoginThrottle(clock);
        for (var i = 0; i < LoginThrottle.MaxFailures; i++) throttle.Failed("VICTIM");
        clock.Now += TimeSpan.FromMinutes(1);
        for (var i = 0; i <= LoginThrottle.MaxEntries; i++) throttle.Failed("RANDOM" + i);

        Assert.True(throttle.IsLocked("VICTIM"));
        Assert.True(throttle.Count <= LoginThrottle.MaxEntries);
    }

    [Fact]
    public void Expired_entries_are_dropped_first()
    {
        var clock = new Clock();
        var throttle = new LoginThrottle(clock);
        for (var i = 0; i < LoginThrottle.MaxEntries; i++) throttle.Failed("OLD" + i);
        clock.Now += LoginThrottle.Window + TimeSpan.FromMinutes(1);
        throttle.Failed("NEW1");
        throttle.Failed("NEW1");

        Assert.Equal(1, throttle.Count);
    }

    // ---------------------------------------------------------------- Through the API

    [Fact]
    public async Task Failures_on_the_msme_app_lock_the_same_id_on_the_remote_assessment_app()
    {
        for (var i = 0; i < LoginThrottle.MaxFailures; i++) await Post("/Msme/Login", "ZEDMSME000001");
        var (e, _) = await Post("/RA/Login", "zedmsme000001");
        Assert.Equal("0", e.GetProperty("status").GetString());
        Assert.Contains("Too many failed attempts", e.GetProperty("errorMessage").GetString());
        Assert.Empty(_host.Sql.Calls.Where(c => c.Name == "SP_APP_MSME_REMOTE_CHECK_LOGIN"));
    }

    [Fact]
    public async Task More_than_ten_logins_a_minute_from_one_address_get_the_legacy_failure()
    {
        for (var i = 0; i < 10; i++)
        {
            var (ok, _) = await Post("/Msme/Login", "ZEDMSME00010" + i);
            Assert.Equal("Invalid Credentials.", ok.GetProperty("errorMessage").GetString());
        }
        var (e, status) = await Post("/RA/Login", "ZEDMSME000200");
        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal("0", e.GetProperty("status").GetString());
        Assert.Equal(LoginThrottle.TooManyRequests, e.GetProperty("errorMessage").GetString());
        Assert.Empty(_host.Sql.Calls.Where(c => c.Name == "SP_APP_MSME_REMOTE_CHECK_LOGIN"));
    }

    [Fact]
    public async Task Password_reset_requests_are_limited_per_address_too()
    {
        for (var i = 0; i < 10; i++)
            await Client.PostAsync("/Msme/ResetPassword", new FormUrlEncodedContent(new Dictionary<string, string> { ["userName"] = "ZEDMSME00030" + i }));
        var r = await Client.PostAsync("/Msme/ResetPassword", new FormUrlEncodedContent(new Dictionary<string, string> { ["userName"] = "ZEDMSME000400" }));
        var e = JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("0", e.GetProperty("status").GetString());
        Assert.Equal(LoginThrottle.TooManyRequests, e.GetProperty("errorMessage").GetString());
    }
}
