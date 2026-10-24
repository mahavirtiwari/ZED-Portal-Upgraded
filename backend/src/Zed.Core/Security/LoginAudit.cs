using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.Infrastructure;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Mobile;

namespace Zed.Core.Security;

/// <summary>Where a sign-in came from.</summary>
public static class LoginChannels
{
    public const string Web = "Web";
    public const string Mobile = "Mobile";
}

/// <summary>
/// One sign-in attempt (dbo.V4LoginEvents, migration 0013): who, success or why not, from where (IP address, browser and
/// operating system of the web user agent, or the app's device registration ID, model, OS and app version), and a
/// persistent ID of the web browser. Never the password.
/// </summary>
public sealed record LoginEvent
{
    public string Channel { get; init; } = LoginChannels.Web;
    public string App { get; init; } = "";
    public string? UserId { get; init; }
    public string? ActingUserId { get; init; }
    public int? RoleId { get; init; }
    public bool Success { get; init; }
    public string? Reason { get; init; }
    public string? IpAddress { get; init; }
    public string? UserAgent { get; init; }
    public string? Browser { get; init; }
    public string? Os { get; init; }
    public string? DeviceType { get; init; }
    public string? DeviceId { get; init; }
    public string? DeviceModel { get; init; }
    public string? Manufacturer { get; init; }
    public string? OsVersion { get; init; }
    public int? ApiLevel { get; init; }
    public string? AppVersion { get; init; }
}

public interface ILoginAudit
{
    /// <summary>Records the event; never fails the sign-in (a missing table, 0013 not run, is logged).</summary>
    Task RecordAsync(LoginEvent e, CancellationToken ct = default);
}

public sealed partial class SqlLoginAudit(ISqlExecutor db, IServiceProvider services, ILogger<SqlLoginAudit> log) : ILoginAudit
{
    internal const string InsertSql =
        "INSERT INTO dbo.V4LoginEvents (System, Channel, App, UserId, ActingUserId, RoleId, Result, Reason, IpAddress, UserAgent, Browser, Os, " +
        "DeviceType, DeviceId, DeviceModel, Manufacturer, OsVersion, ApiLevel, AppVersion) VALUES (@System, @Channel, @App, @UserId, @ActingUserId, " +
        "@RoleId, @Result, @Reason, @IpAddress, @UserAgent, @Browser, @Os, @DeviceType, @DeviceId, @DeviceModel, @Manufacturer, @OsVersion, @ApiLevel, @AppVersion);";

    public async Task RecordAsync(LoginEvent e, CancellationToken ct = default)
    {
        try
        {
            await db.ExecuteSqlAsync(InsertSql, new
            {
                System = services.GetService<PortalHost>()?.System.ToString() ?? "Mobile API",
                Channel = Cut(e.Channel, 10), App = Cut(e.App, 30), UserId = Cut(e.UserId, 100), ActingUserId = Cut(e.ActingUserId, 50), e.RoleId,
                Result = e.Success ? "Success" : "Failed", Reason = Cut(e.Reason, 200), IpAddress = Cut(e.IpAddress, 50), UserAgent = Cut(e.UserAgent, 400),
                Browser = Cut(e.Browser, 50), Os = Cut(e.Os, 50), DeviceType = Cut(e.DeviceType, 20), DeviceId = Cut(e.DeviceId, 200),
                DeviceModel = Cut(e.DeviceModel, 150), Manufacturer = Cut(e.Manufacturer, 100), OsVersion = Cut(e.OsVersion, 50), e.ApiLevel,
                AppVersion = Cut(e.AppVersion, 50),
            }, ct);
        }
        catch (Exception ex) when (ex is SqlException or InvalidOperationException)
        {
            log.LogWarning(ex, "Could not record the {Channel} sign-in of {UserId} (is migration 0013 applied?)", e.Channel, e.UserId);
        }
    }

    private static string? Cut(string? s, int max) => string.IsNullOrWhiteSpace(s) ? null : s.Length <= max ? s.Trim() : s.Trim()[..max];
}

