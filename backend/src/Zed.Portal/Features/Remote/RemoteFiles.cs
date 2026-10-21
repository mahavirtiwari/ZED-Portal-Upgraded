using System.Globalization;
using System.Security.Cryptography;
using Zed.Portal.Features.Msme;

namespace Zed.Portal.Features.Remote;

/// <summary>
/// Photos of a remote assessment and where they are stored. On the old site they were public static
/// files: <c>SaveCapturedPhoto</c> wrote <c>~/SaPhotos/{zedId}/{certification}/{timestamp}.jpg</c> under the
/// web root with both folder names taken from the request (path traversal, SECURITY-FINDINGS #32), and the
/// RA app's selfie is <c>/mobileapi/Photos/{ZedId}/{Certification}/RA/Selfe.jpg</c>. Here they are served by
/// <see cref="RemoteAssessmentController.File"/> only to the unit's assessors, and new captures are written
/// by the server under <see cref="Zed.Core.Http.PortalOptions.StorageRoot"/> (the old site root, or a copy
/// with the same layout) with names it chooses. Paths are relative to the storage root:
/// <list type="bullet">
/// <item><c>SaPhotos/{ZedId}/{Certification}/{file}</c> — photos captured from the video on this screen</item>
/// <item><c>mobileapi/{SaPhotos|SaCertifiedPhotos|Photos|CertifiedPhotos}/{ZedId}/…</c> — uploads of the apps
/// (the RA app's selfie; moved to the Certified folders once MsmeCertifications.PhotosPath is set, both are tried)</item>
/// <item>Surveillance only (<c>surveillanceApp</c>): <c>surveillancemobileapi/SaPhotos/{ZedId}/{Certification}/…</c> — the
/// surveillance site-assessor app's photos and the meeting photos and selfie uploaded on the surveillance remote page
/// (stored there with the legacy names, see <see cref="SaveSurveillanceUploadAsync"/>)</item>
/// </list>
/// Desktop-assessment files (the MSME's own uploads) keep their <c>DaFiles</c> addresses, served by the
/// desktop-assessment endpoint, which allows the site and co-assessor of the record.
/// </summary>
public static class RemoteFiles
{
    private static readonly HashSet<string> Extensions = new(StringComparer.OrdinalIgnoreCase) { ".jpg", ".jpeg", ".png" };

    private static readonly (string Store, string Moved)[] AppStores =
        [("SaPhotos", "SaCertifiedPhotos"), ("SaCertifiedPhotos", "SaPhotos"), ("Photos", "CertifiedPhotos"), ("CertifiedPhotos", "Photos")];

    public const long MaxPhotoBytes = 5 * 1024 * 1024;

    public static string ApiPrefix(string zedId, string certification) =>
        $"/api/staff/remote/{Uri.EscapeDataString(zedId)}/{Uri.EscapeDataString(certification)}/files/";

    /// <summary>Validated relative path (see <see cref="MsmeFilePaths.Normalise"/>), images only.</summary>
    public static string? Normalise(string? relative) =>
        MsmeFilePaths.Normalise(relative) is { } p && Extensions.Contains(Path.GetExtension(p)) ? p : null;

    /// <summary>True when the path is one of the unit's remote-assessment photo folders listed above.</summary>
    public static bool BelongsTo(string relative, string zedId, string certification, bool surveillanceApp = false)
    {
        var s = relative.Split('/');
        if (s.Length >= 4 && Eq(s[0], "SaPhotos")) return Eq(s[1], zedId) && Eq(s[2], certification);
        if (surveillanceApp && s.Length >= 5 && Eq(s[0], SurveillanceApp) && Eq(s[1], "SaPhotos"))
            return Eq(s[2], zedId) && Eq(s[3], certification);
        if (s.Length >= 4 && Eq(s[0], "mobileapi") && AppStores.Any(a => Eq(a.Store, s[1]))) return Eq(s[2], zedId);
        return false;
    }

    /// <summary>Address for a value stored by the procedures (absolute URL, site-relative path), or null when it is not a photo of this unit.</summary>
    public static string? Url(string zedId, string certification, string? legacy, bool surveillanceApp = false) =>
        Relative(legacy, zedId, certification, surveillanceApp) is { } p
            ? ApiPrefix(zedId, certification) + string.Join('/', p.Split('/').Select(Uri.EscapeDataString))
            : null;

    /// <summary>The stored value as a validated relative path of this unit, or null.</summary>
    public static string? Relative(string? legacy, string zedId, string certification, bool surveillanceApp = false) =>
        MsmeFilePaths.FromLegacy(CollapseSlashes(legacy)) is { } p && Normalise(p) is { } n && BelongsTo(n, zedId, certification, surveillanceApp) ? n : null;

