using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.Assessment;

namespace Zed.Portal.Features.Staff.Settings;

/// <summary>
/// Admin → Rejection Reasons (2026-11-19, approved): the reasons an assessment agency picks when it rejects an allotment, and
/// whether each re-allots the unit automatically or leaves it to the Master Admin (<see cref="RejectionReasons"/>), per system
/// (main and Surveillance) through the portal switch of the main portal.
/// </summary>
[Route("api/staff/settings/rejection-reasons")]
[StaffRoles(UserRole.Admin)]
[PortalSystems(PortalSystem.Main, PortalSystem.Surveillance)]
public sealed class RejectionReasonsController(IPortalSettings settings, ILogger<RejectionReasonsController> log) : StaffApiController
{
    public sealed record ReasonsResponse(IReadOnlyList<RejectionReason> Reasons, IReadOnlyList<string> Actions, bool Customised);

    public sealed record ReasonsRequest(IReadOnlyList<RejectionReason>? Reasons);

    [HttpGet]
    public async Task<ReasonsResponse> Get(CancellationToken ct) =>
        new(await RejectionReasons.LoadAsync(settings, ct), RejectionReasons.Actions,
            !string.IsNullOrWhiteSpace(await settings.GetAsync(RejectionReasons.Key, ct)));

    [HttpPut]
    public async Task<ActionResult<MessageResponse>> Save(ReasonsRequest req, CancellationToken ct)
    {
        if (RejectionReasons.Problem(req.Reasons) is { } problem) return this.Problem400(problem);
        try
        {
            await RejectionReasons.SaveAsync(settings, req.Reasons!, UserId, ct);
        }
        catch (SqlException ex)
        {
            log.LogError(ex, "Could not save the rejection reasons (is migration 0011 applied?)");
            return this.Problem400("The reasons could not be saved. Please ask the administrator to apply database migration 0011.");
        }
        log.LogInformation("Rejection reasons saved by {UserId}: {Count} reasons, {Active} in use", UserId, req.Reasons!.Count, req.Reasons.Count(r => r.Active));
        return new MessageResponse("Rejection reasons saved.");
    }

    [HttpDelete]
    public async Task<ActionResult<MessageResponse>> Reset(CancellationToken ct)
    {
        await settings.SetAsync(RejectionReasons.Key, null, UserId, ct);
        log.LogInformation("Rejection reasons reset to the standard ones by {UserId}", UserId);
        return new MessageResponse("Rejection reasons reset to the standard ones.");
    }
}