/// <summary>Browser, operating system, device type and (Android) model of a web user agent: plain rules, no library.</summary>
public static partial class UserAgentInfo
{
    public static (string? Browser, string? Os, string DeviceType, string? Model) Parse(string? ua)
    {
        if (string.IsNullOrWhiteSpace(ua)) return (null, null, "Unknown", null);
        string? browser =
            ua.Contains("Edg/", StringComparison.Ordinal) ? "Edge " + Version(ua, "Edg/")
            : ua.Contains("OPR/", StringComparison.Ordinal) ? "Opera " + Version(ua, "OPR/")
            : ua.Contains("SamsungBrowser/", StringComparison.Ordinal) ? "Samsung Internet " + Version(ua, "SamsungBrowser/")
            : ua.Contains("Firefox/", StringComparison.Ordinal) ? "Firefox " + Version(ua, "Firefox/")
            : ua.Contains("Chrome/", StringComparison.Ordinal) ? "Chrome " + Version(ua, "Chrome/")
            : ua.Contains("Safari/", StringComparison.Ordinal) && ua.Contains("Version/", StringComparison.Ordinal) ? "Safari " + Version(ua, "Version/")
            : null;
        string? os =
            AndroidPattern().Match(ua) is { Success: true } a ? "Android " + a.Groups[1].Value
            : IosPattern().Match(ua) is { Success: true } i ? "iOS " + i.Groups[2].Value.Replace('_', '.')
            : WindowsPattern().Match(ua) is { Success: true } w ? "Windows " + (w.Groups[1].Value == "10.0" ? "10/11" : w.Groups[1].Value)
            : ua.Contains("Mac OS X", StringComparison.Ordinal) ? "macOS"
            : ua.Contains("CrOS", StringComparison.Ordinal) ? "ChromeOS"
            : ua.Contains("Linux", StringComparison.Ordinal) ? "Linux"
            : null;
        var type = ua.Contains("iPad", StringComparison.Ordinal) || ua.Contains("Tablet", StringComparison.Ordinal) ? "Tablet"
            : ua.Contains("Mobi", StringComparison.Ordinal) || ua.Contains("iPhone", StringComparison.Ordinal) || ua.Contains("Android", StringComparison.Ordinal) ? "Mobile"
            : "Desktop";
        var model = AndroidModelPattern().Match(ua) is { Success: true } m && m.Groups[1].Value.Trim() is { Length: > 1 } mv ? mv : null;
        return (browser?.Trim(), os, type, model);
    }

    private static string Version(string ua, string marker)
    {
        var start = ua.IndexOf(marker, StringComparison.Ordinal) + marker.Length;
        var end = start;
        while (end < ua.Length && (char.IsDigit(ua[end]) || ua[end] == '.')) end++;
        var v = ua[start..end];
        var dot = v.IndexOf('.');
        return dot > 0 ? v[..dot] : v;
    }

    [GeneratedRegex(@"Android ([\d.]+)")] private static partial Regex AndroidPattern();
    [GeneratedRegex(@"Android [\d.]+; ([^;)]+?)(?: Build/[^;)]*)?\)")] private static partial Regex AndroidModelPattern();
    [GeneratedRegex(@"(iPhone|iPad|iPod).*?OS ([\d_]+)")] private static partial Regex IosPattern();
    [GeneratedRegex(@"Windows NT ([\d.]+)")] private static partial Regex WindowsPattern();
}

/// <summary>
/// Records the sign-in an action handles (<see cref="ILoginAudit"/>): web logins return the signed-in user
/// (CurrentUserResponse) or a ProblemDetails refusal; the apps' logins return the legacy JSON (status "1" / "0",
/// errorMessage). The user ID is the one typed (or the signed-in user's); the app's DeviceInfo gives the device. A web
/// browser gets a persistent random ID (cookie "zed.device", 2 years), the web counterpart of the apps' device ID.
/// </summary>
[AttributeUsage(AttributeTargets.Method)]
public sealed class LoginAuditAttribute(string channel, string app) : Attribute, IAsyncActionFilter
{
    public const string WebDeviceCookie = "zed.device";
    private static readonly string[] UserIdProperties = ["UserId", "userName", "zedId", "assessorId", "saId"];

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var http = context.HttpContext;
        var request = context.ActionArguments.Values.FirstOrDefault(v => v is not null && v is not CancellationToken);
        var typedUser = UserIdProperties.Select(p => Read(request, p) as string).FirstOrDefault(v => !string.IsNullOrWhiteSpace(v))?.Trim();
        var device = Read(request, "deviceInfo") as DeviceInfo;
        var appVersion = Read(request, "version") as string;
        string? webDevice = channel == LoginChannels.Web ? WebDeviceId(http) : null;

