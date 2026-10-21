using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Caching.Distributed;
using Zed.Core.Security;

namespace Zed.Portal.Features.Msme;

/// <summary>
/// Server-side state for one registration attempt. The legacy page kept everything in the browser
/// and FinalSubmit trusted whatever the browser posted (including the Udyam details and an e-mail
/// that had not necessarily been verified). Here the Udyam data, the chosen plant/activity and the
/// e-mail verification live on the server; the browser only holds the opaque Id.
/// </summary>
public sealed class RegistrationSession
{
    public string Id { get; set; } = SecureRandom.Token();
    public string RegistrationNo { get; set; } = "";
    public string MobileNo { get; set; } = "";
    public UdyamLookup Lookup { get; set; } = new([], [], []);
    public int? PlantIndex { get; set; }
    public int? ActivityIndex { get; set; }
    public string? Email { get; set; }
    public string? OtpHash { get; set; }
    public DateTimeOffset? OtpIssuedUtc { get; set; }
    public int OtpSends { get; set; }
    public int OtpFailures { get; set; }
    public bool EmailVerified { get; set; }

    public Dictionary<string, string>? Plant => PlantIndex is { } i && i >= 0 && i < Lookup.Plants.Count ? Lookup.Plants[i] : null;
    public Dictionary<string, string>? Activity => ActivityIndex is { } i && i >= 0 && i < Lookup.Activities.Count ? Lookup.Activities[i] : null;

    public static string HashOtp(string sessionId, string otp) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(sessionId + ":" + otp)));
}

public sealed class RegistrationSessionStore(IDistributedCache cache)
{
    private static readonly DistributedCacheEntryOptions Lifetime = new() { SlidingExpiration = TimeSpan.FromMinutes(30) };

    public async Task<RegistrationSession?> GetAsync(string id, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(id) || id.Length > 64) return null;
        var bytes = await cache.GetAsync(Key(id), ct);
        return bytes is null ? null : JsonSerializer.Deserialize<RegistrationSession>(bytes);
    }

    public Task SaveAsync(RegistrationSession s, CancellationToken ct) =>
        cache.SetAsync(Key(s.Id), JsonSerializer.SerializeToUtf8Bytes(s), Lifetime, ct);

    public Task RemoveAsync(string id, CancellationToken ct) => cache.RemoveAsync(Key(id), ct);

    private static string Key(string id) => "msme-reg:" + id;
}
