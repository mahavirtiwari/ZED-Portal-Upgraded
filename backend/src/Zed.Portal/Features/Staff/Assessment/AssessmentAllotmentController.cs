using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Assessment;

/// <summary>
/// Allocation of desktop assessments and the assessors' work lists. Port of the AssessmentController
/// actions used by Views/Assessment/Allot, DaAllotment, DaVerification and NonConfirmances:
/// GetList (SP_ASSESSMENT_ALLOT_LIST), GetCb (SP_ASSESSMENT_AGENCIES_TO_ALLOT), AllotCb
/// (SP_ASSESSMENT_ALLOT_TO_AGENCY), AcceptUnitForDa / RejectUnitForDa (SP_ASSESSMENT_ACCEPT_UNIT_FOR_DA /
/// SP_ASSESSMENT_REJECT_UNIT_FOR_DA) and AcceptUnitForDaVerification / RejectUnitForDaVerification.
/// <para>
/// The legacy POST actions had no authorisation and took the ZED ID, agency and assessor from the
/// browser, so anyone could allot any MSME to anyone. Here every action is limited to the role of its
/// screen, and the record (and the chosen agency or assessor) must be in the list the procedure gives
/// the signed-in user: the list procedures are scoped by UserId/RoleId from the sign-in cookie.
/// </para>
/// </summary>
[Route("api/staff/assessment")]
public sealed class AssessmentAllotmentController(ISqlExecutor db, ILogger<AssessmentAllotmentController> log) : StaffApiController
{
    /// <summary>Columns the list screens show (the procedure selects whole Msme/Users rows).</summary>
    private static readonly string[] ListFields =
    [
        "RowNumber", "ZedId", "Certification", "PUnitName", "UnitAddress", "UnitSpocName", "UnitSpocMobileNo", "UnitSpocEmailId",
        "AgencyName", "CertificationBodyUserId", "ReasonForRejection", "DesktopReasonForRejection", "DesktopAssessorId",
        "DesktopAccepted", "CertificationStatus", "NcStatus", "ModeOfAssessment",
    ];

    public sealed record ListResponse(IReadOnlyList<Dictionary<string, object?>> Rows);

    public sealed record Person(string UserId, string UserName);

    // ---------------------------------------------------------------- master admin: allot to agency

    /// <summary>Allot screen (Assessment/Allot): records waiting for an agency or re-allotment.</summary>
    [HttpGet("allot")]
    [StaffRoles(UserRole.MasterAdmin)]
    public async Task<ActionResult<ListResponse>> AllotList(
        string? state, string? certification, string? size, string? gender, string? allotmentType, CancellationToken ct)
    {
        if (!Filters(state, certification, size, gender, out var f)) return this.Problem400("Invalid filter.");
        if (!AssessmentInput.Filter(allotmentType, ["ALLOT", "REALLOT"], out var type)) return this.Problem400("Invalid filter.");
        var sets = await List(type, null, f, ct);
        return new ListResponse(Pick(sets[0], [.. ListFields, "TimeDuration", "UdyamStatus"]));
    }

    /// <summary>Agencies that may be given this record (GetCb), filtered as the old pop-up did.</summary>
    [HttpGet("allot/agencies")]
    [StaffRoles(UserRole.MasterAdmin)]
    public async Task<ActionResult<IReadOnlyList<Person>>> Agencies(string? zedId, string? certification, CancellationToken ct)
    {
        var level = AssessmentInput.Level(certification);
        if (!AssessmentInput.IsId(zedId) || level is null) return this.Problem400("Invalid request.");
        return (await AgenciesFor(zedId!, level, ct)).ToList();
    }

    public sealed record AllotToAgencyRequest(string? ZedId, string? Certification, string? AgencyUserId);

