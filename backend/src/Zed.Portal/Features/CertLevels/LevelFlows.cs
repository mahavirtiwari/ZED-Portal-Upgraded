using System.Data.Common;
using Zed.Core.Data;

namespace Zed.Portal.Features.CertLevels;

/// <summary>
/// 2026-11-14 (approved): how a certification level is assessed and how its surveillance is done, chosen by the Admin
/// (Administration → Certification Levels, Certificate tab "Assessment", Surveillance tab "Mode of assessment"). Kept in
/// columns of the legacy table dbo.SectionTypes (migration 0072): AssessmentFlow and SurveillanceMode. The old
/// AssessmentMode column ('Desktop' / 'Site') stays in step (Desktop only = 'Desktop', every other flow = 'Site'), so the
/// procedures and the apps that read it are unchanged. Not set = as before: Desktop only for a desktop level, Desktop +
/// Onsite for the others; surveillance Remote (today's flow with a meeting link).
/// The flows are built one by one: a choice the portal cannot run yet is shown in the Admin but refused when saved
/// (<see cref="Available"/>).
/// </summary>
public static class LevelFlows
{
    public const string Desktop = "Desktop";
    public const string Remote = "Remote";
    public const string Onsite = "Onsite";
    public const string DesktopRemote = "DesktopRemote";
    public const string DesktopOnsite = "DesktopOnsite";

    public static readonly string[] Flows = [Desktop, Remote, Onsite, DesktopRemote, DesktopOnsite];
    public static readonly string[] SurveillanceModes = [Remote, Onsite];

    /// <summary>The flows the portal runs today (the others come later and are refused when saved).</summary>
    public static readonly string[] Available = [Desktop, DesktopOnsite, DesktopRemote, Remote, Onsite];
    public static readonly string[] AvailableSurveillance = [Remote, Onsite];

    /// <summary>The modes an assessor can be given for a level of this flow: D(esktop), R(emote), O(nsite).</summary>
    public static IReadOnlyList<char> ModesOf(string flow) => flow switch
    {
        Desktop => ['D'],
        Remote => ['R'],
        Onsite => ['O'],
        DesktopRemote => ['D', 'R'],
        _ => ['D', 'O'],
    };

    /// <summary>The flow of a level: the stored one, else from the old AssessmentMode.</summary>
    public static string FlowOf(string? stored, string assessmentMode) =>
        Flows.FirstOrDefault(f => string.Equals(f, stored?.Trim(), StringComparison.OrdinalIgnoreCase))
        ?? (assessmentMode == CertificationLevels.Desktop ? Desktop : DesktopOnsite);

    public static string SurveillanceModeOf(string? stored) =>
        SurveillanceModes.FirstOrDefault(m => string.Equals(m, stored?.Trim(), StringComparison.OrdinalIgnoreCase)) ?? Remote;

    /// <summary>The old AssessmentMode column of a flow.</summary>
    public static string AssessmentModeOf(string flow) => flow == Desktop ? CertificationLevels.Desktop : CertificationLevels.Site;

    public sealed record Row(string? Code, string? AssessmentFlow, string? SurveillanceMode);

    internal const string ReadSql = "SELECT SectionType AS Code, AssessmentFlow, SurveillanceMode FROM dbo.SectionTypes WHERE IsCertificationLevel = 1;";
    /// <summary>
    /// Main's row, then the same level's row of the surveillance database's copy (2026-11-14: the Admin works on main only,
    /// and the surveillance portal reads its own copy), where migration 0072 added the columns there.
    /// </summary>
    internal const string SaveSql =
        "UPDATE dbo.SectionTypes SET AssessmentFlow = @AssessmentFlow, SurveillanceMode = @SurveillanceMode WHERE SectionType = @Code AND IsCertificationLevel = 1; " +
        "IF DB_NAME() <> PARSENAME('ZED_SURVEILLANCE.dbo.x', 3) AND EXISTS (SELECT 1 FROM ZED_SURVEILLANCE.sys.columns " +
        "WHERE object_id = OBJECT_ID('ZED_SURVEILLANCE.dbo.SectionTypes') AND name = 'AssessmentFlow') " +
        "EXEC ZED_SURVEILLANCE.sys.sp_executesql N'UPDATE dbo.SectionTypes SET AssessmentFlow = @AssessmentFlow, SurveillanceMode = @SurveillanceMode " +
        "WHERE SectionType = @Code AND IsCertificationLevel = 1;', N'@AssessmentFlow varchar(20), @SurveillanceMode varchar(10), @Code varchar(50)', " +
        "@AssessmentFlow = @AssessmentFlow, @SurveillanceMode = @SurveillanceMode, @Code = @Code;";

