using System.Text.Json;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Options;
using Zed.Core.Data;

namespace Zed.Portal.Features.Payments;

public sealed class ProteanGstinOptions
{
    public const string Section = "ProteanGstin";

    /// <summary>Protean (NSDL) GSTIN verification service (legacy ProteanApiUrl).</summary>
    public string Url { get; set; } = "";
    public string UserId { get; set; } = "";
    /// <summary>Secret (legacy ProteanPassword).</summary>
    public string Password { get; set; } = "";
}

public sealed record GstinResult(bool Valid, string Message);

public interface IGstinVerifier
{
    Task<GstinResult> VerifyAsync(string zedId, string certification, string gstin, CancellationToken ct);
}

/// <summary>
/// The app's GSTIN check. The web checkout takes only a GSTIN the unit verified with Protean in its GSTIN step; the app
/// has no such step and its checkout accepted any well-formed number, so the app's checkout verifies it here, with the
/// same service, and remembers a valid answer for 30 minutes (as the web step does) so the app's next call does not ask again.
/// </summary>
public static class AppGstin
{
    public static readonly TimeSpan Remembered = TimeSpan.FromMinutes(30);

    /// <returns>Null when the GSTIN is verified; otherwise the message for the user.</returns>
    public static async Task<string?> VerifyAsync(
        IGstinVerifier verifier, IDistributedCache cache,
        string zedId, string level, string gstin, ILogger log, CancellationToken ct)
    {
        var key = $"app-gstin-ok:{zedId}:{gstin}";
        if (await cache.GetStringAsync(key, ct) is not null) return null;

        GstinResult result;
        try { result = await verifier.VerifyAsync(zedId, level, gstin, ct); }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or InvalidOperationException)
        {
            log.LogWarning(ex, "GSTIN verification unavailable");
            return "Unexpected error occurred. Please try after some time.";
        }
        if (!result.Valid)
        {
            log.LogWarning("App checkout of {ZedId}/{Level}: GSTIN {Gstin} not verified ({Message})", zedId, level, gstin, result.Message);
            return result.Message;
        }
        await cache.SetStringAsync(key, "1", new DistributedCacheEntryOptions { AbsoluteExpirationRelativeToNow = Remembered }, ct);
        return null;
    }
}

/// <summary>
/// Port of MsmeController.ValidateGstinProtean: asks Protean about the GSTIN, then
/// SP_MSME_VALIDATE_GSTIN_PROTEAN stores the answer and decides (StatusCode 1 = valid).
/// </summary>
public sealed class ProteanGstinVerifier(HttpClient http, ISqlExecutor db, IOptions<ProteanGstinOptions> options, ILogger<ProteanGstinVerifier> log)
    : IGstinVerifier
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    public async Task<GstinResult> VerifyAsync(string zedId, string certification, string gstin, CancellationToken ct)
    {
        var o = options.Value;
        if (string.IsNullOrEmpty(o.Url)) throw new InvalidOperationException("ProteanGstin:Url is not configured.");

        using var request = new HttpRequestMessage(HttpMethod.Post, o.Url) { Content = new StringContent("", null, "application/json") };
        request.Headers.Add("UserID", o.UserId);
        request.Headers.Add("Password", o.Password);
        request.Headers.Add("GSTINID", gstin);
        using var response = await http.SendAsync(request, ct);
        var body = await response.Content.ReadAsStringAsync(ct);

        Dictionary<string, JsonElement> r;
        try { r = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(body, JsonOptions) ?? []; }
        catch (JsonException ex)
        {
            log.LogWarning(ex, "Protean returned a non-JSON response ({Status})", response.StatusCode);
            r = [];
        }
        var ci = new Dictionary<string, JsonElement>(r, StringComparer.OrdinalIgnoreCase);
        string F(string name) => ci.TryGetValue(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";

        var result = (await db.QueryProcMultipleAsync("SP_MSME_VALIDATE_GSTIN_PROTEAN", new
        {
            ZedId = zedId, CertificationType = certification, GSTIN = gstin,
            Status = F("Status"), Reason = F("Reason"), ErrorCode = F("Error_Cd"),
            RegistrationDate = F("RegistrationDate"), TypeOfCompany = F("TypeOfCompany"), StatusOfCompany = F("StatusOfCompany"),
            NameOfCompany = F("NameOfCompany"), StateOfCompany = F("StateOfCompany"), CentreJurisdiction = F("CentreJurisdiction"),
            NatureOfBusinessActivity = F("NatureOfBusinessActivity"), DateOfCancellation = F("DateOfCancellation"),
            LastUpdatedDate = F("LastUpdatedDate"), StateJurisdictionCode = F("StateJurisdictionCode"),
            CentreJurisdictionCode = F("CentreJurisdictionCode"), TradeName = F("TradeName"), TaxpayerType = F("TaxpayerType"),
            NatureOfPrincPlaceBusiness = F("NatureOfPrincPlaceBusiness"), BuildingName = F("BuildingName"), FloorName = F("FloorName"),
            DoorNum = F("DoorNum"), Street = F("Street"), Loc = F("Loc"), StateName = F("StateName"), PinCode = F("PinCode"),
            AdditionalBuildingName = F("AdditonalAddBuildingName"), AdditionalFloorName = F("AdditonalAddFloorName"),
            AdditionalDoorNum = F("AdditonalAddDoorNum"), AdditionalStreet = F("AdditonalAddStreet"), AdditionalLoc = F("AdditonalAddLoc"),
            AdditionalState = F("AdditonalAddState"), AdditionalPin = F("AdditonalAddPin"),
        }, ct))[0].FirstOrDefault();

        return new GstinResult(result?.Text("StatusCode") == "1", result?.Text("StatusMessage") ?? "Unable to verify the GSTIN.");
    }
}
