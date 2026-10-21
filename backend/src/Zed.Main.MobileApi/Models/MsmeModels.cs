using Zed.Core.Mobile;

// Field-for-field copies of the old DataModels classes the MSME app reads. Names, casing and
// order are the wire format; do not rename or tidy them. Unset fields are sent as null, as before.
#pragma warning disable IDE1006 // lower-case names are the legacy contract
namespace Zed.Main.MobileApi.Models;

public sealed class LoginServiceRequest
{
    public string? zedId { get; set; }
    public string? assessorId { get; set; }
    public string? userName { get; set; }
    public string? password { get; set; }
    public string? version { get; set; }
    public DeviceInfo? deviceInfo { get; set; }
}

public class BaseServiceRequest
{
    public DeviceInfo? deviceInfo { get; set; }
    public string? version { get; set; }
    public string? userName { get; set; }
    public string? zedId { get; set; }
    public string? saId { get; set; }
    public string? certificationType { get; set; }
}

public sealed class MsmeLoginResponse : ServiceResponse
{
    public string? TwilioAccountSid { get; set; }
    public string? TwilioApiKey { get; set; }
    public string? TwilioApiSecret { get; set; }
    public string? TwilioToken { get; set; }
    public MsmeViewModel? MsmeDetails { get; set; }
}

public sealed class MsmeViewModel
{
    public string? MsmeId { get; set; }
    public string? ZedId { get; set; }
    /// <summary>Always null: kept only because the old response had the field.</summary>
    public string? Password { get; set; }
    public string? CertificateNo { get; set; }
    public string? QrCodeNo { get; set; }
    public string? DateOfPledge { get; set; }
    public string? PledgeEmailId { get; set; }
    public string? RegistrationType { get; set; }
    public string? RegistrationFrom { get; set; }

    public BasicDetails? BasicDetails { get; set; }
    public ActivityDetails? ActivityDetails { get; set; }
    public PlantDetails? PlantDetails { get; set; }
    public MsmeStatus? msmeStatus { get; set; }
}

public sealed class MsmeStatus : ServiceResponse
{
    public int BronzeStatus { get; set; }
    public int SilverStatus { get; set; }
    public int GoldStatus { get; set; }
    public int BronzeStatusOfNc { get; set; }
    public int SilverStatusOfNc { get; set; }
    public int GoldStatusOfNc { get; set; }

    public int financialAssistanceStatus { get; set; }
    public CertificationDetails? bronze { get; set; }
    public CertificationDetails? silver { get; set; }
    public CertificationDetails? gold { get; set; }

    public string? latestCertification { get; set; }
    public string? dateOfAvail { get; set; }
    public string? joiningRewardAmount { get; set; }
    public bool isCouponUsed { get; set; }
}

public sealed class CertificationDetails
{
    public int status { get; set; }
    public int ncStatus { get; set; }
    public int nc1Status { get; set; }
    public int nc2Status { get; set; }
    public int nc3Status { get; set; }
    public int nc4Status { get; set; }
    public int nc5Status { get; set; }
    public string? certificate { get; set; }
    public string? report { get; set; }
    public string? incentives { get; set; }
    public string? remoteStatus { get; set; }
    public string? surveillanceStatus { get; set; }
    public string? surveillanceDate { get; set; }

    public string? nc1StatusText { get; set; }
    public string? nc2StatusText { get; set; }
    public string? nc3StatusText { get; set; }
    public string? nc4StatusText { get; set; }
    public string? nc5StatusText { get; set; }
}

public sealed class BasicDetails
{
    public string? ApplicationId { get; set; }
    public string? UdyogAadharNo { get; set; }
    public string? OwnerName { get; set; }
    public string? EnterpriseName { get; set; }
    public string? OrganisationType { get; set; }
    public string? OrganisationTypeName { get; set; }
    public string? SocialCategory { get; set; }
    public string? SocialCategoryName { get; set; }
    public string? Gender { get; set; }
    public string? PH { get; set; }
    public string? PanNo { get; set; }
    public string? Address { get; set; }
    public string? State_Id { get; set; }
    public string? state_name { get; set; }
    public string? District_Id { get; set; }
    public string? DISTRICT_NAME { get; set; }
    public string? LG_DT_Code { get; set; }
    public string? PINCode { get; set; }
    public string? MobileNo { get; set; }
    public string? EmailId { get; set; }
    public string? MajorActivity { get; set; }
    public string? MajorActivityName { get; set; }
    public string? EnterpriseType { get; set; }
    public string? EnterpriseTypee { get; set; }
    public string? CommmenceDate { get; set; }
    public string? PreviousEMType { get; set; }
    public string? PreviousEMNumber { get; set; }
    public string? TotalEmp { get; set; }
    public string? InvestmentCost { get; set; }
    public string? Dic_Name { get; set; }
    public string? AppliedDate { get; set; }
    public string? IncorporationDate { get; set; }
    public string? WhetherProdCommenced { get; set; }
}

public sealed class ActivityDetails
{
    public string? ApplicationId { get; set; }
    public string? Activity { get; set; }
    public string? Two_DigitActivity { get; set; }
    public string? Four_DigitActivity { get; set; }
    public string? Five_DigitActivity { get; set; }
    public string? ActivityDetail_Id { get; set; }
}

public sealed class PlantDetails
{
    public string? ApplicationId { get; set; }
    public string? UAM_No { get; set; }
    public string? PFlat { get; set; }
    public string? PBuilding { get; set; }
    public string? PRoad { get; set; }
    public string? PArea { get; set; }
    public string? PCity { get; set; }
    public string? PAddress { get; set; }
    public string? PPin { get; set; }
    public string? state_id { get; set; }
    public string? state_name { get; set; }
    public string? DISTRICT_NAME { get; set; }
    public string? LG_DT_Code { get; set; }
    public string? PlantDetail_Id { get; set; }
    public string? PlantIdNo { get; set; }
    public string? UnitName { get; set; }
    public string? UnitIdNo { get; set; }
    public bool ZedCertified { get; set; }
}
