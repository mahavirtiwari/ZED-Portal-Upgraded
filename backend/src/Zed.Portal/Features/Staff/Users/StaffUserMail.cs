using Microsoft.AspNetCore.Components;
using Microsoft.Extensions.Options;
using Zed.Core.Email;
using Zed.Core.Http;

namespace Zed.Portal.Features.Staff.Users;

/// <summary>
/// Sends the user-management e-mails (port of UserController.SendRegistrationMail and
/// BlockOrUnblockBronzeAssessmentMail). The legacy code read the password back from Users and
/// re-sent it on every unblock and update; here it is only sent once, in the welcome mail of a new user.
/// </summary>
public sealed class StaffUserMail(
    IEmailSender email,
    IHtmlTemplateRenderer templates,
    IOptions<PortalOptions> portal,
    IOptions<EmailOptions> emailOptions,
    ILogger log)
{
    public string PublicBaseUrl => portal.Value.PublicBaseUrl;

    /// <summary>Old login address; it redirects to the new staff login.</summary>
    public string LoginUrl => PublicBaseUrl.TrimEnd('/') + "/User/Login";

    /// <summary>Renders and sends; false (logged, without the body) when sending fails.</summary>
    public async Task<bool> SendAsync<TTemplate>(string to, string subject, Dictionary<string, object?> parameters, CancellationToken ct)
        where TTemplate : IComponent
    {
        try
        {
            parameters["PublicBaseUrl"] = PublicBaseUrl;
            var html = await templates.RenderAsync<TTemplate>(parameters);
            var cc = emailOptions.Value.RegistrationCc is { Length: > 0 } c ? new[] { c } : null;
            await email.SendAsync(new EmailMessage(to, subject, html, EmailProfiles.Default, cc), ct);
            return true;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // SMTP/rendering exceptions carry the address at most, never the body (which can hold a password).
            log.LogError(ex, "Sending the {Template} mail failed", typeof(TTemplate).Name);
            return false;
        }
    }
}
