using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using Zed.Core.Http;

namespace Zed.Portal.Features.Msme.Entry;

/// <summary>
/// Shared pieces of the MSME's web data entry (<see cref="MsmeEntryController"/>): the levels it is open for, the unit's
/// stage, and the app's folders (<c>mobileapi/Photos/{ZedId}/{Level}/{Folder}/{file}</c>) where the files are stored.
/// </summary>
public static class MsmeEntry
{
    /// <summary>
    /// Levels whose basic information and documents are entered on the web. Bronze, Silver and Gold are entered in the
    /// MSME app (its source is not in the repository, so it cannot offer ZED-X).
    /// </summary>
    public static readonly IReadOnlyList<string> Levels = ["ZEDX"];

    public const string SiteExteriorFolder = "SiteExteriorPhotos";
    public const string BasicInfoFolder = "BasicInfo";
    public const string EvidencesFolder = "Evidences";
    public static readonly IReadOnlyList<string> Folders = [SiteExteriorFolder, BasicInfoFolder, EvidencesFolder];

    /// <summary>As the app: at most 2 site exterior photos, 20 products and raw materials, 10 photos per evidence.</summary>
    public const int MaxSitePhotos = 2;
    public const int MaxProducts = 20;
    public const int MaxRawMaterials = 20;
    public const int MaxEvidencePhotos = 10;
    public const long MaxFileBytes = 5 * 1024 * 1024;

    public static bool TryLevel(string? value, out string level)
    {
        level = Levels.FirstOrDefault(l => string.Equals(l, value?.Trim(), StringComparison.OrdinalIgnoreCase)) ?? "";
        return level.Length > 0;
    }

    /// <summary>
    /// Where the unit stands for the level. Paid: <c>Msme.Is{Level}PaymentDone</c> (ZED-X: migration 0029).
    /// <c>CertificationStatus</c> is null before the first save of the basic information (the row does not exist yet) and
    /// 1 until the final submit (2).
    /// </summary>
    /// <param name="CurrentNcStatus">The current NC's status (Nc{NcCount}Status): 1 raised, 2 answered.</param>
    public sealed record Stage(bool Paid, int? CertificationStatus, int NcCount, bool HasRow, int CurrentNcStatus = 0)
    {
        public bool Editable => Paid && NcCount == 0 && (CertificationStatus is null or <= 1);
        public bool Submitted => CertificationStatus is >= 2;

        /// <summary>
        /// An NC raised and not yet answered: status 4 (desktop NC) or 14 (site NC), as SP_APP_CHECK_DATA_SYNC_FINAL_SUBMIT
        /// allows the NC submit, NC 1 to 5.
        /// </summary>
        public bool NcOpen => Paid && NcCount is >= 1 and <= 5 && CurrentNcStatus == 1 && CertificationStatus is 4 or 14;
    }

    public sealed record StageRow(bool? Paid, int? CertificationStatus, int? NcCount, int? CertificationId, int? CurrentNcStatus = null);

    /// <summary>The level comes from <see cref="Levels"/> only, so it can name the payment column.</summary>
    public static string StageSql(string level) =>
        $"SELECT CAST(ISNULL(m.Is{level}PaymentDone, 0) AS bit) AS Paid, c.CertificationStatus, c.NcCount, c.Id AS CertificationId, " +
        "CASE c.NcCount WHEN 1 THEN c.Nc1Status WHEN 2 THEN c.Nc2Status WHEN 3 THEN c.Nc3Status WHEN 4 THEN c.Nc4Status WHEN 5 THEN c.Nc5Status END AS CurrentNcStatus " +
        "FROM dbo.Msme m LEFT JOIN dbo.MsmeCertifications c ON c.ZedId = m.ZedId AND c.Certification = @Level WHERE m.ZedId = @ZedId;";

    public static Stage ToStage(StageRow? r) =>
        r is null ? new Stage(false, null, 0, false)
            : new Stage(r.Paid == true, r.CertificationStatus, r.NcCount ?? 0, r.CertificationId is not null, r.CurrentNcStatus ?? 0);

    /// <summary>The folder that holds the app's <c>mobileapi\Photos</c> (Portal:AssessmentStorageRoot, else Portal:StorageRoot).</summary>
    public static string StorageRoot(IWebHostEnvironment env, IOptions<PortalOptions> portal, IConfiguration config)
    {
        var configured = config[MsmeEvidenceFilesController.StorageRootSetting];
        return Path.GetFullPath(Path.Combine(env.ContentRootPath, string.IsNullOrWhiteSpace(configured) ? portal.Value.StorageRoot : configured));
    }

    /// <summary><c>mobileapi/Photos/{ZedId}/{Level}/{folder}/{file}</c> (where the app's server writes them).</summary>
    public static string Relative(string zedId, string level, string folder, string fileName) => $"mobileapi/Photos/{zedId}/{level}/{folder}/{fileName}";

