using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Mobile;

namespace Zed.Portal.Features.ExternalApi;

/// <summary>
/// ApiSecure/… (old ApiSecureController): the encrypted variant of the certification lookup and the RAMP
/// dashboard lists. Every request is <c>{ClientSecret, AesIV, EncryptedData}</c>, where EncryptedData is
/// AES-256-CBC (client's key from ApiClientTokens.AesKey) over JSON.
/// <list type="bullet">
/// <item>GenerateToken: EncryptedData = {ClientId, ClientSecret} under the IV sent in AesIV; that IV is then
/// stored for the client and used for all later requests and answers; Data = encrypted {"Token":"…"}.</item>
/// <item>GetDetailsByCertification: {Token, UdyamNumber, CertificationNumber}; Data = encrypted
/// {PlantDetails, CertificationDetails}.</item>
/// <item>GetMsmeList / GetMsmeHandholdingList: {Token, PageNo, PageSize}; answered in clear.</item>
/// </list>
/// The "Internal check" helpers (GenerateEncryptedTokenRequest, GetAesIV, GetAesKey,
/// GetEncryptedDetailsByCertificationRequest, GetDetailsByCertificationDecrypt, GetmsmeListEncryptedRequest)
/// are not ported: they were anonymous encrypt/decrypt oracles for the stored client keys, written for testing.
/// </summary>
[ExternalApiErrors(ExternalApiErrorsAttribute.Secure500)]
public sealed class ApiSecureController(ISqlExecutor db, ILogger<ApiSecureController> log) : ExternalApiController
{
    /// <summary>Newtonsoft's defaults for the encrypted payloads: names as declared, nulls kept, no HTML escaping.</summary>
    private static readonly JsonSerializerOptions PayloadJson = new()
    {
        PropertyNamingPolicy = null,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    private ApiClients Clients => new(db, Options);

    [HttpPost("/ApiSecure/GenerateToken")]
    [ExternalApiRateLimit(ExternalApiLimit.Token)]
    public async Task<IActionResult> GenerateToken(EncryptedRequestDto encryptedRequestDto, CancellationToken ct)
    {
        var client = await Clients.BySecretAsync(encryptedRequestDto.ClientSecret, ct);
        if (client is null || !AesEnvelope.TryKey(client.AesKey, out var key) || !AesEnvelope.TryIv(encryptedRequestDto.AesIV, out var iv))
            return Refused("unknown client secret, no AES key or invalid IV");

        var json = AesEnvelope.TryDecrypt(encryptedRequestDto.EncryptedData, key, iv);
        var request = Parse<TokenRequestDto>(json);
        var inner = request is null ? null : await Clients.ValidateClientAsync(request.ClientId, request.ClientSecret, ct);
        // The old action stored the new IV before checking anything, so anyone holding a client's secret
        // could replace its IV and break its later calls. The IV is now stored only for a verified client,
        // and the credentials inside must be the envelope's own client.
        if (inner is null || inner.Id != client.Id) return Refused("credentials did not match");

        await Clients.SaveIvAsync(client, encryptedRequestDto.AesIV!.Trim(), ct);
        var token = await Clients.IssueAsync(client, ct);
        log.LogInformation("ApiSecure/GenerateToken issued a token to {Client} from {Ip}", client.Name, ClientIp);
        var data = AesEnvelope.Encrypt(JsonSerializer.Serialize(new { Token = token }, PayloadJson), key, iv);
        return LegacyJson(new { StatusCode = "200", StatusMessage = "Success", Data = data });

        IActionResult Refused(string reason)
        {
            log.LogWarning("ApiSecure/GenerateToken refused from {Ip}: {Reason}", ClientIp, reason);
            return LegacyJson(ApiServiceResponse.Status("401", "Invalid Client ID or Client Secret."));
        }
    }

    [HttpPost("/ApiSecure/GetDetailsByCertification")]
    public async Task<IActionResult> GetDetailsByCertification(EncryptedRequestDto encryptedRequestDto, CancellationToken ct)
    {
        var opened = await OpenAsync<DetailsByCertificationDto>(encryptedRequestDto, ct);
        if (opened is null) return LegacyJson(ApiServiceResponse.Secure500());
        var (client, key, iv, request) = opened.Value;

        if (!await TokenOfAsync(client, request.Token, ct)) return LegacyJson(ApiServiceResponse.Status("401", "Invalid Token."));
        if (!SafeInput.AllOk(50, request.UdyamNumber, request.CertificationNumber)) return LegacyJson(ApiServiceResponse.Status("400", "Bad Request"));

        var ds = await db.QueryProcMultipleAsync("SP_API_GET_CERTIFIED_UNIT_DETAILS_BY_UDYAM",
            new { request.UdyamNumber, request.CertificationNumber }, ct);
        log.LogInformation("ApiSecure/GetDetailsByCertification by {Client}: {Udyam} {Found}", client.Name, request.UdyamNumber, ds[0].Count > 0);
        if (ds[0].Count == 0) return LegacyJson(ApiServiceResponse.Status("404", "Invalid Details."));

        var (plant, certification) = CertificationLookups.Details3(ds);
        var payload = JsonSerializer.Serialize(new { PlantDetails = plant, CertificationDetails = certification }, PayloadJson);
        return LegacyJson(new { StatusCode = "200", StatusMessage = "Success", Data = AesEnvelope.Encrypt(payload, key, iv) });
    }

    /// <summary>RAMP dashboard: ZED certification applications (SP_API_RAMP_REPORT_ZED over MsmeZedRampReport).</summary>
    [HttpPost("/ApiSecure/GetMsmeList")]
    public async Task<IActionResult> GetMsmeList(EncryptedRequestDto encryptedRequestDto, CancellationToken ct)
    {
        var page = await OpenPageAsync(encryptedRequestDto, ct);
        if (page.Error is not null) return page.Error;

        var ds = await db.QueryProcMultipleAsync("SP_API_RAMP_REPORT_ZED", new { PageNo = page.No, PageSize = page.Size }, ct);
        if (StatusOf(ds) is { } status) return status;
        log.LogInformation("ApiSecure/GetMsmeList by {Client}: page {Page} size {Size}", page.Client, page.No, page.Size);

        return LegacyJson(new RampDashboardMsmeListDto
        {
            msmeList = ds[1].Select(r => new RampDashboardMsmeDto
            {
                Id = r.Text("Id"), ZedId = r.Text("ZedId"), UnitName = r.Text("UnitName"), StateName = r.Text("StateName"),
                DistrictName = r.Text("DistrictName"), Certification = r.Text("Certification"), EnterpriseType = r.Text("EnterpriseType"),
                Gender = r.Text("Gender"), SocialCategoryName = r.Text("SocialCategoryName"), RegistrationDate = r.Text("RegistrationDate"),
                CertificationDate = r.Text("CertificationDate"), UdyogAadharNo = r.Text("UdyogAadharNo"), SectorsName = r.Text("SectorsName"),
                ApplicationStatus = r.Text("ApplicationStatus"), ReasonForRejection = r.Text("ReasonForRejection"),
                ApplicationCertificationCategory = r.Text("ApplicationCertificationCategory"), AssessmentStatus = r.Text("AssessmentStatus"),
                CreatedOn = r.Text("CreatedOn"), MsmeCertId = r.Text("MsmeCertId"),
            }).ToList(),
            ToalCount = TotalCount(ds),
            PageNo = page.No,
            PageSize = page.Size,
            StatusCode = "200",
        });
    }

    /// <summary>RAMP dashboard: handholding (ZED_CONSULTANT.dbo.ConsultancyRampReport via SP_API_RAMP_REPORT_CONSULTANCY).</summary>
    [HttpPost("/ApiSecure/GetMsmeHandholdingList")]
    public async Task<IActionResult> GetMsmeHandholdingList(EncryptedRequestDto encryptedRequestDto, CancellationToken ct)
    {
        var page = await OpenPageAsync(encryptedRequestDto, ct);
        if (page.Error is not null) return page.Error;

        var ds = await db.QueryProcMultipleAsync("SP_API_RAMP_REPORT_CONSULTANCY", new { PageNo = page.No, PageSize = page.Size }, ct);
        if (StatusOf(ds) is { } status) return status;
        log.LogInformation("ApiSecure/GetMsmeHandholdingList by {Client}: page {Page} size {Size}", page.Client, page.No, page.Size);

        return LegacyJson(new RampDashboardHandholdingListDto
        {
            handholdingList = ds[1].Select(r => new RampDashboardHandholdingDto
            {
                Id = r.Text("Id"), ZedId = r.Text("ZedId"), UnitName = r.Text("UnitName"), StateName = r.Text("StateName"),
                DistrictName = r.Text("DistrictName"), HandholdingLevelCertification = r.Text("HandholdingLevelCertification"),
                EnterpriseType = r.Text("EnterpriseType"), Gender = r.Text("Gender"), SocialCategoryName = r.Text("SocialCategoryName"),
                HandholdingOptedDate = r.Text("HandholdingOptedDate"), UdyogAadharNo = r.Text("UdyogAadharNo"), SectorName = r.Text("SectorName"),
                Milestone1Process = r.Text("Milestone1Process"), DateofM1Completion = r.Text("DateofM1Completion"),
                Milestone2Process = r.Text("Milestone2Process"), DateofM2Completion = r.Text("DateofM2Completion"),
                Milestone3Process = r.Text("Milestone3Process"), FinalDateofCompletion = r.Text("FinalDateofCompletion"),
            }).ToList(),
            ToalCount = TotalCount(ds),
            PageNo = page.No,
            PageSize = page.Size,
            StatusCode = "200",
        });
    }

    // ----- helpers -----

    private sealed record Page(IActionResult? Error, string Client = "", int No = 0, int Size = 0);

    private async Task<Page> OpenPageAsync(EncryptedRequestDto dto, CancellationToken ct)
    {
        var opened = await OpenAsync<GetMsmeListDto>(dto, ct);
        if (opened is null) return new Page(LegacyJson(ApiServiceResponse.Secure500()));
        var (client, _, _, request) = opened.Value;
        if (!await TokenOfAsync(client, request.Token, ct)) return new Page(LegacyJson(ApiServiceResponse.Status("401", "Invalid Token.")));
        // The old code passed the text to the procedure, so anything but a number failed with a 500.
        if (!int.TryParse(request.PageNo, NumberStyles.None, CultureInfo.InvariantCulture, out var no) || no < 1 ||
            !int.TryParse(request.PageSize, NumberStyles.None, CultureInfo.InvariantCulture, out var size) || size < 1)
            return new Page(LegacyJson(ApiServiceResponse.Status("400", "PageNo and PageSize must be positive numbers.")));
        return new Page(null, client.Name, no, size);
    }

    /// <summary>The procedures' first set: StatusCode 200, or 400 with a message (page size over 1000).</summary>
    private static ContentResult? StatusOf(ResultSets ds)
    {
        var row = ds[0].FirstOrDefault();
        if (row is not null && row.Text("StatusCode") == "200") return null;
        return LegacyJson(row is null ? ApiServiceResponse.Secure500() : ApiServiceResponse.Status(row.Text("StatusCode"), row.Text("StatusMessage")));
    }

    private static int TotalCount(ResultSets ds) =>
        int.TryParse(ds[2].FirstOrDefault()?.Text("TotalCount"), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) ? n : 0;

    /// <summary>Client by the envelope's secret, its stored key and IV, and the decrypted request; null as the old 500.</summary>
    private async Task<(ApiClientRow Client, byte[] Key, byte[] Iv, T Request)?> OpenAsync<T>(EncryptedRequestDto dto, CancellationToken ct) where T : class
    {
        var client = await Clients.BySecretAsync(dto.ClientSecret, ct);
        if (client is null || !AesEnvelope.TryKey(client.AesKey, out var key) || !AesEnvelope.TryIv(client.AesIV, out var iv))
        {
            log.LogWarning("{Path} refused from {Ip}: unknown client secret or no AES key/IV", Request.Path, ClientIp);
            return null;
        }
        var request = Parse<T>(AesEnvelope.TryDecrypt(dto.EncryptedData, key, iv));
        if (request is null)
        {
            log.LogWarning("{Path} from {Client}: the request did not decrypt", Request.Path, client.Name);
            return null;
        }
        return (client, key, iv, request);
    }

    /// <summary>A valid dynamic token issued to this same client (the old code accepted any client's token).</summary>
    private async Task<bool> TokenOfAsync(ApiClientRow client, string? token, CancellationToken ct)
    {
        var caller = await Clients.DynamicAsync(token, ct);
        var ok = caller is not null && caller.TokenId > 0 && string.Equals(caller.ClientSecret, client.Token, StringComparison.OrdinalIgnoreCase);
        if (!ok) log.LogWarning("{Path} from {Client}: invalid or expired token", Request.Path, client.Name);
        return ok;
    }

    private static T? Parse<T>(string? json) where T : class
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            return JsonSerializer.Deserialize<T>(json, Zed.Core.Mobile.LegacyJson.Read);
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
