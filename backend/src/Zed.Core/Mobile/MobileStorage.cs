using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;

namespace Zed.Core.Mobile;

/// <summary>A user-supplied name would have left the upload folder (or was not a plain name).</summary>
public sealed class UnsafePathException(string message) : Exception(message);

/// <summary>
/// Upload folders in the old services' layout (Photos/{ZedId}/{certification}/..., Videos/...).
/// The old code joined request values straight into paths; here every segment that came from a
/// request must be a plain name, and the final path is checked to stay under the root.
/// </summary>
public sealed class MobileStorage(IOptions<MobileOptions> options, IWebHostEnvironment env)
{
    private static readonly char[] Forbidden = ['/', '\\', ':', '*', '?', '"', '<', '>', '|', '\0'];

    public static readonly IReadOnlySet<string> ImageExtensions = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { ".jpg", ".jpeg", ".png" };
    public static readonly IReadOnlySet<string> DocumentExtensions = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { ".jpg", ".jpeg", ".png", ".pdf" };
    public static readonly IReadOnlySet<string> VideoExtensions = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { ".mp4", ".3gp", ".mov" };

    public string Root => Path.GetFullPath(Path.IsPathRooted(options.Value.StorageRoot)
        ? options.Value.StorageRoot
        : Path.Combine(env.ContentRootPath, options.Value.StorageRoot));

    public long MaxFileBytes => options.Value.MaxFileBytes;

    /// <summary>A folder under the root; created if missing. Every segment must be a plain name.</summary>
    public string Folder(params string?[] segments)
    {
        var path = Root;
        foreach (var s in segments) path = Path.Combine(path, Segment(s));
        EnsureUnderRoot(path);
        Directory.CreateDirectory(path);
        return path;
    }

    /// <summary>A file name made of a request value and a fixed or checked extension.</summary>
    public static string FileName(string? name, string extension) => Segment(name) + extension;

    /// <summary>Extension of an uploaded file, if it is one of <paramref name="allowed"/>.</summary>
    public static string Extension(string? fileName, IReadOnlySet<string> allowed)
    {
        var ext = Path.GetExtension(fileName ?? "");
        if (string.IsNullOrEmpty(ext) || !allowed.Contains(ext)) throw new UnsafePathException($"File type '{ext}' is not allowed.");
        return ext.ToLowerInvariant();
    }

    /// <summary>Uploaded file name reduced to a plain name with an allowed extension.</summary>
    public static string UploadedName(IFormFile file, IReadOnlySet<string> allowed)
    {
        var ext = Extension(file.FileName, allowed);
        var name = Path.GetFileNameWithoutExtension(Path.GetFileName(file.FileName.Replace('\\', '/')));
        return Segment(name) + ext;
    }

    public static string Segment(string? value)
    {
        var s = value?.Trim();
        if (string.IsNullOrEmpty(s) || s is "." or ".." || s.IndexOfAny(Forbidden) >= 0 || s.Length > 150 ||
            s.Any(char.IsControl) || s.EndsWith('.'))
            throw new UnsafePathException($"'{value}' is not a valid name.");
        return s;
    }

    public async Task SaveBase64Async(string base64, string folder, string fileName, CancellationToken ct = default)
    {
        byte[] bytes;
        try
        {
            bytes = Convert.FromBase64String(StripDataUrl(base64));
        }
        catch (FormatException)
        {
            throw new UnsafePathException("The file data is not valid base64.");
        }
        if (bytes.LongLength > MaxFileBytes) throw new UnsafePathException("The file is too large.");
        RequireContent(fileName, bytes);
        await File.WriteAllBytesAsync(Target(folder, fileName), bytes, ct);
    }

    /// <summary>
    /// Saves an uploaded file. With <paramref name="overwrite"/> false an existing file is never replaced
    /// (<see cref="IOException"/> instead).
    /// </summary>
    public async Task SaveAsync(IFormFile file, string folder, string fileName, CancellationToken ct = default, bool overwrite = true)
    {
        if (file.Length > MaxFileBytes) throw new UnsafePathException("The file is too large.");
        var head = await HeadAsync(file, ct);
        RequireContent(fileName, head);
        await using var stream = new FileStream(Target(folder, fileName), overwrite ? FileMode.Create : FileMode.CreateNew, FileAccess.Write);
        await file.CopyToAsync(stream, ct);
    }

    /// <summary>
    /// The bytes must be what the file name's extension says (the extension often comes from the request, e.g. isPdf):
    /// a JPEG (FF D8 FF) or PNG image for .jpg, .jpeg and .png, a PDF ("%PDF") for .pdf. The old services saved any
    /// bytes. Other extensions (videos) are not checked. A mismatch refuses the request like a bad name.
    /// </summary>
    public static void RequireContent(string fileName, ReadOnlySpan<byte> head)
    {
        var ext = Path.GetExtension(fileName);
        if (ImageExtensions.Contains(ext) && !IsImage(head))
            throw new UnsafePathException($"'{fileName}' is not a JPEG or PNG image.");
        if (string.Equals(ext, ".pdf", StringComparison.OrdinalIgnoreCase) && !IsPdf(head))
            throw new UnsafePathException($"'{fileName}' is not a PDF document.");
    }

    /// <summary>JPEG (FF D8 FF) or PNG signature.</summary>
    public static bool IsImage(ReadOnlySpan<byte> head) =>
        head.StartsWith(JpegSignature) || head.StartsWith(PngSignature);

    public static bool IsPdf(ReadOnlySpan<byte> head) => head.StartsWith(PdfSignature);

    /// <summary>The first bytes of an uploaded file (enough for the signatures above).</summary>
    public static async Task<byte[]> HeadAsync(IFormFile file, CancellationToken ct = default)
    {
        var head = new byte[8];
        await using var s = file.OpenReadStream();
        var read = 0;
        while (read < head.Length)
        {
            var n = await s.ReadAsync(head.AsMemory(read), ct);
            if (n == 0) break;
            read += n;
        }
        return head[..read];
    }

    private static ReadOnlySpan<byte> JpegSignature => [0xFF, 0xD8, 0xFF];
    private static ReadOnlySpan<byte> PngSignature => [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    private static ReadOnlySpan<byte> PdfSignature => "%PDF"u8;

    /// <summary>Path of a file in a folder from <see cref="Folder"/>, checked to stay under the root.</summary>
    public string Target(string folder, string fileName)
    {
        var path = Path.GetFullPath(Path.Combine(folder, Segment(fileName)));
        EnsureUnderRoot(path);
        return path;
    }

    private void EnsureUnderRoot(string path)
    {
        var root = Root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var full = Path.GetFullPath(path);
        if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase) && !string.Equals(full.TrimEnd(Path.DirectorySeparatorChar), Root.TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase))
            throw new UnsafePathException("Path leaves the storage folder.");
    }

    private static string StripDataUrl(string s)
    {
        var comma = s.IndexOf(',');
        return s.StartsWith("data:", StringComparison.OrdinalIgnoreCase) && comma > 0 ? s[(comma + 1)..] : s;
    }
}
