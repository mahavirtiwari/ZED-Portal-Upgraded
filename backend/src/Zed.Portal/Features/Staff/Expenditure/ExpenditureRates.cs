using System.Data.Common;
using System.Globalization;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.CertLevels;

namespace Zed.Portal.Features.Staff.Expenditure;

/// <summary>
/// The rate sets (dbo.ExpenditureRates on main, migration 0098): per payee type (Agency / Consultant) and date of effect, one
/// row per level. A case is priced with the set in force on the date it counted and keeps that rate (frozen on the case,
/// <see cref="ExpenditureSweep"/>). Sets may be added with future dates of effect. A set is read-only once an approved
/// invoice includes a case priced with it; until then an edit (or a new set) re-prices the cases from its date of effect
/// that are not in an approved invoice. An edit keeps the replaced rows (SupersededOn) for the history.
/// </summary>
public static class ExpenditureRates
{
    public sealed class Row
    {
        public int Id { get; init; }
        public string? Kind { get; init; }
        public DateTime EffectiveFrom { get; init; }
        public string? Level { get; init; }
        public decimal? RateCompleted { get; init; }
        public decimal? RateRejected { get; init; }
        public decimal? RateSurveillance { get; init; }
        public decimal? Milestone1Rate { get; init; }
        public decimal? Milestone2Rate { get; init; }
        public decimal? Milestone3Rate { get; init; }
        public decimal GstPercent { get; init; }
        public string? SavedBy { get; init; }
        public string? SavedByName { get; init; }
        public DateTime? SavedOn { get; init; }
        public DateTime? SupersededOn { get; init; }

        public decimal?[] Milestones => [Milestone1Rate, Milestone2Rate, Milestone3Rate];
    }

    private const string Columns =
        "Id, Kind, EffectiveFrom, Level, RateCompleted, RateRejected, RateSurveillance, Milestone1Rate, Milestone2Rate, Milestone3Rate, " +
        "GstPercent, SavedBy, SavedByName, SavedOn, SupersededOn";

    internal const string ListSql = "SELECT " + Columns + " FROM dbo.ExpenditureRates WHERE SupersededOn IS NULL;";
    /// <summary>From the Consultancy host: main's table.</summary>
    internal const string ListFromConsultancySql = "SELECT " + Columns + " FROM ZEDCS_V2_LIVE.dbo.ExpenditureRates WHERE SupersededOn IS NULL;";
    internal const string HistorySql = "SELECT TOP (5000) " + Columns + " FROM dbo.ExpenditureRates ORDER BY SavedOn DESC, Id DESC;";

    /// <summary>The current sets' rows (not superseded).</summary>
    public static async Task<List<Row>> ListAsync(ISqlExecutor db, PortalHost host, ILogger log, CancellationToken ct)
    {
        try
        {
            return [.. await db.QuerySqlAsync<Row>(host.System == PortalSystem.Main ? ListSql : ListFromConsultancySql, null, ct)];
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Expenditure rates not read (is migration 0098 applied?)");
            return [];
        }
    }

    /// <summary>The dates of effect of a payee type's sets, oldest first.</summary>
    public static List<DateTime> Dates(IEnumerable<Row> rows, string kind) =>
        rows.Where(r => r.Kind == kind).Select(r => r.EffectiveFrom.Date).Distinct().Order().ToList();

    /// <summary>The date of effect of the set in force on <paramref name="day"/>.</summary>
    public static DateTime? InForceFrom(IEnumerable<Row> rows, string kind, DateTime day) =>
        Dates(rows, kind).Where(d => d <= day.Date).Select(d => (DateTime?)d).LastOrDefault();

