using Dapper;
using Zed.Core.Data;

namespace Zed.Portal.Features.Staff.Users;

/// <summary>
/// 2026-11-18 (the user: "certification level wise numbers allocated to the respective agency ... also for the assessors ...
/// same in the assessment agency login"): how many applications (MsmeCertifications rows) each agency and each assessor has
/// been allotted, per certification level, for the Assessment Agencies list, the assessor lists and the agency's own
/// assessors page (main and Surveillance; each reads its own database's MsmeCertifications). One grouped query per list,
/// never one per row; read-only, no procedure or table is changed.
/// <para>
/// The rules (on the current allotment columns, which the allot procedures overwrite):
/// <list type="bullet">
/// <item><b>Agency allotted</b>: every row whose CertificationBodyUserId is the agency (SP_ASSESSMENT_ALLOT_TO_AGENCY and the
/// auto allotment set it for the desktop stage and it stays for the site stage), current and finished alike, ZedId_D / _R_
/// archived copies included, EXCEPT rows the agency rejected (SP_ASSESSMENT_REJECT_UNIT_FOR_DA / _FOR_SA set
/// ReasonForRejection and leave the row with the agency until the Master Admin re-allots it, which clears the reason).</item>
/// <item><b>Assessor allotted</b>: every row where the assessor is the desktop assessor (DesktopAssessorId, unless the assessor
/// rejected it: DesktopReasonForRejection set, waiting for the agency to re-allot), the lead / site assessor (SiteAssessorId)
/// or the co-assessor (CoAssessorId); a row counts once per assessor even when one person holds two of these roles.</item>
/// <item><b>Completed</b>: certified, as the dashboard counts it: status 16, or 6 with the desktop certificate number
/// (a desktop-only level), and not a rejected copy.</item>
/// <item><b>Rejected</b>: closed without a certificate: status 99 (rejected), 7 / 17 (auto-rejected, NCs not closed in time)
/// or a rejected copy (ZedId_D...).</item>
/// <item><b>In progress</b>: the rest (allotted − completed − rejected).</item>
/// </list>
/// A desktop assessor is no longer counted on a row once that row is re-allotted to another agency (the procedure clears
/// DesktopAssessorId): there is no allotment history table for assessors to count from.
/// </para>
/// </summary>
public static class UserLevelCounts
{
    /// <param name="Code">The level code as stored (Bronze, Silver, Gold, ZEDX, a level the Admin added).</param>
    /// <param name="Name">What pages show (ZED-X for ZEDX).</param>
    public sealed record LevelCount(string Code, string Name, int Allotted, int InProgress, int Completed, int Rejected);

    public sealed class Row
    {
        public string? UserId { get; init; }
        public string? Code { get; init; }
        public int Allotted { get; init; }
        public int Completed { get; init; }
        public int Rejected { get; init; }
    }

    private const string Rejected = "C.CertificationStatus IN (7, 17, 99) OR C.ZedId LIKE '%[_]D%'";
    private const string Completed = "C.ZedId NOT LIKE '%[_]D%' AND (C.CertificationStatus = 16 OR (C.CertificationStatus = 6 AND C.DaCertificateNo IS NOT NULL))";
    private const string Sums =
        $"COUNT(*) AS Allotted, SUM(CASE WHEN {Completed} THEN 1 ELSE 0 END) AS Completed, SUM(CASE WHEN {Rejected} THEN 1 ELSE 0 END) AS Rejected ";

    /// <summary>Per agency and level (all agencies, or the one of @AgencyId). See the class for the rule.</summary>
    public const string AgencySql =
        "SELECT /* agency level counts */ LTRIM(RTRIM(C.CertificationBodyUserId)) AS UserId, LTRIM(RTRIM(C.Certification)) AS Code, " + Sums +
        "FROM dbo.MsmeCertifications C " +
        "WHERE ISNULL(C.CertificationBodyUserId, '') <> '' AND ISNULL(C.ReasonForRejection, '') = '' AND ISNULL(C.Certification, '') <> '' " +
        "AND (@AgencyId IS NULL OR C.CertificationBodyUserId = @AgencyId) " +
        "GROUP BY LTRIM(RTRIM(C.CertificationBodyUserId)), LTRIM(RTRIM(C.Certification));";

