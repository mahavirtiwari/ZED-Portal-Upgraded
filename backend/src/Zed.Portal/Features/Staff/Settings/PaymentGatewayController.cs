using System.Globalization;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Finance;
using Zed.Core.Http;
using Zed.Core.Payments;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Settings;

/// <summary>
/// Admin → Settings → Payment Gateway and Invoices (new in V4, main portal only).
/// <list type="bullet">
/// <item>CCAvenue: the account the portal uses, saved as one set (<see cref="CcAvenueSettings"/>) or the server file's.
/// The working keys are stored encrypted and never sent back; a blank key box keeps the saved key.</item>
/// <item>Online payments: on or off (<see cref="PaymentSwitch"/>; on by default).</item>
/// <item>Invoices: on or off (<see cref="InvoiceSettings"/>). Off (the default): payments get no invoice number and nothing
/// is posted to the ERP. On: ZEDM/2627/n or ZEDS/2627/n by the unit's sector (migration 0051), posted to QCI's ERP
/// after each gateway payment. It can be switched on only when the server allows ERP posting (Erp section).</item>
/// </list>
/// </summary>
[Route("api/staff/settings/payment-gateway")]
[StaffRoles(UserRole.Admin)]
[PortalSystems(PortalSystem.Main)]
public sealed partial class PaymentGatewayController(
    IPortalSettings settings,
    CcAvenueSettings gateway,
    IOptionsMonitor<CcAvenueOptions> file,
    IOptions<ErpOptions> erp,
    IOptions<PortalOptions> portal,
    IHostEnvironment env,
    ILogger<PaymentGatewayController> log) : StaffApiController
{
    [GeneratedRegex(@"^\d{1,20}$")] private static partial Regex MerchantIdPattern();
    [GeneratedRegex(@"^[A-Za-z0-9]{6,40}$")] private static partial Regex AccessCodePattern();
    [GeneratedRegex(@"^[A-Za-z0-9]{16,64}$")] private static partial Regex KeyPattern();

    /// <summary>What the page shows of a saved set: never a key, only whether one is saved.</summary>
    public sealed record SavedGateway(string MerchantId, string AccessCode, string Mode, bool WorkingKeySet, bool ReconciliationKeySet,
        string? MobileAccessCode, bool MobileWorkingKeySet);

    /// <summary>The server file's account: whether it is complete, its merchant ID and gateway (no codes or keys).</summary>
    public sealed record FileGateway(bool Configured, string? MerchantId, string Mode, bool MobileConfigured);

    public sealed record GatewayView(string InUse, string? Problem, SavedGateway? Saved, FileGateway File, string ReturnBase, bool TestAllowed);

    public sealed record InvoicesView(bool Enabled, bool ErpReady, IReadOnlyList<string> Examples, ErpView? Erp = null, InvoiceSetupView? Setup = null);

    /// <summary>2026-11-15: the invoice setup (<see cref="InvoiceSetup"/>): the values in use and today's defaults.</summary>
    public sealed record InvoiceSetupView(InvoiceSetupValues Values, InvoiceSetupValues Defaults);

    public sealed record InvoiceSetupValues(string SeriesManufacturing, string SeriesServices, string Board, string Portal, string LocationCode,
        string FeeLedger, string ItemBronze, string ItemSilver, string ItemGold, IReadOnlyList<string> ExcludedUdyam);

    /// <summary>
    /// 2026-11-15: the QCI ERP account (<see cref="ErpSettings"/>): in use ("page" or "file" or "none"), a saved set (never the
    /// secret, only whether one is saved), the file's (whether it is complete) and the endpoint names' defaults.
    /// </summary>
    public sealed record ErpView(string InUse, string? Problem, SavedErp? Saved, bool FileConfigured, ErpDefaults Defaults);

    public sealed record SavedErp(string TenantId, string ClientId, bool ClientSecretSet, string CompanyBaseUrl, string? Scope,
        string? CustomerEndpoint, string? InvoiceEndpoint, string? ReceiptEndpoint);

    public sealed record ErpDefaults(string Scope, string CustomerEndpoint, string InvoiceEndpoint, string ReceiptEndpoint);

    public sealed record ErpRequest(string? TenantId, string? ClientId, string? ClientSecret, string? CompanyBaseUrl, string? Scope,
        string? CustomerEndpoint, string? InvoiceEndpoint, string? ReceiptEndpoint);

    public sealed record PaymentGatewayResponse(GatewayView Gateway, InvoicesView Invoices, bool PaymentsOn);

    public sealed record GatewayRequest(string? Mode, string? MerchantId, string? AccessCode, string? WorkingKey, string? ReconciliationKey,
        string? MobileAccessCode, string? MobileWorkingKey);

    public sealed record InvoicesRequest(bool Enabled, InvoiceSetupValues? Setup = null);

    public sealed record PaymentsRequest(bool Enabled);

    [HttpGet]
    public async Task<PaymentGatewayResponse> Get(CancellationToken ct)
    {
        var saved = await SavedAsync(ct);
        var state = gateway.State;
        var f = file.CurrentValue;
        var fileView = new FileGateway(
            !string.IsNullOrWhiteSpace(f.MerchantId) && !string.IsNullOrWhiteSpace(f.AccessCode) && !string.IsNullOrWhiteSpace(f.WorkingKey),
            string.IsNullOrWhiteSpace(f.MerchantId) ? null : f.MerchantId.Trim(),
            PaymentGatewayKeys.ModeOf(f.GatewayUrl),
            !string.IsNullOrWhiteSpace(f.MobileAccessCode) && !string.IsNullOrWhiteSpace(f.MobileWorkingKey));
        var view = new GatewayView(state.FromAdmin ? "page" : "file", state.Problem, saved, fileView,
            portal.Value.PublicBaseUrl.TrimEnd('/'), !env.IsProduction());
        var fy = FinancialYear(DateTime.Now);
        var setup = await InvoiceSetup.LoadAsync(settings, ct);
        return new PaymentGatewayResponse(view, new InvoicesView(
            await InvoiceSettings.IsEnabledAsync(settings, ct), await ErpReadyAsync(ct),
            [$"{setup.SeriesManufacturing}/{fy}/1", $"{setup.SeriesServices}/{fy}/1"], await ErpViewAsync(ct),
            new InvoiceSetupView(ToView(setup), DefaultSetup)),
            await PaymentSwitch.IsOnAsync(settings, ct));
    }

    [HttpPut]
    public async Task<IActionResult> SaveGateway(GatewayRequest req, CancellationToken ct)
    {
        var mode = (req.Mode ?? "").Trim().ToLowerInvariant();
        if (mode is not ("live" or "test")) return this.Problem400("Please choose the Live or Test gateway.");
        if (mode == "test" && env.IsProduction()) return this.Problem400("The test gateway cannot be used on the live portal.");
        var merchant = (req.MerchantId ?? "").Trim();
        if (!MerchantIdPattern().IsMatch(merchant)) return this.Problem400("Please enter the merchant ID (digits only).");
        var access = (req.AccessCode ?? "").Trim();
        if (!AccessCodePattern().IsMatch(access)) return this.Problem400("Please enter the web access code (letters and digits).");

        var saved = await SavedAsync(ct);
        var key = Blank(req.WorkingKey);
        var reconciliation = Blank(req.ReconciliationKey);
        var mobileAccess = Blank(req.MobileAccessCode);
        var mobileKey = Blank(req.MobileWorkingKey);
        if (key is null && saved?.WorkingKeySet != true) return this.Problem400("Please enter the web working key.");
        if (reconciliation is null && saved?.ReconciliationKeySet != true) return this.Problem400("Please enter the reconciliation working key.");
        foreach (var (value, label) in new[] { (key, "web working key"), (reconciliation, "reconciliation working key"), (mobileKey, "app working key") })
            if (value is not null && !KeyPattern().IsMatch(value)) return this.Problem400($"The {label} must be 16 to 64 letters and digits.");
        if (mobileAccess is not null && !AccessCodePattern().IsMatch(mobileAccess)) return this.Problem400("The app access code must be letters and digits.");
        if (mobileAccess is not null && mobileKey is null && saved?.MobileWorkingKeySet != true)
            return this.Problem400("Please enter the app working key with the app access code.");
        if (mobileAccess is null && mobileKey is not null) return this.Problem400("Please enter the app access code with the app working key.");

        try
        {
            await settings.SetAsync(PaymentGatewayKeys.Mode, mode, UserId, ct);
            await settings.SetAsync(PaymentGatewayKeys.MerchantId, merchant, UserId, ct);
            await settings.SetAsync(PaymentGatewayKeys.AccessCode, access, UserId, ct);
            if (key is not null) await settings.SetAsync(PaymentGatewayKeys.WorkingKey, SettingSecret.Protect(key), UserId, ct);
            if (reconciliation is not null) await settings.SetAsync(PaymentGatewayKeys.ReconciliationWorkingKey, SettingSecret.Protect(reconciliation), UserId, ct);
            await settings.SetAsync(PaymentGatewayKeys.MobileAccessCode, mobileAccess, UserId, ct);
            if (mobileAccess is null) await settings.SetAsync(PaymentGatewayKeys.MobileWorkingKey, null, UserId, ct);
            else if (mobileKey is not null) await settings.SetAsync(PaymentGatewayKeys.MobileWorkingKey, SettingSecret.Protect(mobileKey), UserId, ct);
        }
        catch (SqlException ex)
        {
            log.LogError(ex, "Could not save the payment gateway settings (are migrations 0011 and 0051 applied?)");
            return this.Problem400("The settings could not be saved. Please ask the administrator to apply database migration 0051.");
        }
        catch (PlatformNotSupportedException)
        {
            return this.Problem400("Keys can only be saved on the Windows server.");
        }
        await gateway.RefreshAsync(ct);
        log.LogWarning("Payment gateway account set by {Actor}: merchant {MerchantId}, {Mode} gateway, keys changed: web {Key}, reconciliation {Reconciliation}, app {MobileKey}",
            UserId, merchant, mode, key is not null, reconciliation is not null, mobileKey is not null);
        return Ok(new MessageResponse("Payment gateway saved. Payments use this account within half a minute."));
    }

    /// <summary>"Use server file again": the saved set is removed.</summary>
    [HttpDelete]
    public async Task<IActionResult> UseFile(CancellationToken ct)
    {
        try
        {
            foreach (var key in PaymentGatewayKeys.All) await settings.SetAsync(key, null, UserId, ct);
        }
        catch (SqlException ex)
        {
            log.LogError(ex, "Could not remove the payment gateway settings");
            return this.Problem400("The settings could not be changed. Please try again.");
        }
        await gateway.RefreshAsync(ct);
        log.LogWarning("Payment gateway: back to the server file's account, by {Actor}", UserId);
        return Ok(new MessageResponse("Payments use the server file's account again within half a minute."));
    }

    /// <summary>Online payments on or off (<see cref="PaymentSwitch"/>): off stops every new CCAvenue checkout.</summary>
    [HttpPut("payments")]
    public async Task<IActionResult> SavePayments(PaymentsRequest req, CancellationToken ct)
    {
        try
        {
            await settings.SetAsync(PaymentSwitch.EnabledKey, req.Enabled ? null : "false", UserId, ct);
        }
        catch (SqlException ex)
        {
            log.LogError(ex, "Could not save the payments setting");
            return this.Problem400("The setting could not be saved. Please try again.");
        }
        log.LogWarning("Online payments switched {State} by {Actor}", req.Enabled ? "on" : "off", UserId);
        return Ok(new MessageResponse(req.Enabled
            ? "Online payments are on: units can pay through CCAvenue again within half a minute."
            : "Online payments are off: no new CCAvenue payment starts (within half a minute). Payments already started still complete."));
    }

    [HttpPut("invoices")]
    public async Task<IActionResult> SaveInvoices(InvoicesRequest req, CancellationToken ct)
    {
        if (req.Enabled && !await ErpReadyAsync(ct))
            return this.Problem400("Invoices can be switched on only when the ERP connection is set up (the QCI ERP section of this page).");
        List<(string Key, string? Value)>? setup = null;
        if (req.Setup is { } values)
        {
            var (checkedValues, problem) = CheckSetup(values);
            if (problem is not null) return this.Problem400(problem);
            setup = checkedValues;
        }
        try
        {
            await settings.SetAsync(InvoiceSettings.EnabledKey, req.Enabled ? "true" : null, UserId, ct);
            foreach (var (key, value) in setup ?? []) await settings.SetAsync(key, value, UserId, ct);
        }
        catch (SqlException ex)
        {
            log.LogError(ex, "Could not save the invoice setting");
            return this.Problem400("The setting could not be saved. Please try again.");
        }
        log.LogWarning("Invoices switched {State} by {Actor}", req.Enabled ? "on" : "off", UserId);
        if (setup is not null)
            log.LogWarning("Invoice setup saved by {Actor}: {Values}", UserId, string.Join("; ", setup.Select(x => $"{x.Key}={x.Value ?? "(default)"}")));
        return Ok(new MessageResponse(req.Enabled
            ? "Invoices are on: payments from now get an invoice number and are posted to the ERP."
            : "Invoices are off: payments from now get no invoice number and nothing is posted to the ERP."));
    }

    private async Task<SavedGateway?> SavedAsync(CancellationToken ct)
    {
        var merchant = await settings.GetAsync(PaymentGatewayKeys.MerchantId, ct);
        var access = await settings.GetAsync(PaymentGatewayKeys.AccessCode, ct);
        if (string.IsNullOrWhiteSpace(merchant) && string.IsNullOrWhiteSpace(access)) return null;
        return new SavedGateway(merchant ?? "", access ?? "",
            string.Equals(await settings.GetAsync(PaymentGatewayKeys.Mode, ct), "test", StringComparison.OrdinalIgnoreCase) ? "test" : "live",
            !string.IsNullOrEmpty(await settings.GetAsync(PaymentGatewayKeys.WorkingKey, ct)),
            !string.IsNullOrEmpty(await settings.GetAsync(PaymentGatewayKeys.ReconciliationWorkingKey, ct)),
            await settings.GetAsync(PaymentGatewayKeys.MobileAccessCode, ct),
            !string.IsNullOrEmpty(await settings.GetAsync(PaymentGatewayKeys.MobileWorkingKey, ct)));
    }

    /// <summary>ERP posting can work: the Admin's saved account (complete and readable), or the file's (Erp:Enabled with its keys).</summary>
    private async Task<bool> ErpReadyAsync(CancellationToken ct) =>
        ErpSettings.Ready((await ErpSettings.ResolveAsync(erp.Value, settings, ct)).Options);

    private async Task<ErpView> ErpViewAsync(CancellationToken ct)
    {
        var saved = await ErpSettings.SavedAsync(settings, ct);
        var resolved = ErpSettings.Build(erp.Value, saved);
        string? V(string key) => saved.TryGetValue(key, out var v) && !string.IsNullOrWhiteSpace(v) ? v.Trim() : null;
        var savedView = V(ErpSettings.TenantId) is null && V(ErpSettings.ClientId) is null && V(ErpSettings.CompanyBaseUrl) is null
            ? null
            : new SavedErp(V(ErpSettings.TenantId) ?? "", V(ErpSettings.ClientId) ?? "", V(ErpSettings.ClientSecret) is not null,
                V(ErpSettings.CompanyBaseUrl) ?? "", V(ErpSettings.Scope), V(ErpSettings.CustomerEndpoint), V(ErpSettings.InvoiceEndpoint),
                V(ErpSettings.ReceiptEndpoint));
        var f = erp.Value;
        var inUse = resolved.FromAdmin ? "page" : ErpSettings.Ready(f) ? "file" : "none";
        return new ErpView(inUse, resolved.Problem, savedView, ErpSettings.Ready(f),
            new ErpDefaults(f.Scope, f.CustomerEndpoint, f.InvoiceEndpoint, f.ReceiptEndpoint));
    }

    [GeneratedRegex(@"^[A-Za-z0-9][A-Za-z0-9.\-]{1,99}$")] private static partial Regex ErpIdPattern();
    [GeneratedRegex(@"^[A-Za-z0-9_\-]{1,100}$")] private static partial Regex ErpEndpointPattern();

    /// <summary>2026-11-15: saves the QCI ERP account (the secret encrypted; an empty secret keeps the saved one).</summary>
    [HttpPut("erp")]
    public async Task<IActionResult> SaveErp(ErpRequest req, CancellationToken ct)
    {
        var tenant = (req.TenantId ?? "").Trim();
        if (!ErpIdPattern().IsMatch(tenant)) return this.Problem400("Please enter the tenant ID (the Azure directory ID or domain).");
        var client = (req.ClientId ?? "").Trim();
        if (!ErpIdPattern().IsMatch(client)) return this.Problem400("Please enter the client ID (the application ID).");
        var baseUrl = (req.CompanyBaseUrl ?? "").Trim();
        if (baseUrl.Length > 500 || !Uri.TryCreate(baseUrl, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps)
            return this.Problem400("Please enter the company base URL (https://..., up to 500 characters).");
        if (!baseUrl.EndsWith('/')) baseUrl += "/";
        var scope = Blank(req.Scope);
        if (scope is not null && (scope.Length > 300 || !Uri.TryCreate(scope, UriKind.Absolute, out _)))
            return this.Problem400("The scope must be an address (e.g. https://api.businesscentral.dynamics.com/.default).");
        var endpoints = new[] { (Blank(req.CustomerEndpoint), "customer endpoint"), (Blank(req.InvoiceEndpoint), "invoice endpoint"), (Blank(req.ReceiptEndpoint), "receipt endpoint") };
        foreach (var (value, label) in endpoints)
            if (value is not null && !ErpEndpointPattern().IsMatch(value)) return this.Problem400($"The {label} must be a name (letters, digits, _ and -).");
        var secret = Blank(req.ClientSecret);
        if (secret is not null && secret.Length > 500) return this.Problem400("The client secret is too long.");
        var saved = await ErpSettings.SavedAsync(settings, ct);
        if (secret is null && string.IsNullOrWhiteSpace(saved.GetValueOrDefault(ErpSettings.ClientSecret)))
            return this.Problem400("Please enter the client secret.");

        try
        {
            await settings.SetAsync(ErpSettings.TenantId, tenant, UserId, ct);
            await settings.SetAsync(ErpSettings.ClientId, client, UserId, ct);
            await settings.SetAsync(ErpSettings.CompanyBaseUrl, baseUrl, UserId, ct);
            await settings.SetAsync(ErpSettings.Scope, scope, UserId, ct);
            await settings.SetAsync(ErpSettings.CustomerEndpoint, endpoints[0].Item1, UserId, ct);
            await settings.SetAsync(ErpSettings.InvoiceEndpoint, endpoints[1].Item1, UserId, ct);
            await settings.SetAsync(ErpSettings.ReceiptEndpoint, endpoints[2].Item1, UserId, ct);
            if (secret is not null) await settings.SetAsync(ErpSettings.ClientSecret, SettingSecret.Protect(secret), UserId, ct);
        }
        catch (SqlException ex)
        {
            log.LogError(ex, "Could not save the ERP settings (are migrations 0011 and 0051 applied?)");
            return this.Problem400("The settings could not be saved. Please ask the administrator to apply database migration 0051.");
        }
        catch (PlatformNotSupportedException)
        {
            return this.Problem400("The client secret can only be saved on the Windows server.");
        }
        log.LogWarning("ERP account set by {Actor}: tenant {Tenant}, client {Client}, base {BaseUrl}, secret changed {Secret}",
            UserId, tenant, client, baseUrl, secret is not null);
        return Ok(new MessageResponse("ERP connection saved. The next payments are posted with this account."));
    }

    /// <summary>2026-11-15: "Use server file again" for the ERP account: the saved set is removed.</summary>
    [HttpDelete("erp")]
    public async Task<IActionResult> UseErpFile(CancellationToken ct)
    {
        try
        {
            foreach (var key in ErpSettings.All) await settings.SetAsync(key, null, UserId, ct);
        }
        catch (SqlException ex)
        {
            log.LogError(ex, "Could not remove the ERP settings");
            return this.Problem400("The settings could not be changed. Please try again.");
        }
        log.LogWarning("ERP: back to the server file's account, by {Actor}", UserId);
        return Ok(new MessageResponse(ErpSettings.Ready(erp.Value)
            ? "ERP postings use the server file's account again."
            : "The saved ERP account is removed; the server file has none, so invoices cannot be switched on."));
    }

    private static readonly InvoiceSetupValues DefaultSetup = new(
        InvoiceSetup.Defaults[InvoiceSetup.SeriesManufacturing], InvoiceSetup.Defaults[InvoiceSetup.SeriesServices],
        InvoiceSetup.Defaults[InvoiceSetup.Board], InvoiceSetup.Defaults[InvoiceSetup.Portal], InvoiceSetup.Defaults[InvoiceSetup.LocationCode],
        InvoiceSetup.Defaults[InvoiceSetup.FeeLedger], InvoiceSetup.Defaults[InvoiceSetup.ItemBronze], InvoiceSetup.Defaults[InvoiceSetup.ItemSilver],
        InvoiceSetup.Defaults[InvoiceSetup.ItemGold], InvoiceSetup.DefaultExcludedUdyam);

    private static InvoiceSetupValues ToView(InvoiceSetup.Values v) => new(v.SeriesManufacturing, v.SeriesServices, v.Board, v.Portal,
        v.LocationCode, v.FeeLedger, v.ItemBronze, v.ItemSilver, v.ItemGold, v.ExcludedUdyam);

    [GeneratedRegex(@"^[A-Z0-9]{1,10}$")] private static partial Regex SeriesPattern();
    [GeneratedRegex(@"^[A-Za-z0-9][A-Za-z0-9 _.&\-]{0,29}$")] private static partial Regex ErpCodePattern();
    [GeneratedRegex(@"^[^<>\r\n]{1,100}$")] private static partial Regex ErpNamePattern();
    [GeneratedRegex(@"^UDYAM-[A-Z]{2}-\d{2}-\d{7}$")] private static partial Regex UdyamPattern();

    /// <summary>
    /// The setup to save: each value checked; an empty value or today's default is saved as "no value" (the default stays
    /// in use); the test units as a list ("none" for an empty one).
    /// </summary>
    private static (List<(string Key, string? Value)> Values, string? Problem) CheckSetup(InvoiceSetupValues v)
    {
        var list = new List<(string, string?)>();
        string? Add(string key, string? value, Regex pattern, string problem, bool upper = false)
        {
            var t = Blank(value);
            if (t is not null && upper) t = t.ToUpperInvariant();
            if (t is not null && !pattern.IsMatch(t)) return problem;
            list.Add((key, t is null || t == InvoiceSetup.Defaults[key] ? null : t));
            return null;
        }
        var problem =
            Add(InvoiceSetup.SeriesManufacturing, v.SeriesManufacturing, SeriesPattern(), "The Manufacturing series must be 1 to 10 letters and digits.", upper: true)
            ?? Add(InvoiceSetup.SeriesServices, v.SeriesServices, SeriesPattern(), "The Services series must be 1 to 10 letters and digits.", upper: true)
            ?? Add(InvoiceSetup.Board, v.Board, ErpCodePattern(), "The board must be up to 30 letters, digits and spaces.")
            ?? Add(InvoiceSetup.Portal, v.Portal, ErpCodePattern(), "The portal must be up to 30 letters, digits and spaces.")
            ?? Add(InvoiceSetup.LocationCode, v.LocationCode, ErpCodePattern(), "The location code must be up to 30 letters, digits and spaces.")
            ?? Add(InvoiceSetup.FeeLedger, v.FeeLedger, ErpNamePattern(), "The fee ledger must be up to 100 characters.")
            ?? Add(InvoiceSetup.ItemBronze, v.ItemBronze, ErpNamePattern(), "The Bronze item name must be up to 100 characters.")
            ?? Add(InvoiceSetup.ItemSilver, v.ItemSilver, ErpNamePattern(), "The Silver item name must be up to 100 characters.")
            ?? Add(InvoiceSetup.ItemGold, v.ItemGold, ErpNamePattern(), "The Gold item name must be up to 100 characters.");
        if (problem is not null) return ([], problem);
        string Saved(string key) => list.First(x => x.Item1 == key).Item2 ?? InvoiceSetup.Defaults[key];
        if (Saved(InvoiceSetup.SeriesManufacturing) == Saved(InvoiceSetup.SeriesServices))
            return ([], "The Manufacturing and Services series must differ.");

        var units = (v.ExcludedUdyam ?? []).Select(u => (u ?? "").Trim().ToUpperInvariant()).Where(u => u.Length > 0).Distinct().ToList();
        if (units.Count > 100) return ([], "Up to 100 test units can be listed.");
        if (units.FirstOrDefault(u => !UdyamPattern().IsMatch(u)) is { } bad) return ([], $"{bad} is not a UDYAM number (UDYAM-XX-00-0000000).");
        var isDefault = units.Count == InvoiceSetup.DefaultExcludedUdyam.Count && units.All(InvoiceSetup.DefaultExcludedUdyam.Contains);
        list.Add((InvoiceSetup.ExcludedUdyam, isDefault ? null : units.Count == 0 ? InvoiceSetup.NoUnits : string.Join(",", units)));
        return (list, null);
    }

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    /// <summary>The financial year as the invoice numbers write it (April to March): 2627 for 2026-27.</summary>
    internal static string FinancialYear(DateTime date)
    {
        var start = date.Month < 4 ? date.Year - 1 : date.Year;
        return (start % 100).ToString("00", CultureInfo.InvariantCulture) + ((start + 1) % 100).ToString("00", CultureInfo.InvariantCulture);
    }
}
