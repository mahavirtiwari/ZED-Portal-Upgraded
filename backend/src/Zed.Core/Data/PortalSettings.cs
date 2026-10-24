using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging;

namespace Zed.Core.Data;

/// <summary>
/// Settings the Admin changes on the portal (Captcha Settings, Email Settings): dbo.V4Settings in the system's own
/// database (migration 0011), one row per key. Read through a 30-second cache; a missing table or row reads as null,
/// so the caller falls back to its configuration.
/// </summary>
public interface IPortalSettings
{
    Task<string?> GetAsync(string key, CancellationToken ct = default);

    /// <summary>Saves the value; null or blank removes the row (back to the configuration).</summary>
    Task SetAsync(string key, string? value, string userId, CancellationToken ct = default);
}

public sealed class PortalSettings(ISqlExecutor db, ILogger<PortalSettings> log) : IPortalSettings
{
    internal const string SelectSql = "SELECT SettingKey, SettingValue FROM dbo.V4Settings;";
    private static readonly TimeSpan Lifetime = TimeSpan.FromSeconds(30);
    private sealed record Cached(IReadOnlyDictionary<string, string> Values, DateTime Until);
    private volatile Cached? cached;

    public sealed record SettingRow(string SettingKey, string SettingValue);

    public async Task<string?> GetAsync(string key, CancellationToken ct = default)
    {
        if (cached is not { } c || c.Until <= DateTime.UtcNow)
        {
            c = new Cached(await ReadAsync(db, log, ct), DateTime.UtcNow + Lifetime);
            cached = c;
        }
        return c.Values.GetValueOrDefault(key);
    }

    public async Task SetAsync(string key, string? value, string userId, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(value))
            await db.ExecuteSqlAsync("DELETE FROM dbo.V4Settings WHERE SettingKey = @SettingKey;", new { SettingKey = key }, ct);
        else
            await db.ExecuteSqlAsync(
                "MERGE dbo.V4Settings AS t USING (SELECT @SettingKey AS SettingKey) AS s ON t.SettingKey = s.SettingKey " +
                "WHEN MATCHED THEN UPDATE SET SettingValue = @SettingValue, UpdatedBy = @UpdatedBy, UpdatedOn = SYSUTCDATETIME() " +
                "WHEN NOT MATCHED THEN INSERT (SettingKey, SettingValue, UpdatedBy) VALUES (@SettingKey, @SettingValue, @UpdatedBy);",
                new { SettingKey = key, SettingValue = value.Trim(), UpdatedBy = userId.Length <= 50 ? userId : userId[..50] }, ct);
        cached = null;
    }

    /// <summary>All rows of <paramref name="database"/> (also used by Zed.Jobs for each database it serves).</summary>
    public static async Task<IReadOnlyDictionary<string, string>> ReadAsync(ISqlExecutor database, ILogger log, CancellationToken ct)
    {
        try
        {
            var rows = await database.QuerySqlAsync<SettingRow>(SelectSql, null, ct);
            return rows.ToDictionary(r => r.SettingKey, r => r.SettingValue, StringComparer.OrdinalIgnoreCase);
        }
        catch (SqlException ex)
        {
            log.LogWarning(ex, "Could not read dbo.V4Settings (is migration 0011 applied?); using the configuration.");
            return new Dictionary<string, string>();
        }
    }
}
