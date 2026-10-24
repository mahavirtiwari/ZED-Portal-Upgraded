using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.SubUsers;

/// <summary>
/// Global filter for sub-users (signed in with <see cref="ZedClaims.ActingUserId"/>): the sub-user must still exist and be
/// active (checked every request, cached 30 seconds, so a block or a permission change applies at once), and a call to
/// /api/staff/… needs a permission that covers it (<see cref="SubUserPermissions"/>). Everything else is checked as for the
/// owner. Changes made by a sub-user are logged with both IDs.
/// </summary>
public sealed class SubUserAccessFilter(SubUserStore store, PortalHost host, ILogger<SubUserAccessFilter> log) : IAsyncAuthorizationFilter
{
    public const string NoAccess = "You do not have access to this screen. Please ask your administrator for access.";

    public async Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var http = context.HttpContext;
        if (ZedUser.FromPrincipal(http.User) is not { IsSubUser: true } user) return;

        var path = http.Request.Path.Value ?? "";
        var method = http.Request.Method;
        // Signing in again or out is always possible.
        if (SubUserPermissions.Under(path, "/api/staff/auth/login") || SubUserPermissions.Under(path, "/api/auth")) return;

        var row = await store.FindCachedAsync(user.ActingUserId!, http.RequestAborted);
        if (row is null || !row.IsActive || !string.Equals(row.OwnerUserId, user.UserId, StringComparison.OrdinalIgnoreCase))
        {
            log.LogWarning("Sub-user {ActingUserId} of {Owner} is no longer active; signed out", user.ActingUserId, user.UserId);
            await http.SignOutZedUserAsync();
            context.Result = new UnauthorizedResult();
            return;
        }

        if (SubUserPermissions.Under(path, "/api/staff") && !SubUserPermissions.AlwaysReadable(method, path))
        {
            var granted = SubUserPermissions.Granted(row.Permissions, user.RoleId, user.SubRoles ?? [], host.System);
            if (!SubUserPermissions.Covers(granted, path))
            {
                log.LogWarning("Sub-user {ActingUserId} of {Owner} refused: {Method} {Path}", user.ActingUserId, user.UserId, method, path);
                context.Result = new ObjectResult(new ProblemDetails { Title = NoAccess, Status = StatusCodes.Status403Forbidden })
                    { StatusCode = StatusCodes.Status403Forbidden };
                return;
            }
        }

        if (!HttpMethods.IsGet(method) && !HttpMethods.IsHead(method))
            log.LogInformation("Sub-user {ActingUserId} working as {Owner}: {Method} {Path}", user.ActingUserId, user.UserId, method, path);
    }
}
