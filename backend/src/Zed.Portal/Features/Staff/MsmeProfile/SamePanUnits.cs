using System.Data.Common;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Portal.Features.Staff.Assessment;
using Zed.Portal.Features.Staff.Tat;

namespace Zed.Portal.Features.Staff.MsmeProfile;

/// <summary>
/// 2026-11-22 (the product owner: "show the number of units registered in the same PAN with a clickable ... in case of master
/// admin and operation admin in pop-up also show ZED ID, current status and which one is duplicate"): the count of the other
/// units of a unit's PAN for a list (Monitoring), and, for the Master Admin and its operation admins, each unit's ZED ID, its
/// current status and whether it is a duplicate. A duplicate is the old portal's rule (SP_MSME_DUPLICATE_UDYAM_PADDRESS_COUNTS_UPDATE,
/// Msme.SameUdyamAddress): the same Udyam registration and the same plant address as the unit. Read-only.
/// </summary>
public static class SamePanUnits
{
    /// <summary>Per unit of the list: how many other ZED units are registered with its PAN (units without a PAN are left out).</summary>
    public const string CountsSql =
        "SELECT LTRIM(RTRIM(b.ZedId)) AS ZedId, " +
        "(SELECT COUNT(DISTINCT o.ZedId) FROM dbo.MsmeBasicInformation o WHERE LTRIM(RTRIM(o.PanNo)) = LTRIM(RTRIM(b.PanNo)) AND o.ZedId <> b.ZedId) AS Others " +
        "FROM dbo.MsmeBasicInformation b WHERE b.ZedId IN @Ids AND NULLIF(LTRIM(RTRIM(b.PanNo)), '') IS NOT NULL;";

    /// <summary>The latest assessment row of each unit (not a rejected copy), for its current status.</summary>
    public const string StatusSql =
        "SELECT LTRIM(RTRIM(C.ZedId)) AS ZedId, C.Certification, C.CertificationStatus, C.Id FROM dbo.MsmeCertifications C " +
        "WHERE C.ZedId IN @Ids AND CHARINDEX('_', C.ZedId) = 0;";

    public sealed record CountRow(string? ZedId, int Others);

    public sealed record StatusRow(string? ZedId, string? Certification, int? CertificationStatus, long Id);

    /// <summary>Other units of the same PAN by (base) ZED ID; empty when not readable (the list still loads).</summary>
    public static async Task<IReadOnlyDictionary<string, int>> CountsAsync(ISqlExecutor db, IEnumerable<string?> zedIds, ILogger log, CancellationToken ct)
    {
        var ids = zedIds.Where(z => !string.IsNullOrWhiteSpace(z)).Select(z => AssessmentInput.BaseZedId(z!.Trim()))
            .Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (ids.Count == 0) return new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        try
        {
            var result = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            // A few hundred ids per query (SQL Server allows 2100 parameters).
            foreach (var chunk in ids.Chunk(500))
                foreach (var r in await db.QuerySqlAsync<CountRow>(CountsSql, new { Ids = chunk }, ct))
                    if (r.ZedId is { Length: > 0 } z) result[z] = Math.Max(result.GetValueOrDefault(z), r.Others);
            return result;
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Same-PAN counts not read");
            return new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        }
    }

    /// <summary>"Silver · Desktop assessment in progress" (the TAT page's status names); "Registered" without an assessment row.</summary>
    public static async Task<IReadOnlyDictionary<string, string>> StatusesAsync(ISqlExecutor db, PortalSystem system, IReadOnlyCollection<string> zedIds,
        ILogger log, CancellationToken ct)
    {
        var result = zedIds.ToDictionary(z => z, _ => "Registered", StringComparer.OrdinalIgnoreCase);
        if (zedIds.Count == 0) return result;
        try
        {
            foreach (var g in (await db.QuerySqlAsync<StatusRow>(StatusSql, new { Ids = zedIds.ToList() }, ct))
                         .Where(r => r.ZedId is { Length: > 0 }).GroupBy(r => r.ZedId!, StringComparer.OrdinalIgnoreCase))
            {
                var latest = g.OrderByDescending(r => r.Id).First();
                var code = latest.CertificationStatus?.ToString(System.Globalization.CultureInfo.InvariantCulture);
                var name = code is null ? null : TatCatalog.Find(system, code)?.Name;
                var level = LevelRegistry.NameOf(latest.Certification);
                result[g.Key] = string.Join(" · ", new[] { level, name ?? (code is null ? null : $"Status {code}") }.Where(s => !string.IsNullOrWhiteSpace(s)));
            }
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Current statuses of the same-PAN units not read");
        }
        return result;
    }

    /// <summary>The old portal's duplicate: the same Udyam registration and the same plant address (trimmed, any case).</summary>
    public static bool IsDuplicate(string? udyam, string? plantAddress, string? ofUdyam, string? ofPlantAddress) =>
        !string.IsNullOrWhiteSpace(udyam) && !string.IsNullOrWhiteSpace(plantAddress)
        && string.Equals(udyam.Trim(), ofUdyam?.Trim(), StringComparison.OrdinalIgnoreCase)
        && string.Equals(Squash(plantAddress), Squash(ofPlantAddress), StringComparison.OrdinalIgnoreCase);

    private static string Squash(string? s) => string.Join(' ', (s ?? "").Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
}
