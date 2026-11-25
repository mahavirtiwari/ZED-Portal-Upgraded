using System.Data.Common;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.SubUsers;

namespace Zed.Portal.Features.Staff.Users;

/// <summary>
/// 2026-11-24 (approved design): the Incentives Master Admin, a login type of Admin → User Management (main portal). It is a Master
/// Admin (dbo.Users.RoleId 7, so every check, action and mail of the incentive screens is the Master Admin's) whose
/// dbo.Users.ScreenAccess is <see cref="ScreenAccess"/>; its sign-in carries the pseudo sub-role <see cref="SubRole"/> (as the
/// incentive verification agencies carry theirs). It and its own Operation Admins have only the incentive screens
/// (<see cref="Keys"/>), the incentives dashboard and (itself) its Operation Admins; <see cref="IncentivesAdminFilter"/> refuses the
/// other staff APIs. 2026-11-25 (the product owner: "shift the old from certification/handholding master admin to incentive master
/// admin"): the main Master Admin and its Operation Admins no longer have the incentive screens (<see cref="IsIncentiveApi"/>).
/// </summary>
public static class IncentivesAdmins
{
    /// <summary>dbo.Users.ScreenAccess of an Incentives Master Admin (a Master Admin's row has NULL there).</summary>
    public const string ScreenAccess = "incentives";

    /// <summary>The pseudo sub-role of its sign-in, its Operation Admins' too (staff-menu.ts INCENTIVES_SUB_ROLE).</summary>
    public const string SubRole = "IncentivesOnly";

    /// <summary>The login type's id in User Management (not a role: the role is the Master Admin's, 7).</summary>
    public const int TypeId = 107;

    public const string Label = "Incentives Master Admin";

    /// <summary>The incentives dashboard (its home page) and its API.</summary>
    public const string DashboardRoute = "/staff/incentives/dashboard";
    public const string DashboardApi = "/api/staff/incentives-dashboard";

    public const string SubUsersRoute = "/staff/sub-users";
    private const string SubUsersApi = "/api/staff/sub-users";

    /// <summary>Its screens: the incentive screens of the Operation Admins' catalogue (SubUserPermissions).</summary>
    public static readonly IReadOnlySet<string> Keys = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "financial-assistance", "scheme-applications", "scheme-onsite-agencies", "incentive-upload",
    };

    /// <summary>The incentive screens of the Master Admins' catalogue on this system (none off the main portal).</summary>
    public static IReadOnlyList<SubUserPermission> Screens(PortalSystem system) =>
        SubUserPermissions.Catalogue.Where(p => p.OwnerRole == UserRole.MasterAdmin && p.Systems.Contains(system) && Keys.Contains(p.Key)).ToList();

    /// <summary>
    /// 2026-11-25: an API of the incentive screens (the incentives dashboard among them), refused to the main Master Admin; with an
    /// agency's scheme ticks (Incentives/Staff/SchemeTicksController), which only incentive verification agencies may have.
    /// </summary>
    public static bool IsIncentiveApi(string path, PortalSystem system) =>
        SubUserPermissions.Covers(Screens(system), path) || (system == PortalSystem.Main && AgencyTicks.IsMatch(path));

    private static readonly System.Text.RegularExpressions.Regex AgencyTicks =
        new(@"^/api/staff/users/agencies/[^/]+/schemes/?$", System.Text.RegularExpressions.RegexOptions.IgnoreCase | System.Text.RegularExpressions.RegexOptions.CultureInvariant);

    /// <summary>Read-only calls its screens make whatever they are (sign-in, the bell, the MSME pages opened from a case, Export).</summary>
    private static readonly string[] Always =
    [
        "/api/staff/auth", "/api/staff/attention", "/api/staff/msme-profile", "/api/staff/msme-edit-history", "/api/staff/certification-documents",
        "/api/staff/submission-checklists",
    ];

    internal const string ScreenAccessSql =
        "SELECT TOP (1) ScreenAccess FROM dbo.Users WHERE UserId = @UserId AND RoleId = 7 ORDER BY CASE WHEN IsActive = 1 THEN 0 ELSE 1 END;";

    public sealed record ScreenRow(string? ScreenAccess);

    /// <summary>A stored dbo.Users.ScreenAccess that makes a Master Admin an Incentives Master Admin.</summary>
    public static bool IsStored(string? screenAccess) => string.Equals(screenAccess?.Trim(), ScreenAccess, StringComparison.OrdinalIgnoreCase);

    /// <summary>Signed in as an Incentives Master Admin or one of its Operation Admins.</summary>
    public static bool Is(ZedUser? user) =>
        user is { RoleId: (int)UserRole.MasterAdmin } && (user.SubRoles ?? []).Contains(SubRole, StringComparer.OrdinalIgnoreCase);

    public static bool Is(int roleId, IReadOnlyCollection<string> subRoles) =>
        roleId == (int)UserRole.MasterAdmin && subRoles.Contains(SubRole, StringComparer.OrdinalIgnoreCase);

    /// <summary>The sign-in's extra sub-role of a Master Admin (none for the others). Never fails the sign-in.</summary>
    public static async Task<IReadOnlyList<string>> SubRolesAsync(ISqlExecutor db, string userId, int roleId, ILogger log, CancellationToken ct)
    {
        if (roleId != (int)UserRole.MasterAdmin || string.IsNullOrWhiteSpace(userId)) return [];
        try
        {
            var row = (await db.QuerySqlAsync<ScreenRow>(ScreenAccessSql, new { UserId = userId.Trim() }, ct)).FirstOrDefault();
            return IsStored(row?.ScreenAccess) ? [SubRole] : [];
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Screens of Master Admin {UserId} not read (is migration 0058 applied?)", userId);
            return [];
        }
    }

    /// <summary>The pages of an Incentives Master Admin's sign-in (the menu and the "no access" page use them).</summary>
    public static IReadOnlyList<string> Routes(PortalSystem system) =>
        [DashboardRoute, .. SubUserPermissions.For((int)UserRole.MasterAdmin, [SubRole], system).SelectMany(p => p.Routes), SubUsersRoute];

    /// <summary>Whether an Incentives Master Admin (or, <paramref name="subUser"/>, one of its Operation Admins) may call a staff API.</summary>
    public static bool Allows(string method, string path, bool subUser, PortalSystem system)
    {
        if (Always.Any(p => SubUserPermissions.Under(path, p))) return true;
        if (HttpMethods.IsPost(method) && path.Equals("/api/staff/export/xlsx", StringComparison.OrdinalIgnoreCase)) return true;
        if (HttpMethods.IsGet(method) && SubUserPermissions.Under(path, DashboardApi)) return true;
        if (!subUser && SubUserPermissions.Under(path, SubUsersApi)) return true;
        if (system == PortalSystem.Main && AgencyTicks.IsMatch(path)) return true;
        return SubUserPermissions.Covers(SubUserPermissions.For((int)UserRole.MasterAdmin, [SubRole], system), path);
    }
}

