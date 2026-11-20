using System.Data.Common;
using Zed.Core.Data;
using Zed.Core.Security;
using Zed.Portal.Features.Incentives.Staff;
using static Zed.Portal.Features.Incentives.SchemeApplications;

namespace Zed.Portal.Features.Incentives.Agencies;

/// <summary>
/// 2026-11-20 (the product owner): the incentive verification agencies, kept apart from the assessment agencies. "Desktop and onsite
/// will be done by different assessment agencies and assessors. Agency will be added by master admin in separate manner ... the
/// allocation logic will be based on state and district" — for both stages. dbo.Users RoleId 2 with Users.AgencyKind
/// <see cref="DesktopKind"/> (migration 0107) or <see cref="OnsiteKind"/> (migration 0106), added by the Master Admin on "Incentive
/// Verification Agencies" (<see cref="IncentiveAgenciesController"/>); one kind per agency, so desktop and onsite are always different
/// agencies. Each serves several states and, per state, its districts (dbo.AgencyUserStates: one row per state, Districts = the LGD
/// district codes of that state, NULL / empty = the whole state; no row for the unit's state = not eligible) and the schemes ticked
/// for its kind (Users.SchemeVerification "CODE:D" / "CODE:O"). Their assessment flags are always cleared, so the normal assessments
/// never pick them.
/// <para>
/// At sign-in such an agency, its sub-users and the assessors it created get the pseudo sub-role of its kind (<see cref="DesktopSubRole"/>
/// / <see cref="OnsiteSubRole"/>), so the staff menu and the sub-user screens know the agency kind.
/// </para>
/// </summary>
public static class IncentiveAgencies
{
    /// <summary>Users.AgencyKind of a desktop verification agency (migration 0107). Kept here: the core (SchemeApplications) has the onsite one only.</summary>
    public const string DesktopKind = "SchemeDesktop";
    /// <summary>Users.AgencyKind of an onsite verification agency (migration 0106).</summary>
    public const string OnsiteKind = OnsiteAgencyKind;

    /// <summary>The sub-role carried in the sign-in of a desktop verification agency, its sub-users and its assessors (staff-menu.ts reads it).</summary>
    public const string DesktopSubRole = "SchemeDesktop";
    /// <summary>The sub-role carried in the sign-in of an onsite verification agency, its sub-users and its assessors.</summary>
    public const string OnsiteSubRole = "SchemeOnsite";

    internal const string KindOfSql =
        "SELECT TOP 1 U.RoleId, U.AgencyKind, C.AgencyKind AS CreatorKind FROM dbo.Users U " +
        "LEFT JOIN dbo.Users C ON C.UserId = U.CreatedBy AND C.RoleId = 2 WHERE U.UserId = @UserId;";

    /// <summary>The ids of every incentive verification agency (the normal Assessment Agencies page leaves them out).</summary>
    internal const string IdsSql = "SELECT UserId FROM dbo.Users WHERE RoleId = 2 AND AgencyKind IN ('SchemeDesktop', 'SchemeOnsite');";

    /// <summary>The unit's plant state and district (the allotment of both stages).</summary>
    internal const string UnitPlaceSql =
        "SELECT TOP 1 PStateName, PDistrictName, CAST(PLgDistrictCode AS varchar(20)) AS PLgDistrictCode FROM dbo.Msme WHERE ZedId = @ZedId;";

    /// <summary>The states and districts of the candidate agencies.</summary>
    internal const string StatesSql = "SELECT UserId, States, Districts FROM dbo.AgencyUserStates WHERE RoleId = 2 AND ISNULL(IsActive, 1) = 1 AND UserId IN @Ids;";

    private sealed class KindRow
    {
        public int? RoleId { get; init; }
        public string? AgencyKind { get; init; }
        public string? CreatorKind { get; init; }
    }

    private sealed class IdRow
    {
        public string? UserId { get; init; }
    }

    private sealed class PlaceRow
    {
        public string? PStateName { get; init; }
        public string? PDistrictName { get; init; }
        public string? PLgDistrictCode { get; init; }
    }

    private sealed class StateRow
    {
        public string? UserId { get; init; }
        public string? States { get; init; }
        public string? Districts { get; init; }
    }

    /// <summary>The incentive agency kind of a Users.AgencyKind value (<see cref="DesktopKind"/> / <see cref="OnsiteKind"/>), or null (assessment agency).</summary>
    public static string? KindOf(string? agencyKind)
    {
        var k = agencyKind?.Trim();
        if (string.Equals(k, DesktopKind, StringComparison.OrdinalIgnoreCase)) return DesktopKind;
        if (string.Equals(k, OnsiteKind, StringComparison.OrdinalIgnoreCase)) return OnsiteKind;
        return null;
    }

    public static bool IsOnsite(string? agencyKind) => KindOf(agencyKind) == OnsiteKind;

    public static bool IsDesktop(string? agencyKind) => KindOf(agencyKind) == DesktopKind;

    /// <summary>The scheme tick of a kind: "D" for a desktop agency, "O" for an onsite agency.</summary>
    public static string TickOf(string kind) => kind == OnsiteKind ? SchemeTicks.Onsite : SchemeTicks.Desktop;

