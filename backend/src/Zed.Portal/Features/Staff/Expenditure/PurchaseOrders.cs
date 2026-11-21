using System.Data.Common;
using System.Globalization;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Expenditure;

/// <summary>
/// The cases of an agency's (organisation's) POs for one level, and what they are used by: <see cref="Used"/> = the cases
/// counted since the first PO's date (completed and rejected after assessment; milestones on Consultancy; surveillance
/// visits do not use PO cases), <see cref="InProgress"/> = the cases allotted to it and not finished yet (main: status 2 to 98
/// but 3, 6 and 16; Consultancy: a milestone paid and not counted yet). Allotment stops when both together reach the PO's cases.
/// A level without a PO has no limit (as before POs existed).
/// </summary>
public sealed record PoLevelStatus(string PartyId, string Level, int Cases, int Used, int InProgress, DateTime? FirstPo)
{
    public bool HasPo => FirstPo is not null;
    public int Committed => Used + InProgress;
    public int Left => Math.Max(0, Cases - Committed);
    public int Percent => Cases <= 0 ? 100 : (int)Math.Min(100, Math.Round(100.0 * Committed / Cases));
    public bool Stopped => HasPo && Committed >= Cases;
    /// <summary>NoPo, Open, Low (90% or more used: amber) or Stopped (red).</summary>
    public string State => !HasPo ? "NoPo" : Stopped ? "Stopped" : Percent >= 90 ? "Low" : "Open";
}

public static class PoLimits
{
    public sealed class TotalRow
    {
        public string? PartyId { get; init; }
        public string? Level { get; init; }
        public int Cases { get; init; }
        public DateTime? FirstPo { get; init; }
    }

    public sealed class CountRow
    {
        public string? PartyId { get; init; }
        public string? Level { get; init; }
        public int Cases { get; init; }
    }

    private const string Scope = " AND (@PartyId IS NULL OR {0} = @PartyId) AND (@Level IS NULL OR {1} = @Level)";

    internal const string TotalsSql =
        "SELECT PartyId, Level, SUM(Cases) AS Cases, MIN(PoDate) AS FirstPo FROM dbo.PurchaseOrders WHERE 1 = 1" +
        " AND (@PartyId IS NULL OR PartyId = @PartyId) AND (@Level IS NULL OR Level = @Level) GROUP BY PartyId, Level;";

    private static string UsedSql(string rows) =>
        "SELECT X.PartyId, X.Level, COUNT(*) AS Cases FROM " + rows +
        " JOIN (SELECT PartyId, Level, MIN(PoDate) AS FirstPo FROM dbo.PurchaseOrders GROUP BY PartyId, Level) P ON P.PartyId = X.PartyId AND P.Level = X.Level" +
        " WHERE X.CountedOn >= P.FirstPo AND X.Kind <> 'Surveillance'" + string.Format(CultureInfo.InvariantCulture, Scope, "X.PartyId", "X.Level") +
        " GROUP BY X.PartyId, X.Level;";

    internal static readonly string MainUsedSql = UsedSql(ExpenditureQueries.Cases(""));
    internal static readonly string ConsultancyUsedSql = UsedSql(ExpenditureQueries.Milestones);

    private static string InProgressSql(string status, string notCounted) =>
        "SELECT LTRIM(RTRIM(C.CertificationBodyUserId)) AS PartyId, C.Certification AS Level, COUNT(*) AS Cases FROM dbo.MsmeCertifications C " +
        $"WHERE {status}{notCounted} AND EXISTS (SELECT 1 FROM dbo.PurchaseOrders P WHERE P.PartyId = C.CertificationBodyUserId AND P.Level = C.Certification)" +
        string.Format(CultureInfo.InvariantCulture, Scope, "C.CertificationBodyUserId", "C.Certification") +
        " GROUP BY LTRIM(RTRIM(C.CertificationBodyUserId)), C.Certification;";

