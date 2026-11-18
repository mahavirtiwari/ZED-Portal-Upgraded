using System.Data.Common;
using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Expenditure;

/// <summary>
/// The "Expenditure" tab (2026-11-18, approved design): main = the assessment agencies (assessment cases and surveillance
/// visits), Consultancy = the consultant organisations (milestones; the Admin reaches it from main by the portal hand-over).
/// The Admin sees every agency (organisation), a master admin those it created (<see cref="ExpenditureParties"/>). Also the
/// master admin's review of the monthly invoices (approve, or return with remarks) and the invoices' PDFs.
/// <para>
/// 2026-11-18 (the user: the agency "is not able to view the performance of his agency"): the agency (consultant
/// organisation) reads the same figures, cases, POs and its own invoices, scoped by <see cref="ExpenditureParties"/> to
/// itself (another agency's ID is not found); the invoice list, approval and return stay the managers'. Also the agency's
/// one-time tax details (<see cref="ExpenditureTax"/>), read-only here, with their documents.
/// </para>
/// </summary>
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy)]
[Route("api/staff/expenditure")]
[StaffRoles(UserRole.Admin, UserRole.MasterAdmin, UserRole.Agency)]
public sealed class ExpenditureController(
    ISqlExecutor db, PortalHost host, IWebHostEnvironment env, IOptions<PortalOptions> portal, ILogger<ExpenditureController> log) : StaffApiController
{
    public sealed record Option(string Code, string Name);

    /// <param name="Invoiced">The payable of the cases whose month has a submitted or approved invoice.</param>
    public sealed record Cards(int PoCases, int Completed, int Rejected, int Surveillance, int Milestones, decimal Payable, decimal Approved,
        decimal Invoiced = 0, decimal Outstanding = 0);

    /// <param name="Balance">The PO's cases left (PO cases less those used and in progress); null without a PO.</param>
    /// <param name="PoState">NoPo, Open, Low (amber) or Stopped (red).</param>
    public sealed record SummaryRow(string PartyId, string PartyName, string Level, string LevelName, string? PoLabel, int PoCases, int Completed,
        int Rejected, int Surveillance, int Milestones, int Used, int InProgress, int? Balance, string PoState, decimal Payable, decimal Invoiced,
        decimal Outstanding);

    /// <param name="Tax">With one agency (organisation) chosen: its one-time GSTIN and PAN.</param>
    public sealed record SummaryResponse(string Kind, IReadOnlyList<Option> Parties, IReadOnlyList<Option> Levels, IReadOnlyList<string> States,
        Cards Cards, IReadOnlyList<SummaryRow> Rows, ExpenditureTax.View? Tax = null);

    [HttpGet("summary")]
    public async Task<ActionResult<SummaryResponse>> Summary(string? partyId, string? level, string? state, string? from, string? to, CancellationToken ct)
    {
        if (!Filter(partyId, level, state, from, to, out var f, out var problem)) return this.Problem400(problem!);
        var parties = await ExpenditureParties.ForAsync(db, CurrentUser, ct);
        if (f.PartyId is not null && !parties.Any(p => Expenditure.Same(p.Id, f.PartyId))) return NotFound();
        await ExpenditureSweep.RunAsync(db, host, log, ct);

        var visible = parties.ToDictionary(p => p.Id, StringComparer.OrdinalIgnoreCase);
        var counts = (await ExpenditureQueries.CountsAsync(db, host, f, log, ct)).Where(c => c.PartyId is not null && visible.ContainsKey(c.PartyId.Trim())).ToList();
        var po = (await PoLimits.StatusAsync(db, host, f.PartyId, f.Level, log, ct)).Where(s => visible.ContainsKey(s.PartyId)).ToList();
        var poNumbers = await PoNumbersAsync(f.PartyId, ct);

        var keys = counts.Select(c => (Party: c.PartyId!.Trim(), Level: c.Level?.Trim() ?? ""))
            .Concat(po.Select(s => (Party: s.PartyId, Level: s.Level)))
            .Distinct(new KeyComparer()).ToList();
        var rows = keys.Select(k =>
        {
            var mine = counts.Where(c => Expenditure.Same(c.PartyId, k.Party) && Expenditure.Same(c.Level, k.Level)).ToList();
            int Of(string kind) => mine.Where(c => c.Kind == kind).Sum(c => c.Cases);
            var s = po.FirstOrDefault(x => Expenditure.Same(x.PartyId, k.Party) && Expenditure.Same(x.Level, k.Level));
            var payable = mine.Sum(c => c.Amount);
            var invoiced = mine.Sum(c => c.Invoiced);
            var numbers = poNumbers.Where(n => Expenditure.Same(n.PartyId, k.Party) && Expenditure.Same(n.Level, k.Level)).Select(n => n.PoNumber).ToList();
            return new SummaryRow(k.Party, visible[k.Party].Name, k.Level, LevelRegistry.NameOf(k.Level),
                numbers.Count == 0 ? null : string.Join(", ", numbers), s?.Cases ?? 0, Of(Expenditure.Completed), Of(Expenditure.Rejected),
                Of(Expenditure.Surveillance), Of(Expenditure.Milestone), s?.Used ?? 0, s?.InProgress ?? 0, s?.HasPo == true ? s.Left : null,
                s?.State ?? "NoPo", payable, invoiced, payable - invoiced);
        }).OrderBy(r => r.PartyName).ThenBy(r => LevelOrder(r.Level)).ToList();

        var approved = await ApprovedAsync(f, visible, ct);
        var cards = new Cards(rows.Sum(r => r.PoCases), rows.Sum(r => r.Completed), rows.Sum(r => r.Rejected), rows.Sum(r => r.Surveillance),
            rows.Sum(r => r.Milestones), rows.Sum(r => r.Payable), approved, rows.Sum(r => r.Invoiced), rows.Sum(r => r.Outstanding));
        IEnumerable<string> levels = host.System == PortalSystem.Consultancy ? LevelRegistry.Handholding : LevelRegistry.All.Select(l => l.Code);
        return new SummaryResponse(Expenditure.KindOf(host), parties.Select(p => new Option(p.Id, p.Name)).ToList(),
            levels.Select(l => new Option(l, LevelRegistry.NameOf(l))).ToList(),
            Dashboard.DashboardFilters.StateNames.Order(StringComparer.OrdinalIgnoreCase).ToList(), cards, rows,
            f.PartyId is null ? null : await ExpenditureTax.ViewAsync(db, visible[f.PartyId].Id, log, ct));
    }

    public sealed record CaseView(string ZedId, string? UnitName, string? State, string Level, string Kind, int? Milestone, string? CountedOn, decimal? Rate);

    /// <summary>The counted cases of one agency (organisation) and level with their dates and frozen rates ("Cases").</summary>
    [HttpGet("cases")]
    public async Task<ActionResult<IReadOnlyList<CaseView>>> Cases(string? partyId, string? level, string? state, string? from, string? to, CancellationToken ct)
    {
        if (!Filter(partyId, level, state, from, to, out var f, out var problem)) return this.Problem400(problem!);
        if (f.PartyId is null || await ExpenditureParties.FindAsync(db, CurrentUser, f.PartyId, ct) is null) return NotFound();
        await ExpenditureSweep.RunAsync(db, host, log, ct);
        return (await ExpenditureQueries.CasesAsync(db, host, f, log, ct))
            .Select(c => new CaseView(c.ZedId?.Trim() ?? "", c.UnitName, c.State, c.Level ?? "", c.Kind ?? "", c.Milestone,
                c.CountedOn?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), c.Rate)).ToList();
    }

    public sealed record RateLineView(string Kind, string Level, string LevelName, int? Milestone, decimal? Rate, string? RateFrom, int Cases, decimal Amount);

    /// <param name="Live">For a submitted invoice: the month's figures now (they become the invoice's at approval).</param>
    /// <param name="Tax">The agency's one-time GSTIN and PAN (shown on every review).</param>
    public sealed record InvoiceDetail(ExpenditureInvoices.View Invoice, ExpenditureInvoices.MonthFigures Live, decimal LiveDifference,
        IReadOnlyList<RateLineView> Lines, ExpenditureTax.View? Tax = null);

    [HttpGet("invoices")]
    [StaffRoles(UserRole.Admin, UserRole.MasterAdmin)]
    public async Task<ActionResult<IReadOnlyList<ExpenditureInvoices.View>>> Invoices(string? partyId, string? status, CancellationToken ct)
    {
        var parties = (await ExpenditureParties.ForAsync(db, CurrentUser, ct)).ToDictionary(p => p.Id, StringComparer.OrdinalIgnoreCase);
        if (!string.IsNullOrWhiteSpace(partyId) && !parties.ContainsKey(partyId.Trim())) return NotFound();
        if (status is not (null or "" or ExpenditureInvoices.Submitted or ExpenditureInvoices.Approved or ExpenditureInvoices.Returned))
            return this.Problem400("Invalid filter.");
        IReadOnlyList<ExpenditureInvoices.Row> rows;
        try
        {
            rows = await db.QuerySqlAsync<ExpenditureInvoices.Row>(ExpenditureInvoices.ListSql, new { PartyId = string.IsNullOrWhiteSpace(partyId) ? null : partyId.Trim() }, ct);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Invoices not read (is migration 0098 applied?)");
            return Array.Empty<ExpenditureInvoices.View>();
        }
        return rows.Where(r => r.PartyId is not null && parties.ContainsKey(r.PartyId.Trim()) && (string.IsNullOrEmpty(status) || r.Status == status))
            .Select(r => ExpenditureInvoices.ToView(r, parties[r.PartyId!.Trim()].Name, parties[r.PartyId!.Trim()].CanManage)).ToList();
    }

    /// <summary>One invoice for the review pop-up: the portal's figures now and per rate ("41 cases × ₹ 3,000 from 01-11-2026").</summary>
    [HttpGet("invoices/{id:int}")]
    public async Task<ActionResult<InvoiceDetail>> Invoice(int id, CancellationToken ct)
    {
        var (row, party) = await InvoiceAsync(id, ct);
        if (row is null || party is null) return NotFound();
        await ExpenditureSweep.RunAsync(db, host, log, ct);
        var live = await LiveAsync(party.Id, row.InvoiceMonth, ct);
        var lines = (await ExpenditureQueries.BreakdownAsync(db, host, party.Id, row.InvoiceMonth, log, ct))
            .Select(l => new RateLineView(l.Kind ?? "", l.Level ?? "", LevelRegistry.NameOf(l.Level), l.Milestone, l.Rate,
                l.RateFrom?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), l.Cases, l.Amount)).ToList();
        var tax = await ExpenditureTax.ViewAsync(db, party.Id, log, ct);
        return new InvoiceDetail(ExpenditureInvoices.ToView(row, party.Name, party.CanManage), live, row.InvoiceAmount - live.Total, lines, tax);
    }

    public sealed record ReviewRequest(string? Remarks);

    [HttpPost("invoices/{id:int}/approve")]
    [StaffRoles(UserRole.Admin, UserRole.MasterAdmin)]
    public async Task<ActionResult<MessageResponse>> Approve(int id, ReviewRequest req, CancellationToken ct)
    {
        var (row, party) = await InvoiceAsync(id, ct);
        if (row is null || party is null) return NotFound();
        if (!party.CanManage) return Forbidden();
        var remarks = req.Remarks?.Trim() ?? "";
        if (remarks.Length > ExpenditureInvoices.MaxRemarks) return this.Problem400($"Remarks can be up to {ExpenditureInvoices.MaxRemarks} characters.");
        await ExpenditureSweep.RunAsync(db, host, log, ct, force: true);
        var f = await LiveAsync(party.Id, row.InvoiceMonth, ct);
        var changed = await db.ExecuteSqlAsync(ExpenditureInvoices.ApproveSql, new
        {
            Id = id, Remarks = remarks.Length == 0 ? null : remarks, By = ActorId, ByName = ActorName,
            f.Completed, f.Rejected, f.Surveillance, f.Milestones, f.Amount, Gst = f.Gst, f.Total,
        }, ct);
        if (changed == 0) return this.Problem400(AlreadyReviewed);
        // TODO(ERP): the approved invoice now waits with ErpExport = 'Pending' (see ExpenditureInvoices).
        log.LogInformation("{Actor} approved invoice {Id} of {Party} ({Total})", ActorId, id, party.Id, f.Total);
        return new MessageResponse($"Invoice {row.InvoiceNo} approved.");
    }

    [HttpPost("invoices/{id:int}/return")]
    [StaffRoles(UserRole.Admin, UserRole.MasterAdmin)]
    public async Task<ActionResult<MessageResponse>> Return(int id, ReviewRequest req, CancellationToken ct)
    {
        var (row, party) = await InvoiceAsync(id, ct);
        if (row is null || party is null) return NotFound();
        if (!party.CanManage) return Forbidden();
        var remarks = req.Remarks?.Trim() ?? "";
        if (remarks.Length == 0) return this.Problem400("Please enter the remarks: they tell the agency what to correct.");
        if (remarks.Length > ExpenditureInvoices.MaxRemarks) return this.Problem400($"Remarks can be up to {ExpenditureInvoices.MaxRemarks} characters.");
        var changed = await db.ExecuteSqlAsync(ExpenditureInvoices.ReturnSql, new { Id = id, Remarks = remarks, By = ActorId, ByName = ActorName }, ct);
        if (changed == 0) return this.Problem400(AlreadyReviewed);
        log.LogInformation("{Actor} returned invoice {Id} of {Party}", ActorId, id, party.Id);
        return new MessageResponse($"Invoice {row.InvoiceNo} returned.");
    }

    /// <summary>
    /// The invoice's PDF: to the managers who see the agency, and to the agency itself. (Until 2026-11-18 a second
    /// [StaffRoles] here could not widen the controller's: authorisation attributes add up, so the agency got 403.)
    /// </summary>
    [HttpGet("invoices/{id:int}/file")]
    public async Task<IActionResult> File(int id, CancellationToken ct)
    {
        var (row, _) = await InvoiceAsync(id, ct);
        if (row is null) return NotFound();
        var full = ExpenditureInvoices.Resolve(ExpenditureInvoices.StorageRoot(env, portal.Value), row.FilePath);
        if (full is null) return NotFound();
        return PhysicalFile(full, "application/pdf", $"Invoice-{row.InvoiceMonth:yyyy-MM}.pdf", enableRangeProcessing: true);
    }

    /// <summary>The agency's one-time tax details, read-only: to the managers who see it, and to the agency itself.</summary>
    [HttpGet("tax")]
    public async Task<ActionResult<ExpenditureTax.View>> Tax(string? partyId, CancellationToken ct)
    {
        var party = await ExpenditureParties.FindAsync(db, CurrentUser, partyId, ct);
        if (party is null) return NotFound();
        return await ExpenditureTax.ViewAsync(db, party.Id, log, ct);
    }

    /// <summary>The GST registration certificate (<paramref name="which"/> = gst) or the PAN card (pan) of the agency.</summary>
    [HttpGet("tax/{which}")]
    public async Task<IActionResult> TaxFile(string which, string? partyId, CancellationToken ct)
    {
        if (which is not (ExpenditureTax.GstFile or ExpenditureTax.PanFile)) return NotFound();
        var party = await ExpenditureParties.FindAsync(db, CurrentUser, partyId, ct);
        if (party is null) return NotFound();
        var (row, _) = await ExpenditureTax.ReadAsync(db, party.Id, log, ct);
        if (row?.TaxSubmittedOn is null) return NotFound();
        var full = ExpenditureTax.Resolve(ExpenditureInvoices.StorageRoot(env, portal.Value), which == ExpenditureTax.GstFile ? row.TaxGstFile : row.TaxPanFile);
        if (full is null) return NotFound();
        var name = (which == ExpenditureTax.GstFile ? "GST-certificate-" : "PAN-card-") + party.Id + Path.GetExtension(full).ToLowerInvariant();
        return PhysicalFile(full, ExpenditureTax.ContentType(full), name, enableRangeProcessing: true);
    }

    // ------------------------------------------------------------------ helpers

    private const string AlreadyReviewed = "This invoice has already been reviewed. Please reload the page.";

    private ObjectResult Forbidden() => this.Problem(title: "Only the master admin who created this agency can review its invoices.", statusCode: 403);

    /// <summary>The invoice and its party, when the signed-in user may see it (the agency: only its own).</summary>
    private async Task<(ExpenditureInvoices.Row? Row, ExpenditureParty? Party)> InvoiceAsync(int id, CancellationToken ct)
    {
        ExpenditureInvoices.Row? row;
        try { row = (await db.QuerySqlAsync<ExpenditureInvoices.Row>(ExpenditureInvoices.FindSql, new { Id = id }, ct)).FirstOrDefault(); }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Invoice {Id} not read", id);
            return (null, null);
        }
        if (row?.PartyId is null) return (null, null);
        var party = await ExpenditureParties.FindAsync(db, CurrentUser, row.PartyId, ct);
        return party is null ? (null, null) : (row, party);
    }

    private async Task<ExpenditureInvoices.MonthFigures> LiveAsync(string partyId, DateTime month, CancellationToken ct)
    {
        var m = new DateTime(month.Year, month.Month, 1);
        var counts = await ExpenditureQueries.MonthsAsync(db, host, partyId, m, m.AddMonths(1), log, ct);
        var rates = await ExpenditureRates.ListAsync(db, host, log, ct);
        return ExpenditureInvoices.Figure(m, counts, ExpenditureQueries.GstOn(rates, Expenditure.KindOf(host), m.AddMonths(1).AddDays(-1)));
    }

    private async Task<decimal> ApprovedAsync(ExpenditureFilter f, Dictionary<string, ExpenditureParty> visible, CancellationToken ct)
    {
        try
        {
            var from = new DateTime(f.From.Year, f.From.Month, 1);
            return (await db.QuerySqlAsync<ExpenditureInvoices.Row>(ExpenditureInvoices.ListSql, new { f.PartyId }, ct))
                .Where(r => r.Status == ExpenditureInvoices.Approved && r.PartyId is not null && visible.ContainsKey(r.PartyId.Trim())
                            && r.InvoiceMonth >= from && r.InvoiceMonth < f.To)
                .Sum(r => r.PortalAmount);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Approved invoices not read");
            return 0;
        }
    }

    public sealed class PoNumberRow
    {
        public string? PartyId { get; init; }
        public string? Level { get; init; }
        public string? PoNumber { get; init; }
    }

    internal const string PoNumbersSql =
        "SELECT PartyId, Level, PoNumber FROM dbo.PurchaseOrders WHERE (@PartyId IS NULL OR PartyId = @PartyId) ORDER BY PoDate, Id;";

    private async Task<IReadOnlyList<PoNumberRow>> PoNumbersAsync(string? partyId, CancellationToken ct)
    {
        try { return await db.QuerySqlAsync<PoNumberRow>(PoNumbersSql, new { PartyId = partyId }, ct); }
        catch (DbException) { return []; }
    }

    private static int LevelOrder(string level) => LevelRegistry.Find(level)?.OrderNo ?? int.MaxValue;

    private bool Filter(string? partyId, string? level, string? state, string? from, string? to, out ExpenditureFilter f, out string? problem)
    {
        f = new ExpenditureFilter(null, null, null, ExpenditureFilter.Start, ExpenditureFilter.End);
        problem = "Invalid filter.";
        var party = string.IsNullOrWhiteSpace(partyId) ? null : partyId.Trim();
        if (party is { Length: > 50 }) return false;
        string? lv = null;
        if (!string.IsNullOrWhiteSpace(level))
        {
            IEnumerable<string> levels = host.System == PortalSystem.Consultancy ? LevelRegistry.Handholding : LevelRegistry.All.Select(l => l.Code);
            lv = levels.FirstOrDefault(l => Expenditure.Same(l, level.Replace("-", "")));
            if (lv is null) return false;
        }
        string? st = null;
        if (!string.IsNullOrWhiteSpace(state))
        {
            st = Dashboard.DashboardFilters.StateNames.FirstOrDefault(s => Expenditure.Same(s, state));
            if (st is null) return false;
        }
        var start = ExpenditureFilter.Start;
        var end = ExpenditureFilter.End;
        if (!string.IsNullOrWhiteSpace(from))
        {
            if (Expenditure.Day(from) is not { } d) return false;
            start = d;
        }
        if (!string.IsNullOrWhiteSpace(to))
        {
            if (Expenditure.Day(to) is not { } d) return false;
            end = d.AddDays(1);
        }
        if (end <= start)
        {
            problem = "The end date is before the start date.";
            return false;
        }
        f = new ExpenditureFilter(party, lv, st, start, end);
        problem = null;
        return true;
    }

    private sealed class KeyComparer : IEqualityComparer<(string Party, string Level)>
    {
        public bool Equals((string Party, string Level) a, (string Party, string Level) b) => Expenditure.Same(a.Party, b.Party) && Expenditure.Same(a.Level, b.Level);
        public int GetHashCode((string Party, string Level) k) => HashCode.Combine(k.Party.ToUpperInvariant(), k.Level.ToUpperInvariant());
    }
}
