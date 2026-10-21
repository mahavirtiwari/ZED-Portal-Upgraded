using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Portal.Features.Documents;
using Zed.Portal.Templates;

namespace Zed.Portal.Features.Staff.Monitoring;

/// <summary>
/// What happens after the agency's final submit or rejection: the certificate (and report) through
/// <see cref="IAssessmentDocuments"/> and the mails to the MSME. Port of MonitoringController.SendFinalCertiicationMail (Bronze,
/// SP_DA_GET_CERTIFICATE_DETAILS, _BronzeDaReportTemplate), SendSaCertiicationMail (Silver/Gold,
/// SP_RA_GET_CERTIFICATE_DETAILS, _SaReportTemplate), and SendRejectCertiicationMail (_NcRejectionMailTemplate).
/// The generation status row and RegenerateCertificate belong to the documents feature
/// (api/staff/certification-documents/regenerate).
/// <para>
/// The certification is already saved when this runs, so a failed document or mail is logged and
/// reported to the caller, never thrown. As before the certificate is attached to the mail; the old
/// mails linked to the public SA/ReportSummary page instead of attaching the report (finding #18), so
/// the report is attached when it can be generated and the button opens the MSME login.
/// </para>
/// </summary>
public sealed class CertificationCompletion(
    ISqlExecutor db,
    IAssessmentDocuments documents,
    IEmailSender email,
    IHtmlTemplateRenderer templates,
    IOptions<PortalOptions> portal,
    IOptions<EmailOptions> emailOptions,
    ILogger<CertificationCompletion> log)
{
    private const string Scheme = "“MSME Sustainable (ZED) Certification” Scheme";

    public static CertificationCompletion Create(IServiceProvider sp) => ActivatorUtilities.CreateInstance<CertificationCompletion>(sp);

    public sealed record Outcome(bool CertificateIssued, bool MailSent);

    /// <summary>Bronze is certified by the desktop assessment, Silver/Gold by the site assessment.</summary>
    private static bool IsSiteLevel(string certification) => !string.Equals(certification, "Bronze", StringComparison.OrdinalIgnoreCase);

    private static string DetailsProcedure(string certification) =>
        IsSiteLevel(certification) ? "SP_RA_GET_CERTIFICATE_DETAILS" : "SP_DA_GET_CERTIFICATE_DETAILS";

    /// <summary>Legacy location of the certificate: Certificates/DA/{ZedId}/Bronze.pdf, Certificates/SA/{ZedId}/{Level}.pdf.</summary>
    public static string CertificatePath(string zedId, string certification) =>
        $"Certificates/{(IsSiteLevel(certification) ? "SA" : "DA")}/{zedId}/{certification}.pdf";

    private string MsmeLogin => portal.Value.PublicBaseUrl.TrimEnd('/') + "/msme/login";

    // ------------------------------------------------------------------ certification

    /// <summary>Issues the certificate and mails it (with the report) to the MSME.</summary>
    public async Task<Outcome> CertifyAsync(string zedId, string certification, CancellationToken ct)
    {
        var certificate = await IssueAsync(zedId, certification, ct);
        if (certificate is null) return new Outcome(false, false);

        try
        {
            var row = (await db.QueryProcMultipleAsync(DetailsProcedure(certification), new { ZedId = zedId, CertificationType = certification }, ct))[0].FirstOrDefault();
            var to = row?.Text("EmailId").Trim() ?? "";
            if (to.Length == 0)
            {
                log.LogWarning("No e-mail address for {ZedId} {Certification}; certificate mail not sent", zedId, certification);
                return new Outcome(true, false);
            }

            var attachments = new List<EmailAttachment> { new(Path.GetFileName(certificate.RelativePath), certificate.Content) };
            var report = await TryReportAsync(zedId, certification, ct);
            if (report is not null) attachments.Add(new EmailAttachment($"{zedId}_{certification}_Report.pdf", report.Content));

            var html = await templates.RenderAsync<StaffMonitoringCertificateEmail>(new Dictionary<string, object?>
            {
                [nameof(StaffMonitoringCertificateEmail.SiteAssessment)] = IsSiteLevel(certification),
                [nameof(StaffMonitoringCertificateEmail.ReportAttached)] = report is not null,
                [nameof(StaffMonitoringCertificateEmail.ZedId)] = zedId,
                [nameof(StaffMonitoringCertificateEmail.Certification)] = certification,
                [nameof(StaffMonitoringCertificateEmail.EnterpriseName)] = row!.Text("EstablishmentName"),
                [nameof(StaffMonitoringCertificateEmail.LoginUrl)] = MsmeLogin,
                [nameof(StaffMonitoringCertificateEmail.PublicBaseUrl)] = portal.Value.PublicBaseUrl,
            });
            await email.SendAsync(new EmailMessage(to, $"Certificate and Assessment Report under {Scheme} - {zedId}", html,
                EmailProfiles.Default, Attachments: attachments), ct);
            return new Outcome(true, true);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "{ZedId} {Certification} certified but the certificate mail failed", zedId, certification);
            return new Outcome(true, false);
        }
    }

    /// <summary>
    /// Creates the certificate. Failures (DocumentNotAvailableException when the record has no certificate
    /// number yet, ArgumentException, rendering errors) are logged, never shown to the user.
    /// </summary>
    private async Task<DocumentFile?> IssueAsync(string zedId, string certification, CancellationToken ct)
    {
        try
        {
            // IAssessmentDocuments records SUCCESS/FAILED in CertificateGenerationStatus itself.
            return await documents.IssueCertificateAsync(zedId, certification, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "Certificate of {ZedId} {Certification} could not be generated", zedId, certification);
            return null;
        }
    }

    private async Task<DocumentFile?> TryReportAsync(string zedId, string certification, CancellationToken ct)
    {
        try
        {
            return await documents.RenderReportAsync(zedId, certification, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Report of {ZedId} {Certification} could not be generated; mail sent without it", zedId, certification);
            return null;
        }
    }

    // ------------------------------------------------------------------ rejection

    /// <summary>Mail details of the unit before its rows are renamed to the rejected copy (ZedId_D_{Id}).</summary>
    public async Task<IDictionary<string, object?>?> RejectionDetailsAsync(string zedId, string certification, CancellationToken ct)
    {
        try
        {
            return (await db.QueryProcMultipleAsync("SP_RA_GET_CERTIFICATE_DETAILS", new { ZedId = zedId, CertificationType = certification }, ct))[0].FirstOrDefault();
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "Rejection mail details of {ZedId} {Certification} could not be read", zedId, certification);
            return null;
        }
    }

    public async Task<bool> SendRejectionAsync(string zedId, string certification, IDictionary<string, object?>? row, CancellationToken ct)
    {
        try
        {
            var to = row?.Text("EmailId").Trim() ?? "";
            if (to.Length == 0)
            {
                log.LogWarning("No e-mail address for {ZedId} {Certification}; rejection mail not sent", zedId, certification);
                return false;
            }
            var rejected = row!.Text("RejectedZedId");
            var report = rejected.Length > 0 ? await TryReportAsync(rejected, certification, ct) : null;
            var html = await templates.RenderAsync<StaffMonitoringRejectionEmail>(new Dictionary<string, object?>
            {
                [nameof(StaffMonitoringRejectionEmail.ReportAttached)] = report is not null,
                [nameof(StaffMonitoringRejectionEmail.ZedId)] = zedId,
                [nameof(StaffMonitoringRejectionEmail.Certification)] = certification,
                [nameof(StaffMonitoringRejectionEmail.EnterpriseName)] = row!.Text("EstablishmentName"),
                [nameof(StaffMonitoringRejectionEmail.LoginUrl)] = MsmeLogin,
                [nameof(StaffMonitoringRejectionEmail.PublicBaseUrl)] = portal.Value.PublicBaseUrl,
            });
            var cc = emailOptions.Value.RegistrationCc is { Length: > 0 } c ? new[] { c } : null;
            var attachments = report is null ? null : new[] { new EmailAttachment($"{zedId}_{certification}_Report.pdf", report.Content) };
            await email.SendAsync(new EmailMessage(to, $"Rejection of your application under {Scheme} - {zedId}", html,
                EmailProfiles.Default, cc, attachments), ct);
            return true;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "{ZedId} {Certification} rejected but the rejection mail failed", zedId, certification);
            return false;
        }
    }
}
