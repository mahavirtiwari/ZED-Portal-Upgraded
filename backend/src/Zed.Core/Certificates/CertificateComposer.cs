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
}

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
    bool SubsetFonts = false);

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
                DrawQr(canvas, request.QrContent, qr.X, qr.Y);

            doc.EndPage();
            doc.Close();
        }
        return output.ToArray();
    }

    private static SKTypeface Typeface(bool bold, bool subset, IEnumerable<char> characters)
    {
        var typeface = SKTypeface.FromFamilyName(FontFamily, bold ? SKFontStyle.Bold : SKFontStyle.Normal);
        if (!subset) return typeface;
        var small = Documents.FontSubsetter.Subset(typeface, characters);
        if (!ReferenceEquals(small, typeface)) typeface.Dispose();
        return small;
    }

    private static void DrawText(SKCanvas canvas, CertificateText text, CertificateField field, SKTypeface typeface)
    {
        using var font = new SKFont(typeface, field.Font * TemplateDpi / 72f);
        using var paint = new SKPaint { Color = SKColor.Parse(field.Color), IsAntialias = true };
        var ascent = -font.Metrics.Ascent;
        var lineHeight = font.Spacing;

        if (text.Anchor is TextAnchor.BoxBottomCenter or TextAnchor.BoxTopCenter && field.Width is > 0)
        {
            var lines = Wrap(text.Value!, font, field.Width.Value);
            var boxBottom = field.Y + (field.Height ?? lineHeight * lines.Count);
            var top = text.Anchor == TextAnchor.BoxTopCenter ? field.Y : boxBottom - lineHeight * lines.Count;
            var centre = field.X + field.Width.Value / 2;
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

    /// <summary>Version 4, error correction M, 3 px per module: the same settings as the legacy encoder.</summary>
    private static void DrawQr(SKCanvas canvas, string content, float x, float y)
    {
        const int moduleSize = 3, quietZone = 4;
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
