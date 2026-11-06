using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Zed.Core.Data;

namespace Zed.Core.Payments;

/// <summary>
/// Admin → Settings → Payment Gateway and Invoices (new in V4): the CCAvenue account the portal uses, entered on the
/// page instead of the server's settings file (for example when a new merchant account arrives). Kept in dbo.V4Settings
/// of the main database (keys below; migration 0051 widened the value column). The working keys are encrypted with
/// Windows DPAPI for the machine (<see cref="SettingSecret"/>) and are never sent back to the browser.
/// <para>
/// The saved values are used as one set, never mixed with the file's: once the merchant ID, web access code, web working
/// key and reconciliation key are saved, every payment uses the page's account (the app's access code and key too: empty
/// means app payments are refused, as with the file). "Use server file again" removes them.
/// </para>
/// </summary>
public static class PaymentGatewayKeys
{
    public const string Prefix = "CcAvenue.";
    public const string MerchantId = Prefix + "MerchantId";
    public const string AccessCode = Prefix + "AccessCode";
    public const string WorkingKey = Prefix + "WorkingKey";
    public const string ReconciliationWorkingKey = Prefix + "ReconciliationWorkingKey";
    public const string MobileAccessCode = Prefix + "MobileAccessCode";
    public const string MobileWorkingKey = Prefix + "MobileWorkingKey";
    /// <summary>"live" or "test".</summary>
    public const string Mode = Prefix + "Mode";

    public static readonly string[] All = [MerchantId, AccessCode, WorkingKey, ReconciliationWorkingKey, MobileAccessCode, MobileWorkingKey, Mode];

    public const string LiveGatewayUrl = "https://secure.ccavenue.com/transaction/transaction.do?command=initiateTransaction";
    public const string TestGatewayUrl = "https://test.ccavenue.com/transaction/transaction.do?command=initiateTransaction";
    public const string LiveServiceUrl = "https://secure.ccavenue.com";
    public const string TestServiceUrl = "https://test.ccavenue.com";

    /// <summary>"test" for the test gateway, "live" otherwise.</summary>
    public static string ModeOf(string? gatewayUrl) =>
        (gatewayUrl ?? "").Contains("test.ccavenue.com", StringComparison.OrdinalIgnoreCase) ? "test" : "live";
}

/// <summary>
/// Online payments on/off (Admin → Settings → Payment Gateway and Invoices), for example until a CCAvenue account is
/// entered. Off: no new CCAvenue checkout starts (web and app; certification, surveillance, handholding). Payments
/// already at CCAvenue still complete (the gateway's answers are always taken), and an amount of zero is still recorded.
/// </summary>
public static class PaymentSwitch
{
    /// <summary>"false" = off. Missing (the default) = on.</summary>
    public const string EnabledKey = "Payments.Enabled";

    public const string OffMessage = "Online payment is not available right now. Please try again later.";

    public static async Task<bool> IsOnAsync(IPortalSettings settings, CancellationToken ct) =>
        !string.Equals(await settings.GetAsync(EnabledKey, ct), "false", StringComparison.OrdinalIgnoreCase);
}

/// <summary>Invoices on/off (Admin → Settings → Payment Gateway and Invoices); read by SP_GENERATE_NEXT_ZED_INVOICE_NO too.</summary>
public static class InvoiceSettings
{
    /// <summary>"true" = on. Missing (the default) = off: payments get no invoice number and nothing is posted to the ERP.</summary>
    public const string EnabledKey = "Invoices.Enabled";

    public static async Task<bool> IsEnabledAsync(IPortalSettings settings, CancellationToken ct) =>
        string.Equals(await settings.GetAsync(EnabledKey, ct), "true", StringComparison.OrdinalIgnoreCase);
}

/// <summary>
/// Secrets in dbo.V4Settings, encrypted with Windows DPAPI for the machine: every application of the server can read
/// them, a copy of the database cannot (on another server they must be entered again). As the mail passwords
/// (SmtpSecret), with an entropy of its own.
/// </summary>
public static class SettingSecret
{
    private const string Prefix = "dpapi1:";
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("Zed.V4Settings.Secret");

    public static string Protect(string secret)
    {
        if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) throw new PlatformNotSupportedException("Keys can only be saved on Windows.");
        return Prefix + Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(secret), Entropy, DataProtectionScope.LocalMachine));
    }

    /// <summary>The secret, or null when there is none or it cannot be read on this machine.</summary>
    public static string? Unprotect(string? stored)
    {
        if (string.IsNullOrEmpty(stored) || !stored.StartsWith(Prefix, StringComparison.Ordinal) || !RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
            return null;
        try
        {
            return Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(stored[Prefix.Length..]), Entropy, DataProtectionScope.LocalMachine));
        }
        catch (Exception ex) when (ex is CryptographicException or FormatException)
        {
            return null;
        }
    }
}

