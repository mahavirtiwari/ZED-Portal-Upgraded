using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Zed.Core.Payments;

public sealed class CcAvenueOptions
{
    public const string Section = "CcAvenue";

    public string MerchantId { get; set; } = "";
    /// <summary>Access code of the web (non-mobile) integration (legacy CcAvenueAccessCode).</summary>
    public string AccessCode { get; set; } = "";
    /// <summary>Working key of the web integration (legacy CcAvenueWorkingKey). Secret.</summary>
    public string WorkingKey { get; set; } = "";
    /// <summary>Working key CCAvenue uses for the reconciliation callback (legacy CcAvenueWorkingKeyReconciliation). Secret.</summary>
    public string ReconciliationWorkingKey { get; set; } = "";
    /// <summary>Transaction page; test: https://test.ccavenue.com/transaction/transaction.do?command=initiateTransaction</summary>
    public string GatewayUrl { get; set; } = "https://test.ccavenue.com/transaction/transaction.do?command=initiateTransaction";

    /// <summary>
    /// Access code of the mobile app integration (legacy CcAvenueAccessCodeMobile), used by the app's
    /// Pay/GetToken and Pay/GetTokenRSA. Empty: mobile payments are refused.
    /// </summary>
    public string MobileAccessCode { get; set; } = "";
    /// <summary>Working key of the mobile app integration (legacy CcAvenueWorkingKeyMobile). Secret.</summary>
    public string MobileWorkingKey { get; set; } = "";
    /// <summary>
    /// Base address of CCAvenue's mobile services (getSecureToken, getRSAKey). The legacy code always called
    /// production; test: https://test.ccavenue.com
    /// </summary>
    public string MobileServiceUrl { get; set; } = "https://secure.ccavenue.com";
}

/// <summary>
/// CCAvenue request/response encryption, compatible with the vendor's MCPG.CCA.Util.dll used by the MVC
/// site: AES-128-CBC, key = MD5(working key), IV = 00 01 … 0F, PKCS7, lower-case hex.
/// Verified against that library (see CcAvenueCryptoTests).
/// </summary>
public static class CcAvenueCrypto
{
    private static readonly byte[] Iv = [0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f];

    public static string Encrypt(string plainText, string workingKey)
    {
        using var aes = Create(workingKey);
        var bytes = aes.EncryptCbc(Encoding.UTF8.GetBytes(plainText), Iv);
        return Convert.ToHexStringLower(bytes);
    }

    /// <exception cref="FormatException">Not hex.</exception>
    /// <exception cref="CryptographicException">Wrong key or tampered data.</exception>
    public static string Decrypt(string cipherHex, string workingKey)
    {
        using var aes = Create(workingKey);
        return Encoding.UTF8.GetString(aes.DecryptCbc(Convert.FromHexString(cipherHex.Trim()), Iv));
    }

    /// <summary>Legacy Adler-32 checksum of "merchant|order|amount|url|key" (ignored by the current gateway, sent for parity).</summary>
    public static string Checksum(string merchantId, string orderId, string amount, string url, string workingKey)
    {
        const long Base = 65521;
        long s1 = 1, s2 = 0;
        foreach (var ch in $"{merchantId}|{orderId}|{amount}|{url}|{workingKey}")
        {
            s1 = (s1 + ch) % Base;
            s2 = (s2 + s1) % Base;
        }
        return ((s2 << 16) + s1).ToString(CultureInfo.InvariantCulture);
    }

    /// <summary>Decrypted response "k=v&amp;k=v…" as a dictionary (first '=' splits key and value).</summary>
    public static Dictionary<string, string> ParseResponse(string decrypted)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var part in decrypted.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var i = part.IndexOf('=');
            var key = (i < 0 ? part : part[..i]).Trim();
            if (key.Length > 0) result[key] = i < 0 ? "" : part[(i + 1)..].Trim();
        }
        return result;
    }

    /// <summary>
    /// Builds the request string. Values are stripped of the separators '&amp;' and '=' (the legacy code
    /// concatenated them raw, so a name containing "&amp;amount=1" would have injected a parameter).
    /// </summary>
    public static string BuildRequest(IEnumerable<KeyValuePair<string, string?>> fields) =>
        string.Join("&", fields.Select(f => f.Key + "=" + Clean(f.Value)));

    private static string Clean(string? value) =>
        string.IsNullOrEmpty(value) ? "" : new string(value.Where(c => c is not '&' and not '=' && !char.IsControl(c)).ToArray()).Trim();

    private static Aes Create(string workingKey)
    {
        if (string.IsNullOrEmpty(workingKey)) throw new InvalidOperationException("CCAvenue working key is not configured.");
        var aes = Aes.Create();
        aes.Key = MD5.HashData(Encoding.UTF8.GetBytes(workingKey));
        return aes;
    }
}
