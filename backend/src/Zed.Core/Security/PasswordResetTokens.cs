using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Configuration;
using Zed.Core.Data;

namespace Zed.Core.Security;

/// <summary>
/// Reset-link tokens kept in dbo.V4PasswordResets (migrations 0008 and 0009): 256-bit random, only the SHA-256 is
/// stored, single use, expiring, replaced by a newer link. Shared by the staff and MSME resets of the portals and by the
/// MSME app's ResetPassword. The token travels in the URL fragment (<c>#token=</c>), so it never reaches a server log.
/// </summary>
public static partial class PasswordResetTokens
{
    public const string InvalidLink = "This reset link is invalid, has expired or has already been used. Please request a new one.";

    public static string NewToken() => SecureRandom.Token(32);

    public static byte[] Hash(string token) => SHA256.HashData(Encoding.ASCII.GetBytes(token));

    /// <summary>A token as <see cref="NewToken"/> makes it (43 URL-safe characters).</summary>
    public static bool IsToken(string? token) => token is not null && TokenPattern().IsMatch(token);

    /// <summary>
    /// Records a link (SP_V4_STAFF_RESET_CREATE: it only knows UserIds, so it serves MSME accounts too). False when a
    /// self-service request (<paramref name="requestedBy"/> null) exceeds <paramref name="maxPerHour"/>.
    /// </summary>
    public static async Task<bool> CreateAsync(ISqlExecutor db, string userId, string token, int validMinutes, int maxPerHour,
        string? requestedBy, string? ip, CancellationToken ct)
    {
        var row = (await db.QueryProcMultipleAsync("SP_V4_STAFF_RESET_CREATE", new
        {
            UserId = userId,
            TokenHash = Hash(token),
            ValidMinutes = Math.Clamp(validMinutes, 1, 1440),
            MaxPerHour = Math.Max(maxPerHour, 1),
            RequestedBy = requestedBy,
            RequestIp = ip is { Length: <= 45 } ? ip : null,
        }, ct))[0].FirstOrDefault();
        return row is not null && row.TryGetValue("Created", out var v) && v is true or 1 or "1" or "True";
    }

    // ------------------------------------------------------------------ MSME accounts (migration 0009)

    /// <summary>Settings <c>MsmePasswordReset:*</c>.</summary>
    public sealed record MsmeOptions(int ValidMinutes, int MaxRequestsPerHour)
    {
        public static MsmeOptions Read(IConfiguration config) => new(
            config.GetValue("MsmePasswordReset:ValidMinutes", 60),
            config.GetValue("MsmePasswordReset:MaxRequestsPerHour", 3));
    }

    /// <summary>An MSME login (Users.RoleId 5) with the unit's name and e-mail (Msme.PledgeEmailId, else Users.Email).</summary>
    public sealed record MsmeAccount(string ZedId, string EnterpriseName, string? Email, bool IsActive)
    {
        public string? MailAddress => Email?.Trim() is { Length: > 3 } e && e.Contains('@') && !e.Any(char.IsWhiteSpace) ? e : null;
    }

    public static async Task<MsmeAccount?> FindMsmeAccountAsync(ISqlExecutor db, string zedId, CancellationToken ct)
    {
        if (zedId.Length is 0 or > 50) return null;
        var row = (await db.QueryProcMultipleAsync("SP_V4_MSME_RESET_ACCOUNT", new { ZedId = zedId }, ct))[0].FirstOrDefault();
        return row is null ? null : ToMsme(row, active: row.TryGetValue("IsActive", out var a) && a is true or 1 or "1" or "True");
    }

    /// <summary>The MSME of an open link, or null.</summary>
    public static async Task<MsmeAccount?> FindMsmeByTokenAsync(ISqlExecutor db, string? token, CancellationToken ct)
    {
        if (!IsToken(token)) return null;
        var row = (await db.QueryProcMultipleAsync("SP_V4_MSME_RESET_FIND", new { TokenHash = Hash(token!) }, ct))[0].FirstOrDefault();
        return row is null ? null : ToMsme(row, active: true);
    }

    /// <summary>Uses an open MSME link (once; clears the failed logins); the account, or null when the link is not open.</summary>
    public static async Task<MsmeAccount?> UseMsmeTokenAsync(ISqlExecutor db, string? token, CancellationToken ct)
    {
        if (!IsToken(token)) return null;
        var row = (await db.QueryProcMultipleAsync("SP_V4_MSME_RESET_USE", new { TokenHash = Hash(token!) }, ct))[0].FirstOrDefault();
        return row is null ? null : ToMsme(row, active: true);
    }

    public static string MsmeResetUrl(string publicBaseUrl, string token) => $"{publicBaseUrl.TrimEnd('/')}/msme/reset-password#token={token}";

    private static MsmeAccount ToMsme(IDictionary<string, object?> row, bool active) =>
        new(Text(row, "ZedId"), Text(row, "EnterpriseName"), Text(row, "Email") is { Length: > 0 } e ? e : null, active);

    private static string Text(IDictionary<string, object?> row, string name) =>
        row.TryGetValue(name, out var v) && v is not null and not DBNull ? Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture)?.Trim() ?? "" : "";

    [GeneratedRegex("^[A-Za-z0-9_-]{43}$")] private static partial Regex TokenPattern();
}