    /// <summary>
    /// The handholding milestones of each level, read from the Consultancy fee master (the highest AssessmentFee.MileStone of the
    /// level's ordinary rows; rows without a level count for every level). A level without rows keeps the portal's three.
    /// </summary>
    internal const string MilestoneCountSql =
        "SELECT Certification AS Level, MAX(MileStone) AS Milestones FROM ZED_CONSULTANT.dbo.AssessmentFee " +
        "WHERE MileStone IS NOT NULL AND ISNULL(IsActive, 1) = 1 AND PayAllAtMilestone1 IS NULL " +
        "AND CAST(GETDATE() AS date) BETWEEN ISNULL(EffectiveFrom, '19000101') AND ISNULL(EffectiveTo, '99991231') GROUP BY Certification;";

    public sealed class MilestoneCountRow
    {
        public string? Level { get; init; }
        public int? Milestones { get; init; }
    }

    public static async Task<Dictionary<string, int>> MilestoneCountsAsync(ISqlExecutor db, ILogger log, CancellationToken ct)
    {
        IReadOnlyList<MilestoneCountRow> rows;
        try { rows = await db.QuerySqlAsync<MilestoneCountRow>(MilestoneCountSql, null, ct); }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Milestones per level not read from the Consultancy fee master");
            rows = [];
        }
        var generic = rows.Where(r => string.IsNullOrWhiteSpace(r.Level)).Select(r => r.Milestones ?? 0).DefaultIfEmpty(0).Max();
        var result = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var level in LevelRegistry.Handholding)
        {
            var own = rows.Where(r => Expenditure.Same(r.Level, level)).Select(r => r.Milestones ?? 0).DefaultIfEmpty(0).Max();
            var n = own > 0 ? own : generic > 0 ? generic : Documents.DocumentLevels.Milestones;
            result[level] = Math.Clamp(n, 1, Expenditure.MaxMilestones);
        }
        return result;
    }

    // ------------------------------------------------------------------ approved invoices (locks) and re-pricing (run on main)

    private const string Approved = " AND I.Status = 'Approved'";

    private static string MonthOf(string date) => $"DATEFROMPARTS(YEAR({date}), MONTH({date}), 1)";

    /// <summary>Cases counted in [@From, @To) that are in approved invoices (@To NULL: no end).</summary>
    internal static string[] LockSql(string kind) => kind == Expenditure.Agency
        ? ["SELECT COUNT(*) AS Cases FROM dbo.MsmeCertifications C JOIN dbo.ExpenditureInvoices I ON I.PartyId = C.ExpAgencyId " +
          $"AND I.InvoiceMonth = {MonthOf("C.ExpCountedOn")}{Approved} WHERE C.ExpCountedOn >= @From AND (@To IS NULL OR C.ExpCountedOn < @To);",
           "SELECT COUNT(*) AS Cases FROM ZED_SURVEILLANCE.dbo.MsmeCertifications C JOIN dbo.ExpenditureInvoices I ON I.PartyId = C.ExpAgencyId " +
          $"AND I.InvoiceMonth = {MonthOf("C.ExpCountedOn")}{Approved} WHERE C.ExpCountedOn >= @From AND (@To IS NULL OR C.ExpCountedOn < @To);"]
        : [.. Enumerable.Range(1, Expenditure.MaxMilestones).Select(n =>
            $"SELECT COUNT(*) AS Cases FROM ZED_CONSULTANT.dbo.MsmeCertifications C JOIN ZED_CONSULTANT.dbo.ExpenditureInvoices I ON I.PartyId = C.ExpM{n}OrgId " +
            $"AND I.InvoiceMonth = {MonthOf($"C.ExpM{n}CountedOn")}{Approved} WHERE C.ExpM{n}CountedOn >= @From AND (@To IS NULL OR C.ExpM{n}CountedOn < @To);")];

    private static string RateOf(string column, string kind, string level, string date) =>
        $"(SELECT TOP (1) {column} FROM dbo.ExpenditureRates R WHERE R.Kind = '{kind}' AND R.SupersededOn IS NULL AND R.Level = {level} " +
        $"AND R.EffectiveFrom <= CAST({date} AS date) ORDER BY R.EffectiveFrom DESC)";

    /// <summary>Re-prices the cases counted from @From that are not in an approved invoice with the sets as they are now.</summary>
    internal static string RepriceSql(string kind) => kind == Expenditure.Agency
        ? $"UPDATE C SET ExpRate = {RateOf("CASE WHEN C.ExpCaseKind = 'Completed' THEN R.RateCompleted ELSE R.RateRejected END", "Agency", "C.Certification", "C.ExpCountedOn")} " +
          "FROM dbo.MsmeCertifications C WHERE C.ExpCountedOn >= @From AND C.ExpCaseKind IN ('Completed', 'Rejected') AND NOT EXISTS (SELECT 1 FROM dbo.ExpenditureInvoices I " +
          $"WHERE I.PartyId = C.ExpAgencyId AND I.InvoiceMonth = {MonthOf("C.ExpCountedOn")}{Approved}); " +
          $"UPDATE C SET ExpRate = {RateOf("R.RateSurveillance", "Agency", "C.Certification", "C.ExpCountedOn")} " +
          "FROM ZED_SURVEILLANCE.dbo.MsmeCertifications C WHERE C.ExpCountedOn >= @From AND NOT EXISTS (SELECT 1 FROM dbo.ExpenditureInvoices I " +
          $"WHERE I.PartyId = C.ExpAgencyId AND I.InvoiceMonth = {MonthOf("C.ExpCountedOn")}{Approved});"
        : string.Join(" ", Enumerable.Range(1, Expenditure.MaxMilestones).Select(n =>
            $"UPDATE C SET ExpM{n}Rate = {RateOf($"R.Milestone{n}Rate", "Consultant", "C.Certification", $"C.ExpM{n}CountedOn")} " +
            $"FROM ZED_CONSULTANT.dbo.MsmeCertifications C WHERE C.ExpM{n}CountedOn >= @From AND NOT EXISTS (SELECT 1 FROM ZED_CONSULTANT.dbo.ExpenditureInvoices I " +
            $"WHERE I.PartyId = C.ExpM{n}OrgId AND I.InvoiceMonth = {MonthOf($"C.ExpM{n}CountedOn")}{Approved});"));

    public sealed class CountRow
    {
        public int Cases { get; init; }
    }

    /// <summary>How many cases counted in [from, to) are in approved invoices (each statement of <see cref="LockSql"/> added up).</summary>
    public static async Task<int> LockedCasesAsync(ISqlExecutor db, string kind, DateTime from, DateTime? to, ILogger log, CancellationToken ct)
    {
        var total = 0;
        foreach (var sql in LockSql(kind))
        {
            try { total += (await db.QuerySqlAsync<CountRow>(sql, new { From = from, To = to }, ct)).Sum(r => r.Cases); }
            catch (DbException ex) { log.LogWarning(ex, "Approved invoices of {Kind} not checked (is migration 0098 applied?)", kind); }
        }
        return total;
    }
}

