// Field-for-field copies of the request classes that only the old SurveillanceServices had
// (SwachhSurvekshanServices.Models.AppRequest and DataModels.Requests in ZEDCS_SURVEILLANCE). The other
// classes the Bronze surveillance app sends and reads are the same as the MSME app's (MsmeModels.cs,
// MsmeAppModels.cs). Names, casing and order are the wire format; do not rename or tidy them.
#pragma warning disable IDE1006 // lower-case names are the legacy contract
namespace Zed.Main.MobileApi.Models;

/// <summary>Surveillance/FinalSubmit: the two extra answers stored in AdditionalSupportQuestions.</summary>
public sealed class SurveillanceFinalSubmitRequest : BaseServiceRequest
{
    public string? suitableForSilverUpgrade { get; set; }
    public string? handholdingSupport { get; set; }
}

/// <summary>Surveillance/SubmitFinancialAssistanceDetails (AvailedFinancialSupport).</summary>
public sealed class FinancialAssistanceAvailedRequest : BaseServiceRequest
{
    public string? financialAssistanceAvailed { get; set; }
    public string? anyDocuments { get; set; }
    public string? documentTypes { get; set; }
}

/// <summary>
/// Msme/SubmitSurveillancePhoto (multipart): one photo in file_data, its PhotoInformation as a JSON string in
/// exactly one of selfie, interior, exterior or sitetour.
/// </summary>
public sealed class SubmitSurveillancePhotoRequest
{
    public string? userName { get; set; }
    public string? certificationType { get; set; }
    public string? selfie { get; set; }
    public string? interior { get; set; }
    public string? exterior { get; set; }
    public string? sitetour { get; set; }
}

/// <summary>
/// A unit's surveillance certification row as the per-call checks read it (ZED_SURVEILLANCE.MsmeCertifications).
/// Not part of the wire format.
/// </summary>
public sealed class SurveillanceUnit
{
    public string? Certification { get; set; }
    public string? DesktopAssessorId { get; set; }
    public string? SiteAssessorId { get; set; }
    public string? SaCertificateNo { get; set; }
    public int? CertificationStatus { get; set; }
    public int? NcCount { get; set; }
    public int? Nc1Status { get; set; }
    public int? Nc2Status { get; set; }
    public int? Nc3Status { get; set; }
    public int? Nc4Status { get; set; }
    public int? Nc5Status { get; set; }

    /// <summary>Status of the current NC round (1 raised, 2 answered), 0 when there is none.</summary>
    public int CurrentNcStatus => (NcCount ?? 0) switch
    {
        1 => Nc1Status ?? 0,
        2 => Nc2Status ?? 0,
        3 => Nc3Status ?? 0,
        4 => Nc4Status ?? 0,
        5 => Nc5Status ?? 0,
        _ => 0,
    };

    /// <summary>The unit's current NC round has been raised and not yet answered (as MsmeController.LevelStage.NcOpen).</summary>
    public bool NcOpen => NcCount is > 0 && (NcCount > 5 || CurrentNcStatus == 1);

    /// <summary>Allotted to the desktop assessor and not yet final-submitted (the login procedure's own condition).</summary>
    public bool BeforeFinalSubmit => CertificationStatus == 1 && (NcCount ?? 0) == 0;
}
