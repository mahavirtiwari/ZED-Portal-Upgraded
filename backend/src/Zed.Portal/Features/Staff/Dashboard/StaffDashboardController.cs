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
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed class StaffDashboardController(ISqlExecutor db, PortalHost host) : StaffApiController
{
    /// <summary>Columns shown on the four cards of Views/Dashboard/Index.cshtml.</summary>
    public static readonly string[] SummaryColumns =
    [
        "BronzeTotal", "BronzePending", "BronzeNcRaised", "BronzeCompleted", "BronzeRejected",
        "SilverTotal", "SaSilverPending", "SilverNcRaised", "SaSilverCompleted", "SilverRejected",
        "GoldTotal", "SaGoldPending", "GoldNcRaised", "SaGoldCompleted", "GoldRejected",
        "FaTotal", "FaCompleted", "FaPending", "FaRejected",
    ];

    /// <summary>
    /// Consultancy's cards (ZEDCS_CONSULTANCY Views/Dashboard/Index.cshtml): Silver and Gold handholding by milestone
    /// (payments received and completed per milestone) and Technology Intervention (the Fa* columns).
    /// </summary>
    public static readonly string[] ConsultancySummaryColumns =
    [
        "SilverTotal", "SilverM1PaymentDone", "SilverCompleted", "SilverM2PaymentDone", "SilverPending", "SilverM3PaymentDone", "SaSilverCompleted",
        "GoldTotal", "GoldM1PaymentDone", "GoldCompleted", "GoldM2PaymentDone", "GoldPending", "GoldM3PaymentDone", "SaGoldCompleted",
        "FaTotal", "FaCompleted", "FaPending",
    ];

    /// <summary>Consultancy MasterAdmin only: empanelled Consultant Organisations and consultants.</summary>
    public static readonly string[] ConsultancyMasterAdminColumns = ["AssessmentAgencies", "SiteAssessors"];

    /// <summary>Surveillance's cards (ZEDCS_SURVEILLANCE Views/Dashboard/Index.cshtml); there is no Financial Assistance card.</summary>
    public static readonly string[] SurveillanceSummaryColumns =
    [
        "BronzeTotal", "BronzePending", "BronzeCompleted", "BronzeRejected",
        "SilverTotal", "SilverPending", "SaSilverNcRaised", "SaSilverCompleted", "SilverRejected",
        "GoldTotal", "GoldPending", "SaGoldNcRaised", "SaGoldCompleted", "GoldRejected",
    ];

    [HttpGet]
    public async Task<Dictionary<string, object?>> Summary(CancellationToken ct)
    {
        var sets = await db.QueryProcMultipleAsync("SP_DASHBOARD_GET_DETAILS", new { UserId, RoleId = RoleId.ToString() }, ct);
        string[] columns = host.System switch
        {
            PortalSystem.Consultancy when IsRole(UserRole.MasterAdmin) => [.. ConsultancyMasterAdminColumns, .. ConsultancySummaryColumns],
            PortalSystem.Consultancy => ConsultancySummaryColumns,
            PortalSystem.Surveillance => SurveillanceSummaryColumns,
            _ => SummaryColumns,
        };
        return DashboardFilters.Pick(sets[0].FirstOrDefault(), columns);
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
