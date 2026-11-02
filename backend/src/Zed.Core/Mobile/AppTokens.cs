using System.Buffers.Text;
using System.Data.Common;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Core.Mobile;

public enum AppTokenMode
{
    /// <summary>No checks.</summary>
    Off,
    /// <summary>A missing, invalid, expired or wrong-user token is recorded; nothing is refused. The default.</summary>
    Monitor,
    /// <summary>Calls without a valid token for the user they act for are refused (the app signs out).</summary>
    Enforce,
}

/// <summary><c>Mobile:AppTokens</c>: the mode for every app, and per-app overrides by <see cref="MobileApps"/> name.</summary>
public sealed class AppTokenOptions
{
    public AppTokenMode Mode { get; set; } = AppTokenMode.Monitor;

    /// <summary><c>Mobile:AppTokens:Apps:SA = Enforce</c> etc. Only apps whose installed builds send the token may be enforced.</summary>
    public Dictionary<string, AppTokenMode> Apps { get; set; } = new(StringComparer.OrdinalIgnoreCase);
}

public enum AppTokenCheck { Valid, Missing, Invalid, Expired, OtherApp, OtherUser, Revoked }

/// <summary>What an app token says: who signed in to which app (and for which unit), and when.</summary>
/// <param name="User">The user id the login checked (Users.UserId): the ZED ID for the MSME and RA apps, the assessor otherwise.</param>
/// <param name="Unit">The unit the login was for (MSME, RA, surveillance, site assessor and consultant logins), else null.</param>
/// <param name="Stamp">The user's session stamp at login; a password change or block changes it and ends the token.</param>
/// <param name="System">The deployment that issued it: a Main token is never taken by Consultancy or Surveillance.</param>
public sealed record AppToken(string App, string User, string? Unit, string Stamp, string System, DateTimeOffset IssuedAt, DateTimeOffset ExpiresAt);

/// <summary>
/// The sign-in token of the mobile apps (finding C1). Every successful app login answers it as <c>appToken</c>; the app
/// sends it back on every call in the <see cref="Header"/> header, and the calls that act for a user check that it was
/// issued to that user (and unit) by this deployment, has not expired (<c>Mobile:AppTokenDays</c>) and that the user's
/// session stamp is unchanged. Nothing secret is in it; it is signed with HMAC-SHA256 under <c>Mobile:AppTokenKey</c>
/// (the same key on a deployment's mobile host and portal, which checks the app's calls to the portal), or, without a
/// key, protected with ASP.NET Data Protection, which only the issuing host can read. Modes per app:
/// <see cref="AppTokenOptions"/>; a refusal answers like the device-binding refusal with <see cref="ExpiredMessage"/>.
/// </summary>
public sealed class AppTokens
{
    public const string Header = "X-Zed-App-Token";

    /// <summary>The apps sign out and show the login page on this text.</summary>
    public const string ExpiredMessage = "Your sign-in has expired. Please sign in again.";

    private const string HmacPrefix = "h1.";
    private const string ProtectedPrefix = "d1.";
    private const string Purpose = "Zed.Mobile.AppToken.v1";
    private const int MaxLength = 4096;
    private static readonly TimeSpan StampCacheTime = TimeSpan.FromSeconds(60);

    private readonly IOptions<MobileOptions> options;
    private readonly IDataProtector protector;
    private readonly ISqlExecutor db;
    private readonly IMemoryCache cache;
    private readonly ILogger<AppTokens> log;
    private readonly string system;
    private readonly TimeProvider time;
    private readonly byte[]? key;
    private bool warnedNoIssuerDb;

    public AppTokens(IOptions<MobileOptions> options, IDataProtectionProvider protection, ISqlExecutor db, IMemoryCache cache,
        ILogger<AppTokens> log, PortalHost? host = null, TimeProvider? time = null)
    {
        this.options = options;
        this.db = db;
        this.cache = cache;
        this.log = log;
        protector = protection.CreateProtector(Purpose);
        system = (host?.System ?? PortalSystem.Main).ToString();
        this.time = time ?? TimeProvider.System;
        key = ReadKey(options.Value.AppTokenKey, log);
    }

