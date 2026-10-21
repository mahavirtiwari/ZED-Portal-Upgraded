using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Assessment;

/// <summary>
/// Allocation of assessments to agencies by the master admin. Port of the AssessmentController actions used by
/// Views/Assessment/Allot: GetList (SP_ASSESSMENT_ALLOT_LIST), GetCb (SP_ASSESSMENT_AGENCIES_TO_ALLOT) and AllotCb
/// (SP_ASSESSMENT_ALLOT_TO_AGENCY). The agency and assessor work lists are in <see cref="DesktopAllotmentController"/>.
/// <para>
/// The legacy POST actions had no authorisation and took the ZED ID and agency from the browser, so anyone could
/// allot any MSME to anyone. Here the record must be in the master admin's allot list and the agency in the list
/// the procedure offers for it.
/// </para>
/// <para>Per system (same procedures and parameters, different rows and mails):</para>
/// <list type="bullet">
/// <item>Main: records at status 2/3; Bronze goes to desktop-verification agencies, Silver/Gold to site-verification agencies.</item>
/// <item>Consultancy ("Allot Consultancy"): the paid milestone (status 6, NcCount = milestone) goes to a Consultant
/// Organisation with site verification; mail "Allocation of MSME for Handholding Support (Milestone n)".</item>
/// <item>Surveillance ("Allot Surveillance"): Bronze at status 1 goes to agencies allowed for Bronze surveillance
/// (AllowBronzeSurveillance, the procedure also matches their preferred state), Silver/Gold at status 8 to site-verification
/// agencies; rows add SurveillanceNo and AutoAllocationDate; mail subjects say Surveillance.</item>
/// </list>
/// </summary>
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
[Route("api/staff/assessment")]
public sealed class AssessmentAllotmentController(ISqlExecutor db, PortalHost host, ILogger<AssessmentAllotmentController> log) : StaffApiController
{
    public sealed record ListResponse(IReadOnlyList<Dictionary<string, object?>> Rows);

    public sealed record Person(string UserId, string UserName);

    /// <summary>Allot screen (Assessment/Allot): records waiting for an agency or re-allotment.</summary>
    [HttpGet("allot")]
    [StaffRoles(UserRole.MasterAdmin)]
    public async Task<ActionResult<ListResponse>> AllotList(
        string? state, string? certification, string? size, string? gender, string? allotmentType, CancellationToken ct)
    {
        if (!AllotmentLists.Filters(state, certification, size, gender, out var f)) return this.Problem400("Invalid filter.");
        if (!AssessmentInput.Filter(allotmentType, ["ALLOT", "REALLOT"], out var type)) return this.Problem400("Invalid filter.");
        var sets = await AllotmentLists.List(db, UserId, RoleId, type, null, f, ct);
        string[] extra = host.System switch
        {
            PortalSystem.Consultancy => ["TimeDuration", "NcCount"],
            PortalSystem.Surveillance => ["TimeDuration", "SurveillanceNo", "AutoAllocationDate"],
            _ => ["TimeDuration", "UdyamStatus"],
        };
        return new ListResponse(AllotmentLists.Pick(sets[0], [.. AllotmentLists.ListFields, .. extra]));
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

        var listed = (await AllotmentLists.List(db, UserId, RoleId, null, req.ZedId, AllotmentLists.Filter.None with { Certification = level }, ct))[0]
            .Any(r => AllotmentLists.Same(r, "ZedId", req.ZedId!) && AllotmentLists.Same(r, "Certification", level));
        if (!listed) return this.Problem400("This assessment can no longer be allotted.");

        var agency = (await AgenciesFor(req.ZedId!, level, ct)).FirstOrDefault(a => string.Equals(a.UserId, req.AgencyUserId, StringComparison.OrdinalIgnoreCase));
        if (agency is null) return this.Problem400("Please select valid data.");

        await db.ExecuteProcAsync("SP_ASSESSMENT_ALLOT_TO_AGENCY",
            new { ZedId = req.ZedId, Certification = level, CertificationBodyUserId = agency.UserId }, ct);
        log.LogInformation("{UserId} allotted {ZedId} {Certification} to agency {Agency}", UserId, req.ZedId, level, agency.UserId);
        await DesktopAssessmentEmails.Create(HttpContext.RequestServices)
            .SendAsync(DesktopAssessmentEmails.Kind.AllottedToAgency, req.ZedId!, level, null, ct);
        return new MessageResponse(host.System == PortalSystem.Consultancy ? "Consultancy allotted." : "Assessment allotted.");
    }

