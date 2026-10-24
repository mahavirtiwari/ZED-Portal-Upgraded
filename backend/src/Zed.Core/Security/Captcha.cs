using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Options;
using SkiaSharp;
using Zed.Core.Data;

namespace Zed.Core.Security;

/// <summary>The captcha of the web forms (login, registration, contact, staff password reset).</summary>
public enum CaptchaMode
{
    /// <summary>No captcha.</summary>
    Off,
    /// <summary>The portal's own picture of 6 letters and digits (<see cref="TextCaptcha"/>).</summary>
    Text,
    /// <summary>Google reCAPTCHA v2 (Recaptcha:SiteKey / SecretKey).</summary>
    Google,
}

/// <summary>
/// The captcha mode chosen by the Admin (Captcha Settings), per system: row 'CaptchaMode' of dbo.V4Settings in the
/// system's own database (migration 0011). Without a row, the configuration decides as before: Recaptcha:Enabled=false
/// is Off, otherwise Google when its keys are configured, else Text. Google without keys is served as Text.
/// </summary>
public interface ICaptchaSettings
{
    /// <summary>Whether Recaptcha:SiteKey and Recaptcha:SecretKey are configured.</summary>
    bool GoogleConfigured { get; }

    Task<CaptchaMode> GetAsync(CancellationToken ct = default);

    Task SetAsync(CaptchaMode mode, string userId, CancellationToken ct = default);
}

public sealed class CaptchaSettings(IPortalSettings settings, IOptions<RecaptchaOptions> options) : ICaptchaSettings
{
    public const string Key = "CaptchaMode";

    public bool GoogleConfigured =>
        !string.IsNullOrWhiteSpace(options.Value.SiteKey) && !string.IsNullOrWhiteSpace(options.Value.SecretKey);

    public async Task<CaptchaMode> GetAsync(CancellationToken ct = default) =>
        Effective(Enum.TryParse<CaptchaMode>(await settings.GetAsync(Key, ct), ignoreCase: true, out var m) ? (CaptchaMode?)m : null);

    public Task SetAsync(CaptchaMode mode, string userId, CancellationToken ct = default) =>
        settings.SetAsync(Key, mode.ToString(), userId, ct);

    private CaptchaMode Effective(CaptchaMode? stored) => stored switch
    {
        CaptchaMode.Google when !GoogleConfigured => CaptchaMode.Text,
        { } m => m,
        null when !options.Value.Enabled => CaptchaMode.Off,
        null => GoogleConfigured ? CaptchaMode.Google : CaptchaMode.Text,
    };
}

/// <summary>
/// The portal's own captcha: a picture of 6 letters and digits (without 0/O, 1/I/L), kept server-side in the
/// distributed cache for 5 minutes. The token the forms send is "id.answer"; each captcha is checked once only.
/// </summary>
public sealed class TextCaptcha(IDistributedCache cache)
{
    public const int Length = 6;
    private const string Alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    private static readonly DistributedCacheEntryOptions Lifetime = new() { AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(5) };

    public sealed record Challenge(string Id, string Image);

    /// <summary>A new captcha: its id and the picture as a PNG data URL.</summary>
    public async Task<Challenge> CreateAsync(CancellationToken ct = default)
    {
        var id = RandomNumberGenerator.GetHexString(32, lowercase: true);
        var code = RandomNumberGenerator.GetString(Alphabet, Length);
        await cache.SetAsync(CacheKey(id), Encoding.ASCII.GetBytes(code), Lifetime, ct);
        return new Challenge(id, "data:image/png;base64," + Convert.ToBase64String(Render(code)));
    }

    public async Task<bool> VerifyAsync(string? token, CancellationToken ct = default)
    {
        var parts = (token ?? "").Split('.', 2);
        if (parts.Length != 2 || parts[0].Length != 32 || !parts[0].All(char.IsAsciiHexDigitLower)) return false;
        var key = CacheKey(parts[0]);
        var stored = await cache.GetAsync(key, ct);
        if (stored is null) return false;
        await cache.RemoveAsync(key, ct);
        var answer = Encoding.ASCII.GetBytes(parts[1].Trim().ToUpperInvariant());
        return CryptographicOperations.FixedTimeEquals(stored, answer);
    }

    private static string CacheKey(string id) => "captcha:" + id;

    /// <summary>The code drawn with tilted letters over lines and dots, 180 x 56 pixels.</summary>
    public static byte[] Render(string code)
    {
        const int width = 180, height = 56;
        using var surface = SKSurface.Create(new SKImageInfo(width, height));
        var canvas = surface.Canvas;
        canvas.Clear(new SKColor(0xF2, 0xF6, 0xF7));

        using var noise = new SKPaint { IsAntialias = true, StrokeWidth = 1.2f };
        for (var i = 0; i < 6; i++)
        {
            noise.Color = Shade(160, 210);
            canvas.DrawLine(Next(width), Next(height), Next(width), Next(height), noise);
        }
        for (var i = 0; i < 120; i++)
        {
            noise.Color = Shade(120, 200);
            canvas.DrawPoint(Next(width), Next(height), noise);
        }

        using var typeface = SKTypeface.FromFamilyName("Arial", SKFontStyle.Bold);
        using var font = new SKFont(typeface, 30);
        using var ink = new SKPaint { IsAntialias = true };
        var step = (width - 30f) / code.Length;
        for (var i = 0; i < code.Length; i++)
        {
            ink.Color = Shade(20, 90);
            canvas.Save();
            canvas.Translate(14 + i * step + Next(4), 38 + Next(8) - 4);
            canvas.RotateDegrees(Next(36) - 18);
            canvas.DrawText(code[i].ToString(), 0, 0, SKTextAlign.Left, font, ink);
            canvas.Restore();
        }

        noise.Color = Shade(60, 120);
        noise.StrokeWidth = 1.5f;
        canvas.DrawLine(0, Next(height), width, Next(height), noise);

        using var image = surface.Snapshot();
        using var png = image.Encode(SKEncodedImageFormat.Png, 100);
        return png.ToArray();
    }

    private static int Next(int max) => RandomNumberGenerator.GetInt32(max);

    private static SKColor Shade(int from, int to)
    {
        byte C() => (byte)RandomNumberGenerator.GetInt32(from, to);
        return new SKColor(C(), C(), C());
    }
}

/// <summary>Checks the web forms' captcha token with the mode the Admin chose (<see cref="ICaptchaSettings"/>).</summary>
public sealed class CaptchaVerifier(ICaptchaSettings settings, TextCaptcha text, RecaptchaVerifier google) : ICaptchaVerifier
{
    public async Task<bool> VerifyAsync(string? token, string? remoteIp, CancellationToken ct = default) =>
        await settings.GetAsync(ct) switch
        {
            CaptchaMode.Off => true,
            CaptchaMode.Google => await google.VerifyAsync(token, remoteIp, ct),
            _ => await text.VerifyAsync(token, ct),
        };
}
