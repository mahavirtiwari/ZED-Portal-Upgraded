using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Assessment;

/// <summary>
/// Completed and rejected certifications (Views/Assessment/Completed.cshtml and Rejected.cshtml). Port of
/// AssessmentController.GetCompletedList (SP_MONITORING_GET_LIST_PAGINATION with Status 6 / 99). The legacy
/// action had no authorisation; the procedure itself limits the rows by the user's role (master admin all,
/// agency its own, assessor the ones it assessed), with UserId from the sign-in cookie.
/// <para>
/// Consultancy ("Consultancy Completed") and Surveillance ("Completed / Rejected Surveillance") have no paginated
/// procedure: their pages called Monitoring/GetList (SP_MONITORING_GET_LIST, all rows of the status), so the search
/// and paging are done here on that list, and the response has the same shape. Consultancy rows are milestones
/// (NcCount) with the milestone-report and recommended-technology columns; Consultancy has no Rejected list.
/// Surveillance rows add SurveillanceNo.
/// </para>
/// </summary>
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
[Route("api/staff/assessment")]
[StaffRoles(UserRole.MasterAdmin, UserRole.Agency, UserRole.DesktopAssessor)]
public sealed class AssessmentResultsController(ISqlExecutor db, PortalHost host) : StaffApiController
{
    private static readonly string[] Fields =
    [
        "RowNumber", "ZedId", "RejectedZedId", "Certification", "CertificationPhase", "PUnitName", "UnitAddress", "ModeOfAssessment",
        "AgencyName", "CertificationBodyUserId", "DesktopAssessorName", "DesktopAssessorId", "SiteAssessorName", "SiteAssessorId",
        "CoAssessorName", "CoAssessorId", "DeskAssessment", "SiteAssessment", "DocVerifiAllot", "ScheduledOn",
        "DesktopVerificationCompleted", "CompletedOn", "SaAssessmentDate", "CertificationStatusDate", "FirstSurveDueDate",
        "SameUdyamAddress", "CertificationStatus", "PledgePath", "CertificationPath",
    ];

    private static readonly string[] SurveillanceFields =
    [
        "RowNumber", "ZedId", "RejectedZedId", "Certification", "SurveillanceNo", "PUnitName", "UnitAddress", "ModeOfAssessment",
        "AgencyName", "CertificationBodyUserId", "DesktopAssessorName", "DesktopAssessorId", "SiteAssessorName", "SiteAssessorId",
        "CoAssessorName", "CoAssessorId", "DeskAssessment", "SiteAssessment", "DocVerifiAllot", "ScheduledOn",
        "DesktopVerificationCompleted", "CompletedOn", "SaAssessmentDate", "CertificationStatusDate", "CertificationStatus", "CertificationPath",
    ];

    /// <summary>Consultancy: one row per completed milestone (NcCount); DisplayRecTech / TuStatus drive "Recommended Technologies".</summary>
    private static readonly string[] ConsultancyFields =
    [
        "RowNumber", "ZedId", "Certification", "PUnitName", "UnitAddress", "NcCount",
        "AgencyName", "CertificationBodyUserId", "DesktopAssessorName", "DesktopAssessorId", "SiteAssessorName", "SiteAssessorId",
        "CoAssessorName", "CoAssessorId", "TechExpert", "TechExpertName", "DocVerifiAllot", "CertificationStatusDate",
        "CertificationStatus", "DisplayRecTech", "TuStatus",
    ];

    private static readonly string[] SearchBy = ["Zed Id", "Udyam Number", "Unit Name"];

    public sealed record PageResponse(IReadOnlyList<Dictionary<string, object?>> Rows, int TotalCount, int PageNo, int PageSize);

    [HttpGet("completed")]
    public Task<ActionResult<PageResponse>> Completed(
        string? state, string? certification, string? size, string? searchBy, string? search, int? pageNo, int? pageSize, CancellationToken ct) =>
        List(6, state, certification, size, searchBy, search, pageNo, pageSize, ct);

