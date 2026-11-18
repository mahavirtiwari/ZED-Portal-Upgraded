using System.Globalization;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.Masters;

namespace Zed.Portal.Features.Staff.Expenditure;

/// <summary>
/// The monthly invoices (dbo.ExpenditureInvoices, migration 0098): the agency (organisation) uploads one per month (number,
/// date, amount, PDF); the portal keeps that month's own figures with it (cases and amount at the frozen rates, plus GST); the
/// master admin who created the agency approves it or returns it with remarks; after Returned it is uploaded again.
/// Approved invoices wait for the ERP (ErpExport = Pending).
/// <para>
/// TODO(ERP): the ERP integration of today (Zed.Core.Finance.ErpFinanceService, off unless Erp:Enabled) posts the MSMEs'
/// customer invoices and receipts only; it has no vendor bill. When QCI's ERP API for vendor invoices is given, post the
/// Approved rows whose ErpExport is 'Pending' (PartyId, InvoiceNo, InvoiceDate, InvoiceAmount, PortalAmount, GstPercent, the
/// PDF) from a job behind the same Erp:Enabled switch, and set ErpExport to 'Sent' (ErpReference, ErpExportedOn) or 'Failed'.
/// Nothing is sent to the ERP now.
/// </para>
/// </summary>
public static partial class ExpenditureInvoices
{
    public const string Submitted = "Submitted";
    public const string Approved = "Approved";
    public const string Returned = "Returned";
    public const string ErpPending = "Pending";

    public const long MaxBytes = 5 * 1024 * 1024;
    public const int MaxRemarks = 2000;
    public const decimal MaxAmount = 10_000_000_000m;
    public const string Folder = "Uploads/ExpenditureInvoices";

    public sealed class Row
    {
        public int Id { get; init; }
        public string? PartyId { get; init; }
        public DateTime InvoiceMonth { get; init; }
        public string? InvoiceNo { get; init; }
        public DateTime InvoiceDate { get; init; }
        public decimal InvoiceAmount { get; init; }
        public string? FilePath { get; init; }
        public int PortalCompleted { get; init; }
        public int PortalRejected { get; init; }
        public int PortalSurveillance { get; init; }
        public int PortalMilestones { get; init; }
        public decimal PortalAmount { get; init; }
        public decimal GstPercent { get; init; }
        public decimal PortalTotal { get; init; }
        public string? Status { get; init; }
        public string? Remarks { get; init; }
        public DateTime? SubmittedOn { get; init; }
        public string? ReviewedByName { get; init; }
        public DateTime? ReviewedOn { get; init; }
        public string? ErpExport { get; init; }
    }

    private const string Columns =
        "Id, PartyId, InvoiceMonth, InvoiceNo, InvoiceDate, InvoiceAmount, FilePath, PortalCompleted, PortalRejected, PortalSurveillance, " +
        "PortalMilestones, PortalAmount, GstPercent, PortalTotal, Status, Remarks, SubmittedOn, ReviewedByName, ReviewedOn, ErpExport";

    internal const string ListSql = "SELECT TOP (1000) " + Columns + " FROM dbo.ExpenditureInvoices WHERE (@PartyId IS NULL OR PartyId = @PartyId) " +
                                    "ORDER BY InvoiceMonth DESC, Id DESC;";
    internal const string FindSql = "SELECT " + Columns + " FROM dbo.ExpenditureInvoices WHERE Id = @Id;";

    private const string Figures =
        "PortalCompleted = @Completed, PortalRejected = @Rejected, PortalSurveillance = @Surveillance, PortalMilestones = @Milestones, " +
        "PortalAmount = @Amount, GstPercent = @Gst, PortalTotal = @Total";

    internal const string InsertSql =
        "INSERT INTO dbo.ExpenditureInvoices (PartyId, InvoiceMonth, InvoiceNo, InvoiceDate, InvoiceAmount, FilePath, PortalCompleted, PortalRejected, " +
        "PortalSurveillance, PortalMilestones, PortalAmount, GstPercent, PortalTotal, Status, SubmittedBy, SubmittedOn) " +
        "SELECT @PartyId, @Month, @InvoiceNo, @InvoiceDate, @InvoiceAmount, @FilePath, @Completed, @Rejected, @Surveillance, @Milestones, @Amount, @Gst, @Total, " +
        "'Submitted', @By, SYSUTCDATETIME() WHERE NOT EXISTS (SELECT 1 FROM dbo.ExpenditureInvoices WHERE PartyId = @PartyId AND InvoiceMonth = @Month);";

