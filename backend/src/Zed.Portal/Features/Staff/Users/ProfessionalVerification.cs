using System.Data.Common;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using Zed.Core.Data;
using Zed.Core.Payments;

namespace Zed.Portal.Features.Staff.Users;

/// <summary>
/// How an agency (or a Consultant Organisation) proves the certified professional it adds as an assessor (consultant)
/// (Administration → Settings → Professional Verification, 2026-11-13). Per portal, in that portal's dbo.V4Settings:
/// <list type="bullet">
/// <item><see cref="ProfessionalVerificationMode.Off"/> (the default): the agency types the certificate number, PAN, name,
/// e-mail and mobile; the server only refuses a certificate already used by an active assessor (consultant).</item>
/// <item><see cref="ProfessionalVerificationMode.TrainingPortal"/>: the legacy check of the training portal's candidates by
/// certificate number and registered e-mail (<see cref="StaffUserRules.LookupProfessionalAsync"/>).</item>
/// <item><see cref="ProfessionalVerificationMode.Api"/>: another portal's API answers name, e-mail and mobile for a
/// certificate number and PAN (<see cref="IProfessionalApiClient"/>); its address, method, key and field names are set by
/// the Admin, the key stored encrypted (<see cref="SettingSecret"/>) and never sent to the browser.</item>
/// </list>
/// The PAN is kept in dbo.Users.PanNo (migration 0068), written after the legacy SP_INSERT_USER.
/// </summary>
public enum ProfessionalVerificationMode
{
    Off,
    TrainingPortal,
    Api,
}

public static partial class ProfessionalVerification
{
    public const string Prefix = "ProfessionalVerification.";
    public const string ModeKey = Prefix + "Mode";
    public const string UrlKey = Prefix + "Api.Url";
    public const string MethodKey = Prefix + "Api.Method";
    public const string KeyHeaderKey = Prefix + "Api.KeyHeader";
    /// <summary>Encrypted with <see cref="SettingSecret"/>.</summary>
    public const string KeyKey = Prefix + "Api.Key";
    public const string CertificateFieldKey = Prefix + "Api.CertificateField";
    public const string PanFieldKey = Prefix + "Api.PanField";
    public const string NameFieldKey = Prefix + "Api.NameField";
    public const string EmailFieldKey = Prefix + "Api.EmailField";
    public const string MobileFieldKey = Prefix + "Api.MobileField";
    public const string SuccessFieldKey = Prefix + "Api.SuccessField";

    public const string MethodPost = "POST";
    public const string MethodGet = "GET";

    public const string DefaultCertificateField = "certificateNo";
    public const string DefaultPanField = "pan";
    public const string DefaultNameField = "name";
    public const string DefaultEmailField = "email";
    public const string DefaultMobileField = "mobile";

    /// <summary>As the training portal's procedure answers a certificate already in use.</summary>
    public const string AlreadyMapped = "User Already mapped to another agency";

    public const string OffLookupMessage = "Verification is off: enter the details on the form.";

    [GeneratedRegex(@"^[A-Z]{5}[0-9]{4}[A-Z]$")] public static partial Regex PanPattern();
    /// <summary>A JSON field name, or a dotted path into nested objects (data.name).</summary>
    [GeneratedRegex(@"^[A-Za-z0-9_\-]{1,60}(\.[A-Za-z0-9_\-]{1,60}){0,5}$")] public static partial Regex FieldPattern();
    /// <summary>An HTTP header name (token characters).</summary>
    [GeneratedRegex(@"^[A-Za-z0-9!#$%&'*+.^_`|~\-]{1,100}$")] public static partial Regex HeaderPattern();

    /// <summary>The PAN in capitals, or null when it is not a valid PAN.</summary>
    public static string? NormalizePan(string? pan)
    {
        var p = pan?.Trim().ToUpperInvariant();
        return p is not null && PanPattern().IsMatch(p) ? p : null;
    }

    public static ProfessionalVerificationMode ParseMode(string? value) =>
        Enum.TryParse<ProfessionalVerificationMode>(value?.Trim(), ignoreCase: true, out var m) && Enum.IsDefined(m) && !int.TryParse(value, out _)
            ? m : ProfessionalVerificationMode.Off;

    public static async Task<ProfessionalVerificationMode> ModeAsync(IPortalSettings settings, CancellationToken ct) =>
        ParseMode(await settings.GetAsync(ModeKey, ct));

