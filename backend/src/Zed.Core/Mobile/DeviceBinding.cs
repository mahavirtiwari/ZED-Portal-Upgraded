using System.Collections.Concurrent;
using System.Reflection;
using System.Text.Json;
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

/// <summary>
/// Which mobile app a call comes from; device records and app tokens are kept per app, and these are the names of the
/// per-app settings (<c>Mobile:AppTokens:Apps:SA</c>). Each deployment has its own settings, so "SA" is the site
/// assessor app on Main and Surveillance and the consultant app (its fork) on Consultancy.
/// </summary>
public static class MobileApps
{
    public const string Msme = "MSME";
    public const string SiteAssessor = "SA";
    public const string RemoteAssessor = "RA";
    /// <summary>The Bronze surveillance app (com.qci.zed.bronzesurveillance), signed in to by the unit's desktop assessor.</summary>
    public const string Surveillance = "SURV";

    /// <summary>Apps whose user is the unit itself: a call names the ZED ID, which is compared with the token's unit.</summary>
    public static bool ActsAsUnit(string app) => app is Msme or RemoteAssessor;
}

public enum DeviceCheck { Known, Unknown, Missing, NoBinding }

public interface IDeviceBindings
{
    /// <summary>Call after a successful login: this device may act for this user from now on.</summary>
    Task RememberAsync(string app, string userKey, DeviceInfo? device, string? ip, CancellationToken ct = default);

    Task<DeviceCheck> CheckAsync(string app, string userKey, string? deviceId, CancellationToken ct = default);

    Task RecordAsync(string app, string userKey, string? deviceId, string path, string? ip, DeviceCheck outcome, bool refused, CancellationToken ct = default);

    /// <summary>A call without a valid app token (<see cref="AppTokens"/>), with the device events (Outcome "Token…").</summary>
    Task RecordTokenAsync(string app, string userKey, string path, string? ip, AppTokenCheck outcome, bool refused, CancellationToken ct = default);
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

    public Task RecordAsync(string app, string userKey, string? deviceId, string path, string? ip, DeviceCheck outcome, bool refused, CancellationToken ct = default)
    {
        if (!Due($"{app}|{userKey}|{deviceId}|{path}|{outcome}", refused)) return Task.CompletedTask;
        logger.LogWarning("Mobile call {Path} for {App} user {User} from {Outcome} device {Device} ({Action})",
            path, app, userKey, outcome, deviceId ?? "(none)", refused ? "refused" : "allowed");
        return InsertAsync(app, userKey, deviceId, path, ip, outcome.ToString(), refused, ct);
    }

    public Task RecordTokenAsync(string app, string userKey, string path, string? ip, AppTokenCheck outcome, bool refused, CancellationToken ct = default)
    {
        if (!Due($"{app}|{userKey}|token|{path}|{outcome}", refused)) return Task.CompletedTask;
        logger.LogWarning("Mobile call {Path} for {App} user {User}: app token {Outcome} ({Action})",
            path, app, userKey, outcome, refused ? "refused" : "allowed");
        // Outcome is varchar(20): "TokenOtherUser" is the longest.
        return InsertAsync(app, userKey, null, path, ip, "Token" + outcome, refused, ct);
    }

    /// <summary>Refusals always; other events once per key every 10 minutes.</summary>
    private bool Due(string key, bool refused)
    {
        var now = DateTime.UtcNow;
        if (recent.TryGetValue(key, out var last) && now - last < TimeSpan.FromMinutes(10) && !refused) return false;
        recent[key] = now;
        if (recent.Count > 50_000) recent.Clear();
        return true;
    }