    /// <summary>Uploaded again after Returned: the same row, Submitted again (the return's remarks stay until the next review).</summary>
    internal const string ResubmitSql =
        "UPDATE dbo.ExpenditureInvoices SET InvoiceNo = @InvoiceNo, InvoiceDate = @InvoiceDate, InvoiceAmount = @InvoiceAmount, FilePath = @FilePath, " +
        Figures + ", Status = 'Submitted', SubmittedBy = @By, SubmittedOn = SYSUTCDATETIME(), ReviewedBy = NULL, ReviewedByName = NULL, ReviewedOn = NULL " +
        "WHERE Id = @Id AND Status = 'Returned';";

    /// <summary>Approved with the month's figures as they are at approval (the cases' rates are final from then on).</summary>
    internal const string ApproveSql =
        "UPDATE dbo.ExpenditureInvoices SET Status = 'Approved', " + Figures + ", Remarks = @Remarks, ReviewedBy = @By, ReviewedByName = @ByName, ReviewedOn = SYSUTCDATETIME(), " +
        "ErpExport = 'Pending' WHERE Id = @Id AND Status = 'Submitted';";

    internal const string ReturnSql =
        "UPDATE dbo.ExpenditureInvoices SET Status = 'Returned', Remarks = @Remarks, ReviewedBy = @By, ReviewedByName = @ByName, ReviewedOn = SYSUTCDATETIME() " +
        "WHERE Id = @Id AND Status = 'Submitted';";

    /// <summary>A month's figures as the portal works them out.</summary>
    public sealed record MonthFigures(DateTime Month, int Completed, int Rejected, int Surveillance, int Milestones, decimal Amount, decimal Gst, decimal Total)
    {
        public int Cases => Completed + Rejected + Surveillance + Milestones;
    }

    public static MonthFigures Figure(DateTime month, IEnumerable<ExpenditureQueries.MonthCount> counts, decimal gst)
    {
        var mine = counts.Where(c => c.Month.Year == month.Year && c.Month.Month == month.Month).ToList();
        int Of(string kind) => mine.Where(c => c.Kind == kind).Sum(c => c.Cases);
        var amount = mine.Sum(c => c.Amount);
        return new MonthFigures(month, Of(Expenditure.Completed), Of(Expenditure.Rejected), Of(Expenditure.Surveillance), Of(Expenditure.Milestone),
            amount, gst, Total(amount, gst));
    }

    public static decimal Total(decimal amount, decimal gst) => decimal.Round(amount * (100 + gst) / 100, 2, MidpointRounding.AwayFromZero);

    public sealed record View(
        int Id, string PartyId, string PartyName, string Month, string MonthLabel, string InvoiceNo, string InvoiceDate, decimal InvoiceAmount,
        int PortalCompleted, int PortalRejected, int PortalSurveillance, int PortalMilestones, int PortalCases, decimal PortalAmount, decimal GstPercent,
        decimal PortalTotal, decimal Difference, string Status, string? Remarks, DateTime? SubmittedOn, string? ReviewedBy, DateTime? ReviewedOn,
        string? ErpExport, bool CanReview);

