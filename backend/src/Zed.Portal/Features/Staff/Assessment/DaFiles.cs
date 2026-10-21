using Zed.Core.Http;
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
/// Surveillance (shared storage root): the Bronze surveillance app wrote under <c>surveillancemobileapi/Photos|CertifiedPhotos/…</c>
/// (the procedure's PhotosBasePath) and the surveillance site's screenshots were <c>/Surveillance/Uploads/DA/…</c>, so the same
/// MSME's main and surveillance files never share a folder.
/// A rejected copy of a record (ZED ID <c>ZEDMSME000123_D_45</c>, surveillance archive <c>ZEDMSME000123_S_45</c>) also finds
/// the files of the MSME's own folder.
/// </summary>
public static class DaFiles
{
    private static readonly HashSet<string> Extensions = new(StringComparer.OrdinalIgnoreCase) { ".jpg", ".jpeg", ".png", ".pdf" };

    /// <summary>Folder of the app uploads and of the assessor's screenshots, per system.</summary>
    private sealed record Layout(string AppRoot, string[] Uploads);

    private static readonly Layout MainLayout = new("mobileapi", ["Uploads", "DA"]);
    private static readonly Layout SurveillanceLayout = new("surveillancemobileapi", ["Surveillance", "Uploads", "DA"]);

    private static Layout For(PortalSystem system) => system == PortalSystem.Surveillance ? SurveillanceLayout : MainLayout;

    public static string ApiPrefix(string zedId, string certification) =>
        $"/api/staff/assessment/da/{Uri.EscapeDataString(zedId)}/{Uri.EscapeDataString(certification)}/files/";

    /// <summary>Validated relative path (see <see cref="MsmeFilePaths.Normalise"/>), images and PDFs only.</summary>
    public static string? Normalise(string? relative) =>
        MsmeFilePaths.Normalise(relative) is { } p && Extensions.Contains(Path.GetExtension(p)) ? p : null;

    /// <summary>
    /// Index of the ZED ID folder when the path is in one of the system's stores (app uploads or screenshots), else -1.
    /// </summary>
    private static int ZedIndex(string[] s, PortalSystem system)
    {
        var l = For(system);
        if (s.Length >= 2 && Eq(s[0], l.AppRoot) && (Eq(s[1], "Photos") || Eq(s[1], "CertifiedPhotos"))) return 2;
        if (s.Length > l.Uploads.Length && l.Uploads.Select((p, i) => Eq(s[i], p)).All(x => x)) return l.Uploads.Length;
        return -1;
    }

    /// <summary>True when the path is in one of the record's folders listed above.</summary>
    public static bool BelongsTo(string relative, string zedId, string certification, PortalSystem system = PortalSystem.Main)
    {
        var s = relative.Split('/');
        var z = ZedIndex(s, system);
        // ZED ID, certification, then at least the file name.
        if (z < 0 || s.Length < z + 3) return false;
        return (Eq(s[z], zedId) || Eq(s[z], AssessmentInput.BaseZedId(zedId))) && Eq(s[z + 1], certification);
    }

    /// <summary>The address the page uses for a file of the record, or null when the name is not a servable file.</summary>
    public static string? Url(string zedId, string certification, string relative, PortalSystem system = PortalSystem.Main) =>
        Normalise(relative) is { } p && BelongsTo(p, zedId, certification, system)
            ? ApiPrefix(zedId, certification) + string.Join('/', p.Split('/').Select(Uri.EscapeDataString))
            : null;

    /// <summary>MSME app uploads: <c>{mobileapi|surveillancemobileapi}/{Photos|CertifiedPhotos}/{ZedId}/{Certification}/{folder}/{file}</c>.</summary>
    public static string? AppUpload(string zedId, string certification, bool moved, string folder, string? file, PortalSystem system = PortalSystem.Main) =>
        string.IsNullOrWhiteSpace(file) || file.Contains('/') || file.Contains('\\')
            ? null
            : Url(zedId, certification, $"{For(system).AppRoot}/{(moved ? "CertifiedPhotos" : "Photos")}/{zedId}/{certification}/{folder}/{file.Trim()}", system);

    /// <summary>Folder of an evidence's screenshots, relative to the storage root.</summary>
    public static string ScreenshotFolder(
        string zedId, string certification, string sectionCode, string requirementCode, string evidenceCode, PortalSystem system = PortalSystem.Main) =>
        $"{string.Join('/', For(system).Uploads)}/{zedId}/{certification}/{sectionCode}.{requirementCode}.{evidenceCode}";

    /// <summary>The path, then the moved/not-moved counterpart, then both again in the MSME's own folder.</summary>
    public static IEnumerable<string> StorageCandidates(string relative, string zedId, PortalSystem system = PortalSystem.Main)
    {
        var s = relative.Split('/');
        var z = ZedIndex(s, system);
        var variants = new List<string[]> { s };
        if (z == 2 && Eq(s[0], For(system).AppRoot))
        {
            var moved = (string[])s.Clone();
            moved[1] = Eq(s[1], "Photos") ? "CertifiedPhotos" : "Photos";
            variants.Add(moved);
        }
        var baseId = AssessmentInput.BaseZedId(zedId);
        if (z >= 0 && !Eq(baseId, s[z]))
            variants.AddRange(variants.ToList().Select(v => { var c = (string[])v.Clone(); c[z] = baseId; return c; }));
        return variants.Select(v => string.Join('/', v)).Distinct(StringComparer.OrdinalIgnoreCase);
    }

    private static bool Eq(string a, string b) => string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
}
