using SkiaSharp;

namespace Zed.Core.Documents;

public sealed record SummaryLine(string Label, string Value, string? Note = null, bool Bold = false);

/// <summary>
/// One-page A4 PDF with a title and label/value lines separated by rules, drawn as vector text.
/// Used for payment receipts (the MVC site rendered an HTML page through SelectPdf for this).
/// </summary>
public static class SummaryPdf
{
    private const float PageW = 595f, PageH = 842f, Margin = 72f;

    public static byte[] Render(string title, IReadOnlyList<string> headerLines, IReadOnlyList<SummaryLine> lines, string? logoPath = null)
    {
        using var output = new MemoryStream();
        using (var doc = SKDocument.CreatePdf(output))
        {
            var canvas = doc.BeginPage(PageW, PageH);
            using var regular = SKTypeface.FromFamilyName("Arial");
            using var bold = SKTypeface.FromFamilyName("Arial", SKFontStyle.Bold);
            using var textFont = new SKFont(regular, 11);
            using var noteFont = new SKFont(regular, 9);
            using var boldFont = new SKFont(bold, 11);
            using var titleFont = new SKFont(bold, 18);
            using var ink = new SKPaint { Color = new SKColor(0x23, 0x25, 0x27), IsAntialias = true };
            using var grey = new SKPaint { Color = new SKColor(0x70, 0x70, 0x70), IsAntialias = true };
            using var rule = new SKPaint { Color = new SKColor(0xDD, 0xDD, 0xDD), StrokeWidth = 0.8f, IsAntialias = true };

            var y = Margin;
            if (logoPath is not null && File.Exists(logoPath) && SKImage.FromEncodedData(logoPath) is { } logo)
            {
                using (logo)
                {
                    const float h = 60;
                    var w = h * logo.Width / logo.Height;
                    canvas.DrawImage(logo, SKRect.Create((PageW - w) / 2, y, w, h), new SKSamplingOptions(SKFilterMode.Linear));
                    y += h + 20;
                }
            }

            canvas.DrawText(title, PageW / 2, y + 18, SKTextAlign.Center, titleFont, ink);
            y += 40;
            foreach (var h in headerLines)
            {
                canvas.DrawText(h, Margin, y, SKTextAlign.Left, textFont, ink);
                y += 16;
            }
            y += 10;

            foreach (var line in lines)
            {
                canvas.DrawLine(Margin, y, PageW - Margin, y, rule);
                y += 18;
                var font = line.Bold ? boldFont : textFont;
                canvas.DrawText(line.Label, Margin, y, SKTextAlign.Left, font, ink);
                canvas.DrawText(line.Value, PageW - Margin, y, SKTextAlign.Right, font, ink);
                if (!string.IsNullOrEmpty(line.Note))
                {
                    y += 13;
                    canvas.DrawText(line.Note, Margin, y, SKTextAlign.Left, noteFont, grey);
                }
                y += 10;
            }
            canvas.DrawLine(Margin, y, PageW - Margin, y, rule);

            doc.EndPage();
            doc.Close();
        }
        return output.ToArray();
    }
}