    /// <summary>
    /// The procedures concatenate paths that the old code built with Path.Combine on Windows, so stored values
    /// look like <c>https://host/mobileapi//Photos\ZED…\Silver\RA\Selfe.jpg</c>: backslashes become slashes and
    /// repeated slashes after the host are collapsed (a leading <c>//</c> stays, so UNC paths are still refused).
    /// </summary>
    private static string? CollapseSlashes(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return value;
        var v = value.Trim().Replace('\\', '/');
        var scheme = v.IndexOf("://", StringComparison.Ordinal);
        var start = scheme >= 0 ? v.IndexOf('/', scheme + 3) : v.StartsWith("//", StringComparison.Ordinal) ? -1 : 0;
        if (start < 0) return v;
        var head = v[..start];
        var rest = System.Text.RegularExpressions.Regex.Replace(v[start..], "/{2,}", "/");
        return head + rest;
    }

    /// <summary>The path, then the same path in the moved (or not moved) app store.</summary>
    public static IEnumerable<string> StorageCandidates(string relative)
    {
        yield return relative;
        var s = relative.Split('/');
        if (!Eq(s[0], "mobileapi")) yield break;
        var store = AppStores.FirstOrDefault(a => Eq(a.Store, s[1]));
        if (store.Store is null) yield break;
        s[1] = store.Moved;
        yield return string.Join('/', s);
    }

    /// <summary>
    /// Decodes a captured frame (a <c>data:image/jpeg|png;base64,</c> URL or plain base64) and checks it is a
    /// JPEG or PNG within the size limit. Returns the bytes and the extension matching the content.
    /// </summary>
    public static (byte[]? Bytes, string? Extension, string? Error) DecodeImage(string? data)
    {
        if (string.IsNullOrWhiteSpace(data)) return (null, null, "Please capture a photo.");
        var value = data.Trim();
        if (value.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
        {
            var comma = value.IndexOf(',', StringComparison.Ordinal);
            var meta = comma > 0 ? value[5..comma] : "";
            if (comma < 0 || !meta.EndsWith(";base64", StringComparison.OrdinalIgnoreCase) ||
                !(meta.StartsWith("image/jpeg", StringComparison.OrdinalIgnoreCase) || meta.StartsWith("image/png", StringComparison.OrdinalIgnoreCase)))
                return (null, null, "Only JPEG or PNG photos can be saved.");
            value = value[(comma + 1)..];
        }
        if (value.Length > (MaxPhotoBytes / 3 + 1) * 4) return (null, null, "The photo is too large (maximum 5 MB).");
        var buffer = new byte[value.Length * 3 / 4 + 3];
        if (!Convert.TryFromBase64String(value, buffer, out var written) || written == 0) return (null, null, "The photo could not be read.");
        var bytes = buffer[..written];
        if (bytes.Length > MaxPhotoBytes) return (null, null, "The photo is too large (maximum 5 MB).");
        if (bytes.Length >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF) return (bytes, ".jpg", null);
        if (bytes.Length >= 8 && bytes.AsSpan(0, 8).SequenceEqual(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A })) return (bytes, ".png", null);
        return (null, null, "Only JPEG or PNG photos can be saved.");
    }

    /// <summary>
    /// Writes a captured photo to <c>{storageRoot}/SaPhotos/{zedId}/{certification}/{timestamp}_{random}{ext}</c>
    /// (ZED ID and level are validated by the caller) and returns the site-relative path the procedure stores
    /// after the UrlsMasterData prefix, as the old action did (<c>/SaPhotos/...</c>).
    /// </summary>
    public static async Task<(string FullPath, string SitePath)> SaveCaptureAsync(string storageRoot, string zedId, string certification,
        byte[] bytes, string extension, CancellationToken ct)
    {
        var name = $"{DateTime.Now.ToString("yyyyMMddHHmmssfff", CultureInfo.InvariantCulture)}_{Convert.ToHexString(RandomNumberGenerator.GetBytes(3)).ToLowerInvariant()}{extension}";
        var relative = $"SaPhotos/{zedId}/{certification}/{name}";
        var full = MsmeFilePaths.Resolve(storageRoot, relative) ?? throw new InvalidOperationException("Photo path outside the storage root.");
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        await using (var output = new FileStream(full, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            await output.WriteAsync(bytes, ct);
        return (full, "/" + relative);
    }

    /// <summary>Folder of the surveillance mobile services under the storage root (as in SiteReviewFiles / MsmeSitePhotosController).</summary>
    public const string SurveillanceApp = "surveillancemobileapi";

    /// <summary>
    /// Writes a photo uploaded on the surveillance remote page where the surveillance SA/SaveCapturedPhoto put it:
    /// <c>{storageRoot}/surveillancemobileapi/SaPhotos/{zedId}/{certification}/{name}.jpg</c>. The name is chosen by the
    /// server (fixed prefix + time stamp); SP_ASSESSMENT_SA_DETAILS builds the address from it.
    /// </summary>
    public static async Task<string> SaveSurveillanceUploadAsync(string storageRoot, string zedId, string certification, string name,
        byte[] bytes, CancellationToken ct)
    {
        var relative = $"{SurveillanceApp}/SaPhotos/{zedId}/{certification}/{name}.jpg";
        var full = MsmeFilePaths.Resolve(storageRoot, relative) ?? throw new InvalidOperationException("Photo path outside the storage root.");
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        await using (var output = new FileStream(full, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            await output.WriteAsync(bytes, ct);
        return full;
    }

    private static bool Eq(string a, string b) => string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
}
