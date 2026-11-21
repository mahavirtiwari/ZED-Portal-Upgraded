using Microsoft.AspNetCore.Mvc;
using Zed.Core.Assessment;
using Zed.Core.Http;

namespace Zed.Main.MobileApi.Controllers;

/// <summary>
/// 2026-11-21 (the product owner): an assessor does one onsite assessment at a time. Starting a unit's assessment in the app
/// (the daily attendance, the opening meeting) is refused while another onsite assessment allotted to the assessor (main's or
/// the Surveillance portal's) covers today with its days (its assessment date and the level's man-days,
/// <see cref="AssessorBusyDays"/>).
/// </summary>
public sealed partial class SAController
{
    /// <summary>The refusal when another onsite assessment of <paramref name="saId"/> covers today; null when free.</summary>
    private async Task<IActionResult?> BusyElsewhereAsync(string? saId, string? zedId, string? level, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(saId)) return null;
        var today = DateTime.Today;
        var source = portal.System == PortalSystem.Surveillance ? AssessorBusyDays.SurveillanceSource : AssessorBusyDays.MainSource;
        var busy = await AssessorBusyDays.ForAsync(db, saId, today, today, source, zedId, level, log, ct);
        if (busy.Count == 0) return null;
        log.LogWarning("Assessor {SaId} refused to start {ZedId}/{Level}: busy with {Other}/{OtherLevel} ({Source}) on {Days}",
            saId, zedId, level, busy[0].ZedId, busy[0].Certification, busy[0].Source, busy[0].Days);
        return Fail(AssessorBusyDays.StartRefusal(busy[0]));
    }
}
