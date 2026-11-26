using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Dashboard;

/// <summary>
/// Financial support list. Port of DashboardController.FinancialSupport / GetFinancialSupport
/// (SP_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS, which returns rows only for RoleId 10 and 11).
/// </summary>
[Route("api/staff/dashboard/financial-support")]
[StaffRoles(UserRole.SuperAdmin, UserRole.CitizenFeedback)]
[PortalSystems(PortalSystem.Main, PortalSystem.Surveillance)]
public sealed class FinancialSupportController(ISqlExecutor db, PortalHost host, ILogger<FinancialSupportController> log) : StaffApiController
{
    /// <summary>Columns of Views/Dashboard/FinancialSupport.cshtml.</summary>
    public static readonly string[] Columns =
    [
        "Certification", "PUnitName", "ZedId", "EnterpriseType", "ZedIdStatus", "UnitAddress", "PStateName",
        "CertificationFee", "Amount", "FinancialSupport",
    ];

    [HttpGet]
    public async Task<ActionResult<List<Dictionary<string, object?>>>> List(
        string? state, string? certification, string? size, string? gender, CancellationToken ct)
    {
        var invalid = false;
        var stateCode = DashboardFilters.Pick(state, DashboardFilters.States.Keys, ref invalid);
        var cert = DashboardFilters.Pick(certification, DashboardFilters.Certifications, ref invalid);
        var sizeValue = DashboardFilters.Pick(size, DashboardFilters.Sizes, ref invalid);
        var genderValue = DashboardFilters.Pick(gender, DashboardFilters.Genders, ref invalid);
        if (invalid) return this.Problem400("Invalid filter.");

        // "Show All" must reach the procedure as NULL: it no longer turns '' into NULL for the certification,
        // so the old page showed nothing after picking "Show All".
        var sets = await db.QueryProcMultipleAsync("SP_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS", new
        {
            State = stateCode, UserId, CertificationType = cert, RoleId = RoleId.ToString(), Gender = genderValue, MsmeSize = sizeValue,
        }, ct);
        // A scoped login (Master Admin / Ministry / Dashboard Admin, migration 0057): its units only (2026-11-08).
        return DashboardFilters.Pick(await Users.ScopeFilter.ApplyAsync(HttpContext, sets[0], ct), Columns);
    }

    /// <summary>The handholding report's procedure (main's database, reading ZED_CONSULTANT's milestones and payments).</summary>
    public const string HandholdingProcedure = "SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_CONSULTANCY";

    /// <summary>
    /// 2026-11-26 (the user: "Why consultancy is not here?"; the old consultancy portal had no such page): Handholding on the
    /// Financial Support switch, one row per paid milestone, from the report "List Of Handholding Financial Support" (main's
    /// procedure; it answers RoleId 10 / 11 only, so it runs as the Dashboard Admin, as the report does). The same columns as the
    /// certification list: fee = the milestone's handholding fee, paid by the unit = its contribution after subsidy, financial
    /// support = the Government of India's share; the state's share and the milestone status are added. Filtered here (the
    /// procedure takes no filter).
    /// </summary>
    [HttpGet("handholding")]
    public async Task<ActionResult<List<Dictionary<string, object?>>>> Handholding(
        string? state, string? certification, string? size, string? gender, CancellationToken ct)
    {
        if (host.System != PortalSystem.Main) return NotFound();
        var invalid = false;
        var stateCode = DashboardFilters.Pick(state, DashboardFilters.States.Keys, ref invalid);
        var cert = DashboardFilters.Pick(certification, [.. LevelRegistry.Handholding], ref invalid);
        var sizeValue = DashboardFilters.Pick(size, DashboardFilters.Sizes, ref invalid);
        var genderValue = DashboardFilters.Pick(gender, DashboardFilters.Genders, ref invalid);
        if (invalid) return this.Problem400("Invalid filter.");
        var stateName = stateCode is not null && DashboardFilters.States.TryGetValue(stateCode, out var n) ? n : null;

        IReadOnlyList<IDictionary<string, object?>> rows;
        try
        {
            rows = (await db.QueryProcMultipleAsync(HandholdingProcedure, new { RoleId = RoleId == (int)UserRole.CitizenFeedback ? "11" : "10", Userid = UserId, UlbCode = (string?)null }, ct))[0];
        }
        catch (Microsoft.Data.SqlClient.SqlException ex) when (ex.Number == 2812)
        {
            log.LogError("Financial support (handholding): procedure {Procedure} does not exist", HandholdingProcedure);
            return this.Problem400("The handholding financial support is not available.");
        }
        static string Text(IDictionary<string, object?> r, string k) => r.TryGetValue(k, out var v) ? v?.ToString()?.Trim() ?? "" : "";
        static object? Value(IDictionary<string, object?> r, string k) => r.TryGetValue(k, out var v) ? v : null;
        static bool Same(string a, string? b) => b is null || string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
        var picked = rows.Where(r => Text(r, "ZedId").Length > 0
            && Same(Text(r, "PStateName"), stateName) && Same(Text(r, "Certification"), cert)
            && Same(Text(r, "EnterpriseType"), sizeValue) && Same(Text(r, "Gender"), genderValue)).ToList();
        picked = [.. await Users.ScopeFilter.ApplyAsync(HttpContext, picked, ct)];
        return picked.Select(r => new Dictionary<string, object?>
        {
            ["Certification"] = Text(r, "Certification"), ["PUnitName"] = Text(r, "PUnitName"), ["ZedId"] = Text(r, "ZedId"),
            ["EnterpriseType"] = Text(r, "EnterpriseType"), ["ZedIdStatus"] = Text(r, "ZedIdStatus"), ["UnitAddress"] = Text(r, "UnitAddress"),
            ["PStateName"] = Text(r, "PStateName"), ["CertificationFee"] = Value(r, "HandholdingFee"),
            ["Amount"] = Value(r, "ApplicantContributionAfterSubsidy"), ["FinancialSupport"] = Value(r, "GoIContribution"),
            ["StateSupport"] = Value(r, "StateGovtContribution"),
        }).ToList();
    }
}