    /// <summary>
    /// Main: every allotted case not counted yet. 2026-11-21 (the owner): a case in desktop assessment (status 3) and a Silver /
    /// Gold case whose desktop is done and waits for the site visit (status 6 without a certificate) are in progress too; a
    /// completed case (16, or 6 with a certificate: ExpenditureData's rule) is counted, not in progress.
    /// </summary>
    internal static readonly string MainInProgressSql = InProgressSql(
        "C.CertificationStatus BETWEEN 2 AND 98 AND C.CertificationStatus <> 16 " +
        "AND NOT (C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))", " AND C.ExpCountedOn IS NULL");
    /// <summary>
    /// Consultancy: every milestone started (paid, 1..NcCount) and not counted yet. A milestone counts only when the next one
    /// is paid (the last: when the unit is certified), so a finished one waiting for that stays committed to the PO.
    /// </summary>
    internal static readonly string ConsultancyInProgressSql =
        "SELECT LTRIM(RTRIM(C.CertificationBodyUserId)) AS PartyId, C.Certification AS Level, SUM(" +
        string.Join(" + ", Enumerable.Range(1, Expenditure.MaxMilestones).Select(n =>
            $"CASE WHEN C.NcCount >= {n} AND C.ExpM{n}CountedOn IS NULL THEN 1 ELSE 0 END")) + ") AS Cases FROM dbo.MsmeCertifications C " +
        "WHERE C.NcCount >= 1 AND EXISTS (SELECT 1 FROM dbo.PurchaseOrders P WHERE P.PartyId = C.CertificationBodyUserId AND P.Level = C.Certification)" +
        string.Format(CultureInfo.InvariantCulture, Scope, "C.CertificationBodyUserId", "C.Certification") +
        " GROUP BY LTRIM(RTRIM(C.CertificationBodyUserId)), C.Certification;";

    /// <summary>The PO status of every party and level with a PO (filtered by party and level when given).</summary>
    public static async Task<List<PoLevelStatus>> StatusAsync(ISqlExecutor db, PortalHost host, string? partyId, string? level, ILogger log, CancellationToken ct)
    {
        if (host.System == PortalSystem.Surveillance) return [];
        await ExpenditureSweep.RunAsync(db, host, log, ct);
        var args = new { PartyId = partyId, Level = level };
        var consultancy = host.System == PortalSystem.Consultancy;
        try
        {
            var totals = await db.QuerySqlAsync<TotalRow>(TotalsSql, args, ct);
            if (totals.Count == 0) return [];
            var used = await db.QuerySqlAsync<CountRow>(consultancy ? ConsultancyUsedSql : MainUsedSql, args, ct);
            var open = await db.QuerySqlAsync<CountRow>(consultancy ? ConsultancyInProgressSql : MainInProgressSql, args, ct);
            int Of(IEnumerable<CountRow> rows, TotalRow t) =>
                rows.Where(r => Expenditure.Same(r.PartyId, t.PartyId) && Expenditure.Same(r.Level, t.Level)).Sum(r => r.Cases);
            return totals.Where(t => !string.IsNullOrWhiteSpace(t.PartyId) && !string.IsNullOrWhiteSpace(t.Level))
                .Select(t => new PoLevelStatus(t.PartyId!.Trim(), t.Level!.Trim(), t.Cases, Of(used, t), Of(open, t), t.FirstPo)).ToList();
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Purchase orders not read (is migration 0098 applied?)");
            return [];
        }
    }

    /// <summary>Why allotment of <paramref name="level"/> to the party has stopped.</summary>
    public static string StoppedMessage(PoLevelStatus s, string partyName, string levelName) =>
        $"Allotment to {partyName} for {levelName} has stopped: its purchase order is used up ({s.Committed} of {s.Cases} cases " +
        "completed or in progress). The master admin who created it can reopen the purchase order.";
}

