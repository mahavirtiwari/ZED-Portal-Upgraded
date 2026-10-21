using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Portal.Features.Documents;
using Zed.Portal.Features.Staff.Monitoring;
using Zed.Portal.Templates;

namespace Zed.Portal.Features.Consultancy.Milestones;

/// <summary>
/// What follows the CO's decision on a milestone: the milestone report through <see cref="IAssessmentDocuments"/>
/// (type "{Level}Milestone{n}", the old _Report / _Report_PR1 / _Report_PR2 / _Reject_Report files) and the mail to the
/// MSME (SP_RA_GET_CERTIFICATE_DETAILS: EmailId, EstablishmentName). The decision is already saved when this runs, so
/// a failed report or mail is logged and reported, never thrown.
/// </summary>
public sealed class MilestoneCompletion(
    ISqlExecutor db,
    IAssessmentDocuments documents,
    IEmailSender email,
    IHtmlTemplateRenderer templates,
    IOptions<PortalOptions> portal,
    IOptions<EmailOptions> emailOptions,
    PortalHost host,
    ILogger<MilestoneCompletion> log)
{
    private const string Scheme = "“MSME Sustainable (ZED) Certification” Scheme";

    public static MilestoneCompletion Create(IServiceProvider sp) => ActivatorUtilities.CreateInstance<MilestoneCompletion>(sp);

    /// <summary>Document type of a milestone report (MsmeSiteAssessmentController.CertificationTypes): SilverMilestone2, ...</summary>
    public static string ReportType(string level, int milestone) => $"{level}Milestone{milestone}";

    public sealed record Outcome(bool ReportAttached, bool MailSent);

    /// <summary>Mail details (read before a rejection renames the rows).</summary>
    public async Task<IDictionary<string, object?>?> DetailsAsync(string zedId, string level, CancellationToken ct)
    {
        try
        {
            return (await db.QueryProcMultipleAsync("SP_RA_GET_CERTIFICATE_DETAILS", new { ZedId = zedId, CertificationType = level }, ct))[0].FirstOrDefault();
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "Mail details of {ZedId} {Level} could not be read", zedId, level);
            return null;
        }
    }

    public async Task<DocumentFile?> ReportAsync(string zedId, string level, int milestone, CancellationToken ct)
    {
        try
        {
            return await documents.RenderReportAsync(zedId, ReportType(level, milestone), ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Milestone {Milestone} report of {ZedId} {Level} could not be generated", milestone, zedId, level);
            return null;
        }
    }

    /// <summary>"Handholding Support (Milestone n) Report" mail after the CO's final submit.</summary>
    public async Task<Outcome> CompletedAsync(string zedId, string level, int milestone, CancellationToken ct)
    {
        var report = await ReportAsync(zedId, level, milestone, ct);
        var row = await DetailsAsync(zedId, level, ct);
        var sent = await SendAsync(row, zedId, level, report,
            $"Handholding Support (Milestone {milestone}) Report under {Scheme} - {zedId}",
            $"{zedId}_{level}_Milestone{milestone}_Report.pdf",
            (to, attached) => templates.RenderAsync<ConsultancyMilestoneReportEmail>(Model(zedId, level, milestone, row, attached)), ct);
        return new Outcome(report is not null, sent);
    }

    /// <summary>Rejection mail, with the report rendered before the rows were archived.</summary>
    public Task<bool> RejectedAsync(string zedId, string level, int milestone, IDictionary<string, object?>? row, DocumentFile? report, CancellationToken ct) =>
        SendAsync(row, zedId, level, report,
            $"Rejection of your application under {Scheme} - {zedId}",
            $"{zedId}_{level}_Reject_Report.pdf",
            (to, attached) => templates.RenderAsync<ConsultancyMilestoneRejectionEmail>(Model(zedId, level, milestone, row, attached)), ct);

    private Dictionary<string, object?> Model(string zedId, string level, int milestone, IDictionary<string, object?>? row, bool attached) => new()
    {
        ["ReportAttached"] = attached,
        ["Milestone"] = milestone,
        ["ZedId"] = zedId,
        ["Certification"] = level,
        ["EnterpriseName"] = row?.Text("EstablishmentName"),
        ["LoginUrl"] = CertificationCompletion.MsmeLoginUrl(portal.Value, host),
        ["PublicBaseUrl"] = portal.Value.PublicBaseUrl,
    };

    private async Task<bool> SendAsync(IDictionary<string, object?>? row, string zedId, string level, DocumentFile? report,
        string subject, string attachmentName, Func<string, bool, Task<string>> render, CancellationToken ct)
    {
        try
        {
            var to = row?.Text("EmailId").Trim() ?? "";
            if (to.Length == 0)
            {
                log.LogWarning("No e-mail address for {ZedId} {Level}; milestone mail not sent", zedId, level);
                return false;
            }
            var html = await render(to, report is not null);
            var cc = emailOptions.Value.RegistrationCc is { Length: > 0 } c ? new[] { c } : null;
            var attachments = report is null ? null : new[] { new EmailAttachment(attachmentName, report.Content) };
            await email.SendAsync(new EmailMessage(to, subject, html, EmailProfiles.Default, cc, attachments), ct);
            return true;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "Milestone mail of {ZedId} {Level} failed", zedId, level);
            return false;
        }
    }
}
