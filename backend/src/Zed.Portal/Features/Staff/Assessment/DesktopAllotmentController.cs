using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using static Zed.Portal.Features.Staff.Assessment.AllotmentLists;
using Person = Zed.Portal.Features.Staff.Assessment.AssessmentAllotmentController.Person;
using ListResponse = Zed.Portal.Features.Staff.Assessment.AssessmentAllotmentController.ListResponse;

namespace Zed.Portal.Features.Staff.Assessment;

/// <summary>
/// The agencies' and desktop assessors' work lists of the desktop assessment. Port of the AssessmentController
/// actions used by Views/Assessment/DaAllotment, DaVerification and NonConfirmances: GetList (SP_ASSESSMENT_ALLOT_LIST),
/// AcceptUnitForDa / RejectUnitForDa (SP_ASSESSMENT_ACCEPT_UNIT_FOR_DA / SP_ASSESSMENT_REJECT_UNIT_FOR_DA) and
/// AcceptUnitForDaVerification / RejectUnitForDaVerification.
/// <para>
/// The legacy POST actions had no authorisation and took the ZED ID and assessor from the browser. Here every action
/// is limited to the role of its screen, and the record (and the chosen assessor) must be in the list the procedure
/// gives the signed-in user: the list procedures are scoped by UserId/RoleId from the sign-in cookie.
/// </para>
/// <para>
/// Surveillance (Bronze surveillance, "Allot Surveillance Assessments"): the agency's list holds its Bronze units at
/// status 1 that the assessor has not started in the Surveillance app (the procedure's state check), and the procedure
/// returns one assessor list (assessors allowed for Bronze surveillance) instead of main's two; allotting sets
/// DesktopAccepted, so there is no assessor accept step. Rows add the lead and co-assessor of the original
/// certification. Not served on Consultancy, where the desktop-assessment screens are not used.
/// </para>
/// </summary>
[PortalSystems(PortalSystem.Main, PortalSystem.Surveillance)]
[Route("api/staff/assessment")]
public sealed class DesktopAllotmentController(ISqlExecutor db, PortalHost host, ILogger<DesktopAllotmentController> log) : StaffApiController
{
    public sealed record DaAllotmentResponse(
        IReadOnlyList<Dictionary<string, object?>> Rows,
        IReadOnlyList<Person> Assessors,
        IReadOnlyList<Person> BronzeAssessors);

    private bool Surveillance => host.System == PortalSystem.Surveillance;

    /// <summary>DA Allotment screen: the agency's records waiting for a desktop assessor, and its assessors.</summary>
    [HttpGet("da-allotment")]
    [StaffRoles(UserRole.Agency)]
    [SubRole(SubRoles.DesktopVerification)]
    public async Task<ActionResult<DaAllotmentResponse>> DaAllotmentList(CancellationToken ct)
    {
        var sets = await List(db, UserId, RoleId, "DA", null, Filter.None, ct);
        string[] extra = Surveillance ? ["DaAssessorName", "LeadInCertification", "CoInCertification"] : ["DaAssessorName"];
        return new DaAllotmentResponse(Pick(sets[0], [.. ListFields, .. extra]), People(sets[1]), People(sets[Surveillance ? 1 : 2]));
    }

    public sealed record AllotToAssessorRequest(string? ZedId, string? Certification, string? DesktopAssessorId);

