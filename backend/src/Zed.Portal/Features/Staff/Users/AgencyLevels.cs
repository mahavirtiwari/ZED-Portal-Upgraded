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

    public static readonly IReadOnlyList<Level> Fixed =
    [
        new("Bronze", "Bronze", null, null),
        new("Silver", "Silver", "AllowSilverAssessments", "ReasonForBlockSilver"),
        new("Gold", "Gold", "AllowGoldAssessments", "ReasonForBlockGold"),
        new("ZEDX", "ZED-X", "AllowZedxAssessments", "ReasonForBlockZedx"),
    ];

    /// <summary>
    /// The four above, then every other level of Administration → Certification Levels (2026-11-08, generic levels) with its
    /// columns Users.Allow{Code}Assessments / ReasonForBlock{Code} (added with the level, or by migration 0065).
    /// </summary>
    public static IReadOnlyList<Level> All =>
    [
        .. Fixed.Select(f => LevelRegistry.Find(f.Code) is { } r ? f with { Name = r.Name } : f),
        .. LevelRegistry.All.Where(r => !Fixed.Any(f => string.Equals(f.Code, r.Code, StringComparison.OrdinalIgnoreCase)))
            .Select(r => new Level(r.Code, r.Name, LevelRegistry.AgencyColumn(r.Code), LevelRegistry.AgencyReasonColumn(r.Code))),
    ];

    /// <summary>The levels beyond the four (their columns are read one level at a time: a missing column leaves the level out).</summary>
    public static IReadOnlyList<Level> Added => [.. All.Where(l => !Fixed.Any(f => string.Equals(f.Code, l.Code, StringComparison.OrdinalIgnoreCase)))];

    /// <summary>One added level's columns of every agency (the column names come from the registry, whose codes are letters and digits).</summary>
    internal static string AddedSql(Level level) =>
        $"SELECT UserId, CAST([{level.Column}] AS bit) AS Allow, [{level.ReasonColumn}] AS Reason FROM dbo.Users WHERE RoleId = 2;";

    public sealed class AddedRow
    {
        public string? UserId { get; init; }
        public bool? Allow { get; init; }
        public string? Reason { get; init; }
    }

    /// <summary>A level of an agency in the list (2026-11-08): <paramref name="Allow"/> false when disabled for it.</summary>
    public sealed record AgencyLevel(string Code, string Name, bool Allow, string? Reason);

    /// <summary>
    /// The added levels whose columns exist, with each agency's values (UserId → code → (allow, reason)).
    /// </summary>
    public static async Task<(IReadOnlyList<Level> Levels, Dictionary<string, Dictionary<string, AddedRow>> ByUser)> AddedAsync(
        ISqlExecutor db, ILogger log, CancellationToken ct)
    {
        var levels = new List<Level>();
        var byUser = new Dictionary<string, Dictionary<string, AddedRow>>(StringComparer.OrdinalIgnoreCase);
        foreach (var level in Added)
        {
            IReadOnlyList<AddedRow> rows;
            try { rows = await db.QuerySqlAsync<AddedRow>(AddedSql(level), null, ct); }
            catch (DbException ex)
            {
                log.LogWarning(ex, "Agency columns of level {Level} not read (added by the next update)", level.Code);
                continue;
            }
            levels.Add(level);
            foreach (var r in rows.Where(r => r.UserId is not null))
            {
                if (!byUser.TryGetValue(r.UserId!.Trim(), out var map)) byUser[r.UserId.Trim()] = map = new(StringComparer.OrdinalIgnoreCase);
                map[level.Code] = r;
            }
        }
        return (levels, byUser);
    }

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
