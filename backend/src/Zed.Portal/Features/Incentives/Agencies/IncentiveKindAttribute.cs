using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Zed.Core.Security;

namespace Zed.Portal.Features.Incentives.Agencies;

/// <summary>
/// 2026-11-27 (incentive workflow check: an assessment agency and an onsite agency reached the desktop scheme-verification API, a
/// certification assessor the verification officer's, each with an empty list): only the incentive verification agencies of this
/// kind, their sub-users and their verification officers (the sign-in's pseudo sub-role, <see cref="IncentiveAgencies.SubRoleOf"/>)
/// may call the controller; anyone else answers 403, as a screen of another role.
/// </summary>
[AttributeUsage(AttributeTargets.Class)]
public sealed class IncentiveKindAttribute(string subRole) : Attribute, IAuthorizationFilter
{
    public const string NoAccess = "You do not have access to this screen.";

    public string SubRole { get; } = subRole;

    public void OnAuthorization(AuthorizationFilterContext context)
    {
        if (ZedUser.FromPrincipal(context.HttpContext.User) is { } user && !user.HasSubRole(SubRole))
            context.Result = new ObjectResult(new ProblemDetails { Title = NoAccess, Status = StatusCodes.Status403Forbidden }) { StatusCode = StatusCodes.Status403Forbidden };
    }
}
