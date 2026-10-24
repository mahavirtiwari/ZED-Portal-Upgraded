using Microsoft.AspNetCore.Mvc;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.Dashboard;

namespace Zed.Portal.Features.Msme;

/// <summary>
/// The applicant's change history (<see cref="IMsmeEditHistory"/>, new in V4): every change made in the MSME login on the
/// web and in the MSME app, newest first, paged.
/// </summary>
public static class MsmeEditHistoryResponses
{
    public sealed record EditItem(
        long Id, DateTime At, string Channel, string Action, string Result, string? Message, string? Data, string? IpAddress, string? DeviceId);

    public sealed record EditHistoryResponse(int Total, int PageNo, int PageSize, IReadOnlyList<EditItem> Rows);

    public static readonly int[] PageSizes = [10, 20, 50, 100];

    public static async Task<EditHistoryResponse> PageAsync(IMsmeEditHistory history, string zedId, int pageNo, int pageSize, CancellationToken ct)
    {
        var size = PageSizes.Contains(pageSize) ? pageSize : 10;
        var page = Math.Max(pageNo, 1);
        var (rows, total) = await history.ListAsync(zedId, page, size, ct);
        // At is stored in UTC; marked as such so the browser shows local time.
        return new(total, page, size, rows.Select(r => new EditItem(r.Id, DateTime.SpecifyKind(r.At, DateTimeKind.Utc), r.Channel, r.Action,
            r.Result, r.Message, r.Data, r.IpAddress, r.DeviceId)).ToList());
    }
}

/// <summary>The signed-in MSME's own change history.</summary>
[Route("api/msme/edit-history")]
public sealed class MsmeEditHistoryController(IMsmeEditHistory history) : MsmeApiController
{
    [HttpGet]
    public Task<MsmeEditHistoryResponses.EditHistoryResponse> Get(int pageNo = 1, int pageSize = 10, CancellationToken ct = default) =>
        MsmeEditHistoryResponses.PageAsync(history, ZedId, pageNo, pageSize, ct);
}

/// <summary>An applicant's change history for the overseeing staff, on all three portals (the table is in ZEDCS_V2_LIVE).</summary>
[Route("api/staff/msme-edit-history")]
[StaffRoles(UserRole.MasterAdmin, UserRole.SuperAdmin, UserRole.Ministry, UserRole.CitizenFeedback, UserRole.QC)]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed class StaffMsmeEditHistoryController(IMsmeEditHistory history, ILogger<StaffMsmeEditHistoryController> log) : StaffApiController
{
    [HttpGet("{zedId}")]
    public async Task<ActionResult<MsmeEditHistoryResponses.EditHistoryResponse>> Get(string zedId, int pageNo = 1, int pageSize = 10, CancellationToken ct = default)
    {
        if (!DashboardFilters.IsZedId(zedId)) return this.Problem400("Please enter a valid ZED ID.");
        log.LogInformation("{UserId} viewed the change history of {ZedId}", UserId, zedId);
        return await MsmeEditHistoryResponses.PageAsync(history, zedId.Trim(), pageNo, pageSize, ct);
    }
}
