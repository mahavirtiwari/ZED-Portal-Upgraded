using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Zed.Core.Security;

public sealed class RecaptchaOptions
{
    public const string Section = "Recaptcha";

    /// <summary>Same switch as the legacy isEnabledCaptcha app setting.</summary>
    public bool Enabled { get; set; } = true;
    public string SiteKey { get; set; } = "";
    /// <summary>Server secret. Keep it out of source control (user secrets / environment).</summary>
    public string SecretKey { get; set; } = "";

    /// <summary>
    /// Secret of the Android reCAPTCHA key the MSME app uses (SafetyNet verifyWithRecaptcha; a different key from the
    /// web one). Needed for the app's Msme/ValidateCaptcha; with Enabled and no value the app's captcha is refused.
    /// </summary>
    public string AppSecretKey { get; set; } = "";
}

public interface ICaptchaVerifier
{
    Task<bool> VerifyAsync(string? token, string? remoteIp, CancellationToken ct = default);
}

/// <summary>Verifies the MSME app's reCAPTCHA tokens (Recaptcha:AppSecretKey).</summary>
public interface IAppCaptchaVerifier
{
    Task<bool> VerifyAsync(string? token, string? remoteIp, CancellationToken ct = default);
}

public sealed class RecaptchaVerifier(HttpClient http, IOptions<RecaptchaOptions> options, ILogger<RecaptchaVerifier> log)
    : ICaptchaVerifier
{
    public Task<bool> VerifyAsync(string? token, string? remoteIp, CancellationToken ct = default) =>
        SiteVerify.CheckAsync(http, options.Value.Enabled, options.Value.SecretKey, "Recaptcha:SecretKey", token, remoteIp, log, ct);
}

public sealed class RecaptchaAppVerifier(HttpClient http, IOptions<RecaptchaOptions> options, ILogger<RecaptchaAppVerifier> log)
    : IAppCaptchaVerifier
{
    public Task<bool> VerifyAsync(string? token, string? remoteIp, CancellationToken ct = default) =>
        SiteVerify.CheckAsync(http, options.Value.Enabled, options.Value.AppSecretKey, "Recaptcha:AppSecretKey", token, remoteIp, log, ct);
}

internal static class SiteVerify
{
    public static async Task<bool> CheckAsync(HttpClient http, bool enabled, string secret, string secretSetting,
        string? token, string? remoteIp, ILogger log, CancellationToken ct)
    {
        if (!enabled) return true;
        if (string.IsNullOrWhiteSpace(token)) return false;
        if (string.IsNullOrEmpty(secret))
        {
            log.LogError("Recaptcha is enabled but {Setting} is not configured.", secretSetting);
            return false;
        }

        var form = new Dictionary<string, string> { ["secret"] = secret, ["response"] = token };
        if (!string.IsNullOrEmpty(remoteIp)) form["remoteip"] = remoteIp;

        try
        {
            using var resp = await http.PostAsync("https://www.google.com/recaptcha/api/siteverify",
                new FormUrlEncodedContent(form), ct);
            var body = await resp.Content.ReadFromJsonAsync<SiteVerifyResponse>(ct);
            return body?.Success == true;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            log.LogWarning(ex, "Recaptcha verification call failed.");
            return false;
        }
    }

    private sealed record SiteVerifyResponse([property: JsonPropertyName("success")] bool Success);
}
