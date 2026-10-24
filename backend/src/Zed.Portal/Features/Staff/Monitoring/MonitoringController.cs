using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using static Zed.Portal.Features.Staff.SiteAssessment.AssessmentInputs;

namespace Zed.Portal.Features.Staff.Monitoring;

/// <summary>
/// Assessment monitoring. Port of MonitoringController.Index and the actions Views/Monitoring/Index.cshtml
/// calls: GetList (SP_MONITORING_GET_LIST), ExtendNcClosureDate (SP_EXTEND_NC_CLOSURE_DATE),
/// StepBackToAssessor (SP_MOVING_ONE_STEP_BACK_OF_NC) and SendBackToAgencyForReAllot
/// (SP_MONITORING_SEND_BACK_TO_AGENCY_FOR_REALLOCATION).
/// <para>
/// In the old controller only Index and GetList were limited to MasterAdmin/Agency; the three actions
/// that change or delete assessment data were open to any signed-in user (MSMEs included), for any ZED ID.
/// Here they are MasterAdmin only (the page showed their buttons to MasterAdmin only), and the unit must be
/// in the state in which the page offered the button.
/// </para>
/// <para>The review actions of the DA/SA details pages are in <see cref="MonitoringReviewController"/>.</para>
/// <para>Per system (the list's status numbers are the same in all three procedures):</para>
/// <list type="bullet">
/// <item>Consultancy ("Consultancy Monitoring"): Silver/Gold only, tabs 2/3/5 (no NC or rejected tab), no NC closure
/// filter (its SP_MONITORING_GET_LIST has no @NcClosingDate); rows add the milestone (NcCount), technical experts and
/// BDS/HAP dates. Extend, step back and send back are not offered (no NC round; SP_MOVING_ONE_STEP_BACK_OF_NC and
/// SP_MONITORING_SEND_BACK_TO_AGENCY_FOR_REALLOCATION are missing there).</item>
/// <item>Surveillance ("Surveillance Monitoring"): rows add SurveillanceNo; send back to the agency (re-allot) is not
/// offered (its procedure is missing there); step back as on main; extend also on the rejected tab (its page showed
/// "Extend NC Final Closure Date" for <c>filter.status==4 || filter.status==7</c>).</item>
/// </list>
/// </summary>
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
[Route("api/staff/monitoring")]
[StaffRoles(UserRole.MasterAdmin, UserRole.Agency)]
public sealed class MonitoringController(ISqlExecutor db, PortalHost host, ILogger<MonitoringController> log) : StaffApiController
{
    /// <summary>Status tabs of the page (SP_MONITORING_GET_LIST @Status).</summary>
    public static readonly int[] Statuses = [2, 3, 4, 5, 7];

    /// <summary>Consultancy tabs: not started, in progress, quality check.</summary>
    private static readonly int[] ConsultancyStatuses = [2, 3, 5];

    private static readonly string[] ConsultancyLevels = ["Silver", "Gold"];

    private bool Consultancy => host.System == PortalSystem.Consultancy;

    private const int NonConformance = 4;

    private const int Rejected = 7;

    private static readonly string[] Fields =
    [
        "RowNumber", "ZedId", "Certification", "PUnitName", "UnitAddress",
        "AgencyName", "CertificationBodyUserId", "ModeOfAssessment",
        "DesktopAssessorName", "DesktopAssessorId", "SiteAssessorName", "SiteAssessorId", "CoAssessorName", "CoAssessorId",
        "SameUdyamAddress", "DocVerifiAllot", "SaAssessmentDate", "CertificationStatus", "NcStatus", "NcCount",
    ];

    private static readonly string[] ConsultancyFields =
    [
        "RowNumber", "ZedId", "Certification", "PUnitName", "UnitAddress", "AgencyName", "CertificationBodyUserId",
        "SiteAssessorName", "SiteAssessorId", "CoAssessorName", "CoAssessorId", "TechExpertName", "TechExpert",
        "DocVerifiAllot", "SaAssessmentDate", "BdsFromDate", "HapFromDate", "CertificationStatus", "NcStatus", "NcCount",
    ];

