using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace Zed.Portal.Features.Msme.Entry;

/// <summary>
/// 2026-11-14 (the user): no certification level has basic information or document upload on the web; the applicant
/// enters them (and answers the NCs) in the ZED MSME app, and the web only shows what was uploaded. Every write of
/// api/msme/entry is refused unless <c>Msme:WebEntry</c> is true (off by default; kept only so that the old web entry can be
/// switched back on without a release). The GET of the page and the unit's own files stay open, for the read-only view.
/// </summary>
[AttributeUsage(AttributeTargets.Method)]
public sealed class WebEntryGateAttribute : Attribute, IResourceFilter
{
    public const string Setting = "Msme:WebEntry";
    public const string AppOnly = "Basic information and documents are entered in the ZED MSME app. The web shows what has been uploaded.";

    public static bool On(IConfiguration config) => config.GetValue<bool>(Setting);

    /// <summary>Before the model binding and validation, so that any request gets the same answer.</summary>
    public void OnResourceExecuting(ResourceExecutingContext context)
    {
        if (On(context.HttpContext.RequestServices.GetRequiredService<IConfiguration>())) return;
        context.Result = new ObjectResult(new ProblemDetails { Status = StatusCodes.Status400BadRequest, Title = AppOnly }) { StatusCode = StatusCodes.Status400BadRequest };
    }

    public void OnResourceExecuted(ResourceExecutedContext context) { }
}
