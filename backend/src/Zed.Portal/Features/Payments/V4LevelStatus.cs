using System.Data.Common;
using Zed.Core.Data;

namespace Zed.Portal.Features.Payments;

/// <summary>
/// The status of a V4 level (ZED-X and the levels the Admin added; 2026-11-08) for a unit, as SP_MSME_GET_DETAILS gives the
/// three: the certification row's status once there is one, else the payment flag Msme.Is{Code}PaymentDone (0 / 1).
/// ZED-X keeps its own query (<see cref="Msme.MsmeDashboardController.ZedXSql"/>); another level reads its own column, and
/// when that column is not there yet (added by the next update) the certification row only.
/// </summary>
public static class V4LevelStatus
{
    public sealed record Row(int PaymentDone, int? Status)
    {
        /// <summary>What the dashboard shows as {Code}Status.</summary>
        public int Value => Status ?? PaymentDone;
    }

    /// <summary>The query of a V4 level other than ZED-X (its code is letters and digits, from the registry).</summary>
    internal static string Sql(string level) =>
        $"SELECT CAST(ISNULL(m.[Is{level}PaymentDone], 0) AS int) AS PaymentDone, " +
        "(SELECT TOP 1 c.CertificationStatus FROM dbo.MsmeCertifications c WHERE c.ZedId = m.ZedId AND c.Certification = @Level ORDER BY c.Id DESC) AS Status " +
        "FROM dbo.Msme m WHERE m.ZedId = @ZedId;";

    /// <summary>The same without the payment flag (its column is not there yet).</summary>
    internal const string StatusOnlySql =
        "SELECT 0 AS PaymentDone, (SELECT TOP 1 c.CertificationStatus FROM dbo.MsmeCertifications c WHERE c.ZedId = @ZedId AND c.Certification = @Level ORDER BY c.Id DESC) AS Status;";

    public static async Task<Row> ReadAsync(ISqlExecutor db, string zedId, string level, ILogger log, CancellationToken ct)
    {
        if (LevelRegistry.Canonical(level) is not { } code || LevelRegistry.IsLegacy(code)) return new Row(0, null);
        if (code == LevelRegistry.ZedX)
        {
            try
            {
                return (await db.QuerySqlAsync<Row>(Msme.MsmeDashboardController.ZedXSql, new { ZedId = zedId }, ct)).FirstOrDefault() ?? new Row(0, null);
            }
            catch (DbException ex)
            {
                log.LogWarning(ex, "ZED-X status not read (is migration 0029 applied?)");
                return new Row(0, null);
            }
        }
        try
        {
            return (await db.QuerySqlAsync<Row>(Sql(code), new { ZedId = zedId, Level = code }, ct)).FirstOrDefault() ?? new Row(0, null);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Payment flag of level {Level} not read (is its column there yet?); its certification row is used", code);
            try
            {
                return (await db.QuerySqlAsync<Row>(StatusOnlySql, new { ZedId = zedId, Level = code }, ct)).FirstOrDefault() ?? new Row(0, null);
            }
            catch (DbException ex2)
            {
                log.LogWarning(ex2, "Status of level {Level} not read", code);
                return new Row(0, null);
            }
        }
    }
}
