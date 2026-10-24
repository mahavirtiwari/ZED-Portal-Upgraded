using Microsoft.AspNetCore.Mvc;
using Zed.Core.Http;
using Zed.Core.Data;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Dashboard;

/// <summary>
/// Customer (ZED ID) history across certification, handholding and surveillance: the MsmeHistory rows of the three
/// databases. Port of MsmeController.History / GetHistory (SP_MSME_GET_ZEDID_ENTIRE_HISTORY, main only, which answers
/// RoleId 7 only). V4 runs the procedure's query itself, so the screen is on all three portals and for the dashboard
/// logins too (SuperAdmin, CitizenFeedback, QC) besides the MasterAdmin; the three-part names get the database prefix
/// like all inline SQL. The legacy actions had no authentication filter, no page linked to them, and the page posted an
/// empty ViewBag.ZedId; here the ZED ID is searched for explicitly.
/// </summary>
[Route("api/staff/history")]
[StaffRoles(UserRole.MasterAdmin, UserRole.SuperAdmin, UserRole.CitizenFeedback, UserRole.QC)]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed class ZedIdHistoryController(ISqlExecutor db, ILogger<ZedIdHistoryController> log) : StaffApiController
{
    public static readonly string[] Columns =
        ["Source_DB", "ZedId", "Description", "CreatedDate", "CertificationType", "StatusType", "MiletoneNo"];

    /// <summary>The query of SP_MSME_GET_ZEDID_ENTIRE_HISTORY (the ZED ID and its _DEL / _D_&lt;id&gt; copies).</summary>
    internal const string HistorySql = """
        SELECT Source_DB, ZedId, [Description], CreatedDate, CertificationType, StatusType, MiletoneNo FROM (
            SELECT 'CERTIFICATION' AS Source_DB, ZedId, Descrip AS [Description], CreatedDate, CertificationType, StatusType,
                   CAST('' AS varchar(50)) AS MiletoneNo
            FROM ZEDCS_V2_LIVE.dbo.MsmeHistory WITH (NOLOCK) WHERE ZedId = @ZedId OR ZedId LIKE @ZedId + '[_]%'
            UNION ALL
            SELECT 'HANDHOLDING', ZedId, Descrip, CreatedDate, CertificationType, StatusType, CAST(NcCount AS varchar(50))
            FROM ZED_CONSULTANT.dbo.MsmeHistory WITH (NOLOCK) WHERE ZedId = @ZedId OR ZedId LIKE @ZedId + '[_]%'
            UNION ALL
            SELECT 'SURVEILLANCE', ZedId, Descrip, CreatedDate, CertificationType, StatusType, CAST('' AS varchar(50))
            FROM ZED_SURVEILLANCE.dbo.MsmeHistory WITH (NOLOCK) WHERE ZedId = @ZedId OR ZedId LIKE @ZedId + '[_]%'
        ) h ORDER BY CreatedDate ASC;
        """;

    public sealed record HistoryRow(
        string? Source_DB, string? ZedId, string? Description, DateTime? CreatedDate, string? CertificationType, string? StatusType, string? MiletoneNo);

    [HttpGet("{zedId}")]
    public async Task<ActionResult<List<Dictionary<string, object?>>>> Get(string zedId, CancellationToken ct)
    {
        // Letters and digits only: the query uses LIKE @ZedId + '[_]%', so '%' would match every unit.
        if (!DashboardFilters.IsZedId(zedId)) return this.Problem400("Please enter a valid ZED ID.");

        var rows = await db.QuerySqlAsync<HistoryRow>(HistorySql, new { ZedId = zedId.Trim() }, ct);
        log.LogInformation("{UserId} viewed the history of {ZedId}", UserId, zedId);
        // The procedure's column names, as the page reads them.
        return rows.Select(r => new Dictionary<string, object?>
        {
            [Columns[0]] = r.Source_DB, [Columns[1]] = r.ZedId, [Columns[2]] = r.Description, [Columns[3]] = r.CreatedDate,
            [Columns[4]] = r.CertificationType, [Columns[5]] = r.StatusType, [Columns[6]] = r.MiletoneNo,
        }).ToList();
    }
}