    private static readonly string[] SurveillanceFields =
    [
        "RowNumber", "ZedId", "Certification", "SurveillanceNo", "PUnitName", "UnitAddress",
        "AgencyName", "CertificationBodyUserId", "ModeOfAssessment",
        "DesktopAssessorName", "DesktopAssessorId", "SiteAssessorName", "SiteAssessorId", "CoAssessorName", "CoAssessorId",
        "DocVerifiAllot", "SaAssessmentDate", "CertificationStatus", "NcStatus", "NcCount",
    ];

    /// <summary>Shown to MasterAdmin only (the page hid the column from agencies).</summary>
    private static readonly string[] MasterAdminFields = ["NcFinalClosureDt"];

    private static readonly string[] CountFields = ["NotStarted", "InProgress", "Qc", "Nc", "Rj"];

    public sealed record ListResponse(
        IReadOnlyList<Dictionary<string, object?>> Units, Dictionary<string, object?> Counts, bool CanManage);

    public sealed record UnitRequest(string? ZedId, string? Certification);

    public sealed record ExtendRequest(string? ZedId, string? Certification, int NoOfDays);

    [HttpGet]
    public async Task<ActionResult<ListResponse>> List(
        [FromQuery] string? certification, [FromQuery] int? status, [FromQuery] string? ncClosingDate, CancellationToken ct)
    {
        if (IsRole(UserRole.Agency) && !CurrentUser.HasSubRole(SubRoles.SiteVerification) && !CurrentUser.HasSubRole(SubRoles.DesktopVerification))
            return Forbid();

        var level = Level(certification, Consultancy ? ConsultancyLevels : Levels);
        if (level is null || (status is not null && !(Consultancy ? ConsultancyStatuses : Statuses).Contains(status.Value)))
            return this.Problem400("Please select valid data.");

        string? ncDate = null;
        if (!string.IsNullOrWhiteSpace(ncClosingDate))
        {
            if (Consultancy || status != NonConformance || IsoDate(ncClosingDate) is not { } d)
                return this.Problem400("Please select a valid NC closure date.");
            ncDate = d.ToString("MM/dd/yyyy", System.Globalization.CultureInfo.InvariantCulture); // CONVERT(..., 101)
        }

        var sets = await ListAsync(level, status, null, ncDate, ct);
        var master = IsRole(UserRole.MasterAdmin);
        var fields = host.System switch
        {
            PortalSystem.Consultancy => ConsultancyFields,
            PortalSystem.Surveillance => SurveillanceFields,
            _ => Fields,
        };
        return new ListResponse(
            Pick(sets[0], master ? fields.Concat(MasterAdminFields) : fields),
            Pick(sets[1].Take(1), CountFields).FirstOrDefault() ?? CountFields.ToDictionary(f => f, _ => (object?)0),
            master);
    }

    /// <summary>Moves the NC final closure date of a unit in non-conformance (surveillance: or rejected) by 1 to 30 days.</summary>
    [HttpPost("extend-nc-closure")]
    [StaffRoles(UserRole.MasterAdmin)]
    public async Task<ActionResult<MessageResponse>> ExtendNcClosure(ExtendRequest req, CancellationToken ct)
    {
        if (Consultancy) return NotFound();
        if (req.NoOfDays is < 1 or > 30)
            return this.Problem400("Please select the number of days (1 to 30).");
        int[] tabs = host.System == PortalSystem.Surveillance ? [NonConformance, Rejected] : [NonConformance];
        var (unit, problem) = await FindAsync(req.ZedId, req.Certification, tabs, ct);
        if (unit is null) return problem!;

        await db.ExecuteProcAsync("SP_EXTEND_NC_CLOSURE_DATE", new
        {
            ZedId = unit.Text("ZedId"),
            CertificationType = unit.Text("Certification"),
            req.NoOfDays,
            UserId,
            RoleId,
        }, ct);
        return new MessageResponse("NC final closure date extended.");
    }

