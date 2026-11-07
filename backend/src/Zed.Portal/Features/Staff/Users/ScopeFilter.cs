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
    /// <summary>The scope and its units (null units = not limited by unit) of the signed-in login.</summary>
    public static async Task<(LoginScope Scope, IReadOnlySet<string>? Units)> ForAsync(HttpContext http, CancellationToken ct)
    {
        var scope = await http.LoginScopeAsync(ct);
        if (!scope.IsLimited) return (scope, null);
        return (scope, await http.RequestServices.GetRequiredService<ScopedUnits>().UnitsAsync(scope, ct));
    }

    /// <summary>The rows inside the scope: the unit (ZED ID, a rejected copy's base ID too) and, when the row has one, the level.</summary>
    public static async Task<List<T>> ApplyAsync<T>(HttpContext http, IEnumerable<T> rows, Func<T, string?> zedId, Func<T, string?> level, CancellationToken ct)
    {
        var (scope, units) = await ForAsync(http, ct);
        if (!scope.IsLimited) return rows.ToList();
        return rows.Where(r => Allows(scope, units, zedId(r), level(r))).ToList();
    }

    /// <summary>Rows of a procedure (column names as given; the first of <paramref name="levelColumns"/> present is the level).</summary>
    public static Task<List<IDictionary<string, object?>>> ApplyAsync(HttpContext http, IEnumerable<IDictionary<string, object?>> rows, CancellationToken ct,
        string zedIdColumn = "ZedId", params string[] levelColumns) =>
        ApplyAsync(http, rows, r => r.Text(zedIdColumn),
            r => (levelColumns.Length == 0 ? ["Certification", "CertificationType"] : levelColumns).Select(c => r.Text(c)).FirstOrDefault(v => v.Length > 0), ct);

    /// <summary>One unit (and level, when known) inside the scope.</summary>
    public static async Task<bool> AllowsAsync(HttpContext http, string? zedId, string? level, CancellationToken ct)
    {
        var (scope, units) = await ForAsync(http, ct);
        return !scope.IsLimited || Allows(scope, units, zedId, level);
    }

    internal static bool Allows(LoginScope scope, IReadOnlySet<string>? units, string? zedId, string? level)
    {
        if (!string.IsNullOrWhiteSpace(level) && !scope.AllowsLevel(level)) return false;
        if (units is null) return true;
        var id = zedId?.Trim() ?? "";
        return id.Length > 0 && (units.Contains(id) || units.Contains(AssessmentInput.BaseZedId(id)));
    }
}
