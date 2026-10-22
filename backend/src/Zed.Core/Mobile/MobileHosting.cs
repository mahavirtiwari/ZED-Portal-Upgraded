using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Zed.Core.Mobile;

public sealed class MobileOptions
{
    public const string Section = "Mobile";

    /// <summary>Monitor until the logs show the apps always send deviceInfo, then Enforce.</summary>
    public DeviceBindingMode DeviceBinding { get; set; } = DeviceBindingMode.Monitor;

    /// <summary>In Enforce mode, also refuse calls that send no device id for a user who has a registered device.</summary>
    public bool RefuseMissingDevice { get; set; }

    /// <summary>Legacy checkMsmeVersion / msmeVersionNo: when on, other app versions are told to update.</summary>
    public bool CheckMsmeVersion { get; set; }

    public string MsmeVersion { get; set; } = "1.0.0";

    /// <summary>
    /// Root of the old services site, which holds Photos/, Videos/ and the other upload folders.
    /// Point it at the existing folder so the portal keeps finding the files.
    /// </summary>
    public string StorageRoot { get; set; } = "App_Data/mobile-storage";

    /// <summary>Largest request accepted (photos are sent as base64 or multipart).</summary>
    public long MaxRequestBytes { get; set; } = 30 * 1024 * 1024;

    /// <summary>Largest single uploaded or base64 file.</summary>
    public long MaxFileBytes { get; set; } = 20 * 1024 * 1024;

    public TwilioOptions Twilio { get; set; } = new();
}

/// <summary>Twilio Video, for remote assessments. Secrets come from user secrets or the environment.</summary>
public sealed class TwilioOptions
{
    public string AccountSid { get; set; } = "";
    public string ApiKey { get; set; } = "";
    public string ApiSecret { get; set; } = "";
}

/// <summary>
/// Base class for endpoints that the installed mobile apps call with the old contracts: no
/// sign-in, no anti-forgery token (the apps hold no cookies), MVC 5 binding and response formats.
/// Unhandled errors return the usual {status:"0"} body without the exception text.
/// Addresses are the old MVC default route, {controller}/{action}/{id}, case-insensitive; a
/// controller can replace them with its own [Route] (e.g. Pay/GetToken on the portal).
/// </summary>
[Route("[controller]/[action]/{id?}")]
[LegacyBinding]
[AllowAnonymous]
[IgnoreAntiforgeryToken]
[LegacyErrors]
[ApiExplorerSettings(GroupName = "mobile-legacy")]
public abstract class LegacyMobileController : ControllerBase
{
    protected static ContentResult LegacyJson(object? value) => LegacyResults.Json(value);

    protected static ContentResult LegacyContent(string text, string? contentType = null) => LegacyResults.Content(text, contentType);

    protected static ContentResult Fail(string message) => LegacyResults.Json(ServiceResponse.Fail(message));

    protected string? ClientIp => HttpContext.Connection.RemoteIpAddress?.ToString();
}

/// <summary>Turns unhandled exceptions into a generic legacy failure body; details go to the log only.</summary>
[AttributeUsage(AttributeTargets.Class, Inherited = true)]
public sealed class LegacyErrorsAttribute : Attribute, IExceptionFilter
{
    public void OnException(ExceptionContext context)
    {
        if (context.Exception is OperationCanceledException && context.HttpContext.RequestAborted.IsCancellationRequested) return;
        var logger = context.HttpContext.RequestServices.GetService(typeof(ILogger<LegacyMobileController>)) as ILogger;
        if (context.Exception is UnsafePathException)
        {
            logger?.LogWarning("Refused unsafe path in {Path}: {Message}", context.HttpContext.Request.Path, context.Exception.Message);
            context.Result = LegacyResults.Json(ServiceResponse.Fail("Invalid Data."));
        }
        else
        {
            logger?.LogError(context.Exception, "Mobile call {Path} failed", context.HttpContext.Request.Path);
            var result = LegacyResults.Json(ServiceResponse.Fail("An error has occurred, please try again later."));
            result.StatusCode = StatusCodes.Status500InternalServerError;
            context.Result = result;
        }
        context.ExceptionHandled = true;
    }
}

public static class MobileHostingExtensions
{
    /// <summary>
    /// Collapses repeated slashes in the request path ("SA//SubmitAllocation" becomes "SA/SubmitAllocation"). The consultant
    /// app joins its base address ".../SA/" with paths that start with "/", and the old IIS/MVC 5 site routed those;
    /// ASP.NET Core does not match an empty segment. Must run before routing.
    /// </summary>
    public static IApplicationBuilder UseLegacyPathNormalization(this IApplicationBuilder app) => app.Use((context, next) =>
    {
        var path = context.Request.Path.Value;
        if (path is not null && path.Contains("//", StringComparison.Ordinal))
        {
            var collapsed = new System.Text.StringBuilder(path.Length);
            foreach (var c in path)
                if (c != '/' || collapsed.Length == 0 || collapsed[^1] != '/') collapsed.Append(c);
            context.Request.Path = new PathString(collapsed.ToString());
        }
        return next(context);
    });

    /// <summary>Legacy mobile support: options, device records and upload storage.</summary>
    public static IServiceCollection AddLegacyMobile(this IServiceCollection services, IConfiguration config)
    {
        services.Configure<MobileOptions>(config.GetSection(MobileOptions.Section));
        services.AddSingleton<IDeviceBindings, SqlDeviceBindings>();
        services.AddSingleton<MobileStorage>();
        return services;
    }
}
