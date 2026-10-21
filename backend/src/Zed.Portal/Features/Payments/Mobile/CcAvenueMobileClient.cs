using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using Zed.Core.Mobile;
using Zed.Core.Payments;

namespace Zed.Portal.Features.Payments.Mobile;

/// <summary>CCAvenue's services for the mobile SDK, called with the mobile access code.</summary>
public interface ICcAvenueMobileClient
{
    /// <summary>mobile/service/getSecureToken for an order (PayController.PrepareCcAvenueSecureToken).</summary>
    Task<SecureTokenResponse?> GetSecureTokenAsync(string orderId, CancellationToken ct);

    /// <summary>transaction/getRSAKey for an order; CCAvenue's text answer, passed to the app unchanged.</summary>
    Task<string> GetRsaKeyAsync(string orderId, CancellationToken ct);
}

public sealed class CcAvenueMobileClient(HttpClient http, IOptions<CcAvenueOptions> options) : ICcAvenueMobileClient
{
    public async Task<SecureTokenResponse?> GetSecureTokenAsync(string orderId, CancellationToken ct)
    {
        var o = options.Value;
        var url = $"{Base(o)}/mobile/service/getSecureToken?requestId={Uri.EscapeDataString(orderId)}" +
                  $"&accessCode={Uri.EscapeDataString(o.MobileAccessCode)}" +
                  $"&requestHash={MobilePaymentHashes.Sha512(orderId + o.MobileWorkingKey + o.MerchantId)}";
        using var response = await http.PostAsync(url, new FormUrlEncodedContent([]), ct);
        var text = await response.Content.ReadAsStringAsync(ct);
        try
        {
            return JsonSerializer.Deserialize<SecureTokenResponse>(text, LegacyJson.Read);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    public async Task<string> GetRsaKeyAsync(string orderId, CancellationToken ct)
    {
        var o = options.Value;
        var url = $"{Base(o)}/transaction/getRSAKey?order_id={Uri.EscapeDataString(orderId)}&access_code={Uri.EscapeDataString(o.MobileAccessCode)}";
        using var response = await http.PostAsync(url, new FormUrlEncodedContent([]), ct);
        return await response.Content.ReadAsStringAsync(ct);
    }

    private static string Base(CcAvenueOptions o) => o.MobileServiceUrl.TrimEnd('/');
}

public static class MobilePaymentHashes
{
    /// <summary>PayController.Generatehash512: SHA-512 of the UTF-8 text, lower-case hex.</summary>
    public static string Sha512(string text) => Convert.ToHexStringLower(SHA512.HashData(Encoding.UTF8.GetBytes(text)));
}

public static class MobilePaymentsSetup
{
    /// <summary>The app's payment actions on the portal: legacy mobile support (device records) and the CCAvenue mobile client.</summary>
    public static IServiceCollection AddMobilePayments(this IServiceCollection services, IConfiguration config)
    {
        services.AddLegacyMobile(config);
        services.AddHttpClient<ICcAvenueMobileClient, CcAvenueMobileClient>(c => c.Timeout = TimeSpan.FromSeconds(30));
        return services;
    }
}
