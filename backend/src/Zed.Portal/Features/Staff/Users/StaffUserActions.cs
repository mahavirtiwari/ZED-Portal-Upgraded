using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Templates;

namespace Zed.Portal.Features.Staff.Users;

/// <summary>
/// Block / unblock / mobile number change, shared by agencies and assessors. Callers have already checked who may act on the
/// user. Block and unblock end the user's sessions (<see cref="SessionStamps"/>).
/// </summary>
internal static class StaffUserActions
{
    private static int? RoleOf(ManagedUser user) => int.TryParse(user.Row.Text("RoleId"), out var r) ? r : null;

    private static int? ActorRole(ControllerBase c) => ZedUser.FromPrincipal(c.User)?.RoleId;

    /// <summary>Who acts, for the history: the signed-in login, or its sub-user as "owner / sub-user" (<see cref="UserBlockHistory.ActorOf"/>).</summary>
    internal static string HistoryActor(ControllerBase c, string fallback) => UserBlockHistory.ActorOf(ZedUser.FromPrincipal(c.User), fallback);

    /// <summary>
    /// 2026-11-21 (the product owner: profile edits in the History): an account created (<see cref="UserBlockHistory.Created"/>) or a
    /// profile saved (<see cref="UserBlockHistory.Edited"/>, nothing when nothing changed), with its change list, by the signed-in user.
    /// A failed write is a warning only.
    /// </summary>
    public static Task RecordChangesAsync(ControllerBase c, ISqlExecutor db, string userId, int? roleId, string action, AccountProfile? before,
        AccountProfile after, ILogger log, CancellationToken ct) =>
        UserBlockHistory.RecordChangesAsync(db, userId.Trim(), roleId, action, before, after, HistoryActor(c, ZedUser.FromPrincipal(c.User)?.UserId ?? ""),
            ActorRole(c), log, ct);