/// <summary>
/// Global filter: an Incentives Master Admin and its Operation Admins call only the staff APIs of the incentive screens
/// (<see cref="IncentivesAdmins.Allows"/>); anything else answers 403, as a screen of another role. (An Operation Admin is also
/// checked against the screens it was given, <see cref="SubUserAccessFilter"/>.) 2026-11-25: the other way round, the main Master
/// Admin and its Operation Admins are refused the incentive screens' APIs (<see cref="IncentivesAdmins.IsIncentiveApi"/>).
/// </summary>
public sealed class IncentivesAdminFilter(PortalHost host, ILogger<IncentivesAdminFilter> log) : IAsyncAuthorizationFilter
{
    public const string NoAccess = "You do not have access to this screen. Please ask the Admin for access.";

    public Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var http = context.HttpContext;
        var path = http.Request.Path.Value ?? "";
        if (ZedUser.FromPrincipal(http.User) is not { RoleId: (int)UserRole.MasterAdmin } user) return Task.CompletedTask;
        if (IncentivesAdmins.Is(user)
            && SubUserPermissions.CheckedRoots.Any(root => SubUserPermissions.Under(path, root))
            && !IncentivesAdmins.Allows(http.Request.Method, path, user.IsSubUser, host.System))
        {
            log.LogInformation("Incentives Master Admin {UserId}: {Method} {Path} is not an incentive screen", user.UserId, http.Request.Method, path);
            context.Result = Forbidden();
        }
        else if (!IncentivesAdmins.Is(user) && IncentivesAdmins.IsIncentiveApi(path, host.System))
        {
            log.LogInformation("Master Admin {UserId}: {Method} {Path} is an incentive screen (the Incentives Master Admin's)", user.UserId, http.Request.Method, path);
            context.Result = Forbidden();
        }
        return Task.CompletedTask;
    }

    private static ObjectResult Forbidden() =>
        new(new ProblemDetails { Title = NoAccess, Status = StatusCodes.Status403Forbidden }) { StatusCode = StatusCodes.Status403Forbidden };
}
