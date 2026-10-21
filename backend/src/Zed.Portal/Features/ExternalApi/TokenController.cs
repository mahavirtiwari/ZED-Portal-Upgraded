using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;

namespace Zed.Portal.Features.ExternalApi;

/// <summary>
/// Token/GenerateToken (old TokenController): client id + secret in clear, a token back. The token is then
/// sent as <c>token</c> to Msme/GetDetailsByCertification, GetDetailsByCertifications,
/// GetStateCertificationsByPage, SubmitIncentive(V2) and UploadReceiptInvoice.
/// </summary>
[ExternalApiErrors(ExternalApiErrorsAttribute.Plain500)]
public sealed class TokenController(ISqlExecutor db, ILogger<TokenController> log) : ExternalApiController
{
    /// <summary>POST Token/GenerateToken (clientId, clientSecret) → {"StatusCode":"1","Token":"…"}.</summary>
    [HttpPost("/Token/GenerateToken")]
    [ExternalApiRateLimit(ExternalApiLimit.Token)]
    public async Task<IActionResult> GenerateToken(string? clientId, string? clientSecret, CancellationToken ct)
    {
        var clients = new ApiClients(db, Options);
        var client = await clients.ValidateClientAsync(clientId, clientSecret, ct);
        if (client is null)
        {
            log.LogWarning("Token/GenerateToken refused for client id {ClientId} from {Ip}", Shorten(clientId), ClientIp);
            return LegacyJson(ApiServiceResponse.Status("401", "Invalid Client ID or Client Secret."));
        }

        var token = await clients.IssueAsync(client, ct);
        log.LogInformation("Token/GenerateToken issued a token to {Client} from {Ip}", client.Name, ClientIp);
        return LegacyJson(new { StatusCode = "1", Token = token });
    }

    internal static string? Shorten(string? value) => value is { Length: > 50 } ? value[..50] : value;
}
