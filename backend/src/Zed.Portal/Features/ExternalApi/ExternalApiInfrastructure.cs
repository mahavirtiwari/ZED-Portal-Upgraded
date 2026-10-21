using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Zed.Core.Mobile;

namespace Zed.Portal.Features.ExternalApi;

/// <summary>
/// Settings of the APIs that other systems call (section <c>ExternalApi</c>). None of them is a secret:
/// client secrets, AES keys and tokens live in <c>ApiClientTokens</c> / <c>ApiClientDynamicTokens</c>, as before.
/// </summary>
public sealed class ExternalApiOptions
{
    public const string Section = "ExternalApi";

    /// <summary>
    /// How long a token from GenerateToken is accepted. The procedures accept a token for 24 hours (the old
    /// code's comment said 30 minutes but never enforced it), so the value is capped at 1440. Lower it once
    /// the callers are known to request a fresh token per batch.
    /// </summary>
    public int TokenLifetimeMinutes { get; set; } = 1440;

    /// <summary>Token requests per minute per client IP (GenerateToken).</summary>
    public int TokenRequestsPerMinute { get; set; } = 10;

    /// <summary>Data requests per minute per client IP (all other actions).</summary>
    public int RequestsPerMinute { get; set; } = 300;

    /// <summary>Largest invoice/receipt PDF accepted by Msme/UploadReceiptInvoice.</summary>
    public int MaxInvoiceBytes { get; set; } = 20 * 1024 * 1024;

    public static ExternalApiOptions From(IConfiguration config)
    {
        var o = config.GetSection(Section).Get<ExternalApiOptions>() ?? new ExternalApiOptions();
        o.TokenLifetimeMinutes = Math.Clamp(o.TokenLifetimeMinutes, 1, 1440);
        o.TokenRequestsPerMinute = Math.Max(1, o.TokenRequestsPerMinute);
        o.RequestsPerMinute = Math.Max(1, o.RequestsPerMinute);
        o.MaxInvoiceBytes = Math.Clamp(o.MaxInvoiceBytes, 1024, 25 * 1024 * 1024);
        return o;
    }
}

/// <summary>
/// Base of the endpoints other systems call at the old MVC addresses (ApiSecure/…, Token/…, Msme/…):
/// no sign-in and no anti-forgery token (the callers hold no cookies), MVC 5 model binding and
/// <c>Json(...)</c> output, HTTP 200 with the status in the body (as before), per-IP rate limits.
/// Errors never return exception text.
/// </summary>
[LegacyBinding]
[AllowAnonymous]
[IgnoreAntiforgeryToken]
[ExternalApiRateLimit(ExternalApiLimit.Data)]
[ApiExplorerSettings(GroupName = "external-legacy")]
public abstract class ExternalApiController : ControllerBase
{
    private ExternalApiOptions? _options;

    protected ExternalApiOptions Options =>
        _options ??= ExternalApiOptions.From(HttpContext.RequestServices.GetRequiredService<IConfiguration>());

    protected string? ClientIp => HttpContext.Connection.RemoteIpAddress?.ToString();

    protected static ContentResult LegacyJson(object? value) => LegacyResults.Json(value);
}

public enum ExternalApiLimit { Token, Data }

/// <summary>
/// Fixed-window limit per client IP. The limiters are kept per application instance (keyed by the host's
/// <see cref="IWebHostEnvironment"/>), so no registration in Program.cs is needed. Runs before model
/// binding, so a rejected request is not read.
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, Inherited = true)]
public sealed class ExternalApiRateLimitAttribute(ExternalApiLimit limit) : Attribute, IAsyncResourceFilter, IOrderedFilter
{
    private static readonly ConditionalWeakTable<IWebHostEnvironment, Limiters> PerHost = new();
    private static readonly object ItemKey = new();

    public ExternalApiLimit Limit { get; } = limit;

    public int Order => 0;

    public async Task OnResourceExecutionAsync(ResourceExecutingContext context, ResourceExecutionDelegate next)
    {
        // The most specific attribute (action over class) decides, and a request is counted once.
        var effective = context.ActionDescriptor.EndpointMetadata.OfType<ExternalApiRateLimitAttribute>().LastOrDefault();
        if (effective is not null && effective.Limit != Limit || !context.HttpContext.Items.TryAdd(ItemKey, Limit))
        {
            await next();
            return;
        }

        var services = context.HttpContext.RequestServices;
        var limiters = PerHost.GetValue(services.GetRequiredService<IWebHostEnvironment>(),
            _ => new Limiters(ExternalApiOptions.From(services.GetRequiredService<IConfiguration>())));
        var ip = context.HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";

        using var lease = (Limit == ExternalApiLimit.Token ? limiters.Token : limiters.Data).AttemptAcquire(ip);
        if (!lease.IsAcquired)
        {
            services.GetService<ILogger<ExternalApiController>>()?.LogWarning(
                "External API rate limit ({Limit}) reached for {Ip} on {Path}", Limit, ip, context.HttpContext.Request.Path);
            context.HttpContext.Response.Headers.RetryAfter = "60";
            var result = LegacyResults.Json(new ApiServiceResponse4 { StatusCode = "429", StatusMessage = "Too many requests. Please try again later." });
            result.StatusCode = StatusCodes.Status429TooManyRequests;
            context.Result = result;
            return;
        }
        await next();
    }

