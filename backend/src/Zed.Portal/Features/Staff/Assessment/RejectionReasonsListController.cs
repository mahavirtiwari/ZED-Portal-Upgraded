using Microsoft.AspNetCore.Mvc;
using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Assessment;

/// <summary>2026-11-19: the reasons an agency picks when it rejects an allotment (the active ones of Admin → Rejection Reasons).</summary>
[PortalSystems(PortalSystem.Main, PortalSystem.Surveillance)]
[Route("api/staff/assessment/rejection-reasons")]
[StaffRoles(UserRole.Agency, UserRole.MasterAdmin)]
public sealed class RejectionReasonsListController(AgencyRejections rejections) : StaffApiController
{
    public sealed record ReasonOption(string Id, string Text, bool AutoReallot);

    [HttpGet]
    public async Task<IReadOnlyList<ReasonOption>> Get(CancellationToken ct) =>
        (await rejections.ReasonsAsync(ct)).Where(r => r.Active).Select(r => new ReasonOption(r.Id, r.Text, r.AutoReallot)).ToList();
}
