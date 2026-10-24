using MailKit.Net.Smtp;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
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

    /// <summary>
    /// Not for Production (staging on a copy of production data): every message goes to these addresses (comma or
    /// semicolon separated) instead of its recipients, with the original recipients at the top of the body and in
    /// X-Zed-Original-To/-Cc/-Bcc headers. With <see cref="AllowedRecipientDomains"/> also set, it only receives the
    /// messages that have no allowed recipient left.
    /// </summary>
    public string? RedirectAllTo { get; set; }

    /// <summary>
    /// Not for Production: recipients outside these domains (comma separated, sub-domains included) are dropped and
    /// logged; the others still get the message. A message with nobody left goes to <see cref="RedirectAllTo"/>, or is
    /// skipped.
    /// </summary>
    public string? AllowedRecipientDomains { get; set; }
}

/// <summary>The staging mail rule (<see cref="EmailOptions.RedirectAllTo"/>, <see cref="EmailOptions.AllowedRecipientDomains"/>), checked at startup.</summary>
public static class MailSafety
{
    public const string RedirectSetting = "Email:RedirectAllTo";
    public const string DomainsSetting = "Email:AllowedRecipientDomains";
    public const string EnvironmentLabelSetting = "Portal:EnvironmentLabel";

    /// <summary>
    /// Development: no rule. Production: neither setting may be set (nor an environment label), so a staging setting never
    /// reaches the live site. Any other environment (Staging, …) runs on copies of production data, so it must not mail
    /// real people: one of the two settings, or a mail pickup folder, is required.
    /// </summary>
    public static IReadOnlyList<string> Problems(IConfiguration config, IHostEnvironment env)
    {
        var problems = new List<string>();
        if (env.IsDevelopment()) return problems;
        var redirect = config[RedirectSetting];
        var domains = config[DomainsSetting];
        if (env.IsProduction())
        {
            if (!string.IsNullOrWhiteSpace(redirect)) problems.Add($"{RedirectSetting} is set: in Production mail must reach its recipients");
            if (!string.IsNullOrWhiteSpace(domains)) problems.Add($"{DomainsSetting} is set: in Production mail must reach its recipients");
            if (!string.IsNullOrWhiteSpace(config[EnvironmentLabelSetting])) problems.Add($"{EnvironmentLabelSetting} is set: the live site must not be labelled as a test environment");
        }
        else if (string.IsNullOrWhiteSpace(redirect) && string.IsNullOrWhiteSpace(domains) && string.IsNullOrWhiteSpace(config["Email:PickupDirectory"]))
        {
            problems.Add($"{RedirectSetting} or {DomainsSetting} (or Email:PickupDirectory) must be set in {env.EnvironmentName}: " +
                "this environment runs on copies of production data and must not mail real people");
        }
        foreach (var addr in Addresses(redirect))
            if (!MailboxAddress.TryParse(addr, out _)) problems.Add($"{RedirectSetting}: '{addr}' is not an e-mail address");
        return problems;
    }