    private sealed class Limiters(ExternalApiOptions o)
    {
        public PartitionedRateLimiter<string> Token { get; } = Create(o.TokenRequestsPerMinute);
        public PartitionedRateLimiter<string> Data { get; } = Create(o.RequestsPerMinute);

        private static PartitionedRateLimiter<string> Create(int perMinute) =>
            PartitionedRateLimiter.Create<string, string>(ip => RateLimitPartition.GetFixedWindowLimiter(ip,
                _ => new FixedWindowRateLimiterOptions { PermitLimit = perMinute, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    }
}

/// <summary>Unhandled errors: the action's own legacy failure body, never the exception text.</summary>
public sealed class ExternalApiErrorsAttribute(string body) : Attribute, IExceptionFilter
{
    /// <summary>{"StatusCode":"500"} in the shape of ApiServiceResponse (the Msme/... actions).</summary>
    public const string Plain500 = "plain";

    /// <summary>ApiServiceResponse with "Unable process your request, please try again later." (ApiSecure).</summary>
    public const string Secure500 = "secure";

    public void OnException(ExceptionContext context)
    {
        if (context.Exception is OperationCanceledException && context.HttpContext.RequestAborted.IsCancellationRequested) return;
        context.HttpContext.RequestServices.GetService<ILogger<ExternalApiController>>()?
            .LogError(context.Exception, "External API call {Path} failed", context.HttpContext.Request.Path);
        context.Result = LegacyResults.Json(body == Secure500 ? ApiServiceResponse.Secure500() : new ApiServiceResponse { StatusCode = "500" });
        context.ExceptionHandled = true;
    }
}

/// <summary>Input rules of the database's dbo.fn_IsSafeInput, plus length limits of the procedure parameters.</summary>
public static class SafeInput
{
    // fn_IsSafeInput uses LIKE '%…%' under a case-insensitive collation.
    private static readonly string[] Forbidden =
        ["<", ">", "script", "onerror=", "onload=", "onclick=", "javascript:", "vbscript:", "eval(", "alert(", "{{", "}}"];

    public static bool IsSafe(string? value) =>
        value is null || !Forbidden.Any(f => value.Contains(f, StringComparison.OrdinalIgnoreCase));

    /// <summary>Safe and at most <paramref name="maxLength"/> characters (null is fine).</summary>
    public static bool Ok(string? value, int maxLength) => value is null || (value.Length <= maxLength && IsSafe(value));

    public static bool AllOk(int maxLength, params string?[] values) => values.All(v => Ok(v, maxLength));
}

/// <summary>
/// AES-256-CBC with PKCS7 over UTF-8 JSON, base64 in and out: the ApiSecure envelope (old AesEncryptionHelper).
/// The old helper kept the key and IV in static fields shared by all requests, so two clients calling at the
/// same time could get each other's keys; here every call gets its own instance.
/// </summary>
public static class AesEnvelope
{
    public static bool TryKey(string? base64, out byte[] key) => TryBytes(base64, [16, 24, 32], out key);

    public static bool TryIv(string? base64, out byte[] iv) => TryBytes(base64, [16], out iv);

    public static string Encrypt(string plainText, byte[] key, byte[] iv)
    {
        using var aes = Aes.Create();
        aes.Key = key;
        return Convert.ToBase64String(aes.EncryptCbc(Encoding.UTF8.GetBytes(plainText), iv, PaddingMode.PKCS7));
    }

    /// <summary>Null when the text is not base64 or does not decrypt with this key and IV.</summary>
    public static string? TryDecrypt(string? cipherText, byte[] key, byte[] iv)
    {
        if (string.IsNullOrEmpty(cipherText) || cipherText.Length > 1_000_000) return null;
        try
        {
            using var aes = Aes.Create();
            aes.Key = key;
            return Encoding.UTF8.GetString(aes.DecryptCbc(Convert.FromBase64String(cipherText), iv, PaddingMode.PKCS7));
        }
        catch (Exception ex) when (ex is FormatException or CryptographicException)
        {
            return null;
        }
    }

    private static bool TryBytes(string? base64, int[] lengths, out byte[] bytes)
    {
        bytes = [];
        if (string.IsNullOrWhiteSpace(base64) || base64.Length > 100) return false;
        try
        {
            bytes = Convert.FromBase64String(base64.Trim());
            return lengths.Contains(bytes.Length);
        }
        catch (FormatException)
        {
            return false;
        }
    }
}
