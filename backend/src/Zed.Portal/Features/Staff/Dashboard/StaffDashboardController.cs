using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
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

    public sealed record CountItem(string Label, int Total);

    public sealed record AnalyticsTotals(int Registered, int Certified, int Bronze, int Silver, int Gold);

    /// <summary>The figures of the "ZED Dashboard" (registered) or "ZED Certification" (certified) view.</summary>
    public sealed record AnalyticsResponse(
        string View, AnalyticsTotals Totals, IReadOnlyList<CountItem> Sizes, IReadOnlyList<CountItem> Genders,
        IReadOnlyList<CountItem> SocialCategories, IReadOnlyList<CountItem> Months, IReadOnlyList<CountItem> States,
        IReadOnlyList<CountItem> Districts, IReadOnlyList<CountItem> Activities, IReadOnlyList<string> DistrictOptions,
        string? BoundState, DateTimeOffset GeneratedAt);

    /// <summary>How long one filter combination is kept: the procedure reads every unit (about 7 lakh rows).</summary>
    internal static readonly TimeSpan AnalyticsCacheTime = TimeSpan.FromMinutes(10);

    /// <summary>
    /// Main portal: the ministry's Power BI "ZED Dashboard" and "ZED Certification" pages as data (SP_V4_DASHBOARD_ANALYTICS,
    /// migration 0019). <paramref name="view"/> registered (dates = registration) or certified (dates = certification);
    /// dates as yyyy-MM-dd. A state-bound Ministry user sees only that state. Kept for ten minutes per filter combination.
    /// </summary>
    [HttpGet("analytics")]
    public async Task<ActionResult<AnalyticsResponse>> Analytics(
        string? view, string? state, string? district, string? certification, string? gender, string? size, string? socialCategory,
        string? from, string? to, [FromServices] IMemoryCache cache, CancellationToken ct)
    {
        if (host.System != PortalSystem.Main) return NotFound();
        var invalid = false;
        var viewValue = DashboardFilters.Pick(view, ["registered", "certified"], ref invalid) ?? "registered";
        var stateName = DashboardFilters.Pick(state, DashboardFilters.StateNames, ref invalid);
        var cert = DashboardFilters.Pick(certification, DashboardFilters.Certifications, ref invalid);
        var genderValue = DashboardFilters.Pick(gender, ["male", "female", "OTHERS", "NA"], ref invalid);
        var sizeValue = DashboardFilters.Pick(size, DashboardFilters.Sizes, ref invalid);
        var social = DashboardFilters.Pick(socialCategory, DashboardFilters.SocialCategories, ref invalid);
        var districtName = string.IsNullOrWhiteSpace(district) ? null : district.Trim();
        if (districtName is { Length: > 100 } || (districtName is not null && !districtName.All(c => char.IsLetterOrDigit(c) || " .-&()'/,".Contains(c))))
            invalid = true;
        if (invalid) return this.Problem400("Invalid filter.");
        if (!TryDate(from, out var fromDate) || !TryDate(to, out var toDate)) return this.Problem400("Please enter the dates as yyyy-MM-dd.");
        if (fromDate is { } f && toDate is { } t && f > t) return this.Problem400("The From date is after the To date.");

        string? bound = null;
        if (BoundStateCode is { } code && DashboardFilters.States.TryGetValue(code, out var n))
        {
            bound = n;
            stateName = n;
        }

        var key = string.Join('|', "dash-analytics", viewValue, stateName, districtName, cert, genderValue, sizeValue, social, fromDate, toDate);
        if (cache.TryGetValue(key, out AnalyticsResponse? hit) && hit is not null) return hit;

        var sets = await db.QueryProcMultipleAsync("SP_V4_DASHBOARD_ANALYTICS", new
        {
            View = viewValue, State = stateName, District = districtName, Certification = viewValue == "certified" ? cert : null,
            Gender = genderValue, Size = sizeValue, SocialCategory = social,
            From = fromDate?.ToDateTime(TimeOnly.MinValue), To = toDate?.ToDateTime(TimeOnly.MinValue),
        }, ct);
        static List<CountItem> Items(IReadOnlyList<IDictionary<string, object?>> rows) =>
            rows.Select(r => new CountItem(r.ContainsKey("Month") ? r.Text("Month") ?? "" : r.Text("Label") ?? "", DashboardFilters.Int(r, "Total"))).ToList();
        var totals = sets[0].FirstOrDefault();
        var result = new AnalyticsResponse(
            viewValue,
            new AnalyticsTotals(DashboardFilters.Int(totals, "Registered"), DashboardFilters.Int(totals, "Certified"),
                DashboardFilters.Int(totals, "Bronze"), DashboardFilters.Int(totals, "Silver"), DashboardFilters.Int(totals, "Gold")),
            Items(sets[1]), Items(sets[2]), Items(sets[3]), Items(sets[4]), Items(sets[5]), Items(sets[6]), Items(sets[7]),
            sets[8].Select(r => r.Text("Label") ?? "").Where(l => l.Length > 0).ToList(),
            bound, DateTimeOffset.Now);
        cache.Set(key, result, AnalyticsCacheTime);
        return result;
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

    /// <summary>State of a Ministry user bound to one state (Users.StateCode), else null.</summary>
    private string? BoundStateCode => IsRole(UserRole.Ministry) && !string.IsNullOrWhiteSpace(CurrentUser.StateCode) ? CurrentUser.StateCode.Trim() : null;
}
