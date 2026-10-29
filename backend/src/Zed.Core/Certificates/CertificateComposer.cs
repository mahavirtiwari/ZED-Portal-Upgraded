using System.Text.Json;
using QRCoder;
using SkiaSharp;

namespace Zed.Core.Certificates;

/// <summary>
/// One field position from the legacy Utils/*Certification.json layout files
/// (pixel coordinates on a 300 dpi template image, font size in points).
/// </summary>
public sealed class CertificateField
{
    public float X { get; set; }
    public float Y { get; set; }
    public float Font { get; set; }
    public string Color { get; set; } = "#000000";
    public float? Width { get; set; }
    public float? Height { get; set; }
    /// <summary>V4, boxed texts: at most this many lines; the font gets smaller (to <see cref="MinFont"/>) until it fits.</summary>
    public int? MaxLines { get; set; }
    /// <summary>V4: the smallest font size (points) <see cref="MaxLines"/> may shrink to.</summary>
    public float? MinFont { get; set; }
    /// <summary>V4, QR fields: pixels per QR module (3 when not given).</summary>
    public float? Module { get; set; }
}

/// <summary>A boxed text as drawn: its lines and the font size used (points).</summary>
public sealed record CertificateTextLayout(IReadOnlyList<string> Lines, float FontPoints);

public enum TextAnchor
{
    /// <summary>X is the horizontal centre, Y the top of the text (GDI+ StringAlignment.Center).</summary>
    TopCenter,
    /// <summary>Text wrapped inside the Width x Height box, centred and bottom aligned.</summary>
    BoxBottomCenter,
    /// <summary>X is the left edge, Y the top of the text (GDI+ DrawString at a point without a StringFormat).</summary>
    TopLeft,
    /// <summary>Text wrapped inside the Width x Height box, centred and top aligned (GDI+ RectangleF with StringAlignment.Center).</summary>
    BoxTopCenter,
}

public sealed record CertificateText(string Field, string? Value, bool Bold = false, TextAnchor Anchor = TextAnchor.TopCenter);

public sealed record CertificateRequest(
    string TemplateImagePath,
    IReadOnlyDictionary<string, CertificateField> Layout,
    IReadOnlyList<CertificateText> Texts,
    string? QrField = null,
    string? QrContent = null,
    // Embed only the glyphs the texts use (Zed.Core.Documents.FontSubsetter): a few KB instead of ~1 MB of Arial.
    bool SubsetFonts = false,
    IReadOnlyList<CertificateImage>? Images = null);

/// <summary>
/// A picture drawn over the template (template pixels): fitted into the square of side <paramref name="Size"/> centred
/// on (<paramref name="CenterX"/>, <paramref name="CenterY"/>), on a white disc of radius <paramref name="ClearRadius"/>
/// when one is given (to cover the badge of the artwork). Used for a level's logo uploaded by the Admin.
/// </summary>
public sealed record CertificateImage(byte[] Data, float CenterX, float CenterY, float Size, float? ClearRadius = null);

/// <summary>
/// Cross-platform replacement for the System.Drawing + iTextSharp certificate code.
/// The template image is embedded unchanged and the text is drawn as vector text on an A4 page,
/// so the PDF is smaller and sharper than the old rasterised version.
/// </summary>
public static class CertificateComposer
{
    private const float TemplateDpi = 300f;
    private const float A4WidthPt = 595f, A4HeightPt = 842f;
    private const string FontFamily = "Arial";

    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    public static IReadOnlyDictionary<string, CertificateField> LoadLayout(string jsonPath) =>
        JsonSerializer.Deserialize<Dictionary<string, CertificateField>>(File.ReadAllText(jsonPath), JsonOptions)
        ?? throw new InvalidDataException($"Certificate layout {jsonPath} is empty.");

    public static byte[] RenderPdf(CertificateRequest request)
    {
        using var template = SKImage.FromEncodedData(request.TemplateImagePath)
            ?? throw new FileNotFoundException("Certificate template not found or unreadable.", request.TemplateImagePath);

        using var output = new MemoryStream();
        using (var doc = SKDocument.CreatePdf(output))
        {
            var canvas = doc.BeginPage(A4WidthPt, A4HeightPt);
            var scale = Math.Min(A4WidthPt / template.Width, A4HeightPt / template.Height);
            canvas.Scale(scale);
            canvas.DrawImage(template, 0, 0, new SKSamplingOptions(SKFilterMode.Linear));
            foreach (var image in request.Images ?? []) DrawImage(canvas, image);

            var characters = request.Texts.SelectMany(t => t.Value ?? "").ToList();
            using var regular = Typeface(bold: false, request.SubsetFonts, characters);
            using var bold = Typeface(bold: true, request.SubsetFonts, characters);
            foreach (var text in request.Texts)
            {
                if (string.IsNullOrEmpty(text.Value) || !request.Layout.TryGetValue(text.Field, out var field)) continue;
                DrawText(canvas, text, field, text.Bold ? bold : regular);
            }

            if (request.QrField is not null && !string.IsNullOrEmpty(request.QrContent) &&
                request.Layout.TryGetValue(request.QrField, out var qr))
                DrawQr(canvas, request.QrContent, qr.X, qr.Y, qr.Module ?? 3);

            doc.EndPage();
            doc.Close();
        }
        return output.ToArray();
    }

