using Zed.Portal.Features.Msme;

namespace Zed.Portal.Features.Staff.Assessment;

/// <summary>
/// Files shown on the desktop-assessment review page and where they are stored. On the old site they
/// were public static files (<c>https://loginzed.msme.gov.in/mobileapi/Photos/{ZedId}/...</c>,
/// <c>/Uploads/DA/{ZedId}/...</c>) that anyone could read; here they are served by
/// <see cref="DesktopAssessmentController.File"/> only to users who may see the record.
/// Paths are relative to <c>PortalOptions.StorageRoot</c> (the old site root, or a copy with the same layout):
/// <list type="bullet">
/// <item><c>mobileapi/Photos/{ZedId}/{Certification}/Selfie|SiteExteriorPhotos/{PhotoId}.jpg</c>, <c>…/BasicInfo/{file}</c>,
/// <c>…/Evidences/{EvidenceId}.pdf</c> — uploads of the MSME app (moved to <c>mobileapi/CertifiedPhotos/…</c>
/// once MsmeCertifications.PhotosPath is set; both are tried)</item>
/// <item><c>Uploads/DA/{ZedId}/{Certification}/{Section}.{Requirement}.{Evidence}/{file}</c> — screenshots the
/// desktop assessor uploaded with an evidence validation (written by <see cref="EvidenceUploads"/>)</item>
/// </list>
/// A rejected copy of a record (ZED ID <c>ZEDMSME000123_D_45</c>) also finds the files of the MSME's own folder.
/// </summary>
public static class DaFiles
{
    private static readonly HashSet<string> Extensions = new(StringComparer.OrdinalIgnoreCase) { ".jpg", ".jpeg", ".png", ".pdf" };

    public static string ApiPrefix(string zedId, string certification) =>
        $"/api/staff/assessment/da/{Uri.EscapeDataString(zedId)}/{Uri.EscapeDataString(certification)}/files/";

    /// <summary>Validated relative path (see <see cref="MsmeFilePaths.Normalise"/>), images and PDFs only.</summary>
    public static string? Normalise(string? relative) =>
        MsmeFilePaths.Normalise(relative) is { } p && Extensions.Contains(Path.GetExtension(p)) ? p : null;

    /// <summary>True when the path is in one of the record's folders listed above.</summary>
    public static bool BelongsTo(string relative, string zedId, string certification)
    {
        var s = relative.Split('/');
        if (s.Length < 5) return false;
        var store = (s[0], s[1]) switch
        {
            var (a, b) when Eq(a, "mobileapi") && (Eq(b, "Photos") || Eq(b, "CertifiedPhotos")) => true,
            var (a, b) when Eq(a, "Uploads") && Eq(b, "DA") => true,
            _ => false,
        };
        return store && (Eq(s[2], zedId) || Eq(s[2], AssessmentInput.BaseZedId(zedId))) && Eq(s[3], certification);
    }

    /// <summary>The address the page uses for a file of the record, or null when the name is not a servable file.</summary>
    public static string? Url(string zedId, string certification, string relative) =>
        Normalise(relative) is { } p && BelongsTo(p, zedId, certification)
            ? ApiPrefix(zedId, certification) + string.Join('/', p.Split('/').Select(Uri.EscapeDataString))
            : null;

    /// <summary>MSME app uploads: <c>mobileapi/{Photos|CertifiedPhotos}/{ZedId}/{Certification}/{folder}/{file}</c>.</summary>
    public static string? AppUpload(string zedId, string certification, bool moved, string folder, string? file) =>
        string.IsNullOrWhiteSpace(file) || file.Contains('/') || file.Contains('\\')
            ? null
            : Url(zedId, certification, $"mobileapi/{(moved ? "CertifiedPhotos" : "Photos")}/{zedId}/{certification}/{folder}/{file.Trim()}");

    /// <summary>Folder of an evidence's screenshots, relative to the storage root.</summary>
    public static string ScreenshotFolder(string zedId, string certification, string sectionCode, string requirementCode, string evidenceCode) =>
        $"Uploads/DA/{zedId}/{certification}/{sectionCode}.{requirementCode}.{evidenceCode}";

    /// <summary>The path, then the moved/not-moved counterpart, then both again in the MSME's own folder.</summary>
    public static IEnumerable<string> StorageCandidates(string relative, string zedId)
    {
        var s = relative.Split('/');
        var variants = new List<string[]> { s };
        if (Eq(s[0], "mobileapi"))
        {
            var moved = (string[])s.Clone();
            moved[1] = Eq(s[1], "Photos") ? "CertifiedPhotos" : "Photos";
            variants.Add(moved);
        }
        var baseId = AssessmentInput.BaseZedId(zedId);
        if (!Eq(baseId, s[2]))
            variants.AddRange(variants.ToList().Select(v => { var c = (string[])v.Clone(); c[2] = baseId; return c; }));
        return variants.Select(v => string.Join('/', v)).Distinct(StringComparer.OrdinalIgnoreCase);
    }

    private static bool Eq(string a, string b) => string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
}
