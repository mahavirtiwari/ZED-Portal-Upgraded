using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;
using Zed.Core.Http;

namespace Zed.Portal.Features.Msme;

/// <summary>
/// Serves the site-assessment and desktop-assessment photos and evidence PDFs shown on the MSME's
/// Site Assessment page (<see cref="MsmeSiteAssessmentController"/>).
/// <para>
/// On the old site these were public static files of the mobile API applications
/// (<c>https://loginzed.msme.gov.in/mobileapi/SaPhotos/ZEDMSME000123/Silver/SiteTour/1.jpg</c>), readable
/// by anyone who could guess a ZED ID. Here a file is served only when it lies in the signed-in
/// MSME's own folder of one of the photo stores listed in <see cref="SitePhotoPaths"/>.
/// </para>
/// </summary>
[Route("api/msme/site-assessment/photos")]
public sealed class MsmeSitePhotosController(
    IWebHostEnvironment env,
    IOptions<PortalOptions> portal,
    ILogger<MsmeSitePhotosController> log) : MsmeApiController
{
    private static readonly FileExtensionContentTypeProvider ContentTypes = new();

    /// <summary>GET api/msme/site-assessment/photos/mobileapi/SaPhotos/ZEDMSME000123/Silver/SiteTour/1.jpg</summary>
    [HttpGet("{**path}")]
    public IActionResult Get(string? path)
    {
        // Malformed, foreign and missing files all answer 404 so file existence is not revealed.
        var requested = SitePhotoPaths.Normalise(path);
        if (requested is null || !SitePhotoPaths.BelongsTo(requested, ZedId)) return NotFound();

        var root = Path.GetFullPath(Path.Combine(env.ContentRootPath, portal.Value.StorageRoot));
        var fullPath = SitePhotoPaths.StorageCandidates(requested)
            .Select(c => MsmeFilePaths.Resolve(root, c))
            .FirstOrDefault(p => p is not null && System.IO.File.Exists(p));
        if (fullPath is null)
        {
            log.LogInformation("Site assessment photo {Path} for {ZedId} is missing from storage", requested, ZedId);
            return NotFound();
        }

        var fileName = Path.GetFileName(fullPath);
        var contentType = ContentTypes.TryGetContentType(fileName, out var t) ? t : "application/octet-stream";
        Response.Headers.XContentTypeOptions = "nosniff";
        Response.Headers.CacheControl = "private, max-age=3600";
        Response.Headers.ContentDisposition = new ContentDispositionHeaderValue("inline") { FileNameStar = fileName }.ToString();
        return PhysicalFile(fullPath, contentType, enableRangeProcessing: true);
    }
}

/// <summary>
/// Where the photos of an assessment are stored and who may read them.
/// <para>
/// The procedures (SP_ASSESSMENT_SA_DETAILS / SP_ASSESSMENT_DA_DETAILS and their ZED_CONSULTANT and
/// ZED_SURVEILLANCE counterparts) return, or the old page built, addresses of the form
/// <c>{UrlsMasterData.UrlName}/{store}/{ZedId}/{certification}/...</c>, where <c>{store}</c> is a
/// folder of one of the mobile API applications hosted under the old site. The host is dropped and the
/// rest is resolved under <see cref="PortalOptions.StorageRoot"/> (point it at the old site root, or a
/// copy with the same layout, in which <c>mobileapi</c>, <c>consultancymobileapi</c> and
/// <c>surveillancemobileapi</c> are the folders of those applications):
/// </para>
/// <list type="bullet">
/// <item><c>…/mobileapi/SaPhotos/{ZedId}/{Cert}/…</c> → <c>{StorageRoot}/mobileapi/SaPhotos/{ZedId}/{Cert}/…</c> (site assessment: SiteTour/, BasicInfo/, site exterior, selfies; written by SwachhSurvekshanServices SAController to <c>~/SaPhotos</c>)</item>
/// <item><c>…/mobileapi/SaCertifiedPhotos/{ZedId}/…</c> → same relative path (the procedures switch to it once MsmeCertifications.PhotosPath is set, i.e. the files were moved)</item>
/// <item><c>…/mobileapi/Photos/{ZedId}/{Cert}/BasicInfo/{file}</c>, <c>…/Evidences/{EvidenceId}.pdf</c> and <c>…/mobileapi/CertifiedPhotos/…</c> → same relative path (desktop assessment uploads by the MSME app)</item>
/// <item><c>…/consultancymobileapi/SaPhotos/{ZedId}/{Cert}/…</c> → same relative path (handholding milestones, ZED_CONSULTANT)</item>
/// <item><c>…/surveillancemobileapi/SaPhotos/{ZedId}/{Cert}/…</c> → same relative path (surveillance site tour and evidences, ZED_SURVEILLANCE)</item>
/// </list>
/// A path is served only when the folder right after the store is exactly the signed-in ZED ID, and
/// only for image and PDF files. When a file is not found, the moved/not-moved counterpart
/// (<c>SaPhotos</c> ⇄ <c>SaCertifiedPhotos</c>, <c>Photos</c> ⇄ <c>CertifiedPhotos</c>) is tried.
/// </summary>
public static class SitePhotoPaths
{
    public const string ApiPrefix = "/api/msme/site-assessment/photos/";

