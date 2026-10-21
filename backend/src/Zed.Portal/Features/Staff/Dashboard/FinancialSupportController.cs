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
public sealed class FinancialSupportController(ISqlExecutor db) : StaffApiController
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
        return DashboardFilters.Pick(sets[0], Columns);
    }
}
