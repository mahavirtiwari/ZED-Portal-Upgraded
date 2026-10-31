using Microsoft.AspNetCore.Components;
using Microsoft.Extensions.Options;
using Zed.Core.Email;
using Zed.Core.Http;

namespace Zed.Portal.Features.Staff.Users;

/// <summary>
/// Sends the user-management e-mails (port of UserController.SendRegistrationMail and
/// BlockOrUnblockBronzeAssessmentMail). The legacy code read the password back from Users and
/// re-sent it on every unblock and update; here a new user's welcome mail carries a one-time link to set the password
/// (<see cref="StaffWelcomeLogin"/>; the password itself only for Master Admin and Super Admin accounts).
/// </summary>
public sealed class StaffUserMail(
    IEmailSender email,
    IHtmlTemplateRenderer templates,
    IOptions<PortalOptions> portal,
    EmailAddresses addresses,
    ILogger log)
{
    public string PublicBaseUrl => portal.Value.PublicBaseUrl;

    /// <summary>Old login address; it redirects to the new staff login.</summary>
    public string LoginUrl => PublicBaseUrl.TrimEnd('/') + "/User/Login";

    /// <summary>Renders and sends; false (logged, without the body) when sending fails.</summary>
    /// <param name="copyOffice">Copy to the office mailbox (Email Settings), as the legacy user mails did.</param>
    public async Task<bool> SendAsync<TTemplate>(string to, string subject, Dictionary<string, object?> parameters, CancellationToken ct, bool copyOffice = true)
        where TTemplate : IComponent
    {
        try
        {
            parameters["PublicBaseUrl"] = PublicBaseUrl;
            var html = await templates.RenderAsync<TTemplate>(parameters);
            var cc = copyOffice ? await addresses.CopyAsync(EmailAddresses.RegistrationCc, ct) : null;
            await email.SendAsync(new EmailMessage(to, subject, html, EmailProfiles.Login, cc), ct);
            return true;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // SMTP/rendering exceptions carry the address at most, never the body (which can hold a password).
            log.LogError(ex, "Sending the {Template} mail failed", typeof(TTemplate).Name);
            return false;
        }
    }

    /// <summary>
    /// A welcome mail: to the user only, then (when Email Settings has one) the office mailbox its own copy, with OfficeCopy
    /// set and neither the password nor the set-password link (as the MSME registration mail; the legacy mail had the
    /// office in Cc). True when the user's mail was sent. The template needs the parameters Password, SetPasswordUrl and OfficeCopy.
    /// </summary>
    public async Task<bool> SendWelcomeAsync<TTemplate>(string to, string subject, Dictionary<string, object?> parameters, CancellationToken ct)
        where TTemplate : IComponent
    {
        var sent = await SendAsync<TTemplate>(to, subject, parameters, ct, copyOffice: false);
        try
        {
            if (await addresses.GetAsync(EmailAddresses.RegistrationCc, ct) is { } office)
            {
                var copy = new Dictionary<string, object?>(parameters) { ["Password"] = null, ["SetPasswordUrl"] = null, ["OfficeCopy"] = true };
                copy["PublicBaseUrl"] = PublicBaseUrl;
                await email.SendAsync(new EmailMessage(office, subject, await templates.RenderAsync<TTemplate>(copy), EmailProfiles.Login), ct);
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "Sending the office copy of the {Template} mail failed", typeof(TTemplate).Name);
        }
        return sent;
    }
}
