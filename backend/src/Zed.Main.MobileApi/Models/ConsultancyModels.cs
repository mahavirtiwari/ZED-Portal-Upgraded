using Zed.Core.Mobile;

// Field-for-field copies of the classes the consultant app (and the TU verifier / DFO app) exchange with the old
// ZEDCS_CONSULTANCY SwachhSurvekshanServices SAController (DataModels.Requests / Responses / DataModel and
// SwachhSurvekshanServices.Models.AppRequest / AppResponse of that code base). They differ from the main site
// assessor app's classes (milestone, BDS/HAP dates, requirement fields, bullet lists), so they have their own
// namespace. Names, casing and order are the wire format; do not rename or tidy them.
#pragma warning disable IDE1006 // lower-case names are the legacy contract
namespace Zed.Main.MobileApi.Models.Consultancy;

// ---------- DataModels.DataModel / Responses ----------

public sealed class PhotoInformation
{
    public bool isPdf { get; set; }
    public string? videoId { get; set; }
    public string? photoId { get; set; }
    public string? photo { get; set; }
    public string? photoPath { get; set; }
    public string? filePath { get; set; }
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
    public string? bdsFromDate { get; set; }
    public string? bdsToDate { get; set; }
    public string? hapFromDate { get; set; }
    public string? hapToDate { get; set; }
    public string? saDate { get; set; }
    public string? zedId { get; set; }
    public string? msmeName { get; set; }
    public string? sectorId { get; set; }
    public string? sectorName { get; set; }
    public string? unitAddress { get; set; }
    public string? email { get; set; }
    public string? phone { get; set; }
    public string? address { get; set; }
    public string? districtName { get; set; }
    public string? stateName { get; set; }
    public string? pincode { get; set; }
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
    public List<string>? gapsIdentified { get; set; }
    // Handholding Action Plan
    public string? estimatedTimeInDays { get; set; }
    // Rationale for Technology Intervention
    public string? technologyInterventionRationale { get; set; }
    public List<string>? plannedActivities { get; set; }
    public List<PhotoInformation>? capturedEvidences { get; set; }
    public List<string>? suggestedTechnologyIntervention { get; set; }
    // SubmitProgressReview
    public string? isProposedActivityCompleted { get; set; }
    public string? baselineRemarks { get; set; }
    public string? handholdingActionPlanRemarks { get; set; }
    public string? technologyInterventionRemarks { get; set; }
    public string? progressReview1Remarks { get; set; }
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

/// <summary>DataModels.CheckParameterSyncStatusResponse.</summary>
public sealed class CheckParameterSyncStatusResponse : ServiceResponse
{
    public bool AllParametersSynced { get; set; }
}

/// <summary>DataModels.FileUploadResponse (not a ServiceResponse).</summary>
public sealed class FileUploadResponse
{
    public string? status { get; set; }
    public string? errorMessage { get; set; }
    public string? filePath { get; set; }
    public string? fileName { get; set; }
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

/// <summary>SA/Login response (SwachhSurvekshanServices.Models.AssessmentDetails of the consultancy code).</summary>
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
    public string? certificationType { get; set; }
    public int milestone { get; set; }
}

/// <summary>BasicInfoConsultancyRequest (: BaseServiceRequest).</summary>
public sealed class BasicInfoConsultancyRequest
{
    public DeviceInfo? deviceInfo { get; set; }
    public string? version { get; set; }
    public string? userName { get; set; }
    public string? zedId { get; set; }
    public string? saId { get; set; }
    public string? certificationType { get; set; }
    public BasicInfoConsultancy? basicInformation { get; set; }
}

public sealed class BasicInfoConsultancy
{
    public OccupationalSafety? occupationalSafety { get; set; }
    public MeasurementOfTimelyDelivery? measurementOfTimelyDelivery { get; set; }
    public PlannedMaintenanceCalibration? plannedMaintenanceCalibration { get; set; }
    public EnergyManagement? energyManagement { get; set; }
    public EnvironmentManagement? environmentManagement { get; set; }
    public HumanResourceManagement? humanResourceManagement { get; set; }
    public MeasurementAnalysis? measurementAnalysis { get; set; }
    public NaturalResourcesManagement? naturalResourcesManagement { get; set; }
    public FinancialPerformance? financialPerformance { get; set; }
}

public sealed class OccupationalSafety
{
    public string? label { get; set; }
    public string? numOfAccidents { get; set; }
    public string? numOfNearMisses { get; set; }
    public string? manHoursLast { get; set; }
    public string? lostTimeInjuryFrequencyRate { get; set; }
}

public sealed class MeasurementOfTimelyDelivery
{
    public string? label { get; set; }
    public string? numOfDeliveries { get; set; }
    public string? numOfDeliveriesOnTimeInFull { get; set; }
}

public sealed class PlannedMaintenanceCalibration
{
    public string? label { get; set; }
    public string? meanTimeToRepair { get; set; }
    public string? meanTimeBetweenFailure { get; set; }
}

public sealed class EnergyManagement
{
    public string? label { get; set; }
    public EnergyParameter? electrical { get; set; }
    public EnergyParameter? solar { get; set; }
    public EnergyParameter? wind { get; set; }
    public EnergyParameter? fossilFuel { get; set; }
    public EnergyParameter? gas { get; set; }
    public EnergyParameter? others { get; set; }
    public string? totalCost { get; set; }
    public string? measuresTaken { get; set; }
}

/// <summary>The old class was named <c>Parameter</c>; only its fields are on the wire.</summary>
public sealed class EnergyParameter
{
    public string? unit { get; set; }
    public string? totalConsumptionPercentage { get; set; }
}

public sealed class EnvironmentManagement
{
    public string? label { get; set; }
    public string? cox { get; set; }
    public string? nox { get; set; }
    public string? sox { get; set; }
    public string? suspendedParticulateMaterial { get; set; }
    public string? totalSuspendedSolid { get; set; }
    public string? biochemicalOxygenDemand { get; set; }
    public string? solidWaste { get; set; }
    public string? plasticWaste { get; set; }
    public string? eWaste { get; set; }
    public string? hazardousWaste { get; set; }
    public string? noiseLevel { get; set; }
    public string? measuresTaken { get; set; }
}

public sealed class HumanResourceManagement
{
    public string? label { get; set; }
    public string? employeesEngagedInActivities { get; set; }
    public string? noOfSuggestions { get; set; }
    public string? measuresTaken { get; set; }
}

public sealed class MeasurementAnalysis
{
    public string? label { get; set; }
    public string? defects { get; set; }
    public string? rework { get; set; }
    public string? customerRejections { get; set; }
    public string? numberOfCustomerComplaints { get; set; }
    public string? numberOfComplaintsResolved { get; set; }
    public string? customerSatisfactionLevel { get; set; }
    public string? costOfPoorQuality { get; set; }
}

public sealed class NaturalResourcesManagement
{
    public string? label { get; set; }
    public string? water { get; set; }
    public string? minerals { get; set; }
    public string? wood { get; set; }
    public string? others { get; set; }
    public string? waterRecycling { get; set; }
    public string? waterReuse { get; set; }
    public string? rainWaterHarvesting { get; set; }
    public string? noOfTreePlanted { get; set; }
    public string? measuresTaken { get; set; }
}

public sealed class FinancialPerformance
{
    public string? label { get; set; }
    public string? turnover { get; set; }
    public string? grossProfit { get; set; }
}

/// <summary>DataModels.SubmitPhotosRequest (GanagaTownModels.cs), used by SubmitBasicInfoPhotos.</summary>
public sealed class SubmitPhotosRequest
{
    public string? userName { get; set; }
    public string? zedId { get; set; }
    public string? certificationType { get; set; }
    public List<PhotoInformation>? photos { get; set; }
}

/// <summary>SubmitFileUploadRequest (multipart form fields of SA/SubmitPhotos; the file is the FormFile part).</summary>
public sealed class SubmitFileUploadRequest
{
    public string? userName { get; set; }
    public string? zedId { get; set; }
    public string? certificationType { get; set; }
    public string? sectionName { get; set; }
    public PhotoInformation? photoInfo { get; set; }
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

public sealed class ZedTrainingInfoSubmissionRequest
{
    public string? saId { get; set; }
    public string? zedId { get; set; }
    public string? certificationType { get; set; }
    public ZedTrainingInfo? trainingInfo { get; set; }
}

public sealed class ZedTrainingInfo
{
    public string? trainingTopic { get; set; }
    public string? trainingDate { get; set; }
    public string? trainingTime { get; set; }
    public string? remarks { get; set; }
    public List<PhotoInformation>? trainingPhoto { get; set; }
    public List<PhotoInformation>? attendanceSheet { get; set; }
}

// ---------- DataModels.Requests ----------

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
    public PhotoInformation? selfie { get; set; }
    public List<PhotoInformation>? assessmentPhotos { get; set; }
}

public sealed class SubmitParameterRequest
{
    public string? saId { get; set; }
    public string? zedId { get; set; }
    public string? certificationType { get; set; }
    public AllottedParameters? allottedParameterObj { get; set; }
}

public sealed class SubmitAttendanceRequest
{
    public string? saId { get; set; }
    public string? zedId { get; set; }
    public string? certificationType { get; set; }
    public string? attendanceType { get; set; }
    public string? comments { get; set; }
    /// <summary>JSON text of a <see cref="PhotoInformation"/> (multipart form field).</summary>
    public string? selfieMetadata { get; set; }
    public PhotoInformation? selfieMetadataObj { get; set; }
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
    public string? sectionName { get; set; }
    public string? latitude { get; set; }
    public string? longitude { get; set; }
    public List<PhotoInformation>? assessmentPhotos { get; set; }
    public List<Participant>? startParticipants { get; set; }
    public List<Participant>? endParticipants { get; set; }
    public string? inputComment { get; set; }
    public string? endComment { get; set; }
    public List<PhotoInformation>? addedEvidences { get; set; }
}

public sealed class CheckParameterSyncStatusRequest
{
    public int userType { get; set; }
    public string? saId { get; set; }
    public string? zedId { get; set; }
    public string? certificationType { get; set; }
}

// ---------- Server-side only ----------

/// <summary>
/// One person allotted to a unit's current handholding milestone: <c>Lead</c> (MsmeCertifications.SiteAssessorId),
/// <c>Co</c> (AllotedCoAssessors), <c>Expert</c> (AllotedTechExperts) or <c>Dfo</c> (FinancialAssistance.FinancialAssessorId).
/// </summary>
public sealed class ConsultancyAllotment
{
    public string? Role { get; set; }
    public string? UserId { get; set; }
}
