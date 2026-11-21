using Zed.Portal.Features.Msme;
using Zed.Portal.Features.Staff.Assessment;

namespace Zed.Portal.Features.Consultancy.Milestones;

/// <summary>
/// Photos of a handholding milestone. The procedures return public addresses of the consultant app
/// (<c>{UrlName}/consultancymobileapi/SaPhotos/{ZedId}/{Level}/...</c>, <c>.../consultancymobileapi/Attendance/{ZedId}/{Level}/{PhotoId}.jpg</c>);
/// the host is dropped, the path is resolved under <c>Portal:StorageRoot</c> (shared with main, where
/// <c>consultancymobileapi</c> is the consultant app's folder) and the file is served by
/// <see cref="MilestoneReviewController.File"/> only to the users who may open the milestone page. The folder after the
/// store must be the unit's ZED ID (or, for a rejected copy, its base ZED ID); images and PDFs only.
/// </summary>
public static class MilestoneFiles
{
    private static readonly HashSet<string> Extensions = new(StringComparer.OrdinalIgnoreCase) { ".jpg", ".jpeg", ".png", ".pdf" };
    private static readonly string[] Stores = ["SaPhotos", "Attendance"];
    private const string App = "consultancymobileapi";

    /// <summary>The consultant app's attendance selfies: <c>consultancymobileapi/Attendance/{ZedId}/{Level}/{PhotoId}.jpg</c>.</summary>
    public const string AttendanceFolder = App + "/Attendance";

    /// <summary>
    /// 2026-11-21 (UI audit: every consultant-app photo of the milestone page answered 404): the consultant mobile API
    /// (/Consultancymobileapi, Mobile:System Consultancy) writes its files under its own <c>Mobile:StorageRoot</c>
    /// (<c>{root}\Attendance\{ZedId}\{Level}\…</c>, <c>{root}\SaPhotos\…</c>, MobileStorage.Folder), while this host looked
    /// only in <c>{Portal:StorageRoot}\consultancymobileapi\…</c>, which holds them only when that folder is the mobile API's
    /// root. This setting of the Consultancy host is that root; Install-ZedIis.ps1 sets it from the MobileConsultancy section's
    /// Mobile__StorageRoot when the Consultancy section does not give it.
    /// </summary>
    public const string AppRootSetting = "Consultancy:AppStorageRoot";

    /// <summary>Where to look, in order: (the portal's storage root, the path as given) and (the app's root, the path without
    /// <c>consultancymobileapi/</c>). Relative roots are under the content root.</summary>
    public static IReadOnlyList<(string Root, bool AppLayout)> Roots(string contentRoot, string storageRoot, string? appRoot)
    {
        string Full(string p) => Path.GetFullPath(Path.IsPathRooted(p) ? p : Path.Combine(contentRoot, p));
        var list = new List<(string Root, bool AppLayout)> { (Full(storageRoot), false) };
        if (!string.IsNullOrWhiteSpace(appRoot)) list.Add((Full(appRoot), true));
        return list;
    }

    /// <summary>The stored file of a milestone path in any root (the rejected copy's base ZED ID too), or null.</summary>
    public static string? Find(IReadOnlyList<(string Root, bool AppLayout)> roots, string relative, string zedId)
    {
        foreach (var (root, appLayout) in roots)
            foreach (var candidate in StorageCandidates(relative, zedId))
            {
                // The app's own root has no consultancymobileapi folder: Attendance/… directly (and, should it hold one, as given).
                var paths = appLayout ? new[] { WithoutApp(candidate), candidate } : [candidate];
                foreach (var p in paths)
                    if (MsmeFilePaths.Resolve(root, p) is { } full && File.Exists(full)) return full;
            }
        return null;
    }

    private static string WithoutApp(string relative) =>
        relative.StartsWith(App + "/", StringComparison.OrdinalIgnoreCase) ? relative[(App.Length + 1)..] : relative;

    public static string ApiPrefix(string zedId, string level) =>
        $"/api/consultancy/milestones/{Uri.EscapeDataString(zedId)}/{Uri.EscapeDataString(level)}/files/";

    public static string? Normalise(string? relative) =>
        MsmeFilePaths.Normalise(relative) is { } p && Extensions.Contains(Path.GetExtension(p)) ? p : null;

    public static bool BelongsTo(string relative, string zedId)
    {
        var s = relative.Split('/');
        return s.Length >= 4 && Eq(s[0], App) && Stores.Any(st => Eq(st, s[1])) &&
               (Eq(s[2], zedId) || Eq(s[2], AssessmentInput.BaseZedId(zedId)));
    }

    /// <summary>The page's address for a procedure value, or null when it is not a file of this unit.</summary>
    public static string? Url(string zedId, string level, string? legacy) =>
        MsmeFilePaths.FromLegacy(legacy) is { } p && Normalise(p) is { } n && BelongsTo(n, zedId)
            ? ApiPrefix(zedId, level) + string.Join('/', n.Split('/').Select(Uri.EscapeDataString))
            : null;

    /// <summary>The path, and the same path in the MSME's own folder for a rejected copy.</summary>
    public static IEnumerable<string> StorageCandidates(string relative, string zedId)
    {
        yield return relative;
        var s = relative.Split('/');
        var baseId = AssessmentInput.BaseZedId(zedId);
        if (Eq(s[2], baseId)) yield break;
        s[2] = baseId;
        yield return string.Join('/', s);
    }

    private static bool Eq(string a, string b) => string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
}
