using Microsoft.AspNetCore.Mvc;
using Zed.Core.Http;
using Zed.Core.Data;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Dashboard;

/// <summary>
/// Entire history of a ZED ID across certification, handholding and surveillance. Port of
/// MsmeController.History / GetHistory (SP_MSME_GET_ZEDID_ENTIRE_HISTORY). The procedure searches only for
/// RoleId 7, so the screen is for MasterAdmin. The legacy actions had no authentication filter, no page
/// linked to them, and the page posted an empty ViewBag.ZedId; here the ZED ID is searched for explicitly.
/// </summary>
[Route("api/staff/history")]
[StaffRoles(UserRole.MasterAdmin)]
public sealed class ZedIdHistoryController(ISqlExecutor db, ILogger<ZedIdHistoryController> log) : StaffApiController
{
    public static readonly string[] Columns =
        ["Source_DB", "ZedId", "Description", "CreatedDate", "CertificationType", "StatusType", "MiletoneNo"];

    [HttpGet("{zedId}")]
    public async Task<ActionResult<List<Dictionary<string, object?>>>> Get(string zedId, CancellationToken ct)
    {
        // Letters and digits only: the procedure builds LIKE @SearchZedID + '[_]%', so '%' would match every unit.
        if (!DashboardFilters.IsZedId(zedId)) return this.Problem400("Please enter a valid ZED ID.");

        var sets = await db.QueryProcMultipleAsync("SP_MSME_GET_ZEDID_ENTIRE_HISTORY",
            new { UserId, RoleId = RoleId.ToString(), SearchZedID = zedId.Trim() }, ct);
        log.LogInformation("{UserId} viewed the history of {ZedId}", UserId, zedId);
        return DashboardFilters.Pick(sets[0], Columns);
    }
}