    /// <summary>
    /// A profile for the history built with reads of its own (names of codes, lists in other tables): null when one fails (a warning),
    /// so the history is skipped and the user's action goes on.
    /// </summary>
    public static async Task<AccountProfile?> HistoryProfileAsync(Func<Task<AccountProfile>> build, string userId, ILogger log)
    {
        try
        {
            return await build();
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "The profile of {UserId} was not read for its history", userId);
            return null;
        }
    }

    /// <summary>
    /// SP_BLOCK_UNBLOCK_USER on Main (Users.IsActive and ReasonForRejection, in ZEDCS and ZED_SURVEILLANCE). On Consultancy,
    /// whose database has no such procedure, the legacy inline UPDATE (<see cref="ConsultancyUsers.SetActiveAsync"/>) and,
    /// as the old UserController.Block did, a "blocked" mail to the user.
    /// </summary>
    public static async Task<ActionResult<MessageResponse>> BlockAsync(
        ControllerBase c, ISqlExecutor db, PortalHost host, StaffUserMail mail, ManagedUser user, string reason, string actor, ILogger log, CancellationToken ct)
    {
        if (!user.IsActive) return c.Problem400("This user is already blocked.");
        if (!await SetActiveAsync(db, host, user, false, reason, ct))
            return c.Problem400("The user could not be blocked. Please try again.");
        log.LogInformation("User {UserId} blocked by {Actor}", user.UserId, actor);
        await UserBlockHistory.RecordAsync(db, user.UserId, RoleOf(user), UserBlockHistory.Blocked, reason, HistoryActor(c, actor), ActorRole(c), log, ct);
        // M12: the user's open sessions end too (on main also those of the Surveillance portal, which the procedure blocks as well).
        await SessionStamps.EndSessionsAsync(db, host.System, user.UserId, log, ct);

        // 2026-11-08: on every portal (before, Consultancy only; an unblock was mailed everywhere).
        if (StaffUserRules.IsEmail(user.Row.Text("Email")))
        {
            var organisation = user.Row.Text("RoleId") == "2";
            var who = host.IsConsultancy() ? (organisation ? "Consultant Organisation" : "Consultant/Expert") : (organisation ? "Assessment Agency" : "Assessor");
            await mail.SendAsync<StaffAccountBlockedEmail>(user.Row.Text("Email"),
                who + " Login Details for “MSME Sustainable (ZED) Certification” - " + user.UserId, new()
                {
                    [nameof(StaffAccountBlockedEmail.UserName)] = user.Row.Text("UserName"),
                    [nameof(StaffAccountBlockedEmail.UserId)] = user.UserId,
                    [nameof(StaffAccountBlockedEmail.IsOrganisation)] = organisation,
                    [nameof(StaffAccountBlockedEmail.Consultancy)] = host.IsConsultancy(),
                    [nameof(StaffAccountBlockedEmail.Reason)] = reason,
                }, ct);
        }
        return new MessageResponse("User Blocked successful");
    }

    /// <summary>2026-11-16 (the user): an unblock asks for its reason too; it is recorded and mailed to the user.</summary>
    public static async Task<ActionResult<MessageResponse>> UnblockAsync(
        ControllerBase c, ISqlExecutor db, PortalHost host, StaffUserMail mail, ManagedUser user, string reason, string actor, ILogger log, CancellationToken ct)
    {
        if (user.IsActive) return c.Problem400("This user is not blocked.");
        if (!await SetActiveAsync(db, host, user, true, "", ct))
            return c.Problem400("The user could not be unblocked. Please try again.");
        log.LogInformation("User {UserId} unblocked by {Actor}", user.UserId, actor);
        await UserBlockHistory.RecordAsync(db, user.UserId, RoleOf(user), UserBlockHistory.Unblocked, reason, HistoryActor(c, actor), ActorRole(c), log, ct);
        await SessionStamps.EndSessionsAsync(db, host.System, user.UserId, log, ct);

        if (StaffUserRules.IsEmail(user.Row.Text("Email")))
            await mail.SendAsync<StaffAccountUnblockedEmail>(user.Row.Text("Email"),
                "“MSME Sustainable (ZED) Certification” - Account Unblocked - " + user.UserId, new()
                {
                    [nameof(StaffAccountUnblockedEmail.UserName)] = user.Row.Text("UserName"),
                    [nameof(StaffAccountUnblockedEmail.UserId)] = user.UserId,
                    [nameof(StaffAccountUnblockedEmail.LoginUrl)] = mail.LoginUrl,
                    [nameof(StaffAccountUnblockedEmail.Consultancy)] = host.IsConsultancy(),
                    [nameof(StaffAccountUnblockedEmail.Reason)] = reason,
                }, ct);
        return new MessageResponse("User UnBlocked successful");
    }

    /// <summary>The reason of a block or an unblock (required, up to 2000 characters), or the message that refuses it.</summary>
    public static string? ReasonError(string? raw, bool block, out string? reason) =>
        StaffUserRules.TryText(raw, 2000, required: true, multiline: true, out reason)
            ? null
            : $"Please enter the reason for {(block ? "blocking" : "unblocking")} (up to 2000 characters).";

    /// <summary>
    /// 2026-11-16 (the user): a login of User Management or the NEFT Admin blocked or unblocked: the history row and the mail
    /// with the reason, as for agencies and assessors (the caller has already changed Users.IsActive).
    /// </summary>
    public static async Task RecordAndMailLoginAsync(ControllerBase c, ISqlExecutor db, PortalHost host, StaffUserMail mail, string userId, int roleId,
        string? userName, string? email, string roleLabel, bool blocked, string reason, string actor, ILogger log, CancellationToken ct)
    {
        await UserBlockHistory.RecordAsync(db, userId, roleId, blocked ? UserBlockHistory.Blocked : UserBlockHistory.Unblocked, reason, HistoryActor(c, actor), ActorRole(c), log, ct);
        if (!StaffUserRules.IsEmail(email)) return;
        if (blocked)
            await mail.SendAsync<StaffAccountBlockedEmail>(email!, $"{roleLabel} Login Details for “MSME Sustainable (ZED) Certification” - {userId}", new()
            {
                [nameof(StaffAccountBlockedEmail.UserName)] = userName ?? userId,
                [nameof(StaffAccountBlockedEmail.UserId)] = userId,
                [nameof(StaffAccountBlockedEmail.Consultancy)] = host.IsConsultancy(),
                [nameof(StaffAccountBlockedEmail.RoleLabel)] = roleLabel,
                [nameof(StaffAccountBlockedEmail.Reason)] = reason,
            }, ct);
        else
            await mail.SendAsync<StaffAccountUnblockedEmail>(email!, "“MSME Sustainable (ZED) Certification” - Account Unblocked - " + userId, new()
            {
                [nameof(StaffAccountUnblockedEmail.UserName)] = userName ?? userId,
                [nameof(StaffAccountUnblockedEmail.UserId)] = userId,
                [nameof(StaffAccountUnblockedEmail.LoginUrl)] = mail.LoginUrl,
                [nameof(StaffAccountUnblockedEmail.Consultancy)] = host.IsConsultancy(),
                [nameof(StaffAccountUnblockedEmail.Reason)] = reason,
            }, ct);
    }

    /// <summary>
    /// Legacy UserHelper.UpdateMobileNo ran <c>UPDATE Users SET Password=@MobileNo, MobileNo=@MobileNo</c>, i.e. it
    /// also reset the password to the (known) mobile number. Only the mobile number is changed now.
    /// </summary>
    public static async Task<ActionResult<MessageResponse>> ResetMobileAsync(
        ControllerBase c, ISqlExecutor db, ManagedUser user, UserRole role, string? mobileNo, string actor, ILogger log, CancellationToken ct)
    {
        var mobile = mobileNo?.Trim();
        if (mobile is null || !StaffUserRules.MobilePattern().IsMatch(mobile)) return c.Problem400("Invalid Mobile No");
        await db.ExecuteSqlAsync("UPDATE Users SET MobileNo = @MobileNo WHERE UserId = @UserId AND RoleId = @RoleId",
            new { MobileNo = mobile, user.UserId, RoleId = (int)role }, ct);
        log.LogInformation("Mobile number of {UserId} changed by {Actor}", user.UserId, actor);
        // 2026-11-21: kept in the account's history (old -> new; nothing when the number is the same).
        var was = user.Row.Text("MobileNo").Trim();
        if (!string.Equals(was, mobile, StringComparison.Ordinal))
            await UserBlockHistory.RecordAsync(db, user.UserId, (int)role, UserBlockHistory.MobileReset, null, HistoryActor(c, actor), ActorRole(c), log, ct,
                AccountChanges.ToJson([new AccountChange("mobile", Old: was.Length == 0 ? null : was, New: mobile)]));
        return new MessageResponse("Mobile No updated successful");
    }

    private static async Task<bool> SetActiveAsync(ISqlExecutor db, PortalHost host, ManagedUser user, bool active, string reason, CancellationToken ct)
    {
        if (host.System != PortalSystem.Main)
            return await ConsultancyUsers.SetActiveAsync(db, user.UserId, user.Row.Text("RoleId"), active, reason, ct);
        var sets = await db.QueryProcMultipleAsync("SP_BLOCK_UNBLOCK_USER", new { IsActive = active, UserId = user.UserId, ReasonForRejection = reason }, ct);
        return sets[0].FirstOrDefault()?.Text("StatusCode") == "200";
    }
}
