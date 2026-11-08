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
    public IEnumerable<ReportItem> List() =>
        // An MSME DFO without this portal's NEFT list has none of its reports (2026-11-08).
        MayUseReports() ? ReportCatalog.For(host.System, RoleId, CurrentUser.SubRoles ?? []).Select(r => new ReportItem(r.Id, r.Name)) : [];

    private bool MayUseReports() => RoleId != (int)UserRole.StateCoordinator || Neft.CoordinatorAreas.HasList(CurrentUser, host.System);

    /// <summary>Runs an allow-listed report with the signed-in user's RoleId/UserId and returns it as .xlsx.</summary>
    [HttpGet("{id}/download")]
    [StaffRoles(UserRole.SuperAdmin, UserRole.CitizenFeedback, UserRole.Ministry, UserRole.Agency, UserRole.StateCoordinator)]
    public async Task<IActionResult> Download(string id, CancellationToken ct)
    {
        if (!MayUseReports() || ReportCatalog.Find(host.System, RoleId, CurrentUser.SubRoles ?? [], id) is not { } report) return NotFound();

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
        for (var i = 0; i < sets.Count; i++)
        {
            IReadOnlyList<IDictionary<string, object?>> rows = units is null ? sets[i]
                : sets[i].Where(r => r.TryGetValue("ZedId", out var z) && z is not null && units.Contains(z.ToString()!.Trim())).ToList();
            // A Ministry login with a scope (migration 0057): its units and levels only.
            rows = await ScopeFilter.ApplyAsync(HttpContext, rows, ct, "ZedId", "Certification", "CertificationType", "CertificationLevel");
            var columns = rows.FirstOrDefault()?.Keys.Where(k => !ResultSets.SensitiveColumns.Contains(k)).ToList() ?? [];
            sheets.Add(new XlsxSheet(i == 0 ? "Table" : "Table" + i, columns,
                rows.Select(r => (IReadOnlyList<object?>)columns.Select(c => r.TryGetValue(c, out var v) ? v : null).ToList())));
        }

        log.LogInformation("{UserId} (role {RoleId}) downloaded report {Report}", UserId, RoleId, report.Id);
        var fileName = string.Concat(report.Name.Select(ch => char.IsLetterOrDigit(ch) || ch is '-' ? ch : '_')) + ".xlsx";
        Response.Headers.CacheControl = "no-store";
        return File(XlsxWriter.Write(sheets), XlsxWriter.ContentType, fileName);
    }
}