/// <summary>
/// Purchase orders per agency (main) or consultant organisation (Consultancy) and level: on Agency Level Allocation and the
/// Consultant Organisations page. The master admin who created the agency (organisation) adds, edits and reopens them
/// (<see cref="ExpenditureParty.CanManage"/>); the Admin sees all. Every change is recorded in dbo.PurchaseOrderChanges.
/// 2026-11-18: the agency (organisation) reads its own POs, read-only, on its Expenditure page (GET only; the history and
/// every change stay the managers').
/// </summary>
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy)]
[Route("api/staff/expenditure/po")]
[StaffRoles(UserRole.Admin, UserRole.MasterAdmin, UserRole.Agency)]
public sealed partial class PurchaseOrdersController(ISqlExecutor db, PortalHost host, ILogger<PurchaseOrdersController> log) : StaffApiController
{
    public const int MaxCases = 1_000_000;
    public const int MaxReason = 1000;

    public sealed class PoRow
    {
        public int Id { get; init; }
        public string? PartyId { get; init; }
        public string? Level { get; init; }
        public string? PoNumber { get; init; }
        public DateTime PoDate { get; init; }
        public int Cases { get; init; }
        public string? CreatedBy { get; init; }
        public DateTime? CreatedOn { get; init; }
    }

    public sealed class ChangeRow
    {
        public int Id { get; init; }
        public int PurchaseOrderId { get; init; }
        public string? Level { get; init; }
        public string? ChangeType { get; init; }
        public string? Reason { get; init; }
        public int? CasesBefore { get; init; }
        public int? CasesAfter { get; init; }
        public string? Details { get; init; }
        public string? ChangedBy { get; init; }
        public string? ChangedByName { get; init; }
        public DateTime? ChangedOn { get; init; }
    }

    internal const string ListSql =
        "SELECT Id, PartyId, Level, PoNumber, PoDate, Cases, CreatedBy, CreatedOn FROM dbo.PurchaseOrders WHERE PartyId = @PartyId ORDER BY PoDate, Id;";
    internal const string FindSql = "SELECT Id, PartyId, Level, PoNumber, PoDate, Cases, CreatedBy, CreatedOn FROM dbo.PurchaseOrders WHERE Id = @Id;";
    internal const string ChangesSql =
        "SELECT TOP (500) Id, PurchaseOrderId, Level, ChangeType, Reason, CasesBefore, CasesAfter, Details, ChangedBy, ChangedByName, ChangedOn " +
        "FROM dbo.PurchaseOrderChanges WHERE PartyId = @PartyId ORDER BY ChangedOn DESC, Id DESC;";

    private const string ChangeColumns = "(PurchaseOrderId, PartyId, Level, ChangeType, Reason, CasesBefore, CasesAfter, Details, ChangedBy, ChangedByName)";

    internal const string AddSql =
        "SET XACT_ABORT ON; BEGIN TRAN; INSERT INTO dbo.PurchaseOrders (PartyId, Level, PoNumber, PoDate, Cases, CreatedBy) " +
        "VALUES (@PartyId, @Level, @PoNumber, @PoDate, @Cases, @By); " +
        "INSERT INTO dbo.PurchaseOrderChanges " + ChangeColumns + " VALUES (SCOPE_IDENTITY(), @PartyId, @Level, @Type, @Reason, NULL, @Cases, @Details, @By, @ByName); COMMIT;";

    internal const string EditSql =
        "SET XACT_ABORT ON; BEGIN TRAN; INSERT INTO dbo.PurchaseOrderChanges " + ChangeColumns +
        " SELECT Id, PartyId, Level, @Type, @Reason, Cases, @Cases, @Details, @By, @ByName FROM dbo.PurchaseOrders WHERE Id = @Id; " +
        "UPDATE dbo.PurchaseOrders SET PoNumber = @PoNumber, PoDate = @PoDate, Cases = @Cases, UpdatedBy = @By, UpdatedOn = SYSUTCDATETIME() WHERE Id = @Id; COMMIT;";

