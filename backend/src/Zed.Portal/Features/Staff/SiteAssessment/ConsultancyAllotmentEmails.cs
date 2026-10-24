using Microsoft.AspNetCore.Components;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Portal.Features.Staff.Assessment;
using Zed.Portal.Templates;

namespace Zed.Portal.Features.Staff.SiteAssessment;

/// <summary>
/// Mails of the handholding allotment (consultancy AssessmentController.SendMail "AcceptUnitForSa" Onsite branch and
/// "RejectUnitForSa"): on acceptance the unit, the lead consultant and every co-consultant (second result set of the
/// consultancy SP_EMAIL_GET_DETAILS, rows of AllotedCoAssessors), subject "Allocation of Handholding Support
/// (Milestone n) ..."; on rejection the ZED team. Every mail is copied to Email:RegistrationCc as before (the old
/// ccAddress). Technical experts got no mail before and get none now. No passwords: the old consultant mails
/// contained Users.Password / CoAssessorPassword.
/// </summary>
public sealed class ConsultancyAllotmentEmails(
    ISqlExecutor db,
    IEmailSender email,
    IHtmlTemplateRenderer templates,
    IOptions<PortalOptions> portal,
    EmailAddresses addresses,
    ILogger<ConsultancyAllotmentEmails> log)
{
    private const string Scheme = "“MSME Sustainable (ZED) Certification” Scheme";

    public static ConsultancyAllotmentEmails Create(IServiceProvider sp) => ActivatorUtilities.CreateInstance<ConsultancyAllotmentEmails>(sp);

    public async Task SendAllottedAsync(string zedId, string certification, CancellationToken ct)
    {
        try
        {
            var sets = await db.QueryProcMultipleAsync("SP_EMAIL_GET_DETAILS", new { ZedId = zedId, Certification = certification }, ct);
            var row = sets[0].FirstOrDefault();
            if (row is null)
            {
                log.LogWarning("No e-mail details for {ZedId} {Certification}; handholding allotment mails not sent", zedId, certification);
                return;
            }
            var milestone = row.Text("NcCount");
            var subject = $"Allocation of Handholding Support (Milestone {milestone}) under {Scheme} - {zedId}";

            Dictionary<string, object?> Dates() => new()
            {
                ["BdsFromDate"] = row.Text("BdsFromDate"),
                ["BdsToDate"] = row.Text("BdsToDate"),
                ["HapFromDate"] = row.Text("HapFromDate"),
                ["HapToDate"] = row.Text("HapToDate"),
                ["Milestone"] = milestone,
            };

            var unit = Dates();
            unit[nameof(ConsultancyCoAllotmentUnitEmail.AgencyName)] = row.Text("AgencyName");
            unit[nameof(ConsultancyCoAllotmentUnitEmail.SpocName)] = row.Text("SpocName");
            unit[nameof(ConsultancyCoAllotmentUnitEmail.AgencyEmail)] = row.Text("AgencyEmailId");
            unit[nameof(ConsultancyCoAllotmentUnitEmail.AgencyMobileNo)] = row.Text("AgencyMobileNo");
            // The MSME side of handholding is on main: its sign-in page at the host's origin.
            unit[nameof(ConsultancyCoAllotmentUnitEmail.LoginUrl)] = Origin + "/Msme/Login";
            await SendAsync<ConsultancyCoAllotmentUnitEmail>(row.Text("EmailId"), subject, unit, ct);

            async Task Consultant(string to, string role, string id)
            {
                if (id.Length == 0) return;
                var p = Dates();
                p[nameof(ConsultancyCoAllotmentConsultantEmail.Role)] = role;
                p[nameof(ConsultancyCoAllotmentConsultantEmail.ZedId)] = zedId;
                p[nameof(ConsultancyCoAllotmentConsultantEmail.UnitName)] = row.Text("EnterpriseName");
                p[nameof(ConsultancyCoAllotmentConsultantEmail.UnitAddress)] = row.Text("Address");
                p[nameof(ConsultancyCoAllotmentConsultantEmail.ConsultantId)] = id;
                await SendAsync<ConsultancyCoAllotmentConsultantEmail>(to, subject, p, ct);
            }

            await Consultant(row.Text("AssessorEmailId"), "Lead Consultant", row.Text("AssessorUserId"));
            foreach (var co in sets[1].DistinctBy(r => r.Text("CoAssessorUserId").ToUpperInvariant()))
                await Consultant(co.Text("CoAssessorEmailId"), "Co-consultant", co.Text("CoAssessorUserId"));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // The allotment is saved; the mails are notifications only.
            log.LogWarning(ex, "Handholding allotted for {ZedId} {Certification} but a notification mail failed", zedId, certification);
        }
    }

    public async Task SendRejectedAsync(string zedId, string certification, string agencyUserId, string milestone, string reason, CancellationToken ct)
    {
        try
        {
            var row = (await db.QueryProcMultipleAsync("SP_EMAIL_GET_DETAILS", new { ZedId = zedId, Certification = certification }, ct))[0].FirstOrDefault();
            await SendAsync<ConsultancyCoAllotmentRejectionEmail>(await addresses.GetAsync(EmailAddresses.ZedTeamInbox, ct) ?? EmailAddresses.LegacyTeamInbox,
                $"Rejection by Consultant Organization under {Scheme} - {zedId}", new()
                {
                    [nameof(ConsultancyCoAllotmentRejectionEmail.ZedId)] = zedId,
                    [nameof(ConsultancyCoAllotmentRejectionEmail.UnitName)] = row?.Text("EnterpriseName"),
                    [nameof(ConsultancyCoAllotmentRejectionEmail.Milestone)] = milestone,
                    [nameof(ConsultancyCoAllotmentRejectionEmail.AgencyName)] = row?.Text("AgencyName"),
                    [nameof(ConsultancyCoAllotmentRejectionEmail.AgencyUserId)] = row?.Text("AgencyUserId") is { Length: > 0 } a ? a : agencyUserId,
                    [nameof(ConsultancyCoAllotmentRejectionEmail.Reason)] = reason,
                }, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Handholding of {ZedId} {Certification} rejected but the notification mail failed", zedId, certification);
        }
    }

    /// <summary>Scheme and host of the public address (the consultancy portal may run under a sub-path of main's host).</summary>
    private string Origin =>
        Uri.TryCreate(portal.Value.PublicBaseUrl, UriKind.Absolute, out var u) ? u.GetLeftPart(UriPartial.Authority) : portal.Value.PublicBaseUrl.TrimEnd('/');

    private async Task SendAsync<TTemplate>(string to, string subject, Dictionary<string, object?> parameters, CancellationToken ct)
        where TTemplate : IComponent
    {
        if (string.IsNullOrWhiteSpace(to)) return;
        parameters["PublicBaseUrl"] = portal.Value.PublicBaseUrl;
        var html = await templates.RenderAsync<TTemplate>(parameters);
        var cc = await addresses.CopyAsync(EmailAddresses.RegistrationCc, ct);
        await email.SendAsync(new EmailMessage(to.Trim(), subject, html, EmailProfiles.Allocation, cc), ct);
    }
}
