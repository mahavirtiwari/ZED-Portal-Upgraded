using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Data.SqlClient;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Payments;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.Users;

namespace Zed.Portal.Features.Staff.Settings;

/// <summary>
/// Administration → Settings → Professional Verification (2026-11-13): how an agency (a Consultant Organisation) proves
/// the certified professional it adds (<see cref="ProfessionalVerification"/>): Off (the default; the agency types the
/// details), the training portal's candidates (certificate number and e-mail), or another portal's API (certificate number
/// and PAN). Per portal, in the portal's own dbo.V4Settings; the main Admin edits the other portals through the portal
/// switch. The API key is stored encrypted and never sent back (only whether one is set); a blank key keeps the saved one.
/// </summary>
[Route("api/staff/settings/professional-verification")]
[StaffRoles(UserRole.Admin)]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed class ProfessionalVerificationController(
    IPortalSettings settings,
    IProfessionalApiClient api,
    PortalHost host,
    ILogger<ProfessionalVerificationController> log) : StaffApiController
{
    /// <param name="KeySet">Whether a key is saved (the key itself is never sent).</param>
    /// <param name="KeyReadable">False when a saved key cannot be read on this server (saved on another machine): enter it again.</param>
    public sealed record ApiView(string? Url, string Method, string? KeyHeader, bool KeySet, bool KeyReadable, string CertificateField, string PanField,
        string NameField, string EmailField, string MobileField, string? SuccessField);

    /// <param name="Mode">"Off", "TrainingPortal" or "Api".</param>
    /// <param name="Portal">The portal whose setting this is: main, consultancy or surveillance.</param>
    public sealed record SettingsView(string Mode, ApiView Api, string Portal);

    /// <param name="Key">A new key; blank keeps the saved one.</param>
    /// <param name="RemoveKey">Removes the saved key (an API without a key).</param>
    public sealed record SettingsRequest(
        string? Mode, string? Url = null, string? Method = null, string? KeyHeader = null, string? Key = null, bool RemoveKey = false,
        string? CertificateField = null, string? PanField = null, string? NameField = null, string? EmailField = null, string? MobileField = null,
        string? SuccessField = null);

    /// <summary>The API settings to try (as on the form, the saved key when none is typed) with a certificate number and PAN.</summary>
    public sealed record TestRequest(
        string? CertificateNo, string? Pan, string? Url = null, string? Method = null, string? KeyHeader = null, string? Key = null,
        string? CertificateField = null, string? PanField = null, string? NameField = null, string? EmailField = null, string? MobileField = null,
        string? SuccessField = null);

    public sealed record TestResult(bool Ok, string? Name, string? Email, string? MobileNo, string? Error);

    [HttpGet]
    public async Task<SettingsView> Get(CancellationToken ct)
    {
        var mode = await ProfessionalVerification.ModeAsync(settings, ct);
        var c = await ProfessionalVerification.ApiConfigAsync(settings, ct);
        return new SettingsView(mode.ToString(),
            new ApiView(c.Url, c.Method, c.KeyHeader, c.KeyStored, !c.KeyStored || c.Key is not null, c.CertificateField, c.PanField, c.NameField,
                c.EmailField, c.MobileField, c.SuccessField),
            host.System.ToString().ToLowerInvariant());
    }

    private sealed record ApiValues(string? Url, string Method, string? KeyHeader, string? Key, string CertificateField, string PanField, string NameField,
        string EmailField, string MobileField, string? SuccessField);

    /// <summary>Checks the API fields of the form; <paramref name="keyAvailable"/>: a key is saved (or typed) for the header.</summary>
    private static (ApiValues? Values, string? Error) CheckApi(string? url, string? method, string? keyHeader, string? key, string? certificateField,
        string? panField, string? nameField, string? emailField, string? mobileField, string? successField, bool keyAvailable)
    {
        var u = url?.Trim() ?? "";
        if (u.Length == 0) return (null, "Please enter the address of the other portal's API.");
        if (u.Length > 500 || u.Any(char.IsControl) || !Uri.TryCreate(u, UriKind.Absolute, out var parsed) || parsed.Scheme != Uri.UriSchemeHttps ||
            !string.IsNullOrEmpty(parsed.UserInfo))
            return (null, "The API address must be a full https:// address (up to 500 characters).");
        var m = (method ?? ProfessionalVerification.MethodPost).Trim().ToUpperInvariant();
        if (m is not (ProfessionalVerification.MethodPost or ProfessionalVerification.MethodGet)) return (null, "Please choose POST (JSON) or GET (query).");
        var header = string.IsNullOrWhiteSpace(keyHeader) ? null : keyHeader.Trim();
        if (header is not null && !ProfessionalVerification.HeaderPattern().IsMatch(header))
            return (null, "The key header must be a header name such as x-api-key (letters, digits and dashes).");
        var k = string.IsNullOrWhiteSpace(key) ? null : key.Trim();
        if (k is not null && (k.Length > 500 || k.Any(char.IsControl))) return (null, "The key can be up to 500 characters, without line breaks.");
        if (k is not null && header is null) return (null, "Please enter the name of the header that carries the key.");
        if (header is not null && k is null && !keyAvailable) return (null, "Please enter the key for the header " + header + ".");

        var fields = new[]
        {
            (certificateField, "certificate number"), (panField, "PAN"), (nameField, "name"), (emailField, "e-mail"), (mobileField, "mobile"),
            (successField, "success"),
        }.Select(f => (Value: string.IsNullOrWhiteSpace(f.Item1) ? null : f.Item1.Trim(), Label: f.Item2)).ToArray();
        if (fields.FirstOrDefault(f => f.Value is not null && !ProfessionalVerification.FieldPattern().IsMatch(f.Value)) is { Label: { } bad })
            return (null, $"The {bad} field name may use letters, digits, _ and - (and dots for nested fields).");
        return (new ApiValues(u, m, header, k, fields[0].Value ?? ProfessionalVerification.DefaultCertificateField,
            fields[1].Value ?? ProfessionalVerification.DefaultPanField, fields[2].Value ?? ProfessionalVerification.DefaultNameField,
            fields[3].Value ?? ProfessionalVerification.DefaultEmailField, fields[4].Value ?? ProfessionalVerification.DefaultMobileField,
            fields[5].Value), null);
    }

    [HttpPut]
    public async Task<IActionResult> Save(SettingsRequest req, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Mode) || !Enum.TryParse<ProfessionalVerificationMode>(req.Mode.Trim(), true, out var mode) ||
            !Enum.IsDefined(mode) || int.TryParse(req.Mode, out _))
            return this.Problem400("Please choose how professionals are verified.");
        var saved = await ProfessionalVerification.ApiConfigAsync(settings, ct);
        ApiValues? values = null;
        // The API fields are checked and saved with the Api mode, or when an address is entered for later.
        if (mode == ProfessionalVerificationMode.Api || !string.IsNullOrWhiteSpace(req.Url))
        {
            var (v, error) = CheckApi(req.Url, req.Method, req.KeyHeader, req.Key, req.CertificateField, req.PanField, req.NameField, req.EmailField,
                req.MobileField, req.SuccessField, keyAvailable: saved.KeyStored && !req.RemoveKey);
            if (error is not null) return this.Problem400(error);
            values = v;
        }
        try
        {
            if (values is not null)
            {
                await settings.SetAsync(ProfessionalVerification.UrlKey, values.Url, UserId, ct);
                await settings.SetAsync(ProfessionalVerification.MethodKey, values.Method, UserId, ct);
                await settings.SetAsync(ProfessionalVerification.KeyHeaderKey, values.KeyHeader, UserId, ct);
                if (values.Key is not null) await settings.SetAsync(ProfessionalVerification.KeyKey, SettingSecret.Protect(values.Key), UserId, ct);
                else if (req.RemoveKey || values.KeyHeader is null) await settings.SetAsync(ProfessionalVerification.KeyKey, null, UserId, ct);
                await settings.SetAsync(ProfessionalVerification.CertificateFieldKey, values.CertificateField, UserId, ct);
                await settings.SetAsync(ProfessionalVerification.PanFieldKey, values.PanField, UserId, ct);
                await settings.SetAsync(ProfessionalVerification.NameFieldKey, values.NameField, UserId, ct);
                await settings.SetAsync(ProfessionalVerification.EmailFieldKey, values.EmailField, UserId, ct);
                await settings.SetAsync(ProfessionalVerification.MobileFieldKey, values.MobileField, UserId, ct);
                await settings.SetAsync(ProfessionalVerification.SuccessFieldKey, values.SuccessField, UserId, ct);
            }
            await settings.SetAsync(ProfessionalVerification.ModeKey, mode.ToString(), UserId, ct);
        }
        catch (SqlException ex)
        {
            log.LogError(ex, "Could not save the professional verification setting (is migration 0011 applied?)");
            return this.Problem400("The setting could not be saved. Please ask the administrator to apply database migration 0011.");
        }
        catch (PlatformNotSupportedException)
        {
            return this.Problem400("Keys can only be saved on the Windows server.");
        }
        // Never the key: only who chose what.
        log.LogWarning("Professional verification on {Portal} set to {Mode} by {Actor} (API {Host}, key changed: {KeyChanged})",
            host.System, mode, UserId, values?.Url is { } u ? new Uri(u).Host : null, values?.Key is not null || req.RemoveKey);
        return Ok(new MessageResponse(mode switch
        {
            ProfessionalVerificationMode.Off => "Saved. Verification is off: agencies enter the professional's details on the Add form.",
            ProfessionalVerificationMode.TrainingPortal => "Saved. Professionals are checked against the training portal (certificate number and e-mail).",
            _ => "Saved. Professionals are checked with the other portal's API (certificate number and PAN).",
        }));
    }

    /// <summary>Calls the API as set on the form (the saved key when none is typed) and shows what it answered, mapped.</summary>
    [HttpPost("test")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<ActionResult<TestResult>> Test(TestRequest req, CancellationToken ct)
    {
        var cert = req.CertificateNo?.Trim();
        if (cert is null || !StaffUserRules.CertificateNoPattern().IsMatch(cert)) return this.Problem400("Please enter a valid Certificate Number.");
        if (ProfessionalVerification.NormalizePan(req.Pan) is not { } pan) return this.Problem400("Please enter a valid PAN (e.g. ABCDE1234F).");
        var saved = await ProfessionalVerification.ApiConfigAsync(settings, ct);
        var (v, error) = CheckApi(req.Url, req.Method, req.KeyHeader, req.Key, req.CertificateField, req.PanField, req.NameField, req.EmailField,
            req.MobileField, req.SuccessField, keyAvailable: saved.Key is not null);
        if (error is not null) return this.Problem400(error);
        var config = new ProfessionalApiConfig(v!.Url, v.Method, v.KeyHeader, v.Key ?? (v.KeyHeader is null ? null : saved.Key), v.CertificateField,
            v.PanField, v.NameField, v.EmailField, v.MobileField, v.SuccessField);
        var r = await api.LookupAsync(config, cert, pan, ct);
        log.LogInformation("Professional verification API tested on {Portal} by {Actor}: {Result}", host.System, UserId, r.Ok ? "answered" : "failed");
        return new TestResult(r.Ok, r.Name, r.Email, r.MobileNo, r.Error);
    }
}