/// <summary>Admin → Fees → Expenditure rates (main only; the Admin works there for the three portals).</summary>
[PortalSystems(PortalSystem.Main)]
[Route("api/staff/expenditure-rates")]
[StaffRoles(UserRole.Admin)]
public sealed class ExpenditureRatesController(ISqlExecutor db, PortalHost host, ILogger<ExpenditureRatesController> log) : StaffApiController
{
    /// <summary>The largest rate accepted (₹ 10 crore).</summary>
    public const decimal MaxRate = 100_000_000m;

    public sealed record AgencyLevel(string Level, string Name, string Flow);

    public sealed record ConsultantLevel(string Level, string Name, int Milestones);

    public sealed record SetLevel(string Level, decimal? Completed, decimal? Rejected, decimal? Surveillance, IReadOnlyList<decimal?> Milestones);

    /// <param name="InForce">The set in force today.</param>
    /// <param name="Locked">An approved invoice includes a case priced with it: read-only.</param>
    public sealed record RateSet(string Kind, string EffectiveFrom, decimal GstPercent, bool InForce, bool Locked, string? SavedBy, DateTime? SavedOn,
        IReadOnlyList<SetLevel> Levels);

    public sealed record RatesResponse(decimal GstPercent, string Today, IReadOnlyList<AgencyLevel> AgencyLevels,
        IReadOnlyList<ConsultantLevel> ConsultantLevels, IReadOnlyList<RateSet> Sets);

