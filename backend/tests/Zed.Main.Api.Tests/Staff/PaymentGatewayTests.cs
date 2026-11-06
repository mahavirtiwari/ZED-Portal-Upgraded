using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Payments;
using Zed.Portal.Features.CertLevels;
using Zed.Portal.Features.ExternalApi;
using Zed.Portal.Features.Staff.Settings;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>Admin → Settings → Payment Gateway and Invoices (CCAvenue account and the invoice switch).</summary>
public sealed class PaymentGatewayTests : IDisposable
{
    private const string SettingsQuery = "SELECT SettingKey, SettingValue FROM dbo.V4Settings";
    private const string Key = "0123456789ABCDEF0123456789ABCDEF";
    private readonly TestHost _host = new();

    public PaymentGatewayTests() => UsersMastersLogin.Setup(_host);

    public void Dispose() => _host.Dispose();

    private void Stored(params (string Key, string Value)[] rows) =>
        _host.Sql.Queries[SettingsQuery] = _ => rows.Select(r => new { SettingKey = r.Key, SettingValue = r.Value }).ToArray();

    private (string Key, string Value)[] SavedSet(string mode = "live") =>
    [
        (PaymentGatewayKeys.MerchantId, "998877"), (PaymentGatewayKeys.AccessCode, "AVNEW00AA11BB22CC"), (PaymentGatewayKeys.Mode, mode),
        (PaymentGatewayKeys.WorkingKey, SettingSecret.Protect(Key)), (PaymentGatewayKeys.ReconciliationWorkingKey, SettingSecret.Protect(Key)),
    ];

    /// <summary>The settings store keeps what it read for 30 seconds; any save empties it.</summary>
    private Task ClearSettingsCacheAsync() => _host.Services.GetRequiredService<IPortalSettings>().SetAsync("Test.Unused", null, "TEST");

    private IReadOnlyList<(string Key, string? Value)> Merges() =>
        _host.Sql.Calls.Where(c => c.Name.StartsWith("MERGE dbo.V4Settings", StringComparison.Ordinal))
            .Select(c => (FakeSql.Arg(c.Args, "SettingKey")!, FakeSql.Arg(c.Args, "SettingValue"))).ToList();

    [Fact]
    public async Task Only_the_admin_opens_the_page()
    {
        var agency = await UsersMastersLogin.SignInAsync(_host, "AGENCY1");
        Assert.Equal(HttpStatusCode.Forbidden, (await agency.GetAsync("/api/staff/settings/payment-gateway")).StatusCode);
    }

