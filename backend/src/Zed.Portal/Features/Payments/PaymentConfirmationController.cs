using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Payments;
using Zed.Portal.Features.Msme;

namespace Zed.Portal.Features.Payments;

/// <summary>
/// 2026-11-17 (the user's payment confirmation design): what the confirmation page shows after a certification or surveillance
/// payment, and its three actions. Everything is read for the ZED ID of the sign-in cookie, never from the request.
/// <list type="bullet">
/// <item><c>GET …/{level}/confirmation</c>: amount, order and CCAvenue reference, when and how it was paid, whether the receipt
/// and the tax invoice can be downloaded, and the masked registered e-mail.</item>
/// <item><c>GET …/{level}/receipt</c>: the receipt PDF written when the payment was recorded (PDFs/SA/{ZedId}/…).</item>
/// <item><c>GET …/{level}/invoice</c>: the link to the ERP's tax invoice of that payment (My Documents' file), or 404 while the ERP
/// has not sent it yet.</item>
/// <item><c>POST …/{level}/email-copy</c>: the confirmation mail again, to the registered e-mail only, with the receipt and invoice.</item>
/// </list>
/// The certification routes are under api/msme/payments, the surveillance ones under api/msme/surveillance-payments (the same
/// result page shows both).
/// </summary>
public sealed class PaymentConfirmationController(
    ISqlExecutor db,
    PaymentCompletion completion,
    SurveillancePaymentCompletion surveillance,
    IWebHostEnvironment env,
    IOptions<PortalOptions> portal,
    ILogger<PaymentConfirmationController> log) : MsmeApiController
{
    private const string Cert = "/api/msme/payments/{certification}";
    private const string Sur = "/api/msme/surveillance-payments/{certification}";

    /// <param name="Amount">What was paid (the order's amount; 0 for a zero-amount payment).</param>
    /// <param name="OrderId">The portal's order id (PaymentGatewayTransactions.TransactionId).</param>
    /// <param name="TransactionId">The gateway's reference (CCAvenue tracking id), when there is one.</param>
    /// <param name="PaidOn">When the payment was recorded.</param>
    /// <param name="Method">The gateway's payment mode (e.g. UPI, Net Banking), NEFT, or "Zero amount".</param>
    /// <param name="ReceiptUrl">The receipt's download address, or null when it is not stored.</param>
    /// <param name="InvoiceUrl">The tax invoice's address (api/msme/files/ReceiptInvoice/…), or null while the ERP has not sent it.</param>
    /// <param name="Email">The registered e-mail, masked (ka•••@gmail.com); null without one.</param>
    public sealed record ConfirmationResponse(
        string Certification, decimal? Amount, string? OrderId, string? TransactionId, DateTime? PaidOn, string? Method,
        string? ReceiptUrl, string? InvoiceUrl, string? InvoiceNo, string? Email);

    public sealed record InvoiceResponse(string Url, string InvoiceNo);

    public sealed record EmailCopyResponse(string SentTo);

    [HttpGet(Cert + "/confirmation")]
    public Task<ActionResult<ConfirmationResponse>> Confirmation(string certification, CancellationToken ct) => ConfirmationAsync(Kind.Certification, certification, ct);

    [HttpGet(Sur + "/confirmation")]
    public Task<ActionResult<ConfirmationResponse>> SurveillanceConfirmation(string certification, CancellationToken ct) => ConfirmationAsync(Kind.Surveillance, certification, ct);

    [HttpGet(Cert + "/receipt")]
    public Task<IActionResult> Receipt(string certification, CancellationToken ct) => ReceiptAsync(Kind.Certification, certification, ct);

    [HttpGet(Sur + "/receipt")]
    public Task<IActionResult> SurveillanceReceipt(string certification, CancellationToken ct) => ReceiptAsync(Kind.Surveillance, certification, ct);

    [HttpGet(Cert + "/invoice")]
    public Task<ActionResult<InvoiceResponse>> Invoice(string certification, CancellationToken ct) => InvoiceAsync(Kind.Certification, certification, ct);

    [HttpGet(Sur + "/invoice")]
    public Task<ActionResult<InvoiceResponse>> SurveillanceInvoice(string certification, CancellationToken ct) => InvoiceAsync(Kind.Surveillance, certification, ct);

    [HttpPost(Cert + "/email-copy")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public Task<ActionResult<EmailCopyResponse>> EmailCopy(string certification, CancellationToken ct) => EmailCopyAsync(Kind.Certification, certification, ct);

    [HttpPost(Sur + "/email-copy")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public Task<ActionResult<EmailCopyResponse>> SurveillanceEmailCopy(string certification, CancellationToken ct) => EmailCopyAsync(Kind.Surveillance, certification, ct);

    // ----- the work -----

    private enum Kind { Certification, Surveillance }

    /// <summary>One payment of the unit: the level, its rows, and where its order and receipt are.</summary>
    private sealed record Paid(Kind Kind, string Level, IDictionary<string, object?>? Msme, IDictionary<string, object?> Payment, string ReceiptFile);

    private async Task<ActionResult<ConfirmationResponse>> ConfirmationAsync(Kind kind, string certification, CancellationToken ct)
    {
        if (Certifications.CanonicalApplicable(certification) is not { } level) return this.Problem400("Invalid certification.");
        if (await LoadAsync(kind, level, ct) is not { } paid) return NotFound();

        var order = await OrderAsync(kind, level, ct);
        var method = PaymentType(paid.Payment) switch
        {
            ZeroAmountPayment.PaymentType => ZeroAmountPayment.GatewayType,
            "NEFT" => "NEFT",
            _ => PaymentMode(order?.PaymentResponse) ?? Blank(order?.PgType),
        };
        var invoice = await FindInvoiceAsync(paid, ct);
        return new ConfirmationResponse(
            level,
            order?.Amount ?? Number(paid.Payment, "AmountPaid"),
            Blank(order?.TransactionId),
            Blank(order?.TrackingId),
            order?.UpdatedDate ?? Date(paid.Payment, "CreatedDate"),
            method,
            System.IO.File.Exists(paid.ReceiptFile) ? ReceiptUrl(kind, level) : null,
            invoice is null ? null : MsmeFilePaths.ToApiUrl(invoice.Value.Relative),
            invoice?.InvoiceNo,
            Mask(paid.Msme?.Text("PledgeEmailId")));
    }

    private async Task<IActionResult> ReceiptAsync(Kind kind, string certification, CancellationToken ct)
    {
        if (Certifications.CanonicalApplicable(certification) is not { } level) return NotFound();
        if (await LoadAsync(kind, level, ct) is not { } paid || !System.IO.File.Exists(paid.ReceiptFile)) return NotFound();
        Response.Headers.XContentTypeOptions = "nosniff";
        Response.Headers.ContentDisposition = new Microsoft.Net.Http.Headers.ContentDispositionHeaderValue("inline")
            { FileNameStar = Path.GetFileName(paid.ReceiptFile) }.ToString();
        return PhysicalFile(paid.ReceiptFile, "application/pdf", enableRangeProcessing: true);
    }

    private async Task<ActionResult<InvoiceResponse>> InvoiceAsync(Kind kind, string certification, CancellationToken ct)
    {
        if (Certifications.CanonicalApplicable(certification) is not { } level) return this.Problem400("Invalid certification.");
        if (await LoadAsync(kind, level, ct) is not { } paid) return NotFound();
        return await FindInvoiceAsync(paid, ct) is { } invoice ? new InvoiceResponse(MsmeFilePaths.ToApiUrl(invoice.Relative), invoice.InvoiceNo) : NotFound();
    }

    private async Task<ActionResult<EmailCopyResponse>> EmailCopyAsync(Kind kind, string certification, CancellationToken ct)
    {
        if (Certifications.CanonicalApplicable(certification) is not { } level) return this.Problem400("Invalid certification.");
        if (await LoadAsync(kind, level, ct) is not { } paid) return NotFound();
        var invoiceFile = await FindInvoiceAsync(paid, ct) is { } invoice ? MsmeFilePaths.Find(Root, invoice.Relative) : null;
        string? sentTo;
        try
        {
            sentTo = kind == Kind.Surveillance
                ? await surveillance.ResendAsync(ZedId, level, invoiceFile, ct)
                : await completion.ResendAsync(ZedId, level, invoiceFile, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "Payment confirmation copy failed for {ZedId}/{Certification} ({Kind})", ZedId, level, kind);
            return Problem(title: "The e-mail could not be sent. Please try again later.", statusCode: StatusCodes.Status502BadGateway);
        }
        if (sentTo is null) return this.Problem400("There is no registered e-mail for this unit. Please update it in your profile.");
        log.LogInformation("Payment confirmation copy sent for {ZedId}/{Certification} ({Kind})", ZedId, level, kind);
        return new EmailCopyResponse(Mask(sentTo)!);
    }

    /// <summary>The unit's payment for the level (null when there is none).</summary>
    private async Task<Paid?> LoadAsync(Kind kind, string level, CancellationToken ct)
    {
        if (kind == Kind.Surveillance)
        {
            var s = await surveillance.LoadAsync(ZedId, level, ct);
            return s.Payment is null || !SameLevel(s.Payment, level) ? null
                : new Paid(kind, level, s.Msme, s.Payment, surveillance.ReceiptPath(ZedId, SurveillancePaymentCompletion.ReceiptFileName(level, s.Msme, s.Basic)));
        }
        var d = await completion.LoadAsync(ZedId, level, ct);
        return d.Payment is null || !SameLevel(d.Payment, level) ? null
            : new Paid(kind, level, d.Msme, d.Payment, completion.ReceiptPath(ZedId, PaymentCompletion.ReceiptFileName(level, d.Basic)));
    }

    /// <summary>The payment row is the level's (the procedures filter by it; a row of another level is not this payment's).</summary>
    private static bool SameLevel(IDictionary<string, object?> payment, string level) =>
        payment.Text("Certification") is not { Length: > 0 } c || string.Equals(c.Trim(), level, StringComparison.OrdinalIgnoreCase);

    internal const string OrderSql =
        "SELECT TOP (1) TransactionId, TrackingId, Amount, UpdatedDate, PgType, PaymentResponse FROM {0} " +
        "WHERE ZedId = @ZedId AND Certification = @Certification AND PaymentStatus = 'Success' ORDER BY Id DESC;";

    public sealed record PaidOrder(string? TransactionId, string? TrackingId, decimal? Amount, DateTime? UpdatedDate, string? PgType, string? PaymentResponse);

    /// <summary>The newest successful order of the unit's level (none for NEFT and older records).</summary>
    private async Task<PaidOrder?> OrderAsync(Kind kind, string level, CancellationToken ct)
    {
        var table = kind == Kind.Surveillance ? CcAvenueGatewayModule.SurveillanceOrders : CcAvenueGatewayModule.CertificationOrders;
        try
        {
            return (await db.QuerySqlAsync<PaidOrder>(string.Format(CultureInfo.InvariantCulture, OrderSql, table), new
            {
                ZedId = new Dapper.DbString { Value = ZedId, IsAnsi = true, Length = 50 },
                Certification = new Dapper.DbString { Value = level, IsAnsi = true, Length = 50 },
            }, ct)).FirstOrDefault();
        }
        catch (System.Data.Common.DbException ex)
        {
            log.LogWarning(ex, "Paid order of {ZedId}/{Certification} could not be read", ZedId, level);
            return null;
        }
    }

    /// <summary>
    /// The ERP's tax invoice of this payment: the My Documents invoice (MsmeInvoiceData) with the payment's TadaInvoiceNo, of its
    /// module (ZED or SURVEILLANCE) and level, whose file names this unit and is stored. Null until the ERP has sent it.
    /// </summary>
    private async Task<(string Relative, string InvoiceNo)?> FindInvoiceAsync(Paid paid, CancellationToken ct)
    {
        var invoiceNo = (paid.Payment.Text("TadaInvoiceNo") is { Length: > 0 } a ? a : paid.Payment.Text("TaDaInvoiceNo")).Trim();
        if (invoiceNo.Length == 0) return null;
        var module = paid.Kind == Kind.Surveillance ? SurveillancePaymentCompletion.ModuleName : "ZED";
        var rows = await MsmeMyDocuments.LoadAsync(db, ZedId, ct);
        foreach (var row in rows[3])
        {
            if (!string.Equals(row.Text("TadaInvoiceNo").Trim(), invoiceNo, StringComparison.OrdinalIgnoreCase)) continue;
            if (row.Text("ModuleName") is { Length: > 0 } m && !string.Equals(m.Trim(), module, StringComparison.OrdinalIgnoreCase)) continue;
            if (row.Text("Certification") is { Length: > 0 } c && !string.Equals(c.Trim(), paid.Level, StringComparison.OrdinalIgnoreCase)) continue;
            if (row.Text("DocumentType").Contains("receipt", StringComparison.OrdinalIgnoreCase)) continue;
            if (MsmeFilePaths.FromLegacy(row.Text("InvoicePath")) is not { } path || !MsmeFilePaths.BelongsTo(path, ZedId)) continue;
            if (MsmeFilePaths.Find(Root, path) is null) continue;
            return (path, invoiceNo);
        }
        return null;
    }

    private string Root => MsmeFilePaths.Root(env, portal.Value);

    private static string ReceiptUrl(Kind kind, string level) =>
        (kind == Kind.Surveillance ? "/api/msme/surveillance-payments/" : "/api/msme/payments/") + Uri.EscapeDataString(level) + "/receipt";

    private static string PaymentType(IDictionary<string, object?> p) => p.Text("PaymentType").Trim();

    /// <summary>payment_mode of the gateway's response (e.g. "UPI", "Net Banking").</summary>
    internal static string? PaymentMode(string? response)
    {
        if (string.IsNullOrEmpty(response)) return null;
        foreach (var pair in response.Split('&'))
            if (pair.StartsWith("payment_mode=", StringComparison.OrdinalIgnoreCase))
                return Blank(pair["payment_mode=".Length..]) is { } v && !v.Equals("null", StringComparison.OrdinalIgnoreCase) ? v : null;
        return null;
    }

    private static decimal? Number(IDictionary<string, object?> p, string column) =>
        decimal.TryParse(p.Text(column), NumberStyles.Number, CultureInfo.InvariantCulture, out var d) ? d : null;

    private static DateTime? Date(IDictionary<string, object?> p, string column) =>
        p.TryGetValue(column, out var v) && v is DateTime dt ? dt
            : DateTime.TryParse(p.Text(column), CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed) ? parsed : null;

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    /// <summary>"ka•••@gmail.com": the first two letters of the name, then the domain.</summary>
    internal static string? Mask(string? email)
    {
        if (string.IsNullOrWhiteSpace(email)) return null;
        var e = email.Trim();
        var at = e.LastIndexOf('@');
        if (at <= 0) return "•••";
        var name = e[..at];
        return name[..Math.Min(name.Length > 2 ? 2 : 1, name.Length)] + "•••" + e[at..];
    }
}