    /// <summary>The sign-in sub-role of a kind.</summary>
    public static string SubRoleOf(string kind) => kind == OnsiteKind ? OnsiteSubRole : DesktopSubRole;

    /// <summary>
    /// The extra sub-roles of a signing-in agency (an incentive verification agency) or assessor (created by one): its kind's sub-role or
    /// none. Never fails the sign-in: a database without migration 0106 gives none.
    /// </summary>
    public static async Task<IReadOnlyList<string>> SubRolesAsync(ISqlExecutor db, string userId, int roleId, ILogger log, CancellationToken ct)
    {
        if (roleId is not ((int)UserRole.Agency or (int)UserRole.DesktopAssessor) || string.IsNullOrWhiteSpace(userId)) return [];
        try
        {
            var row = (await db.QuerySqlAsync<KindRow>(KindOfSql, new { UserId = Ansi(userId.Trim(), 50) }, ct)).FirstOrDefault();
            if (row is null) return [];
            var kind = KindOf(roleId == (int)UserRole.Agency ? row.AgencyKind : row.CreatorKind);
            return kind is null ? [] : [SubRoleOf(kind)];
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Agency kind of {UserId} not read (is migration 0106 applied?)", userId);
            return [];
        }
    }

    /// <summary>The incentive verification agencies' ids, both kinds (empty when they cannot be read: before migration 0106).</summary>
    public static async Task<HashSet<string>> IdsAsync(ISqlExecutor db, ILogger log, CancellationToken ct)
    {
        try
        {
            return (await db.QuerySqlAsync<IdRow>(IdsSql, null, ct)).Select(r => r.UserId?.Trim()).OfType<string>().Where(s => s.Length > 0)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Incentive verification agencies not read (is migration 0106 applied?)");
            return new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        }
    }

    /// <summary>Whether a user is an active incentive verification agency of the kind (its Users row).</summary>
    public static async Task<bool> IsAgencyOfKindAsync(ISqlExecutor db, string? userId, string kind, CancellationToken ct) =>
        (await SchemeCases.UserAsync(db, userId, ct)) is { RoleId: 2, IsActive: not false } u && KindOf(u.AgencyKind) == kind;

    /// <summary>The comma list of AgencyUserStates.Districts as a set (empty = the whole state).</summary>
    public static HashSet<string> Districts(string? csv) =>
        (csv ?? "").Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).ToHashSet(StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// Whether a state row covers the unit's district: no districts = the whole state; otherwise the unit's LGD district code
    /// (Msme.PLgDistrictCode) or its district name (Msme.PDistrictName) is listed.
    /// </summary>
    public static bool CoversDistrict(string? districtsCsv, string? lgdCode, string? districtName)
    {
        var list = Districts(districtsCsv);
        if (list.Count == 0) return true;
        var code = lgdCode?.Trim().TrimStart('0') ?? "";
        return (code.Length > 0 && list.Any(d => d.TrimStart('0') == code))
               || (!string.IsNullOrWhiteSpace(districtName) && list.Contains(districtName.Trim()));
    }

    /// <summary>
    /// The candidates (active agencies of one kind, read by the caller) ticked "{code}:{tick}" whose states and districts cover the unit's
    /// plant state and district, in Users.Id order. No NIC-sector rule (the owner: allocation by state and district).
    /// </summary>
    internal static async Task<List<SchemeAllotment.CandidateRow>> CoveringAsync(
        ISqlExecutor db, IEnumerable<SchemeAllotment.CandidateRow> candidates, string tick, string zedId, string schemeCode, CancellationToken ct)
    {
        var ticked = candidates
            .Where(r => !string.IsNullOrWhiteSpace(r.UserId) && SchemeTicks.Has(r.SchemeVerification, schemeCode, tick))
            .GroupBy(r => r.UserId!.Trim(), StringComparer.OrdinalIgnoreCase).Select(g => g.First())
            .OrderBy(r => r.Id).ToList();
        if (ticked.Count == 0) return [];

        var place = (await db.QuerySqlAsync<PlaceRow>(UnitPlaceSql, new { ZedId = Ansi(zedId, 50) }, ct)).FirstOrDefault();
        var state = place?.PStateName?.Trim() ?? "";
        if (state.Length == 0) return [];
        var rows = (await db.QuerySqlAsync<StateRow>(StatesSql, new { Ids = ticked.Select(r => r.UserId!.Trim()).ToArray() }, ct))
            .Where(r => r.UserId is not null).ToLookup(r => r.UserId!.Trim(), StringComparer.OrdinalIgnoreCase);
        // An incentive agency serves only the states (and districts) the Master Admin chose for it: no row = no state.
        return ticked.Where(r => rows[r.UserId!.Trim()].Any(s =>
                string.Equals(s.States?.Trim(), state, StringComparison.OrdinalIgnoreCase)
                && CoversDistrict(s.Districts, place!.PLgDistrictCode, place.PDistrictName)))
            .ToList();
    }
}
