using System.Data.Common;
using Zed.Core.Data;

namespace Zed.Portal.Features.CertLevels;

/// <summary>
/// 2026-11-27 (the owner): each certification case keeps the assessment flow it started with, so the Admin may change a level's
/// flow (Administration → Certification Levels) at any time and only applications submitted afterwards follow the new one. The
/// flow is taken at the documents' final submit (status 2) into the legacy table's own column MsmeCertifications.AssessmentFlow
/// (migration 0117, which also gave the cases then in progress their level's flow); NULL = not taken yet (the level's flow).
/// Every step that routes a case in progress reads it here (SQL: dbo.FN_V4_CASE_FLOW / FN_V4_CASE_DESKTOP / FN_V4_FLOW_DESKTOP).
/// What a new application gets (payment, eligibility, the applicant's level cards) stays on the level (<see cref="LevelFlows"/>).
/// </summary>
public static class CaseFlows
{
    /// <summary>Main's row of the case (ZED_CONSULTANT / ZED_SURVEILLANCE have no such column: the level's flow applies there).</summary>
    internal const string ReadSql =
        "SELECT TOP 1 AssessmentFlow FROM dbo.MsmeCertifications WHERE ZedId = @ZedId AND Certification = @Certification ORDER BY Id DESC;";

    private sealed record Row(string? AssessmentFlow);

    /// <summary>A stored case flow in its canonical spelling; null when none (or not a flow).</summary>
    public static string? Stored(string? value) =>
        LevelFlows.Flows.FirstOrDefault(f => string.Equals(f, value?.Trim(), StringComparison.OrdinalIgnoreCase));

    /// <summary>The case's flow: its stored one, else the level's.</summary>
    public static string FlowOf(string? caseFlow, string levelFlow) => Stored(caseFlow) ?? levelFlow;

    /// <summary>
    /// Certified at the desktop (the case's flow is Desktop only); a case without a stored flow goes by its level
    /// (<see cref="LevelRegistry.IsDesktop"/>, as dbo.FN_V4_FLOW_DESKTOP).
    /// </summary>
    public static bool IsDesktop(string? caseFlow, string? level) =>
        Stored(caseFlow) is { } f ? f == LevelFlows.Desktop : LevelRegistry.IsDesktop(level);

    /// <summary>The flow of the unit's case of this level (main's database): its stored one, else the level's.</summary>
    public static async Task<string> FlowAsync(ISqlExecutor db, string zedId, string level, ILogger log, CancellationToken ct)
    {
        if (await StoredAsync(db, zedId, level, log, ct) is { } f) return f;
        return await LevelFlows.FlowAsync(db, level, log, ct);
    }

    /// <summary>The case is certified at the desktop (its flow is Desktop only).</summary>
    public static async Task<bool> IsDesktopAsync(ISqlExecutor db, string zedId, string level, ILogger log, CancellationToken ct) =>
        await StoredAsync(db, zedId, level, log, ct) is { } f ? f == LevelFlows.Desktop : LevelRegistry.IsDesktop(level);

    /// <summary>The case's stored flow; null when none was taken, or before migration 0117 (the level's flow applies then).</summary>
    public static async Task<string?> StoredAsync(ISqlExecutor db, string zedId, string level, ILogger log, CancellationToken ct)
    {
        try
        {
            var rows = await db.QuerySqlAsync<Row>(ReadSql, new { ZedId = zedId, Certification = level }, ct);
            return Stored(rows.FirstOrDefault()?.AssessmentFlow);
        }
        catch (DbException ex)
        {
            log.LogDebug(ex, "Flow of the case {ZedId} {Level} not readable (is migration 0117 applied?): the level's flow applies", zedId, level);
            return null;
        }
    }
}
