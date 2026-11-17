using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Portal.Features.Msme;
using Zed.Portal.Features.Msme.Handholding;

namespace Zed.Portal.Features.Payments.Consultancy;

/// <summary>
/// 2026-11-17 (the user's payment confirmation design): what the handholding payment result shows after a milestone payment, and
/// its three actions, as <see cref="PaymentConfirmationController"/> does for certification and surveillance. Everything is read
/// for the ZED ID of the sign-in cookie, never from the request.
/// <list type="bullet">
/// <item><c>GET …/{level}/confirmation</c>: the milestone, amount, order and CCAvenue reference, when and how it was paid, whether the
/// receipt and the tax invoice can be downloaded, and the masked registered e-mail.</item>
/// <item><c>GET …/{level}/receipt</c>: the receipt PDF written when the payment was recorded (PDFs/SA/{ZedId}/{Level}_Milestone{n}_…).</item>
/// <item><c>GET …/{level}/invoice</c>: the link to the ERP's tax invoice of that payment (My Documents' file), or 404 while the ERP has
/// not sent it yet.</item>
/// <item><c>POST …/{level}/email-copy</c>: the confirmation mail again, to the registered e-mail only, with the receipt and invoice.</item>
/// </list>
/// The payment is the level's latest milestone payment (SP_CONSULTANCY_MSME_GET_DETAILS result set 4); with <c>?milestone=n</c> it must
/// be that milestone's (else 404).
/// </summary>
public sealed class ConsultancyConfirmationController(
    ISqlExecutor db,
    IWebHostEnvironment env,
    IOptions<PortalOptions> portal,
    ILogger<ConsultancyConfirmationController> log) : MsmeApiController
{
    private const string Base = "/api/msme/consultancy-payments/{certification}";

    /// <summary>The ERP's module of a handholding invoice in MsmeInvoiceData (SP_API_FINANCE_SAVE_INVOICE_RECEIPT_DETAILS).</summary>
    public const string InvoiceModule = "HANDHOLDING";

    /// <param name="Milestone">The milestone the payment is for.</param>
    /// <param name="Method">The gateway's payment mode (e.g. UPI), NEFT, "Zero amount" or "Paid at milestone 1".</param>
    public sealed record ConfirmationResponse(
        string Certification, int? Milestone, decimal? Amount, string? OrderId, string? TransactionId, DateTime? PaidOn, string? Method,
        string? ReceiptUrl, string? InvoiceUrl, string? InvoiceNo, string? Email);

    [HttpGet(Base + "/confirmation")]
    public async Task<ActionResult<ConfirmationResponse>> Confirmation(string certification, [FromQuery] int? milestone, CancellationToken ct)
    {
        if (HandholdingEligibility.Canonical(certification) is not { } level) return this.Problem400("Invalid certification.");
        if (await LoadAsync(level, milestone, ct) is not { } paid) return NotFound();

        var order = await OrderAsync(level, paid.Milestone, ct);
        var method = PaymentConfirmationController.Blank(paid.Payment.Text("PaymentType")) switch
        {
            ZeroAmountPayment.PaymentType => ZeroAmountPayment.GatewayType,
            "PaidAtMilestone1" => "Paid at milestone 1",
            "NEFT" => "NEFT",
            _ => PaymentConfirmationController.PaymentMode(order?.PaymentResponse) ?? PaymentConfirmationController.Blank(order?.PgType),
        };
        var invoice = await FindInvoiceAsync(paid, ct);
        return new ConfirmationResponse(
            level,
            paid.Milestone,
            order?.Amount ?? PaymentConfirmationController.Number(paid.Payment, "AmountPaid"),
            PaymentConfirmationController.Blank(order?.TransactionId),
            PaymentConfirmationController.Blank(order?.TrackingId),
            order?.UpdatedDate ?? PaymentConfirmationController.Date(paid.Payment, "CreatedDate"),
            method,
            System.IO.File.Exists(paid.ReceiptFile) ? "/api/msme/consultancy-payments/" + Uri.EscapeDataString(level) + "/receipt" + (milestone is null ? "" : "?milestone=" + paid.Milestone) : null,
            invoice is null ? null : MsmeFilePaths.ToApiUrl(invoice.Value.Relative),
            invoice?.InvoiceNo,
            PaymentConfirmationController.Mask(paid.Msme?.Text("PledgeEmailId")));
    }

    [HttpGet(Base + "/receipt")]
    public async Task<IActionResult> Receipt(string certification, [FromQuery] int? milestone, CancellationToken ct)
    {
        if (HandholdingEligibility.Canonical(certification) is not { } level) return NotFound();
        if (await LoadAsync(level, milestone, ct) is not { } paid || !System.IO.File.Exists(paid.ReceiptFile)) return NotFound();
        Response.Headers.XContentTypeOptions = "nosniff";
        Response.Headers.ContentDisposition = new Microsoft.Net.Http.Headers.ContentDispositionHeaderValue("inline")
            { FileNameStar = Path.GetFileName(paid.ReceiptFile) }.ToString();
        return PhysicalFile(paid.ReceiptFile, "application/pdf", enableRangeProcessing: true);
    }

    [HttpGet(Base + "/invoice")]
    public async Task<ActionResult<PaymentConfirmationController.InvoiceResponse>> Invoice(string certification, [FromQuery] int? milestone, CancellationToken ct)
    {
        if (HandholdingEligibility.Canonical(certification) is not { } level) return this.Problem400("Invalid certification.");
        if (await LoadAsync(level, milestone, ct) is not { } paid) return NotFound();
        return await FindInvoiceAsync(paid, ct) is { } invoice
            ? new PaymentConfirmationController.InvoiceResponse(MsmeFilePaths.ToApiUrl(invoice.Relative), invoice.InvoiceNo) : NotFound();
    }

    [HttpPost(Base + "/email-copy")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<ActionResult<PaymentConfirmationController.EmailCopyResponse>> EmailCopy(string certification, [FromQuery] int? milestone, CancellationToken ct)
    {
        if (HandholdingEligibility.Canonical(certification) is not { } level) return this.Problem400("Invalid certification.");
        if (await LoadAsync(level, milestone, ct) is not { } paid) return NotFound();
        var invoiceFile = await FindInvoiceAsync(paid, ct) is { } invoice ? MsmeFilePaths.Find(Root, invoice.Relative) : null;
        string? sentTo;
        try
        {
            sentTo = await Completion.ResendAsync(ZedId, level, invoiceFile, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "Handholding payment confirmation copy failed for {ZedId}/{Certification}", ZedId, level);
            return Problem(title: "The e-mail could not be sent. Please try again later.", statusCode: StatusCodes.Status502BadGateway);
        }
        if (sentTo is null) return this.Problem400("There is no registered e-mail for this unit. Please update it in your profile.");
        log.LogInformation("Handholding payment confirmation copy sent for {ZedId}/{Certification} (milestone {Milestone})", ZedId, level, paid.Milestone);
        return new PaymentConfirmationController.EmailCopyResponse(PaymentConfirmationController.Mask(sentTo)!);
    }

    // ----- the work -----

    private ConsultancyPaymentCompletion Completion => completion ??= ConsultancyPaymentCompletion.Create(HttpContext.RequestServices);
    private ConsultancyPaymentCompletion? completion;

    /// <summary>One milestone payment of the unit: its rows, its milestone and where its receipt is.</summary>
    private sealed record Paid(string Level, int? Milestone, IDictionary<string, object?>? Msme, IDictionary<string, object?> Payment, string ReceiptFile);

    /// <summary>The level's latest milestone payment (null when there is none, or it is not the milestone asked for).</summary>
    private async Task<Paid?> LoadAsync(string level, int? milestone, CancellationToken ct)
    {
        var d = await Completion.LoadAsync(ZedId, level, ct);
        if (d.Payment is null) return null;
        if (d.Payment.Text("Certification") is { Length: > 0 } c && !string.Equals(c.Trim(), level, StringComparison.OrdinalIgnoreCase)) return null;
        var number = int.TryParse(d.Milestone, NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) ? n : (int?)null;
        if (milestone is not null && number != milestone) return null;
        return new Paid(level, number, d.Msme, d.Payment, Completion.ReceiptPath(ZedId, ConsultancyPaymentCompletion.ReceiptFileName(level, d.Milestone)));
    }

    internal const string OrderSql =
        "SELECT TOP (1) TransactionId, TrackingId, Amount, UpdatedDate, PgType, PaymentResponse FROM " + ConsultancyGateway.Orders + " " +
        "WHERE ZedId = @ZedId AND Certification = @Certification AND MileStoneNumber = @Milestone AND PaymentStatus = 'Success' ORDER BY Id DESC;";

    /// <summary>The milestone's successful order (none for a zero-amount payment, NEFT and older records).</summary>
    private async Task<PaymentConfirmationController.PaidOrder?> OrderAsync(string level, int? milestone, CancellationToken ct)
    {
        if (milestone is null) return null;
        try
        {
            return (await db.QuerySqlAsync<PaymentConfirmationController.PaidOrder>(OrderSql, new
            {
                ZedId = new Dapper.DbString { Value = ZedId, IsAnsi = true, Length = 50 },
                Certification = new Dapper.DbString { Value = level, IsAnsi = true, Length = 50 },
                Milestone = milestone.Value,
            }, ct)).FirstOrDefault();
        }
        catch (System.Data.Common.DbException ex)
        {
            log.LogWarning(ex, "Paid handholding order of {ZedId}/{Certification} could not be read", ZedId, level);
            return null;
        }
    }

    /// <summary>
    /// The ERP's tax invoice of this payment: the My Documents invoice (MsmeInvoiceData) with the payment's TadaInvoiceNo, of module
    /// HANDHOLDING, its level and milestone, whose file names this unit and is stored. Null until the ERP has sent it.
    /// </summary>
    private async Task<(string Relative, string InvoiceNo)?> FindInvoiceAsync(Paid paid, CancellationToken ct)
    {
        var invoiceNo = (paid.Payment.Text("TadaInvoiceNo") is { Length: > 0 } a ? a : paid.Payment.Text("TaDaInvoiceNo")).Trim();
        if (invoiceNo.Length == 0) return null;
        var rows = await MsmeMyDocuments.LoadAsync(db, ZedId, ct);
        foreach (var row in rows[3])
        {
            if (!string.Equals(row.Text("TadaInvoiceNo").Trim(), invoiceNo, StringComparison.OrdinalIgnoreCase)) continue;
            if (row.Text("ModuleName") is { Length: > 0 } m && !string.Equals(m.Trim(), InvoiceModule, StringComparison.OrdinalIgnoreCase)) continue;
            if (row.Text("Certification") is { Length: > 0 } c && !string.Equals(c.Trim(), paid.Level, StringComparison.OrdinalIgnoreCase)) continue;
            if (row.Text("MileStoneNo") is { Length: > 0 } ms && paid.Milestone is { } pm && ms.Trim() != pm.ToString(CultureInfo.InvariantCulture)) continue;
            if (row.Text("DocumentType").Contains("receipt", StringComparison.OrdinalIgnoreCase)) continue;
            if (MsmeFilePaths.FromLegacy(row.Text("InvoicePath")) is not { } path || !MsmeFilePaths.BelongsTo(path, ZedId)) continue;
            if (MsmeFilePaths.Find(Root, path) is null) continue;
            return (path, invoiceNo);
        }
        return null;
    }

    private string Root => MsmeFilePaths.Root(env, portal.Value);
}
