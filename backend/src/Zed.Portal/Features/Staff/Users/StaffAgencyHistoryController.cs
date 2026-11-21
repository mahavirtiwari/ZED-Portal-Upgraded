using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Users;

/// <summary>
/// 2026-11-17 (approved staff redesign, the history side panel): every block and unblock of an assessment agency /
/// Consultant Organisation, latest first, as <c>StaffAssessorsController.History</c> gives an assessor's. The blocks and
/// unblocks of the agencies page are recorded already (<see cref="StaffUserActions"/>, <see cref="UserBlockHistory"/>);
/// scoped exactly like the agency's block (<see cref="StaffAgenciesController"/>: MasterAdmin, an agency it can manage).
/// </summary>
[Route("api/staff/users/agencies")]
[StaffRoles(UserRole.MasterAdmin)]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy)]
public sealed class StaffAgencyHistoryController(ISqlExecutor db, ILogger<StaffAgencyHistoryController> log) : StaffApiController
{
    [HttpGet("{userId}/history")]
    public async Task<ActionResult<IReadOnlyList<UserBlockHistory.Entry>>> History(string userId, CancellationToken ct)
    {
        var agency = await StaffUserRules.LoadAsync(db, userId, UserRole.Agency, ct);
        if (agency is null || !StaffUserRules.CanManage(CurrentUser, agency, UserRole.Agency)) return NotFound();
        // 2026-11-21: the account's whole history (creation, profile edits, links, blocks), its allotments merged in.
        return (await UserBlockHistory.ListAsync(db, agency.UserId, log, ct, UserBlockHistory.Allotments.Agency)).ToList();
    }
}
