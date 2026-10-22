using Zed.Core.Mobile;

// Field-for-field copies of the old DataModels / SwachhSurvekshanServices.Models classes the site
// assessment (SA) and remote assessment (RA) apps send and read. Names, casing and order are the
// wire format; do not rename or tidy them. Unset fields are sent as null, as before.
// They live in their own namespace because the MSME app's models (Zed.Main.MobileApi.Models) have
// classes with the same old names (PhotoInformation, BasicInformation, ...).
#pragma warning disable IDE1006 // lower-case names are the legacy contract
namespace Zed.Main.MobileApi.Models.Assessor;

// ---------- Shared pieces (DataModels.DataModel / Responses) ----------

public sealed class PhotoInformation
{
    public bool isPdf { get; set; }
    public string? videoId { get; set; }
    public string? photoId { get; set; }
    public string? photo { get; set; }
    public string? photoPath { get; set; }
    public string? timeStamp { get; set; }
    public string? name { get; set; }
    public string? photoType { get; set; }
    public string? latitude { get; set; }
    public string? longitude { get; set; }
    public string? comment { get; set; }
}

public sealed class Participant
{
    public string? name { get; set; }
    public string? designation { get; set; }
}

public sealed class MSMEProfile
{
    public string? saDate { get; set; }
    public string? zedId { get; set; }
    public string? msmeName { get; set; }
    public string? sectorId { get; set; }
    public string? sectorName { get; set; }
    public string? unitAddress { get; set; }
    public string? email { get; set; }
    public string? phone { get; set; }
}

public sealed class AssessorDetails
{
    public string? assessorId { get; set; }
    public string? assessorName { get; set; }
    public string? userType { get; set; }
}

public sealed class ParametersDetails
{
    public string? parameterId { get; set; }
    public string? parameterCode { get; set; }
    public string? parameterName { get; set; }
    public string? parameterType { get; set; }
    public string? assigneeName { get; set; }
    public string? assigneeId { get; set; }
    public bool isExcemptedFromSa { get; set; }
}

public sealed class AllottedParameters
{
    public string? Id { get; set; }
    public string? parameterId { get; set; }
    public string? parameterCode { get; set; }
    public string? parameterName { get; set; }
    public string? parameterType { get; set; }
    public string? status { get; set; }
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

public sealed class MsmeProductDetails
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

// ---------- SwachhSurvekshanServices.Models (AppRequest / AppResponse) ----------

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

/// <summary>SA/Login response (SwachhSurvekshanServices.Models.AssessmentDetails).</summary>
public sealed class AssessmentDetails : ServiceResponse
{
    public int userType { get; set; }
    public MSMEProfile? companyProfile { get; set; }
    public List<AssessorDetails>? assessors { get; set; }
    public BasicInformation? basicInformation { get; set; }
    public List<MsmeProductDetails>? products { get; set; }
    public List<ParametersDetails>? inputParameters { get; set; }
    public List<AllottedParameters>? allottedParameters { get; set; }
    public bool isOpenMeetingSubmitted { get; set; }
    public bool isSelfieSubmitted { get; set; }
    public bool allowFinalSubmit { get; set; }
    public string? certificationType { get; set; }
    public bool isSurveillance { get; set; }
    public int minimumParameters { get; set; }
}

// ---------- SA requests (DataModels.Requests) ----------

public sealed class SubmitAllocationRequest
{
    public string? saId { get; set; }
    public string? zedId { get; set; }
    public string? certificationType { get; set; }
    public List<ParametersDetails>? allocatedParameters { get; set; }
}

public sealed class SubmitSelfieImageRequest
{
    public string? saId { get; set; }
    public string? zedId { get; set; }
    public string? certificationType { get; set; }
    public PhotoInformation? selfieImage { get; set; }
    public List<PhotoInformation>? assessmentPhotos { get; set; }
}

public sealed class SubmitParameterRequest
{
    public string? saId { get; set; }
    public string? zedId { get; set; }
    public string? certificationType { get; set; }
    public AllottedParameters? allottedParameterObj { get; set; }
}

public sealed class SubmitOfiCommentsRequest
{
    public string? saId { get; set; }
    public string? zedId { get; set; }
    public string? certificationType { get; set; }
    public string? parameterId { get; set; }
    public string? parameterCode { get; set; }
    public string? ofiComments { get; set; }
}

public sealed class SubmitSiteTourRequest
{
    public string? saId { get; set; }
    public string? zedId { get; set; }
    public string? certificationType { get; set; }
    public List<PhotoInformation>? siteTourPhotos { get; set; }
}

public sealed class SubmitAssessmentRequest
{
    public int userType { get; set; }
    public string? saId { get; set; }
    public string? zedId { get; set; }
    public string? certificationType { get; set; }
    public string? latitude { get; set; }
    public string? longitude { get; set; }
    public List<PhotoInformation>? assessmentPhotos { get; set; }
    public List<Participant>? startParticipants { get; set; }
    public List<Participant>? endParticipants { get; set; }
    public string? inputComment { get; set; }
    public string? endComment { get; set; }
    public List<PhotoInformation>? addedEvidences { get; set; }
}

/// <summary>SwachhSurvekshanServices.Models.BasicInformationRequest (: BaseServiceRequest).</summary>
public sealed class BasicInformationRequest
{
    public DeviceInfo? deviceInfo { get; set; }
    public string? version { get; set; }
    public string? userName { get; set; }
    public string? zedId { get; set; }
    public string? saId { get; set; }
    public string? certificationType { get; set; }
    public BasicInformation? basicInformation { get; set; }
}

/// <summary>DataModels.SubmitPhotosRequest (GanagaTownModels.cs).</summary>
public sealed class SubmitPhotosRequest
{
    public string? userName { get; set; }
    public string? zedId { get; set; }
    public string? certificationType { get; set; }
    public List<PhotoInformation>? photos { get; set; }
}

// ---------- RA (remote assessment, MSME side) ----------

public sealed class SubmitSelfieRequest
{
    public string? userName { get; set; }
    public string? representativeName { get; set; }
    public string? representativeDesignation { get; set; }
    public string? certificationType { get; set; }
    public PhotoInformation? photo { get; set; }
}

public sealed class SubmitGeoLocationRequest
{
    public string? userName { get; set; }
    public string? certificationType { get; set; }
    public GeoLocation? location { get; set; }
}

public sealed class GeoLocation
{
    public string? latitude { get; set; }
    public string? longitude { get; set; }
    public string? timeStamp { get; set; }
}

public sealed class CheckRemoteAssementResponse : ServiceResponse
{
    public string? assementDate { get; set; }
    public bool allowCalling { get; set; }
}

// ---------- Server-side only ----------

/// <summary>Assessors allotted to one certification of a unit (MsmeCertifications).</summary>
public sealed class AssessorAllotment
{
    public string? SiteAssessorId { get; set; }
    public string? CoAssessorId { get; set; }
}

/// <summary>The site assessor app's daily attendance (multipart form: these fields, the selfie as the part <c>files</c>).</summary>
public sealed class SubmitAttendanceRequest
{
    public string? saId { get; set; }
    public string? zedId { get; set; }
    public string? certificationType { get; set; }
    public string? attendanceType { get; set; }
    public string? comments { get; set; }
    /// <summary>JSON text of a <see cref="PhotoInformation"/>.</summary>
    public string? selfieMetadata { get; set; }
}
