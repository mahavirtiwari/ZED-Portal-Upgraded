using Microsoft.Extensions.Options;
using Twilio.Jwt.AccessToken;
using Zed.Core.Mobile;

namespace Zed.Main.MobileApi;

/// <summary>
/// Twilio Video access tokens for remote assessments ("{ZedId} Remote Assessment" room), as the
/// old services issued them at login. The old code had the account keys in source; they now come
/// from configuration (Mobile:Twilio), and with no keys configured no token is issued.
/// </summary>
public sealed class TwilioVideoTokens(IOptions<MobileOptions> options, ILogger<TwilioVideoTokens> logger)
{
    public string? Create(string? identity)
    {
        var t = options.Value.Twilio;
        if (string.IsNullOrWhiteSpace(identity)) return null;
        if (string.IsNullOrEmpty(t.AccountSid) || string.IsNullOrEmpty(t.ApiKey) || string.IsNullOrEmpty(t.ApiSecret))
        {
            logger.LogWarning("Mobile:Twilio is not configured; no video token issued");
            return null;
        }
        var grants = new HashSet<IGrant> { new VideoGrant { Room = string.Concat(identity, " Remote Assessment") } };
        return new Token(t.AccountSid, t.ApiKey, t.ApiSecret, identity: identity, grants: grants).ToJwt();
    }
}