    private static void DrawImage(SKCanvas canvas, CertificateImage image)
    {
        using var picture = SKImage.FromEncodedData(image.Data);
        if (picture is null) return;
        if (image.ClearRadius is { } r)
        {
            using var white = new SKPaint { Color = SKColors.White, IsAntialias = true };
            canvas.DrawCircle(image.CenterX, image.CenterY, r, white);
        }
        var scale = image.Size / Math.Max(picture.Width, picture.Height);
        var w = picture.Width * scale;
        var h = picture.Height * scale;
        canvas.DrawImage(picture, SKRect.Create(image.CenterX - w / 2, image.CenterY - h / 2, w, h), new SKSamplingOptions(SKFilterMode.Linear));
    }

    private static SKTypeface Typeface(bool bold, bool subset, IEnumerable<char> characters)
    {
        var typeface = SKTypeface.FromFamilyName(FontFamily, bold ? SKFontStyle.Bold : SKFontStyle.Normal);
        if (!subset) return typeface;
        var small = Documents.FontSubsetter.Subset(typeface, characters);
        if (!ReferenceEquals(small, typeface)) typeface.Dispose();
        return small;
    }

    /// <summary>
    /// The lines of a boxed text and its font size: wrapped to the box width; with <see cref="CertificateField.MaxLines"/>,
    /// the font shrinks by half points (not below <see cref="CertificateField.MinFont"/>) until the text fits in that many
    /// lines. The portal pages use it to break a text where the PDF does.
    /// </summary>
    public static CertificateTextLayout Fit(string value, CertificateField field, bool bold)
    {
        using var typeface = SKTypeface.FromFamilyName(FontFamily, bold ? SKFontStyle.Bold : SKFontStyle.Normal);
        var (lines, points) = Fit(value, field, typeface);
        return new CertificateTextLayout(lines, points);
    }

    private static (List<string> Lines, float Points) Fit(string value, CertificateField field, SKTypeface typeface)
    {
        var points = field.Font;
        if (field.Width is not > 0) return ([value], points);
        while (true)
        {
            using var font = new SKFont(typeface, points * TemplateDpi / 72f);
            var lines = Wrap(value, font, field.Width.Value);
            if (field.MaxLines is not { } max || lines.Count <= max || points - 0.5f < (field.MinFont ?? field.Font)) return (lines, points);
            points -= 0.5f;
        }
    }

    private static void DrawText(SKCanvas canvas, CertificateText text, CertificateField field, SKTypeface typeface)
    {
        var boxed = text.Anchor is TextAnchor.BoxBottomCenter or TextAnchor.BoxTopCenter && field.Width is > 0;
        var (fitted, points) = boxed ? Fit(text.Value!, field, typeface) : ([text.Value!], field.Font);
        using var font = new SKFont(typeface, points * TemplateDpi / 72f);
        using var paint = new SKPaint { Color = SKColor.Parse(field.Color), IsAntialias = true };
        var ascent = -font.Metrics.Ascent;
        var lineHeight = font.Spacing;

        if (boxed)
        {
            var lines = fitted;
            var boxBottom = field.Y + (field.Height ?? lineHeight * lines.Count);
            var top = text.Anchor == TextAnchor.BoxTopCenter ? field.Y : boxBottom - lineHeight * lines.Count;
            var centre = field.X + field.Width!.Value / 2;
            for (var i = 0; i < lines.Count; i++)
                canvas.DrawText(lines[i], centre, top + ascent + i * lineHeight, SKTextAlign.Center, font, paint);
            return;
        }

        canvas.DrawText(text.Value!, field.X, field.Y + ascent,
            text.Anchor == TextAnchor.TopLeft ? SKTextAlign.Left : SKTextAlign.Center, font, paint);
    }

    private static List<string> Wrap(string value, SKFont font, float maxWidth)
    {
        var lines = new List<string>();
        var current = "";
        foreach (var word in value.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            var candidate = current.Length == 0 ? word : current + " " + word;
            if (current.Length > 0 && font.MeasureText(candidate) > maxWidth)
            {
                lines.Add(current);
                current = word;
            }
            else current = candidate;
        }
        if (current.Length > 0) lines.Add(current);
        return lines;
    }

    /// <summary>Version 4, error correction M, <paramref name="moduleSize"/> px per module (3 unless the layout says otherwise).</summary>
    private static void DrawQr(SKCanvas canvas, string content, float x, float y, float moduleSize)
    {
        const int quietZone = 4;
        using var generator = new QRCodeGenerator();
        using var data = generator.CreateQrCode(content, QRCodeGenerator.ECCLevel.M, requestedVersion: 4);
        using var paint = new SKPaint { Color = SKColors.Black, IsAntialias = false };
        var matrix = data.ModuleMatrix;
        for (var row = quietZone; row < matrix.Count - quietZone; row++)
            for (var col = quietZone; col < matrix[row].Length - quietZone; col++)
                if (matrix[row][col])
                    canvas.DrawRect(x + (col - quietZone) * moduleSize, y + (row - quietZone) * moduleSize,
                        moduleSize, moduleSize, paint);
    }
}