    /// <summary>Per assessor and level (all assessors, or those the agency of @AgencyId created). See the class for the rule.</summary>
    public const string AssessorSql =
        "SELECT /* assessor level counts */ A.UserId, LTRIM(RTRIM(C.Certification)) AS Code, " + Sums +
        "FROM dbo.MsmeCertifications C " +
        "CROSS APPLY (SELECT LTRIM(RTRIM(C.DesktopAssessorId)) AS UserId WHERE ISNULL(C.DesktopAssessorId, '') <> '' AND ISNULL(C.DesktopReasonForRejection, '') = '' " +
        "UNION SELECT LTRIM(RTRIM(C.SiteAssessorId)) WHERE ISNULL(C.SiteAssessorId, '') <> '' " +
        "UNION SELECT LTRIM(RTRIM(C.CoAssessorId)) WHERE ISNULL(C.CoAssessorId, '') <> '') A " +
        "WHERE (ISNULL(C.DesktopAssessorId, '') <> '' OR ISNULL(C.SiteAssessorId, '') <> '' OR ISNULL(C.CoAssessorId, '') <> '') " +
        "AND ISNULL(C.Certification, '') <> '' " +
        "AND (@AgencyId IS NULL OR EXISTS (SELECT 1 FROM dbo.Users U WHERE U.UserId = A.UserId AND U.RoleId = 3 AND U.CreatedBy = @AgencyId)) " +
        "GROUP BY A.UserId, LTRIM(RTRIM(C.Certification));";

    /// <summary>The counts of one list, by user id (any case); <see cref="Of"/> gives a user's per level.</summary>
    public sealed class Counts(IReadOnlyList<Row> rows)
    {
        private readonly Dictionary<string, List<Row>> byUser = rows
            .Where(r => !string.IsNullOrWhiteSpace(r.UserId) && !string.IsNullOrWhiteSpace(r.Code))
            .GroupBy(r => r.UserId!.Trim(), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.ToList(), StringComparer.OrdinalIgnoreCase);

        /// <summary>
        /// Every enabled level in the Admin's order (zero when none), then any other level the user has rows of (a disabled
        /// or unknown code), so nothing allotted is hidden.
        /// </summary>
        public IReadOnlyList<LevelCount> Of(string? userId)
        {
            var own = userId is not null && byUser.TryGetValue(userId.Trim(), out var list) ? list : [];
            var byCode = new Dictionary<string, (int Allotted, int Completed, int Rejected)>(StringComparer.OrdinalIgnoreCase);
            foreach (var r in own)
            {
                var code = LevelRegistry.Canonical(r.Code) ?? r.Code!.Trim();
                var t = byCode.GetValueOrDefault(code);
                byCode[code] = (t.Allotted + r.Allotted, t.Completed + r.Completed, t.Rejected + r.Rejected);
            }
            var result = new List<LevelCount>();
            foreach (var level in LevelRegistry.All.Where(l => l.IsEnabled))
                result.Add(Make(level.Code, byCode.GetValueOrDefault(level.Code)));
            foreach (var (code, t) in byCode.OrderBy(k => k.Key, StringComparer.OrdinalIgnoreCase))
                if (!result.Any(x => string.Equals(x.Code, code, StringComparison.OrdinalIgnoreCase)) && t.Allotted > 0)
                    result.Add(Make(code, t));
            return result;
        }

        private static LevelCount Make(string code, (int Allotted, int Completed, int Rejected) t) =>
            new(code, LevelRegistry.NameOf(code), t.Allotted, Math.Max(0, t.Allotted - t.Completed - t.Rejected), t.Completed, t.Rejected);
    }

    /// <summary>Agencies' counts (all, or one agency's); null when they cannot be read (the list still loads, without them).</summary>
    public static Task<Counts?> AgenciesAsync(ISqlExecutor db, string? agencyId, ILogger log, CancellationToken ct) =>
        LoadAsync(db, AgencySql, agencyId, "agencies", log, ct);

    /// <summary>Assessors' counts (all, or those of one agency); null when they cannot be read.</summary>
    public static Task<Counts?> AssessorsAsync(ISqlExecutor db, string? agencyId, ILogger log, CancellationToken ct) =>
        LoadAsync(db, AssessorSql, agencyId, "assessors", log, ct);

    private static async Task<Counts?> LoadAsync(ISqlExecutor db, string sql, string? agencyId, string what, ILogger log, CancellationToken ct)
    {
        try
        {
            var agency = string.IsNullOrWhiteSpace(agencyId) ? null : new DbString { Value = agencyId.Trim(), IsAnsi = true, Length = 50 };
            return new Counts(await db.QuerySqlAsync<Row>(sql, new { AgencyId = agency }, ct));
        }
        catch (System.Data.Common.DbException ex)
        {
            log.LogWarning(ex, "Level-wise allotment counts of the {What} not read", what);
            return null;
        }
    }
}
