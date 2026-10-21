using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Templates;

namespace Zed.Portal.Features.Staff.Users;

/// <summary>Block / unblock / mobile number change, shared by agencies and assessors. Callers have already checked who may act on the user.</summary>
internal static class StaffUserActions
{
    /// <summary>SP_BLOCK_UNBLOCK_USER (Users.IsActive and ReasonForRejection, in ZEDCS and ZED_SURVEILLANCE).</summary>
    public static async Task<ActionResult<MessageResponse>> BlockAsync(
        ControllerBase c, ISqlExecutor db, ManagedUser user, string reason, string actor, ILogger log, CancellationToken ct)
    {
        if (!user.IsActive) return c.Problem400("This user is already blocked.");
        if (!await SetActiveAsync(db, user.UserId, false, reason, ct))
            return c.Problem400("The user could not be blocked. Please try again.");
        log.LogInformation("User {UserId} blocked by {Actor}", user.UserId, actor);
        return new MessageResponse("User Blocked successful");
    }

    public static async Task<ActionResult<MessageResponse>> UnblockAsync(
        ControllerBase c, ISqlExecutor db, StaffUserMail mail, ManagedUser user, string actor, ILogger log, CancellationToken ct)
    {
        if (user.IsActive) return c.Problem400("This user is not blocked.");
        if (!await SetActiveAsync(db, user.UserId, true, "", ct))
            return c.Problem400("The user could not be unblocked. Please try again.");
        log.LogInformation("User {UserId} unblocked by {Actor}", user.UserId, actor);

        if (StaffUserRules.IsEmail(user.Row.Text("Email")))
            await mail.SendAsync<StaffAccountUnblockedEmail>(user.Row.Text("Email"),
                "“MSME Sustainable (ZED) Certification” - Account Unblocked - " + user.UserId, new()
                {
                    [nameof(StaffAccountUnblockedEmail.UserName)] = user.Row.Text("UserName"),
                    [nameof(StaffAccountUnblockedEmail.UserId)] = user.UserId,
                    [nameof(StaffAccountUnblockedEmail.LoginUrl)] = mail.LoginUrl,
                }, ct);
        return new MessageResponse("User UnBlocked successful");
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
        return new MessageResponse("Mobile No updated successful");
    }

    private static async Task<bool> SetActiveAsync(ISqlExecutor db, string userId, bool active, string reason, CancellationToken ct)
    {
        var sets = await db.QueryProcMultipleAsync("SP_BLOCK_UNBLOCK_USER", new { IsActive = active, UserId = userId, ReasonForRejection = reason }, ct);
        return sets[0].FirstOrDefault()?.Text("StatusCode") == "200";
    }
}
