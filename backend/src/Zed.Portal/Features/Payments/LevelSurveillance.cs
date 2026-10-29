using System.Data.Common;
using Zed.Core.Data;

namespace Zed.Portal.Features.Payments;

/// <summary>
/// Surveillance of V4 levels (ZED-X; migrations 0032 / 0033). The legacy procedures that open, price and record a
/// surveillance name Bronze, Silver and Gold; for the other levels:
/// <list type="bullet">
/// <item>whether the unit may pay now (<see cref="StatusSql"/>): certified (status 16), a surveillance round opened by
/// SP_V4_LEVEL_SURVEILLANCE_SCHEDULE (EnableSurveillance1), not expired or withdrawn, and Msme.IsSur{Level}PaymentDone not
/// set; the dashboard shows the SURVEILLANCE box from the same row, as SP_MSME_GET_DETAILS's {Level}DashboardSurStatus;</item>
/// <item>after a recorded payment, ZED_SURVEILLANCE's SP_V4_SURVEILLANCE_PAID (payment flags, NIC sector-wise questionnaire,
/// minimum parameters), which the legacy payment procedures do not do for these levels.</item>
/// </list>
/// The fee rows are ZED_SURVEILLANCE's AssessmentFee rows of the level (0033: Gold's, Rs. 25,000).
/// </summary>
public static class LevelSurveillance
{
    public static bool IsV4(string level) => Certifications.CanonicalApplicable(level) is { } c && !Certifications.Paid.Contains(c);

    public sealed record StatusRow(int? Round, string? Phase, bool Paid);

    /// <summary>The level comes from <see cref="Certifications.Applicable"/> only, so it can name the payment column.</summary>
    internal static string StatusSql(string level) =>
        $"SELECT TOP 1 C.EnableSurveillance1 AS Round, C.CertificationPhase AS Phase, CAST(ISNULL(M.IsSur{level}PaymentDone, 0) AS bit) AS Paid " +
        "FROM dbo.MsmeCertifications C JOIN dbo.Msme M ON M.ZedId = C.ZedId " +
        "WHERE C.ZedId = @ZedId AND C.Certification = @Level AND C.CertificationStatus = 16 AND C.SaCertificateNo IS NOT NULL ORDER BY C.Id DESC;";

    /// <summary>The surveillance box: 1 once a round is open on a live certificate (as {Level}DashboardSurStatus), else 0.</summary>
    public static int DashboardStatus(StatusRow? r) =>
        r is { Round: >= 1 } && r.Phase is not ("EXPIRED" or "WITHDRAWN") ? 1 : 0;

    /// <summary>The surveillance fee can be paid now.</summary>
    public static bool PaymentOpen(StatusRow? r) => DashboardStatus(r) == 1 && !r!.Paid;

    public static async Task<StatusRow?> StatusAsync(ISqlExecutor db, string zedId, string level, ILogger log, CancellationToken ct)
    {
        if (!IsV4(level)) return null;
        try
        {
            return (await db.QuerySqlAsync<StatusRow>(StatusSql(Certifications.CanonicalApplicable(level)!), new { ZedId = zedId, Level = level }, ct))
                .FirstOrDefault();
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Surveillance status of {ZedId} {Level} not read (are migrations 0029 / 0032 applied?)", zedId, level);
            return null;
        }
    }

    internal const string PaidSql = "EXEC ZED_SURVEILLANCE.dbo.SP_V4_SURVEILLANCE_PAID @ZedId = @ZedId, @Certification = @Certification;";

    /// <summary>After a recorded surveillance payment of a V4 level; a failure is logged and does not undo the payment.</summary>
    public static async Task PaidAsync(ISqlExecutor db, string zedId, string level, ILogger log, CancellationToken ct)
    {
        if (!IsV4(level)) return;
        try
        {
            await db.ExecuteSqlAsync(PaidSql, new { ZedId = zedId, Certification = level }, ct);
        }
        catch (DbException ex)
        {
            log.LogError(ex, "SP_V4_SURVEILLANCE_PAID failed for {ZedId}/{Level} (is migration 0033 applied?)", zedId, level);
        }
    }
}
