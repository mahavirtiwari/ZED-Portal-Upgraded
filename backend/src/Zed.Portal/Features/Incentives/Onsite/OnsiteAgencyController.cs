using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Incentives.Staff;
using Zed.Portal.Features.Staff.Assessment;
using static Zed.Portal.Features.Incentives.SchemeApplications;

namespace Zed.Portal.Features.Incentives.Onsite;

/// <summary>
/// 2026-11-20 (the user, phase 2): the onsite verification agency's scheme applications. "Scheme onsite allotment": accept an
/// application allotted to it naming one of its assessors ticked "Onsite verification" for the scheme, without a date (the day the
/// assessor starts the visit in the app is the date of verification) → <see cref="OnsiteWithAssessor"/>; name another of its assessors
/// while the visit has not started; or reject it with a reason of Admin → Rejection Reasons (+ optional remarks): an "Auto" reason
/// re-allots it by the onsite round robin while the scheme's AutoAllot is on (the agency is never offered it again; AutoAllot off: it
/// waits for the Master Admin), a "Master Admin" reason sends it back to
/// <see cref="OnsiteAllot"/> for the Master Admin. "Scheme onsite QC" (the final QC; the desktop agency does none in this flow): the
/// onsite report (visit date, representative, photos, checks, remarks, verified claim), then approve an amount (up to the eligible
/// amount of the onsite verified claim) → <see cref="Approved"/>, or back to its assessor → <see cref="OnsiteWithAssessor"/>.
/// Only an onsite agency (Users.AgencyKind) is served, and only its own applications (FinancialAssistance.OnsiteAgencyId).
/// </summary>
[Route("api/staff/scheme-onsite/agency")]
[StaffRoles(UserRole.Agency)]
[Agencies.IncentiveKind(Agencies.IncentiveAgencies.OnsiteSubRole)]
[PortalSystems(PortalSystem.Main)]
public sealed class OnsiteAgencyController(
    ISqlExecutor db, SchemeStore store, IPortalSettings settings, IWebHostEnvironment env, IOptions<PortalOptions> portal,
    ILogger<OnsiteAgencyController> log) : StaffApiController
{
    public const string Base = "/api/staff/scheme-onsite/agency";

    internal const string AssessorsSql =
        "SELECT Id, UserId, UserName, SchemeVerification, CreatedBy FROM dbo.Users WHERE RoleId = 3 AND IsActive = 1 AND CreatedBy = @Agency;";

    private OnsiteAllotment Allotment => SchemeServices.Get<OnsiteAllotment>(HttpContext.RequestServices);
    private SchemeNotifier Notifier => SchemeServices.Get<SchemeNotifier>(HttpContext.RequestServices);

    [HttpGet]
    public async Task<ActionResult<SchemeReview.ListResponse>> List([FromQuery] string? scheme, [FromQuery] string? status, [FromQuery] string? state,
        [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct)
    {
        if (!await IsOnsiteAgencyAsync(ct)) return NotFound();
        if (SchemeReview.Filter(scheme, status, state, from, to, out var problem) is not { } filter) return this.Problem400(problem!);
        return await SchemeReview.ListAsync(db, store, SchemeReview.ListOnsiteAgencySql, UserId, filter, ct);
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<SchemeReview.Detail>> Detail(int id, CancellationToken ct)
    {
        if (await Mine(id, ct) is not { } c) return NotFound();
        var actions = new SchemeReview.Actions(OnsiteRespond: c.Status == OnsiteWithAgency,
            OnsiteAssessor: c.Status == OnsiteWithAssessor && c.Row.VisitStartedOn is null, OnsiteQc: c.Status == Qc);
        return await SchemeReview.DetailAsync(db, store, c, Base, actions, log, ct, withOnsite: true);
    }

    [HttpGet("{id:int}/files/{name}")]
    public async Task<IActionResult> File(int id, string name, CancellationToken ct) =>
        await Mine(id, ct) is { } c ? SchemeReview.File(this, c, name, env, portal.Value) : NotFound();

    [HttpGet("{id:int}/onsite-photos/{photoId}")]
    public async Task<IActionResult> Photo(int id, string photoId, CancellationToken ct) =>
        await Mine(id, ct) is { } c ? await OnsiteReports.PhotoAsync(this, db, c, photoId, env, portal.Value, log, ct) : NotFound();

    public sealed record Option(string UserId, string UserName);

    /// <summary>GET …/{id}/assessors — its active assessors ticked "Onsite verification" for the application's scheme.</summary>
    [HttpGet("{id:int}/assessors")]
    public async Task<ActionResult<IReadOnlyList<Option>>> Assessors(int id, CancellationToken ct)
    {
        if (await Mine(id, ct) is not { } c) return NotFound();
        return (await AssessorOptions(c.Code, ct)).ToList();
    }

    /// <summary>GET …/rejection-reasons — the reasons in use (Admin → Rejection Reasons, as the desktop agencies).</summary>
    [HttpGet("rejection-reasons")]
    public async Task<ActionResult<IReadOnlyList<RejectionReason>>> Reasons(CancellationToken ct)
    {
        if (!await IsOnsiteAgencyAsync(ct)) return NotFound();
        return (await RejectionReasons.LoadAsync(settings, ct)).Where(r => r.Active).ToList();
    }

    public sealed record AcceptRequest(string? AssessorUserId);

    /// <summary>POST …/{id}/accept — accepts the allotment naming an assessor (no date), or names another while the visit has not started.</summary>
    [HttpPost("{id:int}/accept")]
    public async Task<ActionResult<MessageResponse>> Accept(int id, AcceptRequest req, CancellationToken ct)
    {
        await using (await SchemeCaseLock.EnterAsync(db, ct))
        {
            if (await Mine(id, ct) is not { } c) return NotFound();
            var renaming = c.Status == OnsiteWithAssessor && c.Row.VisitStartedOn is null;
            if (c.Status != OnsiteWithAgency && !renaming) return this.Problem400("This application has already been processed.");
            var assessor = (await AssessorOptions(c.Code, ct)).FirstOrDefault(a => string.Equals(a.UserId, req.AssessorUserId?.Trim(), StringComparison.OrdinalIgnoreCase));
            if (assessor is null) return this.Problem400("Please select one of your verification officers ticked for onsite verification of this scheme.");
            var before = c.OnsiteAssessor;
            c.OnsiteAssessor = assessor.UserId;
            c.Status = OnsiteWithAssessor;
            if (!await SchemeCases.SaveAsync(db, c, ct)) return Changed();
            await SchemeCases.HistoryAsync(db, log, c, renaming
                ? $"Onsite assessor changed from {before} to {assessor.UserId} by agency {UserId}"
                : $"Scheme application accepted for onsite verification by agency {UserId}; assessor {assessor.UserId}", ct);
            await Notifier.OnsiteAllottedToAssessorAsync(c, ct);
            return new MessageResponse(renaming ? "Verification officer changed." : "Application accepted. The verification officer verifies it at the unit in the assessor app.");
        }
    }

    public sealed record RejectRequest(string? ReasonId, string? Remarks);

    /// <summary>POST …/{id}/reject — the onsite agency returns the allotment with a listed reason.</summary>
    [HttpPost("{id:int}/reject")]
    public async Task<ActionResult<MessageResponse>> Reject(int id, RejectRequest req, CancellationToken ct)
    {
        var reason = RejectionReasons.Find(await RejectionReasons.LoadAsync(settings, ct), req.ReasonId);
        if (reason is null) return this.Problem400("Please select the reason for rejection.");
        if (!RejectionReasons.TryRemarks(req.Remarks, out var remarks, out var error)) return this.Problem400(error!);
        await using (await SchemeCaseLock.EnterAsync(db, ct))
        {
            if (await Mine(id, ct) is not { } c) return NotFound();
            if (c.Status != OnsiteWithAgency) return this.Problem400("This application has already been processed.");
            var text = RejectionReasons.LegacyText(reason, remarks, 2000);
            // 2026-11-20 (the product owner): an "Auto" reason re-allots by round robin only while the scheme's AutoAllot is on;
            // otherwise the application waits for the Master Admin (with the waiting-for-allotment mail).
            var autoOff = reason.AutoReallot && (await store.FindAsync(c.Code, ct))?.Verification.AutoAllot == false;
            var auto = reason.AutoReallot && !autoOff;
            c.AddOnsiteRejected(UserId);
            c.ReasonForRejectionAgency = $"Rejected for onsite verification by agency {UserId}: {text}";
            c.OnsiteAgency = null;
            c.OnsiteAssessor = null;
            c.OnsiteAllotmentDate = null;
            c.OnsiteAllotmentType = auto ? null : OnsiteAllotment.WaitsForMasterAdmin;
            c.Status = OnsiteAllot;
            if (!await SchemeCases.SaveAsync(db, c, ct)) return Changed();
            await SchemeCases.HistoryAsync(db, log, c, $"Onsite allotment rejected by agency {UserId}: {text}", ct);
            if (auto
                && await SchemeCases.LoadAsync(db, id, ct) is { } back
                && await Allotment.AllotLockedAsync(back, ct) is not null)
                return new MessageResponse("Application rejected. It has been allotted to another agency.");
            await Notifier.ManualAllotAsync(c, SchemeNotifier.OnsiteStage,
                $"Rejected for onsite verification by agency {UserId}: {text}" + (autoOff ? " " + SchemeNotifier.AutoAllotOff : ""), ct);
            return new MessageResponse("Application rejected. It goes back to the ZED team for allotment.");
        }
    }

    public sealed record ApproveRequest(decimal? Amount);

    /// <summary>POST …/{id}/approve — the final QC: the amount (≤ the eligible amount of the onsite verified claim) → Approved (NEFT).</summary>
    [HttpPost("{id:int}/approve")]
    public async Task<ActionResult<MessageResponse>> Approve(int id, ApproveRequest req, CancellationToken ct)
    {
        await using (await SchemeCaseLock.EnterAsync(db, ct))
        {
            if (await Mine(id, ct) is not { } c) return NotFound();
            if (c.Status != Qc) return this.Problem400("This application is not waiting for QC.");
            var def = await store.FindAsync(c.Code, ct);
            var eligible = await OnsiteReports.EligibleAsync(db, def, c, log, ct);
            if (req.Amount is not { } amount || amount <= 0 || decimal.Round(amount, 2) != amount)
                return this.Problem400("Please enter the approved amount (in rupees, up to 2 decimals).");
            if (amount > eligible)
                return this.Problem400($"The approved amount cannot be more than the eligible amount (Rs. {SchemeCases.Money(eligible)}).");
            c.EligibleAmount = SchemeCases.Money(eligible);
            c.ApprovedAmount = amount;
            c.DecidedOn = DateTime.Now;
            c.Status = Approved;
            if (!await SchemeCases.SaveAsync(db, c, ct)) return Changed();
            await SchemeCases.HistoryAsync(db, log, c,
                $"Scheme application approved in the onsite QC by agency {UserId}: Rs. {SchemeCases.Money(amount)} (eligible Rs. {SchemeCases.Money(eligible)})", ct);
            await Notifier.ApprovedAsync(c, ct);
            return new MessageResponse("Application approved. It goes to the MSME DFO for payment.");
        }
    }

    public sealed record BackRequest(string? Remarks);

    /// <summary>POST …/{id}/back — QC: back to its onsite assessor with a remark (the assessor verifies again in the app).</summary>
    [HttpPost("{id:int}/back")]
    public async Task<ActionResult<MessageResponse>> Back(int id, BackRequest req, CancellationToken ct)
    {
        if (SchemeReview.Text(req.Remarks, SchemeReview.MaxRemarks) is not { } remarks)
            return this.Problem400($"Please enter the remarks for the verification officer (up to {SchemeReview.MaxRemarks} characters).");
        await using (await SchemeCaseLock.EnterAsync(db, ct))
        {
            if (await Mine(id, ct) is not { } c) return NotFound();
            if (c.Status != Qc) return this.Problem400("This application is not waiting for QC.");
            if (c.OnsiteAssessor is null) return this.Problem400("No verification officer is named for this application.");
            c.ReasonForRejectionAgency = $"Onsite QC remarks: {remarks}";
            c.EligibleAmount = null;
            c.Status = OnsiteWithAssessor;
            if (!await SchemeCases.SaveAsync(db, c, ct)) return Changed();
            await SchemeCases.HistoryAsync(db, log, c, $"Scheme application sent back to the onsite assessor in QC by agency {UserId}: {remarks}", ct);
            await Notifier.OnsiteQcSentBackAsync(c, remarks, ct);
            return new MessageResponse("Application sent back to the verification officer.");
        }
    }

    private async Task<IEnumerable<Option>> AssessorOptions(string code, CancellationToken ct) =>
        (await db.QuerySqlAsync<SchemeAllotment.CandidateRow>(AssessorsSql, new { Agency = Ansi(UserId, 50) }, ct))
            .Where(r => !string.IsNullOrWhiteSpace(r.UserId) && SchemeTicks.Has(r.SchemeVerification, code, SchemeTicks.Onsite))
            .OrderBy(r => r.UserName, StringComparer.OrdinalIgnoreCase)
            .Select(r => new Option(r.UserId!.Trim(), r.UserName?.Trim() ?? r.UserId!.Trim()));

    private Task<bool> IsOnsiteAgencyAsync(CancellationToken ct) => Agencies.IncentiveAgencies.IsAgencyOfKindAsync(db, UserId, Agencies.IncentiveAgencies.OnsiteKind, ct);

    /// <summary>An application allotted to this onsite agency (only an onsite agency gets any).</summary>
    private async Task<SchemeCase?> Mine(int id, CancellationToken ct) =>
        await SchemeCases.LoadAsync(db, id, ct) is { } c && c.OnsiteAgency is not null && string.Equals(c.OnsiteAgency, UserId, StringComparison.OrdinalIgnoreCase)
        && await IsOnsiteAgencyAsync(ct) ? c : null;

    private ObjectResult Changed() => this.Problem400("The application has changed meanwhile. Please reload it.");
}
