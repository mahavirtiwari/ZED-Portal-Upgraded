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
}

public interface ICaptchaVerifier
{
    Task<bool> VerifyAsync(string? token, string? remoteIp, CancellationToken ct = default);
}

public sealed class RecaptchaVerifier(HttpClient http, IOptions<RecaptchaOptions> options, ILogger<RecaptchaVerifier> log)
    : ICaptchaVerifier
{
    public async Task<bool> VerifyAsync(string? token, string? remoteIp, CancellationToken ct = default)
    {
        var o = options.Value;
        if (!o.Enabled) return true;
        if (string.IsNullOrWhiteSpace(token)) return false;
        if (string.IsNullOrEmpty(o.SecretKey))
        {
            log.LogError("Recaptcha is enabled but Recaptcha:SecretKey is not configured.");
            return false;
        }

        var form = new Dictionary<string, string> { ["secret"] = o.SecretKey, ["response"] = token };
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
