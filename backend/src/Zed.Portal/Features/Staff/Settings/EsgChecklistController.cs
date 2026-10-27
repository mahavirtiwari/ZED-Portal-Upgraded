using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Zed.Core.Forms;
using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Settings;

/// <summary>
/// Admin → Questionnaire → ESG Checklist (new in V4): the ESG and Social / OHS questions the apps ask at the assessment
/// (GetEsgChecklist), with their options and the follow-up question shown on Yes or on No. Saved per system's database
/// (dbo.V4EsgChecklist, migration 0022); Reset goes back to the standard checklist. Main and Surveillance only:
/// Consultancy's apps have no ESG checklist. The answers already given keep their question texts.
/// </summary>
[Route("api/staff/settings/esg-checklist")]
[StaffRoles(UserRole.Admin)]
[PortalSystems(PortalSystem.Main, PortalSystem.Surveillance)]
public sealed class EsgChecklistController(EsgChecklists checklists, ILogger<EsgChecklistController> log) : StaffApiController
{
    public sealed record EsgChecklistResponse(EsgChecklistDefinition Checklist, bool Customised, string Version, string? UpdatedBy, DateTime? UpdatedOn);

    [HttpGet]
    public async Task<EsgChecklistResponse> Get(CancellationToken ct)
    {
        var c = await checklists.GetAsync(ct);
        return new EsgChecklistResponse(c.Definition, c.Customised, c.Version, c.UpdatedBy, c.UpdatedOn);
    }

    [HttpPut]
    public async Task<ActionResult<MessageResponse>> Save(EsgChecklistDefinition? req, CancellationToken ct)
    {
        var current = await checklists.GetAsync(ct);
        var (checklist, error) = EsgChecklistRules.Check(req, current.Definition, EsgChecklistFormat.Standard);
        if (error is not null) return this.Problem400(error);
        try
        {
            await checklists.Store.SaveAsync(EsgChecklistFormat.ToStore(checklist!), UserId, ct);
        }
        catch (SqlException ex)
        {
            log.LogError(ex, "Could not save the ESG checklist (is migration 0022 applied?)");
            return this.Problem400("The checklist could not be saved. Please ask the administrator to apply database migration 0022.");
        }
        log.LogInformation("ESG checklist saved by {UserId}: {Questions} questions", UserId, checklist!.Sections.Sum(s => s.Questions.Count));
        return new MessageResponse("ESG checklist saved. The apps get it the next time they open the checklist.");
    }

    [HttpDelete]
    public async Task<ActionResult<MessageResponse>> Reset(CancellationToken ct)
    {
        try
        {
            await checklists.Store.ResetAsync(ct);
        }
        catch (SqlException ex)
        {
            log.LogError(ex, "Could not reset the ESG checklist (is migration 0022 applied?)");
            return this.Problem400("The checklist could not be reset. Please ask the administrator to apply database migration 0022.");
        }
        log.LogInformation("ESG checklist reset to the standard one by {UserId}", UserId);
        return new MessageResponse("The standard ESG checklist is used again.");
    }
}
