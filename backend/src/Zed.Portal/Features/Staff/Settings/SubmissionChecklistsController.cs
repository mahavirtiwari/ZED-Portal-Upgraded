using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Zed.Core.Assessment;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Settings;

/// <summary>
/// Admin → Submission checklists (2026-11-17, approved): the items ticked before the assessor's (consultant's) final submit and the
/// agency's (consultant organisation's) quality-check approval, per system in its own dbo.V4Settings (<see cref="SubmissionChecklists"/>).
/// The Admin manages the Consultancy and Surveillance portals' lists from the main portal through the portal switch.
/// </summary>
[Route("api/staff/settings/submission-checklists")]
[StaffRoles(UserRole.Admin)]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed class SubmissionChecklistsController(IPortalSettings settings, PortalHost host, ILogger<SubmissionChecklistsController> log) : StaffApiController
{
    /// <param name="Customised">False while the standard items are in use (nothing saved yet).</param>
    public sealed record ChecklistView(string Code, string Title, string Who, IReadOnlyList<string> Stages, IReadOnlyList<ChecklistItem> Items, bool Customised);

    public sealed record ChecklistsResponse(IReadOnlyList<ChecklistView> Checklists);

    public sealed record ItemsRequest(IReadOnlyList<ChecklistItem>? Items);

    [HttpGet]
    public async Task<ChecklistsResponse> Get(CancellationToken ct)
    {
        var list = new List<ChecklistView>();
        foreach (var k in SubmissionChecklists.For(host.System))
            list.Add(new ChecklistView(k.Code, k.Title, k.Who, k.Stages, await SubmissionChecklists.LoadAsync(settings, k, ct),
                !string.IsNullOrWhiteSpace(await settings.GetAsync(k.Key, ct))));
        return new ChecklistsResponse(list);
    }

    /// <summary>One checklist's whole list, in order (new items with a key the page made up).</summary>
    [HttpPut("{code}")]
    public async Task<ActionResult<MessageResponse>> Save(string code, ItemsRequest req, CancellationToken ct)
    {
        if (SubmissionChecklists.Kind(host.System, code) is not { } kind) return NotFound();
        if (SubmissionChecklists.Problem(kind, req.Items) is { } problem) return this.Problem400(problem);
        try
        {
            await SubmissionChecklists.SaveAsync(settings, kind, req.Items!, UserId, ct);
        }
        catch (SqlException ex)
        {
            log.LogError(ex, "Could not save the {Checklist} checklist (is migration 0011 applied?)", kind.Code);
            return this.Problem400("The checklist could not be saved. Please ask the administrator to apply database migration 0011.");
        }
        log.LogInformation("{Checklist} checklist saved by {UserId}: {Count} items, {Active} in use", kind.Code, UserId, req.Items!.Count, req.Items.Count(i => i.Active));
        return new MessageResponse($"{kind.Title} checklist saved.");
    }

    /// <summary>Back to the standard items.</summary>
    [HttpDelete("{code}")]
    public async Task<ActionResult<MessageResponse>> Reset(string code, CancellationToken ct)
    {
        if (SubmissionChecklists.Kind(host.System, code) is not { } kind) return NotFound();
        await settings.SetAsync(kind.Key, null, UserId, ct);
        log.LogInformation("{Checklist} checklist reset to the standard items by {UserId}", kind.Code, UserId);
        return new MessageResponse($"{kind.Title} checklist reset to the standard items.");
    }
}
