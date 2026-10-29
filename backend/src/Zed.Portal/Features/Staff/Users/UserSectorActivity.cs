using System.Data.Common;
using Zed.Core.Data;

namespace Zed.Portal.Features.Staff.Users;

/// <summary>
/// V4 (migration 0028): which MSMEs an assessment agency or an assessor may assess: Manufacturing, Services or Both
/// (dbo.Users.SectorActivity, ZEDCS_V2_LIVE). Chosen when the agency or the assessor is created or edited; an assessor
/// cannot cover more than its agency. The legacy procedures do not know the column, so it is written after them.
/// </summary>
public static class UserSectorActivity
{
    public const string Both = "Both";
    public static readonly string[] Values = ["Manufacturing", "Services", Both];

    public static string? Canonical(string? value) =>
        Values.FirstOrDefault(v => string.Equals(v, value?.Trim(), StringComparison.OrdinalIgnoreCase));

    /// <summary>Whether an agency with <paramref name="agency"/> may have an assessor with <paramref name="assessor"/> (not set yet = no limit).</summary>
    public static bool Covers(string? agency, string assessor) => Canonical(agency) is not { } a || a == Both || a == assessor;

    public sealed record Row(string UserId, string? SectorActivity);

    internal const string UpdateSql = "UPDATE dbo.Users SET SectorActivity = @SectorActivity WHERE UserId = @UserId;";
    internal const string ByRoleSql = "SELECT UserId, SectorActivity FROM dbo.Users WHERE RoleId = @RoleId AND SectorActivity IS NOT NULL;";
    internal const string OfUserSql = "SELECT UserId, SectorActivity FROM dbo.Users WHERE UserId = @UserId;";

    /// <summary>User id → its sector type, for a list (empty before migration 0028).</summary>
    public static async Task<Dictionary<string, string>> ByRoleAsync(ISqlExecutor db, int roleId, ILogger log, CancellationToken ct)
    {
        try
        {
            return (await db.QuerySqlAsync<Row>(ByRoleSql, new { RoleId = roleId }, ct))
                .Where(r => r.SectorActivity is not null)
                .GroupBy(r => r.UserId, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.First().SectorActivity!, StringComparer.OrdinalIgnoreCase);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Sector types not read (is migration 0028 applied?)");
            return new(StringComparer.OrdinalIgnoreCase);
        }
    }

    public static async Task<string?> OfUserAsync(ISqlExecutor db, string userId, ILogger log, CancellationToken ct)
    {
        try
        {
            return (await db.QuerySqlAsync<Row>(OfUserSql, new { UserId = userId }, ct)).FirstOrDefault()?.SectorActivity;
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Sector type of {UserId} not read (is migration 0028 applied?)", userId);
            return null;
        }
    }

    /// <summary>Writes the sector type; false when the column is missing (migration 0028 not applied).</summary>
    public static async Task<bool> SaveAsync(ISqlExecutor db, string userId, string value, ILogger log, CancellationToken ct)
    {
        try
        {
            await db.ExecuteSqlAsync(UpdateSql, new { UserId = userId, SectorActivity = value }, ct);
            return true;
        }
        catch (DbException ex)
        {
            log.LogError(ex, "Sector type of {UserId} not saved (is migration 0028 applied?)", userId);
            return false;
        }
    }

    /// <summary>
    /// Whether an agency or assessor with <paramref name="userActivity"/> may assess a unit of <paramref name="unitCategory"/>
    /// (Manufacturing / Services): a user not set yet, or a unit whose category is not known, is not limited.
    /// </summary>
    public static bool Serves(string? userActivity, string? unitCategory) => unitCategory is null || Covers(userActivity, unitCategory);

    public sealed record SectorRow(string? SectorCode, string? SectorType);

    internal const string SectorTypesSql = "SELECT SectorCode, SectorType FROM dbo.Sectors WHERE SectorType IS NOT NULL;";

    /// <summary>NIC 2-digit code → Manufacturing / Services (Masters → Sectors, migration 0025); empty when not readable.</summary>
    public static async Task<Dictionary<string, string>> SectorTypesAsync(ISqlExecutor db, ILogger log, CancellationToken ct)
    {
        try
        {
            return (await db.QuerySqlAsync<SectorRow>(SectorTypesSql, null, ct))
                .Where(r => (r.SectorCode?.Trim().Length ?? 0) > 0 && r.SectorType is not null)
                .GroupBy(r => r.SectorCode!.Trim()).ToDictionary(g => g.Key, g => g.First().SectorType!);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Sector types not read (is migration 0025 applied?)");
            return [];
        }
    }

    /// <summary>
    /// A unit's category: the type of its NIC sector (LEFT(TwoDigitActivity, 2)) in Masters → Sectors, else its Udyam
    /// activity (Msme.Activity: "Manufacturing", anything else Services); null when neither is known.
    /// </summary>
    public static string? UnitCategory(string? activity, string? twoDigitActivity, IReadOnlyDictionary<string, string> sectorTypes)
    {
        var t = twoDigitActivity?.TrimStart() ?? "";
        if (t.Length >= 2 && sectorTypes.TryGetValue(t[..2], out var type) && Canonical(type) is { } fromSector and not Both) return fromSector;
        var a = activity?.Trim() ?? "";
        return a.Length == 0 ? null : a.StartsWith("Manuf", StringComparison.OrdinalIgnoreCase) ? "Manufacturing" : "Services";
    }

    public sealed record UnitRow(string? Activity, string? TwoDigitActivity);

    internal const string UnitSql = "SELECT TOP 1 Activity, TwoDigitActivity FROM dbo.Msme WHERE ZedId = @ZedId;";

    public static async Task<string?> UnitCategoryAsync(ISqlExecutor db, string zedId, ILogger log, CancellationToken ct)
    {
        try
        {
            var unit = (await db.QuerySqlAsync<UnitRow>(UnitSql, new { ZedId = zedId }, ct)).FirstOrDefault();
            return unit is null ? null : UnitCategory(unit.Activity, unit.TwoDigitActivity, await SectorTypesAsync(db, log, ct));
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Category of unit {ZedId} not read", zedId);
            return null;
        }
    }

    public const string NotSaved = " The sector type could not be saved: please ask the administrator to apply database migration 0028.";
}