    internal const string AmendSql =
        "SET XACT_ABORT ON; BEGIN TRAN; INSERT INTO dbo.PurchaseOrderChanges " + ChangeColumns +
        " SELECT Id, PartyId, Level, 'Amended', @Reason, Cases, Cases + @Extra, @Details, @By, @ByName FROM dbo.PurchaseOrders WHERE Id = @Id; " +
        "UPDATE dbo.PurchaseOrders SET Cases = Cases + @Extra, UpdatedBy = @By, UpdatedOn = SYSUTCDATETIME() WHERE Id = @Id; COMMIT;";

    public sealed record LevelOption(string Code, string Name);

    public sealed record Po(int Id, string PoNumber, string PoDate, int Cases);

    public sealed record LevelView(string Level, string Name, int Cases, int Used, int InProgress, int Left, int Percent, string State, IReadOnlyList<Po> Pos);

    /// <param name="Tax">The agency's one-time GSTIN and PAN (read-only).</param>
    public sealed record PoView(string PartyId, string PartyName, bool CanEdit, IReadOnlyList<LevelView> Levels, IReadOnlyList<LevelOption> LevelOptions,
        ExpenditureTax.View? Tax = null);

    public sealed record Change(int Id, string Level, string LevelName, string Type, string? Reason, int? CasesBefore, int? CasesAfter, string? Details,
        string? By, DateTime? On);

    [HttpGet]
    public async Task<ActionResult<PoView>> Get(string? partyId, CancellationToken ct)
    {
        if (await PartyAsync(partyId, ct) is not { } party) return NotFound();
        return await ViewAsync(party, ct);
    }

    [HttpGet("history")]
    [StaffRoles(UserRole.Admin, UserRole.MasterAdmin)]
    public async Task<ActionResult<IReadOnlyList<Change>>> History(string? partyId, CancellationToken ct)
    {
        if (await PartyAsync(partyId, ct) is not { } party) return NotFound();
        try
        {
            return (await db.QuerySqlAsync<ChangeRow>(ChangesSql, new { PartyId = party.Id }, ct))
                .Select(c => new Change(c.Id, c.Level ?? "", LevelRegistry.NameOf(c.Level), c.ChangeType ?? "", c.Reason, c.CasesBefore, c.CasesAfter,
                    c.Details, c.ChangedByName ?? c.ChangedBy, c.ChangedOn)).ToList();
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Purchase order history not read");
            return Array.Empty<Change>();
        }
    }

    public sealed record PoInput(string? PartyId, string? Level, string? PoNumber, string? PoDate, int? Cases);

    [HttpPost]
    [StaffRoles(UserRole.Admin, UserRole.MasterAdmin)]
    public async Task<ActionResult<MessageResponse>> Add(PoInput req, CancellationToken ct)
    {
        if (await ManagedAsync(req.PartyId, ct) is not { } party) return Forbidden();
        var level = Level(req.Level);
        if (level is null) return this.Problem400("Please choose a level.");
        if (Check(req.PoNumber, req.PoDate, req.Cases, out var number, out var date, out var cases) is { } p) return this.Problem400(p);
        if ((await PosAsync(party.Id, ct)).Any(o => Expenditure.Same(o.Level, level)))
            return this.Problem400($"{LevelRegistry.NameOf(level)} already has a purchase order: use Edit, or Reopen when it is used up.");
        await db.ExecuteSqlAsync(AddSql, new
        {
            PartyId = party.Id, Level = level, PoNumber = number, PoDate = date, Cases = cases, Type = "Added", Reason = (string?)null,
            Details = Details(number, date), By = ActorId, ByName = ActorName,
        }, ct);
        log.LogInformation("{Actor} added PO {Po} ({Cases} cases) for {Party} {Level}", ActorId, number, cases, party.Id, level);
        return new MessageResponse("Purchase order added.");
    }

    public sealed record EditInput(string? PoNumber, string? PoDate, int? Cases, string? Reason);

