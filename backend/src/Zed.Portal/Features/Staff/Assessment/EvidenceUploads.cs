using System.Globalization;
using System.Text.RegularExpressions;
using Zed.Portal.Features.Msme;

namespace Zed.Portal.Features.Staff.Assessment;

/// <summary>
/// Screenshots a desktop assessor uploads when validating an evidence (ValidateEvidence on the old site,
/// which saved the browser's file name under ~/Uploads/DA/... without any check, and wrote the first
/// file's content under every name). Here: at most <see cref="MaxFiles"/> files of up to
/// <see cref="MaxFileBytes"/> each, PDF/JPEG/PNG only, recognised by their content and not only by the
/// name, stored under a generated name in the legacy folder
/// <c>{StorageRoot}/Uploads/DA/{ZedId}/{Certification}/{Section}.{Requirement}.{Evidence}/</c>.
/// </summary>
public static partial class EvidenceUploads
{
    /// <summary>The old upload control limited files to 2 MB.</summary>
    public const long MaxFileBytes = 2 * 1024 * 1024;
    public const int MaxFiles = 5;
    /// <summary>Request limit of the upload endpoint (files plus form fields).</summary>
    public const long MaxRequestBytes = MaxFiles * MaxFileBytes + 64 * 1024;

    [GeneratedRegex("^[A-Za-z0-9]{1,20}$")]
    private static partial Regex CodePattern();

    /// <summary>Section/requirement/evidence codes become a folder name; they come from the database but are checked anyway.</summary>
    public static bool IsCode(string? value) => value is not null && CodePattern().IsMatch(value);

    public sealed record Checked(IFormFile File, string Extension);

    /// <summary>Checks the files; returns an error message or null.</summary>
    public static async Task<(List<Checked> Files, string? Error)> CheckAsync(IReadOnlyList<IFormFile> files, CancellationToken ct)
    {
        var result = new List<Checked>();
        if (files.Count > MaxFiles) return (result, $"Please upload at most {MaxFiles} files.");
        foreach (var f in files)
        {
            if (f.Length <= 0) return (result, "Please upload valid document (PDF / JPG).");
            if (f.Length > MaxFileBytes) return (result, "File size must be less than 2 MB.");
            var declared = Path.GetExtension(f.FileName ?? "").ToLowerInvariant();
            var header = new byte[8];
            int read;
            await using (var s = f.OpenReadStream())
                read = await s.ReadAtLeastAsync(header, header.Length, throwOnEndOfStream: false, ct);
            var actual = Sniff(header.AsSpan(0, read));
            var ok = actual switch
            {
                ".pdf" => declared == ".pdf",
                ".jpg" => declared is ".jpg" or ".jpeg",
                ".png" => declared == ".png",
                _ => false,
            };
            if (!ok) return (result, "Please upload valid document (PDF / JPG).");
            result.Add(new Checked(f, actual!));
        }
        return (result, null);
    }

    /// <summary>Type of a file from its first bytes.</summary>
    public static string? Sniff(ReadOnlySpan<byte> b)
    {
        if (b.Length >= 5 && b[0] == '%' && b[1] == 'P' && b[2] == 'D' && b[3] == 'F' && b[4] == '-') return ".pdf";
        if (b.Length >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF) return ".jpg";
        if (b.Length >= 8 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47 && b[4] == 0x0D && b[5] == 0x0A && b[6] == 0x1A && b[7] == 0x0A) return ".png";
        return null;
    }

    /// <summary>Saves the files under generated names; returns the names (as stored in ScreenshotPhotos.FileName) and full paths.</summary>
    public static async Task<List<(string FileName, string FullPath)>> SaveAsync(
        string storageRoot, string folder, IReadOnlyList<Checked> files, CancellationToken ct)
    {
        var saved = new List<(string, string)>();
        var stamp = DateTime.Now.ToString("yyyyMMddHHmmssfff", CultureInfo.InvariantCulture);
        try
        {
            for (var i = 0; i < files.Count; i++)
            {
                var name = $"Screenshot_{stamp}_{i + 1}{files[i].Extension}";
                var full = MsmeFilePaths.Resolve(storageRoot, folder + "/" + name)
                    ?? throw new InvalidOperationException("Upload path outside the storage root.");
                Directory.CreateDirectory(Path.GetDirectoryName(full)!);
                await using (var target = new FileStream(full, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                await using (var source = files[i].File.OpenReadStream())
                    await source.CopyToAsync(target, ct);
                saved.Add((name, full));
            }
            return saved;
        }
        catch
        {
            Delete(saved);
            throw;
        }
    }

    public static void Delete(IEnumerable<(string FileName, string FullPath)> saved)
    {
        foreach (var (_, full) in saved)
        {
            try { File.Delete(full); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        }
    }
}
