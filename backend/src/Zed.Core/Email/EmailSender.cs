using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using MimeKit;

namespace Zed.Core.Email;

/// <summary>
/// The legacy code picked one of four SMTP accounts by matching the mail subject. Here the caller
/// names the profile explicitly. Profiles: Default, Registration, Otp, Allocation.
/// </summary>
public static class EmailProfiles
{
    public const string Default = "Default";
    public const string Registration = "Registration";
    public const string Otp = "Otp";
    public const string Allocation = "Allocation";
}

public sealed class EmailOptions
{
    public const string Section = "Email";

    /// <summary>When set, messages are written as .eml files here instead of being sent (local development).</summary>
    public string? PickupDirectory { get; set; }
    public Dictionary<string, SmtpProfile> Profiles { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    /// <summary>Copied on registration mails (legacy ccAddress setting).</summary>
    public string? RegistrationCc { get; set; }
    /// <summary>Mailbox that receives "Contact ZED" queries (legacy fromAddressContact setting).</summary>
    public string? ContactInbox { get; set; }
}

public sealed class SmtpProfile
{
    public string Host { get; set; } = "";
    public int Port { get; set; } = 587;
    public bool UseStartTls { get; set; } = true;
    public string From { get; set; } = "";
    public string? UserName { get; set; }
    public string? Password { get; set; }
}

public sealed record EmailAttachment(string FileName, byte[] Content, string ContentType = "application/pdf");

public sealed record EmailMessage(
    string To, string Subject, string HtmlBody,
    string Profile = EmailProfiles.Default,
    IReadOnlyList<string>? Cc = null,
    IReadOnlyList<EmailAttachment>? Attachments = null,
    IReadOnlyList<string>? Bcc = null);

public interface IEmailSender
{
    Task SendAsync(EmailMessage message, CancellationToken ct = default);
}

public sealed class SmtpEmailSender(IOptions<EmailOptions> options, ILogger<SmtpEmailSender> log) : IEmailSender
{
    public async Task SendAsync(EmailMessage message, CancellationToken ct = default)
    {
        var o = options.Value;
        var pickup = !string.IsNullOrEmpty(o.PickupDirectory);
        if (!o.Profiles.TryGetValue(message.Profile, out var profile) &&
            !o.Profiles.TryGetValue(EmailProfiles.Default, out profile))
        {
            if (!pickup) throw new InvalidOperationException($"No SMTP profile '{message.Profile}' or 'Default' configured under Email:Profiles.");
            profile = new SmtpProfile();
        }

        var from = !string.IsNullOrWhiteSpace(profile.From) ? profile.From : profile.UserName;
        if (string.IsNullOrWhiteSpace(from))
        {
            if (!pickup) throw new InvalidOperationException($"Email:Profiles:{message.Profile} has no From address.");
            from = "no-reply@localhost";
        }

        var mime = new MimeMessage();
        mime.From.Add(MailboxAddress.Parse(from));
        // Several recipients may be given separated by ; or , (as Database Mail accepted).
        foreach (var addr in message.To.Split([',', ';'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            mime.To.Add(MailboxAddress.Parse(addr));
        foreach (var cc in message.Cc ?? [])
            foreach (var addr in cc.Split([',', ';'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                mime.Cc.Add(MailboxAddress.Parse(addr));
        foreach (var bcc in message.Bcc ?? [])
            foreach (var addr in bcc.Split([',', ';'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                mime.Bcc.Add(MailboxAddress.Parse(addr));
        mime.Subject = message.Subject;

        var body = new BodyBuilder { HtmlBody = message.HtmlBody };
        foreach (var a in message.Attachments ?? [])
            body.Attachments.Add(a.FileName, a.Content, ContentType.Parse(a.ContentType));
        mime.Body = body.ToMessageBody();

        if (pickup)
        {
            Directory.CreateDirectory(o.PickupDirectory!);
            var path = Path.Combine(o.PickupDirectory!, $"{DateTime.UtcNow:yyyyMMdd-HHmmssfff}-{Guid.NewGuid():N}.eml");
            await mime.WriteToAsync(path, ct);
            log.LogInformation("Email to {To} ({Subject}) written to {Path}", message.To, message.Subject, path);
            return;
        }

        using var smtp = new SmtpClient();
        await smtp.ConnectAsync(profile.Host, profile.Port,
            profile.UseStartTls ? SecureSocketOptions.StartTls : SecureSocketOptions.Auto, ct);
        if (!string.IsNullOrEmpty(profile.UserName))
            await smtp.AuthenticateAsync(profile.UserName, profile.Password ?? "", ct);
        await smtp.SendAsync(mime, ct);
        await smtp.DisconnectAsync(true, ct);
    }
}
