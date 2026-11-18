using System.Data.Common;
using Zed.Core.Data;
using Zed.Core.Http;

namespace Zed.Portal.Features.CertLevels;

/// <summary>
/// 2026-11-18 (the user's decisions "TAT and monitoring"): the man-days of a level's site assessment and, separately, of its
/// surveillance visit, set by the Admin (Administration → Certification Levels). Columns of the legacy levels table
/// dbo.SectionTypes (migration 0101: ManDays, SurveillanceManDays, 1-30, NULL = not set) in ZEDCS_V2_LIVE and its copy in
/// ZED_SURVEILLANCE; the portal saves main's row and the copy, as the NC rounds (<see cref="LevelNcRules"/>).
/// <para>
/// A site assessment is "Submission pending through mobile app" (Assessment / Surveillance Monitoring, In progress → Site
/// assessment) once its start (the opening meeting, else the assessment date) + the man-days has passed without the app's
/// final submission (status 13, the lead assessor's closing meeting). A level without man-days has no such cases.
/// </para>
/// </summary>
public static class LevelManDays
{
    public const int Max = 30;

    public sealed record Row(string? Code, int? ManDays, int? SurveillanceManDays);

    internal const string ReadSql = "SELECT SectionType AS Code, ManDays, SurveillanceManDays FROM dbo.SectionTypes WHERE IsCertificationLevel = 1;";

    /// <summary>Main's row, then the surveillance database's copy (Surveillance Monitoring reads its own SectionTypes).</summary>
    internal const string SaveSql =
        "UPDATE dbo.SectionTypes SET ManDays = @ManDays, SurveillanceManDays = @SurveillanceManDays WHERE SectionType = @Code AND IsCertificationLevel = 1; " +
        "IF DB_NAME() <> PARSENAME('ZED_SURVEILLANCE.dbo.x', 3) AND EXISTS (SELECT 1 FROM ZED_SURVEILLANCE.sys.columns " +
        "WHERE object_id = OBJECT_ID('ZED_SURVEILLANCE.dbo.SectionTypes') AND name = 'SurveillanceManDays') " +
        "EXEC ZED_SURVEILLANCE.sys.sp_executesql N'UPDATE dbo.SectionTypes SET ManDays = @ManDays, SurveillanceManDays = @SurveillanceManDays " +
        "WHERE SectionType = @Code AND IsCertificationLevel = 1;', N'@ManDays int, @SurveillanceManDays int, @Code varchar(50)', " +
        "@ManDays = @ManDays, @SurveillanceManDays = @SurveillanceManDays, @Code = @Code;";

    /// <summary>The stored man-days by level code; empty before migration 0101 (no level has man-days).</summary>
    public static async Task<Dictionary<string, Row>> StoredAsync(ISqlExecutor db, ILogger log, CancellationToken ct)
    {
        try
        {
            return (await db.QuerySqlAsync<Row>(ReadSql, null, ct)).Where(r => !string.IsNullOrWhiteSpace(r.Code))
                .GroupBy(r => r.Code!.Trim(), StringComparer.OrdinalIgnoreCase).ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Man-days of the levels not readable (is migration 0101 applied?)");
            return new(StringComparer.OrdinalIgnoreCase);
        }
    }

    /// <summary>
    /// The man-days the portal's monitoring uses, by level: the surveillance man-days on the Surveillance portal, the
    /// assessment man-days on main; none on the Consultancy portal (handholding has no site assessment by man-days).
    /// </summary>
    public static async Task<Dictionary<string, int>> ForMonitoringAsync(ISqlExecutor db, PortalSystem system, ILogger log, CancellationToken ct)
    {
        var map = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        if (system == PortalSystem.Consultancy) return map;
        foreach (var (code, row) in await StoredAsync(db, log, ct))
        {
            var days = system == PortalSystem.Surveillance ? row.SurveillanceManDays : row.ManDays;
            if (days is >= 1 and <= Max) map[code] = days.Value;
        }
        return map;
    }

    /// <summary>Saves a level's man-days (null = not set); false before migration 0101.</summary>
    public static async Task<bool> SaveAsync(ISqlExecutor db, string code, int? manDays, int? surveillanceManDays, ILogger log, CancellationToken ct)
    {
        try
        {
            await db.ExecuteSqlAsync(SaveSql, new { Code = code, ManDays = manDays, SurveillanceManDays = surveillanceManDays }, ct);
            return true;
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Man-days of {Code} not saved (is migration 0101 applied?)", code);
            return false;
        }
    }

    public const string NotSaved = " The man-days could not be saved: please ask the administrator to apply database migration 0101.";

    /// <summary>Null when the values can be saved; otherwise why not.</summary>
    public static string? Problem(int? manDays, int? surveillanceManDays)
    {
        if (manDays is not null and not (>= 1 and <= Max)) return $"Man-days (assessment) must be 1 to {Max}.";
        if (surveillanceManDays is not null and not (>= 1 and <= Max)) return $"Man-days (surveillance) must be 1 to {Max}.";
        return null;
    }

    /// <summary>
    /// The site assessment's submission is pending through the mobile app: started (opening meeting, else assessment date),
    /// the level's man-days passed (start date + man-days, from midnight), and no final submission yet.
    /// </summary>
    public static bool SubmissionPending(DateTime? openingMeeting, DateTime? assessmentDate, bool submitted, int? manDays, DateTime now)
    {
        if (submitted || manDays is not (>= 1 and <= Max)) return false;
        var start = openingMeeting ?? assessmentDate;
        return start is { } s && now >= s.Date.AddDays(manDays.Value);
    }
}
