using Zed.Core.Mobile;
using SaNotification = Zed.Main.MobileApi.Models.Assessor.SaNotification;
using SaSpoc = Zed.Main.MobileApi.Models.Assessor.SaSpoc;
using SaTeamMember = Zed.Main.MobileApi.Models.Assessor.SaTeamMember;
using SiteTourSectionInfo = Zed.Main.MobileApi.Models.Assessor.SiteTourSectionInfo;

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
    /// <summary>
    /// New in V4 (redesigned consultant app, SA/SubmitSiteTour only): the site tour section the photo is filed under, its key,
    /// name or number in the unit's list (<see cref="AssessmentDetails.siteTourSections"/>). Never answered (left out when null).
    /// </summary>
    [System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]
    public string? section { get; set; }
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
    /// <summary>
    /// V4: the action plan as the app last had it from the server (downloaded, or last sent); the server keeps what the
    /// web added or removed since (<see cref="Controllers.Consultancy.ConsultancySAController.MergePlan"/>). Null from older apps.
    /// </summary>
    public List<string>? plannedActivitiesBase { get; set; }
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
    /// <summary>
    /// New in V4 (redesigned consultant app): the unit's site tour sections in order (milestone 1, the milestone with the site
    /// tour; empty in the others), with their photo limits and the photos the team has uploaded. Older apps ignore it.
    /// </summary>
    public List<SiteTourSectionInfo>? siteTourSections { get; set; }
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
    /// <summary>New in V4 (Admin → App Forms): answers to the Admin's own fields by field key (docs/mobile/APP-FORMS.md).</summary>
    public Dictionary<string, System.Text.Json.JsonElement>? customFields { get; set; }
    /// <summary>New in V4: version of the form definition the app filled in; when sent, the required fields are enforced.</summary>
    public string? formVersion { get; set; }
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
    /// <summary>The consultant as the app sends it (BaseServiceRequest.saId); the old model had only userName.</summary>
    public string? saId { get; set; }
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

// ---------- Redesigned consultant app: sign-in without a unit, dashboard reads ----------
// New in V4, after the SA app 2.0 calls (Models.Assessor: the team, SPOC, notice and site tour section shapes are the same);
// the installed app never sends or reads these. Dates are ISO text ("2026-05-04T10:00:00", server time).

/// <summary>SA/SignIn: the consultant's own sign-in, without a ZED ID.</summary>
public sealed class ConsultantSignInRequest
{
    public string? assessorId { get; set; }
    public string? password { get; set; }
    public string? version { get; set; }
    public DeviceInfo? deviceInfo { get; set; }
}

/// <summary>SA/Assessments, SA/Notifications, SA/Reports: the signed-in consultant (the token's user).</summary>
public sealed class ConsultantRequest
{
    public string? saId { get; set; }
    public DeviceInfo? deviceInfo { get; set; }
}

/// <summary>SA/Assessment: one of the consultant's units, opened as SA/Login opened it.</summary>
public sealed class ConsultantAssessmentRequest
{
    public string? saId { get; set; }
    public string? zedId { get; set; }
    public string? certificationType { get; set; }
    public DeviceInfo? deviceInfo { get; set; }
}

public sealed class ConsultantSignInResponse : ServiceResponse
{
    public ConsultantProfile? profile { get; set; }
    public ConsultantCounts? counts { get; set; }
    public List<ConsultantCase>? assessments { get; set; }
    public List<SiteTourSectionInfo>? siteTourSections { get; set; }
}

public sealed class ConsultantProfile
{
    public string? assessorId { get; set; }
    public string? name { get; set; }
    public string? email { get; set; }
    public string? mobile { get; set; }
    /// <summary>The Consultant Organisation that created the consultant (Users.CreatedBy) and its name, e-mail and mobile.</summary>
    public string? agencyId { get; set; }
    public string? agencyName { get; set; }
    public string? agencyEmail { get; set; }
    public string? agencyMobile { get; set; }
}

public sealed class ConsultantCounts
{
    public int total { get; set; }
    /// <summary>scheduled.</summary>
    public int upcoming { get; set; }
    /// <summary>inProgress and sentBack.</summary>
    public int ongoing { get; set; }
    /// <summary>submitted and underReview.</summary>
    public int submitted { get; set; }
    public int completed { get; set; }
    /// <summary>rejected and closed.</summary>
    public int closed { get; set; }
}

/// <summary>A handholding case of the consultant: one unit and level, at the latest milestone the consultant is allotted to.</summary>
public sealed class ConsultantCase
{
    public string? zedId { get; set; }
    public string? certificationType { get; set; }
    public string? levelName { get; set; }
    public string? enterpriseName { get; set; }
    public string? unitName { get; set; }
    public string? address { get; set; }
    public string? district { get; set; }
    public string? state { get; set; }
    public string? pincode { get; set; }
    /// <summary>The milestone visit date (MsmeCertifications.AssessmentDate of the milestone).</summary>
    public string? assessmentDate { get; set; }
    public int certificationStatus { get; set; }
    public string? statusDate { get; set; }
    /// <summary>scheduled, inProgress, submitted, sentBack, underReview, completed, rejected, closed.</summary>
    public string? stage { get; set; }
    public string? statusLabel { get; set; }
    public bool openMeetingSubmitted { get; set; }
    /// <summary>SA/Assessment opens it (the milestone at status 8 or 9, as SA/Login).</summary>
    public bool canOpen { get; set; }
    /// <summary>"Lead" or "Co"; userType 1 / 2 as SA/Login answers it.</summary>
    public string? role { get; set; }
    public int userType { get; set; }
    public List<SaTeamMember>? team { get; set; }
    public SaSpoc? spoc { get; set; }
    public string? latitude { get; set; }
    public string? longitude { get; set; }
    /// <summary>The case's milestone (1 to 3; MsmeCertifications.NcCount).</summary>
    public int milestone { get; set; }
    public List<MilestoneStep>? milestones { get; set; }
}

/// <summary>One milestone of the unit's handholding, for the case's progress.</summary>
public sealed class MilestoneStep
{
    public int no { get; set; }
    /// <summary>"done", "current" or "locked".</summary>
    public string? status { get; set; }
    public string? label { get; set; }
}

public sealed class ConsultantAssessmentsResponse : ServiceResponse
{
    public ConsultantCounts? counts { get; set; }
    public List<ConsultantCase>? assessments { get; set; }
}

public sealed class ConsultantNotificationsResponse : ServiceResponse
{
    public List<SaNotification>? notifications { get; set; }
}

public sealed class ConsultantReport
{
    public string? zedId { get; set; }
    public string? certificationType { get; set; }
    public string? levelName { get; set; }
    public int milestone { get; set; }
    public string? milestoneLabel { get; set; }
    public string? enterpriseName { get; set; }
    public string? district { get; set; }
    public string? state { get; set; }
    public string? assessmentDate { get; set; }
    public int certificationStatus { get; set; }
    public string? statusDate { get; set; }
    public string? stage { get; set; }
    public string? statusLabel { get; set; }
    public string? role { get; set; }
    public List<SaTeamMember>? team { get; set; }
    /// <summary>The consultancy portal serves the milestone report PDF (Silver / Gold, milestone completed or rejected).</summary>
    public bool reportAvailable { get; set; }
    /// <summary>Address of the PDF relative to the consultancy portal (GET with the app token), or null.</summary>
    public string? reportPath { get; set; }
}

public sealed class ConsultantReportsResponse : ServiceResponse
{
    public List<ConsultantReport>? reports { get; set; }
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
