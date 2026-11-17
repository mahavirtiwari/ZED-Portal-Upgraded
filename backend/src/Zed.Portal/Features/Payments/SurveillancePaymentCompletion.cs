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
    IPortalSettings settings,
    ILogger<SurveillancePaymentCompletion> log)
{
    public const string ModuleName = "SURVEILLANCE";

    /// <param name="postToErp">The legacy zero-amount path did not post to the ERP; the gateway path did.</param>
    public async Task CompleteAsync(string zedId, string certification, bool postToErp, CancellationToken ct)
    {
        // Every level: the disabled parameters left out of the round (0093); V4 levels (ZED-X) also flags, NIC sector-wise
        // questionnaire and minimum parameters of the surveillance (migration 0033).
        await LevelSurveillance.PaidAsync(db, zedId, certification, log, ct);
        try
        {
            var details = await LoadAsync(zedId, certification, ct);
            if (details.Payment is not null)
                await SaveReceiptAsync(zedId, ReceiptFileName(certification, details.Msme, details.Basic), details.Lines, ct);
            await SendMailAsync(zedId, certification, details, null, ct);
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

    /// <summary>The unit's details (result sets 0, 1 and 4 of SP_SURVEILLANCE_MSME_GET_DETAILS) and the payment's summary lines.</summary>
    public sealed record Details(IDictionary<string, object?>? Msme, IDictionary<string, object?>? Basic, IDictionary<string, object?>? Payment, List<SummaryLine> Lines);

    public async Task<Details> LoadAsync(string zedId, string certification, CancellationToken ct)
    {
        var sets = await db.QueryProcMultipleAsync("SP_SURVEILLANCE_MSME_GET_DETAILS", new { ZedId = zedId, CertificationType = certification }, ct);
        var payment = sets[4].FirstOrDefault();
        return new(sets[0].FirstOrDefault(), sets[1].FirstOrDefault(), payment, payment is null ? [] : SurveillancePaymentSummary.Lines(payment));
    }

    /// <summary>The receipt's file name in PDFs/SA/{ZedId} ({Level}_Milestone{0|2}_Payment_Receipt.pdf, where GenerateReceipt wrote it).</summary>
    public static string ReceiptFileName(string certification, IDictionary<string, object?>? msme, IDictionary<string, object?>? basic)
    {
        var milestone = msme?.Text("MileStoneNo") is { Length: > 0 } m ? m : "0";
        return basic?.Text("PaymentReceiptName") is { Length: > 0 } n ? n : $"{certification}_Milestone{milestone}_Payment_Receipt.pdf";
    }

    /// <summary>
    /// 2026-11-17 (the user): "E-mail a copy" of the surveillance payment confirmation: the same mail, to the unit's registered
    /// e-mail only, with the receipt and the tax invoice when there is one. The address it went to, or null (no e-mail or no payment).
    /// </summary>
    public async Task<string?> ResendAsync(string zedId, string certification, string? invoiceFile, CancellationToken ct)
    {
        var details = await LoadAsync(zedId, certification, ct);
        if (details.Payment is null) return null;
        var receipt = ReceiptPath(zedId, ReceiptFileName(certification, details.Msme, details.Basic));
        var attachments = new List<EmailAttachment>
        {
            new(Path.GetFileName(receipt), File.Exists(receipt) ? await File.ReadAllBytesAsync(receipt, ct) : RenderReceipt(zedId, details.Lines)),
        };
        if (invoiceFile is not null && File.Exists(invoiceFile))
            attachments.Add(new EmailAttachment(Path.GetFileName(invoiceFile), await File.ReadAllBytesAsync(invoiceFile, ct)));
        return await SendMailAsync(zedId, certification, details, attachments, ct);
    }

    private async Task<string?> SendMailAsync(string zedId, string certification, Details details, IReadOnlyList<EmailAttachment>? attachments, CancellationToken ct)
    {
        if (details.Msme?.Text("PledgeEmailId") is not { Length: > 0 } to) return null;
        var html = await templates.RenderAsync<SurveillancePaymentConfirmationEmail>(new Dictionary<string, object?>
        {
            [nameof(SurveillancePaymentConfirmationEmail.ZedId)] = zedId,
            [nameof(SurveillancePaymentConfirmationEmail.Certification)] = certification,
            [nameof(SurveillancePaymentConfirmationEmail.Lines)] = details.Lines,
            [nameof(SurveillancePaymentConfirmationEmail.PublicBaseUrl)] = portal.Value.PublicBaseUrl,
            [nameof(SurveillancePaymentConfirmationEmail.AppUrl)] = (await PortalLinks.ForPagesAsync(settings, portal.Value, ct)).GetValueOrDefault("playStore"),
        });
        // The copy the applicant asks for goes to the unit only; the office copy went with the first mail.
        var cc = attachments is null && emailOptions.Value.RegistrationCc is { Length: > 0 } cca ? new[] { cca } : null;
        await email.SendAsync(new EmailMessage(to, $"ZED Surveillance Assessment fee Payment Confirmation Details - {zedId}", html, EmailProfiles.Payment, cc, attachments), ct);
        return to;
    }

    /// <summary>Full path of a receipt of this unit (PDFs/SA/{ZedId}/{file}).</summary>
    public string ReceiptPath(string zedId, string fileName)
    {
        var root = Path.GetFullPath(Path.Combine(env.ContentRootPath, portal.Value.StorageRoot));
        return Path.Combine(root, "PDFs", "SA", string.Concat(zedId.Where(char.IsLetterOrDigit)),
            string.Concat(fileName.Where(c => char.IsLetterOrDigit(c) || c is '_' or '.' or '-')));
    }

    private static byte[] RenderReceipt(string zedId, List<SummaryLine> lines) =>
        SummaryPdf.Render("Surveillance Payment Summary", [$"ZED ID: {zedId}", $"Date: {DateTime.Now:MMMM d, yyyy}"], lines,
            Path.Combine(AppContext.BaseDirectory, "Assets", "Images", "zed-logo.png"));

    private async Task SaveReceiptAsync(string zedId, string fileName, List<SummaryLine> lines, CancellationToken ct)
    {
        var path = ReceiptPath(zedId, fileName);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await File.WriteAllBytesAsync(path, RenderReceipt(zedId, lines), ct);
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
