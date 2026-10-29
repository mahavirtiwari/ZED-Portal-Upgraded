using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;
using Zed.Core.Content;
using Zed.Core.Data;
using Zed.Core.Http;

namespace Zed.Portal.Features.Msme;

/// <summary>
/// Serves the signed-in MSME's documents (pledge / Bronze / Silver / Gold / ZED-X certificates, payment
/// receipts, invoices) and the guideline documents listed on My Documents.
/// <para>
/// On the old site these were public static files at guessable URLs
/// (<c>/Certificates/ZEDMSME000123/Pledge.pdf</c>). Here a file is served only when
/// SP_MSME_GET_MY_DOCUMENTS lists it for the ZED ID in the sign-in cookie, so the request path is
/// only a lookup key: it must equal one of the paths the procedure returned.
/// </para>
/// <para>
/// Path mapping: the procedure returns <c>{UrlsMasterData.UrlName}/{relative path}</c>; the host
/// part is dropped and the relative path is resolved under <see cref="PortalOptions.StorageRoot"/>
/// (point it at the old site root, e.g. <c>E:\Publish\ZEDCS_LIVE\ZEDCS_V2_LIVE</c>, or a copy
/// with the same layout). See <see cref="MsmeFilePaths"/>.
/// </para>
/// </summary>
[Route("api/msme/files")]
public sealed class MsmeFilesController(
    ISqlExecutor db,
    IWebHostEnvironment env,
    IOptions<PortalOptions> portal,
    IDocumentAccessStore access,
    PledgeCertificateService pledges,
    ILogger<MsmeFilesController> log) : MsmeApiController
{
    private static readonly FileExtensionContentTypeProvider ContentTypes = new();

    /// <summary>
    /// The signed-in MSME's pledge certificate (the old dashboard link): V4 draws it now from the registration (it is not
    /// stored); the pages open /msme/pledge-certificate instead.
    /// </summary>
    [HttpGet("pledge-certificate")]
    public async Task<IActionResult> PledgeCertificate(CancellationToken ct) =>
        await pledges.LoadAsync(db, ZedId, ct) is { } d ? PledgePdf.Result(this, pledges, d, inline: true) : NotFound();

    /// <summary>GET api/msme/files/Certificates/ZEDMSME000123/Pledge.pdf (paths as returned by api/msme/documents).</summary>
    [HttpGet("{**path}")]
    public async Task<IActionResult> Get(string? path, CancellationToken ct)
    {
        // Unknown, foreign and malformed paths all answer 404 so file existence is not revealed.
        var requested = MsmeFilePaths.Normalise(path);
        if (requested is null) return NotFound();

        // Certificates/{ZedId}/Pledge.pdf (My Documents, older links): drawn now, never read from storage (V4).
        if (MsmeFilePaths.IsPledge(requested, ZedId))
            return await pledges.LoadAsync(db, ZedId, ct) is { } d ? PledgePdf.Result(this, pledges, d, inline: true) : NotFound();

        // Guidelines the Admin gave to other account types only are not served to an MSME.
        var documents = await MsmeMyDocuments.LoadAsync(db, ZedId, ct);
        // V4 levels (ZED-X) are listed as on My Documents (the procedure names Bronze, Silver and Gold only).
        await MsmeMyDocuments.AddV4LevelsAsync(db, documents, ZedId, ct);
        var sets = MsmeGuidelines.ForMsme(documents, await access.AllAsync(ct));
        var entry = MsmeMyDocuments.Files(sets, ZedId)
            .FirstOrDefault(f => string.Equals(f.RelativePath, requested, StringComparison.OrdinalIgnoreCase));
        if (entry is null) return NotFound();

        var fullPath = MsmeFilePaths.Find(MsmeFilePaths.Root(env, portal.Value), entry.RelativePath);
        if (fullPath is null)
        {
            log.LogInformation("Listed document {Path} for {ZedId} is missing from storage", entry.RelativePath, ZedId);
            return NotFound();
        }

        var fileName = Path.GetFileName(fullPath);
        var contentType = ContentTypes.TryGetContentType(fileName, out var t) ? t : "application/octet-stream";
        Response.Headers.XContentTypeOptions = "nosniff";
        if (MsmeFilePaths.IsInline(fileName))
        {
            // PDFs open in a new tab, as before; the name is still offered when saving.
            Response.Headers.ContentDisposition = new ContentDispositionHeaderValue("inline") { FileNameStar = fileName }.ToString();
            return PhysicalFile(fullPath, contentType, enableRangeProcessing: true);
        }
        return PhysicalFile(fullPath, contentType, fileName, enableRangeProcessing: true);
    }
}

