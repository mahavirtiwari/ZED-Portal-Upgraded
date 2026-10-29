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

    public const string NotSaved = " The sector type could not be saved: please ask the administrator to apply database migration 0028.";
}
