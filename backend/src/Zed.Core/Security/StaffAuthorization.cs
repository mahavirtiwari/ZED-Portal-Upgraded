using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Zed.Core.Security;

/// <summary>
/// Staff roles in use on the portal (from the MVC layout menu). The remaining values of
/// <see cref="UserRole"/> are leftovers of the Swachh Survekshan code base and get no staff access.
/// </summary>
public static class StaffRoles
{
    public static readonly UserRole[] All =
    [
        UserRole.SuperAdmin, UserRole.MasterAdmin, UserRole.Admin, UserRole.Ministry, UserRole.QC,
        UserRole.CitizenFeedback, UserRole.StateCoordinator, UserRole.Agency, UserRole.DesktopAssessor,
    ];

    public static bool IsStaff(int roleId) => All.Any(r => (int)r == roleId);

    public static string Names(params UserRole[] roles) => string.Join(",", roles.Select(r => r.ToString()));
}

/// <summary>Restricts an action or controller to the given staff roles (replaces AuthenticationFilter("|Admin|MasterAdmin|")).</summary>
public sealed class StaffRolesAttribute : AuthorizeAttribute
{
    public StaffRolesAttribute(params UserRole[] roles) => Roles = StaffRoles.Names(roles.Length == 0 ? StaffRoles.All : roles);
}

/// <summary>Requires a sub-role claim (UserHelper.CheckSubRole in the MVC code).</summary>
public sealed class SubRoleAttribute(string subRole) : AuthorizeAttribute(PolicyPrefix + subRole)
{
    public const string PolicyPrefix = "SubRole:";
}

/// <summary>Base for staff endpoints: any staff role, user taken from the sign-in cookie.</summary>
[ApiController]
[StaffRoles]
public abstract class StaffApiController : ControllerBase
{
    protected ZedUser CurrentUser => ZedUser.FromPrincipal(User)
        ?? throw new InvalidOperationException("Staff endpoint reached without a signed-in user.");

    protected string UserId => CurrentUser.UserId;
    protected int RoleId => CurrentUser.RoleId;
    protected bool IsRole(params UserRole[] roles) => roles.Any(r => (int)r == RoleId);
}