public enum MsmeFileScope
{
    /// <summary>Guideline documents, the same for every MSME.</summary>
    Public,
    /// <summary>Files of one MSME; the path must also name its ZED ID.</summary>
    Own,
}

public sealed record MsmeFileEntry(string RelativePath, MsmeFileScope Scope);

/// <summary>
/// Maps the legacy document URLs/paths to paths relative to <see cref="PortalOptions.StorageRoot"/>
/// and guards against reading anything else.
/// <list type="bullet">
/// <item><c>https://loginzed.msme.gov.in/Certificates/ZEDMSME000123/Pledge.pdf</c> → <c>{StorageRoot}/Certificates/ZEDMSME000123/Pledge.pdf</c></item>
/// <item><c>…/Certifications/DA/{ZedId}/Bronze.pdf</c>, <c>…/Surveillance/Certificates/SA/{ZedId}/Gold.pdf</c> → same relative path</item>
/// <item><c>…/PDFs/SA/{ZedId}/Bronze_Payment_Receipt.pdf</c>, <c>…/ReceiptInvoice/{InvoiceNo}_{ZedId}_{Type}.pdf</c> → same relative path</item>
/// <item>Guidelines: <c>…/Uploads/Documents/{name}</c> or <c>…/Documents/{name}</c> → same relative path</item>
/// </list>
/// The procedures pick <c>Certificates</c> (generated today) or <c>Certifications</c> (older; the
/// old server moved files there) from dates; both folders are tried. The pledge certificate path is not read from
/// storage: V4 draws it (<see cref="IsPledge"/>).
/// </summary>
public static class MsmeFilePaths
{
    public const string ApiPrefix = "/api/msme/files/";

    /// <summary>Guideline documents may only come from these folders (where the admin upload saved them).</summary>
    public static readonly string[] PublicFolders = ["Uploads/Documents/", "Documents/"];

