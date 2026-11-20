using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using static Zed.Portal.Features.Incentives.SchemeApplications;

namespace Zed.Portal.Features.Incentives.Staff;

/// <summary>
/// The Master Admin's "Scheme Applications" (2026-11-20, approved): every submitted scheme application with filters (scheme, status,
/// state, submitted from / to) and the counts per status; the detail; allot / re-allot to an eligible agency (ticked for the
/// scheme, the unit's state and sector); resume or reject an application on hold (its certificate was suspended or withdrawn).
/// </summary>
[Route("api/staff/scheme-applications")]
[StaffRoles(UserRole.MasterAdmin)]
[PortalSystems(PortalSystem.Main)]
public sealed class SchemeApplicationsController(
    ISqlExecutor db, SchemeStore store, IWebHostEnvironment env, IOptions<PortalOptions> portal, ILogger<SchemeApplicationsController> log) : StaffApiController
{
    public const string Base = "/api/staff/scheme-applications";

    private SchemeAllotment Allotment => SchemeServices.Get<SchemeAllotment>(HttpContext.RequestServices);
    private SchemeNotifier Notifier => SchemeServices.Get<SchemeNotifier>(HttpContext.RequestServices);
    private Onsite.OnsiteAllotment OnsiteAllotment => SchemeServices.Get<Onsite.OnsiteAllotment>(HttpContext.RequestServices);

    /// <summary>GET api/staff/scheme-applications?scheme=&amp;status=&amp;state=&amp;from=&amp;to=</summary>
    [HttpGet]
    public async Task<ActionResult<SchemeReview.ListResponse>> List([FromQuery] string? scheme, [FromQuery] string? status, [FromQuery] string? state,
        [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct)
    {
        if (SchemeReview.Filter(scheme, status, state, from, to, out var problem) is not { } filter) return this.Problem400(problem!);
        // A Master Admin with a scope (states, levels, category; migration 0057) sees only its units.
        return await SchemeReview.ListAsync(db, store, SchemeReview.ListAllSql, null, filter, ct,
            rows => global::Zed.Portal.Features.Staff.Users.ScopeFilter.ApplyAsync(HttpContext, rows, r => r.ZedId, r => r.Level, ct));
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<SchemeReview.Detail>> Detail(int id, CancellationToken ct)
    {
        if (await Find(id, ct) is not { } c) return NotFound();
        var actions = new SchemeReview.Actions(Allot: c.Status is Submitted or WithAgency, Hold: c.Status == OnHold,
            OnsiteAllot: c.Status is OnsiteAllot or OnsiteWithAgency);
        return await SchemeReview.DetailAsync(db, store, c, Base, actions, log, ct, withOnsite: true);
    }

    [HttpGet("{id:int}/files/{name}")]
    public async Task<IActionResult> File(int id, string name, CancellationToken ct) =>
        await Find(id, ct) is { } c ? SchemeReview.File(this, c, name, env, portal.Value) : NotFound();

    [HttpGet("{id:int}/onsite-photos/{photoId}")]
    public async Task<IActionResult> Photo(int id, string photoId, CancellationToken ct) =>
        await Find(id, ct) is { } c ? await Onsite.OnsiteReports.PhotoAsync(this, db, c, photoId, env, portal.Value, log, ct) : NotFound();

    /// <summary>GET api/staff/scheme-applications/{id}/onsite-agencies — phase 2: the onsite agencies of the unit's state and district.</summary>
    [HttpGet("{id:int}/onsite-agencies")]
    public async Task<ActionResult<IReadOnlyList<SchemeAllotment.AgencyOption>>> OnsiteAgencyOptions(int id, CancellationToken ct)
    {
        if (await Find(id, ct) is not { } c) return NotFound();
        return (await OnsiteAllotment.EligibleAsync(c.ZedId, c.Code, c.OnsiteRejected, ct)).ToList();
    }

    /// <summary>
    /// POST api/staff/scheme-applications/{id}/onsite-allot — phase 2: allot (OnsiteAllot) or re-allot (with an onsite agency, not yet
    /// with an assessor) to an onsite agency of the unit's state and district.
    /// </summary>
    [HttpPost("{id:int}/onsite-allot")]
    public async Task<ActionResult<MessageResponse>> AllotOnsite(int id, AllotRequest req, CancellationToken ct)
    {
        using (await SchemeCaseLock.EnterAsync(ct))
        {
            if (await Find(id, ct) is not { } c) return NotFound();
            if (c.Status is not (SchemeApplications.OnsiteAllot or OnsiteWithAgency)) return this.Problem400("This application can no longer be allotted for onsite verification.");
            var agency = (await OnsiteAllotment.EligibleAsync(c.ZedId, c.Code, c.OnsiteRejected, ct))
                .FirstOrDefault(a => string.Equals(a.UserId, req.AgencyUserId?.Trim(), StringComparison.OrdinalIgnoreCase));
            if (agency is null) return this.Problem400("Please select an onsite agency serving this scheme in the unit's state and district.");
            var before = c.OnsiteAgency;
            if (!await OnsiteAllotment.SaveAllotmentAsync(c, agency.UserId, Onsite.OnsiteAllotment.Manual, ct)) return Changed();
            await SchemeCases.HistoryAsync(db, log, c, before is null
                ? $"Scheme application allotted for onsite verification to agency {agency.UserId} by {ActorId}"
                : $"Scheme application re-allotted for onsite verification from agency {before} to {agency.UserId} by {ActorId}", ct);
            return new MessageResponse(before is null ? "Application allotted." : "Application re-allotted.");
        }
    }

    /// <summary>GET api/staff/scheme-applications/{id}/agencies — the agencies it may be allotted to.</summary>
    [HttpGet("{id:int}/agencies")]
    public async Task<ActionResult<IReadOnlyList<SchemeAllotment.AgencyOption>>> Agencies(int id, CancellationToken ct)
    {
        if (await Find(id, ct) is not { } c) return NotFound();
        return (await Allotment.EligibleAsync(c.ZedId, c.Code, c.Rejected, ct)).ToList();
    }

    public sealed record AllotRequest(string? AgencyUserId);

    /// <summary>POST api/staff/scheme-applications/{id}/allot — allot (Submitted) or re-allot (with an agency, not yet with an assessor).</summary>
    [HttpPost("{id:int}/allot")]
    public async Task<ActionResult<MessageResponse>> Allot(int id, AllotRequest req, CancellationToken ct)
    {
        using (await SchemeCaseLock.EnterAsync(ct))
        {
            if (await Find(id, ct) is not { } c) return NotFound();
            if (c.Status is not (Submitted or WithAgency)) return this.Problem400("This application can no longer be allotted.");
            var agency = (await Allotment.EligibleAsync(c.ZedId, c.Code, c.Rejected, ct)).FirstOrDefault(a => string.Equals(a.UserId, req.AgencyUserId?.Trim(), StringComparison.OrdinalIgnoreCase));
            if (agency is null) return this.Problem400("Please select an agency ticked for this scheme.");
            var before = c.Agency;
            c.Agency = agency.UserId;
            c.Assessor = null;
            c.AssessorAcceptedOn = null;
            c.AllotmentType = SchemeAllotment.Manual;
            c.AllotmentDate = DateTime.Now;
            c.Status = WithAgency;
            if (!await SchemeCases.SaveAsync(db, c, ct)) return Changed();
            await SchemeCases.HistoryAsync(db, log, c, before is null
                ? $"Scheme application allotted to agency {agency.UserId} by {ActorId}"
                : $"Scheme application re-allotted from agency {before} to {agency.UserId} by {ActorId}", ct);
            await Notifier.AllottedToAgencyAsync(c, ct);
            return new MessageResponse(before is null ? "Application allotted." : "Application re-allotted.");
        }
    }

    /// <summary>POST api/staff/scheme-applications/{id}/resume — an application on hold continues where it was.</summary>
    [HttpPost("{id:int}/resume")]
    public async Task<ActionResult<MessageResponse>> Resume(int id, CancellationToken ct)
    {
        using (await SchemeCaseLock.EnterAsync(ct))
        {
            if (await Find(id, ct) is not { } c) return NotFound();
            if (c.Status != OnHold) return this.Problem400("This application is not on hold.");
            var next = SchemeSweep.ResumeStatus(c.HoldReason);
            // Back to the agency stage it was at; a missing agency or assessor means an earlier stage.
            if (next is WithAgency && c.Agency is null) next = Submitted;
            if (next is WithAssessor or Verifying or Correction && c.Assessor is null) next = c.Agency is null ? Submitted : WithAgency;
            // Phase 2: the onsite stage resumes at its own steps (no onsite agency → OnsiteAllot, no onsite assessor → OnsiteWithAgency).
            if (next is OnsiteWithAgency && c.OnsiteAgency is null) next = SchemeApplications.OnsiteAllot;
            if (next is OnsiteWithAssessor or OnsiteVisit && c.OnsiteAssessor is null) next = c.OnsiteAgency is null ? SchemeApplications.OnsiteAllot : OnsiteWithAgency;
            if (next == Qc && (c.OnsiteAgency is null ? c.Assessor is null : c.OnsiteAssessor is null))
                next = c.OnsiteAgency is not null ? OnsiteWithAgency : c.Agency is null ? Submitted : WithAgency;
            if (next == Correction)
            {
                var days = (await store.FindAsync(c.Code, ct))?.Verification.CorrectionDays ?? 30;
                c.CorrectionDueOn = DateTime.Today.AddDays(days);
            }
            var reason = c.HoldReason;
            c.Status = next;
            c.HoldReason = null;
            if (!await SchemeCases.SaveAsync(db, c, ct)) return Changed();
            await SchemeCases.HistoryAsync(db, log, c, $"Scheme application resumed ({next}) by {ActorId}; it was on hold: {reason}", ct);
            await Notifier.ResumedAsync(c, SchemeNotifier.StageWords(next), ct);
            if (next == Submitted && await Allotment.AutoAllotOnAsync(c.Code, ct))
                await Allotment.AllotLockedAsync((await SchemeCases.LoadAsync(db, id, ct))!, ct);
            if (next == SchemeApplications.OnsiteAllot && await SchemeCases.LoadAsync(db, id, ct) is { } back)
                await OnsiteAllotment.AllotLockedAsync(back, ct);
            return new MessageResponse("Application resumed.");
        }
    }

    public sealed record ReasonRequest(string? Reason);

    /// <summary>POST api/staff/scheme-applications/{id}/reject — an application on hold is rejected (the unit may apply again when it can).</summary>
    [HttpPost("{id:int}/reject")]
    public async Task<ActionResult<MessageResponse>> Reject(int id, ReasonRequest req, CancellationToken ct)
    {
        if (SchemeReview.Text(req.Reason, SchemeReview.MaxRemarks) is not { } reason)
            return this.Problem400($"Please enter the reason for rejection (up to {SchemeReview.MaxRemarks} characters).");
        using (await SchemeCaseLock.EnterAsync(ct))
        {
            if (await Find(id, ct) is not { } c) return NotFound();
            if (c.Status != OnHold) return this.Problem400("Only an application on hold can be rejected here.");
            c.Status = Rejected;
            c.ReasonForRejection = reason;
            c.DecidedOn = DateTime.Now;
            if (!await SchemeCases.SaveAsync(db, c, ct)) return Changed();
            await SchemeCases.HistoryAsync(db, log, c, $"Scheme application rejected by {ActorId} (on hold: {c.HoldReason}): {reason}", ct);
            await Notifier.RejectedAsync(c, reason, ct);
            return new MessageResponse("Application rejected.");
        }
    }

    private async Task<SchemeCase?> Find(int id, CancellationToken ct) =>
        await SchemeCases.LoadAsync(db, id, ct) is { } c && c.Status != Draft
        && await global::Zed.Portal.Features.Staff.Users.ScopeFilter.AllowsAsync(HttpContext, c.ZedId, c.Row.SchemeLevel, ct) ? c : null;

    private ObjectResult Changed() => this.Problem400("The application has changed meanwhile. Please reload it.");
}
