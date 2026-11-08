using System.Data.Common;
using Zed.Core.Data;

namespace Zed.Portal.Features.Staff.Users;

/// <summary>
/// Every block and unblock of a staff login, with its reason, who did it and when (2026-11-08, at the Master Admin's request):
/// dbo.UserBlockHistory (migration 0061, in ZEDCS_V2_LIVE and ZED_CONSULTANT), named like the legacy history tables.
/// Before the migration nothing is recorded or listed, and blocking works as before.
/// </summary>
public static class UserBlockHistory
{
    public const string Blocked = "Blocked";
    public const string Unblocked = "Unblocked";

    internal const string InsertSql =
        "INSERT INTO dbo.UserBlockHistory (UserId, RoleId, Action, Reason, ActionBy, ActionByRole, ActionDate) " +
        "VALUES (@UserId, @RoleId, @Action, @Reason, @ActionBy, @ActionByRole, GETDATE());";

    internal const string ListSql =
        "SELECT Action, Reason, ActionBy, ActionByRole, ActionDate FROM dbo.UserBlockHistory WHERE UserId = @UserId ORDER BY ActionDate DESC, Id DESC;";

    /// <summary>The latest block of each user that is blocked now (for the reason and date under the Blocked badge).</summary>
    internal const string LatestBlocksSql =
        "SELECT h.UserId, h.Reason, h.ActionDate FROM dbo.UserBlockHistory h " +
        "WHERE h.Action = 'Blocked' AND h.Id = (SELECT MAX(x.Id) FROM dbo.UserBlockHistory x WHERE x.UserId = h.UserId);";

    public sealed record Entry(string Action, string? Reason, string? ActionBy, int? ActionByRole, DateTime? ActionDate);

    public sealed class LatestRow
    {
        public string? UserId { get; init; }
        public string? Reason { get; init; }
        public DateTime? ActionDate { get; init; }
    }

    public static async Task RecordAsync(ISqlExecutor db, string userId, int? roleId, string action, string? reason, string? actionBy, int? actionByRole,
        ILogger log, CancellationToken ct)
    {
        try
        {
            await db.ExecuteSqlAsync(InsertSql, new
            {
                UserId = userId, RoleId = roleId, Action = action, Reason = string.IsNullOrWhiteSpace(reason) ? null : reason,
                ActionBy = actionBy, ActionByRole = actionByRole,
            }, ct);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "{Action} of {UserId} not recorded in the history (is migration 0061 applied?)", action, userId);
        }
    }

    public static async Task<IReadOnlyList<Entry>> ListAsync(ISqlExecutor db, string userId, ILogger log, CancellationToken ct)
    {
        try
        {
            return (await db.QuerySqlAsync<Entry>(ListSql, new { UserId = userId }, ct)).ToList();
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Block history of {UserId} not read (is migration 0061 applied?)", userId);
            return [];
        }
    }

    public static async Task<Dictionary<string, LatestRow>> LatestBlocksAsync(ISqlExecutor db, ILogger log, CancellationToken ct)
    {
        try
        {
            return (await db.QuerySqlAsync<LatestRow>(LatestBlocksSql, null, ct)).Where(r => r.UserId is not null)
                .GroupBy(r => r.UserId!.Trim(), StringComparer.OrdinalIgnoreCase).ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Latest blocks not read (is migration 0061 applied?)");
            return new(StringComparer.OrdinalIgnoreCase);
        }
    }
}
