using Zed.Core.Data;
using Zed.Core.Payments;

namespace Zed.Main.Api.Tests;

/// <summary>Settings with invoices switched on (Admin → Payment Gateway and Invoices), for the ERP posting tests.</summary>
public sealed class InvoicesOnSettings : IPortalSettings
{
    public Dictionary<string, string?> Values { get; } = new(StringComparer.OrdinalIgnoreCase) { [InvoiceSettings.EnabledKey] = "true" };

    public Task<string?> GetAsync(string key, CancellationToken ct = default) => Task.FromResult(Values.GetValueOrDefault(key));

    public Task SetAsync(string key, string? value, string userId, CancellationToken ct = default)
    {
        Values[key] = string.IsNullOrWhiteSpace(value) ? null : value.Trim();
        return Task.CompletedTask;
    }
}
