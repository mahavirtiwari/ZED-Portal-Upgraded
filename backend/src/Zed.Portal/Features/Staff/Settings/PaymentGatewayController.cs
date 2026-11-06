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

    public sealed record InvoicesView(bool Enabled, bool ErpReady, IReadOnlyList<string> Examples);

    public sealed record PaymentGatewayResponse(GatewayView Gateway, InvoicesView Invoices, bool PaymentsOn);

    public sealed record GatewayRequest(string? Mode, string? MerchantId, string? AccessCode, string? WorkingKey, string? ReconciliationKey,
        string? MobileAccessCode, string? MobileWorkingKey);

    public sealed record InvoicesRequest(bool Enabled);

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
        return new PaymentGatewayResponse(view, new InvoicesView(
            await InvoiceSettings.IsEnabledAsync(settings, ct), ErpReady(), [$"ZEDM/{fy}/1", $"ZEDS/{fy}/1"]),
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
        if (req.Enabled && !ErpReady())
            return this.Problem400("Invoices can be switched on only when the server is set up for ERP posting (ask the server team).");
        try
        {
            await settings.SetAsync(InvoiceSettings.EnabledKey, req.Enabled ? "true" : null, UserId, ct);
        }
        catch (SqlException ex)
        {
            log.LogError(ex, "Could not save the invoice setting");
            return this.Problem400("The setting could not be saved. Please try again.");
        }
        log.LogWarning("Invoices switched {State} by {Actor}", req.Enabled ? "on" : "off", UserId);
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

    /// <summary>The server allows ERP posting: Erp:Enabled with its keys (the server team's part).</summary>
    private bool ErpReady()
    {
        var o = erp.Value;
        return o.Enabled && !string.IsNullOrWhiteSpace(o.TenantId) && !string.IsNullOrWhiteSpace(o.ClientId)
               && !string.IsNullOrWhiteSpace(o.ClientSecret) && !string.IsNullOrWhiteSpace(o.CompanyBaseUrl);
    }

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    /// <summary>The financial year as the invoice numbers write it (April to March): 2627 for 2026-27.</summary>
    internal static string FinancialYear(DateTime date)
    {
        var start = date.Month < 4 ? date.Year - 1 : date.Year;
        return (start % 100).ToString("00", CultureInfo.InvariantCulture) + ((start + 1) % 100).ToString("00", CultureInfo.InvariantCulture);
    }
}
