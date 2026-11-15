using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.Logging;
using Zed.Core.Http;
using Zed.Core.Mobile;
using Zed.Core.Security;

namespace Zed.Core.Maintenance;

/// <summary>An action or controller that answers while its portal is down (sign-in, the session, the status itself).</summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
public sealed class AllowDuringMaintenanceAttribute : Attribute;

/// <summary>
/// 2026-11-15: every API call of a portal or app that is down (<see cref="MaintenanceState"/>) is answered with the
/// maintenance message instead of running. App calls (the controllers of <see cref="LegacyMobileController"/>) get the
/// apps' usual failure body, which every app already shows; web calls get 503 with the message (the pages then show the
/// maintenance page). The Admin, signed in on the main portal, always passes.
/// </summary>
public sealed class MaintenanceFilter(MaintenanceState state, PortalHost host, ILogger<MaintenanceFilter> log) : IAsyncResourceFilter
{
    public async Task OnResourceExecutionAsync(ResourceExecutingContext context, ResourceExecutionDelegate next)
    {
        if (context.ActionDescriptor is not ControllerActionDescriptor action
            || context.ActionDescriptor.EndpointMetadata.OfType<AllowDuringMaintenanceAttribute>().Any()
            || Target(action, host.System) is not { } target)
        {
            await next();
            return;
        }
        MaintenanceEntry entry;
        try
        {
            entry = await state.GetAsync(target, context.HttpContext.RequestAborted);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Maintenance state unreadable; {Target} treated as up", target);
            await next();
            return;
        }
        if (!entry.IsDownAt(DateTime.Now)
            || (target == MaintenanceTargets.Main && context.HttpContext.User.IsInRole(nameof(UserRole.Admin))))
        {
            await next();
            return;
        }

        if (target.StartsWith("app-", StringComparison.Ordinal))
        {
            context.Result = LegacyResults.Json(ServiceResponse.Fail(entry.MessageText));
            return;
        }
        var problem = new ProblemDetails
        {
            Status = StatusCodes.Status503ServiceUnavailable,
            Title = entry.MessageText,
            Type = "maintenance",
        };
        problem.Extensions["maintenance"] = true;
        if (entry.Until is { } until) problem.Extensions["until"] = until.ToString(MaintenanceEntry.TimeFormat);
        context.Result = new ObjectResult(problem) { StatusCode = StatusCodes.Status503ServiceUnavailable };
    }

    /// <summary>Which portal or app a call belongs to: the app by its controller, a web call by its host.</summary>
    public static string? Target(ControllerActionDescriptor action, PortalSystem system)
    {
        if (!typeof(LegacyMobileController).IsAssignableFrom(action.ControllerTypeInfo)) return MaintenanceTargets.Of(system);
        var name = action.ControllerName;
        if (name.StartsWith("Msme", StringComparison.OrdinalIgnoreCase) || name is "SurveillanceMsme" or "TuPhotos")
            return MaintenanceTargets.MsmeApp;
        if (name is "SA" or "RA" or "Surveillance" or "SurveillancePhoto" or "AssessorApp") return MaintenanceTargets.AssessorApp;
        if (name.StartsWith("Consultancy", StringComparison.OrdinalIgnoreCase)) return MaintenanceTargets.ConsultantApp;
        // Shared app calls (texts, forms, home): the consultancy app API serves the consultant app only.
        return system == PortalSystem.Consultancy ? MaintenanceTargets.ConsultantApp : null;
    }
}
