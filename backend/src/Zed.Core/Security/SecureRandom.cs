using System.Security.Cryptography;

namespace Zed.Core.Security;

/// <summary>Cryptographically secure replacements for the legacy System.Random based RandomString().</summary>
public static class SecureRandom
{
    // Same alphabet as the legacy code minus look-alike characters (0/o, 1/l/i).
    private const string Alphanumeric = "23456789abcdefghjkmnpqrstuvwxyz";
    private const string Digits = "0123456789";

    public static string Otp(int length = 6) => RandomNumberGenerator.GetString(Digits, length);

    public static string Password(int length = 10) => RandomNumberGenerator.GetString(Alphanumeric, length);

    /// <summary>URL-safe opaque token (password reset links, registration sessions).</summary>
    public static string Token(int bytes = 32) =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(bytes)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