/// <summary>
/// The CCAvenue account in use: the Admin's saved set when complete, otherwise the settings file's (CcAvenue section).
/// Refreshed every 30 seconds (<see cref="CcAvenueSettingsRefresher"/>) and at once after a save on this host. Every
/// payment endpoint gets it through <c>IOptions&lt;CcAvenueOptions&gt;</c> (registered transient over <see cref="Current"/>).
/// </summary>
public sealed class CcAvenueSettings(IOptionsMonitor<CcAvenueOptions> file, IPortalSettings settings, ILogger<CcAvenueSettings> log)
{
    private volatile Snapshot? snapshot;

    public sealed record Snapshot(CcAvenueOptions Options, bool FromAdmin, string? Problem);

    /// <summary>The options to use now (the file's until the first read of the saved values).</summary>
    public CcAvenueOptions Current => (snapshot ?? new Snapshot(file.CurrentValue, false, null)).Options;

    /// <summary>Whether the Admin's set is in use, and why a saved set is not (a key that cannot be read on this machine).</summary>
    public Snapshot State => snapshot ?? new Snapshot(file.CurrentValue, false, null);

    public async Task RefreshAsync(CancellationToken ct)
    {
        try
        {
            var values = new Dictionary<string, string?>();
            foreach (var key in PaymentGatewayKeys.All) values[key] = await settings.GetAsync(key, ct);
            snapshot = Build(file.CurrentValue, values);
            if (snapshot.Problem is { } problem) log.LogError("Payment gateway settings: {Problem}; the server file's account is used", problem);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Payment gateway settings could not be read; the last ones stay in use");
        }
    }

    /// <summary>The options from the saved values (keys protected) over the file's; the file's alone when the set is incomplete.</summary>
    public static Snapshot Build(CcAvenueOptions fromFile, IReadOnlyDictionary<string, string?> saved)
    {
        string? Plain(string key) => saved.GetValueOrDefault(key) is { Length: > 0 } v ? v.Trim() : null;
        var merchant = Plain(PaymentGatewayKeys.MerchantId);
        var access = Plain(PaymentGatewayKeys.AccessCode);
        var storedKey = Plain(PaymentGatewayKeys.WorkingKey);
        var storedReconciliation = Plain(PaymentGatewayKeys.ReconciliationWorkingKey);
        if (merchant is null || access is null || storedKey is null || storedReconciliation is null)
            return new Snapshot(fromFile, false, null);

        var key = SettingSecret.Unprotect(storedKey);
        var reconciliation = SettingSecret.Unprotect(storedReconciliation);
        var storedMobileKey = Plain(PaymentGatewayKeys.MobileWorkingKey);
        var mobileKey = storedMobileKey is null ? null : SettingSecret.Unprotect(storedMobileKey);
        if (key is null || reconciliation is null || (storedMobileKey is not null && mobileKey is null))
            return new Snapshot(fromFile, false, "a saved key cannot be read on this server (enter the keys again)");

        var test = string.Equals(Plain(PaymentGatewayKeys.Mode), "test", StringComparison.OrdinalIgnoreCase);
        return new Snapshot(new CcAvenueOptions
        {
            MerchantId = merchant,
            AccessCode = access,
            WorkingKey = key,
            ReconciliationWorkingKey = reconciliation,
            GatewayUrl = test ? PaymentGatewayKeys.TestGatewayUrl : PaymentGatewayKeys.LiveGatewayUrl,
            MobileAccessCode = Plain(PaymentGatewayKeys.MobileAccessCode) ?? "",
            MobileWorkingKey = mobileKey ?? "",
            MobileServiceUrl = test ? PaymentGatewayKeys.TestServiceUrl : PaymentGatewayKeys.LiveServiceUrl,
        }, true, null);
    }
}

/// <summary>Reads the saved payment gateway settings at start and every 30 seconds.</summary>
public sealed class CcAvenueSettingsRefresher(CcAvenueSettings gateway) : BackgroundService
{
    public override async Task StartAsync(CancellationToken cancellationToken)
    {
        await gateway.RefreshAsync(cancellationToken);
        await base.StartAsync(cancellationToken);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken)) await gateway.RefreshAsync(stoppingToken);
        }
        catch (OperationCanceledException)
        {
            // stopping
        }
    }
}
