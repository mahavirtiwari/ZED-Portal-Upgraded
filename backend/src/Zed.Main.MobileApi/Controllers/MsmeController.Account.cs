using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
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
        if (user.Count == 0 || user.Int("RoleId") != MsmeRoleId || !user.ContainsKey("Password") ||
            !LegacyPasswords.MatchesStored(user, request.oldPassword))
        {
            throttle.Failed(MobileApps.Msme, userName);
            return Fail("Invalid Old Password.");
        }
        throttle.Succeeded(MobileApps.Msme, userName);

        if (PasswordPolicy.Validate(request.newPassword) is { } policyError)
            return Fail(policyError);

        var userId = user.Text("UserId") is { Length: > 0 } id ? id : userName;
        await db.ExecuteSqlAsync("UPDATE Users SET Password = @NewPassword WHERE UserId = @UserId AND RoleId = 5",
            new { NewPassword = request.newPassword, UserId = userId }, ct);
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
    /// Mails a reset link to the pledge e-mail. Same messages as before (including "no User exists"),
    /// now limited to 5 requests per ZED ID in 15 minutes on top of the procedure's own limit, with
    /// a random token instead of a GUID and a link to the new portal. Not device-bound: a user who
    /// has forgotten the password is often on a new phone.
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> ResetPassword(string? userName, CancellationToken ct)
    {
        var zedId = userName?.Trim();
        if (string.IsNullOrEmpty(zedId)) return Fail(NoUserMessage);
        if (throttle.IsLocked(ResetThrottleApp, zedId))
            return Fail("Too many reset requests. Please try again after 15 minutes.");
        throttle.Failed(ResetThrottleApp, zedId); // every request counts

        try
        {
            var msme = (await db.QueryProcMultipleAsync("SP_MSME_GET_DETAILS", new { ZedId = zedId }, ct)).FirstRow(0);
            if (msme.Count == 0) return Fail(NoUserMessage);

            var code = SecureRandom.Token();
            var sets = await db.QueryProcMultipleAsync("SP_MSME_PWD_UPDATE_TOKEN", new { UserId = zedId, PwdCode = code }, ct);
            // The procedure refuses a fourth link within 30 minutes; the old code ignored that and mailed a dead link.
            if (sets.Scalar(0)?.StartsWith("ACCOUNT LOCKED", StringComparison.OrdinalIgnoreCase) == true)
                return Fail("Too many reset requests. Please try again after 30 minutes.");

            await SendMailAsync<MsmeResetPasswordEmail>(msme.Text("PledgeEmailId"), "MSME Reset Password Details - " + zedId, new Dictionary<string, object?>
            {
                [nameof(MsmeResetPasswordEmail.EnterpriseName)] = msme.Text("EnterpriseName"),
                [nameof(MsmeResetPasswordEmail.ZedId)] = zedId,
                [nameof(MsmeResetPasswordEmail.ResetUrl)] = $"{Portal.PublicBaseUrl.TrimEnd('/')}/msme/reset-password?code={Uri.EscapeDataString(code)}",
            }, null, ct);
            return LegacyJson(new ServiceResponse { status = "1", errorMessage = ResetSentMessage });
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // As before, any failure is answered with the "no user" text; the details go to the log.
            log.LogError(ex, "App password reset for {ZedId} failed", zedId);
            return Fail(NoUserMessage);
        }
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