    /// <summary>The saved API settings (the key decrypted; null when none is saved or it cannot be read on this machine).</summary>
    public static async Task<ProfessionalApiConfig> ApiConfigAsync(IPortalSettings settings, CancellationToken ct)
    {
        async Task<string?> Get(string key) => await settings.GetAsync(key, ct) is { Length: > 0 } v ? v.Trim() : null;
        var storedKey = await Get(KeyKey);
        return new ProfessionalApiConfig(
            await Get(UrlKey),
            string.Equals(await Get(MethodKey), MethodGet, StringComparison.OrdinalIgnoreCase) ? MethodGet : MethodPost,
            await Get(KeyHeaderKey),
            SettingSecret.Unprotect(storedKey),
            await Get(CertificateFieldKey) ?? DefaultCertificateField,
            await Get(PanFieldKey) ?? DefaultPanField,
            await Get(NameFieldKey) ?? DefaultNameField,
            await Get(EmailFieldKey) ?? DefaultEmailField,
            await Get(MobileFieldKey) ?? DefaultMobileField,
            await Get(SuccessFieldKey),
            KeyStored: storedKey is not null);
    }

    /// <summary>Active assessors (consultants: Users.RoleId 3 on both portals) with the certificate number.</summary>
    internal const string CertificateInUseSql =
        "SELECT COUNT(*) FROM dbo.Users WHERE RoleId = 3 AND IsActive = 1 AND LTRIM(RTRIM(CertificateNo)) = @CertificateNo;";

    public static async Task<bool> CertificateInUseAsync(ISqlExecutor db, string certificateNo, CancellationToken ct) =>
        (await db.QuerySqlAsync<int>(CertificateInUseSql, new { CertificateNo = certificateNo }, ct)).FirstOrDefault() > 0;

    internal const string SavePanSql = "UPDATE dbo.Users SET PanNo = @Pan WHERE UserId = @UserId;";

    /// <summary>Writes Users.PanNo; false when the column is missing (migration 0068 not applied).</summary>
    public static async Task<bool> SavePanAsync(ISqlExecutor db, string userId, string pan, ILogger log, CancellationToken ct)
    {
        try
        {
            await db.ExecuteSqlAsync(SavePanSql, new { UserId = userId, Pan = pan }, ct);
            return true;
        }
        catch (DbException ex)
        {
            log.LogError(ex, "PAN of {UserId} not saved (is migration 0068 applied?)", userId);
            return false;
        }
    }

    public const string PanNotSaved = " The PAN could not be saved: please ask the administrator to apply database migration 0068.";

    /// <summary>
    /// Main host: the same PAN on the assessor's copy in ZED_SURVEILLANCE (main's SP_INSERT_USER writes the agencies' and
    /// assessors' rows there too). Skipped while that database has no PanNo column; migration 0069 copies what is missing.
    /// </summary>
    internal const string SaveSurveillancePanSql =
        "IF EXISTS (SELECT 1 FROM ZED_SURVEILLANCE.sys.columns WHERE object_id = OBJECT_ID('ZED_SURVEILLANCE.dbo.Users') AND name = 'PanNo') " +
        "EXEC ZED_SURVEILLANCE.sys.sp_executesql N'UPDATE dbo.Users SET PanNo = @Pan WHERE UserId = @UserId;', " +
        "N'@UserId varchar(50), @Pan varchar(10)', @UserId = @UserId, @Pan = @Pan;";