    /// <summary>The stored choices by level code; empty before migration 0072 (every level as before).</summary>
    public static async Task<Dictionary<string, Row>> StoredAsync(ISqlExecutor db, ILogger log, CancellationToken ct)
    {
        try
        {
            return (await db.QuerySqlAsync<Row>(ReadSql, null, ct)).Where(r => !string.IsNullOrWhiteSpace(r.Code))
                .GroupBy(r => r.Code!.Trim(), StringComparer.OrdinalIgnoreCase).ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Assessment flows of the levels not readable (is migration 0072 applied?)");
            return new(StringComparer.OrdinalIgnoreCase);
        }
    }

    /// <summary>A level's flow (main's table; another host reads it by name).</summary>
    public static async Task<string> FlowAsync(ISqlExecutor db, string level, ILogger log, CancellationToken ct)
    {
        var entry = LevelRegistry.Find(level);
        var stored = (await StoredAsync(db, log, ct)).GetValueOrDefault(entry?.Code ?? level);
        return FlowOf(stored?.AssessmentFlow, entry?.AssessmentMode ?? (LevelRegistry.IsDesktop(level) ? CertificationLevels.Desktop : CertificationLevels.Site));
    }

    /// <summary>Saves a level's choices; false before migration 0072.</summary>
    public static async Task<bool> SaveAsync(ISqlExecutor db, string code, string flow, string surveillanceMode, ILogger log, CancellationToken ct)
    {
        try
        {
            await db.ExecuteSqlAsync(SaveSql, new { Code = code, AssessmentFlow = flow, SurveillanceMode = surveillanceMode }, ct);
            return true;
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Assessment flow of {Code} not saved (is migration 0072 applied?)", code);
            return false;
        }
    }

    public const string NotSaved = " The assessment choices could not be saved: please ask the administrator to apply database migration 0072.";

    /// <summary>Null when the choices can be saved; otherwise why not.</summary>
    public static string? Problem(string? flow, string? surveillanceMode, string code)
    {
        if (flow is not null && !Flows.Contains(flow)) return "Please choose how the level is assessed.";
        if (surveillanceMode is not null && !SurveillanceModes.Contains(surveillanceMode)) return "Please choose the surveillance's mode of assessment.";
        if (flow is not null && !Available.Contains(flow)) return $"{Label(flow)} is not available yet: it comes with the next update.";
        if (surveillanceMode is not null && !AvailableSurveillance.Contains(surveillanceMode))
            return "Onsite surveillance is not available yet: it comes with the next update.";
        // Silver and Gold are assessed on site by the legacy procedures, whatever AssessmentMode says.
        if (flow == Desktop && (string.Equals(code, "Silver", StringComparison.OrdinalIgnoreCase) || string.Equals(code, "Gold", StringComparison.OrdinalIgnoreCase)))
            return "Silver and Gold keep a site assessment.";
        // Bronze is certified after desktop verification by the legacy procedures.
        if (flow is not null && flow != Desktop && string.Equals(code, "Bronze", StringComparison.OrdinalIgnoreCase))
            return "Bronze stays Desktop only until its remote and onsite flows come with the next update.";
        return null;
    }

    public static string Label(string flow) => flow switch
    {
        Desktop => "Desktop only",
        Remote => "Remote only",
        Onsite => "Onsite only",
        DesktopRemote => "Desktop + Remote",
        _ => "Desktop + Onsite",
    };
}
