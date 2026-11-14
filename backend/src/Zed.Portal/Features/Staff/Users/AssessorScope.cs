using System.Data.Common;
using Zed.Core.Data;
using Zed.Portal.Features.CertLevels;

namespace Zed.Portal.Features.Staff.Users;

/// <summary>
/// 2026-11-14 (approved): one kind of assessor ("Assessor"); when the agency adds or edits one it ticks, for each
/// certification level, the modes the assessor may do: Desktop, Remote, Onsite (the level's flow decides which can be
/// ticked, <see cref="LevelFlows.ModesOf"/>). Kept in dbo.Users.AssessmentModes (migration 0072) as "Bronze=D;Silver=D,O".
/// Not set = from the old AssessorType: a Bronze Assessor does Bronze at the desktop, an Assessor every other level in all
/// its modes. Users.AssessorType stays in step (only Bronze ticked = BronzeAssessor, else Assessor) for the legacy
/// procedures and the apps. The allotment lists offer an assessor only for a level and mode it is ticked for.
/// </summary>
public static class AssessorScope
{
    public const char DesktopMode = 'D';
    public const char RemoteMode = 'R';
    public const char OnsiteMode = 'O';

    public static string ModeName(char m) => m switch { DesktopMode => "Desktop", RemoteMode => "Remote", _ => "Onsite" };
    private static char? ModeOf(string? name) => name?.Trim().ToLowerInvariant() switch
    {
        "desktop" or "d" => DesktopMode,
        "remote" or "r" => RemoteMode,
        "onsite" or "o" => OnsiteMode,
        _ => null,
    };

    /// <summary>One level's ticks, as the pages send and show them.</summary>
    public sealed record Item(string Level, IReadOnlyList<string> Modes);

    /// <summary>"Bronze=D;Silver=D,O" as level → modes.</summary>
    public static Dictionary<string, HashSet<char>> Parse(string? stored)
    {
        var map = new Dictionary<string, HashSet<char>>(StringComparer.OrdinalIgnoreCase);
        foreach (var part in (stored ?? "").Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var kv = part.Split('=', 2);
            if (kv.Length != 2 || kv[0].Trim().Length == 0) continue;
            var modes = kv[1].Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(ModeOf).OfType<char>().ToHashSet();
            if (modes.Count > 0) map[kv[0].Trim()] = modes;
        }
        return map;
    }

    public static string Format(IReadOnlyDictionary<string, HashSet<char>> map) =>
        string.Join(';', map.Where(kv => kv.Value.Count > 0).Select(kv => kv.Key + "=" + string.Join(',', "DRO".Where(kv.Value.Contains))));

    /// <summary>The ticks of an assessor: stored, else from the old AssessorType and the levels' flows.</summary>
    public static Dictionary<string, HashSet<char>> Of(string? stored, string? assessorType, IReadOnlyDictionary<string, string> flows)
    {
        if (!string.IsNullOrWhiteSpace(stored)) return Parse(stored);
        var map = new Dictionary<string, HashSet<char>>(StringComparer.OrdinalIgnoreCase);
        if (string.Equals(assessorType?.Trim(), StaffUserRules.AssessorTypeBronze, StringComparison.OrdinalIgnoreCase))
            map["Bronze"] = [DesktopMode];
        else
            foreach (var (level, flow) in flows)
                if (!string.Equals(level, "Bronze", StringComparison.OrdinalIgnoreCase)) map[level] = [.. LevelFlows.ModesOf(flow)];
        return map;
    }

    public static bool Has(IReadOnlyDictionary<string, HashSet<char>> map, string level, char mode) =>
        map.TryGetValue(level, out var modes) && modes.Contains(mode);

    public static IReadOnlyList<Item> Items(IReadOnlyDictionary<string, HashSet<char>> map) =>
        map.Select(kv => new Item(kv.Key, "DRO".Where(kv.Value.Contains).Select(ModeName).ToList())).ToList();

