using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.Users;

namespace Zed.Portal.Features.Staff.Reports;

/// <summary>
/// Reports page. Port of DynamicReportsController.Index and ExportReportData (Excel download).
/// Not ported: GetReportData (the "View" button was commented out on the page), SendMail (e-mailed any
/// procedure's output to any address the browser gave; its button was commented out too),
/// ExportAssessmentData and GetSwachhataAppSummary / StatusReportDate (not used by this page).
/// </summary>
[Route("api/staff/reports")]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed class ReportsController(ISqlExecutor db, PortalHost host, IConfiguration config, ILogger<ReportsController> log) : StaffApiController
{
    /// <summary>The units of an MSME DFO's states, with what its districts and category are checked on.</summary>
    internal const string AreaUnitsSql =
        "SELECT ZedId, StateId, PStateId, PLgDistrictCode, PDistrictName, Activity, TwoDigitActivity FROM dbo.Msme " +
        "WHERE ZedId IS NOT NULL AND (StateId IN @States OR PStateId IN @States)";

    private sealed class UnitRow
    {
        public string? ZedId { get; init; }
        public int? StateId { get; init; }
        public int? PStateId { get; init; }
        public string? PLgDistrictCode { get; init; }
        public string? PDistrictName { get; init; }
        public string? Activity { get; init; }
        public string? TwoDigitActivity { get; init; }

        public IDictionary<string, object?> AsRow() => new Dictionary<string, object?>
        {
            ["StateId"] = StateId, ["PStateId"] = PStateId, ["PLgDistrictCode"] = PLgDistrictCode, ["PDistrictName"] = PDistrictName,
            ["Activity"] = Activity, ["TwoDigitActivity"] = TwoDigitActivity,
        };
    }

    public sealed record ReportItem(string Id, string Name);

    [HttpGet]
    [StaffRoles(UserRole.SuperAdmin, UserRole.CitizenFeedback, UserRole.Ministry, UserRole.Agency, UserRole.StateCoordinator)]
    public async Task<IEnumerable<ReportItem>> List(CancellationToken ct)
    {
        // An MSME DFO without this portal's NEFT list has none of its reports (2026-11-08).
        if (!MayUseReports()) return [];
        var reports = ReportCatalog.For(host.System, RoleId, CurrentUser.SubRoles ?? []).Where(r => !HiddenForNames(r.Procedure)).ToList();
        // 2026-11-22 (database check): a report whose procedure is not in this portal's database is not offered (it could only
        // answer "This report is not available"); when the catalogue cannot be read, every report is offered as before.
        var present = await PresentAsync(reports.Select(r => r.Procedure).Distinct().ToList(), ct);
        return reports.Where(r => present is null || present.Contains(r.Procedure)).Select(r => new ReportItem(r.Id, r.Name));
    }

    public const string PresentSql = "SELECT name FROM sys.procedures WHERE name IN @Names;";

    private async Task<HashSet<string>?> PresentAsync(IReadOnlyList<string> procedures, CancellationToken ct)
    {
        if (procedures.Count == 0) return [];
        try
        {
            return (await db.QuerySqlAsync<string>(PresentSql, new { Names = procedures }, ct)).ToHashSet(StringComparer.OrdinalIgnoreCase);
        }
        catch (SqlException ex)
        {
            log.LogWarning(ex, "The report procedures could not be checked; every report is listed");
            return null;
        }
    }

    /// <summary>
    /// 2026-11-27 (permissions review): a Dashboard Admin with "Hide agency and assessor names" on this portal gets neither the
    /// reports that list agencies and assessors (or their remarks) nor the agency / assessor columns of the other reports, as the
    /// list pages hide them (<see cref="DashboardScreens.HidesNames"/>).
    /// </summary>
    internal static readonly HashSet<string> NameReports = new(StringComparer.OrdinalIgnoreCase)
    {
        "SP_DYNAMIC_REPORT_LIST_OF_ASSESSMENT_AGENCIES", "SP_DYNAMIC_REPORT_LIST_OF_ZED_ASSESSORS", "SP_DYNAMIC_REPORT_ASSESSOR_COMMENTS",
    };

    private static readonly System.Text.RegularExpressions.Regex NameColumn =
        new("agency|assessor|consultant|certificationbody", System.Text.RegularExpressions.RegexOptions.IgnoreCase | System.Text.RegularExpressions.RegexOptions.CultureInvariant);

    private bool HidesNames => DashboardScreens.HidesNames(CurrentUser, host.System);

    private bool HiddenForNames(string procedure) => HidesNames && NameReports.Contains(procedure);

    private bool MayUseReports() => RoleId != (int)UserRole.StateCoordinator || Neft.CoordinatorAreas.HasList(CurrentUser, host.System);

    /// <summary>Runs an allow-listed report with the signed-in user's RoleId/UserId and returns it as .xlsx.</summary>
    [HttpGet("{id}/download")]
    [StaffRoles(UserRole.SuperAdmin, UserRole.CitizenFeedback, UserRole.Ministry, UserRole.Agency, UserRole.StateCoordinator)]
    public async Task<IActionResult> Download(string id, CancellationToken ct, string? state = null, string? certification = null, string? size = null,
        string? gender = null, string? status = null, string? from = null, string? to = null, string? dateOf = null)
    {
        if (!MayUseReports() || ReportCatalog.Find(host.System, RoleId, CurrentUser.SubRoles ?? [], id) is not { } report || HiddenForNames(report.Procedure))
            return NotFound();
        // 2026-11-26: the page's filters (ReportFilters), checked as the list pages check theirs.
        var invalid = false;
        var stateCode = Dashboard.DashboardFilters.Pick(state, Dashboard.DashboardFilters.States.Keys, ref invalid);
        var level = Dashboard.DashboardFilters.Pick(certification, Dashboard.DashboardFilters.Certifications, ref invalid);
        var sizeValue = Dashboard.DashboardFilters.Pick(size, Dashboard.DashboardFilters.Sizes, ref invalid);
        var genderValue = Dashboard.DashboardFilters.Pick(gender, Dashboard.DashboardFilters.Genders, ref invalid);
        var dateBasis = Dashboard.DashboardFilters.Pick(dateOf, ReportFilter.DateBases, ref invalid) ?? ReportFilter.Registration;
        var statusText = string.IsNullOrWhiteSpace(status) ? null : status.Trim();
        if (statusText is { Length: > 60 } || (statusText is not null && !statusText.All(c => char.IsLetterOrDigit(c) || " -/().,&'".Contains(c)))) invalid = true;
        if (invalid) return this.Problem400("Invalid filter.");
        if (!TryDate(from, out var fromDate) || !TryDate(to, out var toDate)) return this.Problem400("Please enter the dates as yyyy-MM-dd.");
        if (fromDate is { } fd && toDate is { } td && fd > td) return this.Problem400("The From date is after the To date.");
        var filter = new ReportFilter(stateCode is not null && Dashboard.DashboardFilters.States.TryGetValue(stateCode, out var sn) ? sn : null,
            level, sizeValue, genderValue, statusText, fromDate, toDate, dateBasis);

        ResultSets sets;
        try
        {
            // Same parameters as the legacy action; UlbCode was always empty. The procedures branch on RoleId
            // and filter by Userid (agency allotments, Ministry state), so both come from the sign-in cookie.
            sets = await db.QueryProcMultipleAsync(report.Procedure, new { RoleId = (report.RunAsRole ?? RoleId).ToString(), Userid = UserId, UlbCode = (string?)null }, ct);
        }
        catch (SqlException ex) when (ex.Number == 2812)
        {
            log.LogError("Report {Report} is allow-listed but procedure {Procedure} does not exist", report.Id, report.Procedure);
            return this.Problem400("This report is not available.");
        }

        // A State Coordinator's reports (the transactions with their bank details) list every state; keep the coordinator's
        // own state's units, as the NEFT pages do (Neft:AllStatesUserIds see all). A sheet without a ZedId column is left out.
        HashSet<string>? units = null;
        if (RoleId == (int)UserRole.StateCoordinator && !Neft.NeftController.SeesAllStates(config, UserId, CurrentUser.StateCode))
        {
            // Its states, districts and category (2026-11-07).
            var area = await Neft.CoordinatorAreas.ForAsync(HttpContext, config, db, CurrentUser, ct);
            units = area.States.Count == 0 ? []
                : (await db.QuerySqlAsync<UnitRow>(AreaUnitsSql, new { States = area.States.Select(st => int.Parse(st, System.Globalization.CultureInfo.InvariantCulture)).ToArray() }, ct))
                    .Where(u => area.Contains(u.AsRow())).Select(u => u.ZedId!.Trim()).ToHashSet(StringComparer.OrdinalIgnoreCase);
        }

        var sheets = new List<XlsxSheet>();
        var filtered = new List<(string, IReadOnlyList<AppliedFilter>, int, int)>();
        for (var i = 0; i < sets.Count; i++)
        {
            IReadOnlyList<IDictionary<string, object?>> rows = units is null ? sets[i]
                : sets[i].Where(r => r.TryGetValue("ZedId", out var z) && z is not null && units.Contains(z.ToString()!.Trim())).ToList();
            // A Ministry login with a scope (migration 0057): its units and levels only.
            rows = await ScopeFilter.ApplyAsync(HttpContext, rows, ct, "ZedId", "Certification", "CertificationType", "CertificationLevel");
            var hideNames = HidesNames;
            var columns = rows.FirstOrDefault()?.Keys.Where(k => !ResultSets.SensitiveColumns.Contains(k) && !(hideNames && NameColumn.IsMatch(k))).ToList() ?? [];
            var sheetName = i == 0 ? "Table" : "Table" + i;
            if (filter.Any)
            {
                var before = rows.Count;
                (rows, var applied) = ReportFilters.Apply(rows, filter);
                filtered.Add((sheetName, applied, before, rows.Count));
            }
            sheets.Add(new XlsxSheet(sheetName, columns,
                rows.Select(r => (IReadOnlyList<object?>)columns.Select(c => r.TryGetValue(c, out var v) ? v : null).ToList())));
        }

        if (filtered.Count > 0) sheets.Add(ReportFilters.Sheet(filtered));
        log.LogInformation("{UserId} (role {RoleId}) downloaded report {Report}", UserId, RoleId, report.Id);
        var fileName = string.Concat(report.Name.Select(ch => char.IsLetterOrDigit(ch) || ch is '-' ? ch : '_')) + ".xlsx";
        Response.Headers.CacheControl = "no-store";
        return File(XlsxWriter.Write(sheets), XlsxWriter.ContentType, fileName);
    }

    private static bool TryDate(string? value, out DateOnly? date)
    {
        date = null;
        if (string.IsNullOrWhiteSpace(value)) return true;
        if (!DateOnly.TryParseExact(value.Trim(), "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.None, out var d) || d.Year < 2015 || d.Year > 2100) return false;
        date = d;
        return true;
    }
}
