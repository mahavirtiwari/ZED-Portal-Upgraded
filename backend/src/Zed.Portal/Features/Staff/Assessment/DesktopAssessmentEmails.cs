using System.Net;
using System.Text;
using Microsoft.AspNetCore.Components;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Portal.Templates;

namespace Zed.Portal.Features.Staff.Assessment;

/// <summary>
/// Notifications of the desktop-assessment workflow. Port of AssessmentController.SendMail with
/// Views/Shared/_DaAllotCbTemplate, _DaAllotAssessorTemplate, _DaRejectionTemplate,
/// _DaVerificationRejectUnitTemplate and _DaNcRaisedTemplate (details from SP_EMAIL_GET_DETAILS).
/// The old assessor and NC mails contained the assessor's and the MSME's portal passwords in plain
/// text (the procedure selects Users.Password); these do not. Every value is HTML-encoded. A failed
/// mail is logged and never fails the request: the workflow step is already saved.
/// <para>
/// Per system (the legacy SendMail of each portal): Surveillance uses the same bodies with the surveillance subjects
/// ("Allocation of MSME for ZED Surveillance Assessment", "Allocation of Surveillance Assessment", "Non-conformance(s)
/// raised for Surveillance Assessment") and copies every mail to the cc address; its NC mail has no MSME sign-in (the
/// assessor answers the NCs in the Surveillance app). Consultancy sends only the allotment to the Consultant
/// Organisation: "Allocation of MSME for Handholding Support (Milestone n)" (<see cref="ConsultancyAllocationEmail"/>), copied.
/// </para>
/// </summary>
public sealed class DesktopAssessmentEmails(
    ISqlExecutor db,
    IEmailSender email,
    IHtmlTemplateRenderer templates,
    IOptions<PortalOptions> portal,
    EmailAddresses addresses,
    PortalHost host,
    ILogger<DesktopAssessmentEmails> log)
{
    private const string Scheme = "“MSME Sustainable (ZED) Certification” Scheme";

    public enum Kind { AllottedToAgency, AllottedToAssessor, RejectedByAgency, RejectedByAssessor, NcRaised }

    public static DesktopAssessmentEmails Create(IServiceProvider sp) => ActivatorUtilities.CreateInstance<DesktopAssessmentEmails>(sp);

    public async Task SendAsync(Kind kind, string zedId, string certification, string? reason, CancellationToken ct)
    {
        try
        {
            var row = (await db.QueryProcMultipleAsync("SP_EMAIL_GET_DETAILS",
                new { ZedId = AssessmentInput.Ansi(zedId, 100), Certification = AssessmentInput.Ansi(certification, 100) }, ct))[0].FirstOrDefault();
            if (row is null)
            {
                log.LogWarning("No e-mail details for {ZedId} {Certification}; {Kind} mail not sent", zedId, certification, kind);
                return;
            }

            var cc = await addresses.CopyAsync(EmailAddresses.RegistrationCc, ct);
            var surveillance = host.System == PortalSystem.Surveillance;
            if (host.System == PortalSystem.Consultancy)
            {
                if (kind == Kind.AllottedToAgency) await ConsultancyAllottedAsync(row, zedId, cc, ct);
                else log.LogWarning("{Kind} mail is not used on the consultancy portal ({ZedId})", kind, zedId);
                return;
            }
            switch (kind)
            {
                case Kind.AllottedToAgency:
                    await SendAsync(row.Text("AgencyEmailId"),
                        surveillance ? $"Allocation of MSME for ZED Surveillance Assessment under {Scheme} - {zedId}" : $"Allocation of MSME for Assessment under {Scheme} - {zedId}",
                        AgencyAllotted(row, zedId, certification), surveillance ? cc : null, ct);
                    break;
                case Kind.AllottedToAssessor:
                    await SendAsync(row.Text("AssessorEmailId"),
                        surveillance ? $"Allocation of Surveillance Assessment under {Scheme} - {zedId}" : $"Allocation of Desktop Verification under {Scheme} - {zedId}",
                        AssessorAllotted(row, zedId), cc, ct);
                    break;
                case Kind.RejectedByAgency:
                    await SendAsync(await addresses.GetAsync(EmailAddresses.ZedTeamInbox, ct) ?? EmailAddresses.LegacyTeamInbox,
                        $"Rejection by Agency under {Scheme} - {zedId}", AgencyRejected(row, zedId, reason), cc, ct);
                    break;
                case Kind.RejectedByAssessor:
                    await SendAsync(row.Text("AgencyEmailId"),
                        $"Rejection by Assessor for Desktop Verification under {Scheme} - {zedId}", AssessorRejected(row, zedId, reason), cc, ct);
                    break;
                case Kind.NcRaised:
                    var level = row.Text("NcCount") switch { "1" => "First ", "2" => "Second ", "3" => "Third ", "4" => "Fourth ", "5" => "Fifth ", _ => "" };
                    await SendAsync(row.Text("EmailId"),
                        surveillance ? $"{level}Non-conformance(s) raised for Surveillance Assessment under {Scheme} - {zedId}" : $"{level}Non-conformance(s) raised under {Scheme} - {zedId}",
                        NcRaised(row, zedId, certification, surveillance), surveillance ? cc : null, ct);
                    break;
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Desktop assessment step saved for {ZedId} {Certification} but the {Kind} mail failed", zedId, certification, kind);
        }
    }

    private async Task SendAsync(string to, string subject, string body, IReadOnlyList<string>? cc, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(to)) return;
        RenderFragment content = b => b.AddMarkupContent(0, body);
        var html = await templates.RenderAsync<EmailLayout>(new Dictionary<string, object?>
        {
            [nameof(EmailLayout.PublicBaseUrl)] = portal.Value.PublicBaseUrl,
            [nameof(EmailLayout.ChildContent)] = content,
        });
        await email.SendAsync(new EmailMessage(to.Trim(), subject, html, EmailProfiles.Allocation, cc), ct);
    }

    /// <summary>Consultancy: the Consultant Organisation is told of the milestone allotted to it.</summary>
    private async Task ConsultancyAllottedAsync(IDictionary<string, object?> row, string zedId, IReadOnlyList<string>? cc, CancellationToken ct)
    {
        var to = row.Text("AgencyEmailId");
        if (string.IsNullOrWhiteSpace(to)) return;
        var milestone = row.Text("NcCount");
        var html = await templates.RenderAsync<ConsultancyAllocationEmail>(new Dictionary<string, object?>
        {
            [nameof(ConsultancyAllocationEmail.ZedId)] = zedId,
            [nameof(ConsultancyAllocationEmail.Milestone)] = milestone,
            [nameof(ConsultancyAllocationEmail.UnitName)] = row.Text("EnterpriseName"),
            [nameof(ConsultancyAllocationEmail.UnitAddress)] = row.Text("Address"),
            [nameof(ConsultancyAllocationEmail.LoginUrl)] = StaffLogin,
            [nameof(ConsultancyAllocationEmail.PublicBaseUrl)] = portal.Value.PublicBaseUrl,
        });
        await email.SendAsync(new EmailMessage(to.Trim(),
            $"Allocation of MSME for Handholding Support (Milestone {milestone}) under {Scheme} - {zedId}", html, EmailProfiles.Allocation, cc), ct);
    }

    private string StaffLogin => portal.Value.PublicBaseUrl.TrimEnd('/') + "/login";
    private string MsmeLogin => portal.Value.PublicBaseUrl.TrimEnd('/') + "/msme/login";

    private string AgencyAllotted(IDictionary<string, object?> row, string zedId, string certification)
    {
        var sb = new StringBuilder();
        P(sb, "Dear Madam/Sir,");
        P(sb, "Greetings of the day!");
        P(sb, "An MSME Unit has been allocated to you for ZED Assessment. The details are as follows:");
        Table(sb,
            ("MSME ZED ID", zedId),
            ("Unit Name", row.Text("EnterpriseName")),
            ("Unit Address", row.Text("Address")),
            ("Mode of Assessment", certification == "Bronze" ? "Desktop Verification" : "Desktop or/and Remote/Site Verification"));
        P(sb, "Please log-in to your account in order to Accept or Reject this allocation within 48 hrs.");
        Button(sb, StaffLogin, "Click here to Login");
        P(sb, "In case of any query, please mail us at: zed.support@qcin.org. Please mention your Agency ID in all your correspondence.");
        Closing(sb);
        return sb.ToString();
    }

    private string AssessorAllotted(IDictionary<string, object?> row, string zedId)
    {
        var sb = new StringBuilder();
        P(sb, "Dear Madam/Sir,");
        P(sb, "Greetings of the day!");
        P(sb, "You have been allocated a Desktop Verification under \"MSME Sustainable (ZED) Certification\" Scheme. The details of the MSME are as follows:");
        Table(sb,
            ("MSME ZED ID", zedId),
            ("Unit Name", row.Text("PUnitName")),
            ("Unit Address", row.Text("Address")),
            ("Mode of Assessment", "Desktop Verification"),
            ("Assessor ID", row.Text("AssessorUserId")));
        P(sb, "Please log-in to your account to Accept or Reject this allocation within 48 hrs. Sign in with your Assessor ID and your existing ZED password; " +
              "if you do not remember it, use \"Forgot Password\" on the login page.");
        Button(sb, StaffLogin, "Click here to Login");
        Closing(sb);
        return sb.ToString();
    }

    private static string AgencyRejected(IDictionary<string, object?> row, string zedId, string? reason)
    {
        var sb = new StringBuilder();
        P(sb, "Dear Madam/Sir,");
        P(sb, "The assessment allocated to this Agency is being returned as rejected. The details are as follows:");
        Table(sb,
            ("MSME ZED ID", zedId),
            ("Unit Name", row.Text("EnterpriseName")),
            ("Registered Assessment Agency Name", row.Text("AgencyName")),
            ("Registered Assessment Agency ID", row.Text("AgencyUserId")),
            ("Reason for Rejection", reason));
        Closing(sb);
        return sb.ToString();
    }

    private static string AssessorRejected(IDictionary<string, object?> row, string zedId, string? reason)
    {
        var sb = new StringBuilder();
        P(sb, "Dear Madam/Sir,");
        P(sb, "The assessment allocated to this Assessor is being returned as rejected. The details are as follows:");
        Table(sb,
            ("MSME ZED ID", zedId),
            ("Unit Name", row.Text("EnterpriseName")),
            ("Assessor Name", row.Text("AssessorName")),
            ("Assessor ID", row.Text("AssessorUserId")),
            ("Reason for Rejection", reason));
        Closing(sb);
        return sb.ToString();
    }

    private string NcRaised(IDictionary<string, object?> row, string zedId, string certification, bool surveillance)
    {
        var sb = new StringBuilder();
        P(sb, "Dear Madam/Sir,");
        P(sb, "Greetings of the day!");
        P(sb, "This is with reference to your application for Certification under \"MSME Sustainable (ZED) Certification\" Scheme.");
        P(sb, "After review of the documents, the list of Non-conformance(s) along with the comments of the assessor can be viewed online in your dashboard. " +
              $"You are requested to close all the Non-conformance(s) through the mobile application latest by {row.Text("NcFinalClosureDt")} (NC Closure Date).");
        var attempt = row.Text("NcCount") switch
        {
            "1" => "first", "2" => "second", "3" => "third", "4" => "fourth", "5" => "fifth and last", _ => null,
        };
        if (attempt is not null)
        {
            var days = certification == "Bronze" ? 30 : 60;
            P(sb, $"Note: This is your {attempt} attempt out of total 5 attempts to close your Non-conformance(s). All the Non-Conformances (all 5 attempts) " +
                  $"must be closed within a period of {days} days from the date of first Non-Conformance raised. In case you are unable to close the " +
                  $"Non-conformance(s) in these 5 attempts or within {days} days, your application for the applied Certification shall stand as Rejected " +
                  "and no Certificate will be awarded.");
        }
        if (surveillance)
        {
            // No MSME accounts on the surveillance portal: the assessor answers the NCs with the unit in the Surveillance app.
            Table(sb, ("Enterprise Name", row.Text("EnterpriseName")), ("ZED ID", zedId));
            P(sb, "(Remember to use your ZED ID in all future correspondence with the ZED Team at QCI)");
        }
        else
        {
            P(sb, "Your login details are as follows:");
            Table(sb, ("Enterprise Name", row.Text("EnterpriseName")), ("ZED ID", zedId));
            P(sb, "Sign in with your ZED ID and your existing password. (Remember to use your ZED ID in all future correspondence with the ZED Team at QCI)");
            Button(sb, MsmeLogin, "Go to Login");
        }
        P(sb, "In case of any query, please mail us at: zed.support@qcin.org.");
        Closing(sb);
        return sb.ToString();
    }

    private static string E(string? value) => WebUtility.HtmlEncode(value ?? "");

    private static void Table(StringBuilder sb, params (string Label, string? Value)[] rows)
    {
        sb.Append("<table style=\"width: 100%; table-layout: fixed; font-size: 13px;padding: 15px; background: #F0F0F0;\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\"><tbody bgcolor=\"#ffffff\">");
        foreach (var (label, value) in rows)
            sb.Append("<tr><td style=\"border-bottom:2px solid #f0f0f0;padding: 15px; width: 30%; font-size: 13px; text-align: left; padding-right: 20px;\">")
              .Append(E(label))
              .Append("</td><td style=\"border-bottom:2px solid #f0f0f0;font-weight: 700;\">")
              .Append(E(value))
              .Append("</td></tr>");
        sb.Append("</tbody></table>");
    }

    private static void P(StringBuilder sb, string text) =>
        sb.Append("<p style=\"font-size: 13px; margin-bottom: 0;\">").Append(E(text)).Append("</p>");

    private static void Button(StringBuilder sb, string href, string text) =>
        sb.Append("<div style=\"text-align: center; padding: 30px 0;\"><a href=\"").Append(E(href))
          .Append("\" target=\"_blank\" style=\"display: block; margin: 0 auto; width: 300px; line-height: 42px; color: #ffffff; background-color: #45A5AD; text-decoration: none; border-radius: 4px; text-align: center;\">")
          .Append(E(text)).Append("</a></div>");

    private static void Closing(StringBuilder sb) =>
        sb.Append("<p style=\"font-size: 13px; margin-bottom: 0px;\">Thanks and Regards,</p><p style=\"font-size: 13px; margin-bottom: 20px;\">ZED Team</p>");
}
