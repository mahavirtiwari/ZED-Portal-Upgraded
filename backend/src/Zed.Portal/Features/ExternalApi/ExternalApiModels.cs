// Request and response shapes of the old external APIs, with the property names and order the MVC 5
// JavaScriptSerializer produced (DataModels.Responses / Msme / Requests, SwatchSarvekshan.Models).
// Classes that derived from ApiServiceResponse4 are flattened with the derived properties first, as
// reflection listed them. Nulls are written, as before. Do not rename: other systems parse these.
#pragma warning disable IDE1006 // legacy property names
namespace Zed.Portal.Features.ExternalApi;

public class ApiServiceResponse4
{
    public string? StatusCode { get; set; }
    public string? StatusMessage { get; set; }
}

/// <summary>DataModels.ApiServiceResponse; Data (the hotel UnitDetails of Unit/*) is always null here.</summary>
public sealed class ApiServiceResponse
{
    public string? StatusCode { get; set; }
    public string? StatusMessage { get; set; }
    public object? Data { get; set; }
    public BasicDetailsApi? BasicDetails { get; set; }
    public ActivityDetailsApi? ActivityDetails { get; set; }
    public PlantDetailsApi? PlantDetails { get; set; }
    public CertificationDetailsApi? CertificationDetails { get; set; }

    public static ApiServiceResponse Status(string code, string? message = null) => new() { StatusCode = code, StatusMessage = message };

    public static ApiServiceResponse Secure500() => Status("500", "Unable process your request, please try again later.");
}

public sealed class ApiServiceResponse3
{
    public string? StatusCode { get; set; }
    public string? StatusMessage { get; set; }
    public PlantDetailsApi3? PlantDetails { get; set; }
    public CertificationDetailsApi3? CertificationDetails { get; set; }
}

public sealed class ApiServiceResponseMultiCert
{
    public string? StatusCode { get; set; }
    public string? StatusMessage { get; set; }
    public List<MultiCertificationDetailsApi>? certifications { get; set; }
}

public sealed class ApiCertifiedUnitsServiceResponse
{
    public string? StatusCode { get; set; }
    public string? StatusMessage { get; set; }
    public int TotalRecords { get; set; }
    public int PageNo { get; set; }
    public int PageSize { get; set; }
    public List<CertifiedUnitDetails>? Data { get; set; }
}

public sealed class StateCertificationsResponse
{
    public List<ApCertificationDetails>? certifications { get; set; }
    public int TotalCount { get; set; }
    public int PageNo { get; set; }
    public int PageSize { get; set; }
    public string? StatusCode { get; set; }
    public string? StatusMessage { get; set; }
}

public sealed class ApCertificationDetails
{
    public string? RefId { get; set; }
    public string? EnterpriseName { get; set; }
    public string? UdyamNumber { get; set; }
    public string? PlantId { get; set; }
    public string? Applicationtype { get; set; }
    public string? ApplicationPaymentDate { get; set; }
    public string? CertificateNumber { get; set; }
    public string? CertificationType { get; set; }
    public string? CertifiedDate { get; set; }
    public string? CertificateExpiryDate { get; set; }
    public string? MileStone { get; set; }
    public string? State { get; set; }
    public string? District { get; set; }
    public string? PlantAddress { get; set; }
    public string? ApplicationStatus { get; set; }
    public decimal ApplicationFee { get; set; }
    public string? JoiningReward { get; set; }
    public decimal CentralGovernmentSubsidyPercentage { get; set; }
    public decimal AndhraPradeshGovernmentSubsidyPercentage { get; set; }
    public decimal AndhraPradeshGovernmentSubsidyAmount { get; set; }
}

public sealed class ApiRegisterServiceResponse
{
    public string? RefId { get; set; }
    public string? ZedId { get; set; }
    public string? RequestId { get; set; }
    public string? UdyogAadharNo { get; set; }
    public string? PlantId { get; set; }
    public string? Base64File { get; set; }
    public string? FileType { get; set; }
    public string? FileExtension { get; set; }
    public string? StatusCode { get; set; }
    public string? StatusMessage { get; set; }
}

public sealed class ApiGetCertificatesByUdyamResponse
{
    public List<ApiGetCertificateList>? Certificates { get; set; }
    public string? StatusCode { get; set; }
    public string? StatusMessage { get; set; }
}

public sealed class ApiGetCertificateList
{
    public List<ApiFileInfo>? file { get; set; }
    public string? Applieddate { get; set; }
    public string? ZED { get; set; }
    public string? PlantID { get; set; }
    public string? Applicationstatus { get; set; }
    public string? Udyamid { get; set; }
}

/// <summary>DataModels.FileInfo.</summary>
public sealed class ApiFileInfo
{
    public string? Filetype { get; set; }
    public string? FileID { get; set; }
    public string? FileName { get; set; }
}

