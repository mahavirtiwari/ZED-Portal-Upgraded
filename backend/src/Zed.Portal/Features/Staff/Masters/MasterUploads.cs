using System.Security.Cryptography;

namespace Zed.Portal.Features.Staff.Masters;

/// <summary>
/// Checks and stores files uploaded by the Admin (guideline documents, home page banner). The legacy
/// uploads trusted the browser: the banner upload accepted any file (saved as .png), the section-image
/// upload took the folder from the request, and the save actions stored whatever path the page posted.
/// Here the type is checked by extension, declared content type and file signature, the size is
/// limited, and the server chooses both the folder and the file name.
/// </summary>
public static class MasterUploads
{
    public sealed record FileType(string Extension, string[] ContentTypes, Func<byte[], bool> Signature);

    private static bool StartsWith(byte[] head, params byte[] magic) => head.Length >= magic.Length && head.AsSpan(0, magic.Length).SequenceEqual(magic);

    private static readonly Func<byte[], bool> Pdf = h => StartsWith(h, (byte)'%', (byte)'P', (byte)'D', (byte)'F', (byte)'-');
    private static readonly Func<byte[], bool> Png = h => StartsWith(h, 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A);
    private static readonly Func<byte[], bool> Jpeg = h => StartsWith(h, 0xFF, 0xD8, 0xFF);
    /// <summary>docx/xlsx/pptx are ZIP packages.</summary>
    private static readonly Func<byte[], bool> Zip = h => StartsWith(h, 0x50, 0x4B, 0x03, 0x04);
    /// <summary>csv/txt: plain text, no NUL bytes in the first block.</summary>
    private static readonly Func<byte[], bool> Text = h => !h.Contains((byte)0);

    private const string OctetStream = "application/octet-stream";

    /// <summary>Guideline document types (the legacy MyDocuments.Upload allow-list).</summary>
    public static readonly FileType[] DocumentTypes =
    [
        new(".pdf", ["application/pdf"], Pdf),
        new(".docx", ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", OctetStream], Zip),
        new(".xlsx", ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", OctetStream], Zip),
        new(".pptx", ["application/vnd.openxmlformats-officedocument.presentationml.presentation", OctetStream], Zip),
        new(".csv", ["text/csv", "application/vnd.ms-excel", "text/plain", OctetStream], Text),
        new(".txt", ["text/plain"], Text),
        new(".jpg", ["image/jpeg"], Jpeg),
        new(".png", ["image/png"], Png),
    ];

    /// <summary>The page told admins "Valid Image Type (.png)" and the server saved every banner as .png.</summary>
    public static readonly FileType[] BannerTypes = [new(".png", ["image/png"], Png)];

    public const long DocumentMaxBytes = 5 * 1024 * 1024;
    public const long BannerMaxBytes = 3 * 1024 * 1024;

    /// <summary>The matching type, or an error message for the user.</summary>
    public static async Task<(FileType? Type, string? Error)> CheckAsync(IFormFile? file, FileType[] allowed, long maxBytes, CancellationToken ct)
    {
        var allowedText = string.Join(", ", allowed.Select(t => t.Extension));
        if (file is null || file.Length == 0) return (null, "Please select a file to upload.");
        if (file.Length > maxBytes) return (null, $"The file is too large. Maximum size is {maxBytes / (1024 * 1024)} MB.");
        var ext = Path.GetExtension(file.FileName ?? "").ToLowerInvariant();
        if (ext == ".jpeg") ext = ".jpg";
        var type = allowed.FirstOrDefault(t => t.Extension == ext);
        if (type is null) return (null, "File type is not allowed. Allowed types: " + allowedText);
        var declared = (file.ContentType ?? "").Split(';')[0].Trim();
        if (!type.ContentTypes.Contains(declared, StringComparer.OrdinalIgnoreCase))
            return (null, "File type is not allowed. Allowed types: " + allowedText);

        var head = new byte[512];
        await using var stream = file.OpenReadStream();
        var read = await stream.ReadAtLeastAsync(head, head.Length, throwOnEndOfStream: false, ct);
        if (!type.Signature(head[..read])) return (null, "The file content does not match its type. Please upload a valid " + ext + " file.");
        return (type, null);
    }

    /// <summary>Server-generated name: a fixed prefix, a timestamp (as the legacy names had) and random characters.</summary>
    public static string NewFileName(string prefix, string extension) =>
        $"{prefix}_{DateTime.Now:yyyyMMddHHmmss}_{Convert.ToHexString(RandomNumberGenerator.GetBytes(4)).ToLowerInvariant()}{extension}";

    /// <summary>Writes the file under {storageRoot}/{folder}; returns the full path.</summary>
    public static async Task<string> SaveAsync(IFormFile file, string storageRoot, string folder, string fileName, CancellationToken ct)
    {
        var dir = Path.Combine(storageRoot, folder.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(dir);
        var full = Path.Combine(dir, fileName);
        await using var output = new FileStream(full, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        await file.CopyToAsync(output, ct);
        return full;
    }
}
