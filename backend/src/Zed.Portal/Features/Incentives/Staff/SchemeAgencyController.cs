using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.Assessment;
using static Zed.Portal.Features.Incentives.SchemeApplications;

namespace Zed.Portal.Features.Incentives.Staff;

/// <summary>
/// The desktop verification agency's scheme applications (2026-11-20, approved): "Scheme Allotment" — accept an allotted application
/// naming one of its assessors ticked for the scheme, or reject it with a reason of Admin → Rejection Reasons (+ optional remarks): an
/// "Auto" reason re-allots it by round robin to another agency while the scheme's AutoAllot is on (off: the Master Admin's list), a
/// "Master Admin" reason sends it back to the Master Admin's list;
/// "Scheme QC" — approve the assessor's recommendation (an amount up to the eligible amount of the verified claim) or send it
/// back to the assessor with a remark.
/// </summary>
[Route("api/staff/scheme-verification/agency")]
[StaffRoles(UserRole.Agency)]
[PortalSystems(PortalSystem.Main)]
public sealed class SchemeAgencyController(
    ISqlExecutor db, SchemeStore store, IPortalSettings settings, IWebHostEnvironment env, IOptions<PortalOptions> portal,
    ILogger<SchemeAgencyController> log) : StaffApiController
{
    public const string Base = "/api/staff/scheme-verification/agency";

    internal const string AssessorsSql =
        "SELECT Id, UserId, UserName, SchemeVerification, CreatedBy FROM dbo.Users WHERE RoleId = 3 AND IsActive = 1 AND CreatedBy = @Agency;";

    private SchemeAllotment Allotment => SchemeServices.Get<SchemeAllotment>(HttpContext.RequestServices);
    private SchemeNotifier Notifier => SchemeServices.Get<SchemeNotifier>(HttpContext.RequestServices);

    [HttpGet]
    public async Task<ActionResult<SchemeReview.ListResponse>> List([FromQuery] string? scheme, [FromQuery] string? status, [FromQuery] string? state,
        [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct)
    {
        if (SchemeReview.Filter(scheme, status, state, from, to, out var problem) is not { } filter) return this.Problem400(problem!);
        return await SchemeReview.ListAsync(db, store, SchemeReview.ListAgencySql, UserId, filter, ct);
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<SchemeReview.Detail>> Detail(int id, CancellationToken ct)
    {
        if (await Mine(id, ct) is not { } c) return NotFound();
        // Phase 2: the onsite agency does the QC of a Desktop + Onsite application, not this (desktop) agency.
        var actions = new SchemeReview.Actions(Respond: c.Status == WithAgency, Qc: c.Status == Qc && !c.OnsiteStage);
        return await SchemeReview.DetailAsync(db, store, c, Base, actions, log, ct);
    }

    [HttpGet("{id:int}/files/{name}")]
    public async Task<IActionResult> File(int id, string name, CancellationToken ct) =>
        await Mine(id, ct) is { } c ? SchemeReview.File(this, c, name, env, portal.Value) : NotFound();

    public sealed record Option(string UserId, string UserName);

    /// <summary>GET api/staff/scheme-verification/agency/{id}/assessors — its active assessors ticked "Desktop" for the application's scheme.</summary>
    [HttpGet("{id:int}/assessors")]
    public async Task<ActionResult<IReadOnlyList<Option>>> Assessors(int id, CancellationToken ct)
    {
        if (await Mine(id, ct) is not { } c) return NotFound();
        return (await AssessorOptions(c.Code, ct)).ToList();
    }

    /// <summary>GET api/staff/scheme-verification/agency/rejection-reasons — the reasons in use (Admin → Rejection Reasons).</summary>
    [HttpGet("rejection-reasons")]
    public async Task<IReadOnlyList<RejectionReason>> Reasons(CancellationToken ct) =>
        (await RejectionReasons.LoadAsync(settings, ct)).Where(r => r.Active).ToList();

    public sealed record AcceptRequest(string? AssessorUserId);

    [HttpPost("{id:int}/accept")]
    public async Task<ActionResult<MessageResponse>> Accept(int id, AcceptRequest req, CancellationToken ct)
    {
        using (await SchemeCaseLock.EnterAsync(ct))
        {
            if (await Mine(id, ct) is not { } c) return NotFound();
            if (c.Status != WithAgency) return this.Problem400("This application has already been processed.");
            var assessor = (await AssessorOptions(c.Code, ct)).FirstOrDefault(a => string.Equals(a.UserId, req.AssessorUserId?.Trim(), StringComparison.OrdinalIgnoreCase));
            if (assessor is null) return this.Problem400("Please select one of your verification officers ticked for this scheme.");
            c.Assessor = assessor.UserId;
            c.AssessorAcceptedOn = null;
            c.Status = WithAssessor;
            if (!await SchemeCases.SaveAsync(db, c, ct)) return Changed();
            await SchemeCases.HistoryAsync(db, log, c, $"Scheme application accepted by agency {UserId}; assessor {assessor.UserId}", ct);
            await Notifier.AllottedToAssessorAsync(c, ct);
            return new MessageResponse("Application accepted.");
        }
    }

    public sealed record RejectRequest(string? ReasonId, string? Remarks);

    /// <summary>POST api/staff/scheme-verification/agency/{id}/reject — the agency returns the allotment with a listed reason.</summary>
    [HttpPost("{id:int}/reject")]
    public async Task<ActionResult<MessageResponse>> Reject(int id, RejectRequest req, CancellationToken ct)
    {
        var reason = RejectionReasons.Find(await RejectionReasons.LoadAsync(settings, ct), req.ReasonId);
        if (reason is null) return this.Problem400("Please select the reason for rejection.");
        if (!RejectionReasons.TryRemarks(req.Remarks, out var remarks, out var error)) return this.Problem400(error!);
        using (await SchemeCaseLock.EnterAsync(ct))
        {
            if (await Mine(id, ct) is not { } c) return NotFound();
            if (c.Status != WithAgency) return this.Problem400("This application has already been processed.");
            var text = RejectionReasons.LegacyText(reason, remarks, 2000);
            // 2026-11-20 (the product owner): an "Auto" reason re-allots by round robin only while the scheme's AutoAllot is on;
            // otherwise the application goes to the Master Admin (with the waiting-for-allotment mail).
            var autoOff = reason.AutoReallot && !await Allotment.AutoAllotOnAsync(c.Code, ct);
            c.AddRejected(UserId);
            c.ReasonForRejectionAgency = $"Rejected by agency {UserId}: {text}";
            c.Agency = null;
            c.Assessor = null;
            c.AllotmentType = null;
            c.AllotmentDate = null;
            c.Status = Submitted;
            if (!await SchemeCases.SaveAsync(db, c, ct)) return Changed();
            await SchemeCases.HistoryAsync(db, log, c, $"Scheme application allotment rejected by agency {UserId}: {text}", ct);
            if (reason.AutoReallot && !autoOff
                && await SchemeCases.LoadAsync(db, id, ct) is { } back
                && await Allotment.AllotLockedAsync(back, ct) is not null)
                return new MessageResponse("Application rejected. It has been allotted to another agency.");
            await Notifier.ManualAllotAsync(c, SchemeNotifier.DesktopStage, $"Rejected by agency {UserId}: {text}" + (autoOff ? " " + SchemeNotifier.AutoAllotOff : ""), ct);
            return new MessageResponse("Application rejected. It goes back to the ZED team for allotment.");
        }
    }

    public sealed record ApproveRequest(decimal? Amount);

    /// <summary>POST api/staff/scheme-verification/agency/{id}/approve — QC: the amount (≤ the eligible amount of the verified claim).</summary>
    [HttpPost("{id:int}/approve")]
    public async Task<ActionResult<MessageResponse>> Approve(int id, ApproveRequest req, CancellationToken ct)
    {
        using (await SchemeCaseLock.EnterAsync(ct))
        {
            if (await Mine(id, ct) is not { } c) return NotFound();
            if (c.Status != Qc || c.OnsiteStage) return this.Problem400("This application is not waiting for QC.");
            var def = await store.FindAsync(c.Code, ct);
            var answers = c.Row.Answers;
            var verified = def is null ? c.Row.ClaimAmount ?? 0 : SchemeReview.Verified(def.Form, answers, c.Checks);
            var eligible = SchemeEligibility.Eligible(verified, await SchemeReview.GradeAsync(db, def, c.Row, log, ct));
            if (req.Amount is not { } amount || amount <= 0 || decimal.Round(amount, 2) != amount)
                return this.Problem400("Please enter the approved amount (in rupees, up to 2 decimals).");
            if (amount > eligible)
                return this.Problem400($"The approved amount cannot be more than the eligible amount (Rs. {SchemeCases.Money(eligible)}).");
            c.EligibleAmount = SchemeCases.Money(eligible);
            c.ApprovedAmount = amount;
            c.DecidedOn = DateTime.Now;
            c.Status = Approved;
            if (!await SchemeCases.SaveAsync(db, c, ct)) return Changed();
            await SchemeCases.HistoryAsync(db, log, c, $"Scheme application approved in QC by agency {UserId}: Rs. {SchemeCases.Money(amount)} (eligible Rs. {SchemeCases.Money(eligible)})", ct);
            await Notifier.ApprovedAsync(c, ct);
            return new MessageResponse("Application approved. It goes to the MSME DFO for payment.");
        }
    }

    public sealed record BackRequest(string? Remarks);

    /// <summary>POST api/staff/scheme-verification/agency/{id}/back — QC: back to the assessor with a remark.</summary>
    [HttpPost("{id:int}/back")]
    public async Task<ActionResult<MessageResponse>> Back(int id, BackRequest req, CancellationToken ct)
    {
        if (SchemeReview.Text(req.Remarks, SchemeReview.MaxRemarks) is not { } remarks)
            return this.Problem400($"Please enter the remarks for the verification officer (up to {SchemeReview.MaxRemarks} characters).");
        using (await SchemeCaseLock.EnterAsync(ct))
        {
            if (await Mine(id, ct) is not { } c) return NotFound();
            if (c.Status != Qc || c.OnsiteStage) return this.Problem400("This application is not waiting for QC.");
            c.ReasonForRejectionAgency = $"QC remarks: {remarks}";
            c.EligibleAmount = null;
            c.Status = Verifying;
            if (!await SchemeCases.SaveAsync(db, c, ct)) return Changed();
            await SchemeCases.HistoryAsync(db, log, c, $"Scheme application sent back to the assessor in QC by agency {UserId}: {remarks}", ct);
            await Notifier.QcSentBackAsync(c, remarks, ct);
            return new MessageResponse("Application sent back to the verification officer.");
        }
    }

    private async Task<IEnumerable<Option>> AssessorOptions(string code, CancellationToken ct) =>
        (await db.QuerySqlAsync<SchemeAllotment.CandidateRow>(AssessorsSql, new { Agency = Ansi(UserId, 50) }, ct))
            .Where(r => !string.IsNullOrWhiteSpace(r.UserId) && SchemeTicks.Has(r.SchemeVerification, code, SchemeTicks.Desktop))
            .OrderBy(r => r.UserName, StringComparer.OrdinalIgnoreCase)
            .Select(r => new Option(r.UserId!.Trim(), r.UserName?.Trim() ?? r.UserId!.Trim()));

    private async Task<SchemeCase?> Mine(int id, CancellationToken ct) =>
        await SchemeCases.LoadAsync(db, id, ct) is { } c && c.Agency is not null && string.Equals(c.Agency, UserId, StringComparison.OrdinalIgnoreCase) ? c : null;

    private ObjectResult Changed() => this.Problem400("The application has changed meanwhile. Please reload it.");
}
