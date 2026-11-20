using System.Data.Common;
using Zed.Core.Data;
using Zed.Core.Security;
using static Zed.Portal.Features.Incentives.SchemeApplications;

namespace Zed.Portal.Features.Incentives.Onsite;

/// <summary>
/// 2026-11-20 (the user, phase 2 of the incentive schemes): the onsite verification agencies (dbo.Users RoleId 2 with
/// <see cref="OnsiteAgencyKind"/>, migration 0106), added by the Master Admin on their own page. They serve only the onsite
/// verification of Desktop + Onsite schemes, by state and district (dbo.AgencyUserStates: one row per state, Districts = the
/// LGD district codes of that state, NULL / empty = the whole state); never the normal assessments.
/// <para>
/// At sign-in an onsite agency and the assessors it created get the pseudo sub-role <see cref="SubRole"/> (with none of the
/// verification sub-roles, as their flags are cleared), so the staff menu and the sub-user screens know the agency kind.
/// </para>
/// </summary>
public static class OnsiteAgencies
{
    /// <summary>The sub-role carried in the sign-in of an onsite agency, its sub-users and its assessors (staff-menu.ts reads it).</summary>
    public const string SubRole = "SchemeOnsite";

    internal const string KindOfSql =
        "SELECT TOP 1 U.RoleId, U.AgencyKind, C.AgencyKind AS CreatorKind FROM dbo.Users U " +
        "LEFT JOIN dbo.Users C ON C.UserId = U.CreatedBy AND C.RoleId = 2 WHERE U.UserId = @UserId;";

    /// <summary>The ids of every onsite agency (the normal Assessment Agencies page leaves them out).</summary>
    internal const string IdsSql = "SELECT UserId FROM dbo.Users WHERE RoleId = 2 AND AgencyKind = 'SchemeOnsite';";

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

    public static bool IsOnsite(string? kind) => string.Equals(kind?.Trim(), OnsiteAgencyKind, StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// The extra sub-roles of a signing-in agency (an onsite agency) or assessor (created by one): [<see cref="SubRole"/>] or none.
    /// Never fails the sign-in: a database without migration 0106 gives none.
    /// </summary>
    public static async Task<IReadOnlyList<string>> SubRolesAsync(ISqlExecutor db, string userId, int roleId, ILogger log, CancellationToken ct)
    {
        if (roleId is not ((int)UserRole.Agency or (int)UserRole.DesktopAssessor) || string.IsNullOrWhiteSpace(userId)) return [];
        try
        {
            var row = (await db.QuerySqlAsync<KindRow>(KindOfSql, new { UserId = Ansi(userId.Trim(), 50) }, ct)).FirstOrDefault();
            if (row is null) return [];
            var onsite = roleId == (int)UserRole.Agency ? IsOnsite(row.AgencyKind) : IsOnsite(row.CreatorKind);
            return onsite ? [SubRole] : [];
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Agency kind of {UserId} not read (is migration 0106 applied?)", userId);
            return [];
        }
    }

    /// <summary>The onsite agencies' ids (empty when they cannot be read: before migration 0106).</summary>
    public static async Task<HashSet<string>> IdsAsync(ISqlExecutor db, ILogger log, CancellationToken ct)
    {
        try
        {
            return (await db.QuerySqlAsync<IdRow>(IdsSql, null, ct)).Select(r => r.UserId?.Trim()).OfType<string>().Where(s => s.Length > 0)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Onsite agencies not read (is migration 0106 applied?)");
            return new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        }
    }

    /// <summary>Whether a user is an onsite agency (its Users row).</summary>
    public static async Task<bool> IsOnsiteAgencyAsync(ISqlExecutor db, string? userId, CancellationToken ct) =>
        (await Staff.SchemeCases.UserAsync(db, userId, ct)) is { IsOnsiteAgency: true, IsActive: not false };

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
}
