using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Templates;

namespace Zed.Portal.Features.Msme;

/// <summary>
/// MSME password reset on the main portal: "Forgot password" on the MSME login and the staff "Resend Details". Links are
/// kept in dbo.V4PasswordResets as the staff reset's (migrations 0008/0009, <see cref="PasswordResetTokens"/>): only the
/// SHA-256 is stored, a link works once, for <c>MsmePasswordReset:ValidMinutes</c> (60), a newer one replaces it, and the
/// token is in the URL fragment. The legacy codes (Users.PwdCode, ForgotPwdLinks) are no longer written or accepted
/// (SECURITY-FINDINGS #128). The self-service request runs in the background, so neither the answer nor its timing tells
/// whether a ZED ID exists.
/// </summary>
public sealed class MsmePasswordResets(
    ISqlExecutor db,
    IServiceProvider services,
    IConfiguration config,
    IEmailSender email,
    IHtmlTemplateRenderer templates,
    IOptions<PortalOptions> portal,
    ILoggerFactory loggers)
{
    public const string AuditCategory = "Zed.Audit.PasswordReset";
    public const string RegistrationSubject = "Registration Details for “MSME Sustainable (ZED) Certification” Scheme – ";

    private readonly ILogger audit = loggers.CreateLogger(AuditCategory);

    private PasswordResetTokens.MsmeOptions Options => PasswordResetTokens.MsmeOptions.Read(config);

    /// <summary>"Forgot password" (background; every outcome is only written to the audit log).</summary>
    public async Task RequestAsync(string typedZedId, string? ip, CancellationToken ct)
    {
        var zedId = Clean(typedZedId);
        var account = await PasswordResetTokens.FindMsmeAccountAsync(db, zedId, ct);
        if (account is null) { Audit("no MSME account", zedId, ip); return; }
        if (!account.IsActive) { Audit("account inactive", account.ZedId, ip); return; }
        if (account.MailAddress is not { } to) { Audit("no valid e-mail address", account.ZedId, ip); return; }

        var o = Options;
        var token = PasswordResetTokens.NewToken();
        if (!await PasswordResetTokens.CreateAsync(db, account.ZedId, token, o.ValidMinutes, o.MaxRequestsPerHour, requestedBy: null, ip, ct))
        {
            Audit($"refused (more than {o.MaxRequestsPerHour} requests in an hour)", account.ZedId, ip);
            return;
        }
        await SendLinkAsync(account, to, token, "MSME Reset Password Details - " + account.ZedId, ct);
        Audit("link sent", account.ZedId, ip);
    }

    /// <summary>
    /// Staff "Resend Details": a reset link to the unit's registered e-mail, sent on behalf of <paramref name="actorId"/>
    /// (who never sees the password). Returns an error message, or null when sent.
    /// </summary>
    public async Task<string?> SendByStaffAsync(string zedId, string actorId, string? ip, CancellationToken ct)
    {
        var account = await PasswordResetTokens.FindMsmeAccountAsync(db, Clean(zedId), ct);
        if (account is null || account.MailAddress is not { } to) return "Resend Registration details failed.";
        if (!account.IsActive) return "This MSME login is inactive.";

        var token = PasswordResetTokens.NewToken();
        if (!await PasswordResetTokens.CreateAsync(db, account.ZedId, token, Options.ValidMinutes, 1, requestedBy: actorId, ip, ct))
            return "Resend Registration details failed.";
        await SendLinkAsync(account, to, token, RegistrationSubject + account.ZedId, ct);
        audit.LogInformation("MSME password reset: link sent to {ZedId} by {Actor} from {Ip}", account.ZedId, actorId, ip);
        return null;
    }

    /// <summary>Whether a link can still be used.</summary>
    public async Task<bool> IsOpenAsync(string? token, CancellationToken ct) =>
        await PasswordResetTokens.FindMsmeByTokenAsync(db, token, ct) is not null;

    /// <summary>Sets the new password through an open link; returns an error message or null.</summary>
    public async Task<string?> ResetAsync(string? token, string newPassword, string? ip, CancellationToken ct)
    {
        // Marks the link used first, so it can set a password once only.
        var account = await PasswordResetTokens.UseMsmeTokenAsync(db, token, ct);
        if (account is null) return PasswordResetTokens.InvalidLink;

        // The hash is written first (docs/PASSWORDS.md), then the plain column the old sites still read.
        var passwords = PasswordStore.For(db, services);
        await passwords.SetAsync(account.ZedId, newPassword, ct);
        await db.ExecuteSqlAsync("UPDATE Users SET Password = @Password WHERE UserId = @UserId AND RoleId = 5",
            new { Password = passwords.StoredValueFor(newPassword), UserId = account.ZedId }, ct);
        Audit("password reset", account.ZedId, ip);

        if (account.MailAddress is { } to)
        {
            try
            {
                var html = await templates.RenderAsync<PasswordChangedEmail>(new Dictionary<string, object?>
                {
                    [nameof(PasswordChangedEmail.UserName)] = account.EnterpriseName,
                    [nameof(PasswordChangedEmail.UserId)] = account.ZedId,
                    [nameof(PasswordChangedEmail.IsMsme)] = true,
                    [nameof(PasswordChangedEmail.PublicBaseUrl)] = portal.Value.PublicBaseUrl,
                });
                await email.SendAsync(new EmailMessage(to, "New Login Details - " + account.EnterpriseName, html), ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                audit.LogWarning(ex, "Password of {ZedId} reset but the confirmation mail failed", account.ZedId);
            }
        }
        return null;
    }

    private async Task SendLinkAsync(PasswordResetTokens.MsmeAccount account, string to, string token, string subject, CancellationToken ct)
    {
        var html = await templates.RenderAsync<ResetPasswordEmail>(new Dictionary<string, object?>
        {
            [nameof(ResetPasswordEmail.EnterpriseName)] = account.EnterpriseName,
            [nameof(ResetPasswordEmail.ZedId)] = account.ZedId,
            [nameof(ResetPasswordEmail.ResetUrl)] = PasswordResetTokens.MsmeResetUrl(portal.Value.PublicBaseUrl, token),
            [nameof(ResetPasswordEmail.ValidMinutes)] = Math.Clamp(Options.ValidMinutes, 1, 1440),
            [nameof(ResetPasswordEmail.PublicBaseUrl)] = portal.Value.PublicBaseUrl,
        });
        await email.SendAsync(new EmailMessage(to, subject, html), ct);
    }

    private static string Clean(string? typed)
    {
        var id = (typed ?? "").Trim();
        return id.Length is > 0 and <= 50 && !id.Any(char.IsControl) ? id : "";
    }

    private void Audit(string outcome, string zedId, string? ip) =>
        audit.LogInformation("MSME password reset request for {ZedId} from {Ip}: {Outcome}", zedId.Length == 0 ? "(invalid)" : zedId, ip, outcome);
}
