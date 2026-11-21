using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.Users;

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
/// Surveillance rows add SurveillanceNo; its Completed page also had a Gender filter (the procedure's @Gender), and its one
/// Search box matched any column of the rows (<c>JSON.stringify(row).indexOf(text)</c>), so searchBy is ignored there.
/// </para>
/// <para>
/// Completed rows carry ReasonForRejection (all three procedures return it): the old Completed pages coloured those rows red.
/// Rejected rows carry it too (2026-11-17, approved redesign: the "Reason for rejection" column).
/// </para>
/// <para>
/// 2026-11-18 (the user: staff pages 'not aligned with SVG files'): <c>completed/counts</c> and <c>rejected/counts</c>, the designs'
/// count cards (staff-11: completed, certified this month, surveillance due in 90 days, duplicates flagged; staff-12: rejected,
/// waiting to be re-allotted, re-allotted), worked out from every row of the same filter (the list itself stays paged).
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

    /// <summary>Status 6 of SP_MONITORING_GET_LIST(_PAGINATION).</summary>
    private const int CompletedStatus = 6;

    /// <summary>Most rows the counts read (the paged procedure's page size for them).</summary>
    internal const int CountLimit = 100_000;

    /// <summary>
    /// The count cards. <paramref name="WaitingReallot"/> and <paramref name="Reallotted"/> (Rejected, main only): rejected records whose
    /// unit's level is back on the Allot list (CertificationStatus 2 or 3) or allotted again (past 3, not rejected); null elsewhere.
    /// </summary>
    public sealed record CountsResponse(int Total, int CertifiedThisMonth, int SurveillanceDue90, int Duplicates, int? WaitingReallot, int? Reallotted);

    [HttpGet("completed/counts")]
    public Task<ActionResult<CountsResponse>> CompletedCounts(
        string? state, string? certification, string? size, string? gender, string? searchBy, string? search, CancellationToken ct) =>
        Counts(CompletedStatus, state, certification, size, gender, searchBy, search, ct);

    [HttpGet("rejected/counts")]
    public async Task<ActionResult<CountsResponse>> RejectedCounts(
        string? state, string? certification, string? size, string? gender, string? searchBy, string? search, CancellationToken ct)
    {
        if (host.System == PortalSystem.Consultancy) return NotFound();
        return await Counts(99, state, certification, size, gender, searchBy, search, ct);
    }

    /// <summary>The live record's status of each unit and level (the rejected copies are ZedId_D_n / _R_n rows of the same table).</summary>
    internal const string LiveStatusSql = "SELECT ZedId, Certification, CertificationStatus FROM dbo.MsmeCertifications WHERE ZedId IN @ZedIds;";

    public sealed record LiveRow(string? ZedId, string? Certification, int? CertificationStatus);

    private async Task<ActionResult<CountsResponse>> Counts(
        int status, string? state, string? certification, string? size, string? gender, string? searchBy, string? search, CancellationToken ct)
    {
        var res = await List(status, state, certification, size, gender, searchBy, search, 1, null, ct, all: true);
        if (res.Value is not { } page) return res.Result!;
        var rows = page.Rows;
        var today = DateOnly.FromDateTime(DateTime.UtcNow.AddMinutes(330));
        int certifiedThisMonth = 0, due = 0, duplicates = 0;
        foreach (var r in rows)
        {
            if (Day(r, "CertificationStatusDate") is { } c && c.Year == today.Year && c.Month == today.Month) certifiedThisMonth++;
            if (Day(r, "FirstSurveDueDate") is { } d && d >= today && d <= today.AddDays(90)) due++;
            if (int.TryParse(r.Text("SameUdyamAddress"), out var n) && n > 0) duplicates++;
        }
        int? waiting = null, reallotted = null;
        if (status == 99 && host.System == PortalSystem.Main && rows.Count > 0)
        {
            var keys = rows.Select(r => (Id: r.Text("ZedId").Split('_')[0].Trim(), Level: r.Text("Certification").Trim())).Where(k => AssessmentInput.IsId(k.Id)).ToList();
            var live = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            foreach (var chunk in keys.Select(k => k.Id).Distinct(StringComparer.OrdinalIgnoreCase).Chunk(1000))
                foreach (var l in await db.QuerySqlAsync<LiveRow>(LiveStatusSql, new { ZedIds = chunk }, ct))
                    if (l.CertificationStatus is { } cs) live[$"{l.ZedId?.Trim()}|{l.Certification?.Trim()}"] = cs;
            waiting = keys.Count(k => live.TryGetValue($"{k.Id}|{k.Level}", out var cs) && cs is 2 or 3);
            reallotted = keys.Count(k => live.TryGetValue($"{k.Id}|{k.Level}", out var cs) && cs > 3 && cs != 99);
        }
        return new CountsResponse(page.TotalCount, certifiedThisMonth, due, duplicates, waiting, reallotted);
    }

    /// <summary>A date of the list ("November 13, 2026" as the procedures format it, or an ISO date).</summary>
    private static DateOnly? Day(IDictionary<string, object?> row, string field)
    {
        if (row.TryGetValue(field, out var v) && v is DateTime dt) return DateOnly.FromDateTime(dt);
        return DateTime.TryParse(row.Text(field), System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var d)
            ? DateOnly.FromDateTime(d) : null;
    }

    [HttpGet("completed")]
    public Task<ActionResult<PageResponse>> Completed(
        string? state, string? certification, string? size, string? gender, string? searchBy, string? search, int? pageNo, int? pageSize, CancellationToken ct) =>
        List(CompletedStatus, state, certification, size, gender, searchBy, search, pageNo, pageSize, ct);

    [HttpGet("rejected")]
    public async Task<ActionResult<PageResponse>> Rejected(
        string? state, string? certification, string? size, string? gender, string? searchBy, string? search, int? pageNo, int? pageSize, CancellationToken ct)
    {
        // The consultancy portal had no rejected list in use (its page was master-admin only and not in the menu).
        if (host.System == PortalSystem.Consultancy) return NotFound();
        return await List(99, state, certification, size, gender, searchBy, search, pageNo, pageSize, ct);
    }

    private async Task<ActionResult<PageResponse>> List(
        int status, string? state, string? certification, string? size, string? gender, string? searchBy, string? search, int? pageNo, int? pageSize,
        CancellationToken ct, bool all = false)
    {
        // Agencies use these screens with desktop or site verification (menu: either sub-role).
        var user = CurrentUser;
        if (IsRole(UserRole.Agency) && !user.HasSubRole(SubRoles.DesktopVerification) && !user.HasSubRole(SubRoles.SiteVerification))
            return Forbid();

        if (!AssessmentInput.State(state, out var s) ||
            !AssessmentInput.Filter(certification, AssessmentInput.Levels, out var c) ||
            !AssessmentInput.Filter(size, AssessmentInput.Sizes, out var z) ||
            !AssessmentInput.Filter(gender, AssessmentInput.Genders, out var g) ||
            !AssessmentInput.Filter(searchBy, SearchBy, out var by))
            return this.Problem400("Invalid filter.");
        var text = AssessmentInput.Text(search);
        if (text?.Length > 50) return this.Problem400("Search text must be at most 50 characters.");
        var page = Math.Max(pageNo ?? 1, 1);
        // all: every row for the counts (at most CountLimit); the query string's page sizes stay 10 to 200.
        var size2 = all ? CountLimit : pageSize is 10 or 20 or 50 or 100 or 200 ? pageSize.Value : 20;

        // Main's paginated procedure has @Gender but its condition is commented out (and main's pages had no Gender filter).
        if (host.System != PortalSystem.Main || (await HttpContext.LoginScopeAsync(ct)).IsLimited)
            return await FromMonitoringList(status, s, c, z, g, text is null ? null : by ?? "Zed Id", text, page, size2, ct);

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
        var rows = Pick(sets[0], WithReason(Fields));
        if (status == CompletedStatus && !all && IsRole(UserRole.DesktopAssessor)) await AddAssessorDates(rows, ct);
        return new PageResponse(rows, total, page, size2);
    }

    /// <summary>
    /// The dates of the record's history the assessment details page shows (SP_ASSESSMENT_DA_DETAILS reads MsmeHistory): when the unit
    /// was allotted to the desktop assessor, its desktop verification and the assessment completed, for the listed rows only.
    /// </summary>
    internal const string HistoryDatesSql =
        "SELECT ZedId, CertificationType, StatusType, MAX(CreatedDate) AS CreatedDate FROM dbo.MsmeHistory " +
        "WHERE ZedId IN @ZedIds AND StatusType IN ('DocVerifiAllot', 'DesktopVerification', 'Completed') GROUP BY ZedId, CertificationType, StatusType;";

    public sealed record HistoryDate(string? ZedId, string? CertificationType, string? StatusType, DateTime? CreatedDate);

    /// <summary>
    /// 2026-11-21 (Assessor UI audit): the assessor's Completed list showed the date the assessor accepted the unit as "allocated on"
    /// (the details page: the date it was allotted) and a blank "completed on" (the procedure's DesktopVerificationDate is not set by
    /// the desktop final submit, and it has no CompletedOn). The allotment date is taken from the history as on the details page, and
    /// the completion dates where the procedure has none; the page falls back to the record's status date.
    /// </summary>
    private async Task AddAssessorDates(List<Dictionary<string, object?>> rows, CancellationToken ct)
    {
        // The record's own ZED ID (the procedure's P.ZedId), as the details page reads the history.
        static string Key(Dictionary<string, object?> r) => (r.Text("RejectedZedId") is { Length: > 0 } own ? own : r.Text("ZedId")).Trim();
        var ids = rows.Select(Key).Where(id => id.Length is > 0 and <= 60).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        if (ids.Length == 0) return;
        var dates = new Dictionary<string, DateTime>(StringComparer.OrdinalIgnoreCase);
        foreach (var h in await db.QuerySqlAsync<HistoryDate>(HistoryDatesSql, new { ZedIds = ids }, ct))
            if (h.CreatedDate is { } d) dates[$"{h.ZedId?.Trim()}|{h.CertificationType?.Trim()}|{h.StatusType}"] = d;
        foreach (var r in rows)
        {
            string? At(string type) => dates.TryGetValue($"{Key(r)}|{r.Text("Certification").Trim()}|{type}", out var d)
                ? d.ToString("MMMM d, yyyy", System.Globalization.CultureInfo.InvariantCulture) : null;
            if (r.Text("DeskAssessment") == "D" && At("DocVerifiAllot") is { } allotted) r["DocVerifiAllot"] = allotted;
            if (string.IsNullOrEmpty(r.Text("DesktopVerificationCompleted")) && At("DesktopVerification") is { } desk) r["DesktopVerificationCompleted"] = desk;
            if (string.IsNullOrEmpty(r.Text("CompletedOn")) && At("Completed") is { } done) r["CompletedOn"] = done;
        }
    }

    /// <summary>
    /// The reason for rejection (2026-11-17, approved redesign: also on the Rejected list, its own column) and the unit's district
    /// and state (the rows show those instead of the full address; the procedures select PDistrictName and PStateName).
    /// </summary>
    private static string[] WithReason(string[] fields) => [.. fields, "ReasonForRejection", "PDistrictName", "PStateName"];

    /// <summary>
    /// Consultancy and Surveillance: SP_MONITORING_GET_LIST (@UserId, @RoleId, @Status, @CertificationType, @State,
    /// @MsmeSize, @Gender; Consultancy has no @NcClosingDate, Surveillance's is left at its default), then search and paging here.
    /// </summary>
    private async Task<PageResponse> FromMonitoringList(
        int status, string? state, string? level, string? size, string? gender, string? searchBy, string? search, int page, int pageSize,
        CancellationToken ct)
    {
        var sets = await db.QueryProcMultipleAsync("SP_MONITORING_GET_LIST", new
        {
            UserId,
            RoleId = RoleId.ToString(System.Globalization.CultureInfo.InvariantCulture),
            Status = status,
            CertificationType = level,
            State = state,
            MsmeSize = size,
            Gender = gender,
        }, ct);

        IEnumerable<IDictionary<string, object?>> rows = await ScopeFilter.ApplyAsync(HttpContext, sets[0], ct);
        if (search is not null && host.System == PortalSystem.Surveillance)
        {
            // As the old SearchText: any column of the row (case-insensitive here).
            rows = rows.Where(r => r.Values.Any(v => v is not null and not DBNull &&
                (Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture) ?? "").Contains(search, StringComparison.OrdinalIgnoreCase)));
        }
        else if (search is not null)
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
        var fields = WithReason(host.System == PortalSystem.Consultancy ? ConsultancyFields : SurveillanceFields);
        return new PageResponse(Pick(all.Skip((page - 1) * pageSize).Take(pageSize), fields), all.Count, page, pageSize);
    }

    private static List<Dictionary<string, object?>> Pick(IEnumerable<IDictionary<string, object?>> rows, string[] fields) =>
        rows.Select(r => fields.ToDictionary(f => f, f => r.TryGetValue(f, out var v) && v is not DBNull ? v : null)).ToList();
}