/// <summary>DataModels.FileInfo2.</summary>
public sealed class ApiFileInfo2
{
    public string? Filetype { get; set; }
    public string? Fileextension { get; set; }
    public string? Filename { get; set; }
    public string? File { get; set; }
}

public sealed class Api3GetCertificateDetailsByUdyamResponse
{
    public List<ApiFileInfo2>? file { get; set; }
    public string? ZED { get; set; }
    public string? PlantID { get; set; }
    public string? Udyamid { get; set; }
    public string? StatusCode { get; set; }
    public string? StatusMessage { get; set; }
}

public sealed class PlantDetailsApi3
{
    public string? UnitName { get; set; }
    public string? PAddress { get; set; }
    public string? PPin { get; set; }
    public string? state_name { get; set; }
    public string? DISTRICT_NAME { get; set; }
    public string? LG_DT_Code { get; set; }
}

public sealed class CertificationDetailsApi3
{
    public string? CertificationDate { get; set; }
    public string? ExpiryDate { get; set; }
    public string? BronzeCertified { get; set; }
    public string? SilverCertified { get; set; }
    public string? GoldCertified { get; set; }
    public string? CertificationFee { get; set; }
    public string? SubsidyAmount { get; set; }
    public string? AmountPaid { get; set; }
}

public sealed class BasicDetailsApi
{
    public string? ApplicationId { get; set; }
    public string? UdyogAadharNo { get; set; }
    public string? OwnerName { get; set; }
    public string? EnterpriseName { get; set; }
    public string? OrganisationType { get; set; }
    public string? SocialCategory { get; set; }
    public string? Gender { get; set; }
    public string? PH { get; set; }
    public string? PanNo { get; set; }
    public string? Address { get; set; }
    public string? state_name { get; set; }
    public string? DISTRICT_NAME { get; set; }
    public string? LG_DT_Code { get; set; }
    public string? PINCode { get; set; }
    public string? MobileNo { get; set; }
    public string? EmailId { get; set; }
    public string? MajorActivity { get; set; }
    public string? EnterpriseType { get; set; }
    public string? IncorporationDate { get; set; }
    public string? WhetherProdCommenced { get; set; }
    public string? CommmenceDate { get; set; }
    public string? TotalEmp { get; set; }
    public string? Dic_Name { get; set; }
    public string? AppliedDate { get; set; }
}

public sealed class PlantDetailsApi
{
    public string? ApplicationId { get; set; }
    public string? UnitIdNo { get; set; }
    public string? UnitName { get; set; }
    public string? UAM_No { get; set; }
    public string? PlantIdNo { get; set; }
    public string? PAddress { get; set; }
    public string? PPin { get; set; }
    public string? state_name { get; set; }
    public string? DISTRICT_NAME { get; set; }
    public string? LG_DT_Code { get; set; }
}

public sealed class ActivityDetailsApi
{
    public string? ApplicationId { get; set; }
    public string? Activity { get; set; }
    public string? Two_DigitActivity { get; set; }
    public string? Four_DigitActivity { get; set; }
    public string? Five_DigitActivity { get; set; }
}

public sealed class CertificationDetailsApi
{
    public string? RegisteredDate { get; set; }
    public string? ExpiryDate { get; set; }
    public string? BronzeCertified { get; set; }
    public string? SilverCertified { get; set; }
    public string? GoldCertified { get; set; }
    public string? Certificate { get; set; }
}

public sealed class MultiCertificationDetailsApi
{
    public string? UnitName { get; set; }
    public string? StateName { get; set; }
    public string? DistrictName { get; set; }
    public string? UdyamNo { get; set; }
    public string? CertificateNo { get; set; }
    public string? CertificationType { get; set; }
    public string? CertificationStatusDate { get; set; }
    public string? Expired { get; set; }
}

public sealed class CertifiedUnitDetails
{
    public string? Sno { get; set; }
    public string? EnterpriseName { get; set; }
    public string? TwoDigitActivity { get; set; }
    public string? UnitAddress { get; set; }
    public string? StateName { get; set; }
    public string? EnterpriseTypee { get; set; }
    public string? Certification { get; set; }
}

// ----- RAMP dashboard (SwatchSarvekshan.Models.RampDashboardMsmeListDto) -----

public sealed class RampDashboardMsmeListDto
{
    public List<RampDashboardMsmeDto>? msmeList { get; set; }
    public int ToalCount { get; set; }
    public int PageNo { get; set; }
    public int PageSize { get; set; }
    public string? StatusCode { get; set; }
}

public sealed class RampDashboardHandholdingListDto
{
    public List<RampDashboardHandholdingDto>? handholdingList { get; set; }
    public int ToalCount { get; set; }
    public int PageNo { get; set; }
    public int PageSize { get; set; }
    public string? StatusCode { get; set; }
}

