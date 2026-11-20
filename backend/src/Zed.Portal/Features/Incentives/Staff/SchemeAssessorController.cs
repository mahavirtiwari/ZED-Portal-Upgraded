using System.Text;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using static Zed.Portal.Features.Incentives.SchemeApplications;

namespace Zed.Portal.Features.Incentives.Staff;

/// <summary>
/// The desktop assessor's scheme verification (2026-11-20, approved): accept an application the agency named them for (or return
/// it to the agency with a reason); check each answer the scheme marks for checking and every document — Valid ("Yes") or Not
/// valid ("No", with the remark the unit corrects); then decide: <b>Correction</b> (at least one Not valid, rounds left: round
/// n of the scheme's rounds, answered within its days, else rejected by <see cref="SchemeSweep"/>), <b>Reject</b> (a reason;
/// also the way to end an application whose last round is still not valid) or <b>Recommend</b> (everything checked and valid:
/// the eligible amount of the verified claim goes to the agency's QC).
/// </summary>
[Route("api/staff/scheme-verification/assessor")]
[StaffRoles(UserRole.DesktopAssessor)]
[PortalSystems(PortalSystem.Main)]
public sealed class SchemeAssessorController(
    ISqlExecutor db, SchemeStore store, IWebHostEnvironment env, IOptions<PortalOptions> portal, ILogger<SchemeAssessorController> log) : StaffApiController
{
    public const string Base = "/api/staff/scheme-verification/assessor";

    private SchemeNotifier Notifier => SchemeServices.Get<SchemeNotifier>(HttpContext.RequestServices);

    [HttpGet]
    public async Task<ActionResult<SchemeReview.ListResponse>> List([FromQuery] string? scheme, [FromQuery] string? status, [FromQuery] string? state,
        [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct)
    {
        if (SchemeReview.Filter(scheme, status, state, from, to, out var problem) is not { } filter) return this.Problem400(problem!);
        return await SchemeReview.ListAsync(db, store, SchemeReview.ListAssessorSql, UserId, filter, ct);
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<SchemeReview.Detail>> Detail(int id, CancellationToken ct)
    {
        if (await Mine(id, ct) is not { } c) return NotFound();
        var def = await store.FindAsync(c.Code, ct);
        return await SchemeReview.DetailAsync(db, store, c, Base, ActionsOf(c, def), log, ct);
    }

    [HttpGet("{id:int}/files/{name}")]
    public async Task<IActionResult> File(int id, string name, CancellationToken ct) =>
        await Mine(id, ct) is { } c ? SchemeReview.File(this, c, name, env, portal.Value) : NotFound();

    [HttpPost("{id:int}/accept")]
    public async Task<ActionResult<MessageResponse>> Accept(int id, CancellationToken ct)
    {
        using (await SchemeCaseLock.EnterAsync(ct))
        {
            if (await Mine(id, ct) is not { } c) return NotFound();
            if (c.Status != WithAssessor) return this.Problem400("This application has already been processed.");
            c.AssessorAcceptedOn = DateTime.Now;
            c.Status = Verifying;
            if (!await SchemeCases.SaveAsync(db, c, ct)) return Changed();
            await SchemeCases.HistoryAsync(db, log, c, $"Scheme application accepted for verification by assessor {UserId}", ct);
            return new MessageResponse("Application accepted. You can verify it now.");
        }
    }

    public sealed record ReasonRequest(string? Reason);

    /// <summary>POST …/{id}/return — back to the agency, which names another assessor.</summary>
    [HttpPost("{id:int}/return")]
    public async Task<ActionResult<MessageResponse>> Return(int id, ReasonRequest req, CancellationToken ct)
    {
        if (SchemeReview.Text(req.Reason, SchemeReview.MaxRemarks) is not { } reason)
            return this.Problem400($"Please enter the reason (up to {SchemeReview.MaxRemarks} characters).");
        using (await SchemeCaseLock.EnterAsync(ct))
        {
            if (await Mine(id, ct) is not { } c) return NotFound();
            if (c.Status != WithAssessor) return this.Problem400("This application has already been processed.");
            c.Assessor = null;
            c.AssessorAcceptedOn = null;
            c.ReasonForRejectionAgency = $"Returned by assessor {UserId}: {reason}";
            c.Status = WithAgency;
            if (!await SchemeCases.SaveAsync(db, c, ct)) return Changed();
            await SchemeCases.HistoryAsync(db, log, c, $"Scheme application returned to the agency by assessor {UserId}: {reason}", ct);
            await Notifier.NoticeAsync(c, c.Agency, "Returned by the assessor",
                $"Assessor {UserId} has returned the application with this reason:\n{reason}\nPlease name another assessor.", ct);
            return new MessageResponse("Application returned to your agency.");
        }
    }

    public sealed record CheckInput(string? Path, string? Status, string? Remarks);
    public sealed record ChecksRequest(IReadOnlyList<CheckInput>? Checks);

    /// <summary>PUT …/{id}/checks — saves the given checks (Yes, or No with a remark) of the places the assessor checks.</summary>
    [HttpPut("{id:int}/checks")]
    public async Task<ActionResult<MessageResponse>> SaveChecks(int id, ChecksRequest req, CancellationToken ct)
    {
        if (req.Checks is not { Count: > 0 and <= 2000 } input) return this.Problem400("Please mark at least one answer or document.");
        using (await SchemeCaseLock.EnterAsync(ct))
        {
            if (await Mine(id, ct) is not { } c) return NotFound();
            if (c.Status != Verifying || c.AssessorAcceptedOn is null) return this.Problem400("The application is not open for verification.");
            var def = await store.FindAsync(c.Code, ct);
            var allowed = SchemeReview.CheckablesOf(def, c.Row.Answers).ToDictionary(x => x.Path, StringComparer.Ordinal);
            var checks = c.Checks;
            foreach (var x in input)
            {
                var path = x.Path?.Trim() ?? "";
                if (!allowed.TryGetValue(path, out var place)) return this.Problem400("An answer or document to check was not found. Please reload the page.");
                if (x.Status is not (SchemeReview.Yes or SchemeReview.No)) return this.Problem400($"\"{place.Label}\": choose Valid or Not valid.");
                var remarks = SchemeReview.Text(x.Remarks, SchemeReview.MaxRemarks);
                if (x.Remarks?.Trim().Length > SchemeReview.MaxRemarks) return this.Problem400($"\"{place.Label}\": the remark can have at most {SchemeReview.MaxRemarks} characters.");
                if (x.Status == SchemeReview.No && remarks is null) return this.Problem400($"\"{place.Label}\": please write what is not valid.");
                checks[path] = new FieldCheck(x.Status, remarks, c.CorrectionRound ?? 0, UserId, DateTime.Now);
            }
            c.FormChecks = FieldCheck.Serialize(checks);
            if (!await SchemeCases.SaveAsync(db, c, ct)) return Changed();
            return new MessageResponse("Checks saved.");
        }
    }

    public sealed record DecisionRequest(string? Decision, string? Reason);

    /// <summary>POST …/{id}/decision — "correction", "reject" (reason) or "recommend".</summary>
    [HttpPost("{id:int}/decision")]
    public async Task<ActionResult<MessageResponse>> Decide(int id, DecisionRequest req, CancellationToken ct)
    {
        using (await SchemeCaseLock.EnterAsync(ct))
        {
            if (await Mine(id, ct) is not { } c) return NotFound();
            if (c.Status != Verifying || c.AssessorAcceptedOn is null) return this.Problem400("The application is not open for verification.");
            var def = await store.FindAsync(c.Code, ct);
            var places = SchemeReview.CheckablesOf(def, c.Row.Answers);
            var checks = c.Checks;
            var notValid = places.Where(p => checks.TryGetValue(p.Path, out var x) && x.Status == SchemeReview.No).ToList();
            switch (req.Decision?.Trim().ToLowerInvariant())
            {
                case "correction":
                {
                    var rounds = def?.Verification.CorrectionRounds ?? 0;
                    if (notValid.Count == 0) return this.Problem400("Mark at least one answer or document Not valid, with what the unit must correct.");
                    if ((c.CorrectionRound ?? 0) >= rounds) return this.Problem400("No correction round is left: reject the application or recommend it.");
                    c.CorrectionRound = (c.CorrectionRound ?? 0) + 1;
                    c.CorrectionDueOn = DateTime.Today.AddDays(def!.Verification.CorrectionDays);
                    c.Status = Correction;
                    if (!await SchemeCases.SaveAsync(db, c, ct)) return Changed();
                    var remarks = new StringBuilder();
                    foreach (var p in notValid) remarks.Append("• ").Append(p.Label).Append(": ").AppendLine(checks[p.Path].Remarks);
                    await SchemeCases.HistoryAsync(db, log, c,
                        $"Correction round {c.CorrectionRound} of {rounds} asked by assessor {UserId} ({notValid.Count} point(s)); due {c.CorrectionDueOn:dd-MMM-yyyy}", ct);
                    await Notifier.CorrectionAsync(c, rounds, remarks.ToString().TrimEnd(), ct);
                    return new MessageResponse($"Sent to the unit for correction (round {c.CorrectionRound} of {rounds}).");
                }
                case "reject":
                {
                    if (SchemeReview.Text(req.Reason, SchemeReview.MaxRemarks) is not { } reason)
                        return this.Problem400($"Please enter the reason for rejection (up to {SchemeReview.MaxRemarks} characters).");
                    c.Status = Rejected;
                    c.ReasonForRejection = reason;
                    c.DecidedOn = DateTime.Now;
                    if (!await SchemeCases.SaveAsync(db, c, ct)) return Changed();
                    await SchemeCases.HistoryAsync(db, log, c, $"Scheme application rejected by assessor {UserId}: {reason}", ct);
                    await Notifier.RejectedAsync(c, reason, ct);
                    return new MessageResponse("Application rejected.");
                }
                case "recommend":
                {
                    if (notValid.Count > 0) return this.Problem400("Some answers or documents are marked Not valid: send them for correction or reject the application.");
                    var unchecked_ = places.Where(p => !checks.ContainsKey(p.Path)).ToList();
                    if (unchecked_.Count > 0) return this.Problem400($"Please check every answer and document first ({unchecked_.Count} left, e.g. \"{unchecked_[0].Label}\").");
                    var verified = def is null ? c.Row.ClaimAmount ?? 0 : SchemeReview.Verified(def.Form, c.Row.Answers, checks);
                    var eligible = SchemeEligibility.Eligible(verified, await SchemeReview.GradeAsync(db, def, c.Row, log, ct));
                    c.EligibleAmount = SchemeCases.Money(eligible);
                    c.Status = Qc;
                    if (!await SchemeCases.SaveAsync(db, c, ct)) return Changed();
                    await SchemeCases.HistoryAsync(db, log, c,
                        $"Scheme application recommended by assessor {UserId}: verified claim Rs. {SchemeCases.Money(verified)}, eligible Rs. {SchemeCases.Money(eligible)}", ct);
                    return new MessageResponse("Recommended. It goes to your agency for QC.");
                }
                default:
                    return this.Problem400("Choose correction, reject or recommend.");
            }
        }
    }

    private static SchemeReview.Actions ActionsOf(SchemeCase c, SchemeDefinition? def)
    {
        var places = SchemeReview.CheckablesOf(def, c.Row.Answers);
        var checks = c.Checks;
        var done = places.Count(p => checks.ContainsKey(p.Path));
        var notValid = places.Count(p => checks.TryGetValue(p.Path, out var x) && x.Status == SchemeReview.No);
        var open = c.Status == Verifying && c.AssessorAcceptedOn is not null;
        var left = Math.Max(0, (def?.Verification.CorrectionRounds ?? 0) - (c.CorrectionRound ?? 0));
        return new SchemeReview.Actions(Accept: c.Status == WithAssessor, Check: open, Correction: open && notValid > 0 && left > 0, Reject: open,
            Recommend: open && notValid == 0 && done == places.Count, RoundsLeft: left, Checked: done, Checkable: places.Count, NotValid: notValid);
    }

    private async Task<SchemeCase?> Mine(int id, CancellationToken ct) =>
        await SchemeCases.LoadAsync(db, id, ct) is { } c && c.Assessor is not null && string.Equals(c.Assessor, UserId, StringComparison.OrdinalIgnoreCase) ? c : null;

    private ObjectResult Changed() => this.Problem400("The application has changed meanwhile. Please reload it.");
}
