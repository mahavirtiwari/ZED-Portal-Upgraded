using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Templates;

namespace Zed.Portal.Features.Staff.Users;

/// <summary>Block / unblock / mobile number change, shared by agencies and assessors. Callers have already checked who may act on the user.</summary>
internal static class StaffUserActions
{
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

        if (host.IsConsultancy() && StaffUserRules.IsEmail(user.Row.Text("Email")))
        {
            var organisation = user.Row.Text("RoleId") == "2";
            await mail.SendAsync<StaffAccountBlockedEmail>(user.Row.Text("Email"),
                (organisation ? "Consultant Organisation" : "Consultant/Expert") + " Login Details for “MSME Sustainable (ZED) Certification” - " + user.UserId, new()
                {
                    [nameof(StaffAccountBlockedEmail.UserName)] = user.Row.Text("UserName"),
                    [nameof(StaffAccountBlockedEmail.UserId)] = user.UserId,
                    [nameof(StaffAccountBlockedEmail.IsOrganisation)] = organisation,
                    [nameof(StaffAccountBlockedEmail.Reason)] = reason,
                }, ct);
        }
        return new MessageResponse("User Blocked successful");
    }

    public static async Task<ActionResult<MessageResponse>> UnblockAsync(
        ControllerBase c, ISqlExecutor db, PortalHost host, StaffUserMail mail, ManagedUser user, string actor, ILogger log, CancellationToken ct)
    {
        if (user.IsActive) return c.Problem400("This user is not blocked.");
        if (!await SetActiveAsync(db, host, user, true, "", ct))
            return c.Problem400("The user could not be unblocked. Please try again.");
        log.LogInformation("User {UserId} unblocked by {Actor}", user.UserId, actor);

        if (StaffUserRules.IsEmail(user.Row.Text("Email")))
            await mail.SendAsync<StaffAccountUnblockedEmail>(user.Row.Text("Email"),
                "“MSME Sustainable (ZED) Certification” - Account Unblocked - " + user.UserId, new()
                {
                    [nameof(StaffAccountUnblockedEmail.UserName)] = user.Row.Text("UserName"),
                    [nameof(StaffAccountUnblockedEmail.UserId)] = user.UserId,
                    [nameof(StaffAccountUnblockedEmail.LoginUrl)] = mail.LoginUrl,
                    [nameof(StaffAccountUnblockedEmail.Consultancy)] = host.IsConsultancy(),
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

    private static async Task<bool> SetActiveAsync(ISqlExecutor db, PortalHost host, ManagedUser user, bool active, string reason, CancellationToken ct)
    {
        if (host.System != PortalSystem.Main)
            return await ConsultancyUsers.SetActiveAsync(db, user.UserId, user.Row.Text("RoleId"), active, reason, ct);
        var sets = await db.QueryProcMultipleAsync("SP_BLOCK_UNBLOCK_USER", new { IsActive = active, UserId = user.UserId, ReasonForRejection = reason }, ct);
        return sets[0].FirstOrDefault()?.Text("StatusCode") == "200";
    }
}
