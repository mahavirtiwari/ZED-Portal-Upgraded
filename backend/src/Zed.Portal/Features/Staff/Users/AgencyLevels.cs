using System.Data.Common;
using Zed.Core.Data;

namespace Zed.Portal.Features.Staff.Users;

/// <summary>
/// The certification levels an assessment agency may be allotted (2026-11-08, at the Master Admin's request; Agencies ->
/// Agency level allocation). Bronze is the legacy Users.AllowBronzeAssessments (SP_BLOCK_UNBLOCK_BRONZE_AGENCY, reason in
/// ReasonForRejectionForBA); Silver, Gold and ZED-X are migration 0060's columns of the legacy table: Users.Allow{Level}Assessments
/// (NULL = allowed, as every agency was before) and ReasonForBlock{Level}.
/// </summary>
public static class AgencyLevels
{
    public sealed record Level(string Code, string Name, string? Column, string? ReasonColumn);

    public static readonly IReadOnlyList<Level> All =
    [
        new("Bronze", "Bronze", null, null),
        new("Silver", "Silver", "AllowSilverAssessments", "ReasonForBlockSilver"),
        new("Gold", "Gold", "AllowGoldAssessments", "ReasonForBlockGold"),
        new("ZEDX", "ZED-X", "AllowZedxAssessments", "ReasonForBlockZedx"),
    ];

    public static Level? Find(string? code) =>
        All.FirstOrDefault(l => string.Equals(l.Code, code?.Trim().Replace("-", ""), StringComparison.OrdinalIgnoreCase));

    internal const string ListSql =
        "SELECT UserId, ReasonForRejectionForBA, AllowSilverAssessments, AllowGoldAssessments, AllowZedxAssessments, " +
        "ReasonForBlockSilver, ReasonForBlockGold, ReasonForBlockZedx FROM dbo.Users WHERE RoleId = 2;";

    /// <summary>The fixed UPDATE of one level's columns (the column names come from <see cref="All"/>, never from input).</summary>
    internal static string SaveSql(Level level) =>
        $"UPDATE dbo.Users SET {level.Column} = @Allow, {level.ReasonColumn} = @Reason WHERE UserId = @UserId AND RoleId = 2;";

    /// <summary>Bronze: the legacy AllowBronzeAssessments (2026-11-08: so the financial assistance round robin sees it too).</summary>
    internal static string DisabledSql(Level level) => $"SELECT UserId FROM dbo.Users WHERE RoleId = 2 AND {level.Column ?? "AllowBronzeAssessments"} = 0;";

    public sealed class Row
    {
        public string? UserId { get; init; }
        public string? ReasonForRejectionForBA { get; init; }
        public bool? AllowSilverAssessments { get; init; }
        public bool? AllowGoldAssessments { get; init; }
        public bool? AllowZedxAssessments { get; init; }
        public string? ReasonForBlockSilver { get; init; }
        public string? ReasonForBlockGold { get; init; }
        public string? ReasonForBlockZedx { get; init; }
    }

    public sealed class IdRow
    {
        public string? UserId { get; init; }
    }

    /// <summary>Every agency's levels; empty before migration 0060 (then every level is allowed).</summary>
    public static async Task<Dictionary<string, Row>> ListAsync(ISqlExecutor db, ILogger log, CancellationToken ct)
    {
        try
        {
            return (await db.QuerySqlAsync<Row>(ListSql, null, ct)).Where(r => r.UserId is not null)
                .GroupBy(r => r.UserId!.Trim(), StringComparer.OrdinalIgnoreCase).ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Agency levels not read (is migration 0060 applied?)");
            return new(StringComparer.OrdinalIgnoreCase);
        }
    }

    /// <summary>The agencies a level (Silver, Gold or ZED-X) was disabled for; none before migration 0060.</summary>
    public static async Task<HashSet<string>> DisabledAsync(ISqlExecutor db, string level, ILogger log, CancellationToken ct)
    {
        if (Find(level) is not { } l) return new(StringComparer.OrdinalIgnoreCase);
        try
        {
            return (await db.QuerySqlAsync<IdRow>(DisabledSql(l), null, ct)).Select(u => u.UserId?.Trim()).OfType<string>()
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Agencies disabled for {Level} not read (is migration 0060 applied?)", level);
            return new(StringComparer.OrdinalIgnoreCase);
        }
    }
}
