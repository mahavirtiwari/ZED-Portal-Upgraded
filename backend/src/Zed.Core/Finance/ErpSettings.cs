using Zed.Core.Data;
using Zed.Core.Payments;

namespace Zed.Core.Finance;

/// <summary>
/// 2026-11-15 (the user): the QCI ERP account (Microsoft Dynamics 365 Business Central) entered in Admin → Settings →
/// Payment Gateway and Invoices, as the CCAvenue account is, instead of the server's settings file (Erp section). Kept in
/// dbo.V4Settings of the main database under the keys below; the client secret is encrypted with Windows DPAPI for the
/// machine (<see cref="SettingSecret"/>) and never sent back to the browser.
/// <para>
/// The saved values are used as one set, never mixed with the file's: once the tenant ID, client ID, client secret and the
/// company base URL are saved (and the secret can be read on this machine), every ERP posting uses them, with the scope
/// and the three endpoint names saved or, when left empty, the file's (their defaults). "Use server file again" removes
/// them. A copy of the database on another server cannot read the secret, so it never posts with the copied account.
/// Read on every posting (one posting per payment), so a save takes effect at the next payment.
/// </para>
/// </summary>
public static class ErpSettings
{
    public const string Prefix = "Erp.";
    public const string TenantId = Prefix + "TenantId";
    public const string ClientId = Prefix + "ClientId";
    public const string ClientSecret = Prefix + "ClientSecret";
    public const string CompanyBaseUrl = Prefix + "CompanyBaseUrl";
    public const string Scope = Prefix + "Scope";
    public const string CustomerEndpoint = Prefix + "CustomerEndpoint";
    public const string InvoiceEndpoint = Prefix + "InvoiceEndpoint";
    public const string ReceiptEndpoint = Prefix + "ReceiptEndpoint";

    public static readonly string[] All = [TenantId, ClientId, ClientSecret, CompanyBaseUrl, Scope, CustomerEndpoint, InvoiceEndpoint, ReceiptEndpoint];

    /// <param name="Options">The account to post with.</param>
    /// <param name="FromAdmin">The Admin's saved set is in use (else the file's).</param>
    /// <param name="Problem">Why a saved set is not used (its secret cannot be read on this machine); null otherwise.</param>
    public sealed record Resolved(ErpOptions Options, bool FromAdmin, string? Problem);

    public static async Task<IReadOnlyDictionary<string, string?>> SavedAsync(IPortalSettings settings, CancellationToken ct)
    {
        var values = new Dictionary<string, string?>();
        foreach (var key in All) values[key] = await settings.GetAsync(key, ct);
        return values;
    }

    public static async Task<Resolved> ResolveAsync(ErpOptions fromFile, IPortalSettings settings, CancellationToken ct) =>
        Build(fromFile, await SavedAsync(settings, ct));

    /// <summary>The saved set over the file's when complete and readable; the file's alone otherwise.</summary>
    public static Resolved Build(ErpOptions fromFile, IReadOnlyDictionary<string, string?> saved)
    {
        string? V(string key) => saved.TryGetValue(key, out var v) && !string.IsNullOrWhiteSpace(v) ? v.Trim() : null;
        var tenant = V(TenantId);
        var client = V(ClientId);
        var baseUrl = V(CompanyBaseUrl);
        var storedSecret = V(ClientSecret);
        if (tenant is null || client is null || baseUrl is null || storedSecret is null) return new Resolved(fromFile, false, null);
        var secret = SettingSecret.Unprotect(storedSecret);
        if (string.IsNullOrEmpty(secret))
            return new Resolved(fromFile, false, "The saved client secret cannot be read on this server (saved on another machine?). Please enter it again.");
        return new Resolved(new ErpOptions
        {
            // The Admin's complete set switches posting on; whether invoices are made stays the Invoices switch's.
            Enabled = true,
            TenantId = tenant,
            ClientId = client,
            ClientSecret = secret,
            CompanyBaseUrl = baseUrl,
            Scope = V(Scope) ?? fromFile.Scope,
            CustomerEndpoint = V(CustomerEndpoint) ?? fromFile.CustomerEndpoint,
            InvoiceEndpoint = V(InvoiceEndpoint) ?? fromFile.InvoiceEndpoint,
            ReceiptEndpoint = V(ReceiptEndpoint) ?? fromFile.ReceiptEndpoint,
        }, true, null);
    }

    /// <summary>The account can post: on, with its keys.</summary>
    public static bool Ready(ErpOptions o) =>
        o.Enabled && !string.IsNullOrWhiteSpace(o.TenantId) && !string.IsNullOrWhiteSpace(o.ClientId)
        && !string.IsNullOrWhiteSpace(o.ClientSecret) && !string.IsNullOrWhiteSpace(o.CompanyBaseUrl);
}
