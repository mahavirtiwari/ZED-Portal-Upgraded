using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Security;

namespace Zed.Portal.Features.Msme;

/// <summary>
/// Base for endpoints used by a signed-in MSME (Users.RoleId 5). The ZED ID always comes from the
/// sign-in cookie. The legacy actions accepted a zedId from the browser, so anyone could read any
/// MSME's data; never take it from the request here.
/// </summary>
[ApiController]
[Authorize(Roles = nameof(UserRole.Msme))]
public abstract class MsmeApiController : ControllerBase
{
    protected string ZedId => ZedUser.FromPrincipal(User)?.UserId
        ?? throw new InvalidOperationException("Authorised MSME endpoint reached without a signed-in user.");

    protected string RoleId => ((int)UserRole.Msme).ToString();
}
