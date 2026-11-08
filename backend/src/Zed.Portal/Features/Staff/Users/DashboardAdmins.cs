using System.Data.Common;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Users;

/// <summary>The Dashboard Admin's ticked screens (dbo.Users.ScreenAccess, migration 0058; <see cref="DashboardScreens"/>).</summary>
public static class DashboardAdmins
{
    /// <summary>A Dashboard Admin's screens, or an MSME DFO's NEFT lists ("main:neft,consultancy:neft").</summary>
    internal const string ScreensSql = "SELECT TOP (1) ScreenAccess FROM dbo.Users WHERE UserId = @UserId AND RoleId IN (6, 10) ORDER BY CASE WHEN IsActive = 1 THEN 0 ELSE 1 END;";

    public sealed record ScreensRow(string? ScreenAccess);

    /// <summary>The stored value; null (every screen) when not set or before migration 0058.</summary>
    public static async Task<string?> ScreensAsync(ISqlExecutor db, string userId, ILogger log, CancellationToken ct)
    {
        try
        {
            return (await db.QuerySqlAsync<ScreensRow>(ScreensSql, new { UserId = userId }, ct)).FirstOrDefault()?.ScreenAccess;
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Screens of Dashboard Admin {UserId} not read (is migration 0058 applied?)", userId);
            return null;
        }
    }
}

/// <summary>
/// Global filter: a Dashboard Admin with ticked screens (<see cref="DashboardScreens.IsLimited"/>) calls only the staff APIs of
/// those screens on this portal; anything else answers 403, as for a screen of another role.
/// </summary>
public sealed class DashboardScreenFilter(PortalHost host, ILogger<DashboardScreenFilter> log) : IAsyncAuthorizationFilter
{
    public const string NoAccess = "You do not have access to this screen. Please ask the Admin for access.";

    public Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var http = context.HttpContext;
        var path = http.Request.Path.Value ?? "";
        if (ZedUser.FromPrincipal(http.User) is { } user && DashboardScreens.IsLimited(user)
            && path.StartsWith("/api/staff/", StringComparison.OrdinalIgnoreCase)
            && !DashboardScreens.Allows(user, host.System, path))
        {
            log.LogInformation("Dashboard Admin {UserId}: {Path} is not one of its screens", user.UserId, path);
            context.Result = new ObjectResult(new ProblemDetails { Title = NoAccess, Status = StatusCodes.Status403Forbidden }) { StatusCode = StatusCodes.Status403Forbidden };
        }
        return Task.CompletedTask;
    }
}
