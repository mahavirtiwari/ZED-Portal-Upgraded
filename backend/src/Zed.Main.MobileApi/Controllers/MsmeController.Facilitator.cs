using System.Data.Common;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Mobile;
using Zed.Main.MobileApi.Models;

namespace Zed.Main.MobileApi.Controllers;

/// <summary>
/// 2026-11-14 (approved): "Were you assisted by a ZED Facilitator?" = Yes on Documents Upload no longer asks the facilitator's
/// phone and e-mail: the applicant picks one of the agencies allowed for the level (searchable list), and its final submit
/// allots the case straight to that agency (SP_ASSESSMENT_ALLOT_TO_AGENCY, as the Master Admin's Allot does; the agency then
/// accepts or rejects it in DA Allotment as today). No keeps today's logic (the automatic allotment).
/// The agencies are those the Master Admin could give the case (SP_ASSESSMENT_AGENCIES_TO_ALLOT: active, the unit's state and
/// NIC sector), with the verification type the level needs, not disabled for the level (Users.Allow{Level}Assessments), and
/// assessing the unit's kind (Users.SectorActivity: Manufacturing / Services / Both; not set = no limit).
/// </summary>
public sealed partial class MsmeController
{
    public sealed record FacilitatorAgency(string userId, string userName);

    /// <summary>The agencies the applicant may choose for the level.</summary>
    [HttpPost]
    [DeviceBound(MobileApps.Msme, "userName")]
    public async Task<IActionResult> GetFacilitatorAgencies(BaseServiceRequest request, CancellationToken ct)
    {
        var zedId = request.userName ?? "";
        if (LevelRegistry.Canonical(request.certificationType?.Trim()) is not { } level) return Fail(InvalidDetails);
        var agencies = await FacilitatorAgenciesAsync(zedId, level, ct);
        return LegacyJson(new { status = "1", errorMessage = (string?)null, agencies });
    }

    internal async Task<List<FacilitatorAgency>> FacilitatorAgenciesAsync(string zedId, string level, CancellationToken ct)
    {
        var sets = await db.QueryProcMultipleAsync("SP_ASSESSMENT_AGENCIES_TO_ALLOT", new { ZedId = zedId }, ct);
        IEnumerable<IDictionary<string, object?>> rows = sets.Count > 0 ? sets[0] : [];
        // As the Master Admin's list: desktop levels need the desktop-verification sub-role, the others site verification.
        var column = LevelRegistry.IsDesktop(level) ? "DesktopVerification" : "SiteVerification";
        var disabled = await IdsAsync($"SELECT UserId FROM dbo.Users WHERE RoleId = 2 AND {LevelRegistry.AgencyColumn(level)} = 0;", null, ct);
        var category = await UnitCategoryAsync(zedId, ct);
        var activities = await ActivitiesAsync(ct);
        return rows
            .Where(r => r.Bool(column))
            .Select(r => (Id: r.Text("UserId").Trim(), Name: r.Text("UserName").Trim()))
            .Where(a => a.Id.Length > 0 && !disabled.Contains(a.Id))
            .Where(a => category is null || !activities.TryGetValue(a.Id, out var act) || act is "Both" || act == category)
            .GroupBy(a => a.Id, StringComparer.OrdinalIgnoreCase).Select(g => g.First())
            .OrderBy(a => a.Name, StringComparer.OrdinalIgnoreCase)
            .Select(a => new FacilitatorAgency(a.Id, a.Name)).ToList();
    }

    private async Task<HashSet<string>> IdsAsync(string sql, object? args, CancellationToken ct)
    {
        try
        {
            return (await db.QuerySqlAsync<IdRow>(sql, args, ct)).Select(r => r.UserId?.Trim()).OfType<string>().ToHashSet(StringComparer.OrdinalIgnoreCase);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Agency filter not read (a level column missing?)");
            return new(StringComparer.OrdinalIgnoreCase);
        }
    }

    private sealed record IdRow(string? UserId);
    private sealed record ActivityRow(string? UserId, string? SectorActivity);
    private sealed record UnitRow(string? Activity, string? SectorType);

    private async Task<Dictionary<string, string>> ActivitiesAsync(CancellationToken ct)
    {
        try
        {
            return (await db.QuerySqlAsync<ActivityRow>("SELECT UserId, SectorActivity FROM dbo.Users WHERE RoleId = 2 AND SectorActivity IS NOT NULL;", null, ct))
                .Where(r => !string.IsNullOrWhiteSpace(r.UserId) && !string.IsNullOrWhiteSpace(r.SectorActivity))
                .GroupBy(r => r.UserId!.Trim(), StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.First().SectorActivity!.Trim(), StringComparer.OrdinalIgnoreCase);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Agencies' sector type not read (is migration 0028 applied?)");
            return new(StringComparer.OrdinalIgnoreCase);
        }
    }

    /// <summary>The unit's kind: its NIC sector's type (Masters → Sectors), else its Udyam activity; null when unknown.</summary>
    private async Task<string?> UnitCategoryAsync(string zedId, CancellationToken ct)
    {
        try
        {
            var u = (await db.QuerySqlAsync<UnitRow>(
                "SELECT TOP 1 m.Activity, s.SectorType FROM dbo.Msme m LEFT JOIN dbo.Sectors s ON s.SectorCode = LEFT(LTRIM(m.TwoDigitActivity), 2) WHERE m.ZedId = @ZedId;",
                new { ZedId = zedId }, ct)).FirstOrDefault();
            if (u is null) return null;
            var type = u.SectorType?.Trim();
            if (type is "Manufacturing" or "Services") return type;
            var a = u.Activity?.Trim() ?? "";
            return a.Length == 0 ? null : a.StartsWith("Manuf", StringComparison.OrdinalIgnoreCase) ? "Manufacturing" : "Services";
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Unit kind of {ZedId} not read", zedId);
            return null;
        }
    }
}
