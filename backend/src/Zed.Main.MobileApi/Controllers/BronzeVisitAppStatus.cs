using System.Data.Common;
using Zed.Core.Data;
using Zed.Main.MobileApi.Models;

namespace Zed.Main.MobileApi.Controllers;

/// <summary>
/// 2026-11-15 (approved design docs/designs/msme-app-bronze-with-visit.html): a Bronze whose assessment has a visit (the
/// Admin gave Bronze a flow with an onsite or remote assessment, migration 0078) shows the visit's own steps in the MSME app,
/// as Silver does. SP_APP_MSME_STATUS / SP_APP_MSME_CHECK_LOGIN give Bronze its desktop scale (2 in progress, 3 certified);
/// for a Bronze record that is not on the desktop path its card takes Silver's scale instead: 2 desktop step, 3 visit
/// (status &gt; 8), 4 certified (&gt; 15), with the remote assessment's status as Silver's (1 on the day, 2 after), and
/// <c>assessmentMode</c> "Site". A Bronze on the desktop path (certified at the desktop, or a Desktop-only Bronze before its
/// desktop final submit or rejected there) keeps its values and gets "Desktop", so a unit certified at the desktop never
/// shows a visit step because the flow was changed later (migration 0079's desktop path). Upgraded (5) stays.
/// The visit itself is the existing one: the site assessor app's onsite assessment, or the remote assessment of Silver / Gold.
/// </summary>
internal static class BronzeVisitAppStatus
{
    public const string Desktop = "Desktop";
    public const string Site = "Site";

    public sealed record Row(int CertificationStatus, string? ModeOfAssessment, bool DesktopPath);

    internal const string Sql = """
        SELECT TOP (1) ISNULL(c.CertificationStatus, 0) AS CertificationStatus, c.ModeOfAssessment,
               CAST(CASE WHEN c.DaCertificateNo IS NOT NULL OR (c.CertificationStatus = 6 AND ISNULL(c.CertificationPhase, 'PENDING') NOT IN ('PENDING', 'REJECTED'))
                          OR (dbo.FN_V4_LEVEL_DESKTOP(c.Certification) = 1 AND (c.CertificationStatus < 6 OR c.CertificationStatus IN (7, 99)))
                         THEN 1 ELSE 0 END AS bit) AS DesktopPath
        FROM dbo.MsmeCertifications c
        WHERE c.ZedId = @ZedId AND c.Certification = 'Bronze'
        ORDER BY c.Id DESC;
        """;

    /// <summary>The unit's Bronze record, or null (none, or migration 0078 not applied: Bronze then stays as it is).</summary>
    public static async Task<Row?> ReadAsync(ISqlExecutor db, string? zedId, ILogger log, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(zedId)) return null;
        try
        {
            return (await db.QuerySqlAsync<Row>(Sql, new { ZedId = zedId }, ct)).FirstOrDefault();
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Bronze assessment path not read for {ZedId} (is migration 0078 applied?)", zedId);
            return null;
        }
    }

    /// <summary>Silver's card value for a Bronze with a visit; the procedure's value kept for upgraded (5) and before the final submit.</summary>
    public static int VisitStatus(int procedureValue, int certificationStatus) =>
        procedureValue == 5 ? 5
        : certificationStatus > 15 ? 4
        : certificationStatus > 8 ? 3
        : certificationStatus >= 2 ? 2
        : procedureValue;

    /// <summary>Silver's remote status (SP_APP_MSME_STATUS SilverRemoteStatus): 1 on the remote assessment's day (9), 2 after.</summary>
    public static string RemoteStatus(Row row) =>
        string.Equals(row.ModeOfAssessment?.Trim(), "Remote Assessment", StringComparison.OrdinalIgnoreCase)
            ? row.CertificationStatus > 9 ? "2" : row.CertificationStatus == 9 ? "1" : "0"
            : "0";

    /// <summary>Applies the Bronze record's path to the app's Bronze details (<paramref name="withRemote"/>: GetMsmeStatus's remote field).</summary>
    public static void Apply(CertificationDetails? bronze, Row? row, bool withRemote)
    {
        if (bronze is null || row is null) return;
        if (row.DesktopPath)
        {
            bronze.assessmentMode = Desktop;
            return;
        }
        bronze.assessmentMode = Site;
        bronze.status = VisitStatus(bronze.status, row.CertificationStatus);
        if (withRemote) bronze.remoteStatus = RemoteStatus(row);
    }

    public static async Task ApplyAsync(ISqlExecutor db, string? zedId, MsmeStatus status, bool withRemote, ILogger log, CancellationToken ct) =>
        Apply(status.bronze, await ReadAsync(db, zedId, log, ct), withRemote);
}
