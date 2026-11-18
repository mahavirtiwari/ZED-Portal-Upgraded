using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace Zed.Core.Mobile;

/// <summary>
/// The device mode of each mobile app (2026-11-18, the user: "Master admin will release the mobile then assessor can use new
/// one", for every ZED app except the ZED MSME app).
/// <list type="bullet">
/// <item><c>Mobile:DeviceBindingApps:{app}</c> (SA, SURV, RA, MSME) = Off / Monitor / Enforce, when set, decides for that app:
/// the emergency switch of one app.</item>
/// <item>Else <c>Mobile:DeviceBinding</c> (the setting before 2026-11-18): Off turns every app off, Enforce enforces every app.</item>
/// <item>Else (Monitor, the default): the staff apps whose user is one person, the site assessor app (SA; on the Consultancy
/// deployment the consultant app, its fork) and the Bronze surveillance app (SURV), are <b>Enforce</b>; the apps of the unit
/// (MSME, RA: the remote assessment app the MSME signs in to) stay Monitor. <c>Mobile:SaOnePhone = false</c> (the earlier
/// switch of the site assessor app's rule) keeps SA at Monitor.</item>
/// </list>
/// The ZED MSME app (and the RA app, whose user is the unit too) never has the one-phone rule: a unit may sign in on any
/// number of phones; its sign-in is never refused because of another phone, and its calls keep the device binding of before
/// (<c>Mobile:DeviceBinding</c>, Monitor by default: recorded, not refused).
/// </summary>
public static class DevicePolicy
{
    public static DeviceBindingMode ModeFor(MobileOptions options, string app)
    {
        foreach (var (key, mode) in options.DeviceBindingApps)
            if (string.Equals(key, app, StringComparison.OrdinalIgnoreCase)) return mode;
        if (app == MobileApps.Msme || options.DeviceBinding != DeviceBindingMode.Monitor) return options.DeviceBinding;
        if (MobileApps.ActsAsUnit(app)) return DeviceBindingMode.Monitor;
        if (app == MobileApps.SiteAssessor && options.SaOnePhone == false) return DeviceBindingMode.Monitor;
        return DeviceBindingMode.Enforce;
    }

    /// <summary>Whether the app has the one-phone rule: one person's staff app (not the unit's MSME or RA app).</summary>
    public static bool OnePhone(string app) => !MobileApps.ActsAsUnit(app);
}

/// <summary>
/// One phone per staff user and app (<see cref="DevicePolicy"/>), at sign-in and on every call:
/// <list type="bullet">
/// <item>A sign-in from another phone than the user's registered one is refused with <see cref="OtherPhone"/> (status "0" and
/// errorMessage, the legacy sign-in answer every app shows) until the Admin or the Master Admin releases the phone
/// (portal: assessor / consultant → Registered mobile → Release Mobile, which deletes the user's rows of the app).</item>
/// <item>The first sign-in after a release (no phone registered) registers the phone it comes from, with its make, model,
/// OS, API level, app version and IP, and forgets the user's other phones.</item>
/// <item>Calls are refused from any phone but the registered one (<see cref="DeviceBoundAttribute.DeviceNotRegistered"/>).</item>
/// </list>
/// <para>
/// Phones recorded while the app was at Monitor (before the rule was enforced, several phones per user could be recorded):
/// the user's <b>registered</b> phone is the one signed in from last (<see cref="SqlDeviceBindings.RegisteredSql"/>: latest
/// LastLoginAt). A user with exactly one recorded phone keeps it; a user with several keeps the most recent one and the
/// others are refused, at sign-in and on calls, and forgotten at the next sign-in on the kept phone. A user with none
/// registers the first phone that signs in. Nothing has to be cleaned up before switching to Enforce.
/// </para>
/// <para>
/// At Monitor nothing is refused: a sign-in from another phone is recorded (dbo.MobileDeviceEvents, Refused 0) and that phone
/// is recorded too, so that the most recent one is kept when the app is enforced. Off records the phone and checks nothing.
/// A sign-in without <c>deviceInfo.deviceId</c> cannot be told apart: refused under Enforce only when the caller says so
/// (the site assessor app, which always sends it) or <c>Mobile:RefuseMissingDevice</c> is true.
/// </para>
/// </summary>
public static class OnePhoneRule
{
    /// <summary>The text of a sign-in refused because the account is registered on another phone (with its make and model).</summary>
    public static string OtherPhone(string? model) =>
        $"This account is registered on another phone{(string.IsNullOrWhiteSpace(model) ? "" : $" ({model.Trim()})")}. Ask your Master Admin to release it.";