    /// <summary>File types the portal stores (certificates, receipts and the admin guideline upload types).</summary>
    private static readonly HashSet<string> AllowedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".pdf", ".jpg", ".jpeg", ".png", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".csv", ".txt",
    };

    private static readonly HashSet<string> InlineExtensions = new(StringComparer.OrdinalIgnoreCase) { ".pdf", ".jpg", ".jpeg", ".png" };

    private static readonly char[] ForbiddenChars = [':', '*', '?', '"', '<', '>', '|', '\\'];

    /// <summary>
    /// A legacy value (absolute URL on the old site, <c>~/</c> path or relative path with either slash)
    /// as a normalised relative path, or null when it cannot be served from storage.
    /// </summary>
    public static string? FromLegacy(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var v = value.Trim().Replace('\\', '/');
        // "//host/..." is a UNC path or a protocol-relative URL; "/..." is site-relative.
        if (v.StartsWith("//", StringComparison.Ordinal)) return null;
        if (v.StartsWith('/'))
        {
            v = v[1..];
        }
        else if (Uri.TryCreate(v, UriKind.Absolute, out var uri))
        {
            if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps) return null;
            v = Uri.UnescapeDataString(uri.AbsolutePath);
        }
        else if (v.StartsWith("~/", StringComparison.Ordinal))
        {
            v = v[2..];
        }
        return Normalise(v.TrimStart('/'));
    }

    /// <summary>
    /// Validates a relative path: no rooted or drive paths, no <c>.</c>/<c>..</c> or empty segments,
    /// no characters Windows treats specially, and a known file type. Returns it with '/' separators.
    /// </summary>
    public static string? Normalise(string? relative)
    {
        if (string.IsNullOrWhiteSpace(relative) || relative.Length > 500) return null;
        var segments = relative.Split('/');
        foreach (var s in segments)
        {
            // Windows drops trailing dots and spaces, so "..." or ".. " could act as "..": refuse them all.
            if (s.Length == 0 || s[0] == ' ' || s[^1] == '.' || s[^1] == ' ' ||
                s.IndexOfAny(ForbiddenChars) >= 0 || s.Any(char.IsControl))
                return null;
        }
        if (!AllowedExtensions.Contains(Path.GetExtension(segments[^1]))) return null;
        return string.Join('/', segments);
    }

    /// <summary>True when a folder or a file-name token (split on _ - . and space) is exactly the ZED ID.</summary>
    public static bool BelongsTo(string relative, string zedId) =>
        !string.IsNullOrEmpty(zedId) && relative.Split('/')
            .SelectMany(s => s.Split(['_', '-', '.', ' ']).Prepend(s))
            .Any(token => string.Equals(token, zedId, StringComparison.OrdinalIgnoreCase));

    public static bool IsPublicFolder(string relative) =>
        PublicFolders.Any(f => relative.StartsWith(f, StringComparison.OrdinalIgnoreCase));

    public static bool IsInline(string fileName) => InlineExtensions.Contains(Path.GetExtension(fileName));

    /// <summary>The pledge certificate path of this ZED ID: Certificates/{ZedId}/Pledge.pdf (or Certifications/...).</summary>
    public static bool IsPledge(string relative, string zedId)
    {
        var s = relative.Split('/');
        return s.Length == 3 && (s[0].Equals("Certificates", StringComparison.OrdinalIgnoreCase) || s[0].Equals("Certifications", StringComparison.OrdinalIgnoreCase))
            && s[1].Equals(zedId, StringComparison.OrdinalIgnoreCase) && s[2].Equals("Pledge.pdf", StringComparison.OrdinalIgnoreCase);
    }

    public static string ToApiUrl(string relative) =>
        ApiPrefix + string.Join('/', relative.Split('/').Select(Uri.EscapeDataString));

    /// <summary>The path itself, then the same path with Certificates ⇄ Certifications swapped.</summary>
    public static IEnumerable<string> StorageCandidates(string relative)
    {
        yield return relative;
        var segments = relative.Split('/');
        var i = segments.Length > 1 && segments[0].Equals("Surveillance", StringComparison.OrdinalIgnoreCase) ? 1 : 0;
        string? other = segments[i].ToLowerInvariant() switch
        {
            "certificates" => "Certifications",
            "certifications" => "Certificates",
            _ => null,
        };
        if (other is null || segments.Length < i + 2) yield break;
        segments[i] = other;
        yield return string.Join('/', segments);
    }

    /// <summary>The storage root of the portal (<see cref="PortalOptions.StorageRoot"/>, relative to the content root).</summary>
    public static string Root(IWebHostEnvironment env, PortalOptions portal) =>
        Path.GetFullPath(Path.Combine(env.ContentRootPath, portal.StorageRoot));

    /// <summary>The stored file of a normalised relative path (either certificate folder), or null when it is not there.</summary>
    public static string? Find(string storageRoot, string relative) =>
        StorageCandidates(relative).Select(c => Resolve(storageRoot, c)).FirstOrDefault(p => p is not null && File.Exists(p));

    /// <summary>Full path of a normalised relative path, or null if it would leave the storage root.</summary>
    public static string? Resolve(string storageRoot, string relative)
    {
        var comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
        var root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(storageRoot)) + Path.DirectorySeparatorChar;
        if (Path.IsPathRooted(relative)) return null;
        var full = Path.GetFullPath(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar)));
        return full.StartsWith(root, comparison) ? full : null;
    }
}