    private async Task<IEnumerable<Person>> AgenciesFor(string zedId, string level, CancellationToken ct)
    {
        var rows = (await db.QueryProcMultipleAsync("SP_ASSESSMENT_AGENCIES_TO_ALLOT", new { ZedId = zedId }, ct))[0];
        // Bronze surveillance goes only to agencies allowed for it (the old Allot page filtered on AllowBronzeSurveillance).
        var column = level != "Bronze" ? "SiteVerification"
            : host.System == PortalSystem.Surveillance ? "AllowBronzeSurveillance" : "DesktopVerification";
        return rows.Where(r => AllotmentLists.Flag(r, column)).Select(r => new Person(r.Text("UserId"), r.Text("UserName")));
    }
}

/// <summary>SP_ASSESSMENT_ALLOT_LIST and the helpers the allotment controllers share.</summary>
internal static class AllotmentLists
{
    /// <summary>Columns the list screens show (the procedure selects whole Msme/Users rows).</summary>
    public static readonly string[] ListFields =
    [
        "RowNumber", "ZedId", "Certification", "PUnitName", "UnitAddress", "UnitSpocName", "UnitSpocMobileNo", "UnitSpocEmailId",
        "AgencyName", "CertificationBodyUserId", "ReasonForRejection", "DesktopReasonForRejection", "DesktopAssessorId",
        "DesktopAccepted", "CertificationStatus", "NcStatus", "ModeOfAssessment",
    ];

    public sealed record Filter(string? State, string? Certification, string? Size, string? Gender)
    {
        public static readonly Filter None = new(null, null, null, null);
    }

    public static bool Filters(string? state, string? certification, string? size, string? gender, out Filter filter)
    {
        filter = Filter.None;
        if (!AssessmentInput.State(state, out var s)) return false;
        if (!AssessmentInput.Filter(certification, AssessmentInput.Levels, out var c)) return false;
        if (!AssessmentInput.Filter(size, AssessmentInput.Sizes, out var z)) return false;
        if (!AssessmentInput.Filter(gender, AssessmentInput.Genders, out var g)) return false;
        filter = new Filter(s, c, z, g);
        return true;
    }

    /// <summary>
    /// SP_ASSESSMENT_ALLOT_LIST for the signed-in user (the procedure branches on RoleId and filters by UserId).
    /// The parameters exist in all three databases (Consultancy adds @Milestone, used only by the lists not ported).
    /// </summary>
    public static Task<ResultSets> List(ISqlExecutor db, string userId, int roleId, string? allotmentType, string? zedId, Filter f, CancellationToken ct) =>
        db.QueryProcMultipleAsync("SP_ASSESSMENT_ALLOT_LIST", new
        {
            UserId = userId,
            RoleId = roleId.ToString(System.Globalization.CultureInfo.InvariantCulture),
            AllotmentType = allotmentType,
            ZedId = zedId,
            CertificationType = f.Certification,
            State = f.State,
            MsmeSize = f.Size,
            Gender = f.Gender,
        }, ct);

    public static bool Same(IDictionary<string, object?> row, string column, string value) =>
        string.Equals(row.Text(column).Trim(), value, StringComparison.OrdinalIgnoreCase);

    public static bool Flag(IDictionary<string, object?> row, string column) =>
        row.TryGetValue(column, out var v) && v switch
        {
            bool b => b,
            null or DBNull => false,
            _ => v.ToString() is "1" or "True" or "true",
        };

    public static List<AssessmentAllotmentController.Person> People(IEnumerable<IDictionary<string, object?>> rows) =>
        rows.Select(r => new AssessmentAllotmentController.Person(r.Text("UserId"), r.Text("UserName"))).Where(p => p.UserId.Length > 0).ToList();

    public static List<Dictionary<string, object?>> Pick(IEnumerable<IDictionary<string, object?>> rows, string[] fields) =>
        rows.Select(r => fields.ToDictionary(f => f, f => r.TryGetValue(f, out var v) && v is not DBNull ? v : null)).ToList();
}
