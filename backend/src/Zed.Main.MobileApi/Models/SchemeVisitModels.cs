// Request and response shapes of the assessor app's scheme visits (SchemeVisits/*, 2026-11-20, incentive schemes phase 2:
// onsite verification). Names as the app reads them (camelCase, as the other assessor app models).
#pragma warning disable IDE1006 // the app's field names

using Zed.Core.Mobile;

namespace Zed.Main.MobileApi.Models.Assessor;

/// <summary>Every scheme visit call names the signed-in assessor (<c>saId</c>, checked against the app token).</summary>
public class SchemeVisitRequest
{
    public string? saId { get; set; }
    public int applicationId { get; set; }
    public DeviceInfo? deviceInfo { get; set; }
}

/// <summary>A geo-tagged photo taken in the app (base64 JPEG, as SA/SubmitSiteTour).</summary>
public sealed class SchemeVisitPhoto
{
    /// <summary>The app's own id of the photo (the retry of a send is recognised by it).</summary>
    public string? photoId { get; set; }
    public string? photo { get; set; }
    public string? timeStamp { get; set; }
    public string? latitude { get; set; }
    public string? longitude { get; set; }
}

/// <summary>SchemeVisits/Start: the selfie and the site photo at the unit.</summary>
public sealed class SchemeVisitStartRequest : SchemeVisitRequest
{
    public SchemeVisitPhoto? selfie { get; set; }
    public SchemeVisitPhoto? site { get; set; }
}

/// <summary>SchemeVisits/SavePhoto: one photo of an item ("Add more" item or plain section).</summary>
public sealed class SchemeVisitPhotoRequest : SchemeVisitRequest
{
    public string? section { get; set; }
    public int index { get; set; }
    public SchemeVisitPhoto? photo { get; set; }
}

/// <summary>SchemeVisits/DeletePhoto: an item photo taken again (the app's photo id).</summary>
public sealed class SchemeVisitDeletePhotoRequest : SchemeVisitRequest
{
    public string? photoId { get; set; }
}

/// <summary>One onsite check: "Yes" (valid), "No" (not valid, with a remark) or empty (not checked any more).</summary>
public sealed class SchemeVisitCheck
{
    public string? path { get; set; }
    public string? status { get; set; }
    public string? remarks { get; set; }
}

/// <summary>SchemeVisits/Save: what is given is saved (a field left out stays as it is).</summary>
public sealed class SchemeVisitSaveRequest : SchemeVisitRequest
{
    public string? representativeName { get; set; }
    public string? representativeMobile { get; set; }
    public string? remarks { get; set; }
    public List<SchemeVisitCheck>? checks { get; set; }
}

/// <summary>SchemeVisits/Submit: "recommend" (with the verified claim) or "reject" (reason and remarks).</summary>
public sealed class SchemeVisitSubmitRequest : SchemeVisitRequest
{
    public string? decision { get; set; }
    public decimal? verifiedClaim { get; set; }
    public string? reason { get; set; }
    public string? remarks { get; set; }
}

/// <summary>SchemeVisits/File: one of the application's documents or onsite photos.</summary>
public sealed class SchemeVisitFileRequest : SchemeVisitRequest
{
    public string? name { get; set; }
}

// ------------------------------------------------------------------ answers

public sealed class SchemeVisitSummary
{
    public int applicationId { get; set; }
    public string? zedId { get; set; }
    public string? unitName { get; set; }
    public string? address { get; set; }
    public string? schemeCode { get; set; }
    public string? schemeName { get; set; }
    public string? level { get; set; }
    public string? levelName { get; set; }
    public decimal? claimAmount { get; set; }
    /// <summary>OnsiteWithAssessor (to visit) or OnsiteVisit (visit started).</summary>
    public string? status { get; set; }
    /// <summary>When the onsite agency named the assessor (yyyy-MM-ddTHH:mm:ss).</summary>
    public string? allottedOn { get; set; }
    /// <summary>The date of verification: when the visit started (yyyy-MM-ddTHH:mm:ss).</summary>
    public string? visitStartedOn { get; set; }
}

public sealed class SchemeVisitListResponse : ServiceResponse
{
    public List<SchemeVisitSummary>? visits { get; set; }
}

public sealed class SchemeVisitFile
{
    public string? name { get; set; }
    public bool isPdf { get; set; }
}

