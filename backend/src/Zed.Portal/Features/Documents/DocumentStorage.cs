using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;
using Zed.Core.Http;
using Zed.Portal.Features.Msme;
using Zed.Portal.Features.Staff.Assessment;

namespace Zed.Portal.Features.Documents;

/// <summary>The document (certificate or report) cannot be produced: no such record, or it is not certified.</summary>
public sealed class DocumentNotAvailableException(string message) : Exception(message);

/// <summary>Certification levels, statuses and legacy file locations of the generated documents.</summary>
public static class DocumentLevels
{
    /// <summary>MsmeCertifications.CertificationStatus once SP_MONITORING_DA_FINAL_SUBMIT certified a Bronze record.</summary>
    public const int BronzeCertified = 6;

    /// <summary>MsmeCertifications.CertificationStatus once SP_MONITORING_RA_FINAL_SUBMIT certified a Silver/Gold record.</summary>
    public const int SiteCertified = 16;

    /// <summary>MsmeCertifications.CertificationStatus of a rejected record (SP_MONITORING_REJECT_CERTIFICATION).</summary>
    public const int Rejected = 99;

    /// <summary>"bronze" → "Bronze"; null for anything else (surveillance and milestones are other systems).</summary>
    public static string? Level(string? certification) => AssessmentInput.Level(certification);

    public static bool IsDesktop(string level) => level == "Bronze";

    public static bool IsCertified(string level, int? status) =>
        status == (IsDesktop(level) ? BronzeCertified : SiteCertified);

    /// <summary>Certificates/DA/{ZedId}/Bronze.pdf, Certificates/SA/{ZedId}/Silver.pdf (MonitoringController.GenerateCertificate).</summary>
    public static string CertificatePath(string zedId, string level) =>
        $"Certificates/{(IsDesktop(level) ? "DA" : "SA")}/{zedId}/{level}.pdf";

    /// <summary>Surveillance certificates, written by the ZEDCS_SURVEILLANCE application (served only, never generated here).</summary>
    public static string SurveillanceCertificatePath(string zedId, string level) =>
        $"Surveillance/{CertificatePath(zedId, level)}";

    /// <summary>PDFs/SA/{ZedId}/{Level}_Report.pdf (MonitoringController.GenerateSaRepory).</summary>
    public static string ReportPath(string zedId, string level) => $"PDFs/SA/{zedId}/{level}_Report.pdf";

    /// <summary>Certificates/{ZedId}/Pledge.pdf (MsmeController.GenerateCertificate).</summary>
    public static string PledgePath(string zedId) => $"Certificates/{zedId}/Pledge.pdf";
}

/// <summary>Reads and writes generated documents under Portal:StorageRoot, in the legacy layout.</summary>
public sealed class DocumentStorage(IWebHostEnvironment env, IOptions<PortalOptions> portal)
{
    public string Root { get; } = Path.GetFullPath(Path.Combine(env.ContentRootPath, portal.Value.StorageRoot));

    /// <summary>Folder of the bundled templates (certificate backgrounds, report images).</summary>
    public string AssetsFolder { get; } = Path.Combine(AppContext.BaseDirectory, "Assets", "Documents");

    /// <summary>
    /// Full path of an existing file: the path itself, then the same path with Certificates ⇄ Certifications
    /// swapped (the old server moved older certificates to Certifications).
    /// </summary>
    public string? Find(string relative) =>
        MsmeFilePaths.Normalise(relative) is not { } normalised ? null
        : MsmeFilePaths.StorageCandidates(normalised)
            .Select(c => MsmeFilePaths.Resolve(Root, c))
            .FirstOrDefault(p => p is not null && File.Exists(p));

    /// <summary>Full path of a relative path inside the storage root (null when the path is not acceptable).</summary>
    public string? Resolve(string relative) =>
        MsmeFilePaths.Normalise(relative) is { } normalised ? MsmeFilePaths.Resolve(Root, normalised) : null;

    /// <summary>Writes the file through a temporary file, so a half-written PDF is never served.</summary>
    public async Task WriteAsync(string relative, byte[] content, CancellationToken ct)
    {
        var full = Resolve(relative) ?? throw new ArgumentException("Invalid document path.", nameof(relative));
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        var temp = full + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            await File.WriteAllBytesAsync(temp, content, ct);
            File.Move(temp, full, overwrite: true);
        }
        finally
        {
            if (File.Exists(temp)) File.Delete(temp);
        }
    }
}

/// <summary>Sends a PDF the way the old static files opened: inline in a new tab, with its file name for saving.</summary>
public static class DocumentResults
{
    private static readonly FileExtensionContentTypeProvider ContentTypes = new();

    public static IActionResult Pdf(ControllerBase c, byte[] content, string fileName)
    {
        SetHeaders(c, fileName);
        return c.File(content, "application/pdf");
    }

    public static IActionResult PhysicalFile(ControllerBase c, string fullPath)
    {
        var fileName = Path.GetFileName(fullPath);
        SetHeaders(c, fileName);
        var type = ContentTypes.TryGetContentType(fileName, out var t) ? t : "application/octet-stream";
        return c.PhysicalFile(fullPath, type, enableRangeProcessing: true);
    }

    private static void SetHeaders(ControllerBase c, string fileName)
    {
        c.Response.Headers.XContentTypeOptions = "nosniff";
        c.Response.Headers.CacheControl = "private, no-store";
        c.Response.Headers.ContentDisposition = new ContentDispositionHeaderValue("inline") { FileNameStar = fileName }.ToString();
    }
}
