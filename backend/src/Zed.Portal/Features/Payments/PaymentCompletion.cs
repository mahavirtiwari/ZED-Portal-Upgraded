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
    ILogger<PaymentCompletion> log)
{
    /// <param name="postToErp">The legacy zero-amount path did not post to the ERP; the gateway path did.</param>
    public async Task CompleteAsync(string zedId, string certification, bool postToErp, CancellationToken ct)
    {
        try
        {
            var sets = await db.QueryProcMultipleAsync("SP_MSME_GET_DETAILS", new { ZedId = zedId, CertificationType = certification }, ct);
            var msme = sets[0].FirstOrDefault();
            var basic = sets[1].FirstOrDefault();
            var payment = sets[4].FirstOrDefault();
            var lines = payment is null ? [] : PaymentSummary.Lines(payment);

            if (payment is not null)
            {
                var receiptName = basic?.Text("PaymentReceiptName") is { Length: > 0 } n ? n : "_Payment_Receipt.pdf";
                await SaveReceiptAsync(zedId, certification + receiptName, lines, ct);
            }

            if (msme?.Text("PledgeEmailId") is { Length: > 0 } to)
            {
                var certOrReCert = basic?.Text("CertOrReCert") is { Length: > 0 } c ? c : "Certification";
                var html = await templates.RenderAsync<PaymentConfirmationEmail>(new Dictionary<string, object?>
                {
                    [nameof(PaymentConfirmationEmail.ZedId)] = zedId,
                    [nameof(PaymentConfirmationEmail.Certification)] = certification,
                    [nameof(PaymentConfirmationEmail.CertOrReCert)] = certOrReCert,
                    [nameof(PaymentConfirmationEmail.Lines)] = lines,
                    [nameof(PaymentConfirmationEmail.PublicBaseUrl)] = portal.Value.PublicBaseUrl,
                });
                var cc = await addresses.CopyAsync(EmailAddresses.RegistrationCc, ct);
                await email.SendAsync(new EmailMessage(to, $"ZED {certOrReCert} Payment Confirmation Details - {zedId}", html, EmailProfiles.Default, cc), ct);
            }
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

    private async Task SaveReceiptAsync(string zedId, string fileName, List<SummaryLine> lines, CancellationToken ct)
    {
        var root = Path.GetFullPath(Path.Combine(env.ContentRootPath, portal.Value.StorageRoot));
        var dir = Path.Combine(root, "PDFs", "SA", string.Concat(zedId.Where(char.IsLetterOrDigit)));
        Directory.CreateDirectory(dir);
        var pdf = SummaryPdf.Render("Payment Summary", [$"ZED ID: {zedId}", $"Date: {DateTime.Now:MMMM d, yyyy}"], lines,
            Path.Combine(AppContext.BaseDirectory, "Assets", "Images", "zed-logo.png"));
        await File.WriteAllBytesAsync(Path.Combine(dir, string.Concat(fileName.Where(c => char.IsLetterOrDigit(c) || c is '_' or '.' or '-'))), pdf, ct);
    }
}
