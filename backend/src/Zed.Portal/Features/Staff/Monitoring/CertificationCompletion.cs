using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Portal.Features.Documents;
using Zed.Portal.Features.Staff.Assessment;
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
/// mails linked to the public SA/ReportSummary page (finding #18). 2026-11-15: the report is a page of the portal built from
/// the live data (<see cref="ReportPages"/>), so the mails link to it ("View report", /msme/report/..., sign-in needed)
/// instead of attaching a PDF.
/// </para>
/// <para>
/// On the Surveillance host (ZED_SURVEILLANCE: the procedures re-use main's certificate number and set main's
/// certificate ACTIVE or WITHDRAWN themselves) the certificate comes from the same <see cref="IAssessmentDocuments"/>
/// (surveillance artwork, DateOfSurveillance, SurveillanceNo, stored under main's Surveillance/Certificates/...), the
/// mails carry the old surveillance subjects and wording, and link to the surveillance report page on main.
/// </para>
/// </summary>
public sealed class CertificationCompletion(
    ISqlExecutor db,
    IAssessmentDocuments documents,
    IEmailSender email,
    IHtmlTemplateRenderer templates,
    IOptions<PortalOptions> portal,
    IOptions<EmailOptions> emailOptions,
    PortalHost host,
    ILogger<CertificationCompletion> log)
{
    private const string Scheme = "“MSME Sustainable (ZED) Certification” Scheme";

    public static CertificationCompletion Create(IServiceProvider sp) => ActivatorUtilities.CreateInstance<CertificationCompletion>(sp);

    public sealed record Outcome(bool CertificateIssued, bool MailSent);

    /// <summary>Bronze is certified by the desktop assessment, Silver/Gold by the site assessment.
    /// 2026-11-08: a V4 level assessed at the desktop only is certified by the desktop assessment too.</summary>
    private static bool IsSiteLevel(string certification) => !Zed.Core.Data.LevelRegistry.IsDesktop(certification);

    private static string DetailsProcedure(bool site) => site ? "SP_RA_GET_CERTIFICATE_DETAILS" : "SP_DA_GET_CERTIFICATE_DETAILS";

    /// <summary>Legacy location of the certificate: Certificates/DA/{ZedId}/Bronze.pdf, Certificates/SA/{ZedId}/{Level}.pdf.</summary>
    public static string CertificatePath(string zedId, string certification) =>
        $"Certificates/{(IsSiteLevel(certification) ? "SA" : "DA")}/{zedId}/{certification}.pdf";

    private string MsmeLogin => MsmeLoginUrl(portal.Value, host);

    private bool Surveillance => host.System == PortalSystem.Surveillance;

    /// <summary>
    /// The MSME sign-in page. MSMEs sign in on main only; the Consultancy and Surveillance portals are served under
    /// /Consultancy and /surveillance of the same site, so their links point at the root of their PublicBaseUrl.
    /// </summary>
    public static string MsmeLoginUrl(PortalOptions options, PortalHost host)
    {
        var baseUrl = options.PublicBaseUrl.TrimEnd('/');
        if (host.System != PortalSystem.Main && Uri.TryCreate(baseUrl, UriKind.Absolute, out var uri))
            baseUrl = uri.GetLeftPart(UriPartial.Authority);
        return baseUrl + "/msme/login";
    }

    /// <summary>
    /// The MSME's report page on main (2026-11-15): /msme/report/{assessment|surveillance|milestone}/{Level}[?…]. The page asks
    /// for the sign-in first and comes back to the report.
    /// </summary>
    public static string MsmeReportUrl(PortalOptions options, PortalHost host, string kind, string level, string? query = null) =>
        MsmeLoginUrl(options, host)[..^"/msme/login".Length] + $"/msme/report/{kind}/{Uri.EscapeDataString(level)}" + (string.IsNullOrEmpty(query) ? "" : "?" + query);

    private string ReportKind => Surveillance ? ReportLinks.Surveillance : ReportLinks.Assessment;

    /// <summary>Subject of the certificate mail; surveillance: the old SurveillanceWeb FinalSubmit / RaFinalSubmit subjects.</summary>
    private string CertificateSubject(string zedId, string certification) => !Surveillance
        ? $"Certificate and Assessment Report under {Scheme} - {zedId}"
        : IsSiteLevel(certification)
            ? $"Surveillance Certificate and Assessment Report under {Scheme} - {zedId}"
            : $"Certificate and Surveillance Report under {Scheme} - {zedId}";

    // ------------------------------------------------------------------ certification

    /// <summary>Issues the certificate and mails it (with the report) to the MSME.</summary>
    public async Task<Outcome> CertifyAsync(string zedId, string certification, CancellationToken ct)
    {
        var certificate = await IssueAsync(zedId, certification, ct);
        if (certificate is null) return new Outcome(false, false);

        try
        {
            // 2026-11-27: on main the case's own flow (migration 0117), else its level's; surveillance rounds keep the level's rule.
            var site = Surveillance ? IsSiteLevel(certification) : !await CertLevels.CaseFlows.IsDesktopAsync(db, zedId, certification, log, ct);
            var row = (await db.QueryProcMultipleAsync(DetailsProcedure(site), new { ZedId = zedId, CertificationType = certification }, ct))[0].FirstOrDefault();
            var to = row?.Text("EmailId").Trim() ?? "";
            if (to.Length == 0)
            {
                log.LogWarning("No e-mail address for {ZedId} {Certification}; certificate mail not sent", zedId, certification);
                return new Outcome(true, false);
            }

            // The certificate stays attached; the report is a link to its page (2026-11-15).
            var attachments = new List<EmailAttachment> { new(Path.GetFileName(certificate.RelativePath), certificate.Content) };

            var html = await templates.RenderAsync<StaffMonitoringCertificateEmail>(new Dictionary<string, object?>
            {
                [nameof(StaffMonitoringCertificateEmail.Surveillance)] = Surveillance,
                [nameof(StaffMonitoringCertificateEmail.SiteAssessment)] = site,
                [nameof(StaffMonitoringCertificateEmail.ReportAttached)] = false,
                [nameof(StaffMonitoringCertificateEmail.ReportUrl)] = MsmeReportUrl(portal.Value, host, ReportKind, certification),
                [nameof(StaffMonitoringCertificateEmail.ZedId)] = zedId,
                [nameof(StaffMonitoringCertificateEmail.Certification)] = certification,
                [nameof(StaffMonitoringCertificateEmail.EnterpriseName)] = row!.Text("EstablishmentName"),
                [nameof(StaffMonitoringCertificateEmail.LoginUrl)] = MsmeLogin,
                [nameof(StaffMonitoringCertificateEmail.PublicBaseUrl)] = portal.Value.PublicBaseUrl,
            });
            await email.SendAsync(new EmailMessage(to, CertificateSubject(zedId, certification), html,
                EmailProfiles.Certification, Attachments: attachments), ct);
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
            // 2026-11-15: the rejected copy's report page (live data of the renamed rows), linked instead of attached.
            var reportUrl = AssessmentInput.IsId(rejected) && rejected.Contains('_')
                ? MsmeReportUrl(portal.Value, host, ReportKind, certification, "record=" + Uri.EscapeDataString(rejected))
                : null;
            var html = await templates.RenderAsync<StaffMonitoringRejectionEmail>(new Dictionary<string, object?>
            {
                [nameof(StaffMonitoringRejectionEmail.ReportAttached)] = false,
                [nameof(StaffMonitoringRejectionEmail.ReportUrl)] = reportUrl,
                [nameof(StaffMonitoringRejectionEmail.ZedId)] = zedId,
                [nameof(StaffMonitoringRejectionEmail.Certification)] = certification,
                [nameof(StaffMonitoringRejectionEmail.EnterpriseName)] = row!.Text("EstablishmentName"),
                [nameof(StaffMonitoringRejectionEmail.LoginUrl)] = MsmeLogin,
                [nameof(StaffMonitoringRejectionEmail.PublicBaseUrl)] = portal.Value.PublicBaseUrl,
            });
            var cc = emailOptions.Value.RegistrationCc is { Length: > 0 } c ? new[] { c } : null;
            await email.SendAsync(new EmailMessage(to, $"Rejection of your application under {Scheme} - {zedId}", html,
                EmailProfiles.Certification, cc), ct);
            return true;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "{ZedId} {Certification} rejected but the rejection mail failed", zedId, certification);
            return false;
        }
    }
}