    [HttpPut("{id:int}")]
    [StaffRoles(UserRole.Admin, UserRole.MasterAdmin)]
    public async Task<ActionResult<MessageResponse>> Edit(int id, EditInput req, CancellationToken ct)
    {
        var po = (await db.QuerySqlAsync<PoRow>(FindSql, new { Id = id }, ct)).FirstOrDefault();
        if (po is null) return NotFound();
        if (await ManagedAsync(po.PartyId, ct) is null) return Forbidden();
        if (Check(req.PoNumber, req.PoDate, req.Cases, out var number, out var date, out var cases) is { } p) return this.Problem400(p);
        if (Text(req.Reason, MaxReason, required: false) is not { } reason) return this.Problem400($"The reason can be up to {MaxReason} characters.");
        await db.ExecuteSqlAsync(EditSql, new
        {
            Id = id, PoNumber = number, PoDate = date, Cases = cases, Type = "Edited", Reason = reason.Length == 0 ? null : reason,
            Details = "Was " + Details(po.PoNumber ?? "", po.PoDate), By = ActorId, ByName = ActorName,
        }, ct);
        log.LogInformation("{Actor} edited PO {Id}: {Before} → {After} cases", ActorId, id, po.Cases, cases);
        return new MessageResponse("Purchase order saved.");
    }

    /// <param name="ExtraCases">An amendment: cases added to the level's latest PO.</param>
    /// <param name="PoNumber">Or a new PO (with <paramref name="PoDate"/> and <paramref name="Cases"/>).</param>
    public sealed record ReopenInput(string? PartyId, string? Level, string? Reason, int? ExtraCases, string? PoNumber, string? PoDate, int? Cases);

    /// <summary>Reopen (the master admin): a reason and either extra cases (a PO amendment) or a new PO; kept in the history.</summary>
    [HttpPost("reopen")]
    [StaffRoles(UserRole.Admin, UserRole.MasterAdmin)]
    public async Task<ActionResult<MessageResponse>> Reopen(ReopenInput req, CancellationToken ct)
    {
        if (await ManagedAsync(req.PartyId, ct) is not { } party) return Forbidden();
        var level = Level(req.Level);
        if (level is null) return this.Problem400("Please choose a level.");
        if (Text(req.Reason, MaxReason, required: true) is not { Length: > 0 } reason) return this.Problem400("Please enter the reason for reopening.");
        var latest = (await PosAsync(party.Id, ct)).Where(o => Expenditure.Same(o.Level, level)).OrderBy(o => o.PoDate).ThenBy(o => o.Id).LastOrDefault();
        if (latest is null) return this.Problem400($"{LevelRegistry.NameOf(level)} has no purchase order to reopen: use + Add PO.");
        var newPo = !string.IsNullOrWhiteSpace(req.PoNumber);
        if (newPo == req.ExtraCases is not null) return this.Problem400("Please enter either the extra cases or a new purchase order.");
        if (newPo)
        {
            if (Check(req.PoNumber, req.PoDate, req.Cases, out var number, out var date, out var cases) is { } p) return this.Problem400(p);
            await db.ExecuteSqlAsync(AddSql, new
            {
                PartyId = party.Id, Level = level, PoNumber = number, PoDate = date, Cases = cases, Type = "NewPo", Reason = reason,
                Details = Details(number, date), By = ActorId, ByName = ActorName,
            }, ct);
            log.LogInformation("{Actor} reopened {Party} {Level} with new PO {Po} ({Cases} cases)", ActorId, party.Id, level, number, cases);
            return new MessageResponse("Reopened with the new purchase order.");
        }
        if (req.ExtraCases is not (>= 1 and <= MaxCases) || latest.Cases + req.ExtraCases > MaxCases)
            return this.Problem400($"Please enter the extra cases (1 to {MaxCases:N0}).");
        await db.ExecuteSqlAsync(AmendSql, new
        {
            Id = latest.Id, Extra = req.ExtraCases, Reason = reason, Details = "Amendment of " + Details(latest.PoNumber ?? "", latest.PoDate),
            By = ActorId, ByName = ActorName,
        }, ct);
        log.LogInformation("{Actor} reopened {Party} {Level}: PO {Id} +{Extra} cases", ActorId, party.Id, level, latest.Id, req.ExtraCases);
        return new MessageResponse($"Reopened: {req.ExtraCases} cases added to {latest.PoNumber}.");
    }