    [HttpPost("da-allotment/allot")]
    [StaffRoles(UserRole.Agency)]
    [SubRole(SubRoles.DesktopVerification)]
    public async Task<ActionResult<MessageResponse>> AllotToAssessor(AllotToAssessorRequest req, CancellationToken ct)
    {
        var level = AssessmentInput.Level(req.Certification);
        if (!AssessmentInput.IsId(req.ZedId) || level is null) return this.Problem400("Invalid request.");
        if (!AssessmentInput.IsId(req.DesktopAssessorId)) return this.Problem400("Please select valid data.");

        var sets = await List(db, UserId, RoleId, "DA", req.ZedId, Filter.None with { Certification = level }, ct);
        var row = sets[0].FirstOrDefault(r => Same(r, "ZedId", req.ZedId!) && Same(r, "Certification", level));
        if (row is null) return this.Problem400("This assessment is not allotted to your agency or can no longer be allotted.");

        // Main: Bronze goes to the agency's Bronze assessors (fewer than 10 allotments today), the rest to its other
        // assessors. Surveillance: one list, the agency's assessors allowed for Bronze surveillance.
        var assessors = People(Surveillance ? sets[1] : level == "Bronze" ? sets[2] : sets[1]);
        var assessor = assessors.FirstOrDefault(a => string.Equals(a.UserId, req.DesktopAssessorId, StringComparison.OrdinalIgnoreCase));
        if (assessor is null) return this.Problem400("Please select valid data.");

        await db.ExecuteProcAsync("SP_ASSESSMENT_ACCEPT_UNIT_FOR_DA",
            new { ZedId = req.ZedId, Certification = level, DesktopAssessorId = assessor.UserId }, ct);
        log.LogInformation("Agency {UserId} allotted {ZedId} {Certification} to assessor {Assessor}", UserId, req.ZedId, level, assessor.UserId);
        await Emails().SendAsync(DesktopAssessmentEmails.Kind.AllottedToAssessor, req.ZedId!, level, null, ct);
        return new MessageResponse("Assessment allotted to the assessor.");
    }

    public sealed record RejectRequest(string? ZedId, string? Certification, string? ReasonForRejection);

    [HttpPost("da-allotment/reject")]
    [StaffRoles(UserRole.Agency)]
    [SubRole(SubRoles.DesktopVerification)]
    public async Task<ActionResult<MessageResponse>> AgencyReject(RejectRequest req, CancellationToken ct)
    {
        var level = AssessmentInput.Level(req.Certification);
        if (!AssessmentInput.IsId(req.ZedId) || level is null) return this.Problem400("Invalid request.");
        if (Reason(req.ReasonForRejection) is not { } reason) return this.Problem400("Please enter reason for rejection.");

        var row = (await List(db, UserId, RoleId, "DA", req.ZedId, Filter.None with { Certification = level }, ct))[0]
            .FirstOrDefault(r => Same(r, "ZedId", req.ZedId!) && Same(r, "Certification", level));
        // The old page offered Reject only before an assessor was chosen, or after the assessor rejected.
        if (row is null || (row.Text("DesktopAssessorId").Length > 0 && row.Text("DesktopReasonForRejection").Length == 0))
            return this.Problem400("This assessment is not allotted to your agency or can no longer be rejected.");

        await db.ExecuteProcAsync("SP_ASSESSMENT_REJECT_UNIT_FOR_DA", new { ZedId = req.ZedId, Certification = level, ReasonForRejection = reason }, ct);
        log.LogInformation("Agency {UserId} rejected {ZedId} {Certification}", UserId, req.ZedId, level);
        await Emails().SendAsync(DesktopAssessmentEmails.Kind.RejectedByAgency, req.ZedId!, level, reason, ct);
        return new MessageResponse("Assessment rejected.");
    }

    // ---------------------------------------------------------------- desktop assessor: work lists

    /// <summary>
    /// Desktop Verification screen: records allotted to the signed-in assessor (status below 4; on Surveillance from
    /// status 1, while the assessor works in the Surveillance app).
    /// </summary>
    [HttpGet("da-verification")]
    [StaffRoles(UserRole.DesktopAssessor)]
    [SubRole(SubRoles.DesktopVerification)]
    public async Task<ActionResult<ListResponse>> DaVerificationList(CancellationToken ct) =>
        new ListResponse(Pick((await List(db, UserId, RoleId, null, null, Filter.None, ct))[0], ListFields));

