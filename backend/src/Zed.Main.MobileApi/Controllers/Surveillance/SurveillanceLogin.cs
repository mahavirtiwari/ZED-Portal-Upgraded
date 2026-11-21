using Zed.Core.Data;
using Zed.Core.Mobile;
using Zed.Main.MobileApi.Models;

namespace Zed.Main.MobileApi.Controllers;

/// <summary>
/// The Bronze surveillance sign-in of a desktop assessor for one unit, shared by the ZED Surveillance app's
/// <see cref="SurveillanceController.Login"/> (assessor id + ZED ID + password) and ZED SA's per-unit session
/// (SA/BronzeSurveillanceSession, 2026-11-21: Bronze surveillance moved into ZED SA; the assessor's password was checked by
/// ZED SA's sign-in on the surveillance host and its app token is the proof). Both read SP_APP_SURVEILLANCE_CHECK_LOGIN's
/// sets 1 to 4, answer the same JSON and register the phone and issue the app token of app "SURV" the same way, so every
/// Surveillance/* call made afterwards is checked exactly as before.
/// </summary>
internal static class SurveillanceLogin
{
    /// <summary>
    /// The unit part of the old login's rule: set 4 (MsmeCertifications at status 1 with this desktop assessor) has a row
    /// and set 1 (the unit's Msme row) has one.
    /// </summary>
    public static bool Allotted(ResultSets sets) => sets.Count >= 5 && sets[4].Count > 0 && sets[1].Count > 0;

    /// <summary>The login answer (MsmeLoginResponse) from sets 1 to 3; the token is added by <see cref="StartAsync"/>.</summary>
    public static MsmeLoginResponse Answer(ResultSets sets)
    {
        var msme = sets.FirstRow(1);
        var basic = sets.FirstRow(2);
        return new MsmeLoginResponse
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
            TwilioToken = null, // video calls were removed; the field stays for the installed apps
        };
    }

    /// <summary>
    /// After the checks passed: the one-phone rule of app "SURV" for <paramref name="userKey"/> (the refusal text, or null),
    /// then the phone is registered and the SURV token for the assessor and the unit (set 4's unit) is put in
    /// <paramref name="response"/>.
    /// </summary>
    public static async Task<string?> StartAsync(HttpContext http, IDeviceBindings devices, MobileOptions options, AppTokens tokens, string userKey,
        string? requestedZedId, DeviceInfo? device, string? version, MsmeLoginResponse response, ILogger log, CancellationToken ct)
    {
        if (await OnePhoneRule.SignInRefusalAsync(http, devices, options, MobileApps.Surveillance, userKey, device, log, ct) is { } phone)
            return phone;
        await OnePhoneRule.RegisterAsync(http, devices, options, MobileApps.Surveillance, userKey, device, version, ct);
        // The token binds the assessor and the unit the login was checked for (set 4).
        var unit = response.MsmeDetails?.ZedId is { Length: > 0 } unitId ? unitId : requestedZedId;
        response.appToken = await tokens.IssueAsync(MobileApps.Surveillance, userKey, unit, ct);
        return null;
    }
}