    /// <summary>A new photo id as the app makes them: the unit's ZED ID and the time in milliseconds (plus a counter).</summary>
    public static string NewPhotoId(string zedId, int n) =>
        zedId + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString(CultureInfo.InvariantCulture) + n.ToString("00", CultureInfo.InvariantCulture);

    /// <summary>A photo id the page may refer to: the unit's own (ZED ID, then digits), short enough for the columns.</summary>
    public static bool IsPhotoId(string? value, string zedId) =>
        value is { Length: > 0 and <= 45 } v && v.StartsWith(zedId, StringComparison.OrdinalIgnoreCase) && v.Length > zedId.Length && v[zedId.Length..].All(char.IsAsciiDigit);

    public static string TimeStamp() => DateTime.Now.ToString("dd-MM-yyyy HH:mm:ss", CultureInfo.InvariantCulture);

    /// <summary>Latitude / longitude from the browser, as text, or null when not a coordinate.</summary>
    public static string? Coordinate(string? value, double limit) =>
        double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var d) && Math.Abs(d) <= limit && !double.IsNaN(d)
            ? Math.Round(d, 7).ToString(CultureInfo.InvariantCulture) : null;
}

// ---------- What the page reads ----------

public sealed record EntryFile(string Id, string Url, bool IsPdf);

public sealed record EntryProduct(string? ProductName, string? Exported, EntryFile? ProductPhoto, EntryFile? ProductDescriptionPhoto);

public sealed record EntryRawMaterial(string? RawMaterialName, string? RawMaterialPercentage, string? CountryName);

public sealed record EntryEvidence(int Id, string Code, string Name, string? Help, bool Required, bool Uploaded, string? Url);

public sealed record EntryRequirement(string Code, string Name, IReadOnlyList<EntryEvidence> Evidences);

public sealed record EntrySection(string Code, string Name, IReadOnlyList<EntryRequirement> Requirements);

/// <param name="Answers">The standard answers saved (auditsConducted, domesticCustomers, ..., energySources as a list).</param>
/// <param name="Custom">The answers to the Admin's own fields (V4AppFormValues).</param>
public sealed record EntrySaved(
    IReadOnlyDictionary<string, JsonNode?> Answers,
    IReadOnlyList<EntryProduct> Products,
    IReadOnlyList<EntryRawMaterial> RawMaterials,
    IReadOnlyList<EntryFile> SiteExteriorPhotos,
    IReadOnlyDictionary<string, string?> Custom);

/// <param name="Form">The Admin's Basic Information form for this unit and level (Admin → App Forms), as the app gets it.</param>
public sealed record EntryState(
    string Certification,
    bool Paid,
    bool Editable,
    bool Submitted,
    int? CertificationStatus,
    bool BasicInfoSaved,
    JsonObject Form,
    EntrySaved Saved,
    IReadOnlyList<EntrySection> Sections,
    EntryNc? Nc = null);

// ---------- What the page sends ----------

/// <summary>A photo of the form: one saved before (<see cref="Id"/>) or a file of this request (<see cref="Upload"/>, its form name).</summary>
public sealed record EntryPhotoRef(string? Id, string? Upload);

public sealed record EntryProductInput(string? ProductName, string? Exported, EntryPhotoRef? ProductPhoto, EntryPhotoRef? ProductDescriptionPhoto);

public sealed record EntryRawMaterialInput(string? RawMaterialName, string? RawMaterialPercentage, string? CountryName);

/// <summary>The <c>data</c> part of POST basic-info.</summary>
public sealed record EntryBasicInfoRequest(
    Dictionary<string, JsonElement>? Answers,
    List<EntryProductInput?>? Products,
    List<EntryRawMaterialInput?>? RawMaterials,
    List<EntryPhotoRef?>? SiteExteriorPhotos,
    Dictionary<string, JsonElement>? CustomFields,
    string? FormVersion,
    string? Latitude,
    string? Longitude);

public sealed record EntryMessage(string Message);

// ---------- Non-conformances ----------

/// <param name="PreviousPhotos">The site exterior photos the assessor did not accept (the NC is on them).</param>
public sealed record EntryNcSite(string? AssessorRemarks, IReadOnlyList<string> PreviousPhotos, bool Answered);

public sealed record EntryNcProduct(int Id, string? ProductName, string? AssessorRemarks, bool Answered);

public sealed record EntryNcRequirement(int Id, string Code, string Name, string? AssessorRemarks, bool Answered, string? Url);

public sealed record EntryNcSection(string Code, string Name, IReadOnlyList<EntryNcRequirement> Requirements);

/// <summary>The open NC: what the assessor raised and what is answered so far.</summary>
public sealed record EntryNc(int Number, EntryNcSite? SiteExterior, IReadOnlyList<EntryNcProduct> Products, IReadOnlyList<EntryNcSection> Sections);
