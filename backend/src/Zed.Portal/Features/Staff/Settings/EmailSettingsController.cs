using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Options;
using MimeKit;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Settings;

/// <summary>
/// Admin → Email Settings (new in V4), per system in its own database:
/// <list type="bullet">
/// <item>the mail servers (SMTP) per module (<see cref="MailModules"/>; dbo.V4SmtpServers, migration 0018). A module
/// without one uses Default; without a Default, the server configuration (Email:Profiles). Passwords are stored encrypted
/// (<see cref="SmtpSecret"/>) and never sent back; a test mail goes out at once and answers with the mail server's error;</item>
/// <item>the office mailboxes this system's mails go to (<see cref="EmailAddresses"/>; dbo.V4Settings, migration 0011).
/// An empty value goes back to the server configuration, shown as the default.</item>
/// </list>
/// The pickup folder and the test server rule (Email:RedirectAllTo) stay in the server configuration and are only shown.
/// </summary>
[Route("api/staff/settings/email")]
[StaffRoles(UserRole.Admin)]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed class EmailSettingsController(
    IPortalSettings settings, EmailAddresses addresses, PortalHost host, IOptions<EmailOptions> email, ISmtpServers servers,
    IEmailSender sender, ILogger<EmailSettingsController> log)
    : StaffApiController
{
    public sealed record EmailSettingItem(string Key, string Label, string Help, bool Database, string? Value, string? Default);

    public sealed record EmailSettingsRequest(Dictionary<string, string?>? Values);

    /// <summary>A mail server as shown: only whether a password is set, never the password.</summary>
    public sealed record SmtpServerView(string Host, int Port, bool StartTls, string? From, string? UserName, bool PasswordSet,
        string? UpdatedBy = null, DateTime? UpdatedOn = null);

    /// <summary>
    /// A module: the server the Admin saved for it (<see cref="Saved"/>), the server configuration's profile of the same
    /// name (<see cref="Configured"/>), and which one its mails use: "Module", "Default" (the Admin's Default),
    /// "ServerFile", "ServerFileDefault" or "None".
    /// </summary>
    public sealed record MailModuleView(string Key, string Label, string Help, SmtpServerView? Saved, SmtpServerView? Configured, string Uses);

    public sealed record MailServerInfo(IReadOnlyList<MailModuleView> Modules, string? PickupDirectory, string? RedirectAllTo, string? AllowedRecipientDomains);

    /// <summary>
    /// <see cref="Password"/>: empty keeps the saved password; <see cref="ClearPassword"/> removes it (a server without sign-in).
    /// </summary>
    public sealed record SmtpServerRequest(string? Host, int? Port, bool? StartTls, string? From, string? UserName, string? Password, bool ClearPassword);

    public sealed record TestMailRequest(string? To, string? Module);

    private const string MigrationHint = "Please ask the administrator to apply database migration 0018.";

    /// <summary>How long the test mail may wait for the mail server.</summary>
    internal static readonly TimeSpan TestTimeout = TimeSpan.FromSeconds(30);

    private IEnumerable<EmailAddressSetting> Mine => EmailAddresses.All.Where(s => s.Systems.Contains(host.System));

    [HttpGet]
    public async Task<IReadOnlyList<EmailSettingItem>> Get(CancellationToken ct)
    {
        var items = new List<EmailSettingItem>();
        foreach (var s in Mine)
            items.Add(new(s.Key, s.Label, s.Help, s.Database, await settings.GetAsync(s.Key, ct), addresses.Default(s.Key)));
        return items;
    }

    [HttpPut]
    public async Task<IActionResult> Save(EmailSettingsRequest req, CancellationToken ct)
    {
        var mine = Mine.ToDictionary(s => s.Key, StringComparer.Ordinal);
        if (req.Values is not { Count: > 0 } values || values.Keys.Any(k => !mine.ContainsKey(k)))
            return this.Problem400("Please enter the e-mail addresses.");

        var changes = new List<(string Key, string? Value)>();
        foreach (var (key, raw) in values)
        {
            var (value, error) = EmailAddresses.Normalise(raw);
            if (error is not null) return this.Problem400($"{mine[key].Label}: {error}");
            if (value != await settings.GetAsync(key, ct)) changes.Add((key, value));
        }
        try
        {
            foreach (var (key, value) in changes)
            {
                await settings.SetAsync(key, value, UserId, ct);
                log.LogInformation("Email setting {Key} {Action} by {UserId}", key, value is null ? "reset to the configuration" : "set", UserId);
            }
        }
        catch (SqlException ex)
        {
            log.LogError(ex, "Could not save the email settings (is migration 0011 applied?)");
            return this.Problem400("The settings could not be saved. Please ask the administrator to apply database migration 0011.");
        }
        return Ok(new MessageResponse("Email settings saved."));
    }

    [HttpGet("servers")]
    public async Task<MailServerInfo> Servers(CancellationToken ct)
    {
        var o = email.Value;
        var rows = await servers.ListAsync(ct);
        SmtpServerRow? Row(string key) => rows.FirstOrDefault(r => r.Module.Equals(key, StringComparison.OrdinalIgnoreCase));
        SmtpProfile? Configured(string key) => o.Profiles.TryGetValue(key, out var p) && !string.IsNullOrWhiteSpace(p.Host) ? p : null;
        var savedDefault = Row(EmailProfiles.Default) is not null;

        var modules = MailModules.All.Select(m =>
        {
            var row = Row(m.Key);
            var configured = Configured(m.Key);
            var uses = row is not null ? "Module"
                : savedDefault ? "Default"
                : configured is not null ? "ServerFile"
                : Configured(EmailProfiles.Default) is not null ? "ServerFileDefault"
                : "None";
            return new MailModuleView(m.Key, m.Label, m.Help,
                row is null ? null : new SmtpServerView(row.Host, row.Port, row.UseStartTls, row.FromAddress, row.UserName,
                    !string.IsNullOrEmpty(row.PasswordProtected), row.UpdatedBy, row.UpdatedOn),
                configured is null ? null : new SmtpServerView(configured.Host, configured.Port, configured.UseStartTls, Blank(configured.From),
                    Blank(configured.UserName), !string.IsNullOrEmpty(configured.Password)),
                uses);
        }).ToList();
        return new(modules, Blank(o.PickupDirectory), Blank(o.RedirectAllTo), Blank(o.AllowedRecipientDomains));
    }

    [HttpPut("servers/{module}")]
    public async Task<IActionResult> SaveServer(string module, SmtpServerRequest req, CancellationToken ct)
    {
        if (MailModules.Find(module) is not { } m) return this.Problem400("Unknown module.");
        var hostName = (req.Host ?? "").Trim();
        var from = (req.From ?? "").Trim();
        var userName = string.IsNullOrWhiteSpace(req.UserName) ? null : req.UserName.Trim();
        var port = req.Port ?? 587;
        if (hostName.Length == 0) return this.Problem400($"{m.Label}: please enter the mail server (host name).");
        if (hostName.Length > 255 || hostName.Contains(' ') || hostName.Contains("://", StringComparison.Ordinal) || hostName.Contains('/'))
            return this.Problem400($"{m.Label}: enter the host name only, e.g. smtp.office365.com.");
        if (port is < 1 or > 65535) return this.Problem400($"{m.Label}: the port must be between 1 and 65535.");
        if (from.Length == 0) return this.Problem400($"{m.Label}: please enter the From address.");
        if (from.Length > 320 || !MailboxAddress.TryParse(from, out var parsed) || !parsed.Address.Contains('@'))
            return this.Problem400($"{m.Label}: '{from}' is not a valid From address (e.g. ZED <noreply@example.org> or noreply@example.org).");
        if (userName is { Length: > 320 }) return this.Problem400($"{m.Label}: the sign-in name is too long.");
        if (req.Password is { Length: > 256 }) return this.Problem400($"{m.Label}: the password is too long.");

        var newPassword = req.ClearPassword ? "" : string.IsNullOrEmpty(req.Password) ? null : req.Password;
        try
        {
            await servers.SaveAsync(new SmtpServerRow(m.Key, hostName, port, req.StartTls ?? true, from, userName, null), newPassword, UserId, ct);
        }
        catch (SqlException ex)
        {
            log.LogError(ex, "Could not save the mail server of {Module} (is migration 0018 applied?)", m.Key);
            return this.Problem400("The mail server could not be saved. " + MigrationHint);
        }
        catch (PlatformNotSupportedException ex)
        {
            return this.Problem400(ex.Message);
        }
        log.LogInformation("Mail server of {Module} set to {Host}:{Port} by {UserId} (password {Password})", m.Key, hostName, port, UserId,
            newPassword is null ? "kept" : newPassword.Length == 0 ? "removed" : "changed");
        return Ok(new MessageResponse($"{m.Label}: mail server saved."));
    }

    [HttpDelete("servers/{module}")]
    public async Task<IActionResult> ClearServer(string module, CancellationToken ct)
    {
        if (MailModules.Find(module) is not { } m) return this.Problem400("Unknown module.");
        try
        {
            await servers.DeleteAsync(m.Key, ct);
        }
        catch (SqlException ex)
        {
            log.LogError(ex, "Could not clear the mail server of {Module} (is migration 0018 applied?)", m.Key);
            return this.Problem400("The mail server could not be cleared. " + MigrationHint);
        }
        log.LogInformation("Mail server of {Module} cleared by {UserId}", m.Key, UserId);
        var then = m.Key == EmailProfiles.Default ? "the server configuration" : "Default";
        return Ok(new MessageResponse($"{m.Label}: mail server cleared; its mails use {then}."));
    }

    /// <summary>
    /// Sends a short mail through the mail server of a module now (not in the background, as the portal's own mails are)
    /// and answers with the mail server's error when it fails.
    /// </summary>
    [HttpPost("test")]
    public async Task<IActionResult> Test(TestMailRequest req, CancellationToken ct)
    {
        var module = string.IsNullOrWhiteSpace(req.Module) ? MailModules.Find(EmailProfiles.Default) : MailModules.Find(req.Module);
        if (module is null) return this.Problem400("Unknown module.");
        var (to, error) = EmailAddresses.Normalise(req.To);
        if (error is not null) return this.Problem400(error);
        if (to is null) return this.Problem400("Please enter the address to send the test mail to.");

        var o = email.Value;
        var body = $"<p>This is a test mail from the ZED portal ({host.System}), module {System.Net.WebUtility.HtmlEncode(module.Label)}, " +
                   $"sent from Admin → Email Settings at {DateTimeOffset.Now.ToString("dd MMM yyyy HH:mm:ss zzz", System.Globalization.CultureInfo.InvariantCulture)}.</p>" +
                   "<p>If you can read this, the mail server of this module works.</p>";
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TestTimeout);
        try
        {
            await sender.SendAsync(new EmailMessage(to, $"ZED portal: test mail ({module.Label})", body, module.Key), timeout.Token);
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            log.LogWarning(ex, "Test mail of {Module} to {To} by {UserId} failed", module.Key, to, UserId);
            var reason = ex is OperationCanceledException
                ? $"the mail server did not answer within {TestTimeout.TotalSeconds:0} seconds"
                : ex.InnerException is { } inner && !ex.Message.Contains(inner.Message, StringComparison.Ordinal) ? $"{ex.Message} ({inner.Message})" : ex.Message;
            return this.Problem400($"The test mail could not be sent: {reason}");
        }
        log.LogInformation("Test mail of {Module} to {To} sent by {UserId}", module.Key, to, UserId);
        var message = !string.IsNullOrWhiteSpace(o.PickupDirectory)
            ? $"Test mail written to the folder {o.PickupDirectory} on the server (a pickup folder is set, so mails are not sent)."
            : !string.IsNullOrWhiteSpace(o.RedirectAllTo) && string.IsNullOrWhiteSpace(o.AllowedRecipientDomains)
                ? $"Test mail sent. On this server every mail goes to {o.RedirectAllTo}, so look for it there."
                : $"Test mail sent to {to}.";
        return Ok(new MessageResponse(message));
    }

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value;
}
