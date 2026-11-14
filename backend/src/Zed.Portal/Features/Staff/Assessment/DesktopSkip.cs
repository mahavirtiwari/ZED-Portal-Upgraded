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