    [HttpPost("allot")]
    [StaffRoles(UserRole.MasterAdmin)]
    public async Task<ActionResult<MessageResponse>> AllotToAgency(AllotToAgencyRequest req, CancellationToken ct)
    {
        var level = AssessmentInput.Level(req.Certification);
        if (!AssessmentInput.IsId(req.ZedId) || level is null) return this.Problem400("Invalid request.");
        if (!AssessmentInput.IsId(req.AgencyUserId)) return this.Problem400("Please select valid data.");

        var listed = (await List(null, req.ZedId, Filter.None with { Certification = level }, ct))[0]
            .Any(r => Same(r, "ZedId", req.ZedId!) && Same(r, "Certification", level));
        if (!listed) return this.Problem400("This assessment can no longer be allotted.");

        var agency = (await AgenciesFor(req.ZedId!, level, ct)).FirstOrDefault(a => string.Equals(a.UserId, req.AgencyUserId, StringComparison.OrdinalIgnoreCase));
        if (agency is null) return this.Problem400("Please select valid data.");

        await db.ExecuteProcAsync("SP_ASSESSMENT_ALLOT_TO_AGENCY",
            new { ZedId = req.ZedId, Certification = level, CertificationBodyUserId = agency.UserId }, ct);
        log.LogInformation("{UserId} allotted {ZedId} {Certification} to agency {Agency}", UserId, req.ZedId, level, agency.UserId);
        await Emails().SendAsync(DesktopAssessmentEmails.Kind.AllottedToAgency, req.ZedId!, level, null, ct);
        return new MessageResponse("Assessment allotted.");
    }

    // ---------------------------------------------------------------- agency: allot to desktop assessor

    public sealed record DaAllotmentResponse(
        IReadOnlyList<Dictionary<string, object?>> Rows,
        IReadOnlyList<Person> Assessors,
        IReadOnlyList<Person> BronzeAssessors);