    [Fact]
    public async Task Without_saved_values_the_server_file_is_used_and_invoices_are_off()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var json = JsonDocument.Parse(await admin.GetStringAsync("/api/staff/settings/payment-gateway")).RootElement;
        var gateway = json.GetProperty("gateway");
        Assert.Equal("file", gateway.GetProperty("inUse").GetString());
        Assert.Equal(JsonValueKind.Null, gateway.GetProperty("saved").ValueKind);
        var invoices = json.GetProperty("invoices");
        Assert.False(invoices.GetProperty("enabled").GetBoolean());
        var fy = PaymentGatewayController.FinancialYear(DateTime.Now);
        Assert.Equal([$"ZEDM/{fy}/1", $"ZEDS/{fy}/1"], invoices.GetProperty("examples").EnumerateArray().Select(e => e.GetString()));
    }

    [Fact]
    public async Task Saving_stores_the_keys_encrypted_and_never_shows_them()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var r = await admin.PutAsJsonAsync("/api/staff/settings/payment-gateway", new
        {
            mode = "live", merchantId = "998877", accessCode = "AVNEW00AA11BB22CC", workingKey = Key, reconciliationKey = Key,
        });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);

        var merges = Merges();
        Assert.Contains((PaymentGatewayKeys.MerchantId, "998877"), merges);
        var stored = merges.Single(m => m.Key == PaymentGatewayKeys.WorkingKey).Value!;
        Assert.StartsWith("dpapi1:", stored);
        Assert.DoesNotContain(Key, stored);
        Assert.Equal(Key, SettingSecret.Unprotect(stored));

        Stored(SavedSet());
        await ClearSettingsCacheAsync();
        var json = await admin.GetStringAsync("/api/staff/settings/payment-gateway");
        Assert.DoesNotContain(Key, json);
        var saved = JsonDocument.Parse(json).RootElement.GetProperty("gateway").GetProperty("saved");
        Assert.True(saved.GetProperty("workingKeySet").GetBoolean());
        Assert.Equal("998877", saved.GetProperty("merchantId").GetString());
    }

    [Theory]
    [InlineData("demo", "998877", "AVNEW00AA11BB22CC", Key, Key, "Please choose the Live or Test gateway.")]
    [InlineData("live", "99A877", "AVNEW00AA11BB22CC", Key, Key, "Please enter the merchant ID (digits only).")]
    [InlineData("live", "998877", "AV-NEW", Key, Key, "Please enter the web access code (letters and digits).")]
    [InlineData("live", "998877", "AVNEW00AA11BB22CC", null, Key, "Please enter the web working key.")]
    [InlineData("live", "998877", "AVNEW00AA11BB22CC", Key, null, "Please enter the reconciliation working key.")]
    [InlineData("live", "998877", "AVNEW00AA11BB22CC", "short", Key, "The web working key must be 16 to 64 letters and digits.")]
    public async Task A_wrong_or_incomplete_account_is_refused(string mode, string merchant, string access, string? key, string? reconciliation, string message)
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var r = await admin.PutAsJsonAsync("/api/staff/settings/payment-gateway",
            new { mode, merchantId = merchant, accessCode = access, workingKey = key, reconciliationKey = reconciliation });
        Assert.Equal(message, await r.ProblemTitle());
        Assert.Empty(Merges());
    }

    [Fact]
    public async Task The_app_access_code_needs_its_key()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var r = await admin.PutAsJsonAsync("/api/staff/settings/payment-gateway",
            new { mode = "live", merchantId = "998877", accessCode = "AVNEW00AA11BB22CC", workingKey = Key, reconciliationKey = Key, mobileAccessCode = "AVAPP00AA11BB" });
        Assert.Equal("Please enter the app working key with the app access code.", await r.ProblemTitle());
    }

    [Fact]
    public async Task A_complete_saved_set_replaces_the_file_for_every_payment()
    {
        Stored(SavedSet("test"));
        await _host.Services.GetRequiredService<CcAvenueSettings>().RefreshAsync(CancellationToken.None);
        using var scope = _host.Services.CreateScope();
        var o = scope.ServiceProvider.GetRequiredService<IOptions<CcAvenueOptions>>().Value;
        Assert.Equal("998877", o.MerchantId);
        Assert.Equal(Key, o.WorkingKey);
        Assert.Equal(PaymentGatewayKeys.TestGatewayUrl, o.GatewayUrl);
        Assert.Equal("", o.MobileAccessCode);

        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var gateway = JsonDocument.Parse(await admin.GetStringAsync("/api/staff/settings/payment-gateway")).RootElement.GetProperty("gateway");
        Assert.Equal("page", gateway.GetProperty("inUse").GetString());
    }

    [Fact]
    public async Task Use_server_file_again_removes_every_saved_value()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        Assert.Equal(HttpStatusCode.OK, (await admin.DeleteAsync("/api/staff/settings/payment-gateway")).StatusCode);
        var deleted = _host.Sql.Calls.Where(c => c.Name.StartsWith("DELETE FROM dbo.V4Settings", StringComparison.Ordinal))
            .Select(c => FakeSql.Arg(c.Args, "SettingKey")).ToList();
        Assert.Equal(PaymentGatewayKeys.All.Order(), deleted.Order());
    }

    [Fact]
    public async Task Online_payments_are_on_until_the_admin_switches_them_off()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var json = JsonDocument.Parse(await admin.GetStringAsync("/api/staff/settings/payment-gateway")).RootElement;
        Assert.True(json.GetProperty("paymentsOn").GetBoolean());

        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync("/api/staff/settings/payment-gateway/payments", new { enabled = false })).StatusCode);
        Assert.Contains((PaymentSwitch.EnabledKey, "false"), Merges());
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync("/api/staff/settings/payment-gateway/payments", new { enabled = true })).StatusCode);
        Assert.Contains(_host.Sql.Calls, c => c.Name.StartsWith("DELETE FROM dbo.V4Settings", StringComparison.Ordinal)
                                              && FakeSql.Arg(c.Args, "SettingKey") == PaymentSwitch.EnabledKey);
    }

    [Fact]
    public async Task Invoices_cannot_be_switched_on_while_the_server_does_not_allow_erp_posting()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var r = await admin.PutAsJsonAsync("/api/staff/settings/payment-gateway/invoices", new { enabled = true });
        Assert.Equal("Invoices can be switched on only when the server is set up for ERP posting (ask the server team).", await r.ProblemTitle());
        Assert.Empty(Merges());

        // Off is always allowed (removes the row).
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync("/api/staff/settings/payment-gateway/invoices", new { enabled = false })).StatusCode);
        Assert.Contains(_host.Sql.Calls, c => c.Name.StartsWith("DELETE FROM dbo.V4Settings", StringComparison.Ordinal)
                                              && FakeSql.Arg(c.Args, "SettingKey") == InvoiceSettings.EnabledKey);
    }
}

/// <summary>The CCAvenue account from saved values (<see cref="CcAvenueSettings.Build"/>).</summary>
public sealed class CcAvenueSettingsBuildTests
{
    private static readonly CcAvenueOptions File = new() { MerchantId = "111", AccessCode = "FILECODE", WorkingKey = "FILEKEY", ReconciliationWorkingKey = "FILEREC" };

