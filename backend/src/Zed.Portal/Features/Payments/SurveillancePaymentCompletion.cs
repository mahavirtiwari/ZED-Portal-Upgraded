using System.Globalization;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Documents;
using Zed.Core.Email;
using Zed.Core.Finance;
using Zed.Core.Http;
using Zed.Portal.Templates;

namespace Zed.Portal.Features.Payments;

/// <summary>
/// What happens after a surveillance payment is recorded (SurveillancePayController.SendPaymentConfirmationMail,
/// GenerateReceipt, SubmiInvoiceDataToApi and SubmiReceiptDataToApi): the receipt PDF is written to
/// PDFs/SA/{ZedId}/{Level}_Milestone{0|2}_Payment_Receipt.pdf (where GenerateReceipt wrote it), the
/// confirmation mail is sent, and the ERP invoice and receipt are queued with ModuleName SURVEILLANCE.
/// <para>
/// The old receipt was a screenshot of SA/PaymentReceipt, which reads the <em>certification</em> payment
/// (main database), so surveillance receipts showed the wrong fee. This one shows the surveillance
/// payment (ZED_SURVEILLANCE MsmePaymentInfo, result set 4 of SP_SURVEILLANCE_MSME_GET_DETAILS).
/// </para>
/// <para>
/// Not ported: SendAutoAllotMail (agency allotment mail). The web callback called
/// SP_SURVEILLANCE_MSME_GET_DETAILS without the level, so the agency result set was always empty and the
/// mail was never sent; the payment procedures already run SP_SEND_AUTO_MAIL_FOR_AUTO_ALLOT_AGENCY.
/// </para>
/// </summary>
public sealed class SurveillancePaymentCompletion(
    ISqlExecutor db,
    IEmailSender email,
    IHtmlTemplateRenderer templates,
    IBackgroundWork background,
    IWebHostEnvironment env,
    IOptions<PortalOptions> portal,
    IOptions<EmailOptions> emailOptions,
    ILogger<SurveillancePaymentCompletion> log)
{
    public const string ModuleName = "SURVEILLANCE";

    /// <param name="postToErp">The legacy zero-amount path did not post to the ERP; the gateway path did.</param>
    public async Task CompleteAsync(string zedId, string certification, bool postToErp, CancellationToken ct)
    {
        try
        {
            var sets = await db.QueryProcMultipleAsync("SP_SURVEILLANCE_MSME_GET_DETAILS", new { ZedId = zedId, CertificationType = certification }, ct);
            var msme = sets[0].FirstOrDefault();
            var basic = sets[1].FirstOrDefault();
            var payment = sets[4].FirstOrDefault();
            var lines = payment is null ? [] : SurveillancePaymentSummary.Lines(payment);

            if (payment is not null)
            {
                var milestone = msme?.Text("MileStoneNo") is { Length: > 0 } m ? m : "0";
                var receiptName = basic?.Text("PaymentReceiptName") is { Length: > 0 } n ? n : $"{certification}_Milestone{milestone}_Payment_Receipt.pdf";
                await SaveReceiptAsync(zedId, receiptName, lines, ct);
            }

            if (msme?.Text("PledgeEmailId") is { Length: > 0 } to)
            {
                var html = await templates.RenderAsync<SurveillancePaymentConfirmationEmail>(new Dictionary<string, object?>
                {
                    [nameof(SurveillancePaymentConfirmationEmail.ZedId)] = zedId,
                    [nameof(SurveillancePaymentConfirmationEmail.Certification)] = certification,
                    [nameof(SurveillancePaymentConfirmationEmail.Lines)] = lines,
                    [nameof(SurveillancePaymentConfirmationEmail.PublicBaseUrl)] = portal.Value.PublicBaseUrl,
                });
                var cc = emailOptions.Value.RegistrationCc is { Length: > 0 } cca ? new[] { cca } : null;
                await email.SendAsync(new EmailMessage(to, $"ZED Surveillance Assessment fee Payment Confirmation Details - {zedId}", html, EmailProfiles.Default, cc), ct);
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // The payment is already recorded; the receipt can be regenerated and the mail resent.
            log.LogError(ex, "Surveillance receipt or confirmation mail failed for {ZedId}/{Certification}", zedId, certification);
        }

        if (postToErp)
        {
            // Invoice and receipt only: the surveillance module never posted the customer (it exists from the certification).
            background.Enqueue($"ERP {ModuleName} {zedId}/{certification}", async (sp, token) =>
            {
                var erp = sp.GetRequiredService<IErpFinanceService>();
                foreach (var document in new[] { ErpDocument.Invoice, ErpDocument.Receipt })
                    await erp.PushAsync(new ErpPush(zedId, certification, document, ModuleName), token);
            });
        }
    }

    private async Task SaveReceiptAsync(string zedId, string fileName, List<SummaryLine> lines, CancellationToken ct)
    {
        var root = Path.GetFullPath(Path.Combine(env.ContentRootPath, portal.Value.StorageRoot));
        var dir = Path.Combine(root, "PDFs", "SA", string.Concat(zedId.Where(char.IsLetterOrDigit)));
        Directory.CreateDirectory(dir);
        var pdf = SummaryPdf.Render("Surveillance Payment Summary", [$"ZED ID: {zedId}", $"Date: {DateTime.Now:MMMM d, yyyy}"], lines,
            Path.Combine(AppContext.BaseDirectory, "Assets", "Images", "zed-logo.png"));
        await File.WriteAllBytesAsync(Path.Combine(dir, string.Concat(fileName.Where(c => char.IsLetterOrDigit(c) || c is '_' or '.' or '-'))), pdf, ct);
    }
}

/// <summary>The lines of _Surveillance_MsmePaymentTemplate.cshtml (receipt and e-mail).</summary>
public static class SurveillancePaymentSummary
{
    private static string V(IDictionary<string, object?> r, string c) =>
        r.TryGetValue(c, out var v) && v is not null and not DBNull ? Convert.ToString(v, CultureInfo.InvariantCulture) ?? "" : "";

    public static List<SummaryLine> Lines(IDictionary<string, object?> p)
    {
        var lines = new List<SummaryLine> { new("Surveillance Assessment Fee", "₹ " + V(p, "Total")) };
        if (V(p, "UseCoupon") == "Yes")
        {
            lines.Add(new("Joining Reward", "- ₹ " + V(p, "Coupon")));
            lines.Add(new("Final Certification Fee", "₹ " + V(p, "TotalAfterCoupon"), "(After adjusting joining reward)"));
            lines.Add(new("Subsidy " + V(p, "SubsidyLabel"), "- ₹ " + V(p, "SubsidyCoupon"), "(On final certification fee)"));
        }
        else
        {
            lines.Add(new("Subsidy " + V(p, "SubsidyLabel"), "- ₹ " + V(p, "Subsidy")));
        }
        lines.Add(new("Amount Payable", "₹ " + V(p, "ApplicantContributionAfterSubsidy")));
        lines.Add(new("Amount", "₹ " + V(p, "SubsidyPer")));
        lines.Add(new("GST(18%)", "₹ " + V(p, "GstAfterSubsidy")));
        if (V(p, "TdsDeductible") == "Yes")
        {
            var tds = V(p, "Tds");
            if (tds == "1.5")
            {
                lines.Add(new("TDS Deducted (2%)", "₹ " + V(p, "Tds15")));
                lines.Add(new("Net Payable Amount", "₹ " + V(p, "NetPaybleTds15"), Bold: true));
            }
            else if (tds == "7.5")
            {
                lines.Add(new("TDS Deducted (10%)", "₹ " + V(p, "Tds75")));
                lines.Add(new("Net Payable Amount", "₹ " + V(p, "NetPaybleTds75"), Bold: true));
            }
        }
        else
        {
            lines.Add(new("Net Payable Amount", "₹ " + V(p, "ApplicantContributionAfterSubsidy"), Bold: true));
        }
        return lines;
    }
}