    /// <summary>Main host: <see cref="SaveSurveillancePanSql"/>. A failure is logged only (the next update's 0069 copies it).</summary>
    public static async Task CopyPanToSurveillanceAsync(ISqlExecutor db, string userId, string pan, ILogger log, CancellationToken ct)
    {
        try
        {
            await db.ExecuteSqlAsync(SaveSurveillancePanSql, new { UserId = userId, Pan = pan }, ct);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "PAN of {UserId} not copied to ZED_SURVEILLANCE (migration 0069 copies it at the next update)", userId);
        }
    }

    /// <summary>The assessors' (consultants', technical experts') PANs, for the lists.</summary>
    internal const string PansSql = "SELECT UserId, PanNo FROM dbo.Users WHERE RoleId IN (3, 33) AND NULLIF(PanNo, '') IS NOT NULL;";

    internal const string PanOfSql = "SELECT PanNo FROM dbo.Users WHERE UserId = @UserId;";

    public sealed record PanRow(string? UserId, string? PanNo);

    /// <summary>UserId → PAN of every assessor that has one; empty when the column is missing (migration 0068 not applied).</summary>
    public static async Task<Dictionary<string, string>> PansAsync(ISqlExecutor db, ILogger log, CancellationToken ct)
    {
        try
        {
            var rows = await db.QuerySqlAsync<PanRow>(PansSql, null, ct);
            return rows.Where(r => !string.IsNullOrWhiteSpace(r.UserId) && !string.IsNullOrWhiteSpace(r.PanNo))
                .GroupBy(r => r.UserId!.Trim(), StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.First().PanNo!.Trim(), StringComparer.OrdinalIgnoreCase);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Assessors' PANs not read (is migration 0068 applied?)");
            return new(StringComparer.OrdinalIgnoreCase);
        }
    }

    /// <summary>One user's PAN; null without one or when the column is missing.</summary>
    public static async Task<string?> PanOfAsync(ISqlExecutor db, string userId, ILogger log, CancellationToken ct)
    {
        try
        {
            return (await db.QuerySqlAsync<string?>(PanOfSql, new { UserId = userId }, ct)).FirstOrDefault() is { } p && !string.IsNullOrWhiteSpace(p)
                ? p.Trim() : null;
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "PAN of {UserId} not read (is migration 0068 applied?)", userId);
            return null;
        }
    }
}

/// <param name="Url">https address of the other portal's API; null when not set.</param>
/// <param name="Method">"POST" (JSON body) or "GET" (query string).</param>
/// <param name="KeyHeader">Header that carries the key (for example x-api-key); null for none.</param>
/// <param name="Key">The key, decrypted. Never logged, never sent to the browser.</param>
/// <param name="SuccessField">Optional: the answer's field that must be true (true, "true", 1, "success", "yes").</param>
public sealed record ProfessionalApiConfig(
    string? Url, string Method, string? KeyHeader, string? Key, string CertificateField, string PanField, string NameField,
    string EmailField, string MobileField, string? SuccessField, bool KeyStored = false);

/// <summary>Name, e-mail and mobile answered by the other portal, or why there are none.</summary>
public sealed record ProfessionalApiResult(string? Name, string? Email, string? MobileNo, string? Error)
{
    public bool Ok => Error is null;
}

/// <summary>Calls the other portal's API for a certificate number and PAN (typed HttpClient, 10 second timeout, no request logging).</summary>
public interface IProfessionalApiClient
{
    Task<ProfessionalApiResult> LookupAsync(ProfessionalApiConfig config, string certificateNo, string pan, CancellationToken ct);
}

public sealed class ProfessionalApiClient(HttpClient http, ILogger<ProfessionalApiClient> log) : IProfessionalApiClient
{
    public async Task<ProfessionalApiResult> LookupAsync(ProfessionalApiConfig config, string certificateNo, string pan, CancellationToken ct)
    {
        if (config.Url is null || !Uri.TryCreate(config.Url, UriKind.Absolute, out var url) || url.Scheme != Uri.UriSchemeHttps)
            return Fail("The other portal's API address is not set. Please ask the Admin to set it (Settings → Professional Verification).");

        using var request = config.Method == ProfessionalVerification.MethodGet
            ? new HttpRequestMessage(HttpMethod.Get, WithQuery(url, config, certificateNo, pan))
            : new HttpRequestMessage(HttpMethod.Post, url)
            {
                Content = JsonContent.Create(new Dictionary<string, string> { [config.CertificateField] = certificateNo, [config.PanField] = pan }),
            };
        request.Headers.Accept.ParseAdd("application/json");
        if (config.KeyHeader is { Length: > 0 } header && config.Key is { Length: > 0 } key)
            request.Headers.TryAddWithoutValidation(header, key);

        HttpResponseMessage response;
        try
        {
            response = await http.SendAsync(request, ct);
        }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested)
        {
            log.LogWarning("Professional verification API {Host} did not answer in time", url.Host);
            return Fail("The other portal did not answer in time. Please try again later.");
        }
        catch (HttpRequestException ex)
        {
            // The message only: no address with its query (certificate and PAN), no key.
            log.LogWarning("Professional verification API {Host} could not be reached: {Error}", url.Host, ex.HttpRequestError);
            return Fail("The other portal could not be reached. Please try again later.");
        }

