using System.Data.Common;
using System.Globalization;
using Microsoft.Extensions.Caching.Memory;
using Zed.Core.Data;
using Zed.Portal.Features.Staff.Assessment;

namespace Zed.Portal.Features.Staff.Users;

/// <summary>
/// The units inside a login's category and states (<see cref="LoginScope"/>, migration 0057): their ZED IDs, read from
/// dbo.Msme (category as <see cref="UserSectorActivity.UnitCategory"/> decides it, plant state by code or name) and kept
/// five minutes per scope. Null when the scope does not limit the units (no category, no states).
/// </summary>
public sealed class ScopedUnits(ISqlExecutor db, IMemoryCache cache, ILogger<ScopedUnits> log)
{
    private static readonly TimeSpan Keep = TimeSpan.FromMinutes(5);

    internal const string AllUnitsSql = "SELECT ZedId, Activity, TwoDigitActivity FROM dbo.Msme WHERE ZedId IS NOT NULL;";
    internal const string StateUnitsSql =
        "SELECT ZedId, Activity, TwoDigitActivity FROM dbo.Msme WHERE ZedId IS NOT NULL AND (PStateId IN @Codes OR PStateName IN @Names);";

    private sealed record Unit(string? ZedId, string? Activity, string? TwoDigitActivity);

    /// <summary>2026-11-16: the applications the scope's agencies assess (this portal's MsmeCertifications).</summary>
    internal const string AgencyUnitsSql =
        "SELECT ZedId, Certification FROM dbo.MsmeCertifications WHERE ZedId IS NOT NULL AND CertificationBodyUserId IN @Agencies;";

    private sealed record Application(string? ZedId, string? Certification);

    /// <summary>
    /// The applications of the scope's agencies: "ZEDID|Level" for each and "ZEDID" for the unit; null when agencies are not limited.
    /// </summary>
    public async Task<IReadOnlySet<string>?> AgencyUnitsAsync(LoginScope scope, CancellationToken ct)
    {
        if (scope.Agencies.Count == 0) return null;
        var key = "scope-agency-units:" + string.Join(',', scope.Agencies.Select(a => a.ToUpperInvariant()).Order(StringComparer.Ordinal));
        if (cache.TryGetValue(key, out IReadOnlySet<string>? kept) && kept is not null) return kept;
        IReadOnlyList<Application> rows;
        try
        {
            rows = await db.QuerySqlAsync<Application>(AgencyUnitsSql, new { Agencies = scope.Agencies.ToArray() }, ct);
        }
        catch (DbException ex)
        {
            log.LogError(ex, "Applications of a login scope's agencies not read");
            return new HashSet<string>();
        }
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var r in rows.Where(r => !string.IsNullOrWhiteSpace(r.ZedId)))
        {
            var id = r.ZedId!.Trim();
            set.Add(id);
            if (LoginScope.BaseLevel(r.Certification) is { } level) set.Add(id + "|" + level);
        }
        cache.Set(key, (IReadOnlySet<string>)set, Keep);
        return set;
    }

    public async Task<IReadOnlySet<string>?> UnitsAsync(LoginScope scope, CancellationToken ct)
    {
        if (scope.OneSector is null && scope.StateCodes.Count == 0) return null;
        var key = "scope-units:" + scope.OneSector + "|" + string.Join(',', scope.StateCodes.Order(StringComparer.Ordinal));
        if (cache.TryGetValue(key, out IReadOnlySet<string>? kept) && kept is not null) return kept;
        IReadOnlyList<Unit> units;
        try
        {
            units = scope.StateCodes.Count == 0
                ? await db.QuerySqlAsync<Unit>(AllUnitsSql, null, ct)
                : await db.QuerySqlAsync<Unit>(StateUnitsSql, new
                {
                    Codes = scope.StateCodes.Select(c => int.TryParse(c, NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) ? n : -1).ToArray(),
                    Names = scope.StateNames.ToArray(),
                }, ct);
        }
        catch (DbException ex)
        {
            // Not readable: nothing is shown rather than everything.
            log.LogError(ex, "Units of a login scope not read");
            return new HashSet<string>();
        }
        var types = scope.OneSector is null ? new Dictionary<string, string>() : await UserSectorActivity.SectorTypesAsync(db, log, ct);
        var set = units
            .Where(u => !string.IsNullOrWhiteSpace(u.ZedId) && scope.AllowsSector(UserSectorActivity.UnitCategory(u.Activity, u.TwoDigitActivity, types)))
            .Select(u => u.ZedId!.Trim())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        cache.Set(key, (IReadOnlySet<string>)set, Keep);
        return set;
    }
}

