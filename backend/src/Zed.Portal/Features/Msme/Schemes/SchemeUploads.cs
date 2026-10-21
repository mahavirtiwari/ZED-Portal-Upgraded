using System.Globalization;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Net.Http.Headers;
using Zed.Portal.Features.Staff.Schemes;

namespace Zed.Portal.Features.Msme.Schemes;

/// <summary>
/// Documents an MSME attaches to a financial assistance (FA) or technology upgradation (TU) application.
/// The legacy UploadDocs actions saved the file under <c>PhotosPath/{ZedId}/{Scheme}/{yyyyMMddHHmmss}{client extension}</c>
/// (the mobile services' public <c>mobileapi/Photos</c> folder), accepted any file type and size, wrote the
/// first file's content under every name, and SubmitFinancialData then stored whatever names the browser sent.
/// Here: PDF/JPEG/PNG only, judged from the content, up to 5 MB, a server-generated name, and on submission
/// only names of files that exist in the signed-in MSME's own folder are accepted.
/// </summary>
public static partial class SchemeUploads
{
    public const long MaxBytes = 5 * 1024 * 1024;
    public const int MaxFilesPerFolder = 300;
    public const string FaFolder = "FinancialAssistance";
    public const string TuFolder = "TechnologyUpgradation";

    private static readonly FileExtensionContentTypeProvider ContentTypes = new();

    /// <summary>The extension to save an upload with, judged from its content (PDF, JPEG or PNG), or null.</summary>
    public static async Task<string?> KindAsync(IFormFile file, CancellationToken ct)
    {
        if (file.Length is <= 0 or > MaxBytes) return null;
        var head = new byte[8];
        await using var s = file.OpenReadStream();
        var read = await s.ReadAtLeastAsync(head, head.Length, throwOnEndOfStream: false, ct);
        if (read >= 5 && head.AsSpan(0, 5).SequenceEqual("%PDF-"u8)) return ".pdf";
        if (read >= 3 && head[0] == 0xFF && head[1] == 0xD8 && head[2] == 0xFF) return ".jpg";
        if (read >= 8 && head.AsSpan(0, 8).SequenceEqual(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A })) return ".png";
        return null;
    }

    /// <summary>A new file name: time stamp (as the legacy names) plus random hex, so names cannot be guessed or collide.</summary>
    public static string NewName(string extension) =>
        DateTime.Now.ToString("yyyyMMddHHmmssfff", CultureInfo.InvariantCulture) + Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(4)) + extension;

    /// <summary>True for a name this class generated (what a web submission may refer to).</summary>
    public static bool IsGenerated(string? name) => name is not null && GeneratedName().IsMatch(name);

    /// <summary><c>mobileapi/Photos/{ZedId}/{folder}</c>, relative to Portal:StorageRoot (where the staff review reads them).</summary>
    public static string Folder(string zedId, string folder) => $"mobileapi/Photos/{zedId}/{folder}";

    /// <summary>The MSME's own copies of a document: the upload folder, then the folder the old server moved certified files to.</summary>
    public static IEnumerable<string> Candidates(string zedId, string folder, string fileName)
    {
        yield return $"mobileapi/Photos/{zedId}/{folder}/{fileName}";
        yield return $"mobileapi/CertifiedPhotos/{zedId}/{folder}/{fileName}";
    }

    public static string StorageRoot(IWebHostEnvironment env, Zed.Core.Http.PortalOptions portal) =>
        Path.GetFullPath(Path.Combine(env.ContentRootPath, portal.StorageRoot));

    /// <summary>Saves the upload in the MSME's folder and returns the generated name, or null when the path is refused.</summary>
    public static async Task<string?> SaveAsync(string storageRoot, string zedId, string folder, IFormFile file, string extension, CancellationToken ct)
    {
        var name = NewName(extension);
        var full = MsmeFilePaths.Resolve(storageRoot, $"{Folder(zedId, folder)}/{name}");
        if (full is null) return null;
        var dir = Path.GetDirectoryName(full)!;
        // Uploads that are never submitted stay in the folder; cap them so one account cannot fill the disk.
        if (Directory.Exists(dir) && Directory.EnumerateFiles(dir).Take(MaxFilesPerFolder + 1).Count() > MaxFilesPerFolder) return null;
        Directory.CreateDirectory(dir);
        var temp = full + "." + Guid.NewGuid().ToString("N") + ".tmp";
        await using (var fs = File.Create(temp))
            await file.CopyToAsync(fs, ct);
        File.Move(temp, full);
        return name;
    }

    /// <summary>Full path of one of the MSME's own documents (a single safe name of an allowed type), or null.</summary>
    public static string? Find(string storageRoot, string zedId, string folder, string? fileName)
    {
        if (FaFilePaths.FileName(fileName) is not { } name) return null;
        return Candidates(zedId, folder, name)
            .Select(c => MsmeFilePaths.Resolve(storageRoot, c))
            .FirstOrDefault(p => p is not null && File.Exists(p));
    }

    /// <summary>Upload time of a saved document in the format the legacy page stored (JavaScript Date JSON).</summary>
    public static string TimeStamp(string fullPath) =>
        File.GetLastWriteTimeUtc(fullPath).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    public static bool IsPdf(string? name) => name?.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase) == true;

    public static IActionResult Serve(ControllerBase c, string fullPath)
    {
        var name = Path.GetFileName(fullPath);
        var contentType = ContentTypes.TryGetContentType(name, out var t) ? t : "application/octet-stream";
        c.Response.Headers.XContentTypeOptions = "nosniff";
        c.Response.Headers.CacheControl = "private, no-store";
        c.Response.Headers.ContentDisposition = new ContentDispositionHeaderValue("inline") { FileNameStar = name }.ToString();
        return c.PhysicalFile(fullPath, contentType, enableRangeProcessing: true);
    }

    [GeneratedRegex(@"^\d{17}[0-9a-f]{8}\.(pdf|jpg|png)$")]
    private static partial Regex GeneratedName();
}