    /// <summary>DA Allotment screen: the agency's records waiting for a desktop assessor, and its assessors.</summary>
    [HttpGet("da-allotment")]
    [StaffRoles(UserRole.Agency)]
    [SubRole(SubRoles.DesktopVerification)]
    public async Task<ActionResult<DaAllotmentResponse>> DaAllotmentList(CancellationToken ct)
    {
        var sets = await List("DA", null, Filter.None, ct);
        return new DaAllotmentResponse(Pick(sets[0], [.. ListFields, "DaAssessorName"]), People(sets[1]), People(sets[2]));
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

        var sets = await List("DA", req.ZedId, Filter.None with { Certification = level }, ct);
        var row = sets[0].FirstOrDefault(r => Same(r, "ZedId", req.ZedId!) && Same(r, "Certification", level));
        if (row is null) return this.Problem400("This assessment is not allotted to your agency or can no longer be allotted.");

        // Bronze goes to the agency's Bronze assessors (fewer than 10 allotments today), the rest to its other assessors.
        var assessors = People(level == "Bronze" ? sets[2] : sets[1]);
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

        var row = (await List("DA", req.ZedId, Filter.None with { Certification = level }, ct))[0]
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

    /// <summary>Desktop Verification screen: records allotted to the signed-in assessor (status below 4).</summary>
    [HttpGet("da-verification")]
    [StaffRoles(UserRole.DesktopAssessor)]
    [SubRole(SubRoles.DesktopVerification)]
    public async Task<ActionResult<ListResponse>> DaVerificationList(CancellationToken ct) =>
        new ListResponse(Pick((await List(null, null, Filter.None, ct))[0], ListFields));

    /// <summary>Non-Conformances screen: the assessor's records with an open NC round (DA status 4, SA status 14).</summary>
    [HttpGet("non-conformances")]
    [StaffRoles(UserRole.DesktopAssessor)]
    public async Task<ActionResult<ListResponse>> NonConformancesList(
        string? state, string? certification, string? size, string? gender, CancellationToken ct)
    {
        if (!Filters(state, certification, size, gender, out var f)) return this.Problem400("Invalid filter.");
        return new ListResponse(Pick((await List("NC", null, f, ct))[0], ListFields));
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

    private sealed record Filter(string? State, string? Certification, string? Size, string? Gender)
    {
        public static readonly Filter None = new(null, null, null, null);
    }

    private static bool Filters(string? state, string? certification, string? size, string? gender, out Filter filter)
    {
        filter = Filter.None;
        if (!AssessmentInput.State(state, out var s)) return false;
        if (!AssessmentInput.Filter(certification, AssessmentInput.Levels, out var c)) return false;
        if (!AssessmentInput.Filter(size, AssessmentInput.Sizes, out var z)) return false;
        if (!AssessmentInput.Filter(gender, AssessmentInput.Genders, out var g)) return false;
        filter = new Filter(s, c, z, g);
        return true;
    }

    /// <summary>SP_ASSESSMENT_ALLOT_LIST for the signed-in user (the procedure branches on RoleId and filters by UserId).</summary>
    private Task<ResultSets> List(string? allotmentType, string? zedId, Filter f, CancellationToken ct) =>
        db.QueryProcMultipleAsync("SP_ASSESSMENT_ALLOT_LIST", new
        {
            UserId,
            RoleId = RoleId.ToString(System.Globalization.CultureInfo.InvariantCulture),
            AllotmentType = allotmentType,
            ZedId = zedId,
            CertificationType = f.Certification,
            State = f.State,
            MsmeSize = f.Size,
            Gender = f.Gender,
        }, ct);

    private async Task<IEnumerable<Person>> AgenciesFor(string zedId, string level, CancellationToken ct)
    {
        var rows = (await db.QueryProcMultipleAsync("SP_ASSESSMENT_AGENCIES_TO_ALLOT", new { ZedId = zedId }, ct))[0];
        var column = level == "Bronze" ? "DesktopVerification" : "SiteVerification";
        return rows.Where(r => Flag(r, column)).Select(r => new Person(r.Text("UserId"), r.Text("UserName")));
    }

    /// <summary>The record is in the assessor's Desktop Verification list, allotted to it as desktop assessor and not yet answered.</summary>
    private async Task<bool> PendingForAssessor(string zedId, string level, CancellationToken ct)
    {
        var rows = (await List(null, zedId, Filter.None with { Certification = level }, ct))[0];
        return rows.Any(r => Same(r, "ZedId", zedId) && Same(r, "Certification", level) && Same(r, "DesktopAssessorId", UserId) &&
                             !Flag(r, "DesktopAccepted") && r.Text("DesktopReasonForRejection").Length == 0);
    }

    private DesktopAssessmentEmails Emails() => DesktopAssessmentEmails.Create(HttpContext.RequestServices);

    /// <summary>Reason for rejection: required; the old pop-ups allowed 2000 characters.</summary>
    private static string? Reason(string? value) => AssessmentInput.Text(value) is { Length: <= 2000 } r ? r : null;

    private static bool Same(IDictionary<string, object?> row, string column, string value) =>
        string.Equals(row.Text(column).Trim(), value, StringComparison.OrdinalIgnoreCase);

    private static bool Flag(IDictionary<string, object?> row, string column) =>
        row.TryGetValue(column, out var v) && v switch
        {
            bool b => b,
            null or DBNull => false,
            _ => v.ToString() is "1" or "True" or "true",
        };

    private static List<Person> People(IEnumerable<IDictionary<string, object?>> rows) =>
        rows.Select(r => new Person(r.Text("UserId"), r.Text("UserName"))).Where(p => p.UserId.Length > 0).ToList();

    private static List<Dictionary<string, object?>> Pick(IEnumerable<IDictionary<string, object?>> rows, string[] fields) =>
        rows.Select(r => fields.ToDictionary(f => f, f => r.TryGetValue(f, out var v) && v is not DBNull ? v : null)).ToList();
}