    /// <summary>The mode of one app: <c>Mobile:AppTokens:Apps:{app}</c>, else <c>Mobile:AppTokens:Mode</c>.</summary>
    public AppTokenMode ModeFor(string app)
    {
        var o = options.Value.AppTokens;
        foreach (var (name, mode) in o.Apps)
            if (string.Equals(name, app, StringComparison.OrdinalIgnoreCase)) return mode;
        return o.Mode;
    }

    /// <summary>A token for a successful login. Call after the password and the allotment were checked.</summary>
    public async Task<string> IssueAsync(string app, string userId, string? unit, CancellationToken ct = default)
    {
        var user = userId.Trim();
        var now = time.GetUtcNow();
        var days = Math.Clamp(options.Value.AppTokenDays, 1, 365);
        // A stamp that cannot be read is taken as "never changed" (""), the value of an account that was never bumped.
        var payload = new Payload(app, user, string.IsNullOrWhiteSpace(unit) ? null : unit.Trim(), await StampAsync(user, fresh: true, ct) ?? "", system,
            now.ToUnixTimeSeconds(), now.AddDays(days).ToUnixTimeSeconds());
        var bytes = JsonSerializer.SerializeToUtf8Bytes(payload);
        if (key is not null)
        {
            var body = HmacPrefix + Base64Url.EncodeToString(bytes);
            return body + "." + Base64Url.EncodeToString(Mac(body));
        }
        return ProtectedPrefix + Base64Url.EncodeToString(protector.Protect(bytes));
    }

    /// <summary>The token's content when it is genuine and from this deployment (expired or not), else null.</summary>
    public AppToken? Read(string? token) => Read(token, system);

