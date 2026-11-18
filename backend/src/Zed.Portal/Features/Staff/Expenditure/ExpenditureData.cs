using System.Data.Common;
using System.Globalization;
using System.Runtime.CompilerServices;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.CertLevels;

namespace Zed.Portal.Features.Staff.Expenditure;

/// <summary>
/// 2026-11-18 (approved design "Expenditure monitoring"): what the portal owes the assessment agencies (main: per assessment
/// case and surveillance visit) and the consultant organisations (Consultancy: per handholding milestone). Migration 0098.
/// <para>When a case counts (and its rate is frozen on it, <see cref="ExpenditureSweep"/>):</para>
/// <list type="bullet">
/// <item>Completed: main's dbo.MsmeCertifications at status 6 or 16 (certified: the last assessment step of the level's flow
/// done and passed), counted on its CertificationStatusDate.</item>
/// <item>Rejected after assessment: status 99 with the assessor of the flow's last step on the record (DesktopAssessorId for a
/// "Desktop only" level, SiteAssessorId for every flow ending Remote or Onsite); a rejection before that step does not count.</item>
/// <item>Surveillance visit: ZED_SURVEILLANCE's row (one per visit) certified (6 / 16) or rejected after the visit.</item>
/// <item>Milestone (2026-11-18, the user: "M1 payment will be released when M2 payment done. M2 payment will be released when
/// M3 payment done. M3 payment done when applicant upgraded to next level (certified)"): on ZED_CONSULTANT's row (one per
/// unit and level, NcCount = the milestones started), milestone k counts on the day the MSME's payment of milestone k+1
/// succeeded (its first ZED_CONSULTANT MsmePaymentInfo row: gateway, NEFT, ZeroAmount or PaidAtMilestone1); the level's last
/// milestone (the fee master's milestones of the level, 3, 2 or 1) counts on the day the unit is certified at that level on
/// main (<see cref="CertifiedOnMain"/>), not before that milestone was paid.</item>
/// </list>
/// </summary>
public static class Expenditure
{
    public const string Agency = "Agency";
    public const string Consultant = "Consultant";

    public const string Completed = "Completed";
    public const string Rejected = "Rejected";
    public const string Surveillance = "Surveillance";
    public const string Milestone = "Milestone";

    /// <summary>GST % added on invoices until the Admin saves one.</summary>
    public const decimal DefaultGst = 18m;

    /// <summary>
    /// A main dbo.MsmeCertifications row M that is certified (the certified-by-record rule of migration 0079, as
    /// HandholdingEligibility reads the unit's level: status 16, or 6 with a certificate number or phase, e.g. Bronze).
    /// </summary>
    public const string CertifiedOnMain =
        "(M.CertificationStatus = 16 OR (M.CertificationStatus = 6 AND (M.DaCertificateNo IS NOT NULL OR M.CertificationPhase IS NOT NULL)))";

    /// <summary>The milestone columns of ZED_CONSULTANT.dbo.MsmeCertifications (ExpM1.. ExpM3; milestones may become fewer).</summary>
    public const int MaxMilestones = 3;

    /// <summary>Today in India (the portal's dates are Indian dates).</summary>
    public static DateTime Today => DateTime.UtcNow.AddMinutes(330).Date;

    public static string KindOf(PortalHost host) => host.System == PortalSystem.Consultancy ? Consultant : Agency;

    public static bool IsManager(int roleId) => roleId is (int)UserRole.Admin or (int)UserRole.MasterAdmin;

    public static string Rupees(decimal amount) => "₹ " + amount.ToString("#,##,##0.##", CultureInfo.GetCultureInfo("en-IN"));

