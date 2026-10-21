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
        await File.WriteAllBytesAsync(Target(folder, fileName), bytes, ct);
    }

    public async Task SaveAsync(IFormFile file, string folder, string fileName, CancellationToken ct = default)
    {
        if (file.Length > MaxFileBytes) throw new UnsafePathException("The file is too large.");
        await using var stream = File.Create(Target(folder, fileName));
        await file.CopyToAsync(stream, ct);
    }

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
