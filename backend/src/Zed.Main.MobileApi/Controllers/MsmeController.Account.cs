using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Core.Mobile;
using Zed.Core.Security;
using Zed.Main.MobileApi.Models;
using Zed.Main.MobileApi.Templates;

namespace Zed.Main.MobileApi.Controllers;

/// <summary>Password change and reset, the button states and My Documents.</summary>
public sealed partial class MsmeController
{
    private const int MsmeRoleId = 5;
    private const string ResetThrottleApp = MobileApps.Msme + ":reset";
    private const string NoUserMessage = "Sorry, no User exists with these details.";
    private const string ResetSentMessage = "A Reset link has been sent your Registered Email ID.";

    /// <summary>
    /// Old: SELECT * FROM Users WHERE UserId and Password match and RoleId = 5, then an inline UPDATE,
    /// then a "New Login Details" mail with the new password in clear text. Now the old password is
    /// checked against the stored one (no procedure master passwords), wrong guesses count towards
    /// the login lock, the new password must meet the portal policy, and the mail only says that
    /// the password changed.
    /// </summary>
    [HttpPost]
    [DeviceBound(MobileApps.Msme, "userName")]
    public async Task<IActionResult> ChangePassword(ChangePwdRequest request, CancellationToken ct)
    {
        var userName = request.userName?.Trim();
        if (string.IsNullOrEmpty(userName) || string.IsNullOrEmpty(request.oldPassword))
            return Fail("Invalid Old Password.");
        if (throttle.IsLocked(MobileApps.Msme, userName))
            return Fail("Too many failed attempts. Please try again after 15 minutes.");

        var user = (await db.QueryProcMultipleAsync("SP_GET_USER_DETAILS_BY_USER_ID", new { UserId = userName }, ct)).FirstRow(0);
        var passwords = PasswordStore.For(db, HttpContext.RequestServices);
        if (user.Count == 0 || user.Int("RoleId") != MsmeRoleId || !user.ContainsKey("Password") ||
            !await passwords.VerifyCurrentAsync(userName, request.oldPassword,
                LegacyPasswords.MatchesStored(user, request.oldPassword), ct))
        {
            throttle.Failed(MobileApps.Msme, userName);
            return Fail("Invalid Old Password.");
        }
        throttle.Succeeded(MobileApps.Msme, userName);

        if (PasswordPolicy.Validate(request.newPassword) is { } policyError)
            return Fail(policyError);

        var userId = user.Text("UserId") is { Length: > 0 } id ? id : userName;
        await passwords.SetAsync(userId, request.newPassword!, ct);
        await db.ExecuteSqlAsync("UPDATE Users SET Password = @NewPassword WHERE UserId = @UserId AND RoleId = 5",
            new { NewPassword = passwords.StoredValueFor(request.newPassword!), UserId = userId }, ct);
        log.LogInformation("App password change for {UserId}", userId);

        await SendMailAsync<MsmePasswordChangedEmail>(user.Text("Email"), "New Login Details - " + userName, new Dictionary<string, object?>
        {
            [nameof(MsmePasswordChangedEmail.UserName)] = user.Text("UserName"),
            [nameof(MsmePasswordChangedEmail.UserId)] = userId,
        }, null, ct);

        // The old UpdatePassword returned the (empty) SQL error text as errorMessage.
        return LegacyJson(new ServiceResponse { status = "1", errorMessage = "" });
    }

    /// <summary>
    /// Mails a reset link to the registered e-mail. Every ZED ID gets the same answer ("A Reset link has been sent…"),
    /// sent before the lookup: the lookup, the link and the mail run in the background, so the app can no longer be used
    /// to find out which ZED IDs exist (the old "no User exists" answer did that). The link is a hashed, single-use,
    /// expiring token in dbo.V4PasswordResets (migration 0009, SECURITY-FINDINGS #128) opening the new portal's reset
    /// page. Limited to 5 requests per ZED ID in 15 minutes here and 3 per hour in the database. Not device-bound: a
    /// user who has forgotten the password is often on a new phone.
    /// </summary>
    [HttpPost]
    public IActionResult ResetPassword(string? userName)
    {
        var zedId = userName?.Trim();
        if (string.IsNullOrEmpty(zedId)) return Fail(NoUserMessage);
        if (throttle.IsLocked(ResetThrottleApp, zedId))
            return Fail("Too many reset requests. Please try again after 15 minutes.");
        throttle.Failed(ResetThrottleApp, zedId); // every request counts

        if (zedId.Length <= 50)
        {
            var ip = HttpContext.Connection.RemoteIpAddress?.ToString();
            HttpContext.RequestServices.GetRequiredService<IBackgroundWork>()
                .Enqueue("MSME app password reset request", (sp, stop) => SendResetLinkAsync(sp, zedId, ip, stop));
        }
        return LegacyJson(new ServiceResponse { status = "1", errorMessage = ResetSentMessage });
    }

