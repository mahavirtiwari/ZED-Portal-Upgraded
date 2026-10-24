using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Http;
using Zed.Core.Mobile;

// Field-for-field copies of the old DataModels / SwachhSurvekshanServices.Models classes that the
// MSME app's other calls (password, status, assessment, NC, financial assistance) send and read.
// Names, casing and order are the wire format; do not rename or tidy them. Unset fields are sent
// as null, as before.
#pragma warning disable IDE1006 // lower-case names are the legacy contract
namespace Zed.Main.MobileApi.Models;

// ---------- Requests ----------

public sealed class ChangePwdRequest
{
    public string? userName { get; set; }
    public string? oldPassword { get; set; }
    public string? newPassword { get; set; }
}

/// <summary>DataModels.PhotoInformation.</summary>
public class PhotoInformation
{
    public bool isPdf { get; set; }
    public string? videoId { get; set; }
    public string? photoId { get; set; }
    /// <summary>Base64 file content.</summary>
    public string? photo { get; set; }
    public string? photoPath { get; set; }
    public string? timeStamp { get; set; }
    public string? name { get; set; }
    public string? photoType { get; set; }
    public string? latitude { get; set; }
    public string? longitude { get; set; }
    public string? comment { get; set; }
}

/// <summary>Models.PhotoInformationFile: a photo whose content comes as the multipart part photos[i].file_data.</summary>
public sealed class PhotoInformationFile : PhotoInformation
{
    [JsonIgnore]
    public IFormFile? file_data { get; set; }
}

public sealed class SubmitPhotosRequestFile
{
    public string? userName { get; set; }
    public string? zedId { get; set; }
    public string? certificationType { get; set; }
    public List<PhotoInformationFile>? photos { get; set; }
}

public sealed class EsgChecklistRequest : BaseServiceRequest
{
    public List<EsgChecklist>? esgChecklist { get; set; }
    public List<EsgChecklist>? socialOhsChecklist { get; set; }
}

public sealed class EsgChecklist
{
    public int code { get; set; }
    public string? question { get; set; }
    public string? answer { get; set; }
    public string? ifYesQuestion { get; set; }
    public string? ifYesAnswer { get; set; }
    public string? ifNoQuestion { get; set; }
    public string? ifNoAnswer { get; set; }
}

public sealed class BasicInformationRequest : BaseServiceRequest
{
    public BasicInformation? basicInformation { get; set; }
    /// <summary>New in V4 (Admin → App Forms): answers to the Admin's own fields by field key (docs/mobile/APP-FORMS.md).</summary>
    public Dictionary<string, System.Text.Json.JsonElement>? customFields { get; set; }
    /// <summary>New in V4: version of the form definition the app filled in; when sent, the required fields are enforced.</summary>
    public string? formVersion { get; set; }
}

public sealed class BasicInformation
{
    public string? auditsConducted { get; set; }
    public List<ProductDetails>? productDetailsList { get; set; }
    public string? domesticCustomers { get; set; }
    public string? internationalCustomers { get; set; }
    public string? rawMaterialImported { get; set; }
    public List<RawMaterialDetails>? rawMaterialsList { get; set; }
    public string? outsourcedProcesses { get; set; }
    public List<string>? energySources { get; set; }

    public List<PhotoInformation>? siteExteriorPhotos { get; set; }
    public PhotoInformation? assessorSelfie { get; set; }

    public string? monthlyManufacturingCapacityUnits { get; set; }
    public string? monthlyManufacturingCapacityValue { get; set; }
    public string? monthlyUtilizationUnits { get; set; }
    public string? monthlyUtilizationValue { get; set; }
}

/// <summary>Models.ProductDetails (request and GetNcDetailsByType response).</summary>
public sealed class ProductDetails
{
    public int productId { get; set; }
    public string? productName { get; set; }
    public string? exported { get; set; }
    public PhotoInformation? productPhoto { get; set; }
    public PhotoInformation? productDescriptionPhoto { get; set; }
    public string? productPhotoPath { get; set; }
    public string? productDescriptionPhotoPath { get; set; }
    public string? assessorRemarks { get; set; }
    public string? msmeRemarks { get; set; }
}

public sealed class RawMaterialDetails
{
    public int rawMaterialId { get; set; }
    public string? rawMaterialName { get; set; }
    public string? rawMaterialPercentage { get; set; }
    public string? countryName { get; set; }
}

public sealed class EvidenceRequest : BaseServiceRequest
{
    public bool isFirst { get; set; }
    public bool isLast { get; set; }
    public string? evidenceId { get; set; }
    /// <summary>A PhotoInformation as a JSON string (SubmitEvidenceV2).</summary>
    public string? photo { get; set; }
    public PhotoInformation? photoObj { get; set; }
    public List<PhotoInformation>? photos { get; set; }
}

