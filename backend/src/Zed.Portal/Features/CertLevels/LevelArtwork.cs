using Zed.Core.Data;

namespace Zed.Portal.Features.CertLevels;

/// <summary>
/// The artwork of a level's documents (2026-11-08, generic levels): the certificate background (the built-in levels'
/// Assets/Documents/{Da|Sa}{Level}.jpg) and the report's level picture (Assets/Documents/Level{Level}.png). The Admin
/// uploads them for a V4 level on Administration → Certification Levels; they are kept as
/// Uploads/Levels/Artwork/{Code}_certificate.{jpg|png} and {Code}_report.{jpg|png} under Portal:StorageRoot (shared by the
/// hosts) and read before the bundled files. Bronze, Silver and Gold always use their bundled artwork.
/// </summary>
public static class LevelArtwork
{
    public const string Certificate = "certificate";
    public const string Report = "report";
    public static readonly string[] Kinds = [Certificate, Report];
    private static readonly string[] Extensions = [".jpg", ".png"];

    public static string? Kind(string? kind) => Kinds.FirstOrDefault(k => string.Equals(k, kind?.Trim(), StringComparison.OrdinalIgnoreCase));

    public static string Relative(string code, string kind, string extension) => $"Uploads/Levels/Artwork/{code}_{kind}{extension}";

    /// <summary>The uploaded file of a V4 level (null for Bronze / Silver / Gold, or when none was uploaded).</summary>
    public static string? Uploaded(string storageRoot, string code, string kind)
    {
        if (LevelRegistry.IsLegacy(code) || !LevelRegistry.CodePattern().IsMatch(code)) return null;
        return Extensions.Select(e => Msme.MsmeFilePaths.Resolve(storageRoot, Relative(code, kind, e)))
            .FirstOrDefault(p => p is not null && File.Exists(p));
    }

    /// <summary>The bundled certificate background of the level for an assessment mode (null when there is none).</summary>
    public static string? BundledCertificate(string assetsFolder, string code, bool desktop) =>
        Path.Combine(assetsFolder, (desktop ? "Da" : "Sa") + code + ".jpg") is var p && File.Exists(p) ? p : null;

    /// <summary>The bundled report picture of the level (null when there is none).</summary>
    public static string? BundledReport(string assetsFolder, string code) =>
        Path.Combine(assetsFolder, $"Level{code}.png") is var p && File.Exists(p) ? p : null;

    /// <summary>The certificate background in force: the uploaded one, else the bundled one.</summary>
    public static string? CertificateTemplate(string storageRoot, string assetsFolder, string code, bool desktop) =>
        Uploaded(storageRoot, code, Certificate) ?? BundledCertificate(assetsFolder, code, desktop);

    /// <summary>The built-in background whose size (and layout) an uploaded certificate background must have.</summary>
    public static string SizeReference(string assetsFolder, bool desktop) => Path.Combine(assetsFolder, desktop ? "DaBronze.jpg" : "SaGold.jpg");

    /// <summary>Both pictures are there: the certificate background, and the report's picture (uploaded, bundled, or the level's logo).</summary>
    public static bool Ready(string storageRoot, string assetsFolder, CertificationLevel level)
    {
        var desktop = level.AssessmentMode == CertificationLevels.Desktop;
        var certificate = CertificateTemplate(storageRoot, assetsFolder, level.Code, desktop) is not null;
        var report = Uploaded(storageRoot, level.Code, Report) is not null || BundledReport(assetsFolder, level.Code) is not null
            || (level.LogoPath is { Length: > 0 } logo && Msme.MsmeFilePaths.Resolve(storageRoot, logo) is { } l && File.Exists(l));
        return certificate && report;
    }
}