public sealed class SchemeVisitCheckState
{
    public string? status { get; set; }
    public string? remarks { get; set; }
}

public sealed class SchemeVisitAnswer
{
    /// <summary>"{section}/{item}/{field}" (SchemeApplications.PathOf).</summary>
    public string? path { get; set; }
    public string? field { get; set; }
    public string? label { get; set; }
    public string? type { get; set; }
    /// <summary>The answer as text (a choice list joined); empty for documents and photos.</summary>
    public string? value { get; set; }
    public List<SchemeVisitFile>? files { get; set; }
    public bool isClaim { get; set; }
    /// <summary>The onsite assessor checks this answer (SchemeApplications.OnsitePlacesOf).</summary>
    public bool checkOnsite { get; set; }
    /// <summary>The desktop assessor's check, when it made one.</summary>
    public SchemeVisitCheckState? desktop { get; set; }
}

public sealed class SchemeVisitItem
{
    public int index { get; set; }
    public string? title { get; set; }
    public List<SchemeVisitAnswer>? answers { get; set; }
}

public sealed class SchemeVisitSection
{
    public string? key { get; set; }
    public string? title { get; set; }
    public string? help { get; set; }
    public bool repeating { get; set; }
    public List<SchemeVisitItem>? items { get; set; }
}

public sealed class SchemeVisitPlace
{
    public string? path { get; set; }
    public string? label { get; set; }
    public string? section { get; set; }
    public int index { get; set; }
    public string? field { get; set; }
}

public sealed class SchemeVisitSavedPhoto
{
    /// <summary>The stored file's name (SchemeVisits/File?name=).</summary>
    public string? name { get; set; }
    /// <summary>"onsite/selfie", "onsite/site" or "onsite/{section}/{item}".</summary>
    public string? slot { get; set; }
    public string? timeStamp { get; set; }
    public string? latitude { get; set; }
    public string? longitude { get; set; }
}

public sealed class SchemeVisitPhotoSlot
{
    public string? section { get; set; }
    public int index { get; set; }
    public string? title { get; set; }
    public List<SchemeVisitSavedPhoto>? photos { get; set; }
}

public sealed class SchemeVisitDetail
{
    public int applicationId { get; set; }
    public string? zedId { get; set; }
    public string? unitName { get; set; }
    public string? address { get; set; }
    public string? schemeCode { get; set; }
    public string? schemeName { get; set; }
    public string? level { get; set; }
    public string? levelName { get; set; }
    public string? status { get; set; }
    /// <summary>False once the result is submitted (or the application left the assessor): the app shows it read-only.</summary>
    public bool open { get; set; }
    public decimal? claimAmount { get; set; }
    /// <summary>The desktop recommendation's eligible amount.</summary>
    public decimal? eligibleAmount { get; set; }
    public decimal? sharePercent { get; set; }
    public decimal? maxAmount { get; set; }
    public int photosMin { get; set; }
    public int photosMax { get; set; }
    public string? visitStartedOn { get; set; }
    public string? visitLatitude { get; set; }
    public string? visitLongitude { get; set; }
    public string? visitSubmittedOn { get; set; }
    public string? representativeName { get; set; }
    public string? representativeMobile { get; set; }
    public string? remarks { get; set; }
    public decimal? verifiedClaim { get; set; }
    public List<SchemeVisitSection>? sections { get; set; }
    public List<SchemeVisitPlace>? places { get; set; }
    public List<SchemeVisitPhotoSlot>? items { get; set; }
    public SchemeVisitSavedPhoto? selfie { get; set; }
    public SchemeVisitSavedPhoto? sitePhoto { get; set; }
    /// <summary>The onsite checks saved, by path (without the "onsite:" prefix).</summary>
    public Dictionary<string, SchemeVisitCheckState>? checks { get; set; }
}

public sealed class SchemeVisitDetailResponse : ServiceResponse
{
    public SchemeVisitDetail? visit { get; set; }
}

/// <summary>The answer of a write: the stored file name of a photo, the status after a submit.</summary>
public sealed class SchemeVisitWriteResponse : ServiceResponse
{
    public string? name { get; set; }
    public string? visitStatus { get; set; }
    public string? visitStartedOn { get; set; }
    public decimal? eligibleAmount { get; set; }
}