    /// <summary>The month "2026-10" → its first day; null when not a month.</summary>
    public static DateTime? Month(string? value) =>
        DateTime.TryParseExact(value?.Trim(), "yyyy-MM", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : null;

    /// <summary>A date "2026-04-01" (the pages' date inputs); null when empty or not a date.</summary>
    public static DateTime? Day(string? value) =>
        DateTime.TryParseExact(value?.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : null;

    internal static bool Same(string? a, string? b) => string.Equals(a?.Trim(), b?.Trim(), StringComparison.OrdinalIgnoreCase);
}

/// <summary>An agency (main) or consultant organisation (Consultancy) and whether the signed-in user manages it.</summary>
/// <param name="CanManage">The master admin who created it (and its operation admins): POs, reopen, invoice review.</param>
public sealed record ExpenditureParty(string Id, string Name, string? CreatedBy, bool Active, bool CanManage);

/// <summary>
/// Whose figures a user sees: the Admin every agency (organisation); a master admin those it created (Users.CreatedBy, set by
/// the agency form to the master admin's UserId; an operation admin works as its master admin), and those whose creator is no
/// master admin of this portal (legacy rows created by another user), so none is left without a manager; an agency itself.
/// </summary>
public static class ExpenditureParties
{
    internal const string PartiesSql = "SELECT UserId, UserName, CreatedBy, IsActive FROM dbo.Users WHERE RoleId = 2;";
    internal const string MastersSql = "SELECT UserId FROM dbo.Users WHERE RoleId = 7;";

    public sealed class Row
    {
        public string? UserId { get; init; }
        public string? UserName { get; init; }
        public string? CreatedBy { get; init; }
        public bool? IsActive { get; init; }
    }

    public sealed class IdRow
    {
        public string? UserId { get; init; }
    }

    public static async Task<List<ExpenditureParty>> ForAsync(ISqlExecutor db, ZedUser user, CancellationToken ct)
    {
        var rows = (await db.QuerySqlAsync<Row>(PartiesSql, null, ct)).Where(r => !string.IsNullOrWhiteSpace(r.UserId)).ToList();
        if (user.RoleId == (int)UserRole.Agency)
            return rows.Where(r => Expenditure.Same(r.UserId, user.UserId)).Select(r => Party(r, false)).Take(1).ToList();
        if (user.RoleId == (int)UserRole.Admin) return rows.Select(r => Party(r, false)).OrderBy(p => p.Name).ToList();
        if (user.RoleId != (int)UserRole.MasterAdmin) return [];
        var masters = (await db.QuerySqlAsync<IdRow>(MastersSql, null, ct)).Select(m => m.UserId?.Trim()).OfType<string>()
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        return rows.Where(r => Expenditure.Same(r.CreatedBy, user.UserId) || string.IsNullOrWhiteSpace(r.CreatedBy) || !masters.Contains(r.CreatedBy.Trim()))
            .Select(r => Party(r, true)).OrderBy(p => p.Name).ToList();
    }

    private static ExpenditureParty Party(Row r, bool manage) =>
        new(r.UserId!.Trim(), string.IsNullOrWhiteSpace(r.UserName) ? r.UserId!.Trim() : r.UserName.Trim(), r.CreatedBy?.Trim(), r.IsActive != false, manage);

    public static async Task<ExpenditureParty?> FindAsync(ISqlExecutor db, ZedUser user, string? id, CancellationToken ct) =>
        string.IsNullOrWhiteSpace(id) ? null : (await ForAsync(db, user, ct)).FirstOrDefault(p => Expenditure.Same(p.Id, id));
}

/// <summary>
/// Freezes the cases that count on their records (migration 0098), set-based and idempotent (only rows not yet counted):
/// the rate is the set in force on the day the case counted (dbo.ExpenditureRates; NULL while no set was in force). Run
/// before every figure is read and before every allotment check, at most every <see cref="Every"/> per database.
/// </summary>
public static class ExpenditureSweep
{
    public static readonly TimeSpan Every = TimeSpan.FromSeconds(30);

    private sealed class Gate
    {
        public readonly SemaphoreSlim Lock = new(1, 1);
        public DateTime Last = DateTime.MinValue;
    }

    private static readonly ConditionalWeakTable<ISqlExecutor, Gate> Gates = new();

    /// <summary>Main: an assessment case (one row per unit and level).</summary>
    internal const string MainSql =
        "UPDATE C SET ExpCountedOn = ISNULL(C.CertificationStatusDate, GETDATE()), " +
        "ExpCaseKind = CASE WHEN C.CertificationStatus IN (6, 16) THEN 'Completed' ELSE 'Rejected' END, " +
        "ExpAgencyId = LTRIM(RTRIM(C.CertificationBodyUserId)), " +
        "ExpRate = (SELECT TOP (1) CASE WHEN C.CertificationStatus IN (6, 16) THEN R.RateCompleted ELSE R.RateRejected END " +
        "FROM dbo.ExpenditureRates R WHERE R.Kind = 'Agency' AND R.SupersededOn IS NULL AND R.Level = C.Certification " +
        "AND R.EffectiveFrom <= CAST(ISNULL(C.CertificationStatusDate, GETDATE()) AS date) ORDER BY R.EffectiveFrom DESC) " +
        "FROM dbo.MsmeCertifications C WHERE C.ExpCountedOn IS NULL AND ISNULL(C.CertificationBodyUserId, '') <> '' " +
        "AND (C.CertificationStatus IN (6, 16) OR (C.CertificationStatus = 99 AND " +
        "(CASE WHEN C.Certification IN @DesktopLevels THEN C.DesktopAssessorId ELSE C.SiteAssessorId END) IS NOT NULL));";

    /// <summary>Main, ZED_SURVEILLANCE's rows: one per surveillance visit.</summary>
    internal const string SurveillanceSql =
        "UPDATE C SET ExpCountedOn = ISNULL(C.CertificationStatusDate, GETDATE()), ExpCaseKind = 'Surveillance', " +
        "ExpAgencyId = LTRIM(RTRIM(C.CertificationBodyUserId)), " +
        "ExpRate = (SELECT TOP (1) R.RateSurveillance FROM dbo.ExpenditureRates R WHERE R.Kind = 'Agency' AND R.SupersededOn IS NULL AND R.Level = C.Certification " +
        "AND R.EffectiveFrom <= CAST(ISNULL(C.CertificationStatusDate, GETDATE()) AS date) ORDER BY R.EffectiveFrom DESC) " +
        "FROM ZED_SURVEILLANCE.dbo.MsmeCertifications C WHERE C.ExpCountedOn IS NULL AND ISNULL(C.CertificationBodyUserId, '') <> '' " +
        "AND (C.CertificationStatus IN (6, 16) OR (C.CertificationStatus = 99 AND COALESCE(C.SiteAssessorId, C.DesktopAssessorId) IS NOT NULL));";

    /// <summary>When the MSME's payment of milestone <paramref name="m"/> of the row's level succeeded (its first record).</summary>
    internal static string PaidSql(int m) =>
        "(SELECT MIN(P.CreatedDate) FROM dbo.MsmePaymentInfo P WHERE P.ZedId = C.ZedId AND P.Certification = C.Certification " +
        $"AND P.MileStoneNum = '{m}')";

    /// <summary>
    /// When the unit was certified at the row's level on main (the first certification since its handholding of the level
    /// started, i.e. milestone 1 was paid; an older certificate never counts).
    /// </summary>
    internal static readonly string CertifiedSql =
        "(SELECT MIN(ISNULL(M.CertificationStatusDate, GETDATE())) FROM ZEDCS_V2_LIVE.dbo.MsmeCertifications M " +
        $"WHERE M.ZedId = C.ZedId AND M.Certification = C.Certification AND {Expenditure.CertifiedOnMain} " +
        $"AND ISNULL(M.CertificationStatusDate, GETDATE()) >= ISNULL({PaidSql(1)}, '19000101'))";

    /// <summary>
    /// Consultancy: milestone <paramref name="n"/> of the units' rows (the rates are main's). @PaidLevels: the levels with more
    /// than n milestones (milestone n counts when milestone n+1 is paid); @LastLevels: the levels whose last milestone is n
    /// (counts when the unit is certified at the level, or when milestone n was paid if the certificate came first).
    /// </summary>
    internal static string MilestoneSql(int n) =>
        $"UPDATE C SET ExpM{n}CountedOn = D.CountedOn, ExpM{n}OrgId = LTRIM(RTRIM(C.CertificationBodyUserId)), " +
        $"ExpM{n}Rate = (SELECT TOP (1) R.Milestone{n}Rate FROM ZEDCS_V2_LIVE.dbo.ExpenditureRates R WHERE R.Kind = 'Consultant' " +
        "AND R.SupersededOn IS NULL AND R.Level = C.Certification AND R.EffectiveFrom <= CAST(D.CountedOn AS date) ORDER BY R.EffectiveFrom DESC) " +
        "FROM dbo.MsmeCertifications C CROSS APPLY (SELECT CASE " +
        $"WHEN C.Certification IN @PaidLevels THEN {PaidSql(n + 1)} " +
        "WHEN C.Certification IN @LastLevels THEN (SELECT CASE WHEN X.CertifiedOn IS NULL THEN NULL WHEN X.PaidOn > X.CertifiedOn THEN X.PaidOn " +
        $"ELSE X.CertifiedOn END FROM (SELECT {PaidSql(n)} AS PaidOn, {CertifiedSql} AS CertifiedOn) X) " +
        "END AS CountedOn) D " +
        $"WHERE C.ExpM{n}CountedOn IS NULL AND ISNULL(C.CertificationBodyUserId, '') <> '' AND C.NcCount >= {n} AND D.CountedOn IS NOT NULL;";

    /// <summary>The arguments of <see cref="MilestoneSql"/> from the milestones of each level.</summary>
    internal static object MilestoneArgs(IReadOnlyDictionary<string, int> milestones, int n) => new
    {
        PaidLevels = milestones.Where(l => l.Value > n).Select(l => l.Key).ToList(),
        LastLevels = milestones.Where(l => l.Value == n).Select(l => l.Key).ToList(),
    };

    /// <summary>The levels whose last assessment step is the desktop ("Desktop only", Admin → Certification Levels).</summary>
    public static async Task<List<string>> DesktopLevelsAsync(ISqlExecutor db, ILogger log, CancellationToken ct)
    {
        var stored = await LevelFlows.StoredAsync(db, log, ct);
        return LevelRegistry.All
            .Where(l => LevelFlows.FlowOf(stored.GetValueOrDefault(l.Code)?.AssessmentFlow, l.AssessmentMode) == LevelFlows.Desktop)
            .Select(l => l.Code).ToList();
    }

    public static async Task RunAsync(ISqlExecutor db, PortalHost host, ILogger log, CancellationToken ct, bool force = false)
    {
        if (host.System == PortalSystem.Surveillance) return;
        var gate = Gates.GetValue(db, _ => new Gate());
        if (!force && DateTime.UtcNow - gate.Last < Every) return;
        await gate.Lock.WaitAsync(ct);
        try
        {
            if (!force && DateTime.UtcNow - gate.Last < Every) return;
            if (host.System == PortalSystem.Consultancy)
            {
                var milestones = await ExpenditureRates.MilestoneCountsAsync(db, log, ct);
                for (var n = 1; n <= Expenditure.MaxMilestones; n++)
                    await TryAsync(db, MilestoneSql(n), MilestoneArgs(milestones, n), log, "milestone " + n, ct);
            }
            else
            {
                var desktop = await DesktopLevelsAsync(db, log, ct);
                await TryAsync(db, MainSql, new { DesktopLevels = desktop }, log, "assessment cases", ct);
                await TryAsync(db, SurveillanceSql, null, log, "surveillance visits", ct);
            }
            gate.Last = DateTime.UtcNow;
        }
        finally
        {
            gate.Lock.Release();
        }
    }

    private static async Task TryAsync(ISqlExecutor db, string sql, object? args, ILogger log, string what, CancellationToken ct)
    {
        try { await db.ExecuteSqlAsync(sql, args, ct); }
        catch (DbException ex) { log.LogWarning(ex, "Expenditure: {What} not counted (is migration 0098 applied?)", what); }
    }
}

/// <summary>A filter of the figures: who, which level, where (the unit's plant state), when (the day the case counted).</summary>
public sealed record ExpenditureFilter(string? PartyId, string? Level, string? State, DateTime From, DateTime To)
{
    public static readonly DateTime Start = new(2000, 1, 1);
    public static readonly DateTime End = new(2100, 1, 1);

    /// <summary>One month of one party (an invoice).</summary>
    public static ExpenditureFilter MonthOf(string partyId, DateTime month) => new(partyId, null, null, month, month.AddMonths(1));

    public object Args => new { PartyId, Level, State, From, To };
}

/// <summary>Counted cases grouped by party, level and kind.</summary>
public sealed class ExpenditureCount
{
    public string? PartyId { get; init; }
    public string? Level { get; init; }
    public string? Kind { get; init; }
    public int Cases { get; init; }
    public decimal Amount { get; init; }
    /// <summary>The amount of the cases whose month has a submitted or approved invoice.</summary>
    public decimal Invoiced { get; init; }
}

/// <summary>One counted case (the "Cases" pop-up, the invoice's month).</summary>
public sealed class ExpenditureCase
{
    public string? ZedId { get; init; }
    public string? UnitName { get; init; }
    public string? State { get; init; }
    public string? Level { get; init; }
    public string? Kind { get; init; }
    public int? Milestone { get; init; }
    public DateTime? CountedOn { get; init; }
    public decimal? Rate { get; init; }
    /// <summary>A milestone that is its level's last (counted when the unit was certified, not when the next was paid).</summary>
    public bool LastMilestone { get; set; }
}

/// <summary>The counted cases' queries of each system (main: assessments and ZED_SURVEILLANCE's visits; Consultancy: milestones).</summary>
public static class ExpenditureQueries
{
    private const string Filter =
        " AND (@PartyId IS NULL OR X.PartyId = @PartyId) AND (@Level IS NULL OR X.Level = @Level) AND X.CountedOn >= @From AND X.CountedOn < @To";

    private static string StateFilter(string db) =>
        $" AND (@State IS NULL OR EXISTS (SELECT 1 FROM {db}dbo.Msme M WHERE M.ZedId = X.ZedId AND M.PStateName = @State))";

    /// <summary>Main's assessment cases (db "") or ZED_SURVEILLANCE's visits (db "ZED_SURVEILLANCE.") as rows X.</summary>
    internal static string Cases(string db) =>
        "(SELECT C.ZedId, C.Certification AS Level, C.ExpAgencyId AS PartyId, C.ExpCountedOn AS CountedOn, C.ExpRate AS Rate, " +
        $"C.ExpCaseKind AS Kind, CAST(NULL AS int) AS Milestone FROM {db}dbo.MsmeCertifications C WHERE C.ExpCountedOn IS NOT NULL) X";

    /// <summary>Consultancy's counted milestones as rows X (one per milestone column).</summary>
    internal static readonly string Milestones =
        "(" + string.Join(" UNION ALL ", Enumerable.Range(1, Expenditure.MaxMilestones).Select(n =>
            $"SELECT C.ZedId, C.Certification AS Level, C.ExpM{n}OrgId AS PartyId, C.ExpM{n}CountedOn AS CountedOn, C.ExpM{n}Rate AS Rate, " +
            $"'Milestone' AS Kind, {n} AS Milestone FROM dbo.MsmeCertifications C WHERE C.ExpM{n}CountedOn IS NOT NULL")) + ") X";

    private const string InvoiceJoin =
        " LEFT JOIN dbo.ExpenditureInvoices I ON I.PartyId = X.PartyId AND I.InvoiceMonth = DATEFROMPARTS(YEAR(X.CountedOn), MONTH(X.CountedOn), 1) " +
        "AND I.Status IN ('Submitted', 'Approved')";

    private static string CountSql(string rows, string stateDb) =>
        "SELECT X.PartyId, X.Level, X.Kind, COUNT(*) AS Cases, SUM(ISNULL(X.Rate, 0)) AS Amount, " +
        "SUM(CASE WHEN I.Id IS NULL THEN 0 ELSE ISNULL(X.Rate, 0) END) AS Invoiced FROM " + rows + InvoiceJoin +
        " WHERE 1 = 1" + Filter + StateFilter(stateDb) + " GROUP BY X.PartyId, X.Level, X.Kind;";

    private static string CaseSql(string rows, string stateDb) =>
        "SELECT TOP (2000) X.ZedId, U.PUnitName AS UnitName, U.PStateName AS State, X.Level, X.Kind, X.Milestone, X.CountedOn, X.Rate FROM " + rows +
        $" OUTER APPLY (SELECT TOP (1) M.PUnitName, M.PStateName FROM {stateDb}dbo.Msme M WHERE M.ZedId = X.ZedId) U" +
        " WHERE 1 = 1" + Filter + " AND (@State IS NULL OR U.PStateName = @State) ORDER BY X.CountedOn DESC;";

    internal static readonly string MainCountSql = CountSql(Cases(""), "");
    internal static readonly string SurveillanceCountSql = CountSql(Cases("ZED_SURVEILLANCE."), "ZED_SURVEILLANCE.");
    internal static readonly string MilestoneCountSql = CountSql(Milestones, "");
    internal static readonly string MainCaseSql = CaseSql(Cases(""), "");
    internal static readonly string SurveillanceCaseSql = CaseSql(Cases("ZED_SURVEILLANCE."), "ZED_SURVEILLANCE.");
    internal static readonly string MilestoneCaseSql = CaseSql(Milestones, "");

    public static async Task<List<ExpenditureCount>> CountsAsync(ISqlExecutor db, PortalHost host, ExpenditureFilter f, ILogger log, CancellationToken ct)
    {
        string[] sqls = host.System == PortalSystem.Consultancy ? [MilestoneCountSql] : [MainCountSql, SurveillanceCountSql];
        var all = new List<ExpenditureCount>();
        foreach (var sql in sqls) all.AddRange(await TryAsync<ExpenditureCount>(db, sql, f.Args, log, ct));
        return all;
    }

    public static async Task<List<ExpenditureCase>> CasesAsync(ISqlExecutor db, PortalHost host, ExpenditureFilter f, ILogger log, CancellationToken ct)
    {
        string[] sqls = host.System == PortalSystem.Consultancy ? [MilestoneCaseSql] : [MainCaseSql, SurveillanceCaseSql];
        var all = new List<ExpenditureCase>();
        foreach (var sql in sqls) all.AddRange(await TryAsync<ExpenditureCase>(db, sql, f.Args, log, ct));
        if (host.System == PortalSystem.Consultancy && all.Count > 0)
        {
            var milestones = await ExpenditureRates.MilestoneCountsAsync(db, log, ct);
            foreach (var c in all)
                c.LastMilestone = c.Milestone is { } m && m >= milestones.GetValueOrDefault(c.Level?.Trim() ?? "", Expenditure.MaxMilestones);
        }
        return all.OrderByDescending(c => c.CountedOn).Take(2000).ToList();
    }

    private static async Task<IReadOnlyList<T>> TryAsync<T>(ISqlExecutor db, string sql, object args, ILogger log, CancellationToken ct)
    {
        try { return await db.QuerySqlAsync<T>(sql, args, ct); }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Expenditure figures not read (is migration 0098 applied?)");
            return [];
        }
    }

    /// <summary>One party's counted cases per month and kind (its invoices page).</summary>
    public sealed class MonthCount
    {
        public DateTime Month { get; init; }
        public string? Kind { get; init; }
        public int Cases { get; init; }
        public decimal Amount { get; init; }
    }

    private static string MonthSql(string rows) =>
        "SELECT DATEFROMPARTS(YEAR(X.CountedOn), MONTH(X.CountedOn), 1) AS Month, X.Kind, COUNT(*) AS Cases, SUM(ISNULL(X.Rate, 0)) AS Amount FROM " + rows +
        " WHERE X.PartyId = @PartyId AND X.CountedOn >= @From AND X.CountedOn < @To GROUP BY DATEFROMPARTS(YEAR(X.CountedOn), MONTH(X.CountedOn), 1), X.Kind;";

    internal static readonly string MainMonthSql = MonthSql(Cases(""));
    internal static readonly string SurveillanceMonthSql = MonthSql(Cases("ZED_SURVEILLANCE."));
    internal static readonly string MilestoneMonthSql = MonthSql(Milestones);

    public static async Task<List<MonthCount>> MonthsAsync(ISqlExecutor db, PortalHost host, string partyId, DateTime from, DateTime to, ILogger log, CancellationToken ct)
    {
        string[] sqls = host.System == PortalSystem.Consultancy ? [MilestoneMonthSql] : [MainMonthSql, SurveillanceMonthSql];
        var all = new List<MonthCount>();
        foreach (var sql in sqls) all.AddRange(await TryAsync<MonthCount>(db, sql, new { PartyId = partyId, From = from, To = to }, log, ct));
        return all;
    }

    /// <summary>One line of a month's cases at one rate (the invoice review: "41 completed × ₹ 3,000 from 01-11-2026").</summary>
    public sealed class RateLine
    {
        public string? Kind { get; init; }
        public string? Level { get; init; }
        public int? Milestone { get; init; }
        public decimal? Rate { get; init; }
        public DateTime? RateFrom { get; init; }
        public int Cases { get; init; }
        public decimal Amount { get; init; }
    }

    private static string BreakdownSql(string rows, string ratesDb, string kind) =>
        "SELECT X.Kind, X.Level, X.Milestone, X.Rate, S.EffectiveFrom AS RateFrom, COUNT(*) AS Cases, SUM(ISNULL(X.Rate, 0)) AS Amount FROM " + rows +
        $" OUTER APPLY (SELECT TOP (1) R.EffectiveFrom FROM {ratesDb}dbo.ExpenditureRates R WHERE R.Kind = '{kind}' AND R.SupersededOn IS NULL AND R.Level = X.Level " +
        "AND R.EffectiveFrom <= CAST(X.CountedOn AS date) ORDER BY R.EffectiveFrom DESC) S" +
        " WHERE X.PartyId = @PartyId AND X.CountedOn >= @From AND X.CountedOn < @To GROUP BY X.Kind, X.Level, X.Milestone, X.Rate, S.EffectiveFrom;";

    internal static readonly string MainBreakdownSql = BreakdownSql(Cases(""), "", Expenditure.Agency);
    internal static readonly string SurveillanceBreakdownSql = BreakdownSql(Cases("ZED_SURVEILLANCE."), "", Expenditure.Agency);
    internal static readonly string MilestoneBreakdownSql = BreakdownSql(Milestones, "ZEDCS_V2_LIVE.", Expenditure.Consultant);

    public static async Task<List<RateLine>> BreakdownAsync(ISqlExecutor db, PortalHost host, string partyId, DateTime month, ILogger log, CancellationToken ct)
    {
        string[] sqls = host.System == PortalSystem.Consultancy ? [MilestoneBreakdownSql] : [MainBreakdownSql, SurveillanceBreakdownSql];
        var all = new List<RateLine>();
        foreach (var sql in sqls) all.AddRange(await TryAsync<RateLine>(db, sql, new { PartyId = partyId, From = month, To = month.AddMonths(1) }, log, ct));
        return [.. all.OrderBy(l => l.Kind).ThenBy(l => l.Level).ThenBy(l => l.Milestone).ThenBy(l => l.RateFrom)];
    }

    /// <summary>The GST % of a payee type's rate set in force on <paramref name="day"/>, else 18.</summary>
    public static decimal GstOn(IReadOnlyList<ExpenditureRates.Row> rows, string kind, DateTime day) =>
        rows.Where(r => r.Kind == kind && r.EffectiveFrom.Date <= day.Date).OrderByDescending(r => r.EffectiveFrom).FirstOrDefault()?.GstPercent
        ?? Expenditure.DefaultGst;
}
