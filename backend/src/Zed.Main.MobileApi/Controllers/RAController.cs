using System.Data.Common;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Mobile;
using Zed.Core.Security;
using Zed.Main.MobileApi.Models.Assessor;
using ActivityDetails = Zed.Main.MobileApi.Models.ActivityDetails;
using BasicDetails = Zed.Main.MobileApi.Models.BasicDetails;
using LoginServiceRequest = Zed.Main.MobileApi.Models.LoginServiceRequest;
using MsmeLoginResponse = Zed.Main.MobileApi.Models.MsmeLoginResponse;
using MsmeViewModel = Zed.Main.MobileApi.Models.MsmeViewModel;
using PlantDetails = Zed.Main.MobileApi.Models.PlantDetails;

namespace Zed.Main.MobileApi.Controllers;

/// <summary>
/// The remote assessment app's calls (old SwachhSurvekshanServices RAController), at the same
/// addresses (/RA/{action}). The user of this app is the MSME (Users.RoleId 5, user name = ZED ID),
/// so every call is bound to that ZED ID. There is no video call any more (Twilio was removed): the
/// Twilio fields of the replies stay, always empty, so installed apps keep working without it.
/// </summary>
public sealed class RAController(
    ISqlExecutor db,
    IConfiguration config,
    IDeviceBindings devices,
    AppTokens tokens,
    LoginThrottle throttle,
    MobileStorage storage,
    ILogger<RAController> log) : LegacyMobileController
{
    internal const string InvalidCredentials = "Invalid Credentials.";
    internal const string ErrorText = "An error has occurred, please try again later.";

    /// <summary>Certifications a remote assessment can be for; used in upload paths.</summary>
    /// 2026-11-08: every level of Administration → Certification Levels (Zed.Core.Data.LevelRegistry).
    internal static IReadOnlySet<string> Certifications => new HashSet<string>(LevelRegistry.Codes, StringComparer.OrdinalIgnoreCase);

    [HttpPost]
    [LoginAudit(LoginChannels.Mobile, "Remote assessment app")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<IActionResult> Login(LoginServiceRequest request, CancellationToken ct)
    {
        if (config.GetValue<bool>("Mobile:CheckRaVersion") &&
            !string.Equals(config["Mobile:RaVersion"] ?? "", request.version, StringComparison.Ordinal))
            return LegacyJson(new ServiceResponse { status = "2", errorMessage = SAController.UpdateAppMessage });

        var userName = request.userName?.Trim();
        if (string.IsNullOrEmpty(userName) || string.IsNullOrEmpty(request.password))
            return LegacyJson(new MsmeLoginResponse { status = "0", errorMessage = InvalidCredentials });
        if (throttle.IsLocked(userName))
            return LegacyJson(new MsmeLoginResponse { status = "0", errorMessage = SAController.TooManyAttempts });

        var passwords = PasswordStore.For(db, HttpContext.RequestServices);
        var login = await passwords.BeginLoginAsync(userName, request.password, ct);
        var sets = await db.QueryProcMultipleAsync("SP_APP_MSME_REMOTE_CHECK_LOGIN", new { UserId = userName, Password = login.ProcedurePassword }, ct);
        var user = sets.Count > 0 ? sets[0].FirstOrDefault() : null;
        var masterPassword = user is not null && !await passwords.CompleteLoginAsync(login, user, ct);
        if (user is null || masterPassword || user.Text("RoleId") != "5" || sets[1].Count == 0)
        {
            if (masterPassword) log.LogWarning("Blocked RA app login with a procedure master password for {UserId}", userName);
            throttle.Failed(userName);
            return LegacyJson(new MsmeLoginResponse { status = "0", errorMessage = InvalidCredentials });
        }
        throttle.Succeeded(userName);

        var msme = sets[1][0];
        var basic = sets.FirstRow(2);
        var zedId = msme.Text("ZedId");
        var response = new MsmeLoginResponse
        {
            status = "1",
            MsmeDetails = new MsmeViewModel
            {
                MsmeId = msme.Text("MsmeId"),
                ZedId = zedId,
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
                },
                PlantDetails = new PlantDetails
                {
                    ApplicationId = msme.Text("ApplicationId"),
                    PFlat = msme.Text("PFlat"),
                    PBuilding = msme.Text("PBuilding"),
                    PRoad = msme.Text("PRoad"),
                    PArea = msme.Text("PArea"),
                    PCity = msme.Text("PCity"),
                    PPin = msme.Text("PPin"),
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
            },
            // The old procedure returned the Twilio account SID, API key AND API secret to every
            // MSME that logged in. Video calls were removed: the fields stay, empty.
            TwilioAccountSid = null,
            TwilioApiKey = null,
            TwilioApiSecret = null,
        };

        await devices.RememberAsync(MobileApps.RemoteAssessor, zedId.Length > 0 ? zedId : userName, request.deviceInfo, ClientIp, ct);
        response.appToken = await tokens.IssueAsync(MobileApps.RemoteAssessor, user.Text("UserId") is { Length: > 0 } uid ? uid : userName,
            zedId.Length > 0 ? zedId : userName, ct);
        log.LogInformation("RA app login for {ZedId}", zedId);
        return LegacyJson(response);
    }

    /// <summary>
    /// Also called by the rebuilt ZED MSME app (mobile/apps/zedmsme), signed in through msme/login: it holds an MSME app
    /// token, never an RA one, so this call and <see cref="SubmitSelfie"/> take the MSME app's token and device for the
    /// same ZED ID too (<see cref="DeviceBoundAttribute.AlsoApp"/>; docs/MOBILE-API.md).
    /// </summary>
    [HttpPost]
    [DeviceBound(MobileApps.RemoteAssessor, "userName", AlsoApp = MobileApps.Msme)]
    public async Task<IActionResult> CheckAssessment(SubmitGeoLocationRequest request, CancellationToken ct)
    {
        var sets = await db.QueryProcMultipleAsync("SP_APP_MSME_REMOTE_CHECK_START_ASSESSMENT",
            new { ZedId = request.userName, CertificationType = request.certificationType }, ct);
        if (sets.Count == 0 || sets[0].Count == 0)
            return Fail("Remote Assessment not scheduled for this certification.");
        var row = sets[0][0];
        return LegacyJson(new CheckRemoteAssementResponse
        {
            status = "1",
            assementDate = row.Text("AssessmentDate"),
            allowCalling = row.Text("AllowCalling") == "1",
        });
    }

    /// <summary>
    /// The old Twilio Video token of the "{ZedId} Remote Assessment" room. The response had no status, only the token;
    /// video calls were removed, so the token is always null (as it was on a server without Twilio keys).
    /// </summary>
    [HttpPost]
    [DeviceBound(MobileApps.RemoteAssessor, "userName")]
    public IActionResult GetToken(SubmitGeoLocationRequest request) =>
        LegacyJson(new ServiceResponse { token = null });

    /// <summary>The rebuilt ZED MSME app's call too, with its MSME app token (see <see cref="CheckAssessment"/>).</summary>
    [HttpPost]
    [DeviceBound(MobileApps.RemoteAssessor, "userName", AlsoApp = MobileApps.Msme)]
    public async Task<IActionResult> SubmitSelfie(SubmitSelfieRequest request, CancellationToken ct)
    {
        if (request.photo is not { photo: { Length: > 0 } data } photo)
            return Fail("Selfie not received for the ZED ID: " + request.userName);

        RequireCertification(request.certificationType);
        var folder = storage.Folder("Photos", request.userName, request.certificationType, "RA");
        // The old code stored Path.Combine("/Photos", ...) as built on the Windows server.
        photo.photoPath = string.Join('\\', "/Photos", request.userName!.Trim(), request.certificationType!.Trim(), "RA", "Selfe.jpg");
        await storage.SaveBase64Async(data, folder, "Selfe.jpg", ct);

        return LegacyJson(await ExecAsync("SP_APP_MSME_REMOTE_INSERT_SELFIE", new
        {
            ZedId = request.userName,
            CertificationType = request.certificationType,
            RepresentativeName = request.representativeName,
            Designation = request.representativeDesignation,
            Timestamp = photo.timeStamp,
            PhotoPath = photo.photoPath,
            Latitude = photo.latitude,
            Longitude = photo.longitude,
        }, ct));
    }

    [HttpPost]
    [DeviceBound(MobileApps.RemoteAssessor, "userName")]
    public async Task<IActionResult> SubmitLocation(SubmitGeoLocationRequest request, CancellationToken ct)
    {
        if (request.location is not { latitude: { Length: > 0 } } location) return Fail("Invalid Location.");
        return LegacyJson(await ExecAsync("SP_APP_MSME_REMOTE_INSERT_LOCATION", new
        {
            ZedId = request.userName,
            CertificationType = request.certificationType,
            Timestamp = location.timeStamp,
            Latitude = location.latitude,
            Longitude = location.longitude,
        }, ct));
    }

    private static void RequireCertification(string? certification)
    {
        if (certification is null || !Certifications.Contains(certification.Trim()))
            throw new UnsafePathException($"'{certification}' is not a remote assessment certification.");
    }

    /// <summary>Old DbHelper.ExecuteNonStoredProcedure: a database error becomes {status:"0"} (now without its text).</summary>
    private async Task<ServiceResponse> ExecAsync(string procedure, object args, CancellationToken ct)
    {
        try
        {
            await db.ExecuteProcAsync(procedure, args, ct);
            return new ServiceResponse { status = "1" };
        }
        catch (DbException ex)
        {
            log.LogError(ex, "{Procedure} failed", procedure);
            return ServiceResponse.Fail(ErrorText);
        }
    }

    private static string? NullIfEmpty(string? s) => string.IsNullOrEmpty(s) ? null : s;
}
