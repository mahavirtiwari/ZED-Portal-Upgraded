using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Dashboard;

/// <summary>
/// Staff home dashboard. Port of DashboardController.Index (SP_DASHBOARD_GET_DETAILS through
/// DashboardHelper.GetDashboardDetails) and GetCountsByFilter (SP_DASHBOARD_COUNTS_BY_FILTERS).
/// The procedure scopes the certification cards by the signed-in user: agencies and assessors see only
/// their own allotments, a state-bound Ministry user only that state.
/// </summary>
[Route("api/staff/dashboard")]
[StaffRoles(UserRole.SuperAdmin, UserRole.MasterAdmin, UserRole.Ministry, UserRole.Agency, UserRole.DesktopAssessor,
    UserRole.CitizenFeedback, UserRole.QC)]
public sealed class StaffDashboardController(ISqlExecutor db) : StaffApiController
{
    /// <summary>Columns shown on the four cards of Views/Dashboard/Index.cshtml.</summary>
    public static readonly string[] SummaryColumns =
    [
        "BronzeTotal", "BronzePending", "BronzeNcRaised", "BronzeCompleted", "BronzeRejected",
        "SilverTotal", "SaSilverPending", "SilverNcRaised", "SaSilverCompleted", "SilverRejected",
        "GoldTotal", "SaGoldPending", "GoldNcRaised", "SaGoldCompleted", "GoldRejected",
        "FaTotal", "FaCompleted", "FaPending", "FaRejected",
    ];

    [HttpGet]
    public async Task<Dictionary<string, object?>> Summary(CancellationToken ct)
    {
        var sets = await db.QueryProcMultipleAsync("SP_DASHBOARD_GET_DETAILS", new { UserId, RoleId = RoleId.ToString() }, ct);
        return DashboardFilters.Pick(sets[0].FirstOrDefault(), SummaryColumns);
    }

    public sealed record CountsResponse(int Total, int Bronze, int Silver, int Gold);

    /// <summary>
    /// Registered / certified counts with the page's filters. The legacy action had no authentication at all.
    /// The procedure counts the whole portal; a state-bound Ministry user is limited to that state here.
    /// </summary>
    [HttpGet("counts")]
    public async Task<ActionResult<CountsResponse>> Counts(string? state, string? size, string? socialCategory, string? gender, CancellationToken ct)
    {
        var invalid = false;
        var stateName = DashboardFilters.Pick(state, DashboardFilters.StateNames, ref invalid);
        var sizeValue = DashboardFilters.Pick(size, DashboardFilters.Sizes, ref invalid);
        var social = DashboardFilters.Pick(socialCategory, DashboardFilters.SocialCategories, ref invalid);
        var genderValue = DashboardFilters.Pick(gender, ["male", "female", "OTHERS"], ref invalid);
        if (invalid) return this.Problem400("Invalid filter.");

        if (BoundStateCode is { } code)
            stateName = DashboardFilters.States.TryGetValue(code, out var n) ? n : stateName;

        var row = (await db.QueryProcMultipleAsync("SP_DASHBOARD_COUNTS_BY_FILTERS", new
        {
            UserId, RoleId = RoleId.ToString(), State = stateName, Size = sizeValue, SocialCategory = social, Gender = genderValue,
        }, ct))[0].FirstOrDefault();

        return new CountsResponse(DashboardFilters.Int(row, "Total"), DashboardFilters.Int(row, "Bronze"),
            DashboardFilters.Int(row, "Silver"), DashboardFilters.Int(row, "Gold"));
    }

    /// <summary>State of a Ministry user bound to one state (Users.StateCode), else null.</summary>
    private string? BoundStateCode => IsRole(UserRole.Ministry) && !string.IsNullOrWhiteSpace(CurrentUser.StateCode) ? CurrentUser.StateCode.Trim() : null;
}