    /// <summary>The old Users.AssessorType of the ticks: only Bronze ticked = Bronze Assessor.</summary>
    public static string TypeOf(IReadOnlyDictionary<string, HashSet<char>> map) =>
        map.Count > 0 && map.Keys.All(k => string.Equals(k, "Bronze", StringComparison.OrdinalIgnoreCase))
            ? StaffUserRules.AssessorTypeBronze : StaffUserRules.AssessorTypeAssessor;

    /// <summary>Checks the agency's ticks against the levels and their flows; the stored text, or why not.</summary>
    public static (string? Stored, Dictionary<string, HashSet<char>>? Map, string? Error) Validate(IReadOnlyList<Item>? items, IReadOnlyDictionary<string, string> flows)
    {
        var map = new Dictionary<string, HashSet<char>>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in items ?? [])
        {
            var level = flows.Keys.FirstOrDefault(k => string.Equals(k, item.Level?.Trim(), StringComparison.OrdinalIgnoreCase));
            if (level is null) return (null, null, $"{item.Level} is not a certification level.");
            var allowed = LevelFlows.ModesOf(flows[level]);
            foreach (var name in item.Modes ?? [])
            {
                if (ModeOf(name) is not { } m) return (null, null, $"{name} is not a mode of assessment.");
                if (!allowed.Contains(m)) return (null, null, $"{LevelRegistry.NameOf(level)} has no {ModeName(m).ToLowerInvariant()} assessment.");
                (map.TryGetValue(level, out var set) ? set : map[level] = []).Add(m);
            }
        }
        if (map.Count == 0) return (null, null, "Please tick at least one certification level and mode the assessor may assess.");
        return (Format(map), map, null);
    }

    /// <summary>Every level's flow (main's levels), by code.</summary>
    public static async Task<Dictionary<string, string>> FlowsAsync(ISqlExecutor db, ILogger log, CancellationToken ct)
    {
        var stored = await LevelFlows.StoredAsync(db, log, ct);
        return LevelRegistry.All.ToDictionary(l => l.Code,
            l => LevelFlows.FlowOf(stored.GetValueOrDefault(l.Code)?.AssessmentFlow, l.AssessmentMode), StringComparer.OrdinalIgnoreCase);
    }

    public sealed record Row(string UserId, string? AssessmentModes, string? AssessorType);

    internal const string ByRoleSql = "SELECT UserId, AssessmentModes, AssessorType FROM dbo.Users WHERE RoleId = 3;";
    internal const string OfUserSql = "SELECT UserId, AssessmentModes, AssessorType FROM dbo.Users WHERE UserId = @UserId;";
    internal const string LegacyByRoleSql = "SELECT UserId, CAST(NULL AS nvarchar(1000)) AS AssessmentModes, AssessorType FROM dbo.Users WHERE RoleId = 3;";
    internal const string LegacyOfUserSql = "SELECT UserId, CAST(NULL AS nvarchar(1000)) AS AssessmentModes, AssessorType FROM dbo.Users WHERE UserId = @UserId;";
    // ZED_SURVEILLANCE.dbo.Users has AssessmentModes (0072) but no AssessorType: the surveillance portal reads the ticks with these.
    internal const string NoTypeByRoleSql = "SELECT UserId, AssessmentModes, CAST(NULL AS varchar(50)) AS AssessorType FROM dbo.Users WHERE RoleId = 3;";
    internal const string NoTypeOfUserSql = "SELECT UserId, AssessmentModes, CAST(NULL AS varchar(50)) AS AssessorType FROM dbo.Users WHERE UserId = @UserId;";

    // ZED_SURVEILLANCE.dbo.Users has no AssessorType column (schema export), so its copy gets AssessorType only where the
    // column exists (nested sp_executesql: a missing column fails the whole batch at compile time).
    internal const string SaveSql =
        "UPDATE dbo.Users SET AssessmentModes = @AssessmentModes, AssessorType = @AssessorType WHERE UserId = @UserId AND RoleId = 3; " +
        "IF EXISTS (SELECT 1 FROM ZED_SURVEILLANCE.sys.columns WHERE object_id = OBJECT_ID('ZED_SURVEILLANCE.dbo.Users') AND name = 'AssessmentModes') " +
        "EXEC ZED_SURVEILLANCE.sys.sp_executesql N'UPDATE dbo.Users SET AssessmentModes = @AssessmentModes WHERE UserId = @UserId AND RoleId = 3; " +
        "IF COL_LENGTH(''dbo.Users'', ''AssessorType'') IS NOT NULL EXEC sp_executesql N''UPDATE dbo.Users SET AssessorType = @AssessorType WHERE UserId = @UserId AND RoleId = 3;'', " +
        "N''@AssessorType varchar(50), @UserId varchar(50)'', @AssessorType = @AssessorType, @UserId = @UserId;', " +
        "N'@AssessmentModes nvarchar(1000), @AssessorType varchar(50), @UserId varchar(50)', @AssessmentModes = @AssessmentModes, @AssessorType = @AssessorType, @UserId = @UserId;";

    /// <summary>Every assessor's ticks, by user id (from the old type before migration 0072).</summary>
    public static async Task<Dictionary<string, Dictionary<string, HashSet<char>>>> ByRoleAsync(ISqlExecutor db, ILogger log, CancellationToken ct)
    {
        var flows = await FlowsAsync(db, log, ct);
        var rows = await RowsAsync(db, ByRoleSql, NoTypeByRoleSql, LegacyByRoleSql, null, log, ct);
        return rows.Where(r => !string.IsNullOrWhiteSpace(r.UserId))
            .GroupBy(r => r.UserId.Trim(), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => Of(g.First().AssessmentModes, g.First().AssessorType, flows), StringComparer.OrdinalIgnoreCase);
    }

    public static async Task<Dictionary<string, HashSet<char>>> OfUserAsync(ISqlExecutor db, string userId, ILogger log, CancellationToken ct)
    {
        var flows = await FlowsAsync(db, log, ct);
        var row = (await RowsAsync(db, OfUserSql, NoTypeOfUserSql, LegacyOfUserSql, new { UserId = userId }, log, ct)).FirstOrDefault();
        return Of(row?.AssessmentModes, row?.AssessorType, flows);
    }

    private static async Task<IReadOnlyList<Row>> RowsAsync(ISqlExecutor db, string sql, string noType, string legacy, object? args, ILogger log, CancellationToken ct)
    {
        try
        {
            return await db.QuerySqlAsync<Row>(sql, args, ct);
        }
        catch (DbException ex)
        {
            // 2026-11-14: ZED_SURVEILLANCE.dbo.Users has no AssessorType; before this the surveillance portal fell through to
            // the old type (none: every assessor "ticked" for every mode) and the Onsite-surveillance tick check let anyone in.
            log.LogDebug(ex, "Users.AssessorType not readable; reading the assessors' modes without it");
        }
        try
        {
            return await db.QuerySqlAsync<Row>(noType, args, ct);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Assessors' modes not readable (is migration 0072 applied?); their old type is used");
            try { return await db.QuerySqlAsync<Row>(legacy, args, ct); }
            catch (DbException) { return []; }
        }
    }

    /// <summary>Saves an assessor's ticks (and the old type) on main and its surveillance copy; false before migration 0072.</summary>
    public static async Task<bool> SaveAsync(ISqlExecutor db, string userId, string stored, string assessorType, ILogger log, CancellationToken ct)
    {
        try
        {
            await db.ExecuteSqlAsync(SaveSql, new { UserId = userId, AssessmentModes = stored, AssessorType = assessorType }, ct);
            return true;
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Modes of assessor {UserId} not saved (is migration 0072 applied?)", userId);
            return false;
        }
    }

    public const string NotSaved = " The assessor's levels and modes could not be saved: please ask the administrator to apply database migration 0072.";
}