public sealed class RampDashboardMsmeDto
{
    public string? Certification { get; set; }
    public string? RegistrationDate { get; set; }
    public string? CertificationDate { get; set; }
    public string? SectorsName { get; set; }
    public string? ApplicationStatus { get; set; }
    public string? ReasonForRejection { get; set; }
    public string? ApplicationCertificationCategory { get; set; }
    public string? AssessmentStatus { get; set; }
    public string? CreatedOn { get; set; }
    public string? MsmeCertId { get; set; }
    public string? Id { get; set; }
    public string? ZedId { get; set; }
    public string? UnitName { get; set; }
    public string? StateName { get; set; }
    public string? DistrictName { get; set; }
    public string? EnterpriseType { get; set; }
    public string? Gender { get; set; }
    public string? SocialCategoryName { get; set; }
    public string? UdyogAadharNo { get; set; }
}

public sealed class RampDashboardHandholdingDto
{
    public string? SectorName { get; set; }
    public string? HandholdingOptedDate { get; set; }
    public string? HandholdingLevelCertification { get; set; }
    public string? Milestone1Process { get; set; }
    public string? DateofM1Completion { get; set; }
    public string? Milestone2Process { get; set; }
    public string? DateofM2Completion { get; set; }
    public string? Milestone3Process { get; set; }
    public string? FinalDateofCompletion { get; set; }
    public string? Id { get; set; }
    public string? ZedId { get; set; }
    public string? UnitName { get; set; }
    public string? StateName { get; set; }
    public string? DistrictName { get; set; }
    public string? EnterpriseType { get; set; }
    public string? Gender { get; set; }
    public string? SocialCategoryName { get; set; }
    public string? UdyogAadharNo { get; set; }
}

// ----- Requests -----

/// <summary>ApiSecure envelope: the client's secret in clear, the payload AES-encrypted with the client's key.</summary>
public sealed class EncryptedRequestDto
{
    public string? ClientSecret { get; set; }
    public string? AesIV { get; set; }
    public string? EncryptedData { get; set; }
}

public sealed class TokenRequestDto
{
    public string? ClientId { get; set; }
    public string? ClientSecret { get; set; }
    public string? AesIV { get; set; }
}

public sealed class DetailsByCertificationDto
{
    public string? Token { get; set; }
    public string? UdyamNumber { get; set; }
    public string? CertificationNumber { get; set; }
    public string? ClientSecret { get; set; }
}

public sealed class GetMsmeListDto
{
    public string? PageNo { get; set; }
    public string? PageSize { get; set; }
    public string? ClientSecret { get; set; }
    public string? Token { get; set; }
}

public sealed class UdyamCertificationNumber
{
    public string? UdyamNumber { get; set; }
    public string? CertificationNumber { get; set; }
}

public sealed class SubmitIncentiveRequest
{
    public string? Pin { get; set; }
    public string? ApplicationId { get; set; }
    public string? UnitName { get; set; }
    public string? District { get; set; }
    public string? Certificateno { get; set; }
    public string? UdyamNo { get; set; }
    public string? FCI { get; set; }
    public DateTime? DateOfProduction { get; set; }
    public string? ServiceName { get; set; }
    public DateTime? AppliedDate { get; set; }
    public string? ApprovalId { get; set; }
    public DateTime? ApprovedDate { get; set; }
    public string? IncentiveName { get; set; }
    public DateTime? DisbursedDate { get; set; }
    public string? DisbursedAmount { get; set; }
}

public sealed class UploadReceiptInvoiceRequest
{
    public string? token { get; set; }
    public string? zedId { get; set; }
    public string? documentType { get; set; }
    public string? tadaInvoiceNo { get; set; }
    public string? base64InvoiceData { get; set; }
}

/// <summary>DataModels.MsmeRegisterApiwModel (Msme/RegisterPlant).</summary>
public sealed class MsmeRegisterApiModel
{
    public string? Token { get; set; }
    public string? RequestId { get; set; }
    public string? ReqTimeStamp { get; set; }
    public string? UserMobileNo { get; set; }
    public string? UserEmail { get; set; }
    public string? RegistrationType { get; set; }
    public string? RegistrationFrom { get; set; }
    public UdyamBasicDetails? UdyamDetails { get; set; }
    public UdyamActivityDetails? ActivityDetails { get; set; }
    public UdyamPlantDetails? PlantDetails { get; set; }
}

public sealed class UdyamBasicDetails
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

public sealed class UdyamPlantDetails
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

public sealed class UdyamActivityDetails
{
    public string? ApplicationId { get; set; }
    public string? Activity { get; set; }
    public string? Two_DigitActivity { get; set; }
    public string? Four_DigitActivity { get; set; }
    public string? Five_DigitActivity { get; set; }
    public string? ActivityDetail_Id { get; set; }
}