    internal static IEnumerable<string> Addresses(string? list) =>
        (list ?? "").Split([',', ';'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    internal static bool InDomains(string address, IReadOnlyList<string> domains)
    {
        var at = address.LastIndexOf('@');
        if (at < 0) return false;
        var domain = address[(at + 1)..].Trim().TrimEnd('>').ToLowerInvariant();
        return domains.Any(d => domain == d || domain.EndsWith("." + d, StringComparison.Ordinal));
    }
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

public sealed class SmtpEmailSender(IOptions<EmailOptions> options, ILogger<SmtpEmailSender> log, IConfiguration? config = null) : IEmailSender
{
    public async Task SendAsync(EmailMessage message, CancellationToken ct = default)
    {
        var o = options.Value;
        var routed = Route(message, o);
        if (routed is null) return;
        message = routed.Message;
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

        foreach (var (name, value) in routed.Headers) mime.Headers.Add(name, value);

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

    private sealed record Routed(EmailMessage Message, IReadOnlyList<KeyValuePair<string, string>> Headers);

    /// <summary>
    /// Applies <see cref="EmailOptions.RedirectAllTo"/> and <see cref="EmailOptions.AllowedRecipientDomains"/> (staging);
    /// null when nobody is left to receive the message. Without either setting the message is unchanged.
    /// </summary>
    private Routed? Route(EmailMessage message, EmailOptions o)
    {
        var redirect = MailSafety.Addresses(o.RedirectAllTo).ToList();
        var domains = MailSafety.Addresses(o.AllowedRecipientDomains).Select(d => d.TrimStart('@', '.').ToLowerInvariant()).ToList();
        if (redirect.Count == 0 && domains.Count == 0) return new(message, []);

        static List<string> Split(IEnumerable<string>? lists) =>
            (lists ?? []).SelectMany(MailSafety.Addresses).ToList();
        var to = Split([message.To]);
        var cc = Split(message.Cc);
        var bcc = Split(message.Bcc);

        string? newTo = null;
        IReadOnlyList<string>? newCc = null, newBcc = null;
        string mode;
        if (domains.Count > 0)
        {
            var keptTo = to.Where(a => MailSafety.InDomains(a, domains)).ToList();
            var keptCc = cc.Where(a => MailSafety.InDomains(a, domains)).ToList();
            var keptBcc = bcc.Where(a => MailSafety.InDomains(a, domains)).ToList();
            var dropped = to.Concat(cc).Concat(bcc).Where(a => !MailSafety.InDomains(a, domains)).ToList();
            if (dropped.Count > 0)
                log.LogInformation("Staging mail rule: '{Subject}' not delivered to {Count} recipient(s) outside {Domains}", message.Subject, dropped.Count, o.AllowedRecipientDomains);
            if (keptTo.Count + keptCc.Count + keptBcc.Count > 0)
            {
                if (dropped.Count == 0 && redirect.Count == 0)
                    return new(message with { Subject = Prefix(message.Subject) }, []);
                // Somebody allowed is left: they get it; the dropped addresses are named at the top.
                newTo = keptTo.Count > 0 ? string.Join(";", keptTo) : string.Join(";", keptCc.Concat(keptBcc));
                newCc = keptTo.Count > 0 ? keptCc : [];
                newBcc = keptTo.Count > 0 ? keptBcc : [];
                mode = "delivered only to the allowed domains";
            }
            else if (redirect.Count > 0)
            {
                newTo = string.Join(";", redirect);
                mode = "redirected (no recipient in the allowed domains)";
            }
            else
            {
                log.LogInformation("Staging mail rule: '{Subject}' skipped, no recipient in {Domains}", message.Subject, o.AllowedRecipientDomains);
                return null;
            }
        }
        else
        {
            newTo = string.Join(";", redirect);
            mode = "redirected";
        }

        var note = "<div style=\"border:2px solid #c00;padding:8px;margin-bottom:12px;font-family:Arial,sans-serif;font-size:12px\">" +
                   $"<b>Test environment: this message was {System.Net.WebUtility.HtmlEncode(mode)}.</b><br>" +
                   $"Original To: {System.Net.WebUtility.HtmlEncode(string.Join(", ", to))}" +
                   (cc.Count > 0 ? $"<br>Original Cc: {System.Net.WebUtility.HtmlEncode(string.Join(", ", cc))}" : "") +
                   (bcc.Count > 0 ? $"<br>Original Bcc: {System.Net.WebUtility.HtmlEncode(string.Join(", ", bcc))}" : "") +
                   "</div>";
        var headers = new List<KeyValuePair<string, string>> { new("X-Zed-Original-To", string.Join(", ", to)) };
        if (cc.Count > 0) headers.Add(new("X-Zed-Original-Cc", string.Join(", ", cc)));
        if (bcc.Count > 0) headers.Add(new("X-Zed-Original-Bcc", string.Join(", ", bcc)));
        return new(message with
        {
            To = newTo!,
            Cc = newCc ?? [],
            Bcc = newBcc ?? [],
            Subject = Prefix(message.Subject),
            HtmlBody = note + message.HtmlBody,
        }, headers);
    }

    /// <summary>"[LABEL] " before the subject while the staging rule is active and Portal:EnvironmentLabel is set; without a label the subject is unchanged.</summary>
    private string Prefix(string subject)
    {
        var label = config?[MailSafety.EnvironmentLabelSetting];
        if (string.IsNullOrWhiteSpace(label)) return subject;
        var prefix = "[" + label.Trim() + "] ";
        return subject.StartsWith(prefix, StringComparison.Ordinal) ? subject : prefix + subject;
    }
}