/// <summary>Input checks shared by the FA and TU application forms (same fields and rules as the legacy pages).</summary>
public static partial class SchemeInput
{
    /// <summary>Trimmed text of at most <paramref name="max"/> characters without control characters, or null when empty/invalid.</summary>
    public static string? Text(string? value, int max) => SchemeRows.CleanText(value, max) is { } s && !s.Contains('\n') && !s.Contains('\r') ? s : null;

    /// <summary>A date picked on the page (yyyy-MM-dd) within [min, today], stored as the legacy date picker wrote it (MM/dd/yyyy).</summary>
    public static string? Date(string? value, DateOnly? min = null)
    {
        if (!DateOnly.TryParseExact(value?.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)) return null;
        var today = DateOnly.FromDateTime(DateTime.Today);
        if (d > today || d.Year < 1990 || (min is { } m && d < m)) return null;
        return d.ToString("MM/dd/yyyy", CultureInfo.InvariantCulture);
    }

    /// <summary>Amount in rupees: positive, at most 10 crore, at most two decimals.</summary>
    public static decimal? Amount(decimal? value) =>
        value is > 0 and <= 100_000_000 && decimal.Round(value.Value, 2) == value.Value ? value : null;

    public static string Money(decimal value) => value.ToString("0.##", CultureInfo.InvariantCulture);

    public static bool AccountNo(string? value) => value is not null && AccountPattern().IsMatch(value);

    public static bool Ifsc(string? value) => value is not null && IfscPattern().IsMatch(value);

    [GeneratedRegex(@"^[0-9]{9,18}$")]
    private static partial Regex AccountPattern();

    [GeneratedRegex(@"^[A-Z]{4}0[A-Z0-9]{6}$")]
    private static partial Regex IfscPattern();
}

/// <summary>A document attached to the form: the name returned by the upload and its document type.</summary>
public sealed record SchemeDocumentRef(string? FileName, string? Type);

/// <summary>A document as shown on the page.</summary>
public sealed record SchemeDocumentDto(string FileName, string? Type, string? TimeStamp, bool IsPdf, string Url);

/// <summary>Bank account of the reimbursement (FA and TU).</summary>
public sealed record SchemeAccount(string? AccountNo, string? ConfirmAccountNo, string? IfscCode, string? BranchAddress, string? BankName);