    /// <summary>A sign-in without the phone's details (an old app build).</summary>
    public const string DeviceInfoMissing = "Device information missing. Please update the app.";

    /// <summary>
    /// The refusal text of a sign-in of <paramref name="userKey"/> to <paramref name="app"/> from <paramref name="device"/>, or
    /// null when it may go on. A refusal (and, at Monitor, a sign-in that would have been refused) is recorded as a device event.
    /// </summary>
    public static async Task<string?> SignInRefusalAsync(HttpContext http, IDeviceBindings devices, MobileOptions options, string app, string userKey,
        DeviceInfo? device, ILogger log, CancellationToken ct, bool refuseMissing = false, string? missingMessage = null)
    {
        var mode = DevicePolicy.ModeFor(options, app);
        if (mode == DeviceBindingMode.Off || !DevicePolicy.OnePhone(app) || string.IsNullOrWhiteSpace(userKey)) return null;
        var deviceId = device?.deviceId?.Trim();
        if (string.IsNullOrEmpty(deviceId))
            return mode == DeviceBindingMode.Enforce && (refuseMissing || options.RefuseMissingDevice) ? missingMessage ?? DeviceInfoMissing : null;
        if (await devices.RegisteredAsync(app, userKey, ct) is not { } registered
            || string.Equals(registered.DeviceId, deviceId, StringComparison.Ordinal)) return null;

        var refuse = mode == DeviceBindingMode.Enforce;
        log.LogWarning("{App} sign-in of {UserId} from device {Device}: registered on device {Registered} ({Action})", app, userKey, deviceId,
            registered.DeviceId, refuse ? "refused" : "allowed, Monitor");
        await devices.RecordAsync(app, userKey, deviceId, http.Request.Path, http.Connection.RemoteIpAddress?.ToString(), DeviceCheck.Unknown, refuse, ct);
        return refuse ? OtherPhone(registered.Model) : null;
    }

    /// <summary>
    /// After a successful sign-in: records the phone (make, model, OS, API level, app version, IP) and, when the app is
    /// enforced, forgets the user's other phones, so the registered phone is this one.
    /// </summary>
    public static async Task RegisterAsync(HttpContext http, IDeviceBindings devices, MobileOptions options, string app, string userKey,
        DeviceInfo? device, string? appVersion, CancellationToken ct)
    {
        await devices.RememberAsync(app, userKey, device, http.Connection.RemoteIpAddress?.ToString(), appVersion, ct);
        if (DevicePolicy.ModeFor(options, app) == DeviceBindingMode.Enforce && DevicePolicy.OnePhone(app)
            && device?.deviceId?.Trim() is { Length: > 0 } id && !string.IsNullOrWhiteSpace(userKey))
            await devices.KeepOnlyAsync(app, userKey, id, ct);
    }

    /// <summary>
    /// The device check of a call under the one-phone rule: Known only for the registered phone (the one signed in from
    /// last), so the other phones recorded at Monitor are refused too; NoBinding when none is registered (released).
    /// </summary>
    public static async Task<DeviceCheck> CheckAsync(IDeviceBindings devices, string app, string userKey, string? deviceId, CancellationToken ct)
    {
        if (await devices.RegisteredAsync(app, userKey, ct) is not { } registered) return DeviceCheck.NoBinding;
        var id = deviceId?.Trim();
        if (string.IsNullOrEmpty(id)) return DeviceCheck.Missing;
        return string.Equals(registered.DeviceId, id, StringComparison.Ordinal) ? DeviceCheck.Known : DeviceCheck.Unknown;
    }

    /// <summary>The check of a call in the app's mode: the one-phone check when enforced for a staff app, else any recorded phone.</summary>
    public static Task<DeviceCheck> CallCheckAsync(IDeviceBindings devices, DeviceBindingMode mode, string app, string userKey, string? deviceId,
        CancellationToken ct) =>
        mode == DeviceBindingMode.Enforce && DevicePolicy.OnePhone(app)
            ? CheckAsync(devices, app, userKey, deviceId, ct)
            : devices.CheckAsync(app, userKey, deviceId, ct);
}