    [Fact]
    public void An_incomplete_saved_set_leaves_the_file_in_use()
    {
        var s = CcAvenueSettings.Build(File, new Dictionary<string, string?> { [PaymentGatewayKeys.MerchantId] = "222" });
        Assert.False(s.FromAdmin);
        Assert.Same(File, s.Options);
    }

    [Fact]
    public void A_key_that_cannot_be_read_on_this_server_leaves_the_file_in_use_with_the_reason()
    {
        var s = CcAvenueSettings.Build(File, new Dictionary<string, string?>
        {
            [PaymentGatewayKeys.MerchantId] = "222", [PaymentGatewayKeys.AccessCode] = "CODE", [PaymentGatewayKeys.WorkingKey] = "dpapi1:AAAA",
            [PaymentGatewayKeys.ReconciliationWorkingKey] = "dpapi1:AAAA",
        });
        Assert.False(s.FromAdmin);
        Assert.Contains("cannot be read", s.Problem);
    }

    [Fact]
    public void Production_never_takes_a_saved_test_account()
    {
        var key = SettingSecret.Protect("KEY0123456789ABCDEF");
        var saved = new Dictionary<string, string?>
        {
            [PaymentGatewayKeys.MerchantId] = "222", [PaymentGatewayKeys.AccessCode] = "CODE", [PaymentGatewayKeys.WorkingKey] = key,
            [PaymentGatewayKeys.ReconciliationWorkingKey] = key, [PaymentGatewayKeys.Mode] = "test",
        };
        Assert.True(CcAvenueSettings.Build(File, saved).FromAdmin);
        var live = CcAvenueSettings.Build(File, saved, allowTest: false);
        Assert.False(live.FromAdmin);
        Assert.Same(File, live.Options);
        Assert.Contains("test account", live.Problem);
    }

    [Fact]
    public void A_live_set_uses_the_live_gateway_and_the_app_keys()
    {
        var key = SettingSecret.Protect("KEY0123456789ABCDEF");
        var s = CcAvenueSettings.Build(File, new Dictionary<string, string?>
        {
            [PaymentGatewayKeys.MerchantId] = "222", [PaymentGatewayKeys.AccessCode] = "CODE", [PaymentGatewayKeys.WorkingKey] = key,
            [PaymentGatewayKeys.ReconciliationWorkingKey] = key, [PaymentGatewayKeys.MobileAccessCode] = "APPCODE", [PaymentGatewayKeys.MobileWorkingKey] = key,
        });
        Assert.True(s.FromAdmin);
        Assert.Equal(PaymentGatewayKeys.LiveGatewayUrl, s.Options.GatewayUrl);
        Assert.Equal(PaymentGatewayKeys.LiveServiceUrl, s.Options.MobileServiceUrl);
        Assert.Equal("APPCODE", s.Options.MobileAccessCode);
        Assert.Equal("KEY0123456789ABCDEF", s.Options.MobileWorkingKey);
    }
}

/// <summary>ZED IDs since migration 0051: ZEDM / ZEDS by sector; the old ZEDMSME IDs stay valid.</summary>
public sealed class ZedIdFormatTests
{
    [Theory]
    [InlineData("ZEDMSME000123", true)]
    [InlineData("ZEDMSME1092588", true)]
    [InlineData("ZEDM000001", true)]
    [InlineData("ZEDS000045", true)]
    [InlineData("zedm1000000", true)]
    [InlineData("ZEDM00001", false)]
    [InlineData("ZEDX000001", false)]
    [InlineData("ZEDM000001_D_45", false)]
    [InlineData("ZEDAS0001", false)]
    [InlineData("", false)]
    public void Unit_ids(string value, bool valid)
    {
        Assert.Equal(valid, ZedIds.IsUnitId(value));
        Assert.Equal(valid, CertificationLookups.IsZedId(value));
    }

    [Theory]
    [InlineData("ZEDMSME129350", "129350")]
    [InlineData("ZEDM000123", "M000123")]
    [InlineData("ZEDS000045", "S000045")]
    [InlineData("ZEDM1000000", "M1000000")]
    public void Certificate_serials(string zedId, string serial) => Assert.Equal(serial, ZedIds.CertificateSerial(zedId));

    [Fact]
    public void The_default_certificate_number_is_date_and_serial()
    {
        var date = new DateTime(2026, 11, 6);
        Assert.Equal("06112026_M000123", CertificateNumbers.Format(CertificateNumbers.Default, date, "ZEDM000123", "Silver", "Manufacturing"));
        Assert.Equal("06112026_S000045", CertificateNumbers.Format(CertificateNumbers.Default, date, "ZEDS000045", "Gold", "Services"));
        Assert.Equal("06112026_129350", CertificateNumbers.Format(CertificateNumbers.Default, date, "ZEDMSME129350", "Bronze", null));
    }
}
