using Microsoft.AspNetCore.Mvc;
using Zed.Core.Assessment;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.Assessment;

namespace Zed.Portal.Features.Staff.Quality;

/// <summary>
/// 2026-11-17 (approved): the submission checklists as the final-submit pop-ups ask them (the items of a checklist at a stage) and
/// the ticks recorded with an assessment's (milestone's) submissions, shown on its review pages. The Admin keeps the items
/// (<see cref="Settings.SubmissionChecklistsController"/>); each final submit checks the ticks itself.
/// </summary>
[Route("api/staff/submission-checklists")]
[StaffRoles(UserRole.MasterAdmin, UserRole.Agency, UserRole.DesktopAssessor, UserRole.SuperAdmin, UserRole.Ministry)]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed class SubmissionChecklistController(ISqlExecutor db, IPortalSettings settings, PortalHost host, ILogger<SubmissionChecklistController> log)
    : StaffApiController
{
    public sealed record AskedItem(string Id, string Text);

    public sealed record AskedResponse(string Title, IReadOnlyList<AskedItem> Items);

    public sealed record RecordView(long Id, string Checklist, string Title, string? Stage, int? Round, string? Role, string? ByName, DateTime? At,
        IReadOnlyList<string> Items);

    /// <summary>The items in use of a checklist at a stage (Desktop / Site / Remote / Onsite; none for the handholding ones).</summary>
    [HttpGet("items/{code}")]
    public async Task<ActionResult<AskedResponse>> Items(string code, string? stage, CancellationToken ct)
    {
        if (SubmissionChecklists.Kind(host.System, code) is not { } kind) return NotFound();
        if (stage is not null && kind.Stages.Count > 0 && !kind.Stages.Contains(stage, StringComparer.OrdinalIgnoreCase)) return this.Problem400("Invalid stage.");
        var items = await SubmissionChecklists.AskedAsync(settings, kind, kind.Stages.Count == 0 ? null : stage, ct);
        return new AskedResponse(kind.Title, items.Select(i => new AskedItem(i.Id, i.Text)).ToList());
    }

    /// <summary>The checklists ticked with the assessment's submissions, latest first.</summary>
    [HttpGet("{zedId}/{certification}")]
    public async Task<ActionResult<IReadOnlyList<RecordView>>> Records(string zedId, string certification, CancellationToken ct)
    {
        if (!AssessmentInput.IsId(zedId) || AssessmentInput.Level(certification) is not { } level) return this.Problem400("Invalid request.");
        var record = await AssessmentRecords.CertificationAsync(db, zedId, level, ct);
        if (record is null || !record.CanView(CurrentUser)) return NotFound();
        try
        {
            var rows = await SubmissionChecklists.RecordsAsync(db, zedId, level, ct);
            return rows.Select(r => new RecordView(r.Id, r.Checklist ?? "", r.Title, r.Stage, r.Round, r.Role, r.ByName, r.At, r.Items)).ToList();
        }
        catch (System.Data.Common.DbException ex)
        {
            log.LogWarning(ex, "Submission checklists of {ZedId} {Level} not readable (are migrations 0088 / 0095 applied?)", zedId, level);
            return Array.Empty<RecordView>();
        }
    }
}
