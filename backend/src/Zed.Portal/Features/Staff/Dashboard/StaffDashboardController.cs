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
public sealed class StaffDashboardController(ISqlExecutor db, PortalHost host, IOptions<PortalOptions> portal, IHostEnvironment env,
    ILogger<StaffDashboardController> log) : StaffApiController
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
    /// Consultancy's cards (ZEDCS_CONSULTANCY Views/Dashboard/Index.cshtml): Silver, Gold and ZED-X handholding by milestone
    /// (payments received and completed per milestone) and Technology Intervention (the Fa* columns).
    /// </summary>
    public static readonly string[] ConsultancySummaryColumns =
    [
        "SilverTotal", "SilverM1PaymentDone", "SilverCompleted", "SilverM2PaymentDone", "SilverPending", "SilverM3PaymentDone", "SaSilverCompleted",
        "GoldTotal", "GoldM1PaymentDone", "GoldCompleted", "GoldM2PaymentDone", "GoldPending", "GoldM3PaymentDone", "SaGoldCompleted",
        // 2026-11-16: ZED-X handholding (migration 0089).
        "ZEDXTotal", "ZEDXM1PaymentDone", "ZEDXCompleted", "ZEDXM2PaymentDone", "ZEDXPending", "ZEDXM3PaymentDone", "SaZEDXCompleted",
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
        var result = DashboardFilters.Pick(sets[0].FirstOrDefault(), columns);
        if (host.System == PortalSystem.Consultancy) await AddHandholdingCardsAsync(result, ct);
        return result;
    }

    // ----- Consultancy: the handholding cards from the milestone rows -----

    /// <summary>Handholding levels and the card columns of each, in the order of <see cref="ConsultancySummaryColumns"/>.</summary>
    private static readonly string[] HandholdingCardLevels = ["Silver", "Gold", "ZEDX"];

    /// <summary>The four test Udyam numbers the legacy dashboard procedures leave out.</summary>
    internal const string TestUdyamNumbers = "'UDYAM-GJ-01-0013310', 'UDYAM-MH-23-0006117', 'UDYAM-UP-29-0003915'";

    /// <summary>
    /// 2026-11-21 (UI audit: the dashboard showed 0 applications while Consultancy Monitoring listed a Silver case in milestone 1):
    /// the legacy SP_DASHBOARD_GET_DETAILS of ZED_CONSULTANT counts the level cards from the payment records (MsmePaymentInfo
    /// by its Certification / MileStoneNum) and has no ZED-X columns at all, while Monitoring and the consultants list read the
    /// milestone rows (MsmeCertifications, one per unit, level and milestone, written when the milestone's payment is
    /// recorded). A payment record whose level or milestone does not match its milestone row (or no record) left the cards at
    /// 0. The cards are now counted here from the milestone rows, with any payment record of a handholding level and
    /// milestone 1-3 as well: a unit counts once per level (Total), a milestone counts as paid when its row or its payment
    /// record exists, and as completed at status 100 (milestone 3: 100 or 16), as the legacy procedure counts completions.
    /// Scope as the procedure: a consultant organisation its allotments (CertificationBodyUserId), a consultant its own
    /// (DesktopAssessorId / SiteAssessorId; payment records are not allotted, so they are not counted for either), a
    /// state-bound Ministry user its state. The test units are left out as in <see cref="Analytics"/>.
    /// </summary>
    internal const string HandholdingCardsSql =
        "WITH HandholdingMilestones AS (" +
        "SELECT C.ZedId, LTRIM(RTRIM(C.Certification)) AS Level, C.NcCount AS MileStone, C.CertificationStatus " +
        "FROM dbo.MsmeCertifications C INNER JOIN dbo.Msme M ON M.ZedId = C.ZedId " +
        "WHERE LTRIM(RTRIM(C.Certification)) IN ('Silver', 'Gold', 'ZEDX') AND C.NcCount BETWEEN 1 AND 3 AND C.ZedId NOT LIKE '%[_]D%' " +
        "AND (@State IS NULL OR M.StateId = @State) " +
        "AND (@IncludeTestUnits = 1 OR NOT EXISTS (SELECT 1 FROM dbo.MsmeBasicInformation B WHERE B.ZedId = C.ZedId AND B.UdyogAadharNo IN (" + TestUdyamNumbers + "))) " +
        "AND (@AgencyId IS NULL OR C.CertificationBodyUserId = @AgencyId) " +
        "AND (@ConsultantId IS NULL OR C.DesktopAssessorId = @ConsultantId OR C.SiteAssessorId = @ConsultantId) " +
        "UNION " +
        "SELECT P.ZedId, LTRIM(RTRIM(P.Certification)), ISNULL(P.MileStoneNum, 1), NULL " +
        "FROM dbo.MsmePaymentInfo P INNER JOIN dbo.Msme M ON M.ZedId = P.ZedId " +
        "WHERE LTRIM(RTRIM(P.Certification)) IN ('Silver', 'Gold', 'ZEDX') AND ISNULL(P.MileStoneNum, 1) BETWEEN 1 AND 3 AND P.ZedId NOT LIKE '%[_]D%' " +
        "AND @AgencyId IS NULL AND @ConsultantId IS NULL AND (@State IS NULL OR M.StateId = @State) " +
        "AND (@IncludeTestUnits = 1 OR NOT EXISTS (SELECT 1 FROM dbo.MsmeBasicInformation B WHERE B.ZedId = P.ZedId AND B.UdyogAadharNo IN (" + TestUdyamNumbers + ")))) " +
        // 2026-11-21 (review): a unit has one milestone row per level whose NcCount is the milestone it has reached (1 -> 3), so
        // milestone n is paid when the unit reached n or beyond, and completed when it moved past n (or n is completed: status
        // 100; milestone 3: 100 or certified 16). Payment records (no status) count as paid only.
        "SELECT Level, COUNT(DISTINCT ZedId) AS Total, " +
        "COUNT(DISTINCT CASE WHEN MileStone >= 1 THEN ZedId END) AS M1Paid, " +
        "COUNT(DISTINCT CASE WHEN MileStone >= 2 THEN ZedId END) AS M2Paid, " +
        "COUNT(DISTINCT CASE WHEN MileStone >= 3 THEN ZedId END) AS M3Paid, " +
        "COUNT(DISTINCT CASE WHEN CertificationStatus IS NOT NULL AND (MileStone > 1 OR CertificationStatus = 100) THEN ZedId END) AS M1Done, " +
        "COUNT(DISTINCT CASE WHEN CertificationStatus IS NOT NULL AND (MileStone > 2 OR (MileStone = 2 AND CertificationStatus = 100)) THEN ZedId END) AS M2Done, " +
        "COUNT(DISTINCT CASE WHEN MileStone = 3 AND CertificationStatus IN (100, 16) THEN ZedId END) AS M3Done " +
        "FROM HandholdingMilestones GROUP BY Level;";

    public sealed class HandholdingCardRow
    {
        public string? Level { get; init; }
        public int Total { get; init; }
        public int M1Paid { get; init; }
        public int M2Paid { get; init; }
        public int M3Paid { get; init; }
        public int M1Done { get; init; }
        public int M2Done { get; init; }
        public int M3Done { get; init; }
    }

    /// <summary>The card columns of one level from its counts (the legacy names: Completed / Pending / Sa…Completed = milestone 1 / 2 / 3 completed).</summary>
    internal static IEnumerable<KeyValuePair<string, object?>> HandholdingCardColumns(string level, HandholdingCardRow? r) =>
    [
        new($"{level}Total", r?.Total ?? 0),
        new($"{level}M1PaymentDone", r?.M1Paid ?? 0), new($"{level}Completed", r?.M1Done ?? 0),
        new($"{level}M2PaymentDone", r?.M2Paid ?? 0), new($"{level}Pending", r?.M2Done ?? 0),
        new($"{level}M3PaymentDone", r?.M3Paid ?? 0), new($"Sa{level}Completed", r?.M3Done ?? 0),
    ];

    private async Task AddHandholdingCardsAsync(Dictionary<string, object?> result, CancellationToken ct)
    {
        try
        {
            var rows = await db.QuerySqlAsync<HandholdingCardRow>(HandholdingCardsSql, new
            {
                State = BoundStateCode,
                IncludeTestUnits = portal.Value.DashboardCountsTestUnits ?? !env.IsProduction(),
                AgencyId = IsRole(UserRole.Agency) ? UserId : null,
                ConsultantId = IsRole(UserRole.DesktopAssessor) ? UserId : null,
            }, ct);
            foreach (var level in HandholdingCardLevels)
                foreach (var (key, value) in HandholdingCardColumns(level, rows.FirstOrDefault(r => string.Equals(r.Level, level, StringComparison.OrdinalIgnoreCase))))
                    result[key] = value;
        }
        catch (System.Data.Common.DbException ex)
        {
            log.LogWarning(ex, "Handholding dashboard cards not counted from the milestone rows; the procedure's figures are shown");
        }
        // A card the procedure does not return (ZED-X) is 0, never empty.
        foreach (var key in ConsultancySummaryColumns.Concat(ConsultancyMasterAdminColumns).Where(k => result.ContainsKey(k) && result[k] is null).ToList())
            result[key] = 0;
    }

    /// <summary>One consultant's handholding milestones: completed per milestone, and the milestones in progress.</summary>
    public sealed record ConsultantMilestones(string UserId, int M1, int M2, int M3, int InProgress);

    /// <summary>
    /// 2026-11-21 (UI audit: the consultants list printed a fixed "Milestone 1: 0" beside a consultant with a live milestone-1
    /// case): per consultant (the milestone row's SiteAssessorId or DesktopAssessorId), the milestones completed (milestone
    /// 1 and 2 at status 100, milestone 3 at 100 or 16, as the dashboard counts them) and those in progress (any other
    /// status, not disabled). A consultant organisation gets the rows of its own allotments only.
    /// </summary>
    internal const string ConsultantMilestonesSql =
        "SELECT X.ConsultantId AS UserId, " +
        // 2026-11-21 (review): milestone n completed = the unit moved past n, or n is completed (one row per level, NcCount 1 -> 3).
        "SUM(CASE WHEN C.NcCount > 1 OR (C.NcCount = 1 AND C.CertificationStatus = 100) THEN 1 ELSE 0 END) AS M1, " +
        "SUM(CASE WHEN C.NcCount > 2 OR (C.NcCount = 2 AND C.CertificationStatus = 100) THEN 1 ELSE 0 END) AS M2, " +
        "SUM(CASE WHEN C.NcCount = 3 AND C.CertificationStatus IN (100, 16) THEN 1 ELSE 0 END) AS M3, " +
        "SUM(CASE WHEN ISNULL(C.CertificationStatus, 0) NOT IN (16, 99, 100) AND ISNULL(C.IdDisabled, '') <> 'Yes' THEN 1 ELSE 0 END) AS InProgress " +
        "FROM dbo.MsmeCertifications C " +
        "CROSS APPLY (SELECT DISTINCT V.Id FROM (VALUES (C.SiteAssessorId), (C.DesktopAssessorId)) V(Id) WHERE ISNULL(V.Id, '') <> '') X(ConsultantId) " +
        "WHERE LTRIM(RTRIM(C.Certification)) IN ('Silver', 'Gold', 'ZEDX') AND C.NcCount BETWEEN 1 AND 3 AND C.ZedId NOT LIKE '%[_]D%' " +
        "AND (@AgencyId IS NULL OR C.CertificationBodyUserId = @AgencyId) " +
        "GROUP BY X.ConsultantId;";

    [HttpGet("consultant-milestones")]
    [StaffRoles(UserRole.SuperAdmin, UserRole.MasterAdmin, UserRole.Admin, UserRole.Agency)]
    public async Task<ActionResult<IReadOnlyList<ConsultantMilestones>>> ConsultantMilestoneCounts(CancellationToken ct)
    {
        if (host.System != PortalSystem.Consultancy) return NotFound();
        var rows = await db.QuerySqlAsync<ConsultantMilestones>(ConsultantMilestonesSql, new { AgencyId = IsRole(UserRole.Agency) ? UserId : null }, ct);
        return Ok(rows);
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

    /// <summary>Zedx: ZED-X certifications (main portal; 0 elsewhere and before migration 0019's update of 2026-11-08).</summary>
    public sealed record AnalyticsTotals(int Registered, int Certified, int Bronze, int Silver, int Gold, int Zedx = 0);

    /// <summary>The figures of the "ZED Dashboard" (registered) or "ZED Certification" (certified) view.</summary>
    public sealed record AnalyticsResponse(
        string View, AnalyticsTotals Totals, IReadOnlyList<CountItem> Sizes, IReadOnlyList<CountItem> Genders,
        IReadOnlyList<CountItem> SocialCategories, IReadOnlyList<TrendItem> Months, IReadOnlyList<CountItem> States,
        IReadOnlyList<CountItem> Districts, IReadOnlyList<CountItem> Activities, IReadOnlyList<string> DistrictOptions,
        string? BoundState, DateTimeOffset GeneratedAt, Dictionary<string, object?> StatusCards, IReadOnlyList<TrendItem> Years)
    {
        /// <summary>
        /// 2026-11-08 (generic levels): the levels the Admin added (not Bronze, Silver, Gold or ZED-X, which have their fields
        /// above), counted on the main portal over all their applications (an agency or assessor: its own allotments); the
        /// other filters do not apply to them.
        /// </summary>
        public IReadOnlyList<LevelCount> OtherLevels { get; init; } = [];

        /// <summary>2026-11-16: the one sector (Manufacturing / Services) of a login limited to it; the Sector filter is fixed to it.</summary>
        public string? BoundSector { get; init; }
    }

    /// <param name="Total">Applications (certification rows) of the level.</param>
    /// <param name="Pending">Neither certified nor rejected, without an open NC.</param>
    /// <param name="NcRaised">An NC open (status 4 or 14).</param>
    /// <param name="Certified">Certified (16; a desktop level 6 with its certificate number).</param>
    /// <param name="Rejected">Rejected (99, or the legacy rejection's ZedId_D rows).</param>
    public sealed record LevelCount(string Code, string Name, int Total, int Pending, int NcRaised, int Certified, int Rejected);

    public sealed class LevelCountRow
    {
        public string? Code { get; init; }
        public int Total { get; init; }
        public int NcRaised { get; init; }
        public int Certified { get; init; }
        public int Rejected { get; init; }
    }

    /// <summary>Counts of the levels beyond the built-in four (<see cref="AnalyticsResponse.OtherLevels"/>).</summary>
    internal const string OtherLevelsSql =
        "SELECT LTRIM(RTRIM(Certification)) AS Code, COUNT(*) AS Total, " +
        "SUM(CASE WHEN CertificationStatus IN (4, 14) AND ZedId NOT LIKE '%[_]D%' THEN 1 ELSE 0 END) AS NcRaised, " +
        "SUM(CASE WHEN ZedId NOT LIKE '%[_]D%' AND (CertificationStatus = 16 OR (CertificationStatus = 6 AND DaCertificateNo IS NOT NULL)) THEN 1 ELSE 0 END) AS Certified, " +
        "SUM(CASE WHEN CertificationStatus = 99 OR ZedId LIKE '%[_]D%' THEN 1 ELSE 0 END) AS Rejected " +
        "FROM dbo.MsmeCertifications WHERE Certification NOT IN ('Bronze', 'Silver', 'Gold', 'ZEDX') " +
        "AND (@OwnUserId IS NULL OR CertificationBodyUserId = @OwnUserId OR DesktopAssessorId = @OwnUserId) GROUP BY LTRIM(RTRIM(Certification));";

    private async Task<IReadOnlyList<LevelCount>> OtherLevelsAsync(bool ownOnly, CancellationToken ct)
    {
        var added = LevelRegistry.All.Where(l => !Zed.Portal.Features.CertLevels.CertificationLevelsController.IsBuiltIn(l.Code)).ToList();
        if (host.System != PortalSystem.Main || added.Count == 0) return [];
        IReadOnlyList<LevelCountRow> rows;
        try { rows = await db.QuerySqlAsync<LevelCountRow>(OtherLevelsSql, new { OwnUserId = ownOnly ? UserId : null }, ct); }
        catch (System.Data.Common.DbException ex)
        {
            log.LogWarning(ex, "Counts of the added levels not read");
            rows = [];
        }
        return added.Select(l =>
        {
            var r = rows.FirstOrDefault(x => string.Equals(x.Code, l.Code, StringComparison.OrdinalIgnoreCase));
            var total = r?.Total ?? 0;
            var nc = r?.NcRaised ?? 0;
            var certified = r?.Certified ?? 0;
            var rejected = r?.Rejected ?? 0;
            return new LevelCount(l.Code, l.Name, total, Math.Max(0, total - nc - certified - rejected), nc, certified, rejected);
        }).ToList();
    }

    /// <summary>The status cards of the ZED Certification tab, with the filters (the main cards without Financial Assistance).</summary>
    public static readonly string[] StatusCardColumns =
    [
        "BronzeTotal", "BronzePending", "BronzeNcRaised", "BronzeCompleted", "BronzeRejected",
        "SilverTotal", "SaSilverPending", "SilverNcRaised", "SaSilverCompleted", "SilverRejected",
        "GoldTotal", "SaGoldPending", "GoldNcRaised", "SaGoldCompleted", "GoldRejected",
        // ZED-X (2026-11-07; migration 0019).
        "ZedxTotal", "SaZedxPending", "ZedxNcRaised", "SaZedxCompleted", "ZedxRejected",
    ];

    private static readonly string[] HandholdingLevels = [.. Zed.Core.Data.LevelRegistry.Handholding];

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
        string? from, string? to, [FromServices] IMemoryCache cache, CancellationToken ct, bool fresh = false, string? sector = null)
    {
        var invalid = false;
        var viewValue = DashboardFilters.Pick(view, ["registered", "certified"], ref invalid) ?? "registered";
        // A Dashboard Admin opens only the tabs the Admin gave it (2026-11-07).
        if (!DashboardScreens.Has(CurrentUser, host.System, "dash-" + viewValue))
            return Problem(title: "You do not have access to this dashboard tab.", statusCode: StatusCodes.Status403Forbidden);
        var stateName = DashboardFilters.Pick(state, DashboardFilters.StateNames, ref invalid);
        // Consultancy (handholding) has Silver, Gold and ZED-X (2026-11-16).
        var cert = DashboardFilters.Pick(certification, host.System == PortalSystem.Consultancy ? HandholdingLevels : DashboardFilters.Certifications, ref invalid);
        // Others includes the units without a gender (no separate "not given").
        var genderValue = DashboardFilters.Pick(gender, ["male", "female", "OTHERS"], ref invalid);
        var sizeValue = DashboardFilters.Pick(size, DashboardFilters.Sizes, ref invalid);
        var social = DashboardFilters.Pick(socialCategory, DashboardFilters.SocialCategories, ref invalid);
        // 2026-11-16 (approved): Manufacturing or Services (the unit's NIC sector type, else its Udyam activity, as the scope).
        var sectorValue = DashboardFilters.Pick(sector, [Users.LoginScope.Manufacturing, Users.LoginScope.Services], ref invalid);
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
        // A login limited to one sector sees that sector whatever is picked (BoundSector); else the Sector filter.
        var boundSector = scope.OneSector;
        var scopeSector = boundSector ?? sectorValue;
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
                DashboardFilters.Int(totals, "Bronze"), DashboardFilters.Int(totals, "Silver"), DashboardFilters.Int(totals, "Gold"),
                DashboardFilters.Int(totals, "Zedx")),
            Items(sets[1]), Items(sets[2]), Items(sets[3]), Trend(sets[4], "Month"), Items(sets[5]), Items(sets[6]), Items(sets[7]),
            sets[8].Select(r => r.Text("Label") ?? "").Where(l => l.Length > 0).ToList(),
            bound, DateTimeOffset.Now, DashboardFilters.Pick(sets[9].FirstOrDefault(), CardColumns), Trend(sets[10], "Year"))
        {
            OtherLevels = await OtherLevelsAsync(ownOnly, ct),
            BoundSector = boundSector,
        };
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
