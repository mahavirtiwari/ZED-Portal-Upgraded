using System.Security.Cryptography;
using System.Text;
using Dapper;
using Zed.Core.Data;
using Zed.Core.Security;

namespace Zed.Portal.Features.ExternalApi;

/// <summary>A registered API client (row of dbo.ApiClientTokens). <see cref="Token"/> is its secret.</summary>
public sealed class ApiClientRow
{
    public long Id { get; set; }
    public string? Client { get; set; }
    public string? ClientId { get; set; }
    public string? Token { get; set; }
    public bool? ReverseToken { get; set; }
    public string? AesKey { get; set; }
    public string? AesIV { get; set; }

    public string Name => string.IsNullOrWhiteSpace(Client) ? "client #" + Id : Client!;
}

public sealed class ApiDynamicTokenRow
{
    public long Id { get; set; }
    public string? DynamicToken { get; set; }
    public string? OriginalToken { get; set; }
}

/// <summary>Who called: the client's name for the log (never the token) and, for a dynamic token, the client's secret it belongs to.</summary>
public sealed record ApiCaller(string Client, string Kind, long TokenId, string? ClientSecret);

/// <summary>Which static (ApiClientTokens) tokens an action accepted in the old code.</summary>
public enum StaticTokenScope
{
    /// <summary>SP_API_GET_TOKEN called without a client id: only rows whose ClientId is NULL.</summary>
    WithoutClientId,
    /// <summary>The Udyami procedures (SP_API_MSME_*): any row.</summary>
    Any,
    /// <summary>SP_API_SUBMIT_INCENTIVE_DETAILS: rows with ReverseToken = 1.</summary>
    ReverseToken,
}

/// <summary>
/// Client and token checks of the external APIs, replacing SP_API_GET_TOKEN / SP_API_GET_DYNAMIC_TOKEN /
/// SP_API_GET_AES_KEYS lookups. Read-only queries; the secrets are compared in constant time in .NET
/// (the client table holds a handful of rows, so it is read whole), and nothing writes a token to a log
/// table (SP_API_GET_TOKEN and SP_API_GET_DYNAMIC_TOKEN stored every token sent in ApiClientRequests /
/// ApiClientDynamicRequests). Procedures that check the token themselves are still given it.
/// </summary>
public sealed class ApiClients(ISqlExecutor db, ExternalApiOptions options)
{
    internal const string ClientsSql =
        "SELECT Id, Client, ClientId, Token, ReverseToken, AesKey, AesIV FROM dbo.ApiClientTokens";

    // SP_API_GET_DYNAMIC_TOKEN's rule (IsValid, issued in the last 24 hours) with the configured lifetime.
    internal const string DynamicTokenSql =
        "SELECT TOP 1 Id, DynamicToken, OriginalToken FROM dbo.ApiClientDynamicTokens " +
        "WHERE DynamicToken = @Token AND IsValid = 1 AND CreatedDate >= DATEADD(minute, -@Minutes, GETDATE()) ORDER BY Id DESC";

    public Task<IReadOnlyList<ApiClientRow>> AllAsync(CancellationToken ct) => db.QuerySqlAsync<ApiClientRow>(ClientsSql, null, ct);

    /// <summary>
    /// SP_API_GET_TOKEN(ClientId, Token): the secret, for that client id or for a row without one. The
    /// database compared case-insensitively, so the comparison here does too.
    /// </summary>
    public async Task<ApiClientRow?> ValidateClientAsync(string? clientId, string? clientSecret, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(clientId) || string.IsNullOrEmpty(clientSecret) || clientId.Length > 50 || clientSecret.Length > 500) return null;
        var rows = await AllAsync(ct);
        return Match(rows.Where(r => r.ClientId is null || string.Equals(r.ClientId, clientId, StringComparison.OrdinalIgnoreCase)), clientSecret);
    }

    /// <summary>The client whose secret this is (SP_API_GET_AES_KEYS looked up by Token alone).</summary>
    public async Task<ApiClientRow?> BySecretAsync(string? clientSecret, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(clientSecret) || clientSecret.Length > 500) return null;
        return Match(await AllAsync(ct), clientSecret);
    }

    public async Task<ApiCaller?> StaticAsync(string? token, StaticTokenScope scope, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(token) || token.Length > 500) return null;
        var rows = (await AllAsync(ct)).Where(r => scope switch
        {
            StaticTokenScope.WithoutClientId => r.ClientId is null,
            StaticTokenScope.ReverseToken => r.ReverseToken == true,
            _ => true,
        });
        return Match(rows, token) is { } row ? new ApiCaller(row.Name, "static", row.Id, row.Token) : null;
    }

    /// <summary>A token issued by GenerateToken, still valid and within the configured lifetime.</summary>
    public async Task<ApiCaller?> DynamicAsync(string? token, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(token) || token.Length > 2000) return null;
        var found = (await db.QuerySqlAsync<ApiDynamicTokenRow>(DynamicTokenSql, new
        {
            Token = new DbString { Value = token, IsAnsi = true, Length = 2000 },
            Minutes = options.TokenLifetimeMinutes,
        }, ct)).FirstOrDefault();
        // SQL compared case-insensitively; the issued value must match exactly.
        if (found?.DynamicToken is null || !FixedEquals(found.DynamicToken, token)) return null;

        var client = found.OriginalToken is null ? null : Match(await AllAsync(ct), found.OriginalToken);
        return new ApiCaller(client?.Name ?? "unknown client", "dynamic", found.Id, client?.Token ?? found.OriginalToken);
    }

    /// <summary>A dynamic token or, where the old procedure also accepted one, a static token.</summary>
    public async Task<ApiCaller?> DynamicOrStaticAsync(string? token, StaticTokenScope scope, CancellationToken ct) =>
        await DynamicAsync(token, ct) ?? await StaticAsync(token, scope, ct);

    /// <summary>
    /// Issues a new token for the client (SP_API_INSERT_DYNAMIC_TOKEN invalidates the client's earlier ones).
    /// 256 random bits, URL-safe base64; the old value was a SHA-256 of client id, time and a GUID.
    /// </summary>
    public async Task<string> IssueAsync(ApiClientRow client, CancellationToken ct)
    {
        var token = SecureRandom.Token(32);
        await db.ExecuteProcAsync("SP_API_INSERT_DYNAMIC_TOKEN", new { OriginalToken = client.Token, DynamicToken = token }, ct);
        return token;
    }

    /// <summary>Stores the IV a client sent with ApiSecure/GenerateToken (SP_API_GET_AES_KEYS with IsNewAesIV).</summary>
    public Task SaveIvAsync(ApiClientRow client, string iv, CancellationToken ct) =>
        db.ExecuteProcAsync("SP_API_GET_AES_KEYS", new { Token = client.Token, AesIV = iv, IsNewAesIV = true }, ct);

    private static ApiClientRow? Match(IEnumerable<ApiClientRow> rows, string secret)
    {
        ApiClientRow? match = null;
        foreach (var row in rows)
        {
            // Every row is compared, so the time taken does not depend on which one matches.
            if (row.Token is not null && FixedEqualsIgnoreCase(row.Token, secret) && match is null) match = row;
        }
        return match;
    }

    private static bool FixedEquals(string a, string b) =>
        CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(a), Encoding.UTF8.GetBytes(b));

    private static bool FixedEqualsIgnoreCase(string a, string b) =>
        FixedEquals(a.ToUpperInvariant(), b.ToUpperInvariant());
}
