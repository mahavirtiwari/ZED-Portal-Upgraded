using System.Collections.Concurrent;
using System.Reflection;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Zed.Core.Data;

namespace Zed.Core.Mobile;

public enum DeviceBindingMode
{
    /// <summary>No checks.</summary>
    Off,
    /// <summary>Unknown and missing devices are recorded; nothing is refused. Run this first.</summary>
    Monitor,
    /// <summary>Calls from a device that never signed in as that user are refused.</summary>
    Enforce,
}

/// <summary>The legacy apps' DeviceInfo object.</summary>
public sealed class DeviceInfo
{
    public string? deviceId { get; set; }
    public string? osVersion { get; set; }
    public int apiLevel { get; set; }
    public string? device { get; set; }
    public string? modelProduct { get; set; }
    public string? manufacturer { get; set; }
}

/// <summary>Which mobile app a call comes from; device records are kept per app.</summary>
public static class MobileApps
{
    public const string Msme = "MSME";
    public const string SiteAssessor = "SA";
    public const string RemoteAssessor = "RA";
}

public enum DeviceCheck { Known, Unknown, Missing, NoBinding }

public interface IDeviceBindings
{
    /// <summary>Call after a successful login: this device may act for this user from now on.</summary>
    Task RememberAsync(string app, string userKey, DeviceInfo? device, string? ip, CancellationToken ct = default);

    Task<DeviceCheck> CheckAsync(string app, string userKey, string? deviceId, CancellationToken ct = default);

    Task RecordAsync(string app, string userKey, string? deviceId, string path, string? ip, DeviceCheck outcome, bool refused, CancellationToken ct = default);
}

/// <summary>Device records in ZEDCS_V2_LIVE (database/schema/05_mobile_devices.sql).</summary>
public sealed class SqlDeviceBindings(ISqlExecutor sql, ILogger<SqlDeviceBindings> logger) : IDeviceBindings
{
    // Event rows are rate-limited per (app, user, device, path) so a busy app does not flood the table.
    private readonly ConcurrentDictionary<string, DateTime> recent = new();

    public async Task RememberAsync(string app, string userKey, DeviceInfo? device, string? ip, CancellationToken ct = default)
    {
        var deviceId = Clean(device?.deviceId);
        if (deviceId is null || string.IsNullOrWhiteSpace(userKey)) return;
        await sql.ExecuteSqlAsync("""
            MERGE dbo.MobileDeviceBindings AS t
            USING (SELECT @App AS AppKind, @User AS UserKey, @Device AS DeviceId) AS s
               ON t.AppKind = s.AppKind AND t.UserKey = s.UserKey AND t.DeviceId = s.DeviceId
            WHEN MATCHED THEN UPDATE SET LastLoginAt = SYSDATETIME(), LastSeenAt = SYSDATETIME(), LastIp = @Ip,
                 Model = @Model, OsVersion = @Os
            WHEN NOT MATCHED THEN INSERT (AppKind, UserKey, DeviceId, Model, OsVersion, FirstSeenAt, LastLoginAt, LastSeenAt, LastIp)
                 VALUES (@App, @User, @Device, @Model, @Os, SYSDATETIME(), SYSDATETIME(), SYSDATETIME(), @Ip);
            """,
            new
            {
                App = app, User = userKey.Trim(), Device = deviceId, Ip = Truncate(ip, 50),
                Model = Truncate($"{device!.manufacturer} {device.modelProduct}".Trim(), 100),
                Os = Truncate(device.osVersion, 50),
            }, ct);
    }

    public async Task<DeviceCheck> CheckAsync(string app, string userKey, string? deviceId, CancellationToken ct = default)
    {
        var known = await sql.QuerySqlAsync<string>(
            "SELECT DeviceId FROM dbo.MobileDeviceBindings WHERE AppKind = @App AND UserKey = @User",
            new { App = app, User = userKey.Trim() }, ct);
        if (known.Count == 0) return DeviceCheck.NoBinding;
        var id = Clean(deviceId);
        if (id is null) return DeviceCheck.Missing;
        return known.Contains(id, StringComparer.Ordinal) ? DeviceCheck.Known : DeviceCheck.Unknown;
    }

