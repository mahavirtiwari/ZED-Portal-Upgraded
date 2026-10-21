using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Zed.Portal.Features.Remote;

/// <summary>
/// Twilio Video settings of the portal (section <c>Twilio</c>). The old RemoteController had the account
/// SID, API key and API secret in source code (SECURITY-FINDINGS #29/#48: rotate them); set the new values
/// with user secrets or environment variables (<c>Twilio__AccountSid</c>, <c>Twilio__ApiKey</c>,
/// <c>Twilio__ApiSecret</c>). With no values the remote-assessment screen works without video.
/// </summary>
public sealed class TwilioVideoOptions
{
    public const string Section = "Twilio";

    public string AccountSid { get; set; } = "";
    public string ApiKey { get; set; } = "";
    public string ApiSecret { get; set; } = "";

    /// <summary>Lifetime of a video token (Twilio's default was used before: 1 hour). 5–240 minutes.</summary>
    public int TokenMinutes { get; set; } = 60;

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(AccountSid) && !string.IsNullOrWhiteSpace(ApiKey) && !string.IsNullOrWhiteSpace(ApiSecret);

    public static TwilioVideoOptions From(IConfiguration config) =>
        config.GetSection(Section).Get<TwilioVideoOptions>() ?? new TwilioVideoOptions();
}

/// <summary>
/// Twilio access token (JWT, HS256, content type <c>twilio-fpa;v=1</c>) with a Video grant for one room,
/// the same token the Twilio SDK's <c>AccessToken</c>/<c>VideoGrant</c> produced in the old controller.
/// Written out here because the portal API does not reference the Twilio package (only the mobile API does).
/// </summary>
public static class TwilioVideoToken
{
    /// <summary>Room of a unit's remote assessment; the RA app's token (mobile API RA/GetToken) joins the same room.</summary>
    public static string RoomName(string zedId) => string.Concat(zedId, " Remote Assessment");

    public static string Create(TwilioVideoOptions options, string identity, string room, DateTimeOffset now)
    {
        if (!options.IsConfigured) throw new InvalidOperationException("Twilio is not configured.");
        var minutes = Math.Clamp(options.TokenMinutes, 5, 240);
        var issuedAt = now.ToUnixTimeSeconds();

        var header = new JsonObject { ["cty"] = "twilio-fpa;v=1", ["typ"] = "JWT", ["alg"] = "HS256" };
        var payload = new JsonObject
        {
            ["jti"] = $"{options.ApiKey}-{issuedAt}",
            ["iss"] = options.ApiKey,
            ["sub"] = options.AccountSid,
            ["iat"] = issuedAt,
            ["nbf"] = issuedAt,
            ["exp"] = issuedAt + minutes * 60,
            ["grants"] = new JsonObject
            {
                ["identity"] = identity,
                ["video"] = new JsonObject { ["room"] = room },
            },
        };

        var signingInput = Base64Url(Encoding.UTF8.GetBytes(header.ToJsonString())) + "." +
                           Base64Url(Encoding.UTF8.GetBytes(payload.ToJsonString(new JsonSerializerOptions { WriteIndented = false })));
        var signature = HMACSHA256.HashData(Encoding.UTF8.GetBytes(options.ApiSecret), Encoding.ASCII.GetBytes(signingInput));
        return signingInput + "." + Base64Url(signature);
    }

    public static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
