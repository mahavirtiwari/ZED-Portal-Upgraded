using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Portal.Features.Msme;

/// <summary>
/// Udyami Bharat portal (UBP) sign-in hand-over. UBP sends the browser to /Msme/ZedDashboard?applicationNo=&amp;token=
/// (Angular page msme/udyami-signin), which posts here. Port of MsmeController.ZedDashboard and
/// Helpers/UdyamiIntegrationService. The old code signed the user in with a hard-coded master password
/// (SECURITY-FINDINGS #1); V4 looks the user up by id once UBP has confirmed the token.
/// </summary>
public sealed class UdyamiBharatOptions
{
    public const string Section = "UdyamiBharat";

    public bool Enabled { get; set; }

    /// <summary>Client-credentials token endpoint (old: https://uatgatway.ubputl.com/api/v1/login/token — the UAT gateway, also in production).</summary>
    public string TokenUrl { get; set; } = "";

    /// <summary>Sign-in token verification (old: .../etpri/api/v1/redirectscheme/verifysignintoken).</summary>
    public string VerifyUrl { get; set; } = "";

    public string ClientId { get; set; } = "";

    /// <summary>Secret; user secrets or environment only. The old one was in source code: rotate it.</summary>
    public string ClientSecret { get; set; } = "";

    /// <summary>Hosts (or parent domains) the "Back to UBP" link may point to.</summary>
    public List<string> ReturnHosts { get; set; } = ["ubputl.com"];
}

public sealed record UdyamiVerification(bool Verified, string? ReturnUrl, string StatusCode, string? ResponseBody);

public interface IUdyamiBharatVerifier
{
    Task<UdyamiVerification> VerifyAsync(string applicationNo, string securityToken, CancellationToken ct);
}

public sealed class UdyamiBharatVerifier(HttpClient http, IOptions<UdyamiBharatOptions> options) : IUdyamiBharatVerifier
{
    private static readonly SemaphoreSlim TokenLock = new(1, 1);
    private static (string Token, DateTimeOffset Expires)? _cached;

    public async Task<UdyamiVerification> VerifyAsync(string applicationNo, string securityToken, CancellationToken ct)
    {
        var o = options.Value;
        using var request = new HttpRequestMessage(HttpMethod.Post, o.VerifyUrl)
        {
            Content = JsonContent.Create(new { ApplicationIn = applicationNo, ApplicationNo = applicationNo, SecurityToken = securityToken }),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", await AccessTokenAsync(o, ct));
        using var response = await http.SendAsync(request, ct);
        var body = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode) return new(false, null, response.StatusCode.ToString(), body);
        var result = System.Text.Json.JsonSerializer.Deserialize<VerifyResponse>(body, new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        return new(result?.IsTokenVerifed == true, result?.UbpRedirectUrl, response.StatusCode.ToString(), body);
    }

    private async Task<string> AccessTokenAsync(UdyamiBharatOptions o, CancellationToken ct)
    {
        if (_cached is { } c && c.Expires > DateTimeOffset.UtcNow.AddMinutes(1)) return c.Token;
        await TokenLock.WaitAsync(ct);
        try
        {
            if (_cached is { } again && again.Expires > DateTimeOffset.UtcNow.AddMinutes(1)) return again.Token;
            using var response = await http.PostAsync(o.TokenUrl, new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["grant_type"] = "client_credentials",
                ["client_id"] = o.ClientId,
                ["client_secret"] = o.ClientSecret,
            }), ct);
            response.EnsureSuccessStatusCode();
            var token = await response.Content.ReadFromJsonAsync<TokenResponse>(ct)
                        ?? throw new InvalidOperationException("Empty token response from Udyami Bharat.");
            var seconds = int.TryParse(token.ExpiresIn, out var s) ? s : 300;
            _cached = (token.AccessToken ?? "", DateTimeOffset.UtcNow.AddSeconds(seconds));
            return _cached.Value.Token;
        }
        finally
        {
            TokenLock.Release();
        }
    }

    private sealed class TokenResponse
    {
        [JsonPropertyName("access_token")] public string? AccessToken { get; set; }
        [JsonPropertyName("expires_in")] public string? ExpiresIn { get; set; }
    }

    private sealed class VerifyResponse
    {
        public bool IsTokenVerifed { get; set; }
        public string? UbpRedirectUrl { get; set; }
    }
}

