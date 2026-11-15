using System.Globalization;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Zed.Core.Data;
using Zed.Core.Http;

namespace Zed.Core.Maintenance;

/// <summary>
/// 2026-11-15 (the user): Admin → Settings → Maintenance mode. Each portal and each app can be taken down: switched Down
/// now (back up when switched Up, or at the end of its window), or for a planned window (down from its start to its end,
/// by itself). Kept in dbo.V4Settings of the MAIN database (keys <c>Maintenance.{target}.{Down|Message|From|Until}</c>),
/// read by every portal and the app API through <see cref="IMainSettings"/>. The Admin can always sign in on the main portal.
/// </summary>
public static class MaintenanceTargets
{
    public const string Main = "main";
    public const string Consultancy = "consultancy";
    public const string Surveillance = "surveillance";
    public const string MsmeApp = "app-msme";
    public const string AssessorApp = "app-assessor";
    public const string ConsultantApp = "app-consultant";

    public static readonly IReadOnlyList<(string Key, string Name)> All =
    [
        (Main, "ZED Certification portal"), (Consultancy, "Consultancy portal"), (Surveillance, "Surveillance portal"),
        (MsmeApp, "ZED MSME app"), (AssessorApp, "Assessor app"), (ConsultantApp, "Consultant app"),
    ];

    public static bool IsKnown(string target) => All.Any(t => t.Key == target);

    /// <summary>The web portal of a host.</summary>
    public static string Of(PortalSystem system) => system switch
    {
        PortalSystem.Consultancy => Consultancy,
        PortalSystem.Surveillance => Surveillance,
        _ => Main,
    };

    public static string Key(string target, string part) => $"Maintenance.{target}.{part}";
}

/// <param name="Down">Switched down now (until switched up, or until <paramref name="Until"/>).</param>
/// <param name="Message">Shown to the users; null = <see cref="DefaultMessage"/>.</param>
/// <param name="From">With <paramref name="Until"/>: a planned window, down from this time (server time).</param>
public sealed record MaintenanceEntry(string Target, bool Down, string? Message, DateTime? From, DateTime? Until)
{
    public const string DefaultMessage = "This portal is under maintenance. Please try again later.";
    public const string DefaultAppMessage = "The app is under maintenance. Please try again later.";

    public bool IsDownAt(DateTime now) =>
        (Down && (Until is null || now < Until))
        || (From is { } f && Until is { } u && f <= now && now < u);

    public string MessageText => !string.IsNullOrWhiteSpace(Message) ? Message.Trim()
        : Target.StartsWith("app-", StringComparison.Ordinal) ? DefaultAppMessage : DefaultMessage;

    public const string TimeFormat = "yyyy-MM-ddTHH:mm";

    public static DateTime? ParseTime(string? value) =>
        DateTime.TryParseExact(value?.Trim(), TimeFormat, CultureInfo.InvariantCulture, DateTimeStyles.None, out var t) ? t : null;
}

/// <summary>
/// The settings of the main database (dbo.V4Settings), for what the Admin sets on the main portal for every portal and app
/// (maintenance, branding). On the main host: its own settings. Elsewhere: the Main connection string, read for the keys
/// with a prefix and kept for 30 seconds; no Main connection or an error = no values (nothing is down, today's branding).
/// </summary>
public interface IMainSettings
{
    Task<string?> GetAsync(string key, CancellationToken ct = default);
}

public sealed class MainSettings(PortalHost host, IPortalSettings own, IConfiguration config, ILogger<MainSettings> log) : IMainSettings
{
    private static readonly string[] Prefixes = ["Maintenance.", "Branding."];
    private static readonly TimeSpan Lifetime = TimeSpan.FromSeconds(30);
    private volatile Cached? cached;

    private sealed record Cached(IReadOnlyDictionary<string, string> Values, DateTime Until);

    public async Task<string?> GetAsync(string key, CancellationToken ct = default)
    {
        if (host.System == PortalSystem.Main) return await own.GetAsync(key, ct);
        if (cached is not { } c || c.Until <= DateTime.UtcNow) cached = c = new Cached(await LoadAsync(ct), DateTime.UtcNow + Lifetime);
        return c.Values.TryGetValue(key, out var v) ? v : null;
    }

    private async Task<IReadOnlyDictionary<string, string>> LoadAsync(CancellationToken ct)
    {
        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (config.GetConnectionString(ZedDatabases.Main) is not { Length: > 0 } cs) return values;
        try
        {
            await using var conn = new SqlConnection(cs);
            await conn.OpenAsync(ct);
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT SettingKey, SettingValue FROM dbo.V4Settings WHERE SettingKey LIKE @a OR SettingKey LIKE @b;";
            cmd.Parameters.AddWithValue("@a", Prefixes[0] + "%");
            cmd.Parameters.AddWithValue("@b", Prefixes[1] + "%");
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct)) values[r.GetString(0)] = r.IsDBNull(1) ? "" : r.GetString(1);
        }
        catch (Exception ex) when (ex is SqlException or InvalidOperationException)
        {
            log.LogWarning(ex, "Could not read the main database's settings (maintenance, branding); none are applied");
        }
        return values;
    }
}

public sealed class MaintenanceState(IMainSettings settings)
{
    public async Task<MaintenanceEntry> GetAsync(string target, CancellationToken ct = default)
    {
        async Task<string?> V(string part) => await settings.GetAsync(MaintenanceTargets.Key(target, part), ct);
        return new MaintenanceEntry(target,
            string.Equals(await V("Down"), "true", StringComparison.OrdinalIgnoreCase),
            await V("Message") is { Length: > 0 } m ? m : null,
            MaintenanceEntry.ParseTime(await V("From")),
            MaintenanceEntry.ParseTime(await V("Until")));
    }

    public async Task<IReadOnlyList<MaintenanceEntry>> AllAsync(CancellationToken ct = default)
    {
        var list = new List<MaintenanceEntry>();
        foreach (var (key, _) in MaintenanceTargets.All) list.Add(await GetAsync(key, ct));
        return list;
    }
}