        using (response)
        {
            if (response.StatusCode == HttpStatusCode.NotFound)
                return Fail("No certified professional was found for this certificate number and PAN.");
            if (!response.IsSuccessStatusCode)
            {
                log.LogWarning("Professional verification API {Host} answered HTTP {Status}", url.Host, (int)response.StatusCode);
                return Fail($"The other portal answered with an error (HTTP {(int)response.StatusCode}). Please try again later.");
            }
            JsonElement root;
            try
            {
                var text = await response.Content.ReadAsStringAsync(ct);
                if (text.Length > 1_000_000) return Fail("The other portal's answer could not be read.");
                using var doc = JsonDocument.Parse(text);
                root = doc.RootElement.Clone();
            }
            catch (JsonException)
            {
                log.LogWarning("Professional verification API {Host} answered something other than JSON", url.Host);
                return Fail("The other portal's answer could not be read.");
            }
            return Map(root, config);
        }
    }

    /// <summary>The answer's name, e-mail and mobile by the configured field names (dotted paths; the first item of an array).</summary>
    public static ProfessionalApiResult Map(JsonElement root, ProfessionalApiConfig config)
    {
        if (config.SuccessField is { Length: > 0 } success && !Truthy(Find(root, success)))
            return Fail("The other portal did not confirm this certificate number and PAN.");
        var name = Text(Find(root, config.NameField));
        var email = Text(Find(root, config.EmailField));
        var mobile = Mobile(Text(Find(root, config.MobileField)));
        if (string.IsNullOrWhiteSpace(name) || name.Length > 100 || name.Any(char.IsControl))
            return Fail("No certified professional was found for this certificate number and PAN (the answer has no name).");
        if (!StaffUserRules.IsEmail(email))
            return Fail("The other portal's answer has no valid e-mail address for this professional.");
        if (mobile is null)
            return Fail("The other portal's answer has no valid 10 digit mobile number for this professional.");
        return new ProfessionalApiResult(name.Trim(), email, mobile, null);
    }

    private static ProfessionalApiResult Fail(string error) => new(null, null, null, error);

    private static Uri WithQuery(Uri url, ProfessionalApiConfig config, string certificateNo, string pan)
    {
        var query = $"{Uri.EscapeDataString(config.CertificateField)}={Uri.EscapeDataString(certificateNo)}&{Uri.EscapeDataString(config.PanField)}={Uri.EscapeDataString(pan)}";
        var b = new UriBuilder(url);
        b.Query = string.IsNullOrEmpty(b.Query) || b.Query == "?" ? query : b.Query.TrimStart('?') + "&" + query;
        return b.Uri;
    }

    private static JsonElement? Find(JsonElement root, string path)
    {
        JsonElement? current = root;
        foreach (var part in path.Split('.'))
        {
            var e = current!.Value;
            if (e.ValueKind == JsonValueKind.Array) e = e.GetArrayLength() > 0 ? e[0] : default;
            if (e.ValueKind != JsonValueKind.Object) return null;
            JsonElement next = default;
            var found = false;
            foreach (var p in e.EnumerateObject())
                if (string.Equals(p.Name, part, StringComparison.OrdinalIgnoreCase)) { next = p.Value; found = true; break; }
            if (!found) return null;
            current = next;
        }
        var v = current!.Value;
        if (v.ValueKind == JsonValueKind.Array && v.GetArrayLength() > 0) v = v[0];
        return v;
    }

    private static string? Text(JsonElement? e) => e?.ValueKind switch
    {
        JsonValueKind.String => e.Value.GetString()?.Trim(),
        JsonValueKind.Number => e.Value.GetRawText(),
        _ => null,
    };

    private static bool Truthy(JsonElement? e) => e?.ValueKind switch
    {
        JsonValueKind.True => true,
        JsonValueKind.Number => e.Value.TryGetDecimal(out var d) && d == 1,
        JsonValueKind.String => e.Value.GetString()?.Trim().ToLowerInvariant() is "true" or "1" or "success" or "yes" or "y" or "ok" or "valid",
        _ => false,
    };

    /// <summary>10 digits (a leading +91 / 91 / 0 and spaces or dashes are dropped), or null.</summary>
    private static string? Mobile(string? value)
    {
        if (value is null) return null;
        var digits = new string(value.Where(char.IsDigit).ToArray());
        if (digits.Length == 12 && digits.StartsWith("91", StringComparison.Ordinal)) digits = digits[2..];
        else if (digits.Length == 11 && digits[0] == '0') digits = digits[1..];
        return StaffUserRules.MobilePattern().IsMatch(digits) ? digits : null;
    }
}
