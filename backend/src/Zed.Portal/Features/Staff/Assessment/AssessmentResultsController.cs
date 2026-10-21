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
/// </summary>
[Route("api/staff/assessment")]
[StaffRoles(UserRole.MasterAdmin, UserRole.Agency, UserRole.DesktopAssessor)]
public sealed class AssessmentResultsController(ISqlExecutor db) : StaffApiController
{
    private static readonly string[] Fields =
    [
        "RowNumber", "ZedId", "RejectedZedId", "Certification", "CertificationPhase", "PUnitName", "UnitAddress", "ModeOfAssessment",
        "AgencyName", "CertificationBodyUserId", "DesktopAssessorName", "DesktopAssessorId", "SiteAssessorName", "SiteAssessorId",
        "CoAssessorName", "CoAssessorId", "DeskAssessment", "SiteAssessment", "DocVerifiAllot", "ScheduledOn",
        "DesktopVerificationCompleted", "CompletedOn", "SaAssessmentDate", "CertificationStatusDate", "FirstSurveDueDate",
        "SameUdyamAddress", "CertificationStatus", "PledgePath", "CertificationPath",
    ];

    private static readonly string[] SearchBy = ["Zed Id", "Udyam Number", "Unit Name"];

    public sealed record PageResponse(IReadOnlyList<Dictionary<string, object?>> Rows, int TotalCount, int PageNo, int PageSize);

    [HttpGet("completed")]
    public Task<ActionResult<PageResponse>> Completed(
        string? state, string? certification, string? size, string? searchBy, string? search, int? pageNo, int? pageSize, CancellationToken ct) =>
        List(6, state, certification, size, searchBy, search, pageNo, pageSize, ct);

    [HttpGet("rejected")]
    public Task<ActionResult<PageResponse>> Rejected(
        string? state, string? certification, string? size, string? searchBy, string? search, int? pageNo, int? pageSize, CancellationToken ct) =>
        List(99, state, certification, size, searchBy, search, pageNo, pageSize, ct);

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
        var rows = sets[0].Select(r => Fields.ToDictionary(f => f, f => r.TryGetValue(f, out var v) && v is not DBNull ? v : null)).ToList();
        return new PageResponse(rows, total, page, size2);
    }
}