/// <summary>Applies the signed-in login's scope to rows and to single units.</summary>
public static class ScopeFilter
{
    /// <summary>
    /// The scope, its units (null = not limited by unit) and its agencies' applications (null = every agency) of the signed-in login.
    /// </summary>
    public static async Task<(LoginScope Scope, IReadOnlySet<string>? Units, IReadOnlySet<string>? AgencyUnits)> ForAsync(HttpContext http, CancellationToken ct)
    {
        var scope = await http.LoginScopeAsync(ct);
        if (!scope.IsLimited) return (scope, null, null);
        var units = http.RequestServices.GetRequiredService<ScopedUnits>();
        return (scope, await units.UnitsAsync(scope, ct), await units.AgencyUnitsAsync(scope, ct));
    }

    /// <summary>The rows inside the scope: the unit (ZED ID, a rejected copy's base ID too) and, when the row has one, the level.</summary>
    public static async Task<List<T>> ApplyAsync<T>(HttpContext http, IEnumerable<T> rows, Func<T, string?> zedId, Func<T, string?> level, CancellationToken ct)
    {
        var (scope, units, agencyUnits) = await ForAsync(http, ct);
        if (!scope.IsLimited) return rows.ToList();
        return rows.Where(r => Allows(scope, units, zedId(r), level(r), agencyUnits)).ToList();
    }

    /// <summary>Rows of a procedure (column names as given; the first of <paramref name="levelColumns"/> present is the level).</summary>
    public static Task<List<IDictionary<string, object?>>> ApplyAsync(HttpContext http, IEnumerable<IDictionary<string, object?>> rows, CancellationToken ct,
        string zedIdColumn = "ZedId", params string[] levelColumns) =>
        ApplyAsync(http, rows, r => r.Text(zedIdColumn),
            r => (levelColumns.Length == 0 ? ["Certification", "CertificationType"] : levelColumns).Select(c => r.Text(c)).FirstOrDefault(v => v.Length > 0), ct);

    /// <summary>One unit (and level, when known) inside the scope.</summary>
    public static async Task<bool> AllowsAsync(HttpContext http, string? zedId, string? level, CancellationToken ct)
    {
        var (scope, units, agencyUnits) = await ForAsync(http, ct);
        return !scope.IsLimited || Allows(scope, units, zedId, level, agencyUnits);
    }

    internal static bool Allows(LoginScope scope, IReadOnlySet<string>? units, string? zedId, string? level, IReadOnlySet<string>? agencyUnits = null)
    {
        if (!string.IsNullOrWhiteSpace(level) && !scope.AllowsLevel(level)) return false;
        var id = zedId?.Trim() ?? "";
        var baseId = id.Length > 0 ? AssessmentInput.BaseZedId(id) : "";
        if (units is not null && !(id.Length > 0 && (units.Contains(id) || units.Contains(baseId)))) return false;
        if (agencyUnits is null) return true;
        if (id.Length == 0) return false;
        // The application of the row's level when known (a unit can have its levels assessed by different agencies), else the unit.
        return LoginScope.BaseLevel(level) is { } lvl
            ? agencyUnits.Contains(id + "|" + lvl) || agencyUnits.Contains(baseId + "|" + lvl)
            : agencyUnits.Contains(id) || agencyUnits.Contains(baseId);
    }
}
