using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Users;

/// <summary>
/// Global filter for Master Admin and Ministry logins with a scope (<see cref="LoginScope"/>, migration 0057): a staff call
/// about one unit (a <c>{zedId}</c> in the route, or a ZedId in the request, with its certification / level when there is one) answers
/// 404 when the unit or the level is outside the scope, as for a unit that does not exist. The lists filter their rows
/// themselves (<see cref="ScopeFilter"/>).
/// </summary>
public sealed class ScopeAccessFilter(ILogger<ScopeAccessFilter> log) : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var http = context.HttpContext;
        // 2026-11-16: an agency's or operation admin's sub-user with its own states / agencies (migration 0087) too.
        if (ZedUser.FromPrincipal(http.User) is { } user && (LoginScopes.CanHaveScope(user.RoleId) || user.IsSubUser)
            && ScopedPath(http.Request.Path.Value ?? "")
            && Unit(context) is ({ Length: > 0 } zedId, var level))
        {
            if (!await ScopeFilter.AllowsAsync(http, zedId, level, http.RequestAborted))
            {
                log.LogInformation("{UserId}: {ZedId} {Level} is outside the login's scope", user.UserId, zedId, level);
                context.Result = new NotFoundResult();
                return;
            }
        }
        await next();
    }

    /// <summary>The staff APIs, and the consultancy milestone pages (api/consultancy/milestones/{zedId}/{certification}, with their files)
    /// that Master Admins, Dashboard Admins and Ministry open too (2026-11-27, permissions review: they were outside the scope).</summary>
    internal static bool ScopedPath(string path) =>
        path.StartsWith("/api/staff/", StringComparison.OrdinalIgnoreCase) || path.StartsWith("/api/consultancy/milestones/", StringComparison.OrdinalIgnoreCase);

    private static readonly string[] LevelNames = ["certification", "level", "certificationType"];

    /// <summary>The unit of the call: a {zedId} route value, else a ZedId argument or a request object's ZedId (with its level).</summary>
    private static (string? ZedId, string? Level) Unit(ActionExecutingContext context)
    {
        if (Route(context, "zedId") is { Length: > 0 } routeId)
            return (routeId, LevelNames.Select(n => Route(context, n)).FirstOrDefault(v => !string.IsNullOrEmpty(v)));
        foreach (var (name, value) in context.ActionArguments)
        {
            if (value is string text && string.Equals(name, "zedId", StringComparison.OrdinalIgnoreCase))
                return (text.Trim(), LevelNames.Select(n => context.ActionArguments.TryGetValue(n, out var l) ? l as string : null).FirstOrDefault(v => !string.IsNullOrEmpty(v)));
            if (value is null || value is string || value.GetType().IsPrimitive) continue;
            var type = value.GetType();
            if (type.GetProperty("ZedId")?.GetValue(value) is string bodyId && bodyId.Trim().Length > 0)
                return (bodyId.Trim(), LevelNames.Select(n => type.GetProperty(char.ToUpperInvariant(n[0]) + n[1..])?.GetValue(value) as string)
                    .FirstOrDefault(v => !string.IsNullOrEmpty(v)));
        }
        return (null, null);
    }

    private static string? Route(ActionExecutingContext context, string name) =>
        context.RouteData.Values.TryGetValue(name, out var v) && v is not null ? Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture)?.Trim() : null;
}