    // ------------------------------------------------------------------ helpers

    private ObjectResult Forbidden() => this.Problem(title: "Only the master admin who created this agency can change its purchase orders.", statusCode: 403);

    private async Task<ExpenditureParty?> PartyAsync(string? partyId, CancellationToken ct) => await ExpenditureParties.FindAsync(db, CurrentUser, partyId, ct);

    private async Task<ExpenditureParty?> ManagedAsync(string? partyId, CancellationToken ct) =>
        await PartyAsync(partyId, ct) is { CanManage: true } p ? p : null;

    private async Task<List<PoRow>> PosAsync(string partyId, CancellationToken ct) =>
        [.. await db.QuerySqlAsync<PoRow>(ListSql, new { PartyId = partyId }, ct)];

    /// <summary>The levels of this portal's POs: every certification level (main), the handholding levels (Consultancy).</summary>
    private IEnumerable<string> Levels => host.System == PortalSystem.Consultancy ? LevelRegistry.Handholding : LevelRegistry.All.Select(l => l.Code);

    private string? Level(string? code) => Levels.FirstOrDefault(l => Expenditure.Same(l, code?.Replace("-", "")));

    private async Task<PoView> ViewAsync(ExpenditureParty party, CancellationToken ct)
    {
        List<PoRow> pos;
        try { pos = await PosAsync(party.Id, ct); }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Purchase orders not read (is migration 0098 applied?)");
            pos = [];
        }
        var status = await PoLimits.StatusAsync(db, host, party.Id, null, log, ct);
        var levels = Levels.Where(l => pos.Any(p => Expenditure.Same(p.Level, l))).Select(l =>
        {
            var s = status.FirstOrDefault(x => Expenditure.Same(x.Level, l)) ?? new PoLevelStatus(party.Id, l, 0, 0, 0, null);
            var mine = pos.Where(p => Expenditure.Same(p.Level, l)).Select(p => new Po(p.Id, p.PoNumber ?? "", Day(p.PoDate), p.Cases)).ToList();
            return new LevelView(l, LevelRegistry.NameOf(l), s.Cases, s.Used, s.InProgress, s.Left, s.Percent, s.State, mine);
        }).ToList();
        return new PoView(party.Id, party.Name, party.CanManage, levels, Levels.Select(l => new LevelOption(l, LevelRegistry.NameOf(l))).ToList(),
            await ExpenditureTax.ViewAsync(db, party.Id, log, ct));
    }

    private static string Day(DateTime d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static string Details(string number, DateTime date) => $"{number} of {date.ToString("dd MMM yyyy", CultureInfo.InvariantCulture)}";

    [GeneratedRegex(@"^[A-Za-z0-9][A-Za-z0-9 /\-_.()&:#]{0,99}$")]
    private static partial Regex PoNumberPattern();

    internal static string? Check(string? poNumber, string? poDate, int? cases, out string number, out DateTime date, out int count)
    {
        number = poNumber?.Trim() ?? "";
        date = default;
        count = 0;
        if (!PoNumberPattern().IsMatch(number)) return "Please enter the PO number (letters, digits and / - _ . only, up to 100 characters).";
        if (Expenditure.Day(poDate) is not { } d || d.Year < 2000 || d > Expenditure.Today.AddYears(1)) return "Please enter the PO date.";
        date = d;
        if (cases is not (>= 1 and <= MaxCases)) return $"Please enter the cases in the PO (1 to {MaxCases:N0}).";
        count = cases.Value;
        return null;
    }

    /// <summary>Trimmed text of at most <paramref name="max"/> characters; null when too long (or empty but required).</summary>
    internal static string? Text(string? value, int max, bool required)
    {
        var t = value?.Trim() ?? "";
        if (t.Length > max || (required && t.Length == 0)) return null;
        return t;
    }
}
