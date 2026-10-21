using System.Security.Cryptography;
using System.Text;

namespace Zed.Core.Security;

/// <summary>
/// The legacy login procedures (SP_GET_USER_DETAILS, SP_GET_LOGIN_DETAILS, SP_APP_MSME_CHECK_LOGIN,
/// SP_APP_SURVEILLANCE_CHECK_LOGIN in all three databases) accept hard-coded master passwords for
/// any account, and the values differ between procedures and databases. Instead of listing them,
/// a login is accepted only when the typed password equals the account's own stored password from
/// the Users row the procedure returned. See docs/SECURITY-FINDINGS.md.
/// </summary>
public static class LegacyPasswords
{
    /// <summary>
    /// True when the row's Password column matches. Compared like the procedures do (SQL Server's
    /// case-insensitive collation, trailing spaces ignored) so no existing user is locked out.
    /// A row without a Password column cannot be checked here and is left to the procedure.
    /// </summary>
    public static bool MatchesStored(IDictionary<string, object?> userRow, string? typed) =>
        !userRow.TryGetValue("Password", out var stored) || Matches(stored is null or DBNull ? null : stored.ToString(), typed);

    /// <summary>
    /// The procedures' comparison. A value V4 put in place of a password (<see cref="PasswordStore.ReplacementPrefix"/>)
    /// never matches: it is not a password, and it appears on pledge certificates (the QR code holds the initial password).
    /// </summary>
    public static bool Matches(string? stored, string? typed) =>
        !PasswordStore.IsReplacement(stored) && SameValue(stored, typed);

    /// <summary>The bare comparison (also for a replacement value V4 passed to a procedure itself).</summary>
    internal static bool SameValue(string? stored, string? typed)
    {
        if (stored is null || typed is null) return false;
        var a = Encoding.UTF8.GetBytes(stored.TrimEnd().ToUpperInvariant());
        var b = Encoding.UTF8.GetBytes(typed.TrimEnd().ToUpperInvariant());
        return CryptographicOperations.FixedTimeEquals(a, b);
    }
}
