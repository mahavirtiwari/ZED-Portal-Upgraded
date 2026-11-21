using System.Globalization;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Documents;
using Zed.Core.Email;
using Zed.Core.Finance;
using Zed.Core.Http;
using Zed.Portal.Templates;

namespace Zed.Portal.Features.Payments.Consultancy;

/// <summary>
/// What happens after a handholding milestone payment is recorded (ConsultancyPayController
/// SendPaymentConfirmationMail, GenerateReceipt, SendAutoAllotMail and SubmiInvoiceDataToApi /
/// SubmiReceiptDataToApi): the receipt PDF is written to PDFs/SA/{ZedId}/{Level}_Milestone{n}_Payment_Receipt.pdf
/// (where GenerateReceipt wrote it), the confirmation mail goes to the unit, the Consultant Organisation
/// of the previous milestone is told (milestones 2 and 3), and the ERP invoice and receipt are queued
/// with ModuleName CONSULTANCY.
/// <para>
/// The old receipt was a screenshot of SA/PaymentReceipt, which reads the <em>certification</em> payment
/// of the main database, so handholding receipts showed the wrong fee. This one shows the milestone
/// payment (ZED_CONSULTANT MsmePaymentInfo, result set 4 of SP_CONSULTANCY_MSME_GET_DETAILS).
/// </para>
/// Created per request with <c>ActivatorUtilities</c> (no registration in Program.cs).
/// </summary>
public sealed class ConsultancyPaymentCompletion(
    ISqlExecutor db,
    IEmailSender email,
    IHtmlTemplateRenderer templates,
    IBackgroundWork background,
    IWebHostEnvironment env,
    IOptions<PortalOptions> portal,
    EmailAddresses addresses,
    IServiceProvider services,
    ILogger<ConsultancyPaymentCompletion> log)
{
    public const string ModuleName = "CONSULTANCY";

    public static ConsultancyPaymentCompletion Create(IServiceProvider services) =>
        ActivatorUtilities.CreateInstance<ConsultancyPaymentCompletion>(services);

    /// <param name="gateway">
    /// Paid through the gateway (web or app). The legacy zero-amount path neither told the agency nor
    /// posted to the ERP; the gateway path did both.
    /// </param>
    public async Task CompleteAsync(string zedId, string certification, bool gateway, CancellationToken ct)
    {
        // One Admin (V4): the parameters not used in consultancy come out of the milestone's copy first.
        await ConsultancyParameters.ApplyAsync(db, zedId, certification, log, ct);
        // 2026-11-21 (the product owner's rule): milestone 1 goes at once to the organisation the unit named, else by round robin
        // (milestones 2 and 3 are left to the procedures, which follow the previous milestone's organisation). Never throws.
        await HandholdingAutoAllotment.Create(services).RunAsync(zedId, certification, ct);
        string? milestone = null;
        try
        {
            var details = await LoadAsync(zedId, certification, ct);
            var msme = details.Msme;
            milestone = details.Milestone;
            var cc = await addresses.CopyAsync(EmailAddresses.RegistrationCc, ct);

            if (details.Payment is not null)
                await SaveReceiptAsync(zedId, ReceiptFileName(certification, milestone), details.Lines, ct);

            await SendConfirmationAsync(zedId, details, cc, null, ct);

            // Result set 5: the Consultant Organisation of the previous milestone (milestones 2 and 3 only),
            // which the gateway procedure has just allotted to this one.
            if (gateway && details.AgencyEmail is { Length: > 0 } agency)
            {
                var html = await templates.RenderAsync<ConsultancyAllocationEmail>(new Dictionary<string, object?>
                {
                    [nameof(ConsultancyAllocationEmail.ZedId)] = zedId,
                    [nameof(ConsultancyAllocationEmail.Milestone)] = milestone ?? "",
                    [nameof(ConsultancyAllocationEmail.UnitName)] = msme?.Text("EnterpriseName") ?? "",
                    [nameof(ConsultancyAllocationEmail.UnitAddress)] = msme?.Text("Address") ?? "",
                    [nameof(ConsultancyAllocationEmail.LoginUrl)] = portal.Value.LegacyBaseUrl.TrimEnd('/') + "/Consultancy/User/Login",
                    [nameof(ConsultancyAllocationEmail.PublicBaseUrl)] = portal.Value.PublicBaseUrl,
                });
                await email.SendAsync(new EmailMessage(agency,
                    $"Allocation of MSME for Handholding Support (Milestone {milestone}) under “MSME Sustainable (ZED) Certification” Scheme - {zedId}",
                    html, EmailProfiles.Payment, cc), ct);
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // The payment is already recorded; the receipt can be regenerated and the mails resent.
            log.LogError(ex, "Handholding receipt or mails failed for {ZedId}/{Certification}", zedId, certification);
        }

        if (gateway)
        {
            // Invoice and receipt only, for the milestone just paid (the procedures pick the latest when empty).
            var paid = milestone;
            background.Enqueue($"ERP {ModuleName} {zedId}/{certification}/{paid}", async (sp, token) =>
            {
                var erp = sp.GetRequiredService<IErpFinanceService>();
                foreach (var document in new[] { ErpDocument.Invoice, ErpDocument.Receipt })
                    await erp.PushAsync(new ErpPush(zedId, certification, document, ModuleName, paid), token);
            });
        }
    }

    /// <summary>
    /// The unit's handholding details (result sets 0, 4 and 5 of SP_CONSULTANCY_MSME_GET_DETAILS): the unit, the level's latest
    /// milestone payment, its milestone (the unit's MileStoneNo, else the payment's MileStoneNum), its summary lines, and the
    /// Consultant Organisation of the previous milestone.
    /// </summary>
    public sealed record Details(
        IDictionary<string, object?>? Msme, IDictionary<string, object?>? Payment, string? Milestone, List<SummaryLine> Lines, string? AgencyEmail);

    public async Task<Details> LoadAsync(string zedId, string certification, CancellationToken ct)
    {
        var sets = await db.QueryProcMultipleAsync("SP_CONSULTANCY_MSME_GET_DETAILS", new { ZedId = zedId, CertificationType = certification }, ct);
        var msme = sets[0].FirstOrDefault();
        var payment = sets[4].FirstOrDefault();
        var milestone = msme?.Text("MileStoneNo") is { Length: > 0 } m && m != "0" ? m : payment?.Text("MileStoneNum");
        return new(msme, payment, milestone, payment is null ? [] : ConsultancyPaymentSummary.Lines(payment),
            sets[5].FirstOrDefault()?.Text("AutoEmailForAgency"));
    }

    /// <summary>The receipt's file name in PDFs/SA/{ZedId} ({Level}_Milestone{n}_Payment_Receipt.pdf, where GenerateReceipt wrote it).</summary>
    public static string ReceiptFileName(string certification, string? milestone) => $"{certification}_Milestone{milestone}_Payment_Receipt.pdf";

    /// <summary>Full path of a receipt of this unit (PDFs/SA/{ZedId}/{file}).</summary>
    public string ReceiptPath(string zedId, string fileName)
    {
        var root = Path.GetFullPath(Path.Combine(env.ContentRootPath, portal.Value.StorageRoot));
        return Path.Combine(root, "PDFs", "SA", string.Concat(zedId.Where(char.IsLetterOrDigit)),
            string.Concat(fileName.Where(c => char.IsLetterOrDigit(c) || c is '_' or '.' or '-')));
    }

    /// <summary>
    /// 2026-11-17 (the user): "E-mail a copy" of the handholding payment confirmation: the same mail, to the unit's registered
    /// e-mail only (no office copy), with the receipt and the tax invoice when there is one. The address it went to, or null
    /// (no e-mail or no payment).
    /// </summary>
    public async Task<string?> ResendAsync(string zedId, string certification, string? invoiceFile, CancellationToken ct)
    {
        var details = await LoadAsync(zedId, certification, ct);
        if (details.Payment is null) return null;
        var receipt = ReceiptPath(zedId, ReceiptFileName(certification, details.Milestone));
        var attachments = new List<EmailAttachment>
        {
            new(Path.GetFileName(receipt), File.Exists(receipt) ? await File.ReadAllBytesAsync(receipt, ct) : RenderReceipt(zedId, details.Lines)),
        };
        if (invoiceFile is not null && File.Exists(invoiceFile))
            attachments.Add(new EmailAttachment(Path.GetFileName(invoiceFile), await File.ReadAllBytesAsync(invoiceFile, ct)));
        return await SendConfirmationAsync(zedId, details, null, attachments, ct);
    }

    /// <summary>The confirmation mail to the unit's registered e-mail; the address, or null without one.</summary>
    private async Task<string?> SendConfirmationAsync(
        string zedId, Details details, IReadOnlyList<string>? cc, IReadOnlyList<EmailAttachment>? attachments, CancellationToken ct)
    {
        if (details.Msme?.Text("PledgeEmailId") is not { Length: > 0 } to) return null;
        var html = await templates.RenderAsync<ConsultancyPaymentConfirmationEmail>(new Dictionary<string, object?>
        {
            [nameof(ConsultancyPaymentConfirmationEmail.ZedId)] = zedId,
            [nameof(ConsultancyPaymentConfirmationEmail.Milestone)] = details.Milestone ?? "",
            [nameof(ConsultancyPaymentConfirmationEmail.Lines)] = details.Lines,
            [nameof(ConsultancyPaymentConfirmationEmail.PublicBaseUrl)] = portal.Value.PublicBaseUrl,
        });
        await email.SendAsync(new EmailMessage(to,
            $"ZED Handholding Support (Milestone {details.Milestone}) Payment Confirmation Details - {zedId}", html, EmailProfiles.Payment, cc, attachments), ct);
        return to;
    }

    private static byte[] RenderReceipt(string zedId, List<SummaryLine> lines) =>
        SummaryPdf.Render("Handholding Support Payment Summary", [$"ZED ID: {zedId}", $"Date: {DateTime.Now:MMMM d, yyyy}"], lines,
            Path.Combine(AppContext.BaseDirectory, "Assets", "Images", "zed-logo.png"));

    private async Task SaveReceiptAsync(string zedId, string fileName, List<SummaryLine> lines, CancellationToken ct)
    {
        var path = ReceiptPath(zedId, fileName);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await File.WriteAllBytesAsync(path, RenderReceipt(zedId, lines), ct);
    }
}

/// <summary>The lines of _Consultancy_MsmePaymentTemplate.cshtml (receipt and e-mail).</summary>
public static class ConsultancyPaymentSummary
{
    private static string V(IDictionary<string, object?> r, string c) =>
        r.TryGetValue(c, out var v) && v is not null and not DBNull ? Convert.ToString(v, CultureInfo.InvariantCulture) ?? "" : "";

    public static List<SummaryLine> Lines(IDictionary<string, object?> p)
    {
        // A milestone paid at milestone 1 ("pay all at milestone 1", migration 0044): its Rs. 0 record.
        if (V(p, "PaymentType") == "PaidAtMilestone1")
            return [new("Handholding Fee", "Paid at milestone 1"), new("Net Payable Amount", "₹ 0.00", Bold: true)];
        var lines = new List<SummaryLine>
        {
            new("Handholding Fee", "₹ " + V(p, "Total")),
            new("Subsidy " + V(p, "SubsidyLabel"), "- ₹ " + V(p, "Subsidy")),
        };
        if (V(p, "StateSubsidy") is { Length: > 0 } ss && ss != "0")
            lines.Add(new("Andhra Pradesh Govt. Subsidy " + V(p, "StateSubsidyLabel"), "- ₹ " + ss));
        lines.Add(new("Amount Payable", "₹ " + V(p, "ApplicantContributionAfterSubsidy")));
        lines.Add(new("Amount", "₹ " + V(p, "SubsidyAmount")));
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