    private static async Task SendResetLinkAsync(IServiceProvider sp, string zedId, string? ip, CancellationToken ct)
    {
        var audit = sp.GetRequiredService<ILoggerFactory>().CreateLogger("Zed.Audit.PasswordReset");
        void Audit(string outcome) => audit.LogInformation("MSME app password reset request for {ZedId} from {Ip}: {Outcome}", zedId, ip, outcome);

        var db = sp.GetRequiredService<ISqlExecutor>();
        var account = await PasswordResetTokens.FindMsmeAccountAsync(db, zedId, ct);
        if (account is null) { Audit("no MSME account"); return; }
        if (!account.IsActive) { Audit("account inactive"); return; }
        if (account.MailAddress is not { } to) { Audit("no valid e-mail address"); return; }

        var o = PasswordResetTokens.MsmeOptions.Read(sp.GetRequiredService<IConfiguration>());
        var token = PasswordResetTokens.NewToken();
        if (!await PasswordResetTokens.CreateAsync(db, account.ZedId, token, o.ValidMinutes, o.MaxRequestsPerHour, requestedBy: null, ip, ct))
        {
            Audit($"refused (more than {o.MaxRequestsPerHour} requests in an hour)");
            return;
        }

        var portal = sp.GetRequiredService<IOptions<PortalOptions>>().Value;
        var html = await sp.GetRequiredService<IHtmlTemplateRenderer>().RenderAsync<MsmeResetPasswordEmail>(new Dictionary<string, object?>
        {
            [nameof(MsmeResetPasswordEmail.EnterpriseName)] = account.EnterpriseName,
            [nameof(MsmeResetPasswordEmail.ZedId)] = account.ZedId,
            [nameof(MsmeResetPasswordEmail.ResetUrl)] = PasswordResetTokens.MsmeResetUrl(portal.PublicBaseUrl, token),
            [nameof(MsmeResetPasswordEmail.ValidMinutes)] = Math.Clamp(o.ValidMinutes, 1, 1440),
            [nameof(MsmeResetPasswordEmail.PublicBaseUrl)] = portal.PublicBaseUrl,
        });
        await sp.GetRequiredService<IEmailSender>().SendAsync(new EmailMessage(to, "MSME Reset Password Details - " + account.ZedId, html), ct);
        Audit("link sent");
    }

    /// <summary>SP_APP_MSME_STATUS: the button states, with the remote and surveillance fields that Login leaves out.</summary>
    [HttpPost]
    [DeviceBound(MobileApps.Msme, "userName")]
    public async Task<IActionResult> GetMsmeStatus(string? userName, string? version, CancellationToken ct)
    {
        var row = (await db.QueryProcMultipleAsync("SP_APP_MSME_STATUS", new { ZedId = userName }, ct)).FirstRow(0);
        // The procedure always returns a row; its columns are NULL for an unknown ZED ID (the old code then failed).
        if (row.Count == 0 || !row.TryGetValue("BronzeStatus", out var bronze) || bronze is null or DBNull)
            return LegacyJson(new MsmeStatus { status = "0", errorMessage = "Invalid ZED ID." });

        var status = StatusFrom(row);
        status.status = "1";
        foreach (var (level, details) in new[] { ("Bronze", status.bronze!), ("Silver", status.silver!), ("Gold", status.gold!) })
        {
            details.remoteStatus = row.Text(level + "RemoteStatus");
            details.surveillanceStatus = row.Text(level + "SurveillanceStatus");
            details.surveillanceDate = row.Text(level + "SurveillanceDate");
        }
        return LegacyJson(status);
    }

    /// <summary>SP_MSME_GET_MY_DOCUMENTS as the old DataSet JSON (Guidelines, Certificates, PaymentReceipts, Table3).</summary>
    [HttpPost]
    [DeviceBound(MobileApps.Msme, "zedId")]
    public async Task<IActionResult> GetMyDocuments(string? zedId, CancellationToken ct)
    {
        var sets = await db.QueryProcMultipleAsync("SP_MSME_GET_MY_DOCUMENTS", new { ZedId = zedId }, ct);
        return LegacyContent(LegacyResults.DataSetJson(sets, ["Guidelines", "Certificates", "PaymentReceipts"]));
    }
}