    [HttpGet("rejected")]
    public async Task<ActionResult<PageResponse>> Rejected(
        string? state, string? certification, string? size, string? searchBy, string? search, int? pageNo, int? pageSize, CancellationToken ct)
    {
        // The consultancy portal had no rejected list in use (its page was master-admin only and not in the menu).
        if (host.System == PortalSystem.Consultancy) return NotFound();
        return await List(99, state, certification, size, searchBy, search, pageNo, pageSize, ct);
    }

    private async Task<ActionResult<PageResponse>> List(
        int status, string? state, string? certification, string? size, string? searchBy, string? search, int? pageNo, int? pageSize, CancellationToken ct)
    {
        // Agencies use these screens with desktop or site verification (menu: either sub-role).
        var user = CurrentUser;
        if (IsRole(UserRole.Agency) && !user.HasSubRole(SubRoles.DesktopVerification) && !user.HasSubRole(SubRoles.SiteVerification))
            return Forbid();

        if (!AssessmentInput.State(state, out var s) ||
            !AssessmentInput.Filter(certification, AssessmentInput.Levels, out var c) ||
            !AssessmentInput.Filter(size, AssessmentInput.Sizes, out var z) ||
            !AssessmentInput.Filter(searchBy, SearchBy, out var by))
            return this.Problem400("Invalid filter.");
        var text = AssessmentInput.Text(search);
        if (text?.Length > 50) return this.Problem400("Search text must be at most 50 characters.");
        var page = Math.Max(pageNo ?? 1, 1);
        var size2 = pageSize is 10 or 20 or 50 or 100 or 200 ? pageSize.Value : 20;

        if (host.System != PortalSystem.Main)
            return await FromMonitoringList(status, s, c, z, text is null ? null : by ?? "Zed Id", text, page, size2, ct);

        var sets = await db.QueryProcMultipleAsync("SP_MONITORING_GET_LIST_PAGINATION", new
        {
            UserId,
            RoleId = RoleId.ToString(System.Globalization.CultureInfo.InvariantCulture),
            Status = status,
            CertificationType = c,
            ZedId = text,
            State = s,
            MsmeSize = z,
            NcClosingDate = (string?)null,
            SearchBy = text is null ? null : by ?? "Zed Id",
            PageNo = page,
            PageSize = size2,
        }, ct);

        var total = sets[1].FirstOrDefault() is { } t && int.TryParse(t.Text("TotalCounts"), out var n) ? n : 0;
        return new PageResponse(Pick(sets[0], Fields), total, page, size2);
    }

    /// <summary>
    /// Consultancy and Surveillance: SP_MONITORING_GET_LIST (@UserId, @RoleId, @Status, @CertificationType, @State,
    /// @MsmeSize; Consultancy has no @NcClosingDate, Surveillance's is left at its default), then search and paging here.
    /// </summary>
    private async Task<PageResponse> FromMonitoringList(
        int status, string? state, string? level, string? size, string? searchBy, string? search, int page, int pageSize, CancellationToken ct)
    {
        var sets = await db.QueryProcMultipleAsync("SP_MONITORING_GET_LIST", new
        {
            UserId,
            RoleId = RoleId.ToString(System.Globalization.CultureInfo.InvariantCulture),
            Status = status,
            CertificationType = level,
            State = state,
            MsmeSize = size,
        }, ct);

        IEnumerable<IDictionary<string, object?>> rows = sets[0];
        if (search is not null)
        {
            string[] columns = searchBy switch
            {
                "Udyam Number" => ["UamNumber", "UdyogAadharNo"],
                "Unit Name" => ["PUnitName", "EnterpriseName"],
                _ => ["ZedId"],
            };
            rows = rows.Where(r => columns.Any(col => r.Text(col).Contains(search, StringComparison.OrdinalIgnoreCase)));
        }
        var all = rows.ToList();
        var fields = host.System == PortalSystem.Consultancy ? ConsultancyFields : SurveillanceFields;
        return new PageResponse(Pick(all.Skip((page - 1) * pageSize).Take(pageSize), fields), all.Count, page, pageSize);
    }

    private static List<Dictionary<string, object?>> Pick(IEnumerable<IDictionary<string, object?>> rows, string[] fields) =>
        rows.Select(r => fields.ToDictionary(f => f, f => r.TryGetValue(f, out var v) && v is not DBNull ? v : null)).ToList();
}