        var executed = await next();

        var (success, reason, user, signedInId) = Outcome(executed);
        var ua = http.Request.Headers.UserAgent.ToString();
        var (browser, os, type, model) = UserAgentInfo.Parse(ua);
        var e = new LoginEvent
        {
            Channel = channel, App = app,
            UserId = user?.UserId ?? signedInId ?? typedUser, ActingUserId = user?.ActingUserId, RoleId = user?.RoleId,
            Success = success, Reason = success ? null : reason ?? (executed.Exception is not null ? "Error" : null),
            IpAddress = http.Connection.RemoteIpAddress?.ToString(),
            UserAgent = string.IsNullOrEmpty(ua) ? null : ua,
            Browser = channel == LoginChannels.Web ? browser : null,
            Os = channel == LoginChannels.Web ? os : (device?.osVersion is { Length: > 0 } ? "Android" : null),
            DeviceType = channel == LoginChannels.Web ? type : "App",
            DeviceId = channel == LoginChannels.Web ? webDevice : device?.deviceId,
            DeviceModel = channel == LoginChannels.Web ? model : JoinModel(device),
            Manufacturer = device?.manufacturer,
            OsVersion = device?.osVersion,
            ApiLevel = device is { apiLevel: > 0 } ? device.apiLevel : null,
            AppVersion = appVersion,
        };
        await http.RequestServices.GetRequiredService<ILoginAudit>().RecordAsync(e, http.RequestAborted);
    }

    private static (bool Success, string? Reason, CurrentUserResponse? User, string? SignedInId) Outcome(ActionExecutedContext executed)
    {
        if (executed.Exception is not null && !executed.ExceptionHandled) return (false, null, null, null);
        switch (executed.Result)
        {
            case ObjectResult { Value: CurrentUserResponse u }:
                return (true, null, u, null);
            case ObjectResult { Value: ProblemDetails p }:
                return (false, p.Title, null, null);
            case ObjectResult { Value: { } value } o when o.StatusCode is null or (>= 200 and < 300):
                // A response that carries the user (Udyami Bharat) or the new ZED ID (registration).
                var inner = value.GetType().GetProperties().Select(p => p.GetValue(value)).OfType<CurrentUserResponse>().FirstOrDefault();
                return (true, null, inner, inner is null ? Read(value, "ZedId") as string ?? Read(value, "UserId") as string : null);
            case ContentResult { Content: { Length: > 0 } json }:
                try
                {
                    using var doc = JsonDocument.Parse(json);
                    var root = doc.RootElement;
                    var status = root.TryGetProperty("status", out var s) ? s.ToString() : null;
                    var message = root.TryGetProperty("errorMessage", out var m) && m.ValueKind == JsonValueKind.String ? m.GetString() : null;
                    return (status == "1", message, null, null);
                }
                catch (JsonException)
                {
                    return (false, "Unreadable response", null, null);
                }
            case IStatusCodeActionResult { StatusCode: { } code }:
                return (code is >= 200 and < 300, $"HTTP {code}", null, null);
            default:
                return (false, null, null, null);
        }
    }

    private static string? JoinModel(DeviceInfo? d)
    {
        if (d is null) return null;
        var parts = new[] { d.device, d.modelProduct }.Where(p => !string.IsNullOrWhiteSpace(p)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        return parts.Count == 0 ? null : string.Join(" / ", parts);
    }

    private static string WebDeviceId(HttpContext http)
    {
        if (http.Request.Cookies.TryGetValue(WebDeviceCookie, out var id) && Guid.TryParseExact(id, "N", out _)) return id;
        id = Guid.NewGuid().ToString("N");
        http.Response.Cookies.Append(WebDeviceCookie, id, new CookieOptions
        {
            HttpOnly = true, Secure = http.Request.IsHttps, SameSite = SameSiteMode.Lax, IsEssential = true, MaxAge = TimeSpan.FromDays(730),
        });
        return id;
    }

    private static object? Read(object? obj, string property) =>
        obj?.GetType().GetProperty(property, BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase)?.GetValue(obj);
}
