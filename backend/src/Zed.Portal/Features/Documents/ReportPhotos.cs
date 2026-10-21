using System.Text.RegularExpressions;
using SkiaSharp;
using Zed.Portal.Features.Msme;
using Zed.Portal.Features.Staff.Assessment;

namespace Zed.Portal.Features.Documents;

/// <summary>
/// Loads the assessment photos the old report page showed from the mobile-app photo stores under
/// Portal:StorageRoot (see <see cref="SitePhotoPaths"/>), downscaled so the PDF stays small.
/// Only files in the record's own folder (its ZED ID, or the MSME's ZED ID for a rejected copy) are read.
/// Besides the stores of <see cref="SitePhotoPaths"/>, the surveillance app's desktop stores
/// (<c>surveillancemobileapi/Photos</c> and <c>/CertifiedPhotos</c>, used by the surveillance report) are known here.
/// </summary>
public sealed partial class ReportPhotos(string storageRoot, string recordZedId) : IDisposable
{
    private const int MaxPixels = 900;
    private readonly Dictionary<string, SKImage?> _cache = new(StringComparer.OrdinalIgnoreCase);
    private readonly string _baseZedId = AssessmentInput.BaseZedId(recordZedId);

    [GeneratedRegex("""(https?://[^"']+)""")]
    private static partial Regex UrlInScript();

    /// <summary>Application folders of the photo stores (relative to the storage root).</summary>
    private static readonly string[] Apps = ["mobileapi", "surveillancemobileapi", "consultancymobileapi"];

    /// <summary>Stores only the reports read: (application, store, moved store).</summary>
    private static readonly (string App, string Store, string Moved)[] ExtraStores =
    [
        ("surveillancemobileapi", "Photos", "CertifiedPhotos"),
        ("surveillancemobileapi", "CertifiedPhotos", "Photos"),
    ];

    /// <summary>The first candidate (legacy URL, relative path, or the old page's <c>this.src="..."</c> fallback) that exists.</summary>
    public SKImage? Load(params string?[] candidates)
    {
        foreach (var candidate in candidates)
        {
            if (string.IsNullOrWhiteSpace(candidate)) continue;
            var value = candidate.Contains("this.src", StringComparison.Ordinal) && UrlInScript().Match(candidate) is { Success: true } m
                ? m.Groups[1].Value
                : candidate;
            if (Relative(value) is not { } relative) continue;
            if (!_cache.TryGetValue(relative, out var image))
                _cache[relative] = image = Read(relative);
            if (image is not null) return image;
        }
        return null;
    }

    private string? Relative(string value)
    {
        var path = MsmeFilePaths.FromLegacy(value);
        if (path is null || SitePhotoPaths.Normalise(WithoutSitePrefix(path)) is not { } normalised) return null;
        if (Path.GetExtension(normalised).Equals(".pdf", StringComparison.OrdinalIgnoreCase)) return null;
        var ownFolder = BelongsTo(normalised, recordZedId) || BelongsTo(normalised, _baseZedId);
        return ownFolder ? normalised : null;
    }

    /// <summary>
    /// "surveillance/mobileapi/SaPhotos/..." → "mobileapi/SaPhotos/...": procedures build some URLs from
    /// UrlsMasterData.UrlName, which may carry the application's virtual directory.
    /// </summary>
    private static string WithoutSitePrefix(string path)
    {
        var segments = path.Split('/');
        if (segments.Length > 1 && Apps.Contains(segments[0], StringComparer.OrdinalIgnoreCase)) return path;
        var index = Array.FindIndex(segments, 1, s => Apps.Contains(s, StringComparer.OrdinalIgnoreCase));
        return index is > 0 and <= 2 ? string.Join('/', segments[index..]) : path;
    }

    private static bool BelongsTo(string relative, string zedId)
    {
        if (SitePhotoPaths.BelongsTo(relative, zedId)) return true;
        var s = relative.Split('/');
        return s.Length >= 4 && ExtraStore(s) is not null && string.Equals(s[2], zedId, StringComparison.OrdinalIgnoreCase);
    }

    private static (string App, string Store, string Moved)? ExtraStore(string[] s) =>
        s.Length < 2 ? null : ExtraStores.Cast<(string App, string Store, string Moved)?>().FirstOrDefault(st =>
            string.Equals(st!.Value.App, s[0], StringComparison.OrdinalIgnoreCase) &&
            string.Equals(st.Value.Store, s[1], StringComparison.OrdinalIgnoreCase));

    private static IEnumerable<string> StorageCandidates(string relative)
    {
        var s = relative.Split('/');
        if (ExtraStore(s) is not { } store) return SitePhotoPaths.StorageCandidates(relative);
        var moved = (string[])s.Clone();
        moved[1] = store.Moved;
        return [relative, string.Join('/', moved)];
    }

    private SKImage? Read(string relative)
    {
        var full = StorageCandidates(relative)
            .Select(c => MsmeFilePaths.Resolve(storageRoot, c))
            .FirstOrDefault(p => p is not null && File.Exists(p));
        return full is null ? null : Downscale(full);
    }

    /// <summary>Decodes (at a reduced size where the codec allows), applies the EXIF orientation and re-encodes as JPEG.</summary>
    public static SKImage? Downscale(string path, int maxPixels = MaxPixels)
    {
        try
        {
            using var codec = SKCodec.Create(path);
            if (codec is null) return null;
            var info = codec.Info;
            var scale = Math.Min(1f, (float)maxPixels / Math.Max(info.Width, info.Height));
            var size = codec.GetScaledDimensions(Math.Max(scale, 0.125f));
            using var decoded = new SKBitmap(new SKImageInfo(size.Width, size.Height, SKColorType.Rgba8888, SKAlphaType.Premul));
            var result = codec.GetPixels(decoded.Info, decoded.GetPixels());
            if (result is not (SKCodecResult.Success or SKCodecResult.IncompleteInput)) return null;

            var w = Math.Max(1, (int)(info.Width * scale));
            var h = Math.Max(1, (int)(info.Height * scale));
            using var resized = decoded.Width == w && decoded.Height == h ? decoded.Copy() : decoded.Resize(new SKImageInfo(w, h), new SKSamplingOptions(SKFilterMode.Linear, SKMipmapMode.Linear));
            using var oriented = Orient(resized, codec.EncodedOrigin);
            using var image = SKImage.FromBitmap(oriented);
            using var jpeg = image.Encode(SKEncodedImageFormat.Jpeg, 72);
            return SKImage.FromEncodedData(jpeg);
        }
        catch (Exception)
        {
            return null;
        }
    }

    private static SKBitmap Orient(SKBitmap source, SKEncodedOrigin origin)
    {
        var (degrees, swap) = origin switch
        {
            SKEncodedOrigin.BottomRight => (180, false),
            SKEncodedOrigin.RightTop => (90, true),
            SKEncodedOrigin.LeftBottom => (270, true),
            _ => (0, false),
        };
        if (degrees == 0) return source.Copy();
        var result = new SKBitmap(swap ? source.Height : source.Width, swap ? source.Width : source.Height);
        using var canvas = new SKCanvas(result);
        canvas.Translate(result.Width / 2f, result.Height / 2f);
        canvas.RotateDegrees(degrees);
        canvas.Translate(-source.Width / 2f, -source.Height / 2f);
        using var image = SKImage.FromBitmap(source);
        canvas.DrawImage(image, 0, 0, new SKSamplingOptions(SKFilterMode.Linear));
        return result;
    }

    public void Dispose()
    {
        foreach (var image in _cache.Values) image?.Dispose();
        _cache.Clear();
    }
}
