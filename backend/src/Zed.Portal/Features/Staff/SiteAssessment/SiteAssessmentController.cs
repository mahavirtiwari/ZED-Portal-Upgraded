using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using static Zed.Portal.Features.Staff.SiteAssessment.AssessmentInputs;

namespace Zed.Portal.Features.Staff.SiteAssessment;

/// <summary>
/// Site (on-site/remote) assessment allotment and the assessor's list of allotted assessments.
/// Port of AssessmentController.SaAllotment / RemoteAssessments and the actions their views call
/// (GetList with allotmentType SA / RA, AcceptUnitForSa), all over SP_ASSESSMENT_ALLOT_LIST.
/// <para>
/// Legacy holes closed here: GetList and AcceptUnitForSa had no role check, the allotment type came
/// from the browser (any signed-in user could read any branch of the procedure), and
/// SP_ASSESSMENT_ACCEPT_UNIT_FOR_SA updates any ZED ID without checking that the unit belongs to the
/// calling agency or that the assessors are the agency's own. Both are verified here.
/// </para>
/// <para>
/// Surveillance (ZEDCS_SURVEILLANCE Assessment/SaAllotment, Silver/Gold surveillance): the agency also enters the
/// MeetingLink of the external video meeting (http/https only), which is passed to the surveillance
/// SP_ASSESSMENT_ACCEPT_UNIT_FOR_SA (@MeetingLink) and put in the allotment mails; the list procedure there also
/// returns units at status 9 that nobody has joined yet (re-allotment), and the original certification's lead and
/// co-assessor. Consultancy uses <see cref="ConsultancyAllotmentController"/> instead (milestones, several co-consultants).
/// </para>
/// </summary>
[Route("api/staff/site-assessment")]
[PortalSystems(PortalSystem.Main, PortalSystem.Surveillance)]
public sealed class SiteAssessmentController(ISqlExecutor db, PortalHost host, ILogger<SiteAssessmentController> log) : StaffApiController
{
    /// <summary>The only mode the old allotment pop-up offers ("Remote Assessment" is commented out there).</summary>
    public const string Onsite = "Onsite Assessment";

    private static readonly string[] AllotmentFields =
    [
        "ZedId", "Certification", "PUnitName", "EnterpriseName", "UnitAddress",
        "UnitSpocName", "UnitSpocMobileNo", "UnitSpocEmailId",
        "SiteAssessorId", "SaAssessorName", "CoAssessorName", "ReasonForRejection", "CertificationStatus", "RowNumber",
    ];

    /// <summary>Surveillance list adds the surveillance date and round, and who assessed the original certification.</summary>
    private static readonly string[] SurveillanceAllotmentFields =
    [
        .. AllotmentFields, "CoAssessorId", "AssessmentDate", "SurveillanceNo",
        "LeadInCertification", "LeadNameInCertification", "CoInCertification", "CoNameInCertification",
    ];

    /// <summary>Meeting links: SP_ASSESSMENT_ACCEPT_UNIT_FOR_SA @MeetingLink is varchar(5000); 2000 is plenty for Teams/Meet/Zoom links.</summary>
    public const int MaxMeetingLink = 2000;

    private bool Surveillance => host.System == PortalSystem.Surveillance;

    private static readonly string[] RemoteFields =
    [
        "ZedId", "Certification", "EnterpriseName", "PUnitName", "UnitAddress",
        "UnitSpocName", "UnitSpocMobileNo", "UnitSpocEmailId",
        "AgencyName", "CertificationBodyUserId", "ModeOfAssessment", "AssessmentDate", "CertificationStatus", "RowNumber",
    ];

    public sealed record Assessor(string UserId, string UserName);

    public sealed record AllotmentsResponse(IReadOnlyList<Dictionary<string, object?>> Units, IReadOnlyList<Assessor> Assessors);

    public sealed record AllotRequest(
        string? ZedId, string? Certification, string? SiteAssessorId, string? CoAssessorId,
        string? AssessmentDate, string? ModeOfAssessment, string? MeetingLink = null);

    /// <summary>Units waiting for (re-)allotment of the site assessment, and the agency's site assessors.</summary>
    [HttpGet("allotments")]
    [StaffRoles(UserRole.Agency)]
    [SubRole(SubRoles.SiteVerification)]
    public async Task<ActionResult<AllotmentsResponse>> Allotments(CancellationToken ct)
    {
        var sets = await AgencyListAsync(null, null, ct);
        return new AllotmentsResponse(Pick(sets[0], Surveillance ? SurveillanceAllotmentFields : AllotmentFields), Assessors(sets));
    }

