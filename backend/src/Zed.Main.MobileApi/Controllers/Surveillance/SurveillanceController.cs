using System.Text.Json.Nodes;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Mobile;
using Zed.Core.Security;
using Zed.Main.MobileApi.Models;

namespace Zed.Main.MobileApi.Controllers;

/// <summary>
/// The Bronze surveillance app (old SurveillanceServices SurveillanceController, a copy of the MSME app's
/// controller), at the same addresses (/Surveillance/{action}) with the same request and response formats,
/// served by the Surveillance deployment only (ZED_SURVEILLANCE).
/// <para>
/// The unit's allotted desktop assessor signs in with the assessor id, the unit's ZED ID and the assessor's
/// password, and then enters the unit's self-assessment for it: basic information, evidences and photos,
/// the ESG checklist, the "financial assistance availed" answers, NC replies and the final submit.
/// </para>
/// <para>
/// Added over the old code (finding #109): every call after login is checked against the allotment
/// (<see cref="UnitAsync"/>): the ZED ID and level in the request must have a desktop assessor
/// (MsmeCertifications.DesktopAssessorId), an assessor named in the request (saId / assessorId) must be that
/// one, the call must carry that assessor's app token for that unit (<see cref="AppTokens"/>, app "SURV", issued by
/// Login), the calling device must have signed in as that assessor (device binding, app "SURV"), and writes
/// are accepted only in the matching stage. Uploads go through <see cref="MobileStorage"/>, and request
/// bodies are no longer written to App_Data/Json.
/// </para>
/// </summary>
[PortalSystems(PortalSystem.Surveillance)]
public sealed partial class SurveillanceController(
    ISqlExecutor db,
    IOptions<MobileOptions> options,
    IDeviceBindings devices,
    AppTokens tokens,
    LoginThrottle throttle,
    ILogger<SurveillanceController> log) : SurveillanceControllerBase
{
    private protected override ISqlExecutor Db => db;
    private protected override ILogger Log => log;
    private protected override string LogArea => "Surveillance";

    /// <summary>Device records and app tokens of the Bronze surveillance app (MobileDeviceBindings.AppKind is varchar(10)).</summary>
    internal const string App = MobileApps.Surveillance;

    internal const string InvalidCredentials = "Invalid Credentials.";
    internal const string NotAllocated = "Bronze Surveillance Assessment data not yet allocated for the ZEDID: ";
    internal const string TooManyAttempts = "Too many failed attempts. Please try again after 15 minutes.";
    internal const string DeviceNotRegistered = DeviceBoundAttribute.DeviceNotRegistered;
    private const string UpdateAppMessage = "Download new app from store.";
    private const string DesktopAssessorRoleId = "3";

    /// <summary>The unit's certification rows; the per-call checks pick the level from them.</summary>
    internal const string UnitSql =
        "SELECT Certification, DesktopAssessorId, SiteAssessorId, SaCertificateNo, CertificationStatus, NcCount, " +
        "Nc1Status, Nc2Status, Nc3Status, Nc4Status, Nc5Status FROM MsmeCertifications WHERE ZedId = @ZedId";

    /// <summary>Legacy checkMsmeVersion / msmeVersionNo (the old services used the MSME app's setting): status "2".</summary>
    private ContentResult? VersionCheck(string? version) =>
        options.Value.CheckMsmeVersion && !string.Equals(options.Value.MsmeVersion, version, StringComparison.Ordinal)
            ? LegacyJson(new ServiceResponse { status = "2", errorMessage = UpdateAppMessage })
            : null;

    // ------------------------------------------------------------------ Login

    /// <summary>
    /// SP_APP_SURVEILLANCE_CHECK_LOGIN: set 0 the assessor (RoleId 3, active), sets 1-3 the unit and its button
    /// states, set 4 the unit's certification row at status 1 allotted to this desktop assessor. The procedure
    /// accepts a hard-coded master password, so the typed password must equal the assessor's own.
    /// </summary>
    [HttpPost]
    [LoginAudit(LoginChannels.Mobile, "Surveillance app")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<IActionResult> Login(LoginServiceRequest request, CancellationToken ct)
    {
        if (VersionCheck(request.version) is { } update) return update;

        var assessorId = request.assessorId?.Trim();
        var zedId = request.zedId?.Trim();
        if (string.IsNullOrEmpty(assessorId) || string.IsNullOrEmpty(request.password))
            return LegacyJson(new MsmeLoginResponse { status = "0", errorMessage = InvalidCredentials });
        if (throttle.IsLocked(assessorId))
            return LegacyJson(new MsmeLoginResponse { status = "0", errorMessage = TooManyAttempts });

        var passwords = PasswordStore.For(db, HttpContext.RequestServices);
        var login = await passwords.BeginLoginAsync(assessorId, request.password, ct);
        var sets = await db.QueryProcMultipleAsync("SP_APP_SURVEILLANCE_CHECK_LOGIN",
            new { AssessorId = assessorId, ZedId = zedId, Password = login.ProcedurePassword }, ct);
        var user = sets.Count > 0 ? sets[0].FirstOrDefault() : null;
        var masterPassword = user is not null && !await passwords.CompleteLoginAsync(login, user, ct);
        if (user is null || masterPassword || (user.ContainsKey("RoleId") && user.Text("RoleId") != DesktopAssessorRoleId))
        {
            if (masterPassword) log.LogWarning("Blocked surveillance app login with a procedure master password for {UserId}", assessorId);
            throttle.Failed(assessorId);
            return LegacyJson(new MsmeLoginResponse { status = "0", errorMessage = InvalidCredentials });
        }
        throttle.Succeeded(assessorId);

        // Set 4 has a row only when this assessor is the unit's desktop assessor and the unit is at status 1.
        // The old code then read set 1 unchecked; a unit without an Msme row failed with an error page.
        if (!SurveillanceLogin.Allotted(sets))
            return LegacyJson(new MsmeLoginResponse { status = "0", errorMessage = NotAllocated + request.zedId });

        var response = SurveillanceLogin.Answer(sets);
        var userKey = user.Text("UserId") is { Length: > 0 } id ? id : assessorId;
        // 2026-11-18: one phone per assessor (OnePhoneRule; SURV is enforced by default). The installed app sends no
        // deviceInfo, so its sign-in is not refused unless Mobile:RefuseMissingDevice is set.
        // 2026-11-21: shared with ZED SA's per-unit session (SA/BronzeSurveillanceSession), see SurveillanceLogin.
        if (await SurveillanceLogin.StartAsync(HttpContext, devices, options.Value, tokens, userKey, zedId, request.deviceInfo, request.version,
                response, log, ct) is { } phone)
            return LegacyJson(new MsmeLoginResponse { status = "0", errorMessage = phone });
        log.LogInformation("Surveillance app login for {UserId} on {ZedId}", userKey, zedId);
        return LegacyJson(response);
    }

    // ------------------------------------------------------------------ Per-call allotment check

    /// <summary>What a call needs from the unit's stage.</summary>
    private enum Need
    {
        /// <summary>Reads: allotted at any stage.</summary>
        Read,
        /// <summary>Status 1 and no NC yet: basic info, ESG, financial assistance availed.</summary>
        BeforeFinalSubmit,
        /// <summary>Evidences and photos: before final submit, or while the current NC is open.</summary>
        BeforeFinalSubmitOrNcOpen,
        /// <summary>NC replies.</summary>
        NcOpen,
    }

    /// <summary>
    /// The allotment check behind every call after login. The app names the unit (userName / zedId) and the
    /// level, but usually not the assessor, so the assessor is taken from the allotment: the unit's
    /// DesktopAssessorId must be set, an assessor named in the request must be that one, the app token must be that
    /// assessor's for this unit (Mobile:AppTokens), and the calling device must have signed in as that assessor
    /// (the app's mode, DevicePolicy: Monitor records, Enforce refuses any phone but the registered one). <paramref name="zedId"/> is the
    /// unit the action acts on. Returns the unit row, or the refusal to answer with.
    /// </summary>
    private async Task<(SurveillanceUnit? Unit, IActionResult? Refused)> UnitAsync(string action, string? zedId, string? certification,
        Need need, CancellationToken ct)
    {
        zedId = zedId?.Trim();
        if (string.IsNullOrEmpty(zedId)) return (null, Refuse(action, zedId, certification, "no ZED ID", NotAllocated + zedId));

        var rows = await db.QuerySqlAsync<SurveillanceUnit>(UnitSql,
            new { ZedId = new DbString { Value = zedId, IsAnsi = true, Length = 50 } }, ct);
        var unit = rows.FirstOrDefault(r => !string.IsNullOrWhiteSpace(r.DesktopAssessorId) &&
                                            (string.IsNullOrWhiteSpace(certification) || Same(r.Certification, certification)));
        if (unit is null) return (null, Refuse(action, zedId, certification, "no desktop assessor allotted", NotAllocated + zedId));

        var values = await LegacyRequestValues.GetAsync(HttpContext);
        var named = Text(values.Get("saId")) ?? Text(values.Get("assessorId"));
        if (named is not null && !Same(named, unit.DesktopAssessorId))
            return (null, Refuse(action, zedId, certification, $"{named} is not the allotted assessor", NotAllocated + zedId));

        if (await tokens.RefusalAsync(HttpContext, App, unit.DesktopAssessorId!.Trim(), zedId, ct) is { } expired)
            return (null, expired);
        if (await DeviceRefusalAsync(unit.DesktopAssessorId!.Trim(), DeviceId(values), ct) is { } deviceRefused)
            return (null, deviceRefused);

        var stageOk = need switch
        {
            Need.BeforeFinalSubmit => unit.BeforeFinalSubmit,
            Need.BeforeFinalSubmitOrNcOpen => unit.BeforeFinalSubmit || unit.NcOpen,
            Need.NcOpen => unit.NcOpen,
            _ => true,
        };
        if (!stageOk)
            return (null, Refuse(action, zedId, certification,
                $"stage {unit.CertificationStatus}/NC {unit.NcCount}:{unit.CurrentNcStatus}", MsmeInvalidDetails));
        return (unit, null);
    }

    private const string MsmeInvalidDetails = "Invalid Details.";

    /// <summary>The device check of <see cref="DeviceBoundAttribute"/>, for the assessor found in the allotment.</summary>
    private async Task<IActionResult?> DeviceRefusalAsync(string assessorId, string? deviceId, CancellationToken ct)
    {
        var mode = DevicePolicy.ModeFor(options.Value, App);
        if (mode == DeviceBindingMode.Off) return null;
        var check = await OnePhoneRule.CallCheckAsync(devices, mode, App, assessorId, deviceId, ct);
        if (check is DeviceCheck.Known or DeviceCheck.NoBinding) return null;
        var refuse = mode == DeviceBindingMode.Enforce && (check == DeviceCheck.Unknown || options.Value.RefuseMissingDevice);
        await devices.RecordAsync(App, assessorId, deviceId, HttpContext.Request.Path, ClientIp, check, refuse, ct);
        return refuse ? Fail(DeviceNotRegistered) : null;
    }

    private static string? DeviceId(LegacyRequestValues values) =>
        values.Get("deviceInfo") is JsonObject o && o["deviceId"] is JsonValue v && v.ToString() is { Length: > 0 } s ? s : null;

    private static string? Text(JsonNode? node) => node is JsonValue v && v.ToString() is { Length: > 0 } s && !string.IsNullOrWhiteSpace(s) ? s.Trim() : null;

    private static bool Same(string? a, string? b) =>
        !string.IsNullOrWhiteSpace(a) && !string.IsNullOrWhiteSpace(b) &&
        string.Equals(a.Trim(), b.Trim(), StringComparison.OrdinalIgnoreCase);
}
