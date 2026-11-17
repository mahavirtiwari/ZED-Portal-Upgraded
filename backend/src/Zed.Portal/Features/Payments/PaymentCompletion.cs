using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Documents;
using Zed.Core.Email;
using Zed.Core.Finance;
using Zed.Core.Http;
using Zed.Portal.Templates;

namespace Zed.Portal.Features.Payments;

/// <summary>
/// What happens after a certification payment is recorded (PayController.SendPaymentConfirmationMail,
/// GenerateReceipt and the SubmiXxxDataToApi calls): the receipt PDF is written where My Documents
/// finds it, the confirmation mail is sent, and the ERP postings are queued.
/// </summary>
public sealed class PaymentCompletion(
    ISqlExecutor db,
    IEmailSender email,
    IHtmlTemplateRenderer templates,
    IBackgroundWork background,
    IWebHostEnvironment env,
    IOptions<PortalOptions> portal,
    EmailAddresses addresses,
    IPortalSettings settings,
    ILogger<PaymentCompletion> log)
{
    /// <param name="postToErp">The legacy zero-amount path did not post to the ERP; the gateway path did.</param>
    public async Task CompleteAsync(string zedId, string certification, bool postToErp, CancellationToken ct)
    {
        await CertificationPaid.RunAsync(db, zedId, certification, log, ct);
        try
        {
            var details = await LoadAsync(zedId, certification, ct);
            if (details.Payment is not null)
                await SaveReceiptAsync(zedId, ReceiptFileName(certification, details.Basic), details.Lines, ct);
            await SendMailAsync(zedId, certification, details, null, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // The payment is already recorded; the receipt can be regenerated and the mail resent.
            log.LogError(ex, "Receipt or confirmation mail failed for {ZedId}/{Certification}", zedId, certification);
        }

        if (postToErp)
        {
            background.Enqueue($"ERP {zedId}/{certification}", async (sp, token) =>
            {
                var erp = sp.GetRequiredService<IErpFinanceService>();
                foreach (var document in new[] { ErpDocument.Customer, ErpDocument.Invoice, ErpDocument.Receipt })
                    await erp.PushAsync(new ErpPush(zedId, certification, document), token);
            });
        }
    }

    /// <summary>The unit's details (result sets 0, 1 and 4 of SP_MSME_GET_DETAILS) and the payment's summary lines.</summary>
    public sealed record Details(IDictionary<string, object?>? Msme, IDictionary<string, object?>? Basic, IDictionary<string, object?>? Payment, List<SummaryLine> Lines);

    public async Task<Details> LoadAsync(string zedId, string certification, CancellationToken ct)
    {
        var sets = await db.QueryProcMultipleAsync("SP_MSME_GET_DETAILS", new { ZedId = zedId, CertificationType = certification }, ct);
        var payment = sets[4].FirstOrDefault();
        return new(sets[0].FirstOrDefault(), sets[1].FirstOrDefault(), payment, payment is null ? [] : PaymentSummary.Lines(payment));
    }

    /// <summary>The receipt's file name in PDFs/SA/{ZedId} (GenerateReceipt's name: the level, then _Payment_Receipt.pdf or ..._V2.pdf).</summary>
    public static string ReceiptFileName(string certification, IDictionary<string, object?>? basic) =>
        certification + (basic?.Text("PaymentReceiptName") is { Length: > 0 } n ? n : "_Payment_Receipt.pdf");

    /// <summary>
    /// 2026-11-17 (the user): "E-mail a copy" of the payment confirmation page. The same confirmation mail, to the unit's registered
    /// e-mail only (never an address from the request), with the receipt and the tax invoice attached when there is one.
    /// Returns the address it went to, or null when the unit has no e-mail or no payment for the level.
    /// </summary>
    public async Task<string?> ResendAsync(string zedId, string certification, string? invoiceFile, CancellationToken ct)
    {
        var details = await LoadAsync(zedId, certification, ct);
        if (details.Payment is null) return null;
        var attachments = new List<EmailAttachment>();
        var receipt = ReceiptPath(zedId, ReceiptFileName(certification, details.Basic));
        attachments.Add(new EmailAttachment(Path.GetFileName(receipt),
            File.Exists(receipt) ? await File.ReadAllBytesAsync(receipt, ct) : RenderReceipt(zedId, details.Lines)));
        if (invoiceFile is not null && File.Exists(invoiceFile))
            attachments.Add(new EmailAttachment(Path.GetFileName(invoiceFile), await File.ReadAllBytesAsync(invoiceFile, ct)));
        return await SendMailAsync(zedId, certification, details, attachments, ct);
    }

    private async Task<string?> SendMailAsync(string zedId, string certification, Details details, IReadOnlyList<EmailAttachment>? attachments, CancellationToken ct)
    {
        if (details.Msme?.Text("PledgeEmailId") is not { Length: > 0 } to) return null;
        var certOrReCert = details.Basic?.Text("CertOrReCert") is { Length: > 0 } c ? c : "Certification";
        var html = await templates.RenderAsync<PaymentConfirmationEmail>(new Dictionary<string, object?>
        {
            [nameof(PaymentConfirmationEmail.ZedId)] = zedId,
            [nameof(PaymentConfirmationEmail.Certification)] = certification,
            [nameof(PaymentConfirmationEmail.CertOrReCert)] = certOrReCert,
            [nameof(PaymentConfirmationEmail.Lines)] = details.Lines,
            [nameof(PaymentConfirmationEmail.PublicBaseUrl)] = portal.Value.PublicBaseUrl,
            [nameof(PaymentConfirmationEmail.AppUrl)] = (await PortalLinks.ForPagesAsync(settings, portal.Value, ct)).GetValueOrDefault("playStore"),
        });
        // The copy the applicant asks for goes to the unit only; the office copy went with the first mail.
        var cc = attachments is null ? await addresses.CopyAsync(EmailAddresses.RegistrationCc, ct) : null;
        await email.SendAsync(new EmailMessage(to, $"ZED {certOrReCert} Payment Confirmation Details - {zedId}", html, EmailProfiles.Payment, cc, attachments), ct);
        return to;
    }

    /// <summary>Full path of a receipt of this unit (PDFs/SA/{ZedId}/{file}), where My Documents finds it.</summary>
    public string ReceiptPath(string zedId, string fileName)
    {
        var root = Path.GetFullPath(Path.Combine(env.ContentRootPath, portal.Value.StorageRoot));
        return Path.Combine(root, "PDFs", "SA", string.Concat(zedId.Where(char.IsLetterOrDigit)),
            string.Concat(fileName.Where(c => char.IsLetterOrDigit(c) || c is '_' or '.' or '-')));
    }

    private static byte[] RenderReceipt(string zedId, List<SummaryLine> lines) =>
        SummaryPdf.Render("Payment Summary", [$"ZED ID: {zedId}", $"Date: {DateTime.Now:MMMM d, yyyy}"], lines,
            Path.Combine(AppContext.BaseDirectory, "Assets", "Images", "zed-logo.png"));

    private async Task SaveReceiptAsync(string zedId, string fileName, List<SummaryLine> lines, CancellationToken ct)
    {
        var path = ReceiptPath(zedId, fileName);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await File.WriteAllBytesAsync(path, RenderReceipt(zedId, lines), ct);
    }
}

/// <summary>
/// SP_V4_CERTIFICATION_PAID (migration 0029) after a recorded certification payment, whichever way it came (gateway,
/// mobile, zero amount, staff "mark successful"): ZED-X's payment flag and the unit's NIC sector-wise questionnaire.
/// A failure is logged and does not undo the payment (the procedure can be run again).
/// </summary>
public static class CertificationPaid
{
    public const string Procedure = "SP_V4_CERTIFICATION_PAID";

    public static async Task RunAsync(ISqlExecutor db, string zedId, string certification, ILogger log, CancellationToken ct)
    {
        try
        {
            await db.ExecuteProcAsync(Procedure, new { ZedId = zedId, Certification = certification }, ct);
        }
        catch (System.Data.Common.DbException ex)
        {
            log.LogError(ex, "{Procedure} failed for {ZedId}/{Certification} (is migration 0029 applied?)", Procedure, zedId, certification);
        }
    }
}