    /// <summary>
    /// The token's content when it is genuine and was issued by the deployment <paramref name="issuer"/>, else null. A
    /// token of another deployment can be read only when it is signed with the shared <c>Mobile:AppTokenKey</c> ("h1."):
    /// the Data Protection keys are each host's own.
    /// </summary>
    private AppToken? Read(string? token, string issuer)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Length > MaxLength) return null;
        token = token.Trim();
        byte[]? bytes = null;
        try
        {
            if (token.StartsWith(HmacPrefix, StringComparison.Ordinal) && key is not null)
            {
                var dot = token.LastIndexOf('.');
                if (dot <= HmacPrefix.Length) return null;
                var body = token[..dot];
                if (!CryptographicOperations.FixedTimeEquals(Mac(body), Base64Url.DecodeFromChars(token.AsSpan(dot + 1)))) return null;
                bytes = Base64Url.DecodeFromChars(body.AsSpan(HmacPrefix.Length));
            }
            else if (token.StartsWith(ProtectedPrefix, StringComparison.Ordinal))
            {
                // Also after a key was configured: tokens issued before it stay good on the host that issued them.
                bytes = protector.Unprotect(Base64Url.DecodeFromChars(token.AsSpan(ProtectedPrefix.Length)));
            }
            if (bytes is null) return null;
            var p = JsonSerializer.Deserialize<Payload>(bytes);
            if (p is null || string.IsNullOrEmpty(p.App) || string.IsNullOrEmpty(p.User) || !string.Equals(p.System, issuer, StringComparison.Ordinal))
                return null;
            return new AppToken(p.App, p.User, p.Unit, p.Stamp ?? "", p.System, DateTimeOffset.FromUnixTimeSeconds(p.Issued),
                DateTimeOffset.FromUnixTimeSeconds(p.Expires));
        }
        catch (Exception ex) when (ex is FormatException or CryptographicException or JsonException or ArgumentException)
        {
            return null;
        }
    }

    /// <summary>
    /// Checks <paramref name="token"/> for a call of <paramref name="app"/> that acts for <paramref name="user"/> and/or
    /// <paramref name="unit"/> (each compared only when given; a given unit must be the token's unit).
    /// </summary>
    public Task<AppTokenCheck> CheckAsync(string? token, string app, string? user, string? unit, CancellationToken ct = default) =>
        CheckAsync(token, system, db, app, user, unit, ct);

    /// <summary>
    /// <see cref="CheckAsync(string?, string, string?, string?, CancellationToken)"/> for a token that the deployment
    /// <paramref name="issuer"/> issued (the MSME app signs in on Main and answers its unit's surveillance NC on the
    /// Surveillance host). Only a token signed with the key both hosts hold (<c>Mobile:AppTokenKey</c>) can be read. The
    /// session stamp is the issuer's, read from <paramref name="issuerDb"/>, the issuer's database; without it the stamp
    /// is not checked (logged).
    /// </summary>
    public Task<AppTokenCheck> CheckIssuedByAsync(string? token, PortalSystem issuer, ISqlExecutor? issuerDb, string app, string? user, string? unit,
        CancellationToken ct = default)
    {
        if (issuerDb is null && !warnedNoIssuerDb)
        {
            warnedNoIssuerDb = true;
            log.LogWarning("App tokens of {Issuer} are taken without their session stamp: that deployment's database is not configured here", issuer);
        }
        return CheckAsync(token, issuer.ToString(), issuerDb, app, user, unit, ct);
    }

    private async Task<AppTokenCheck> CheckAsync(string? token, string issuer, ISqlExecutor? stamps, string app, string? user, string? unit,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(token)) return AppTokenCheck.Missing;
        if (Read(token, issuer) is not { } t) return AppTokenCheck.Invalid;
        if (!string.Equals(t.App, app, StringComparison.OrdinalIgnoreCase)) return AppTokenCheck.OtherApp;
        if (time.GetUtcNow() >= t.ExpiresAt) return AppTokenCheck.Expired;
        if (!string.IsNullOrWhiteSpace(user) && !Same(user, t.User)) return AppTokenCheck.OtherUser;
        if (!string.IsNullOrWhiteSpace(unit) && !Same(unit, t.Unit)) return AppTokenCheck.OtherUser;
        // A stamp that cannot be read (database error) is logged in StampAsync and not held against the caller.
        // A different cached stamp is read again first: the login (another host, perhaps) may have seen a newer one.
        if (stamps is not null &&
            await StampAsync(stamps, issuer, t.User, fresh: false, ct) is { } cached && !string.Equals(cached, t.Stamp, StringComparison.Ordinal) &&
            await StampAsync(stamps, issuer, t.User, fresh: true, ct) is { } current && !string.Equals(current, t.Stamp, StringComparison.Ordinal))
            return AppTokenCheck.Revoked;
        return AppTokenCheck.Valid;
    }

    /// <summary>
    /// The check of one call, in the app's mode: null when the call may go on (Off, Monitor, or a valid token), else the
    /// refusal to answer with (Enforce), the device-binding refusal's shape with <see cref="ExpiredMessage"/>. Anything
    /// but a valid token is recorded with the device events (dbo.MobileDeviceEvents, Outcome "Token…").
    /// <paramref name="tokenApp"/>: the token is checked as that app's instead (a call of <paramref name="app"/> that
    /// another app may make too, <see cref="DeviceBoundAttribute.AlsoApp"/>); the mode stays <paramref name="app"/>'s.
    /// </summary>
    public async Task<IActionResult?> RefusalAsync(HttpContext http, string app, string? user, string? unit, CancellationToken ct = default,
        string? tokenApp = null)
    {
        var mode = ModeFor(app);
        if (mode == AppTokenMode.Off) return null;
        tokenApp ??= app;
        var check = await CheckAsync(http.Request.Headers[Header].ToString(), tokenApp, user, unit, ct);
        return await RefuseAsync(http, tokenApp, user, unit, check, mode == AppTokenMode.Enforce, ct);
    }

    /// <summary>
    /// The check of a call served for an app that signed in on the deployment <paramref name="issuer"/>
    /// (<see cref="CheckIssuedByAsync"/>). Always enforced, whatever the app's mode: such calls are new in V4 and only the
    /// rebuilt apps, which send the token, make them. Anything but a valid token is recorded and refused as in Enforce.
    /// </summary>
    public async Task<IActionResult?> IssuedByRefusalAsync(HttpContext http, PortalSystem issuer, ISqlExecutor? issuerDb, string app, string? user,
        string? unit, CancellationToken ct = default)
    {
        var check = await CheckIssuedByAsync(http.Request.Headers[Header].ToString(), issuer, issuerDb, app, user, unit, ct);
        return await RefuseAsync(http, app, user, unit, check, refuse: true, ct);
    }

    private async Task<IActionResult?> RefuseAsync(HttpContext http, string app, string? user, string? unit, AppTokenCheck check, bool refuse,
        CancellationToken ct)
    {
        if (check == AppTokenCheck.Valid) return null;
        var who = (string.IsNullOrWhiteSpace(user) ? unit : user)?.Trim() ?? "";
        if (http.RequestServices.GetService(typeof(IDeviceBindings)) is IDeviceBindings devices)
            await devices.RecordTokenAsync(app, who, http.Request.Path, http.Connection.RemoteIpAddress?.ToString(), check, refuse, ct);
        else
            log.LogWarning("Mobile call {Path} for {App} user {User}: app token {Outcome} ({Action})", http.Request.Path.Value, app, who, check,
                refuse ? "refused" : "allowed");
        return refuse ? LegacyResults.Json(ServiceResponse.Fail(ExpiredMessage)) : null;
    }

    /// <summary>
    /// The user's session stamp, cached for a minute (a password change or block ends app tokens within that minute);
    /// <paramref name="fresh"/> (at login) reads it from the database. Null when it cannot be read.
    /// </summary>
    private Task<string?> StampAsync(string userId, bool fresh, CancellationToken ct) => StampAsync(db, system, userId, fresh, ct);

    /// <summary>The stamp in <paramref name="database"/>, the database of the deployment <paramref name="issuer"/> (cached per deployment).</summary>
    private async Task<string?> StampAsync(ISqlExecutor database, string issuer, string userId, bool fresh, CancellationToken ct)
    {
        var cacheKey = "zed.apptoken.stamp|" + (issuer == system ? "" : issuer + "|") + userId.Trim().ToUpperInvariant();
        if (!fresh && cache.TryGetValue(cacheKey, out string? cached)) return cached;
        try
        {
            var stamp = await SessionStamps.ReadAsync(database, userId.Trim(), ct);
            cache.Set(cacheKey, stamp, StampCacheTime);
            return stamp;
        }
        catch (DbException ex)
        {
            // E.g. the SessionStamp column is not there yet: tokens keep working (still signed and dated), revocation does not.
            log.LogError(ex, "Could not read the session stamp of {UserId} for an app token", userId);
            return null;
        }
    }

    private byte[] Mac(string body) => HMACSHA256.HashData(key!, Encoding.ASCII.GetBytes(Purpose + "|" + body));

    private static byte[]? ReadKey(string? configured, ILogger log)
    {
        if (string.IsNullOrWhiteSpace(configured)) return null;
        try
        {
            var bytes = Convert.FromBase64String(configured.Trim());
            if (bytes.Length >= 32) return bytes;
        }
        catch (FormatException)
        {
        }
        // Never log the value.
        log.LogError("Mobile:AppTokenKey is not base64 of at least 32 bytes; app tokens fall back to Data Protection (readable by this host only)");
        return null;
    }

    private static bool Same(string? a, string? b) =>
        !string.IsNullOrWhiteSpace(a) && !string.IsNullOrWhiteSpace(b) &&
        string.Equals(a.Trim(), b.Trim(), StringComparison.OrdinalIgnoreCase);

    private sealed record Payload(
        [property: JsonPropertyName("a")] string App,
        [property: JsonPropertyName("u")] string User,
        [property: JsonPropertyName("z")] string? Unit,
        [property: JsonPropertyName("s")] string? Stamp,
        [property: JsonPropertyName("y")] string System,
        [property: JsonPropertyName("i")] long Issued,
        [property: JsonPropertyName("e")] long Expires);
}