    [HttpGet]
    public async Task<ActionResult<RatesResponse>> Get(CancellationToken ct)
    {
        var rows = await ExpenditureRates.ListAsync(db, host, log, ct);
        var flows = await LevelFlows.StoredAsync(db, log, ct);
        var counts = await ExpenditureRates.MilestoneCountsAsync(db, log, ct);
        var today = Expenditure.Today;
        var sets = new List<RateSet>();
        foreach (var kind in new[] { Expenditure.Agency, Expenditure.Consultant })
        {
            var dates = ExpenditureRates.Dates(rows, kind);
            var inForce = ExpenditureRates.InForceFrom(rows, kind, today);
            for (var i = dates.Count - 1; i >= 0; i--)
            {
                var d = dates[i];
                var mine = rows.Where(r => r.Kind == kind && r.EffectiveFrom.Date == d).ToList();
                var locked = await ExpenditureRates.LockedCasesAsync(db, kind, d, i + 1 < dates.Count ? dates[i + 1] : null, log, ct) > 0;
                var newest = mine.MaxBy(r => r.SavedOn)!;
                sets.Add(new RateSet(kind, Day(d), newest.GstPercent, d == inForce, locked, newest.SavedByName ?? newest.SavedBy, newest.SavedOn,
                    mine.Select(r => new SetLevel(r.Level ?? "", r.RateCompleted, r.RateRejected, r.RateSurveillance,
                        r.Milestones.Take(counts.GetValueOrDefault(r.Level ?? "", Expenditure.MaxMilestones)).ToList())).ToList()));
            }
        }
        var gst = sets.FirstOrDefault(s => s.InForce)?.GstPercent ?? Expenditure.DefaultGst;
        var agencyLevels = LevelRegistry.All.Select(l => new AgencyLevel(l.Code, l.Name,
            LevelFlows.Label(LevelFlows.FlowOf(flows.GetValueOrDefault(l.Code)?.AssessmentFlow, l.AssessmentMode)))).ToList();
        var consultantLevels = LevelRegistry.Handholding.Select(code =>
            new ConsultantLevel(code, LevelRegistry.NameOf(code), counts.GetValueOrDefault(code, Documents.DocumentLevels.Milestones))).ToList();
        return new RatesResponse(gst, Day(today), agencyLevels, consultantLevels, sets);
    }

    public sealed record LevelInput(string? Level, decimal? Completed, decimal? Rejected, decimal? Surveillance, IReadOnlyList<decimal?>? Milestones);

    /// <param name="Kind">Agency or Consultant.</param>
    /// <param name="EffectiveFrom">The date of effect (yyyy-MM-dd).</param>
    /// <param name="Edit">True: change the rates of the set of that date; false: add a new set.</param>
    public sealed record SaveRequest(string? Kind, string? EffectiveFrom, bool Edit, decimal? GstPercent, IReadOnlyList<LevelInput>? Levels);

    private sealed record LevelValues(string Level, decimal? Completed, decimal? Rejected, decimal? Surveillance, decimal?[] Milestones);

