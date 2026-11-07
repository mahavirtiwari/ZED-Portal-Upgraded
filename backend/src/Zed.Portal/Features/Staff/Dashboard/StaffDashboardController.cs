using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.Users;

namespace Zed.Portal.Features.Staff.Dashboard;

/// <summary>
/// Staff home dashboard. Port of DashboardController.Index (SP_DASHBOARD_GET_DETAILS through
/// DashboardHelper.GetDashboardDetails) and GetCountsByFilter (SP_DASHBOARD_COUNTS_BY_FILTERS).
/// The procedure scopes the certification cards by the signed-in user: agencies and assessors see only
/// their own allotments, a state-bound Ministry user only that state. New in V4: the Admin sees MasterAdmin's dashboard.
/// </summary>
[Route("api/staff/dashboard")]
[StaffRoles(UserRole.SuperAdmin, UserRole.MasterAdmin, UserRole.Admin, UserRole.Ministry, UserRole.Agency, UserRole.DesktopAssessor,
    UserRole.CitizenFeedback, UserRole.QC)]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed class StaffDashboardController(ISqlExecutor db, PortalHost host, IOptions<PortalOptions> portal, IHostEnvironment env)
    : StaffApiController
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
        // The procedures have no Admin branch: the Admin is counted as MasterAdmin (the whole portal).
        var asMasterAdmin = IsRole(UserRole.MasterAdmin) || IsRole(UserRole.Admin);
        var role = IsRole(UserRole.Admin) ? (int)UserRole.MasterAdmin : RoleId;
        var sets = await db.QueryProcMultipleAsync("SP_DASHBOARD_GET_DETAILS", new { UserId, RoleId = role.ToString() }, ct);
        string[] columns = host.System switch
        {
            PortalSystem.Consultancy when asMasterAdmin => [.. ConsultancyMasterAdminColumns, .. ConsultancySummaryColumns],
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

    /// <summary>A month (yyyy-MM) or a year: registrations and certifications, each by its own date.</summary>
    public sealed record TrendItem(string Period, int Registered, int Certified);

    public sealed record AnalyticsTotals(int Registered, int Certified, int Bronze, int Silver, int Gold);

    /// <summary>The figures of the "ZED Dashboard" (registered) or "ZED Certification" (certified) view.</summary>
    public sealed record AnalyticsResponse(
        string View, AnalyticsTotals Totals, IReadOnlyList<CountItem> Sizes, IReadOnlyList<CountItem> Genders,
        IReadOnlyList<CountItem> SocialCategories, IReadOnlyList<TrendItem> Months, IReadOnlyList<CountItem> States,
        IReadOnlyList<CountItem> Districts, IReadOnlyList<CountItem> Activities, IReadOnlyList<string> DistrictOptions,
        string? BoundState, DateTimeOffset GeneratedAt, Dictionary<string, object?> StatusCards, IReadOnlyList<TrendItem> Years);

    /// <summary>The status cards of the ZED Certification tab, with the filters (the main cards without Financial Assistance).</summary>
    public static readonly string[] StatusCardColumns =
    [
        "BronzeTotal", "BronzePending", "BronzeNcRaised", "BronzeCompleted", "BronzeRejected",
        "SilverTotal", "SaSilverPending", "SilverNcRaised", "SaSilverCompleted", "SilverRejected",
        "GoldTotal", "SaGoldPending", "GoldNcRaised", "SaGoldCompleted", "GoldRejected",
        // ZED-X (2026-11-07; migration 0019).
        "ZedxTotal", "SaZedxPending", "ZedxNcRaised", "SaZedxCompleted", "ZedxRejected",
    ];

    private static readonly string[] HandholdingLevels = ["Silver", "Gold"];

    /// <summary>The status cards of this portal (the main ones; Consultancy's milestones and TI; Surveillance's).</summary>
    private string[] CardColumns => host.System switch
    {
        PortalSystem.Consultancy => ConsultancySummaryColumns,
        PortalSystem.Surveillance => SurveillanceSummaryColumns,
        _ => StatusCardColumns,
    };

    /// <summary>How long one filter combination is kept: the procedure reads every unit (about 7 lakh rows).</summary>
    internal static readonly TimeSpan AnalyticsCacheTime = TimeSpan.FromMinutes(10);

    /// <summary>
    /// The ministry's Power BI "ZED Dashboard" and "ZED Certification" pages as data (SP_V4_DASHBOARD_ANALYTICS of this
    /// portal's database: migration 0019 main, 0020 Consultancy (handholding: completed = milestone 3 done, the level
    /// columns = applications), 0021 Surveillance). <paramref name="view"/> is the date the range applies to: registered
    /// (registration) or certified (certification, handholding or surveillance completed); dates as yyyy-MM-dd. A state-bound Ministry user sees only that state. The status cards are counted as the dashboard's
    /// (agencies and assessors: their own allotments) for the filtered units and applications in the date range.
    /// Kept for ten minutes per filter combination (and per user for agencies and assessors); <paramref name="fresh"/> (Refresh)
    /// reads them again. The four test Udyam numbers are left out as in Power BI, except where
    /// <see cref="PortalOptions.DashboardCountsTestUnits"/> says to count them (by default: everywhere but Production).
    /// </summary>
    [HttpGet("analytics")]
    public async Task<ActionResult<AnalyticsResponse>> Analytics(
        string? view, string? state, string? district, string? certification, string? gender, string? size, string? socialCategory,
        string? from, string? to, [FromServices] IMemoryCache cache, CancellationToken ct, bool fresh = false)
    {
        var invalid = false;
        var viewValue = DashboardFilters.Pick(view, ["registered", "certified"], ref invalid) ?? "registered";
        var stateName = DashboardFilters.Pick(state, DashboardFilters.StateNames, ref invalid);
        // Consultancy (handholding) has Silver and Gold only.
        var cert = DashboardFilters.Pick(certification, host.System == PortalSystem.Consultancy ? HandholdingLevels : DashboardFilters.Certifications, ref invalid);
        // Others includes the units without a gender (no separate "not given").
        var genderValue = DashboardFilters.Pick(gender, ["male", "female", "OTHERS"], ref invalid);
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

        var ownOnly = IsRole(UserRole.Agency) || IsRole(UserRole.DesktopAssessor);
        // A Master Admin / Ministry login with a scope (migration 0057) sees its category, levels and states only.
        var scope = await HttpContext.LoginScopeAsync(ct);
        var scopeSector = scope.OneSector;
        var scopeLevels = Users.LoginScope.Join(scope.Levels);
        var scopeStates = Users.LoginScope.Join(scope.StateCodes);
        var key = string.Join('|', "dash-analytics", host.System, viewValue, stateName, districtName, cert, genderValue, sizeValue, social, fromDate, toDate,
            ownOnly ? RoleId + ":" + UserId : "all", scopeSector, scopeLevels, scopeStates);
        if (!fresh && cache.TryGetValue(key, out AnalyticsResponse? hit) && hit is not null) return hit;

        var sets = await db.QueryProcMultipleAsync("SP_V4_DASHBOARD_ANALYTICS", new
        {
            View = viewValue, State = stateName, District = districtName, Certification = cert,
            Gender = genderValue, Size = sizeValue, SocialCategory = social,
            From = fromDate?.ToDateTime(TimeOnly.MinValue), To = toDate?.ToDateTime(TimeOnly.MinValue),
            UserId, RoleId = RoleId.ToString(),
            IncludeTestUnits = portal.Value.DashboardCountsTestUnits ?? !env.IsProduction(),
            ScopeSector = scopeSector, ScopeLevels = scopeLevels, ScopeStates = scopeStates,
        }, ct);
        static List<CountItem> Items(IReadOnlyList<IDictionary<string, object?>> rows) =>
            rows.Select(r => new CountItem(r.Text("Label") ?? "", DashboardFilters.Int(r, "Total"))).ToList();
        static List<TrendItem> Trend(IReadOnlyList<IDictionary<string, object?>> rows, string period) =>
            rows.Select(r => new TrendItem(r.Text(period) ?? "", DashboardFilters.Int(r, "Registered"), DashboardFilters.Int(r, "Certified"))).ToList();
        var totals = sets[0].FirstOrDefault();
        var result = new AnalyticsResponse(
            viewValue,
            new AnalyticsTotals(DashboardFilters.Int(totals, "Registered"), DashboardFilters.Int(totals, "Certified"),
                DashboardFilters.Int(totals, "Bronze"), DashboardFilters.Int(totals, "Silver"), DashboardFilters.Int(totals, "Gold")),
            Items(sets[1]), Items(sets[2]), Items(sets[3]), Trend(sets[4], "Month"), Items(sets[5]), Items(sets[6]), Items(sets[7]),
            sets[8].Select(r => r.Text("Label") ?? "").Where(l => l.Length > 0).ToList(),
            bound, DateTimeOffset.Now, DashboardFilters.Pick(sets[9].FirstOrDefault(), CardColumns), Trend(sets[10], "Year"));
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
