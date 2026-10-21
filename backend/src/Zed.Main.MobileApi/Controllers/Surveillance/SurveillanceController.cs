using System.Text.Json.Nodes;
using Dapper;
using Microsoft.AspNetCore.Mvc;
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
/// one, the calling device must have signed in as that assessor (device binding, app "SURV"), and writes
/// are accepted only in the matching stage. Uploads go through <see cref="MobileStorage"/>, and request
/// bodies are no longer written to App_Data/Json.
/// </para>
/// </summary>
[PortalSystems(PortalSystem.Surveillance)]
public sealed partial class SurveillanceController(
    ISqlExecutor db,
    IOptions<MobileOptions> options,
    IDeviceBindings devices,
    LoginThrottle throttle,
    TwilioVideoTokens twilio,
    ILogger<SurveillanceController> log) : LegacyMobileController
{
    /// <summary>Device records of the Bronze surveillance app (MobileDeviceBindings.AppKind is varchar(10)).</summary>
    internal const string App = "SURV";

    internal const string InvalidCredentials = "Invalid Credentials.";
    internal const string NotAllocated = "Bronze Surveillance Assessment data not yet allocated for the ZEDID: ";
    internal const string TooManyAttempts = "Too many failed attempts. Please try again after 15 minutes.";
    internal const string DeviceNotRegistered = "This device is not registered for your account. Please login again.";
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
    public async Task<IActionResult> Login(LoginServiceRequest request, CancellationToken ct)
    {
        if (VersionCheck(request.version) is { } update) return update;

        var assessorId = request.assessorId?.Trim();
        var zedId = request.zedId?.Trim();
        if (string.IsNullOrEmpty(assessorId) || string.IsNullOrEmpty(request.password))
            return LegacyJson(new MsmeLoginResponse { status = "0", errorMessage = InvalidCredentials });
        if (throttle.IsLocked(App, assessorId))
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
            throttle.Failed(App, assessorId);
            return LegacyJson(new MsmeLoginResponse { status = "0", errorMessage = InvalidCredentials });
        }
        throttle.Succeeded(App, assessorId);

        // Set 4 has a row only when this assessor is the unit's desktop assessor and the unit is at status 1.
        // The old code then read set 1 unchecked; a unit without an Msme row failed with an error page.
        if (sets.Count < 5 || sets[4].Count == 0 || sets[1].Count == 0)
            return LegacyJson(new MsmeLoginResponse { status = "0", errorMessage = NotAllocated + request.zedId });

        var msme = sets.FirstRow(1);
        var basic = sets.FirstRow(2);
        var response = new MsmeLoginResponse
        {
            status = "1",
            MsmeDetails = new MsmeViewModel
            {
                MsmeId = msme.Text("MsmeId"),
                ZedId = msme.Text("ZedId"),
                CertificateNo = msme.Text("PledgeCertificateNo"),
                DateOfPledge = msme.Text("DateOfPledge"),
                PledgeEmailId = msme.Text("PledgeEmailId"),
                BasicDetails = new BasicDetails
                {
                    ApplicationId = basic.Text("ApplicationId"),
                    UdyogAadharNo = basic.Text("UdyogAadharNo"),
                    OwnerName = basic.Text("OwnerName"),
                    EnterpriseName = basic.Text("EnterpriseName"),
                    OrganisationType = basic.Text("OrganisationType"),
                    OrganisationTypeName = basic.Text("OrganisationTypeName"),
                    SocialCategory = basic.Text("SocialCategory"),
                    SocialCategoryName = basic.Text("SocialCategoryName"),
                    Gender = basic.Text("Gender"),
                    PH = basic.Text("PH"),
                    PanNo = basic.Text("PanNo"),
                    Address = basic.Text("Address"),
                    State_Id = basic.Text("StateId"),
                    state_name = basic.Text("StateName"),
                    District_Id = basic.Text("DistrictId"),
                    DISTRICT_NAME = basic.Text("DistrictName"),
                    LG_DT_Code = basic.Text("LgDistrictCode"),
                    PINCode = basic.Text("PinCode"),
                    MobileNo = basic.Text("MobileNo"),
                    EmailId = basic.Text("EmailId"),
                    MajorActivity = basic.Text("MajorActivity"),
                    MajorActivityName = basic.Text("MajorActivityName"),
                    EnterpriseType = basic.Text("EnterpriseType"),
                    EnterpriseTypee = basic.Text("EnterpriseTypee"),
                    CommmenceDate = basic.Text("CommmenceDate"),
                    PreviousEMType = basic.Text("PreviousEMType"),
                    PreviousEMNumber = basic.Text("PreviousEMNumber"),
                    TotalEmp = basic.Text("TotalEmp"),
                    InvestmentCost = basic.Text("InvestmentCost"),
                    Dic_Name = basic.Text("DicName"),
                    AppliedDate = basic.Text("AppliedDate"),
                    IncorporationDate = msme.Text("IncorporationDate"),
                    WhetherProdCommenced = msme.Text("WhetherProdCommenced"),
                },
                PlantDetails = new PlantDetails
                {
                    ApplicationId = msme.Text("ApplicationId"),
                    UnitName = msme.Text("PUnitName"),
                    PFlat = msme.Text("PFlat"),
                    PBuilding = msme.Text("PBuilding"),
                    PRoad = msme.Text("PRoad"),
                    PArea = msme.Text("PArea"),
                    PCity = msme.Text("PCity"),
                    PPin = msme.Text("PPin"),
                    PAddress = msme.Text("PAddress"),
                    state_id = msme.Text("PStateId"),
                    state_name = msme.Text("PStateName"),
                    DISTRICT_NAME = msme.Text("PDistrictName"),
                    LG_DT_Code = msme.Text("PLgDistrictCode"),
                    PlantDetail_Id = msme.Text("PPlantDetailId"),
                },
                ActivityDetails = new ActivityDetails
                {
                    ApplicationId = msme.Text("ApplicationId"),
                    Activity = msme.Text("Activity"),
                    Two_DigitActivity = msme.Text("TwoDigitActivity"),
                    Four_DigitActivity = msme.Text("FourDigitActivity"),
                    Five_DigitActivity = msme.Text("FiveDigitActivity"),
                    ActivityDetail_Id = msme.Text("ActivityDetailId"),
                },
                msmeStatus = MsmeController.StatusFrom(sets.FirstRow(3)),
            },
            // The old code built the token from request.userName, which this app's login does not need.
            TwilioToken = twilio.Create(request.userName),
        };

        var userKey = user.Text("UserId") is { Length: > 0 } id ? id : assessorId;
        await devices.RememberAsync(App, userKey, request.deviceInfo, ClientIp, ct);
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
    /// DesktopAssessorId must be set, an assessor named in the request must be that one, and the calling device
    /// must have signed in as that assessor (Mobile:DeviceBinding as for the other apps: Monitor records, Enforce
    /// refuses). Returns the unit row, or the refusal to answer with.
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

    private ContentResult Refuse(string action, string? zedId, string? certification, string reason, string message)
    {
        log.LogWarning("Surveillance/{Action} refused for {ZedId} {Certification}: {Reason}", action, zedId, certification, reason);
        return Fail(message);
    }

    /// <summary>The device check of <see cref="DeviceBoundAttribute"/>, for the assessor found in the allotment.</summary>
    private async Task<IActionResult?> DeviceRefusalAsync(string assessorId, string? deviceId, CancellationToken ct)
    {
        var mode = options.Value.DeviceBinding;
        if (mode == DeviceBindingMode.Off) return null;
        var check = await devices.CheckAsync(App, assessorId, deviceId, ct);
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
