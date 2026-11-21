using Zed.Core.Mobile;

#pragma warning disable IDE1006 // lower-case names are the app's wire format
namespace Zed.Main.MobileApi.Models.Assessor;

/// <summary>
/// 2026-11-21: one Bronze surveillance case of the signed-in assessor in ZED SA (Surveillance deployment): a unit whose
/// Bronze surveillance desktop assessor (MsmeCertifications.DesktopAssessorId) the assessor is, at the stage the ZED
/// Surveillance app's login accepted (status 1).
/// </summary>
public sealed class SaBronzeCase
{
    public string? zedId { get; set; }
    public string? certificationType { get; set; }
    public string? enterpriseName { get; set; }
    public string? unitName { get; set; }
    public string? address { get; set; }
    public string? district { get; set; }
    public string? state { get; set; }
    public string? pincode { get; set; }
    /// <summary>MsmeCertifications.CertificationStatus (1: with the desktop assessor, before the final submit).</summary>
    public int status { get; set; }
    /// <summary>When the unit reached that status (CertificationStatusDate, else CreatedDate), ISO 8601; null when unknown.</summary>
    public string? statusDate { get; set; }
    /// <summary>2026-11-21: the NC round waiting for the assessor's reply (1-5), null before the final submit (status 1).</summary>
    public int? ncRound { get; set; }
}

/// <summary>SA/BronzeSurveillance: the assessor's Bronze surveillance cases.</summary>
public sealed class SaBronzeCasesResponse : ServiceResponse
{
    public List<SaBronzeCase>? cases { get; set; }
}

/// <summary>SA/BronzeSurveillanceSession: one of those cases, opened with ZED SA's sign-in instead of a password.</summary>
public sealed class SaBronzeSessionRequest
{
    public string? saId { get; set; }
    public string? zedId { get; set; }
    public string? version { get; set; }
    public DeviceInfo? deviceInfo { get; set; }
}