    /// <summary>Allots (or re-allots) the on-site assessment of one of the agency's units.</summary>
    [HttpPost("allotments")]
    [StaffRoles(UserRole.Agency)]
    [SubRole(SubRoles.SiteVerification)]
    public async Task<ActionResult<MessageResponse>> Allot(AllotRequest req, CancellationToken ct)
    {
        var zedId = req.ZedId?.Trim();
        var certification = Level(req.Certification, SiteLevels);
        var lead = req.SiteAssessorId?.Trim();
        var co = string.IsNullOrWhiteSpace(req.CoAssessorId) ? null : req.CoAssessorId.Trim();
        var date = IsoDate(req.AssessmentDate);
        var today = DateOnly.FromDateTime(DateTime.Now);

        if (!IsId(zedId) || certification is null || !IsId(lead) || (co is not null && !IsId(co)) ||
            date is null || req.ModeOfAssessment?.Trim() != Onsite)
            return this.Problem400("Please select valid data.");
        if (date < today || date > today.AddYears(1))
            return this.Problem400("Please select a valid assessment date.");
        if (co is not null && string.Equals(co, lead, StringComparison.OrdinalIgnoreCase))
            return this.Problem400("Lead Assessor and Co Assessor must be different.");
        // Only the surveillance procedure has @MeetingLink; on Main the value is ignored.
        var meetingLink = Surveillance ? AssessmentInputs.WebLink(req.MeetingLink, MaxMeetingLink) : null;
        if (Surveillance && meetingLink is null)
            return this.Problem400("Please enter a valid meeting link (starting with https:// or http://).");

        // The unit must be in this agency's list, in the state where the old page offered ALLOT/RE-ALLOT.
        var sets = await AgencyListAsync(zedId, certification, ct);
        var unit = sets[0].FirstOrDefault(r => Same(r, "ZedId", zedId!) && Same(r, "Certification", certification));
        if (unit is null)
            return NotFound();
        if (unit.Text("SiteAssessorId").Length == 0 && unit.Text("ReasonForRejection").Length > 0)
            return this.Problem400("This unit cannot be allotted.");

        var assessors = Assessors(sets);
        if (!assessors.Any(a => string.Equals(a.UserId, lead, StringComparison.OrdinalIgnoreCase)) ||
            (co is not null && !assessors.Any(a => string.Equals(a.UserId, co, StringComparison.OrdinalIgnoreCase))))
            return this.Problem400("Please select an assessor of your agency.");

        try
        {
            var assessmentDate = date.Value.ToString("yyyy-MM-dd");
            object args = Surveillance
                ? new { ZedId = zedId, Certification = certification, SiteAssessorId = lead, CoAssessorId = co, AssessmentDate = assessmentDate, ModeOfAssessment = Onsite, MeetingLink = meetingLink }
                : new { ZedId = zedId, Certification = certification, SiteAssessorId = lead, CoAssessorId = co, AssessmentDate = assessmentDate, ModeOfAssessment = Onsite };
            await db.ExecuteProcAsync("SP_ASSESSMENT_ACCEPT_UNIT_FOR_SA", args, ct);
        }
        catch (Microsoft.Data.SqlClient.SqlException ex)
        {
            log.LogError(ex, "Site assessment allotment failed for {ZedId} {Certification}", zedId, certification);
            return this.Problem400("Unable to allot the unit. Please try again.");
        }

        var mails = ActivatorUtilities.CreateInstance<SiteAllotmentEmails>(HttpContext.RequestServices);
        if (Surveillance) await mails.SendSurveillanceAllotmentAsync(zedId!, certification, ct);
        else await mails.SendOnsiteAllotmentAsync(zedId!, certification, ct);
        return new MessageResponse("Unit allotted.");
    }

    /// <summary>Remote/on-site assessments allotted to the signed-in assessor (lead or co-assessor).</summary>
    [HttpGet("remote-assessments")]
    [StaffRoles(UserRole.DesktopAssessor)]
    [SubRole(SubRoles.SiteVerification)]
    public async Task<ActionResult<IReadOnlyList<Dictionary<string, object?>>>> RemoteAssessments(CancellationToken ct)
    {
        var sets = await db.QueryProcMultipleAsync("SP_ASSESSMENT_ALLOT_LIST",
            new { UserId, RoleId = ((int)UserRole.DesktopAssessor).ToString(), AllotmentType = "RA" }, ct);
        return Pick(sets[0], RemoteFields);
    }

    /// <summary>SA branch of the agency list: CertificationBodyUserId = the signed-in agency, status 6 or 8.</summary>
    private Task<ResultSets> AgencyListAsync(string? zedId, string? certification, CancellationToken ct) =>
        db.QueryProcMultipleAsync("SP_ASSESSMENT_ALLOT_LIST", new
        {
            UserId,
            RoleId = ((int)UserRole.Agency).ToString(),
            AllotmentType = "SA",
            ZedId = zedId,
            CertificationType = certification,
        }, ct);

    /// <summary>Second result set: the agency's active site assessors (Users.CreatedBy = agency).</summary>
    private static List<Assessor> Assessors(ResultSets sets) =>
        sets[1].Select(r => new Assessor(r.Text("UserId"), r.Text("UserName"))).Where(a => a.UserId.Length > 0).ToList();
}
