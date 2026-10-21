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
