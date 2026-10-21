using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Reports;

/// <summary>
/// Reports page. Port of DynamicReportsController.Index and ExportReportData (Excel download).
/// Not ported: GetReportData (the "View" button was commented out on the page), SendMail (e-mailed any
/// procedure's output to any address the browser gave; its button was commented out too),
/// ExportAssessmentData and GetSwachhataAppSummary / StatusReportDate (not used by this page).
/// </summary>
[Route("api/staff/reports")]
public sealed class ReportsController(ISqlExecutor db, ILogger<ReportsController> log) : StaffApiController
{
    public sealed record ReportItem(string Id, string Name);

    [HttpGet]
    [StaffRoles(UserRole.SuperAdmin, UserRole.CitizenFeedback, UserRole.Ministry, UserRole.Agency, UserRole.StateCoordinator)]
    public IEnumerable<ReportItem> List() => ReportCatalog.For(RoleId).Select(r => new ReportItem(r.Id, r.Name));

    /// <summary>Runs an allow-listed report with the signed-in user's RoleId/UserId and returns it as .xlsx.</summary>
    [HttpGet("{id}/download")]
    [StaffRoles(UserRole.SuperAdmin, UserRole.CitizenFeedback, UserRole.Ministry, UserRole.Agency, UserRole.StateCoordinator)]
    public async Task<IActionResult> Download(string id, CancellationToken ct)
    {
        if (ReportCatalog.Find(RoleId, id) is not { } report) return NotFound();

        ResultSets sets;
        try
        {
            // Same parameters as the legacy action; UlbCode was always empty. The procedures branch on RoleId
            // and filter by Userid (agency allotments, Ministry state), so both come from the sign-in cookie.
            sets = await db.QueryProcMultipleAsync(report.Procedure, new { RoleId = RoleId.ToString(), Userid = UserId, UlbCode = (string?)null }, ct);
        }
        catch (SqlException ex) when (ex.Number == 2812)
        {
            log.LogError("Report {Report} is allow-listed but procedure {Procedure} does not exist", report.Id, report.Procedure);
            return this.Problem400("This report is not available.");
        }

        var sheets = new List<XlsxSheet>();
        for (var i = 0; i < sets.Count; i++)
        {
            var rows = sets[i];
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