    /// <summary>Removes the current NC round and returns the unit to the assessor (NC n → NC n-1).</summary>
    [HttpPost("step-back-nc")]
    [StaffRoles(UserRole.MasterAdmin)]
    public async Task<ActionResult<MessageResponse>> StepBackNc(UnitRequest req, CancellationToken ct)
    {
        if (Consultancy) return NotFound(); // SP_MOVING_ONE_STEP_BACK_OF_NC is missing in ZED_CONSULTANT
        var (unit, problem) = await FindAsync(req.ZedId, req.Certification, [NonConformance], ct);
        if (unit is null) return problem!;
        if (Int(unit, "NcCount") < 1)
            return this.Problem400("There is no non-conformance round to step back from.");

        try
        {
            await db.ExecuteProcAsync("SP_MOVING_ONE_STEP_BACK_OF_NC", new
            {
                ZedId = unit.Text("ZedId"),
                UserId,
                RoleId = RoleId.ToString(),
                CertificationType = unit.Text("Certification"),
            }, ct);
        }
        catch (Microsoft.Data.SqlClient.SqlException ex)
        {
            // The procedure forces an error when the unit is not in NC; never show its text.
            log.LogWarning(ex, "NC step back refused for {ZedId}", unit.Text("ZedId"));
            return this.Problem400("Invalid Details.");
        }
        return new MessageResponse("Stepped back to the previous NC.");
    }

    /// <summary>Resets a scheduled/started site assessment so the agency can allot it again (not for Bronze).</summary>
    [HttpPost("send-back-to-agency")]
    [StaffRoles(UserRole.MasterAdmin)]
    public async Task<ActionResult<MessageResponse>> SendBackToAgency(UnitRequest req, CancellationToken ct)
    {
        // SP_MONITORING_SEND_BACK_TO_AGENCY_FOR_REALLOCATION exists only in the main database.
        if (host.System != PortalSystem.Main) return NotFound();
        if (Level(req.Certification, SiteLevels) is null)
            return this.Problem400("Please select valid data.");
        // The page offered this on "Scheduled but not started" (status 8) and "In progress" (status 9).
        var (unit, problem) = await FindAsync(req.ZedId, req.Certification, [2, 3], ct,
            r => Int(r, "CertificationStatus") is 8 or 9);
        if (unit is null) return problem!;

        var result = (await db.QueryProcMultipleAsync("SP_MONITORING_SEND_BACK_TO_AGENCY_FOR_REALLOCATION", new
        {
            ZedId = unit.Text("ZedId"),
            UserId,
            RoleId = RoleId.ToString(),
            CertificationType = unit.Text("Certification"),
        }, ct))[0].FirstOrDefault();

        if (result is not null && result.Text("Status") == "0")
            return this.Problem400("Invalid Details.");
        return new MessageResponse("Sent back to the agency for re-allocation.");
    }

    /// <summary>SP_MONITORING_GET_LIST; ZED_CONSULTANT's version has no @NcClosingDate.</summary>
    private Task<ResultSets> ListAsync(string level, int? status, string? zedId, string? ncDate, CancellationToken ct) =>
        Consultancy
            ? db.QueryProcMultipleAsync("SP_MONITORING_GET_LIST", new
            {
                UserId,
                RoleId = RoleId.ToString(),
                Status = status,
                CertificationType = level,
                ZedId = zedId,
            }, ct)
            : db.QueryProcMultipleAsync("SP_MONITORING_GET_LIST", new
            {
                UserId,
                RoleId = RoleId.ToString(),
                Status = status,
                CertificationType = level,
                ZedId = zedId,
                NcClosingDate = ncDate,
            }, ct);

    /// <summary>The unit as the monitoring list shows it on one of the given status tabs, or the error to return.</summary>
    private async Task<(IDictionary<string, object?>? Unit, ActionResult? Problem)> FindAsync(
        string? zedId, string? certification, int[] statuses, CancellationToken ct,
        Func<IDictionary<string, object?>, bool>? condition = null)
    {
        zedId = zedId?.Trim();
        var level = Level(certification, Levels);
        if (!IsId(zedId) || level is null)
            return (null, this.Problem400("Please select valid data."));

        foreach (var status in statuses)
        {
            var row = (await ListAsync(level, status, zedId, null, ct))[0]
                .FirstOrDefault(r => Same(r, "ZedId", zedId!) && Same(r, "Certification", level) && (condition?.Invoke(r) ?? true));
            if (row is not null) return (row, null);
        }
        return (null, this.Problem400("This action is not available for the unit in its current status."));
    }
}