[ApiController]
[Route("api/msme/auth/udyami-bharat")]
public sealed partial class UdyamiBharatSignInController(
    ISqlExecutor db,
    IUdyamiBharatVerifier verifier,
    IOptions<UdyamiBharatOptions> options,
    ILogger<UdyamiBharatSignInController> log) : ControllerBase
{
    public sealed record SignInRequest(string? ApplicationNo, string? Token);

    public sealed record SignInResponse(CurrentUserResponse User, string? ReturnUrl);

    [HttpPost]
    [AllowAnonymous]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<ActionResult<SignInResponse>> SignIn(SignInRequest req, CancellationToken ct)
    {
        if (!options.Value.Enabled) return this.Problem400("Sign-in from Udyami Bharat is not available at the moment. Please use the MSME login.");
        var zedId = req.ApplicationNo?.Trim().ToUpperInvariant() ?? "";
        if (!ZedId().IsMatch(zedId) || string.IsNullOrWhiteSpace(req.Token) || req.Token.Length > 4000)
            return this.Problem400("Invalid token.");

        UdyamiVerification result;
        try
        {
            result = await verifier.VerifyAsync(zedId, req.Token, ct);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or InvalidOperationException or System.Text.Json.JsonException)
        {
            log.LogError(ex, "Udyami Bharat token check failed for {ZedId}", zedId);
            return this.Problem400("Udyami Bharat could not confirm the sign-in. Please try again from Udyami Bharat or use the MSME login.");
        }

        // The old code stored the raw one-time token; a hash is enough to match a complaint to a request.
        await db.ExecuteProcAsync("SP_API_UBP_UNIT_SIGN_IN_DETAILS", new
        {
            ZedId = zedId,
            SecurityToken = "sha256:" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(req.Token))),
            result.StatusCode,
            SuccessResponse = result.ResponseBody is { Length: > 4000 } b ? b[..4000] : result.ResponseBody,
            ErrorResponse = result.Verified ? null : "Not verified",
        }, ct);
        if (!result.Verified)
        {
            log.LogWarning("Udyami Bharat did not verify the sign-in token for {ZedId}", zedId);
            return this.Problem400("Invalid token.");
        }

        var row = (await db.QueryProcMultipleAsync("SP_GET_USER_DETAILS_BY_USER_ID", new { UserId = zedId }, ct))[0].FirstOrDefault();
        var active = row is not null && (row.Text("IsActive") is "1" || row.Text("IsActive").Equals("True", StringComparison.OrdinalIgnoreCase));
        if (row is null || !active || row.Text("RoleId") != ((int)UserRole.Msme).ToString())
        {
            log.LogWarning("Udyami Bharat sign-in for {ZedId}: no active MSME account", zedId);
            return this.Problem400("Invalid credentials.");
        }

        await db.ExecuteProcAsync("SP_UPDATE_LOGIN",
            new { UserId = row.Text("UserId"), IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString(), RoleId = ((int)UserRole.Msme).ToString() }, ct);
        var user = new ZedUser(row.Text("UserId"), row.Text("UserName"), (int)UserRole.Msme, row.Text("Email"),
            row.Text("MobileNo"), row.Text("StateCode"), row.Text("DistrictCode"));
        await HttpContext.SignInZedUserAsync(user);
        return new SignInResponse(CurrentUserResponse.From(user), SafeReturnUrl(result.ReturnUrl));
    }

    /// <summary>Only an https address on a configured UBP host, so the "Back to UBP" link cannot be pointed elsewhere.</summary>
    internal string? SafeReturnUrl(string? url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps) return null;
        return options.Value.ReturnHosts.Any(h => uri.Host.Equals(h, StringComparison.OrdinalIgnoreCase)
                                                  || uri.Host.EndsWith("." + h, StringComparison.OrdinalIgnoreCase))
            ? uri.ToString()
            : null;
    }

    [GeneratedRegex(@"^ZEDMSME\d{1,12}$")]
    private static partial Regex ZedId();
}