    [HttpPut]
    public async Task<ActionResult<MessageResponse>> Save(SaveRequest req, CancellationToken ct)
    {
        var kind = req.Kind == Expenditure.Agency ? Expenditure.Agency : req.Kind == Expenditure.Consultant ? Expenditure.Consultant : null;
        if (kind is null) return this.Problem400("Please choose the assessment agency or consultant organisation rates.");
        if (Expenditure.Day(req.EffectiveFrom) is not { } from || from.Year < 2000 || from.Year > 2100)
            return this.Problem400("Please enter the date of effect.");
        if (req.GstPercent is not { } gst || gst < 0 || gst > 100 || decimal.Round(gst, 2) != gst)
            return this.Problem400("Please enter the GST % (0 to 100).");
        var counts = await ExpenditureRates.MilestoneCountsAsync(db, log, ct);
        var levels = new List<LevelValues>();
        foreach (var l in req.Levels ?? [])
        {
            var code = kind == Expenditure.Agency
                ? LevelRegistry.Canonical(l.Level)
                : LevelRegistry.Handholding.FirstOrDefault(h => Expenditure.Same(h, l.Level?.Replace("-", "")));
            if (code is null || levels.Any(x => x.Level == code)) return this.Problem400("Please choose valid certification levels.");
            var values = new decimal?[Expenditure.MaxMilestones];
            if (kind == Expenditure.Agency)
            {
                if (Bad(l.Completed) || Bad(l.Rejected) || Bad(l.Surveillance)) return this.Problem400(AmountProblem);
                levels.Add(new LevelValues(code, l.Completed, l.Rejected, l.Surveillance, values));
                continue;
            }
            var n = counts.GetValueOrDefault(code, Documents.DocumentLevels.Milestones);
            var rates = (l.Milestones ?? []).ToList();
            if (rates.Count > Expenditure.MaxMilestones || rates.Skip(n).Any(r => r is not null))
                return this.Problem400($"{LevelRegistry.NameOf(code)} has {n} milestone{(n == 1 ? "" : "s")}: please enter a rate for each of them only.");
            if (rates.Any(Bad)) return this.Problem400(AmountProblem);
            for (var i = 0; i < Math.Min(n, rates.Count); i++) values[i] = rates[i];
            levels.Add(new LevelValues(code, null, null, null, values));
        }
        if (levels.Count == 0) return this.Problem400("Please enter the rates.");

        var rows = await ExpenditureRates.ListAsync(db, host, log, ct);
        var dates = ExpenditureRates.Dates(rows, kind);
        var exists = dates.Contains(from.Date);
        if (req.Edit && !exists) return this.Problem400("There is no rate set with this date of effect.");
        if (!req.Edit && exists) return this.Problem400($"A rate set with the date of effect {Shown(from)} exists: please edit it instead.");
        // Read-only once an approved invoice includes a case priced with it (an edit: its own period; a new set: from its date on).
        DateTime? until = req.Edit ? dates.Where(d => d > from.Date).Select(d => (DateTime?)d).FirstOrDefault() : null;
        if (await ExpenditureRates.LockedCasesAsync(db, kind, from.Date, until, log, ct) > 0)
            return this.Problem400(req.Edit
                ? $"The rate set of {Shown(from)} is read-only: an approved invoice includes cases priced with it."
                : $"Cases from {Shown(from)} are in approved invoices: please choose a later date of effect.");

        // Cases that counted before this change are counted (and priced) first; then the change re-prices those not approved.
        await ExpenditureSweep.RunAsync(db, host, log, ct, force: true);
        try
        {
            await db.ExecuteSqlAsync(SaveSql(levels.Count), SaveArgs(kind, from, gst, levels), ct);
        }
        catch (DbException ex)
        {
            log.LogError(ex, "Expenditure rates ({Kind} {From:yyyy-MM-dd}) not saved", kind, from);
            return this.Problem400("The rates could not be saved: please ask the administrator to apply database migration 0098.");
        }
        log.LogInformation("{Actor} {Action} the {Kind} expenditure rates of {From:yyyy-MM-dd}, GST {Gst}%", ActorId, req.Edit ? "changed" : "added", kind, from, gst);
        try { await db.ExecuteSqlAsync(ExpenditureRates.RepriceSql(kind), new { From = from.Date }, ct); }
        catch (DbException ex) { log.LogWarning(ex, "Counted {Kind} cases from {From:yyyy-MM-dd} not re-priced", kind, from); }
        return new MessageResponse(req.Edit ? "Rates saved." : $"Rate set from {Shown(from)} added.");
    }