    private async Task InsertAsync(string app, string userKey, string? deviceId, string path, string? ip, string outcome, bool refused, CancellationToken ct)
    {
        try
        {
            await sql.ExecuteSqlAsync("""
                INSERT INTO dbo.MobileDeviceEvents (AppKind, UserKey, DeviceId, Path, Ip, Outcome, Refused, At)
                VALUES (@App, @User, @Device, @Path, @Ip, @Outcome, @Refused, SYSDATETIME())
                """,
                new
                {
                    App = app, User = Truncate(userKey, 100), Device = Truncate(Clean(deviceId), 200), Path = Truncate(path, 200),
                    Ip = Truncate(ip, 50), Outcome = Truncate(outcome, 20), Refused = refused,
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
/// Marks an action that acts for one user. The filter finds the user in the bound request (first non-blank of
/// <see cref="UserFields"/>) and the device in <c>deviceInfo.deviceId</c>, checks the app sign-in token
/// (<see cref="AppTokens"/>: issued to that user, or for the MSME and RA apps to that unit) and that this device has
/// signed in as that user (see <see cref="DeviceBindingMode"/>).
/// <para>
/// The user is read from the action's own arguments, the values the action acts on (finding H1): a complex parameter
/// reads the nested <c>request</c> object when the body has one, so a user named at the top of the body must not
/// decide the check. The raw request values are read only when no parameter has any of the fields.
/// </para>
/// </summary>
[AttributeUsage(AttributeTargets.Method)]
public sealed class DeviceBoundAttribute(string app, params string[] userFields) : Attribute, IAsyncActionFilter
{
    public const string DeviceNotRegistered = "This device is not registered for your account. Please login again.";

    public string App { get; } = app;

    public IReadOnlyList<string> UserFields { get; } = userFields.Length > 0 ? userFields : ["zedId", "userName"];

    /// <summary>
    /// Another app that may make this call as well, signed in as the same user (the rebuilt ZED MSME app makes the remote
    /// assessment calls RA/CheckAssessment and RA/SubmitSelfie with its own MSME sign-in). A call that carries a genuine
    /// token of this app is checked as this app's: its token for the same user / unit, and the devices it signed in on;
    /// in the mode of <see cref="App"/>. Any other call is checked as <see cref="App"/>'s, as before.
    /// </summary>
    public string? AlsoApp { get; set; }

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var http = context.HttpContext;
        var options = http.RequestServices.GetService(typeof(IOptions<MobileOptions>)) as IOptions<MobileOptions>;
        var tokens = http.RequestServices.GetService(typeof(AppTokens)) as AppTokens;
        var mode = options?.Value.DeviceBinding ?? DeviceBindingMode.Off;
        if (mode == DeviceBindingMode.Off && (tokens is null || tokens.ModeFor(App) == AppTokenMode.Off))
        {
            await next();
            return;
        }

        var values = await LegacyRequestValues.GetAsync(http);
        var user = FindUser(context, values);

        // The app whose token and devices the call is checked against: AlsoApp when its token comes with the call.
        var app = AlsoApp is not null && tokens?.Read(http.Request.Headers[AppTokens.Header].ToString()) is { } token &&
                  string.Equals(token.App, AlsoApp, StringComparison.OrdinalIgnoreCase) ? AlsoApp : App;
        if (tokens is not null)
        {
            var asUnit = MobileApps.ActsAsUnit(app);
            if (await tokens.RefusalAsync(http, App, asUnit ? null : user, asUnit ? user : null, http.RequestAborted, tokenApp: app) is { } expired)
            {
                context.Result = expired;
                return;
            }
        }

        if (mode == DeviceBindingMode.Off || string.IsNullOrWhiteSpace(user))
        {
            await next();
            return;
        }

        var deviceId = FindDeviceId(context, values);
        var bindings = (IDeviceBindings)http.RequestServices.GetService(typeof(IDeviceBindings))!;
        var check = await bindings.CheckAsync(app, user, deviceId, http.RequestAborted);
        if (check is DeviceCheck.Known or DeviceCheck.NoBinding)
        {
            await next();
            return;
        }

        var refuse = mode == DeviceBindingMode.Enforce &&
                     (check == DeviceCheck.Unknown || options!.Value.RefuseMissingDevice);
        await bindings.RecordAsync(app, user, deviceId, http.Request.Path, http.Connection.RemoteIpAddress?.ToString(), check, refuse, http.RequestAborted);
        if (refuse)
        {
            context.Result = LegacyResults.Json(ServiceResponse.Fail(DeviceNotRegistered));
            return;
        }
        await next();
    }

    /// <summary>
    /// The first non-blank of <see cref="UserFields"/>, in that order, as the actions take it (<c>First(saId, userName)</c>).
    /// Only from the action's parameters when any of them has one of the fields (a blank one counts as given: the action
    /// acts on the next field, or on nothing); from the raw request values otherwise.
    /// </summary>
    internal string? FindUser(ActionExecutingContext context, LegacyRequestValues values)
    {
        var declared = false;
        foreach (var field in UserFields)
        foreach (var p in context.ActionDescriptor.Parameters)
        {
            context.ActionArguments.TryGetValue(p.Name, out var arg);
            if (!TryRead(p.Name, p.ParameterType, arg, field, out var value)) continue;
            declared = true;
            if (!string.IsNullOrWhiteSpace(value)) return value.Trim();
        }
        if (declared) return null;
        foreach (var field in UserFields)
            if (values.Get(field) is JsonValue v && v.ToString() is { } s && !string.IsNullOrWhiteSpace(s)) return s.Trim();
        return null;
    }

    /// <summary><c>deviceInfo.deviceId</c> of the bound model when it has a deviceInfo, else of the raw request.</summary>
    private static string? FindDeviceId(ActionExecutingContext context, LegacyRequestValues values)
    {
        foreach (var p in context.ActionDescriptor.Parameters)
        {
            if (Property(p.ParameterType, "deviceInfo") is not { } prop || prop.PropertyType != typeof(DeviceInfo)) continue;
            context.ActionArguments.TryGetValue(p.Name, out var arg);
            var id = arg is null ? null : (prop.GetValue(arg) as DeviceInfo)?.deviceId;
            return string.IsNullOrWhiteSpace(id) ? null : id;
        }
        if (values.Get("deviceInfo") is JsonObject o && o["deviceId"] is JsonValue v && v.ToString() is { Length: > 0 } s) return s;
        return null;
    }

    /// <summary>
    /// Whether parameter <paramref name="name"/> carries <paramref name="field"/>: a string parameter of that name, a JSON
    /// body (<c>[FromBody] JsonElement</c>) with that property, or a model with that string property; and its value.
    /// </summary>
    private static bool TryRead(string name, Type type, object? arg, string field, out string? value)
    {
        value = null;
        if (type == typeof(string))
        {
            if (!string.Equals(name, field, StringComparison.OrdinalIgnoreCase)) return false;
            value = arg as string;
            return true;
        }
        if (type == typeof(JsonElement))
        {
            if (arg is not JsonElement { ValueKind: JsonValueKind.Object } body) return false;
            foreach (var p in body.EnumerateObject())
                if (string.Equals(p.Name, field, StringComparison.OrdinalIgnoreCase))
                {
                    value = p.Value.ValueKind is JsonValueKind.String ? p.Value.GetString() : p.Value.ValueKind is JsonValueKind.Number ? p.Value.GetRawText() : null;
                    return true;
                }
            return false;
        }
        if (type.IsPrimitive || type.IsEnum || type == typeof(decimal) || type == typeof(CancellationToken)) return false;
        if (Property(type, field) is not { } prop || prop.PropertyType != typeof(string)) return false;
        value = arg is null ? null : prop.GetValue(arg) as string;
        return true;
    }

    /// <summary>A public instance property by name, the exact spelling first (models may have zedId and ZedId).</summary>
    private static PropertyInfo? Property(Type type, string name)
    {
        PropertyInfo? match = null;
        foreach (var p in type.GetProperties(BindingFlags.Public | BindingFlags.Instance))
        {
            if (p.GetIndexParameters().Length > 0) continue;
            if (string.Equals(p.Name, name, StringComparison.Ordinal)) return p;
            if (match is null && string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase)) match = p;
        }
        return match;
    }
}