    /// <summary>Non-Conformances screen: the assessor's records with an open NC round (DA status 4, SA status 14).</summary>
    [HttpGet("non-conformances")]
    [StaffRoles(UserRole.DesktopAssessor)]
    public async Task<ActionResult<ListResponse>> NonConformancesList(
        string? state, string? certification, string? size, string? gender, CancellationToken ct)
    {
        if (!Filters(state, certification, size, gender, out var f)) return this.Problem400("Invalid filter.");
        return new ListResponse(Pick((await List(db, UserId, RoleId, "NC", null, f, ct))[0], ListFields));
    }

    public sealed record UnitRequest(string? ZedId, string? Certification);

    [HttpPost("da-verification/accept")]
    [StaffRoles(UserRole.DesktopAssessor)]
    [SubRole(SubRoles.DesktopVerification)]
    public async Task<ActionResult<MessageResponse>> AssessorAccept(UnitRequest req, CancellationToken ct)
    {
        var level = AssessmentInput.Level(req.Certification);
        if (!AssessmentInput.IsId(req.ZedId) || level is null) return this.Problem400("Invalid request.");
        if (!await PendingForAssessor(req.ZedId!, level, ct)) return this.Problem400("This assessment is not allotted to you or was already answered.");

        await db.ExecuteProcAsync("SP_ASSESSMENT_ACCEPT_UNIT_FOR_DA_VERIFICATION", new { ZedId = req.ZedId, Certification = level }, ct);
        log.LogInformation("Assessor {UserId} accepted {ZedId} {Certification}", UserId, req.ZedId, level);
        return new MessageResponse("Unit accepted.");
    }

    [HttpPost("da-verification/reject")]
    [StaffRoles(UserRole.DesktopAssessor)]
    [SubRole(SubRoles.DesktopVerification)]
    public async Task<ActionResult<MessageResponse>> AssessorReject(RejectRequest req, CancellationToken ct)
    {
        var level = AssessmentInput.Level(req.Certification);
        if (!AssessmentInput.IsId(req.ZedId) || level is null) return this.Problem400("Invalid request.");
        if (Reason(req.ReasonForRejection) is not { } reason) return this.Problem400("Please enter reason for rejection.");
        if (!await PendingForAssessor(req.ZedId!, level, ct)) return this.Problem400("This assessment is not allotted to you or was already answered.");

        await db.ExecuteProcAsync("SP_ASSESSMENT_REJECT_UNIT_FOR_DA_VERIFICATION", new { ZedId = req.ZedId, Certification = level, ReasonForRejection = reason }, ct);
        log.LogInformation("Assessor {UserId} rejected {ZedId} {Certification}", UserId, req.ZedId, level);
        await Emails().SendAsync(DesktopAssessmentEmails.Kind.RejectedByAssessor, req.ZedId!, level, reason, ct);
        return new MessageResponse("Unit rejected.");
    }

    // ---------------------------------------------------------------- helpers

    /// <summary>The record is in the assessor's Desktop Verification list, allotted to it as desktop assessor and not yet answered.</summary>
    private async Task<bool> PendingForAssessor(string zedId, string level, CancellationToken ct)
    {
        var rows = (await List(db, UserId, RoleId, null, zedId, Filter.None with { Certification = level }, ct))[0];
        return rows.Any(r => Same(r, "ZedId", zedId) && Same(r, "Certification", level) && Same(r, "DesktopAssessorId", UserId) &&
                             !Flag(r, "DesktopAccepted") && r.Text("DesktopReasonForRejection").Length == 0);
    }

    private DesktopAssessmentEmails Emails() => DesktopAssessmentEmails.Create(HttpContext.RequestServices);

    /// <summary>Reason for rejection: required; the old pop-ups allowed 2000 characters.</summary>
    private static string? Reason(string? value) => AssessmentInput.Text(value) is { Length: <= 2000 } r ? r : null;
}
