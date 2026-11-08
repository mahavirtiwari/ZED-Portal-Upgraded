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
    /// <summary>
    /// New in V4 (redesigned SA app, SA/SubmitSiteTour only): the site tour section the photo is filed under, its key, name
    /// or number in the unit's list (<see cref="AssessmentDetails.siteTourSections"/>). Never answered (left out when null).
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
    /// <summary>V4 (2026-11-08): the Admin's video for the requirement (Questionnaire → Requirements); absent when none.</summary>
    [System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]
    public string? videoUrl { get; set; }
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
    /// <summary>V4, SA app: Yes / Partial / No per checkpoint; for a requirement with checkpoints its conformance follows from them.</summary>
    [System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]
    public List<CheckpointAnswerInfo>? checkpointAnswers { get; set; }
    /// <summary>
    /// V4 (redesigned SA app; migration 0043): the evidences the Admin lists for the requirement, answered (Yes / No) and, when
    /// available, photographed at the site. Answered by SA/Login; sent back as <see cref="evidenceChecks"/>.
    /// </summary>
    [System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]
    public List<ListedEvidenceInfo>? listedEvidences { get; set; }
    /// <summary>V4, SA app: the site assessor's answer for each listed evidence (SA/SubmitParameter).</summary>
    [System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]
    public List<EvidenceCheckInfo>? evidenceChecks { get; set; }
}

/// <summary>An evidence the Admin lists for the requirement (dbo.MsmeEvidences) and the site's earlier answer.</summary>
public sealed class ListedEvidenceInfo
{
    public long id { get; set; }
    public string? name { get; set; }
    public bool mandatory { get; set; }
    /// <summary>The checkpoint's option code it belongs to, or null.</summary>
    public string? checkpoint { get; set; }
    public bool uploaded { get; set; }
    /// <summary>The desktop assessor's Yes / No.</summary>
    public string? verified { get; set; }
    public string? available { get; set; }
    public List<string>? photoIds { get; set; }
}

public sealed class EvidenceCheckInfo
{
    public long id { get; set; }
    /// <summary>"Yes" or "No".</summary>
    public string? available { get; set; }
    /// <summary>Its photos (1 to 3, among the requirement's addedEvidences) when available.</summary>
    public List<string>? photoIds { get; set; }
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
    /// <summary>V4, SA app: the option is a checkpoint of the requirement (MsmeOptions row, migration 0039); null otherwise.</summary>
    [System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]
    public CheckpointInfo? checkpoint { get; set; }
}

/// <summary>A checkpoint as the site assessor answers it: the Admin's actions needed, its evidences, the earlier answers.</summary>
public sealed class CheckpointInfo
{
    public List<string> actions { get; set; } = [];
    public List<CheckpointEvidenceInfo> evidences { get; set; } = [];
    /// <summary>The desktop assessor's Yes / Partial / No.</summary>
    public string? desktopAnswer { get; set; }
    /// <summary>The site answer saved so far (another device, or the web).</summary>
    public string? siteAnswer { get; set; }
    public List<string>? siteActions { get; set; }
    public string? siteRemarks { get; set; }
}

public sealed class CheckpointEvidenceInfo
{
    public string? name { get; set; }
    public bool mandatory { get; set; }
    public bool uploaded { get; set; }
    /// <summary>The desktop assessor's Yes / No on the evidence (a No blocks a Yes on the checkpoint).</summary>
    public string? verified { get; set; }
}

/// <summary>The site assessor's answer to one checkpoint (OptionInfo.id), sent with SubmitParameter.</summary>
public sealed class CheckpointAnswerInfo
{
    public long id { get; set; }
    public string? answer { get; set; }
    public List<string>? actions { get; set; }
    public string? remarks { get; set; }
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
    /// <summary>
    /// New in V4 (redesigned SA app): the unit's site tour sections in order, with their photo limits and the photos the team
    /// has uploaded. Older apps ignore it.
    /// </summary>
    public List<SiteTourSectionInfo>? siteTourSections { get; set; }
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
    /// <summary>New in V4 (Admin → App Forms): answers to the Admin's own fields by field key (docs/mobile/APP-FORMS.md).</summary>
    public Dictionary<string, System.Text.Json.JsonElement>? customFields { get; set; }
    /// <summary>New in V4: version of the form definition the app filled in; when sent, the required fields are enforced.</summary>
    public string? formVersion { get; set; }
}