    public async Task RecordAsync(string app, string userKey, string? deviceId, string path, string? ip, DeviceCheck outcome, bool refused, CancellationToken ct = default)
    {
        var key = $"{app}|{userKey}|{deviceId}|{path}|{outcome}";
        var now = DateTime.UtcNow;
        if (recent.TryGetValue(key, out var last) && now - last < TimeSpan.FromMinutes(10) && !refused) return;
        recent[key] = now;
        if (recent.Count > 50_000) recent.Clear();

        logger.LogWarning("Mobile call {Path} for {App} user {User} from {Outcome} device {Device} ({Action})",
            path, app, userKey, outcome, deviceId ?? "(none)", refused ? "refused" : "allowed");
        try
        {
            await sql.ExecuteSqlAsync("""
                INSERT INTO dbo.MobileDeviceEvents (AppKind, UserKey, DeviceId, Path, Ip, Outcome, Refused, At)
                VALUES (@App, @User, @Device, @Path, @Ip, @Outcome, @Refused, SYSDATETIME())
                """,
                new
                {
                    App = app, User = Truncate(userKey, 100), Device = Truncate(Clean(deviceId), 200), Path = Truncate(path, 200),
                    Ip = Truncate(ip, 50), Outcome = outcome.ToString(), Refused = refused,
                }, ct);
        }
        catch (Exception ex)
        {
            // Monitoring must never break a call.
            logger.LogError(ex, "Could not record a mobile device event");
        }
    }

    private static string? Clean(string? deviceId) =>
        string.IsNullOrWhiteSpace(deviceId) ? null : Truncate(deviceId.Trim(), 200);

    private static string? Truncate(string? s, int max) => s is null ? null : s.Length <= max ? s : s[..max];
}

/// <summary>
/// Marks an action that acts for one user. The filter finds the user in the bound request
/// (first non-empty of <see cref="UserFields"/>) and the device in <c>deviceInfo.deviceId</c>, and
/// checks that this device has signed in as that user (see <see cref="DeviceBindingMode"/>).
/// </summary>
[AttributeUsage(AttributeTargets.Method)]
public sealed class DeviceBoundAttribute(string app, params string[] userFields) : Attribute, IAsyncActionFilter
{
    public string App { get; } = app;

    public IReadOnlyList<string> UserFields { get; } = userFields.Length > 0 ? userFields : ["zedId", "userName"];

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var http = context.HttpContext;
        var options = http.RequestServices.GetService(typeof(IOptions<MobileOptions>)) as IOptions<MobileOptions>;
        var mode = options?.Value.DeviceBinding ?? DeviceBindingMode.Off;
        if (mode == DeviceBindingMode.Off)
        {
            await next();
            return;
        }

        var values = await LegacyRequestValues.GetAsync(http);
        var user = FindUser(context.ActionArguments.Values, values);
        if (string.IsNullOrWhiteSpace(user))
        {
            await next();
            return;
        }

        var deviceId = FindDeviceId(context.ActionArguments.Values, values);
        var bindings = (IDeviceBindings)http.RequestServices.GetService(typeof(IDeviceBindings))!;
        var check = await bindings.CheckAsync(App, user, deviceId, http.RequestAborted);
        if (check is DeviceCheck.Known or DeviceCheck.NoBinding)
        {
            await next();
            return;
        }

        var refuse = mode == DeviceBindingMode.Enforce &&
                     (check == DeviceCheck.Unknown || options!.Value.RefuseMissingDevice);
        await bindings.RecordAsync(App, user, deviceId, http.Request.Path, http.Connection.RemoteIpAddress?.ToString(), check, refuse, http.RequestAborted);
        if (refuse)
        {
            context.Result = LegacyResults.Json(ServiceResponse.Fail("This device is not registered for your account. Please login again."));
            return;
        }
        await next();
    }

    private string? FindUser(IEnumerable<object?> args, LegacyRequestValues values)
    {
        foreach (var field in UserFields)
        {
            if (values.Get(field) is JsonValue v && v.ToString() is { Length: > 0 } s) return s.Trim();
            foreach (var arg in args)
                if (ReadString(arg, field) is { Length: > 0 } fromModel) return fromModel.Trim();
        }
        return null;
    }

    private static string? FindDeviceId(IEnumerable<object?> args, LegacyRequestValues values)
    {
        if (values.Get("deviceInfo") is JsonObject o && o["deviceId"] is JsonValue v && v.ToString() is { Length: > 0 } s) return s;
        foreach (var arg in args)
        {
            var device = arg?.GetType().GetProperty("deviceInfo", BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase)?.GetValue(arg);
            if (ReadString(device, "deviceId") is { Length: > 0 } id) return id;
        }
        return null;
    }

    private static string? ReadString(object? target, string property) =>
        target?.GetType().GetProperty(property, BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase)
            ?.GetValue(target) as string;
}
