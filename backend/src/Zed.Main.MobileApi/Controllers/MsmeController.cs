using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Mobile;
using Zed.Core.Security;
using Zed.Main.MobileApi.Models;

namespace Zed.Main.MobileApi.Controllers;

/// <summary>
/// The ZED MSME app's calls (old SwachhSurvekshanServices MsmeController), at the same addresses
/// (/Msme/{action}) with the same request and response formats.
/// </summary>
public sealed partial class MsmeController(
    ISqlExecutor db,
    IOptions<MobileOptions> options,
    IDeviceBindings devices,
    LoginThrottle throttle,
    TwilioVideoTokens twilio,
    ILogger<MsmeController> log) : LegacyMobileController
{
    private const string UpdateAppMessage = "Download new app from store.";

    /// <summary>Legacy checkMsmeVersion: status "2" tells the app to update.</summary>
    private ContentResult? VersionCheck(string? version) =>
        options.Value.CheckMsmeVersion && !string.Equals(options.Value.MsmeVersion, version, StringComparison.Ordinal)
            ? LegacyJson(new ServiceResponse { status = "2", errorMessage = UpdateAppMessage })
            : null;

    [HttpPost]
    public async Task<IActionResult> Login(LoginServiceRequest request, CancellationToken ct)
    {
        if (VersionCheck(request.version) is { } update) return update;

        var userName = request.userName?.Trim();
        if (string.IsNullOrEmpty(userName) || string.IsNullOrEmpty(request.password))
            return LegacyJson(new MsmeLoginResponse { status = "0", errorMessage = "Invalid Credentials." });
        if (throttle.IsLocked(MobileApps.Msme, userName))
            return LegacyJson(new MsmeLoginResponse { status = "0", errorMessage = "Too many failed attempts. Please try again after 15 minutes." });

        var sets = await db.QueryProcMultipleAsync("SP_APP_MSME_CHECK_LOGIN", new { UserId = userName, Password = request.password }, ct);
        var user = sets.Count > 0 ? sets[0].FirstOrDefault() : null;
        var masterPassword = user is not null && !LegacyPasswords.MatchesStored(user, request.password);
        if (user is null || masterPassword || sets.Count < 4 || sets[1].Count == 0)
        {
            if (masterPassword) log.LogWarning("Blocked app login with a procedure master password for {UserId}", userName);
            throttle.Failed(MobileApps.Msme, userName);
            return LegacyJson(new MsmeLoginResponse { status = "0", errorMessage = "Invalid Credentials." });
        }
        throttle.Succeeded(MobileApps.Msme, userName);

        var msme = sets.FirstRow(1);
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
                msmeStatus = StatusFrom(sets.FirstRow(3)),
            },
            TwilioToken = twilio.Create(userName),
        };

        await devices.RememberAsync(MobileApps.Msme, zedId.Length > 0 ? zedId : userName, request.deviceInfo, ClientIp, ct);
        return LegacyJson(response);
    }

    /// <summary>The button states the app shows (fourth result set of the login procedure, and GetMsmeStatus).</summary>
    internal static MsmeStatus StatusFrom(IDictionary<string, object?> st) => new()
    {
        BronzeStatus = st.Int("BronzeStatus"),
        SilverStatus = st.Int("SilverStatus"),
        GoldStatus = st.Int("GoldStatus"),
        BronzeStatusOfNc = st.Int("BronzeStatusOfNc"),
        SilverStatusOfNc = st.Int("SilverStatusOfNc"),
        GoldStatusOfNc = st.Int("GoldStatusOfNc"),
        bronze = Level(st, "Bronze"),
        silver = Level(st, "Silver"),
        gold = Level(st, "Gold"),
        financialAssistanceStatus = st.Int("FinancialAssistanceStatus"),
        latestCertification = st.Text("latestCertification"),
        dateOfAvail = st.Text("dateOfAvail"),
        joiningRewardAmount = st.Text("joiningRewardAmount"),
        isCouponUsed = st.Bool("isCouponUsed"),
    };

    private static CertificationDetails Level(IDictionary<string, object?> st, string level) => new()
    {
        status = st.Int(level + "Status"),
        ncStatus = st.Int(level + "StatusOfNc"),
        nc1Status = st.Int(level + "StatusOfNc1"),
        nc2Status = st.Int(level + "StatusOfNc2"),
        nc3Status = st.Int(level + "StatusOfNc3"),
        nc4Status = st.Int(level + "StatusOfNc4"),
        nc5Status = st.Int(level + "StatusOfNc5"),
        nc1StatusText = st.Text("Nc1StatusText" + level),
        nc2StatusText = st.Text("Nc2StatusText" + level),
        nc3StatusText = st.Text("Nc3StatusText" + level),
        nc4StatusText = st.Text("Nc4StatusText" + level),
        nc5StatusText = st.Text("Nc5StatusText" + level),
        certificate = st.Text(level + "CertificatePath"),
        report = st.Text(level + "ReportPath"),
        incentives = st.Text(level + "Incentives"),
    };
}