/// <summary>
/// Models.NcRequirementSubmitRequest. The old class re-declared userName and certificationType
/// with <c>new</c>; the wire format is the same, so the base properties are used here (a hidden
/// property would make the device-binding lookup ambiguous).
/// </summary>
public sealed class NcRequirementSubmitRequest : BaseServiceRequest
{
    public string? requirementId { get; set; }
    public string? requirementCode { get; set; }
    /// <summary>A PhotoInformation as a JSON string.</summary>
    public string? photo { get; set; }
    public PhotoInformation? photoObj { get; set; }
    public bool isFirst { get; set; }
    public bool isLast { get; set; }
    public string? msmeRemarks { get; set; }
}

public sealed class NcProductSubmitRequest : BaseServiceRequest
{
    /// <summary>A ProductDetails as a JSON string.</summary>
    public string? productDetailsNc { get; set; }
    public ProductDetails? productDetailsNcObj { get; set; }
}

public sealed class NcSiteSubmitRequest : BaseServiceRequest
{
    public string? msmeRemarks { get; set; }
    public List<PhotoInformation>? photos { get; set; }
}

public sealed class FacilitatorDetails : BaseServiceRequest
{
    public string? phoneNumber { get; set; }
    public string? email { get; set; }
    /// <summary>A PhotoInformation as a JSON string.</summary>
    public string? selfieMetadata { get; set; }
    public PhotoInformation? selfieMetadataObj { get; set; }
}

/// <summary>DataModels.VideoSubmitRequest (left over from the Ganga town app).</summary>
public sealed class VideoSubmitRequest
{
    public string? videoId { get; set; }
    public string? videoName { get; set; }
    public string? localPath { get; set; }
    public string? recordingStartTime { get; set; }
    public string? latitude { get; set; }
    public string? logitude { get; set; }
    public string? username { get; set; }
    public string? ulbCode { get; set; }
    public string? ghatId { get; set; }
}

/// <summary>DataModels.FinancialViewModel.</summary>
public sealed class FinancialViewModel
{
    public string? ZedId { get; set; }
    public string? CertificationType { get; set; }
    public string? CertId { get; set; }
    public string? TechnologyCode { get; set; }
    public string? TechnologyName { get; set; }
    public CertificationInfo? CertificationDetails { get; set; }
    public ExpenditureInfo? ExpenditureDetails { get; set; }
    public AccountInfo? AccountDetails { get; set; }
}

public sealed class CertificationInfo
{
    public string? CategoryOfCertificate { get; set; }
    public string? NameOfCertficate { get; set; }
    public string? CertificationAgency { get; set; }
    public string? CertficateNumber { get; set; }
    public string? DateOfIssue { get; set; }
    public string? ValidityOfCertificate { get; set; }
    public string? AnyOtherInformation { get; set; }
    public List<PhotoInformation>? Photos { get; set; }
}

public sealed class ExpenditureInfo
{
    public string? ExpenditureCertficate { get; set; }
    public string? AgencyOrSupplier { get; set; }
    public string? InvoiceNo { get; set; }
    public string? InvoiceBillDate { get; set; }
    public string? AmountPaid { get; set; }
    public string? ModeOfPayment { get; set; }
    public string? EligibleAmount { get; set; }
    public List<PhotoInformation>? Photos { get; set; }
    public List<PhotoInformation>? InvoicePhotos { get; set; }
}

public sealed class AccountInfo
{
    public string? AccountNo { get; set; }
    public string? IfscCode { get; set; }
    public string? BranchAddress { get; set; }
    public string? BankName { get; set; }
    public List<PhotoInformation>? Photos { get; set; }
}

// ---------- Responses ----------

public sealed class ParametersResponse : ServiceResponse
{
    public List<ParameterDetails>? parameters { get; set; }
}

public sealed class NcResponse : ServiceResponse
{
    public string? assessorRemarksSite { get; set; }
    public List<string>? siteExteriorPhotos { get; set; }
    public List<ProductDetails>? products { get; set; }
    public List<ParameterDetails>? parameters { get; set; }
}

public sealed class ParameterDetails
{
    public int id { get; set; }
    public string? code { get; set; }
    public string? label { get; set; }
    public List<RequirementDetails>? requirements { get; set; }
}

public sealed class RequirementDetails
{
    public int id { get; set; }
    public string? code { get; set; }
    public List<OptionInfo>? options { get; set; }

    public string? answerCode { get; set; }
    public string? remarks { get; set; }
    public string? assessorRemarks { get; set; }
    public string? msmeRemarks { get; set; }
    public List<EvidenceInfo>? evidences { get; set; }
    public List<PhotoInformation>? photos { get; set; }
    public List<PhotoInformation>? addedEvidences { get; set; }
    public string? conformance { get; set; }
    public string? comments { get; set; }
}

public sealed class EvidenceInfo
{
    public int id { get; set; }
    public string? code { get; set; }
    public string? label { get; set; }
    public string? iButton { get; set; }
    public bool validationRequired { get; set; }
    public List<PhotoInformation>? photos { get; set; }
}

public sealed class OptionInfo
{
    public int id { get; set; }
    public string? code { get; set; }
    public string? label { get; set; }
    public string? image { get; set; }
    public List<SubOption>? subOptions { get; set; }
}

public sealed class SubOption
{
    public int id { get; set; }
    public string? code { get; set; }
    public string? label { get; set; }
}