    /// <summary>Photo stores (application folder, store folder) and their moved counterparts.</summary>
    private static readonly (string App, string Store, string? Moved)[] Stores =
    [
        ("mobileapi", "SaPhotos", "SaCertifiedPhotos"),
        ("mobileapi", "SaCertifiedPhotos", "SaPhotos"),
        ("mobileapi", "Photos", "CertifiedPhotos"),
        ("mobileapi", "CertifiedPhotos", "Photos"),
        ("consultancymobileapi", "SaPhotos", null),
        ("surveillancemobileapi", "SaPhotos", null),
    ];

    private static readonly HashSet<string> Extensions = new(StringComparer.OrdinalIgnoreCase) { ".jpg", ".jpeg", ".png", ".pdf" };

    /// <summary>A request path as a validated relative path (see <see cref="MsmeFilePaths.Normalise"/>), images and PDFs only.</summary>
    public static string? Normalise(string? relative) =>
        MsmeFilePaths.Normalise(relative) is { } p && Extensions.Contains(Path.GetExtension(p)) ? p : null;

    /// <summary>True when the path is inside the given MSME's folder of a known photo store.</summary>
    public static bool BelongsTo(string relative, string zedId)
    {
        var s = relative.Split('/');
        return s.Length >= 4 && !string.IsNullOrEmpty(zedId) &&
               FindStore(s) is not null &&
               string.Equals(s[2], zedId, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// The address the page uses for a legacy value (absolute URL, site-relative or relative path), or
    /// null when it is not a photo of this MSME that can be served from storage.
    /// </summary>
    public static string? ToApiUrl(string? legacy, string zedId) =>
        MsmeFilePaths.FromLegacy(legacy) is { } p && Normalise(p) is { } n && BelongsTo(n, zedId)
            ? ApiPrefix + string.Join('/', n.Split('/').Select(Uri.EscapeDataString))
            : null;

    /// <summary>The path itself, then the same path in the moved (or not moved) store.</summary>
    public static IEnumerable<string> StorageCandidates(string relative)
    {
        yield return relative;
        var s = relative.Split('/');
        if (FindStore(s) is not { Moved: { } moved }) yield break;
        s[1] = moved;
        yield return string.Join('/', s);
    }

    private static (string App, string Store, string? Moved)? FindStore(string[] segments) =>
        segments.Length < 2 ? null : Stores.Cast<(string App, string Store, string? Moved)?>().FirstOrDefault(st =>
            string.Equals(st!.Value.App, segments[0], StringComparison.OrdinalIgnoreCase) &&
            string.Equals(st.Value.Store, segments[1], StringComparison.OrdinalIgnoreCase));
}
