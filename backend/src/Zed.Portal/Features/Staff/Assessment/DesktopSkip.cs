using System.Data.Common;
using Zed.Core.Data;

namespace Zed.Portal.Features.Staff.Assessment;

/// <summary>
/// 2026-11-14 (Remote only / Onsite only, approved): once a just-submitted unit of a level without a desktop step has its
/// agency, dbo.SP_V4_SKIP_DESKTOP (migration 0074) moves it to status 6, the agency's SA allotment, with no desktop record;
/// it does nothing for the other levels. A failure (the migration not applied) is logged and leaves the unit as it was.
/// </summary>
public static class DesktopSkip
{
    public const string Procedure = "SP_V4_SKIP_DESKTOP";

    /// <summary>The field a list row gets when its unit skipped the desktop step and waits at status 6: "Onsite" or "Remote".</summary>
    public const string Field = "DesktopSkipped";

    /// <summary>
    /// The units of these ZED IDs waiting at status 6 with no desktop step: no desktop assessor and no desktop certificate
    /// (SP_V4_SKIP_DESKTOP leaves exactly that), with their level's flow.
    /// </summary>
    internal const string WaitingSql =
        "SELECT P.ZedId, P.Certification, ST.AssessmentFlow AS Flow FROM dbo.MsmeCertifications P " +
        "LEFT JOIN dbo.SectionTypes ST ON ST.SectionType = P.Certification AND ST.IsCertificationLevel = 1 " +
        "WHERE P.ZedId IN @ZedIds AND P.CertificationStatus = 6 AND NULLIF(P.DesktopAssessorId, '') IS NULL AND P.DaCertificateNo IS NULL;";

    private sealed record WaitingRow(string? ZedId, string? Certification, string? Flow);

    /// <summary>"Remote" for a Remote only level, else "Onsite".</summary>
    public static string ModeOf(string? flow) => string.Equals(flow?.Trim(), CertLevels.LevelFlows.Remote, StringComparison.OrdinalIgnoreCase) ? "Remote" : "Onsite";

    /// <summary>
    /// 2026-11-26 (the user: an Onsite only Bronze unit read "Agency Final submit done for DA" with no desktop assessment): marks the
    /// rows at status 6 whose unit skipped the desktop step (<see cref="Field"/>), so the page says what it waits for. A failure
    /// leaves the rows as they are.
    /// </summary>
    public static async Task MarkAsync(ISqlExecutor db, IReadOnlyList<Dictionary<string, object?>> rows, ILogger log, CancellationToken ct)
    {
        static string Text(Dictionary<string, object?> r, string k) => r.TryGetValue(k, out var v) ? v?.ToString()?.Trim() ?? "" : "";
        var ids = rows.Where(r => Text(r, "CertificationStatus") == "6").Select(r => Text(r, "ZedId")).Where(z => z.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (ids.Count == 0) return;
        try
        {
            var waiting = await db.QuerySqlAsync<WaitingRow>(WaitingSql, new { ZedIds = ids }, ct);
            foreach (var r in rows)
            {
                var w = waiting.FirstOrDefault(x => string.Equals(x.ZedId?.Trim(), Text(r, "ZedId"), StringComparison.OrdinalIgnoreCase)
                    && string.Equals(x.Certification?.Trim(), Text(r, "Certification"), StringComparison.OrdinalIgnoreCase));
                if (w is not null && Text(r, "CertificationStatus") == "6") r[Field] = ModeOf(w.Flow);
            }
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "The units without a desktop step could not be marked");
        }
    }

    public static async Task<bool> TryAsync(ISqlExecutor db, string zedId, string level, ILogger log, CancellationToken ct)
    {
        try
        {
            var sets = await db.QueryProcMultipleAsync(Procedure, new { ZedId = zedId, Certification = level }, ct);
            var row = sets.Count > 0 && sets[0].Count > 0 ? sets[0][0] : null;
            var skipped = row is not null && row.TryGetValue("Skipped", out var v) && (v is true || (v is not null && v.ToString() == "1"));
            if (skipped) log.LogInformation("{ZedId} {Level}: no desktop step, straight to the site assessment", zedId, level);
            return skipped;
        }
        catch (DbException ex)
        {
            log.LogError(ex, "Desktop skip of {ZedId} {Level} failed (is migration 0074 applied?)", zedId, level);
            return false;
        }
    }
}