    public static View ToView(Row r, string partyName, bool canReview) => new(
        r.Id, r.PartyId?.Trim() ?? "", partyName, r.InvoiceMonth.ToString("yyyy-MM", CultureInfo.InvariantCulture), MonthLabel(r.InvoiceMonth),
        r.InvoiceNo ?? "", r.InvoiceDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), r.InvoiceAmount,
        r.PortalCompleted, r.PortalRejected, r.PortalSurveillance, r.PortalMilestones,
        r.PortalCompleted + r.PortalRejected + r.PortalSurveillance + r.PortalMilestones, r.PortalAmount, r.GstPercent, r.PortalTotal,
        r.InvoiceAmount - r.PortalTotal, r.Status ?? "", r.Remarks, r.SubmittedOn, r.ReviewedByName, r.ReviewedOn, r.ErpExport,
        canReview && r.Status == Submitted);

    public static string MonthLabel(DateTime m) => m.ToString("MMM yyyy", CultureInfo.InvariantCulture);

    [GeneratedRegex(@"^[A-Za-z0-9][A-Za-z0-9 /\-_.]{0,59}$")]
    private static partial Regex InvoiceNoPattern();

    public static bool ValidInvoiceNo(string? value) => value is not null && InvoiceNoPattern().IsMatch(value.Trim());

    private static readonly MasterUploads.FileType[] Pdf =
    [
        new(".pdf", ["application/pdf"], h => h.Length >= 5 && h[0] == '%' && h[1] == 'P' && h[2] == 'D' && h[3] == 'F' && h[4] == '-'),
    ];

    /// <summary>Null when the file is a PDF of at most 5 MB (extension, declared type and content); otherwise why not.</summary>
    public static async Task<string?> CheckAsync(IFormFile? file, CancellationToken ct)
    {
        var (_, error) = await MasterUploads.CheckAsync(file, Pdf, MaxBytes, ct);
        if (error is not null) return error.Replace("Allowed types: .pdf", "Please upload the invoice as a PDF.");
        // The end of a PDF: "%%EOF" in its last kilobyte (a truncated or disguised file has none).
        await using var s = file!.OpenReadStream();
        var tail = new byte[Math.Min(1024, (int)Math.Min(file.Length, 1024))];
        s.Seek(-tail.Length, SeekOrigin.End);
        await s.ReadExactlyAsync(tail, ct);
        return System.Text.Encoding.ASCII.GetString(tail).Contains("%%EOF", StringComparison.Ordinal) ? null : "The file is not a complete PDF. Please upload the invoice PDF again.";
    }

    public static string StorageRoot(IWebHostEnvironment env, PortalOptions portal) => Path.GetFullPath(Path.Combine(env.ContentRootPath, portal.StorageRoot));

    /// <summary>Saves the PDF as Uploads/ExpenditureInvoices/{party}/Invoice_{yyyyMM}_{time}_{random}.pdf; returns that relative path.</summary>
    public static async Task<string> SaveAsync(IFormFile file, string root, string partyId, DateTime month, CancellationToken ct)
    {
        var party = new string(partyId.Where(char.IsAsciiLetterOrDigit).ToArray());
        if (party.Length == 0) throw new InvalidOperationException("No party folder.");
        var folder = $"{Folder}/{party}";
        var name = $"Invoice_{month:yyyyMM}_{DateTime.Now:yyyyMMddHHmmss}_{Convert.ToHexString(RandomNumberGenerator.GetBytes(4)).ToLowerInvariant()}.pdf";
        await MasterUploads.SaveAsync(file, root, folder, name, ct);
        return $"{folder}/{name}";
    }

    /// <summary>The stored file, only inside the invoices folder of the storage root; null otherwise.</summary>
    public static string? Resolve(string root, string? relative)
    {
        if (string.IsNullOrWhiteSpace(relative)) return null;
        var baseDir = Path.GetFullPath(Path.Combine(root, Folder.Replace('/', Path.DirectorySeparatorChar))) + Path.DirectorySeparatorChar;
        var full = Path.GetFullPath(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar)));
        return full.StartsWith(baseDir, StringComparison.OrdinalIgnoreCase) && File.Exists(full) ? full : null;
    }
}

