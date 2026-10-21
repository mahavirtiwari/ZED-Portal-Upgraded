using System.Net;
using System.Text;
using Microsoft.AspNetCore.Components;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Portal.Templates;

namespace Zed.Portal.Features.Staff.SiteAssessment;

/// <summary>
/// Mails sent when an agency allots an on-site assessment. Port of AssessmentController.SendMail
/// ("AcceptUnitForSa", Onsite branch) with Views/Shared/_SaAllotUnitToOnsiteAssessmentTemplate,
/// _SaAllotUnitToLeadAssessorTemplate and _SaAllotUnitToCoAssessorTemplate.
/// The old assessor mails contained the assessor's portal password in plain text (SP_EMAIL_GET_DETAILS
/// selects Users.Password); these do not. Every value is HTML-encoded.
/// </summary>
public sealed class SiteAllotmentEmails(
    ISqlExecutor db,
    IEmailSender email,
    IHtmlTemplateRenderer templates,
    IOptions<PortalOptions> portal,
    IOptions<EmailOptions> emailOptions,
    ILogger<SiteAllotmentEmails> log)
{
    private const string Scheme = "“MSME Sustainable (ZED) Certification” Scheme";

    public async Task SendOnsiteAllotmentAsync(string zedId, string certification, CancellationToken ct)
    {
        try
        {
            var row = (await db.QueryProcMultipleAsync("SP_EMAIL_GET_DETAILS", new { ZedId = zedId, Certification = certification }, ct))[0].FirstOrDefault();
            if (row is null)
            {
                log.LogWarning("No e-mail details for {ZedId} {Certification}; allotment mails not sent", zedId, certification);
                return;
            }

            var subject = $"Allocation of Onsite Assessment under {Scheme} - {zedId}";
            var cc = emailOptions.Value.RegistrationCc is { Length: > 0 } c ? new[] { c } : null;

            await SendAsync(row.Text("EmailId"), subject, UnitBody(row), cc, ct);
            await SendAsync(row.Text("AssessorEmailId"), subject,
                AssessorBody(row, zedId, "Lead Assessor", row.Text("AssessorUserId")), cc, ct);
            if (row.Text("CoAssessorUserId").Length > 0)
                await SendAsync(row.Text("CoAssessorEmailId"), subject,
                    AssessorBody(row, zedId, "a Co-assessor", row.Text("CoAssessorUserId")), cc, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // The allotment is saved; the mails are notifications only.
            log.LogWarning(ex, "Site assessment allotted for {ZedId} {Certification} but a notification mail failed", zedId, certification);
        }
    }

    /// <summary>
    /// Surveillance (ZEDCS_SURVEILLANCE AssessmentController.SendMail "AcceptUnitForSa", Onsite branch): the unit, the
    /// assessor and the co-assessor, subject "Allocation of Surveillance Assessment ...", with the meeting link
    /// (shown only when it is an http/https address). No passwords.
    /// </summary>
    public async Task SendSurveillanceAllotmentAsync(string zedId, string certification, CancellationToken ct)
    {
        try
        {
            var row = (await db.QueryProcMultipleAsync("SP_EMAIL_GET_DETAILS", new { ZedId = zedId, Certification = certification }, ct))[0].FirstOrDefault();
            if (row is null)
            {
                log.LogWarning("No e-mail details for {ZedId} {Certification}; surveillance allotment mails not sent", zedId, certification);
                return;
            }

            var subject = $"Allocation of Surveillance Assessment under {Scheme} - {zedId}";
            var cc = emailOptions.Value.RegistrationCc is { Length: > 0 } c ? new[] { c } : null;
            var link = AssessmentInputs.WebLink(row.Text("MeetingLink"), 5000);
            var baseUrl = portal.Value.PublicBaseUrl.TrimEnd('/');

            await SendTemplateAsync<SurveillanceSiteAllotmentUnitEmail>(row.Text("EmailId"), subject, new()
            {
                [nameof(SurveillanceSiteAllotmentUnitEmail.AgencyName)] = row.Text("AgencyName"),
                [nameof(SurveillanceSiteAllotmentUnitEmail.SpocName)] = row.Text("SpocName"),
                [nameof(SurveillanceSiteAllotmentUnitEmail.AgencyEmail)] = row.Text("AgencyEmailId"),
                [nameof(SurveillanceSiteAllotmentUnitEmail.AgencyMobileNo)] = row.Text("AgencyMobileNo"),
                [nameof(SurveillanceSiteAllotmentUnitEmail.AssessmentDate)] = row.Text("FinalSaDate"),
                [nameof(SurveillanceSiteAllotmentUnitEmail.MeetingLink)] = link,
                // MSMEs sign in on main (the surveillance portal has no MSME accounts).
                [nameof(SurveillanceSiteAllotmentUnitEmail.LoginUrl)] = MainOrigin + "/Msme/Login",
            }, cc, ct);

            async Task Assessor(string to, string role, string assessorId)
            {
                if (assessorId.Length == 0) return;
                await SendTemplateAsync<SurveillanceSiteAllotmentAssessorEmail>(to, subject, new()
                {
                    [nameof(SurveillanceSiteAllotmentAssessorEmail.Role)] = role,
                    [nameof(SurveillanceSiteAllotmentAssessorEmail.ZedId)] = zedId,
                    [nameof(SurveillanceSiteAllotmentAssessorEmail.UnitName)] = row.Text("PUnitName") is { Length: > 0 } u ? u : row.Text("EnterpriseName"),
                    [nameof(SurveillanceSiteAllotmentAssessorEmail.UnitAddress)] = row.Text("Address"),
                    [nameof(SurveillanceSiteAllotmentAssessorEmail.AssessmentDate)] = row.Text("FinalSaDate"),
                    [nameof(SurveillanceSiteAllotmentAssessorEmail.MeetingLink)] = link,
                    [nameof(SurveillanceSiteAllotmentAssessorEmail.AssessorId)] = assessorId,
                    [nameof(SurveillanceSiteAllotmentAssessorEmail.LoginUrl)] = baseUrl + "/User/Login",
                }, cc, ct);
            }

            await Assessor(row.Text("AssessorEmailId"), "Assessor", row.Text("AssessorUserId"));
            await Assessor(row.Text("CoAssessorEmailId"), "Co-assessor", row.Text("CoAssessorUserId"));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Surveillance assessment allotted for {ZedId} {Certification} but a notification mail failed", zedId, certification);
        }
    }

    /// <summary>Scheme and host of <see cref="PortalOptions.PublicBaseUrl"/> (main's address when the system runs under a sub-path).</summary>
    private string MainOrigin =>
        Uri.TryCreate(portal.Value.PublicBaseUrl, UriKind.Absolute, out var u) ? u.GetLeftPart(UriPartial.Authority) : portal.Value.PublicBaseUrl.TrimEnd('/');

    private async Task SendTemplateAsync<TTemplate>(string to, string subject, Dictionary<string, object?> parameters,
        IReadOnlyList<string>? cc, CancellationToken ct) where TTemplate : IComponent
    {
        if (string.IsNullOrWhiteSpace(to)) return;
        parameters["PublicBaseUrl"] = portal.Value.PublicBaseUrl;
        var html = await templates.RenderAsync<TTemplate>(parameters);
        await email.SendAsync(new EmailMessage(to.Trim(), subject, html, EmailProfiles.Allocation, cc), ct);
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

    private string UnitBody(IDictionary<string, object?> row)
    {
        var sb = new StringBuilder();
        P(sb, "Dear Madam/Sir,");
        P(sb, "Greetings of the day!");
        P(sb, "The Date of On-site assessment is finalized. The details of the Agency allocated to your Unit are as follows:");
        Table(sb,
            ("Registered Assessment Agency", row.Text("AgencyName")),
            ("Agency SPOC Name", row.Text("SpocName")),
            ("Agency SPOC Email ID", row.Text("AgencyEmailId")),
            ("Agency SPOC Mobile No", row.Text("AgencyMobileNo")),
            ("Final Assessment Date", row.Text("FinalSaDate")),
            ("Mode of Assessment", "On-site Assessment"));
        Button(sb, portal.Value.PublicBaseUrl.TrimEnd('/') + "/Msme/Login", "Click here to Login");
        P(sb, "You will soon be contacted by the Assessor to take this forward.");
        Closing(sb);
        return sb.ToString();
    }

    private string AssessorBody(IDictionary<string, object?> row, string zedId, string role, string assessorId)
    {
        var sb = new StringBuilder();
        P(sb, "Dear Madam/Sir,");
        P(sb, "Greetings of the day!");
        P(sb, $"You have been allocated an assessment as {role} under \"MSME Sustainable (ZED) Certification\" Scheme. The details are as follows:");
        Table(sb,
            ("MSME ZED ID", zedId),
            ("Unit Name", row.Text("EnterpriseName")),
            ("Unit Address", row.Text("Address")),
            ("Mode Of Assessment", "Onsite Assessment"),
            ("Assessor ID", assessorId),
            ("Assessment Date", row.Text("FinalSaDate")));
        P(sb, "Please sign in to the Mobile App and the web module with your Assessor ID and your existing ZED password. " +
              "If you do not remember it, use \"Forgot Password\" on the login page.");
        P(sb, "Please download the Mobile Application to proceed (the same can also be downloaded directly from Google Play Store):");
        Button(sb, "https://play.google.com/store/apps/details?id=com.qci.zed.siteassessment", "Download Mobile Application");
        Closing(sb);
        return sb.ToString();
    }
}
