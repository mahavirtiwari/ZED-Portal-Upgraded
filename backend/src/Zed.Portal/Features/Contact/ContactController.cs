using System.ComponentModel.DataAnnotations;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Templates;

namespace Zed.Portal.Features.Contact;

/// <summary>"Contact ZED" form. Port of HomeController.Contact (SP_INSERT_QUERY + mail to the ZED inbox).</summary>
[ApiController]
[Route("api/contact")]
[AllowAnonymous]
public sealed partial class ContactController(
    ISqlExecutor db,
    ICaptchaVerifier captcha,
    IEmailSender email,
    IHtmlTemplateRenderer templates,
    IOptions<EmailOptions> emailOptions,
    ILogger<ContactController> log) : ControllerBase
{
    [GeneratedRegex(@"^\d{10}$")] private static partial Regex MobilePattern();

    public sealed record ContactRequest(string Name, string Mobile, string Email, string Query, string? CaptchaToken);

    [HttpPost]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<ActionResult<MessageResponse>> Submit(ContactRequest req, CancellationToken ct)
    {
        var name = req.Name?.Trim() ?? "";
        var mobile = req.Mobile?.Trim() ?? "";
        var mail = req.Email?.Trim() ?? "";
        var query = req.Query?.Trim() ?? "";
        if (name.Length == 0 || mobile.Length == 0 || mail.Length == 0 || query.Length == 0)
            return this.Problem400("Please enter all the required data.");
        if (name.Length > 200 || !MobilePattern().IsMatch(mobile) || mail.Length > 200 || !new EmailAddressAttribute().IsValid(mail) || query.Length > 4000)
            return this.Problem400("Please enter valid data.");
        if (!await captcha.VerifyAsync(req.CaptchaToken, HttpContext.Connection.RemoteIpAddress?.ToString(), ct))
            return this.Problem400("Invalid Captcha.");

        await db.ExecuteProcAsync("SP_INSERT_QUERY", new { Name = name, MobileNumber = mobile, Email = mail, Query = query }, ct);

        if (emailOptions.Value.ContactInbox is { Length: > 0 } inbox)
        {
            var html = await templates.RenderAsync<ContactQueryEmail>(new Dictionary<string, object?>
            {
                [nameof(ContactQueryEmail.Name)] = name,
                [nameof(ContactQueryEmail.Mobile)] = mobile,
                [nameof(ContactQueryEmail.Email)] = mail,
                [nameof(ContactQueryEmail.Query)] = query,
                [nameof(ContactQueryEmail.ZedId)] = ZedUser.FromPrincipal(User)?.UserId,
            });
            try { await email.SendAsync(new EmailMessage(inbox, "ZED Query from " + name, html), ct); }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // The query is stored; the mail is a notification only.
                log.LogWarning(ex, "Contact query stored but notification mail failed");
            }
        }
        else
        {
            log.LogWarning("Email:ContactInbox is not configured; contact query stored without notification mail.");
        }
        return new MessageResponse("Your Query submitted.");
    }
}
