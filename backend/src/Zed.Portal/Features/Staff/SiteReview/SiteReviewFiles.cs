using Zed.Portal.Features.Msme;
using Zed.Portal.Features.Staff.Assessment;

namespace Zed.Portal.Features.Staff.SiteReview;

/// <summary>
/// Photos and documents of the site-assessment review page and where they are stored. The old page put
/// the procedures' addresses (<c>http://loginzed.msme.gov.in/mobileapi/SaPhotos/{ZedId}/...</c>, public
/// static files: SECURITY-FINDINGS #34) straight into <c>img src</c>. Here the host is dropped, the path is
/// resolved under <c>Portal:StorageRoot</c> (same layout as <see cref="SitePhotoPaths"/>), and the file is
/// served by <see cref="SiteReviewController.File"/> only to staff who may see the record:
/// <list type="bullet">
/// <item><c>mobileapi/SaPhotos|SaCertifiedPhotos/{ZedId}/…</c> — site assessor app (site exterior, meetings, site tour, evidences, products, selfies)</item>
/// <item><c>mobileapi/Photos|CertifiedPhotos/{ZedId}/{Certification}/…</c> — MSME app uploads of the desktop assessment</item>
/// <item><c>mobileapi/Attendance/{ZedId}/{Certification}/{PhotoId}.jpg</c> — assessors' punch-in/punch-out selfies</item>
/// <item><c>surveillancemobileapi/SaPhotos/{ZedId}/…</c> — surveillance site tour and evidences</item>
/// </list>
/// The folder after the store must be the record's ZED ID (or, for a rejected copy ZEDMSME000123_D_45, the
/// MSME's own ZED ID); only images and PDFs are served.
/// </summary>
public static class SiteReviewFiles
{
    private static readonly HashSet<string> Extensions = new(StringComparer.OrdinalIgnoreCase) { ".jpg", ".jpeg", ".png", ".pdf" };

    private static readonly (string App, string Store, string? Moved)[] Stores =
    [
        ("mobileapi", "SaPhotos", "SaCertifiedPhotos"),
        ("mobileapi", "SaCertifiedPhotos", "SaPhotos"),
        ("mobileapi", "Photos", "CertifiedPhotos"),
        ("mobileapi", "CertifiedPhotos", "Photos"),
        ("mobileapi", "Attendance", null),
        ("surveillancemobileapi", "SaPhotos", null),
    ];

    public static string ApiPrefix(string zedId, string certification) =>
        $"/api/staff/site-review/{Uri.EscapeDataString(zedId)}/{Uri.EscapeDataString(certification)}/files/";

    /// <summary>Validated relative path (see <see cref="MsmeFilePaths.Normalise"/>), images and PDFs only.</summary>
    public static string? Normalise(string? relative) =>
        MsmeFilePaths.Normalise(relative) is { } p && Extensions.Contains(Path.GetExtension(p)) ? p : null;

    public static bool BelongsTo(string relative, string zedId)
    {
        var s = relative.Split('/');
        return s.Length >= 4 && FindStore(s) is not null &&
               (Eq(s[2], zedId) || Eq(s[2], AssessmentInput.BaseZedId(zedId)));
    }

    /// <summary>The page's address for a procedure value (absolute URL, site-relative or relative path), or null.</summary>
    public static string? Url(string zedId, string certification, string? legacy) =>
        MsmeFilePaths.FromLegacy(legacy) is { } p && Normalise(p) is { } n && BelongsTo(n, zedId)
            ? ApiPrefix(zedId, certification) + string.Join('/', n.Split('/').Select(Uri.EscapeDataString))
            : null;

    /// <summary>An upload of the MSME app: <c>mobileapi/{Photos|CertifiedPhotos}/{ZedId}/{Certification}/{folder}/{file}</c>.</summary>
    public static string? AppUpload(string zedId, string certification, bool moved, string folder, string? file) =>
        string.IsNullOrWhiteSpace(file) || file.Contains('/') || file.Contains('\\')
            ? null
            : Url(zedId, certification, $"mobileapi/{(moved ? "CertifiedPhotos" : "Photos")}/{zedId}/{certification}/{folder}/{file.Trim()}");

    /// <summary>The path, its moved/not-moved counterpart, and both again in the MSME's own folder.</summary>
    public static IEnumerable<string> StorageCandidates(string relative, string zedId)
    {
        var s = relative.Split('/');
        var variants = new List<string[]> { s };
        if (FindStore(s) is { Moved: { } moved })
        {
            var m = (string[])s.Clone();
            m[1] = moved;
            variants.Add(m);
        }
        var baseId = AssessmentInput.BaseZedId(zedId);
        if (!Eq(baseId, s[2]))
            variants.AddRange(variants.ToList().Select(v => { var c = (string[])v.Clone(); c[2] = baseId; return c; }));
        return variants.Select(v => string.Join('/', v)).Distinct(StringComparer.OrdinalIgnoreCase);
    }

    private static (string App, string Store, string? Moved)? FindStore(string[] s) =>
        s.Length < 2 ? null : Stores.Cast<(string App, string Store, string? Moved)?>()
            .FirstOrDefault(st => Eq(st!.Value.App, s[0]) && Eq(st.Value.Store, s[1]));

    private static bool Eq(string a, string b) => string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
}