/// <summary>The agency's (consultant organisation's) own invoices: its sign-in on main (Consultancy).</summary>
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy)]
[Route("api/staff/expenditure/my")]
[StaffRoles(UserRole.Agency)]
public sealed class MyInvoicesController(
    ISqlExecutor db, PortalHost host, IWebHostEnvironment env, IOptions<PortalOptions> portal, ILogger<MyInvoicesController> log) : StaffApiController
{
    /// <summary>The months listed: the last 12 full months, and every month with an invoice.</summary>
    public const int Months = 12;

    public sealed record MonthView(string Month, string Label, int Completed, int Rejected, int Surveillance, int Milestones, int Cases,
        decimal Amount, decimal GstPercent, decimal Total, ExpenditureInvoices.View? Invoice, bool CanUpload);

    public sealed record MyResponse(string PartyId, string PartyName, string Kind, IReadOnlyList<MonthView> Months);

    [HttpGet]
    public async Task<ActionResult<MyResponse>> Get(CancellationToken ct)
    {
        var party = (await ExpenditureParties.ForAsync(db, CurrentUser, ct)).FirstOrDefault();
        if (party is null) return NotFound();
        await ExpenditureSweep.RunAsync(db, host, log, ct);
        var invoices = await db.QuerySqlAsync<ExpenditureInvoices.Row>(ExpenditureInvoices.ListSql, new { PartyId = party.Id }, ct);
        var current = new DateTime(Expenditure.Today.Year, Expenditure.Today.Month, 1);
        var months = Enumerable.Range(1, Months).Select(i => current.AddMonths(-i))
            .Concat(invoices.Select(i => new DateTime(i.InvoiceMonth.Year, i.InvoiceMonth.Month, 1))).Distinct().OrderByDescending(m => m).ToList();
        var counts = await ExpenditureQueries.MonthsAsync(db, host, party.Id, months.Min(), months.Max().AddMonths(1), log, ct);
        var rates = await ExpenditureRates.ListAsync(db, host, log, ct);
        return new MyResponse(party.Id, party.Name, Expenditure.KindOf(host), months.Select(m =>
        {
            var f = ExpenditureInvoices.Figure(m, counts, ExpenditureQueries.GstOn(rates, Expenditure.KindOf(host), m.AddMonths(1).AddDays(-1)));
            var inv = invoices.FirstOrDefault(i => i.InvoiceMonth.Year == m.Year && i.InvoiceMonth.Month == m.Month);
            return new MonthView(m.ToString("yyyy-MM", CultureInfo.InvariantCulture), ExpenditureInvoices.MonthLabel(m), f.Completed, f.Rejected, f.Surveillance,
                f.Milestones, f.Cases, f.Amount, f.Gst, f.Total, inv is null ? null : ExpenditureInvoices.ToView(inv, party.Name, false),
                inv is null || inv.Status == ExpenditureInvoices.Returned);
        }).ToList());
    }

    /// <summary>Uploads the month's invoice (or uploads it again after Returned).</summary>
    [HttpPost("invoices")]
    [RequestSizeLimit(ExpenditureInvoices.MaxBytes + 64 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = ExpenditureInvoices.MaxBytes + 64 * 1024)]
    public async Task<ActionResult<MessageResponse>> Upload([FromForm] string? month, [FromForm] string? invoiceNo, [FromForm] string? invoiceDate,
        [FromForm] string? invoiceAmount, IFormFile? file, CancellationToken ct)
    {
        var party = (await ExpenditureParties.ForAsync(db, CurrentUser, ct)).FirstOrDefault();
        if (party is null) return NotFound();
        var current = new DateTime(Expenditure.Today.Year, Expenditure.Today.Month, 1);
        if (Expenditure.Month(month) is not { } m || m >= current || m < current.AddYears(-3))
            return this.Problem400("Please choose a month that has ended.");
        if (!ExpenditureInvoices.ValidInvoiceNo(invoiceNo)) return this.Problem400("Please enter the invoice number (letters, digits and / - _ . only, up to 60 characters).");
        if (Expenditure.Day(invoiceDate) is not { } date || date < m || date > Expenditure.Today)
            return this.Problem400("Please enter the invoice date (in or after the month, not in the future).");
        if (!decimal.TryParse(invoiceAmount, NumberStyles.Number, CultureInfo.InvariantCulture, out var amount) || amount <= 0
            || amount > ExpenditureInvoices.MaxAmount || decimal.Round(amount, 2) != amount)
            return this.Problem400("Please enter the invoice amount in rupees, GST included (at most two decimals).");
        if (await ExpenditureInvoices.CheckAsync(file, ct) is { } fileProblem) return this.Problem400(fileProblem);

        var existing = (await db.QuerySqlAsync<ExpenditureInvoices.Row>(ExpenditureInvoices.ListSql, new { PartyId = party.Id }, ct))
            .FirstOrDefault(i => i.InvoiceMonth.Year == m.Year && i.InvoiceMonth.Month == m.Month);
        if (existing is not null && existing.Status != ExpenditureInvoices.Returned)
            return this.Problem400($"The invoice for {ExpenditureInvoices.MonthLabel(m)} is already {existing.Status!.ToLowerInvariant()}.");

        await ExpenditureSweep.RunAsync(db, host, log, ct, force: true);
        var counts = await ExpenditureQueries.MonthsAsync(db, host, party.Id, m, m.AddMonths(1), log, ct);
        var rates = await ExpenditureRates.ListAsync(db, host, log, ct);
        var f = ExpenditureInvoices.Figure(m, counts, ExpenditureQueries.GstOn(rates, Expenditure.KindOf(host), m.AddMonths(1).AddDays(-1)));
        var path = await ExpenditureInvoices.SaveAsync(file!, ExpenditureInvoices.StorageRoot(env, portal.Value), party.Id, m, ct);
        var args = new
        {
            Id = existing?.Id ?? 0, PartyId = party.Id, Month = m, InvoiceNo = invoiceNo!.Trim(), InvoiceDate = date, InvoiceAmount = amount, FilePath = path,
            f.Completed, f.Rejected, f.Surveillance, f.Milestones, f.Amount, Gst = f.Gst, f.Total, By = ActorId,
        };
        var changed = await db.ExecuteSqlAsync(existing is null ? ExpenditureInvoices.InsertSql : ExpenditureInvoices.ResubmitSql, args, ct);
        if (changed == 0) return this.Problem400("This month's invoice was submitted meanwhile. Please reload the page.");
        log.LogInformation("{Actor} submitted invoice {No} of {Party} for {Month:yyyy-MM} ({Amount})", ActorId, args.InvoiceNo, party.Id, m, amount);
        return new MessageResponse($"Invoice for {ExpenditureInvoices.MonthLabel(m)} submitted.");
    }
}
