using System.Data.Common;
using Zed.Core.Data;

namespace Zed.Portal.Features.CertLevels;

/// <summary>
/// 2026-11-16 (approved): each level's NC rounds and the days to close them, set by the Admin (Administration →
/// Certification Levels, Certificate tab "Non-conformities"). Kept in columns of the legacy table dbo.SectionTypes
/// (migration 0086: NcRounds 1-5, NcDays 1-365), read by the final submits through dbo.FN_V4_NC_ROUNDS / FN_V4_NC_DAYS.
/// The NCs are raised where the flow says: Desktop only at the desktop assessment; every other flow at the remote / onsite
/// assessment (a combined flow's desktop step raises none, migration 0078). The days count from the first NC and cover
/// every round. Not set = 5 rounds, 30 days for Desktop only and 60 days for the others.
/// </summary>
public static class LevelNcRules
{
    public const int DefaultRounds = 5;
    /// <summary>The records have five NC round columns (Nc1Status..Nc5Status).</summary>
    public const int MaxRounds = 5;
    public const int MaxDays = 365;

    public static int DefaultDays(string flow) => flow == LevelFlows.Desktop ? 30 : 60;

    public static int RoundsOf(int? stored) => stored is >= 1 and <= MaxRounds ? stored.Value : DefaultRounds;
    public static int DaysOf(int? stored, string flow) => stored is >= 1 and <= MaxDays ? stored.Value : DefaultDays(flow);

    /// <summary>Where the level's NCs are raised, for the Admin's note and the level card.</summary>
    public static string StageOf(string flow) => flow switch
    {
        LevelFlows.Desktop => "desktop",
        LevelFlows.Remote or LevelFlows.DesktopRemote => "remote",
        _ => "onsite",
    };

    public sealed record Row(string? Code, int? NcRounds, int? NcDays);

    internal const string ReadSql = "SELECT SectionType AS Code, NcRounds, NcDays FROM dbo.SectionTypes WHERE IsCertificationLevel = 1;";

    /// <summary>Main's row, then the surveillance database's copy (its final submits read their own SectionTypes).</summary>
    internal const string SaveSql =
        "UPDATE dbo.SectionTypes SET NcRounds = @NcRounds, NcDays = @NcDays WHERE SectionType = @Code AND IsCertificationLevel = 1; " +
        "IF DB_NAME() <> PARSENAME('ZED_SURVEILLANCE.dbo.x', 3) AND EXISTS (SELECT 1 FROM ZED_SURVEILLANCE.sys.columns " +
        "WHERE object_id = OBJECT_ID('ZED_SURVEILLANCE.dbo.SectionTypes') AND name = 'NcDays') " +
        "EXEC ZED_SURVEILLANCE.sys.sp_executesql N'UPDATE dbo.SectionTypes SET NcRounds = @NcRounds, NcDays = @NcDays " +
        "WHERE SectionType = @Code AND IsCertificationLevel = 1;', N'@NcRounds int, @NcDays int, @Code varchar(50)', " +
        "@NcRounds = @NcRounds, @NcDays = @NcDays, @Code = @Code;";

    /// <summary>The stored settings by level code; empty before migration 0086 (every level on the defaults).</summary>
    public static async Task<Dictionary<string, Row>> StoredAsync(ISqlExecutor db, ILogger log, CancellationToken ct)
    {
        try
        {
            return (await db.QuerySqlAsync<Row>(ReadSql, null, ct)).Where(r => !string.IsNullOrWhiteSpace(r.Code))
                .GroupBy(r => r.Code!.Trim(), StringComparer.OrdinalIgnoreCase).ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "NC rounds and days of the levels not readable (is migration 0086 applied?)");
            return new(StringComparer.OrdinalIgnoreCase);
        }
    }

    /// <summary>A level's rounds and days as its final submits use them (the NC e-mail).</summary>
    public static async Task<(int Rounds, int Days)> ForAsync(ISqlExecutor db, string level, ILogger log, CancellationToken ct)
    {
        var entry = LevelRegistry.Find(level);
        var stored = (await StoredAsync(db, log, ct)).GetValueOrDefault(entry?.Code ?? level);
        // The stage the NCs are raised at: the desktop for a desktop level, else the visit (as the procedures decide).
        var flow = LevelRegistry.IsDesktop(level) ? LevelFlows.Desktop : LevelFlows.DesktopOnsite;
        return (RoundsOf(stored?.NcRounds), DaysOf(stored?.NcDays, flow));
    }

    /// <summary>Saves a level's settings; false before migration 0086.</summary>
    public static async Task<bool> SaveAsync(ISqlExecutor db, string code, int rounds, int days, ILogger log, CancellationToken ct)
    {
        try
        {
            await db.ExecuteSqlAsync(SaveSql, new { Code = code, NcRounds = rounds, NcDays = days }, ct);
            return true;
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "NC rounds and days of {Code} not saved (is migration 0086 applied?)", code);
            return false;
        }
    }

    public const string NotSaved = " The NC rounds and days could not be saved: please ask the administrator to apply database migration 0086.";

    /// <summary>Null when the values can be saved; otherwise why not.</summary>
    public static string? Problem(int? rounds, int? days)
    {
        if (rounds is not null and not (>= 1 and <= MaxRounds)) return $"NC rounds must be 1 to {MaxRounds}.";
        if (days is not null and not (>= 1 and <= MaxDays)) return $"Days to close NCs must be 1 to {MaxDays}.";
        return null;
    }
}