/// <summary>DataModels.SubmitPhotosRequest (GanagaTownModels.cs).</summary>
public sealed class SubmitPhotosRequest
{
    public string? userName { get; set; }
    /// <summary>The assessor as the app sends it (BaseServiceRequest.saId); the old model had only userName.</summary>
    public string? saId { get; set; }
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

// ---------- SA app 2.0 (redesigned site assessor app): sign-in without a unit, dashboard reads ----------
// New in V4; the installed app never sends or reads these. Dates are ISO text ("2026-05-04T10:00:00", server time).

/// <summary>SA/SignIn: the assessor's own sign-in, without a ZED ID.</summary>
public sealed class SaSignInRequest
{
    public string? assessorId { get; set; }
    public string? password { get; set; }
    public string? version { get; set; }
    public DeviceInfo? deviceInfo { get; set; }
}

/// <summary>SA/Assessments, SA/Notifications, SA/Reports: the signed-in assessor (the token's user).</summary>
public sealed class SaRequest
{
    public string? saId { get; set; }
    public DeviceInfo? deviceInfo { get; set; }
}

/// <summary>SA/Assessment: one of the assessor's units, opened as SA/Login opened it.</summary>
public sealed class SaAssessmentRequest
{
    public string? saId { get; set; }
    public string? zedId { get; set; }
    public string? certificationType { get; set; }
    public DeviceInfo? deviceInfo { get; set; }
}

public sealed class SaSignInResponse : ServiceResponse
{
    public SaProfile? profile { get; set; }
    public SaCounts? counts { get; set; }
    public List<SaAssessment>? assessments { get; set; }
    public List<SiteTourSectionInfo>? siteTourSections { get; set; }
}

public sealed class SaProfile
{
    public string? assessorId { get; set; }
    public string? name { get; set; }
    public string? email { get; set; }
    public string? mobile { get; set; }
    /// <summary>Users.AssessorType ("Assessor", "BronzeAssessor"); null on Surveillance (no such column).</summary>
    public string? assessorType { get; set; }
    public string? certificateNo { get; set; }
    /// <summary>Users.SectorActivity: "Manufacturing", "Services" or "Both" (migration 0028); null when not set.</summary>
    public string? sectorActivity { get; set; }
    /// <summary>The agency that created the assessor (Users.CreatedBy) and its name.</summary>
    public string? agencyId { get; set; }
    public string? agencyName { get; set; }
    /// <summary>The agency's registered e-mail and mobile (Users), shown on the app's Help page.</summary>
    public string? agencyEmail { get; set; }
    public string? agencyMobile { get; set; }
    public bool desktopVerification { get; set; }
    public bool siteVerification { get; set; }
    public List<SaLevel>? levels { get; set; }
}

public sealed class SaLevel
{
    /// <summary>MsmeCertifications.Certification: "Silver", "Gold", "ZEDX", "Bronze".</summary>
    public string? code { get; set; }
    public string? name { get; set; }
    /// <summary>"Site" or "Desktop".</summary>
    public string? mode { get; set; }
}

public sealed class SaCounts
{
    public int total { get; set; }
    public int upcoming { get; set; }
    public int ongoing { get; set; }
    public int submitted { get; set; }
    public int certified { get; set; }
    public int closed { get; set; }
}

public sealed class SaAssessment
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
    public string? assessmentDate { get; set; }
    public string? modeOfAssessment { get; set; }
    public int certificationStatus { get; set; }
    public string? statusDate { get; set; }
    /// <summary>scheduled, inProgress, submitted, ncRound, underReview, certified, rejected, closed.</summary>
    public string? stage { get; set; }
    public string? statusLabel { get; set; }
    public int ncRound { get; set; }
    public bool ncAnswered { get; set; }
    public bool openMeetingSubmitted { get; set; }
    /// <summary>SA/Assessment opens it (status 8 to 12, as SA/Login).</summary>
    public bool canOpen { get; set; }
    /// <summary>"Lead" or "Co"; userType 1 / 2 as SA/Login answers it.</summary>
    public string? role { get; set; }
    public int userType { get; set; }
    public List<SaTeamMember>? team { get; set; }
    public SaSpoc? spoc { get; set; }
    public string? latitude { get; set; }
    public string? longitude { get; set; }
}

public sealed class SaTeamMember
{
    public string? assessorId { get; set; }
    public string? name { get; set; }
    public string? email { get; set; }
    public string? mobile { get; set; }
    public string? role { get; set; }
    public int userType { get; set; }
}

public sealed class SaSpoc
{
    public string? name { get; set; }
    public string? designation { get; set; }
    public string? email { get; set; }
    public string? phone { get; set; }
    /// <summary>"representative" (the person the MSME named in the remote assessment app) or "owner" (the Udyam owner).</summary>
    public string? source { get; set; }
}

public sealed class SaAssessmentsResponse : ServiceResponse
{
    public SaCounts? counts { get; set; }
    public List<SaAssessment>? assessments { get; set; }
}

public sealed class SaNotification
{
    public string? id { get; set; }
    /// <summary>allotted, reminder, ncRaised, ncAnswered, certified, sentBack, rejected.</summary>
    public string? type { get; set; }
    public string? title { get; set; }
    public string? text { get; set; }
    public string? zedId { get; set; }
    public string? certificationType { get; set; }
    public string? enterpriseName { get; set; }
    public string? date { get; set; }
}

public sealed class SaNotificationsResponse : ServiceResponse
{
    public List<SaNotification>? notifications { get; set; }
}

public sealed class SaReport
{
    /// <summary>The certification record (a rejected or reset copy is ZEDMSME000123_D_45); baseZedId is the unit's ZED ID.</summary>
    public string? zedId { get; set; }
    public string? baseZedId { get; set; }
    public string? certificationType { get; set; }
    public string? levelName { get; set; }
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
    /// <summary>The portal draws the report PDF (certified or rejected record).</summary>
    public bool reportAvailable { get; set; }
    /// <summary>Address of the PDF relative to the deployment's portal (GET with the app token), or null.</summary>
    public string? reportPath { get; set; }
}

public sealed class SaReportsResponse : ServiceResponse
{
    public List<SaReport>? reports { get; set; }
}

/// <summary>A site tour section of the unit (Admin → Site Tour Sections) and the photos of it the team has uploaded.</summary>
public sealed class SiteTourSectionInfo
{
    public string? id { get; set; }
    public int no { get; set; }
    public string? title { get; set; }
    public string? hint { get; set; }
    public int min { get; set; }
    public int max { get; set; }
    public int uploaded { get; set; }

    public static SiteTourSectionInfo Of(Zed.Core.Assessment.SiteTourSection s, int no, int uploaded) =>
        new() { id = s.Id, no = no, title = s.Title, hint = s.Hint, min = s.Min, max = s.Max, uploaded = uploaded };
}
