using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.DependencyInjection;
using Zed.Core.Http;

namespace Zed.Portal.Features.Staff.Masters;

/// <summary>
/// An action of a controller shared by several hosts that only some systems have (e.g. the category and technology
/// masters, whose procedures exist only in ZEDCS_V2_LIVE): on the other hosts it answers 404, as if it did not exist.
/// </summary>
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class)]
public sealed class SystemOnlyAttribute(params PortalSystem[] systems) : Attribute, IActionFilter
{
    public void OnActionExecuting(ActionExecutingContext context)
    {
        var host = context.HttpContext.RequestServices.GetRequiredService<PortalHost>();
        if (!systems.Contains(host.System)) context.Result = new NotFoundResult();
    }

    public void OnActionExecuted(ActionExecutedContext context) { }
}
