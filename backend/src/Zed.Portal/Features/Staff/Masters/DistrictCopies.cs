using System.Data.Common;
using Zed.Core.Data;

namespace Zed.Portal.Features.Staff.Masters;

/// <summary>
/// One Admin (V4): ZED_CONSULTANT and ZED_SURVEILLANCE each keep a copy of the states and districts, and their payment
/// procedures read their own copy's subsidy flag (Districts.IsAspirationalDt: SP_CONSULTANCY_MSME_GET_PAYMENT_DETAILS of the
/// handholding payment, ZED_SURVEILLANCE's SP_MSME_GET_PAYMENT_DETAILS). The Admin keeps the main database's list
/// (Subsidy Regions, LG Directory), so after a change main's states and districts are copied to the other two: missing ones
/// added, names, active flag and subsidy flag made the same (matched by code). Nothing is deleted there.
/// </summary>
public static class DistrictCopies
{
    public static readonly IReadOnlyList<(string Database, string Name)> Targets = [("ZED_CONSULTANT", "Consultancy"), ("ZED_SURVEILLANCE", "Surveillance")];

    /// <summary>One target's statements as one batch in one transaction: a failure part-way leaves that copy as it was.</summary>
    private static string SyncSql(string target) => $"""
        SET XACT_ABORT ON;
        BEGIN TRANSACTION;
        INSERT INTO {target}.dbo.States (StateCode, StateName, IsActive)
            SELECT LTRIM(RTRIM(m.StateCode)), m.StateName, ISNULL(m.IsActive, 1) FROM ZEDCS_V2_LIVE.dbo.States m
            WHERE NOT EXISTS (SELECT 1 FROM {target}.dbo.States t WHERE LTRIM(RTRIM(t.StateCode)) = LTRIM(RTRIM(m.StateCode)));
        UPDATE t SET StateName = m.StateName
            FROM {target}.dbo.States t JOIN ZEDCS_V2_LIVE.dbo.States m ON LTRIM(RTRIM(m.StateCode)) = LTRIM(RTRIM(t.StateCode))
            WHERE ISNULL(t.StateName, '') <> ISNULL(m.StateName, '');
        INSERT INTO {target}.dbo.Districts (StateCode, StateName, DistrictCode, DistrictName, IsActive, IsAspirationalDt)
            SELECT LTRIM(RTRIM(m.StateCode)), m.StateName, LTRIM(RTRIM(m.DistrictCode)), m.DistrictName, m.IsActive, m.IsAspirationalDt
            FROM ZEDCS_V2_LIVE.dbo.Districts m
            WHERE NULLIF(LTRIM(RTRIM(m.DistrictCode)), '') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM {target}.dbo.Districts t WHERE LTRIM(RTRIM(t.DistrictCode)) = LTRIM(RTRIM(m.DistrictCode)));
        UPDATE t SET DistrictName = m.DistrictName, StateName = m.StateName, IsActive = m.IsActive, IsAspirationalDt = m.IsAspirationalDt
            FROM {target}.dbo.Districts t JOIN ZEDCS_V2_LIVE.dbo.Districts m ON LTRIM(RTRIM(m.DistrictCode)) = LTRIM(RTRIM(t.DistrictCode))
            WHERE ISNULL(t.DistrictName, '') <> ISNULL(m.DistrictName, '') OR ISNULL(t.StateName, '') <> ISNULL(m.StateName, '')
               OR ISNULL(CAST(t.IsActive AS int), 1) <> ISNULL(CAST(m.IsActive AS int), 1)
               OR ISNULL(CAST(t.IsAspirationalDt AS int), 0) <> ISNULL(CAST(m.IsAspirationalDt AS int), 0);
        COMMIT;
        """;

    /// <summary>Main's districts that the copy lacks or has differently (name, active, subsidy flag).</summary>
    private static string DiffSql(string target) => $"""
        SELECT COUNT(*) AS Total FROM ZEDCS_V2_LIVE.dbo.Districts m
        LEFT JOIN {target}.dbo.Districts t ON LTRIM(RTRIM(t.DistrictCode)) = LTRIM(RTRIM(m.DistrictCode))
        WHERE NULLIF(LTRIM(RTRIM(m.DistrictCode)), '') IS NOT NULL
          AND (t.DistrictCode IS NULL OR ISNULL(t.DistrictName, '') <> ISNULL(m.DistrictName, '')
               OR ISNULL(CAST(t.IsActive AS int), 1) <> ISNULL(CAST(m.IsActive AS int), 1)
               OR ISNULL(CAST(t.IsAspirationalDt AS int), 0) <> ISNULL(CAST(m.IsAspirationalDt AS int), 0));
        """;

    internal static readonly IReadOnlyDictionary<string, string> Sync = Targets.ToDictionary(t => t.Database, t => SyncSql(t.Database));
    internal static readonly IReadOnlyDictionary<string, string> Diff = Targets.ToDictionary(t => t.Database, t => DiffSql(t.Database));

    public sealed record CountRow(int Total);

    /// <summary>The portals whose copy is out of step with main (name, districts that differ); a portal not reached is left out.</summary>
    public static async Task<IReadOnlyList<(string Name, int Districts)>> DifferencesAsync(ISqlExecutor db, ILogger log, CancellationToken ct)
    {
        var result = new List<(string, int)>();
        foreach (var (database, name) in Targets)
        {
            try
            {
                var n = (await db.QuerySqlAsync<CountRow>(Diff[database], null, ct)).FirstOrDefault()?.Total ?? 0;
                if (n > 0) result.Add((name, n));
            }
            catch (DbException ex)
            {
                log.LogWarning(ex, "The {Portal} portal's districts could not be compared with main's", name);
            }
        }
        return result;
    }

    /// <summary>Copies main's states and districts to the other two databases; returns the note for the Admin's message.</summary>
    public static async Task<string> CopyAsync(ISqlExecutor db, ILogger log, CancellationToken ct)
    {
        var failed = new List<string>();
        foreach (var (database, name) in Targets)
        {
            try
            {
                await db.ExecuteSqlAsync(Sync[database], null, ct);
            }
            catch (DbException ex)
            {
                log.LogError(ex, "Main's districts were not copied to the {Portal} portal", name);
                failed.Add(name);
            }
        }
        return failed.Count == 0
            ? " The Consultancy and Surveillance portals' districts were updated too."
            : $" The districts of the {string.Join(" and ", failed)} portal{(failed.Count > 1 ? "s" : "")} could not be updated: please ask the administrator.";
    }
}