    public sealed record HistoryEntry(string Kind, string EffectiveFrom, decimal GstPercent, string? SavedBy, DateTime? SavedOn, bool Current,
        IReadOnlyList<SetLevel> Levels);

    /// <summary>Every save of every set, newest first ("Rate history": the date of effect, who changed it, when, the rates).</summary>
    [HttpGet("history")]
    public async Task<ActionResult<IReadOnlyList<HistoryEntry>>> History(CancellationToken ct)
    {
        IReadOnlyList<ExpenditureRates.Row> rows;
        try { rows = await db.QuerySqlAsync<ExpenditureRates.Row>(ExpenditureRates.HistorySql, null, ct); }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Expenditure rate history not read");
            return Array.Empty<HistoryEntry>();
        }
        var counts = await ExpenditureRates.MilestoneCountsAsync(db, log, ct);
        return rows.GroupBy(r => (r.Kind, From: r.EffectiveFrom.Date, r.SavedOn))
            .Select(g => new HistoryEntry(g.Key.Kind ?? "", Day(g.Key.From), g.First().GstPercent, g.First().SavedByName ?? g.First().SavedBy, g.Key.SavedOn,
                g.All(r => r.SupersededOn is null),
                g.Select(r => new SetLevel(r.Level ?? "", r.RateCompleted, r.RateRejected, r.RateSurveillance,
                    r.Milestones.Take(counts.GetValueOrDefault(r.Level ?? "", Expenditure.MaxMilestones)).ToList())).ToList()))
            .OrderByDescending(h => h.SavedOn).ToList();
    }

    private const string AmountProblem = "Please enter amounts in rupees (0 to 10,00,00,000, at most two decimals).";

    private static bool Bad(decimal? v) => v is { } x && (x < 0 || x > MaxRate || decimal.Round(x, 2) != x);

    private static string Day(DateTime d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static string Shown(DateTime d) => d.ToString("dd-MM-yyyy", CultureInfo.InvariantCulture);

    /// <summary>One transaction: the set's current rows of these levels are superseded, its new rows added.</summary>
    internal static string SaveSql(int levels)
    {
        var sb = new System.Text.StringBuilder("SET XACT_ABORT ON; BEGIN TRAN; ");
        for (var i = 0; i < levels; i++)
        {
            sb.Append($"UPDATE dbo.ExpenditureRates SET SupersededOn = SYSUTCDATETIME() WHERE Kind = @Kind AND EffectiveFrom = @From AND Level = @L{i} AND SupersededOn IS NULL; ")
              .Append("INSERT INTO dbo.ExpenditureRates (Kind, EffectiveFrom, Level, RateCompleted, RateRejected, RateSurveillance, ")
              .Append("Milestone1Rate, Milestone2Rate, Milestone3Rate, GstPercent, SavedBy, SavedByName) VALUES ")
              .Append($"(@Kind, @From, @L{i}, @C{i}, @R{i}, @S{i}, @M1_{i}, @M2_{i}, @M3_{i}, @Gst, @SavedBy, @SavedByName); ");
        }
        return sb.Append("COMMIT;").ToString();
    }

    private DynamicParameters SaveArgs(string kind, DateTime from, decimal gst, List<LevelValues> levels)
    {
        var p = new DynamicParameters();
        p.Add("Kind", kind);
        p.Add("From", from.Date);
        p.Add("Gst", gst);
        p.Add("SavedBy", ActorId);
        p.Add("SavedByName", ActorName);
        for (var i = 0; i < levels.Count; i++)
        {
            var l = levels[i];
            p.Add($"L{i}", l.Level);
            p.Add($"C{i}", l.Completed);
            p.Add($"R{i}", l.Rejected);
            p.Add($"S{i}", l.Surveillance);
            for (var m = 0; m < Expenditure.MaxMilestones; m++) p.Add($"M{m + 1}_{i}", l.Milestones[m]);
        }
        return p;
    }
}
