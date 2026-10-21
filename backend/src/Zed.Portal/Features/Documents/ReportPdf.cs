using SkiaSharp;

namespace Zed.Portal.Features.Documents;

/// <summary>One piece of a table cell: a line of text or an image.</summary>
public abstract record CellItem;

public sealed record CellText(string Text, bool Bold = false, bool Italic = false, string? Bullet = null) : CellItem;

public sealed record CellImage(SKImage Image, float MaxHeight, string? Caption = null) : CellItem;

public sealed record Cell(IReadOnlyList<CellItem> Items, int ColSpan = 1, bool Bold = false, bool Center = false, SKColor? Fill = null)
{
    public static Cell Of(string? text, bool bold = false, bool center = false, int colSpan = 1, SKColor? fill = null) =>
        new([new CellText(text ?? "", bold)], colSpan, bold, center, fill);
}

public sealed class TableSpec(params float[] widths)
{
    /// <summary>Relative column widths.</summary>
    public float[] Widths { get; } = widths;
    public Cell[]? Header { get; init; }
    public List<Cell[]> Rows { get; } = [];
    /// <summary>The first column is a label column (teal, white text), like the old ".v-table td:first-child".</summary>
    public bool LabelColumn { get; init; }
    public float FontSize { get; init; } = 8.5f;

    public TableSpec Row(params Cell[] cells) { Rows.Add(cells); return this; }
}

/// <summary>
/// Minimal flowing-layout PDF writer for the assessment report (A4 portrait, SkiaSharp). Pages after the
/// first carry the old SelectPdf header (PdfHeader.jpg) and footer ("{ZedId}/ASSESSMENT REPORT", page number).
/// Text is vector text; Skia embeds only the glyphs used.
/// </summary>
public sealed class ReportPdf : IDisposable
{
    public const float PageWidth = 595f, PageHeight = 842f;
    public const float Margin = 40f;
    private const float FooterTop = PageHeight - 46f;
    private const float BodyBottom = FooterTop - 8f;
    private const float CellPad = 4f;

    public static readonly SKColor Ink = new(0x23, 0x25, 0x27);
    public static readonly SKColor Teal = new(0x45, 0xA5, 0xAD);
    private static readonly SKColor Grid = new(0xCC, 0xCC, 0xCC);
    private static readonly SKColor FooterRule = new(0x55, 0x55, 0x55);

    private readonly MemoryStream _output = new();
    private readonly SKDocument _doc;
    private readonly SKImage? _header;
    private readonly string _footer;
    private readonly SKTypeface _regular, _bold, _italic;
    private SKCanvas? _canvas;
    private int _page;
    private float _bodyTop;

    public float Y { get; private set; }
    public float ContentWidth => PageWidth - 2 * Margin;

    /// <param name="characters">Every character the document may draw besides printable ASCII; the fonts are subset to them.</param>
    public ReportPdf(string footerText, SKImage? header, IEnumerable<char> characters)
    {
        _doc = SKDocument.CreatePdf(_output, new SKDocumentPdfMetadata
        {
            Title = footerText, Creator = "ZED portal", RasterDpi = 150, EncodingQuality = 80,
        });
        _header = header;
        _footer = footerText;
        var chars = characters.Concat(footerText).ToHashSet();
        _regular = Subset(SKFontStyle.Normal, chars);
        _bold = Subset(SKFontStyle.Bold, chars);
        _italic = Subset(SKFontStyle.Italic, chars);
    }

    private static SKTypeface Subset(SKFontStyle style, IEnumerable<char> chars)
    {
        var full = SKTypeface.FromFamilyName("Arial", style) ?? SKTypeface.Default;
        var small = Zed.Core.Documents.FontSubsetter.Subset(full, chars);
        if (!ReferenceEquals(small, full)) full.Dispose();
        return small;
    }

    public SKCanvas Canvas => _canvas ?? throw new InvalidOperationException("No page started.");

    public SKFont Font(float size, bool bold = false, bool italic = false) =>
        new(bold ? _bold : italic ? _italic : _regular, size) { Subpixel = true };

    // ------------------------------------------------------------------ pages

    /// <summary>A page without header and footer (cover, closing page); the caller draws on <see cref="Canvas"/>.</summary>
    public SKCanvas BarePage()
    {
        EndPage();
        _canvas = _doc.BeginPage(PageWidth, PageHeight);
        _page++;
        Y = Margin;
        return _canvas;
    }

    /// <summary>A page with header and footer; text continues below the header.</summary>
    public void NewPage()
    {
        EndPage();
        _canvas = _doc.BeginPage(PageWidth, PageHeight);
        _page++;
        var y = 20f;
        if (_header is not null)
        {
            var h = ContentWidth * _header.Height / _header.Width;
            _canvas.DrawImage(_header, SKRect.Create(Margin, y, ContentWidth, h), Sampling);
            y += h;
        }
        _bodyTop = y + 14;
        Y = _bodyTop;

        using var rule = new SKPaint { Color = FooterRule, IsAntialias = true };
        _canvas.DrawRect(SKRect.Create(Margin, FooterTop, ContentWidth, 3), rule);
        using var font = Font(8);
        using var ink = Paint(Ink);
        _canvas.DrawText(_footer, Margin, FooterTop + 16, SKTextAlign.Left, font, ink);
        _canvas.DrawText($"Page {_page}", PageWidth - Margin, FooterTop + 16, SKTextAlign.Right, font, ink);
    }

    /// <summary>A page filled with one image (kept in proportion, centred).</summary>
    public void ImagePage(SKImage image)
    {
        var canvas = BarePage();
        var scale = Math.Min(PageWidth / image.Width, PageHeight / image.Height);
        var w = image.Width * scale;
        var h = image.Height * scale;
        canvas.DrawImage(image, SKRect.Create((PageWidth - w) / 2, (PageHeight - h) / 2, w, h), Sampling);
    }

    private void EndPage()
    {
        if (_canvas is null) return;
        _doc.EndPage();
        _canvas = null;
    }

    /// <summary>Starts a new page when less than <paramref name="height"/> is left.</summary>
    public void Ensure(float height)
    {
        if (_canvas is null || Y + height > BodyBottom) NewPage();
    }

    public void Space(float height) => Y += height;

    // ------------------------------------------------------------------ blocks

    /// <summary>Black bar with a white title (".panel-black").</summary>
    public void Panel(string title)
    {
        Ensure(60);
        using var font = Font(10, bold: true);
        using var bg = Paint(Ink);
        using var white = Paint(SKColors.White);
        Canvas.DrawRoundRect(SKRect.Create(Margin, Y, ContentWidth, 22), 3, 3, bg);
        Canvas.DrawText(title, Margin + 10, Y + 15, SKTextAlign.Left, font, white);
        Y += 30;
    }

    /// <summary>Section title (".registration-title"), with an optional note on the right.</summary>
    public void Heading(string text, string? right = null, float size = 11)
    {
        Ensure(50);
        using var font = Font(size, bold: true);
        using var ink = Paint(Ink);
        var rightWidth = right is null ? 0 : font.MeasureText(right) + 12;
        var lines = Wrap(text, font, ContentWidth - rightWidth);
        foreach (var line in lines)
        {
            Canvas.DrawText(line, Margin, Y + font.Size, SKTextAlign.Left, font, ink);
            if (right is not null && line == lines[0])
                Canvas.DrawText(right, PageWidth - Margin, Y + font.Size, SKTextAlign.Right, font, ink);
            Y += font.Spacing;
        }
        Y += 4;
    }

    public void Paragraph(string text, float size = 9, bool bold = false, bool italic = false, SKTextAlign align = SKTextAlign.Left,
        float indent = 0, string? bullet = null, float width = 0, SKColor? color = null, float left = 0)
    {
        using var font = Font(size, bold, italic);
        using var ink = Paint(color ?? Ink);
        var x = Margin + left + indent;
        var w = (width > 0 ? width : ContentWidth - left) - indent;
        var lines = Wrap(text, font, w);
        for (var i = 0; i < lines.Count; i++)
        {
            Ensure(font.Spacing);
            if (i == 0 && bullet is not null)
                Canvas.DrawText(bullet, x - 4, Y + size, SKTextAlign.Right, font, ink);
            var tx = align switch { SKTextAlign.Center => x + w / 2, SKTextAlign.Right => x + w, _ => x };
            Canvas.DrawText(lines[i], tx, Y + size, align, font, ink);
            Y += font.Spacing;
        }
        Y += size * 0.5f;
    }

    /// <summary>An image of the given width (height in proportion), centred unless <paramref name="x"/> is given.</summary>
    public void Image(SKImage image, float width, float? x = null, float border = 0)
    {
        var h = width * image.Height / image.Width;
        Ensure(h + 2 * border);
        var left = x ?? Margin + (ContentWidth - width) / 2;
        Canvas.DrawImage(image, SKRect.Create(left, Y + border, width, h), Sampling);
        if (border > 0)
        {
            using var stroke = new SKPaint { Color = Ink, IsStroke = true, StrokeWidth = 0.8f, IsAntialias = true };
            Canvas.DrawRoundRect(SKRect.Create(left - border, Y, width + 2 * border, h + 2 * border), 6, 6, stroke);
        }
        Y += h + 2 * border + 6;
    }

    /// <summary>Images side by side with a caption under each, wrapping to new rows.</summary>
    public void Gallery(IReadOnlyList<SKImage> images, string caption, float maxWidth = 160, float maxHeight = 200) =>
        Gallery(images.Select(i => (i, caption)).ToList(), maxWidth, maxHeight);

    /// <summary>Images side by side, each with its own caption.</summary>
    public void Gallery(IReadOnlyList<(SKImage Image, string Caption)> items, float maxWidth = 160, float maxHeight = 200)
    {
        if (items.Count == 0) return;
        var images = items.Select(i => i.Image).ToList();
        var perRow = Math.Max(1, (int)(ContentWidth / (maxWidth + 12)));
        using var font = Font(9, bold: true);
        using var ink = Paint(Ink);
        for (var start = 0; start < images.Count; start += perRow)
        {
            var row = images.Skip(start).Take(perRow).ToList();
            var sizes = row.Select(i => Fit(i, maxWidth, maxHeight)).ToList();
            var rowHeight = sizes.Max(s => s.Height) + font.Spacing + 8;
            Ensure(rowHeight);
            var slot = ContentWidth / row.Count;
            for (var i = 0; i < row.Count; i++)
            {
                var cx = Margin + slot * i + slot / 2;
                var (w, h) = sizes[i];
                Canvas.DrawImage(row[i], SKRect.Create(cx - w / 2, Y, w, h), Sampling);
                var text = items[start + i].Caption;
                while (text.Length > 1 && font.MeasureText(text) > slot - 6) text = text[..^1];
                Canvas.DrawText(text, cx, Y + h + font.Size + 3, SKTextAlign.Center, font, ink);
            }
            Y += rowHeight;
        }
    }

    // ------------------------------------------------------------------ tables

    private sealed record Placed(CellItem Item, float Height, SKFont Font);

    public void Table(TableSpec table, bool repeatHeader = true)
    {
        var total = table.Widths.Sum();
        var widths = table.Widths.Select(w => w / total * ContentWidth).ToArray();
        var fonts = new Dictionary<(bool, bool), SKFont>();
        SKFont FontFor(bool bold, bool italic)
        {
            if (!fonts.TryGetValue((bold, italic), out var f)) fonts[(bold, italic)] = f = Font(table.FontSize, bold, italic);
            return f;
        }

        try
        {
            if (table.Header is { } header)
            {
                Ensure(60);
                DrawRow(table, widths, header, null, FontFor);
            }
            var repeat = repeatHeader ? table.Header : null;
            foreach (var row in table.Rows) DrawRow(table, widths, row, repeat, FontFor);
            Y += 8;
        }
        finally
        {
            foreach (var f in fonts.Values) f.Dispose();
        }
    }

    /// <summary>
    /// Draws one row. A row that does not fit moves to the next page (after the repeated header); a row
    /// taller than a whole page is split between its lines.
    /// </summary>
    private void DrawRow(TableSpec table, float[] widths, Cell[] row, Cell[]? repeatHeader, Func<bool, bool, SKFont> fontFor)
    {
        var isHeader = repeatHeader is null && table.Header is not null && ReferenceEquals(row, table.Header);
        var columns = new List<(float X, float Width, Cell Cell, Queue<Placed> Items, int Index)>();
        var x = Margin;
        var col = 0;
        foreach (var cell in row)
        {
            var span = Math.Max(1, cell.ColSpan);
            var w = widths.Skip(col).Take(span).Sum();
            var inner = w - 2 * CellPad;
            var queue = new Queue<Placed>();
            foreach (var item in cell.Items)
            {
                switch (item)
                {
                    case CellText t:
                        var font = fontFor(isHeader || cell.Bold || t.Bold || (table.LabelColumn && col == 0), t.Italic);
                        var indent = t.Bullet is null ? 0 : 10;
                        var first = true;
                        foreach (var line in Wrap(t.Text, font, inner - indent))
                        {
                            queue.Enqueue(new Placed(t with { Text = line, Bullet = t.Bullet is null ? null : first ? t.Bullet : "" }, font.Spacing, font));
                            first = false;
                        }
                        break;
                    case CellImage img:
                        var plain = fontFor(false, false);
                        var (_, ih) = Fit(img.Image, inner, img.MaxHeight);
                        queue.Enqueue(new Placed(img, ih + 4 + (img.Caption is null ? 0 : plain.Spacing), plain));
                        break;
                }
            }
            columns.Add((x, w, cell, queue, col));
            x += w;
            col += span;
        }

        var minLine = fontFor(false, false).Spacing;
        var fullHeight = Math.Max(columns.Max(c => c.Items.Sum(i => i.Height)), minLine) + 2 * CellPad;
        var headerHeight = repeatHeader is null ? 0 : 2 * minLine + 2 * CellPad;
        var pageBody = BodyBottom - _bodyTop - headerHeight;
        var freshPage = false;
        if (_canvas is null || (Y + fullHeight > BodyBottom && fullHeight <= pageBody))
        {
            StartPage(table, widths, repeatHeader, fontFor);
            freshPage = true;
        }

        while (true)
        {
            var available = BodyBottom - Y - 2 * CellPad;
            var takes = columns.Select(c =>
            {
                var taken = new List<Placed>();
                var used = 0f;
                foreach (var p in c.Items)
                {
                    if (used + p.Height > available)
                    {
                        if (taken.Count == 0 && freshPage) { taken.Add(p); used += p.Height; }
                        break;
                    }
                    taken.Add(p);
                    used += p.Height;
                }
                return (Taken: taken, Height: used);
            }).ToList();

            if (!freshPage && takes.All(t => t.Taken.Count == 0) && columns.Any(c => c.Items.Count > 0))
            {
                StartPage(table, widths, repeatHeader, fontFor);
                freshPage = true;
                continue;
            }

            var rowHeight = Math.Max(takes.Max(t => t.Height), minLine) + 2 * CellPad;
            for (var i = 0; i < columns.Count; i++)
            {
                var c = columns[i];
                DrawCell(table, c.X, c.Width, rowHeight, c.Cell, c.Index, takes[i].Taken, isHeader);
                for (var n = 0; n < takes[i].Taken.Count; n++) c.Items.Dequeue();
            }
            Y += rowHeight;
            if (columns.All(c => c.Items.Count == 0)) break;
            StartPage(table, widths, repeatHeader, fontFor);
            freshPage = true;
        }
    }

    private void StartPage(TableSpec table, float[] widths, Cell[]? repeatHeader, Func<bool, bool, SKFont> fontFor)
    {
        NewPage();
        if (repeatHeader is not null) DrawRow(table, widths, repeatHeader, null, fontFor);
    }

    private void DrawCell(TableSpec table, float x, float width, float height, Cell cell, int col, List<Placed> items, bool isHeader)
    {
        var label = table.LabelColumn && col == 0 && cell.Fill is null;
        if (isHeader || label || cell.Fill is not null)
        {
            using var fill = Paint(cell.Fill ?? Teal);
            Canvas.DrawRect(SKRect.Create(x, Y, width, height), fill);
        }
        using (var stroke = new SKPaint { Color = Grid, IsStroke = true, StrokeWidth = 0.6f })
            Canvas.DrawRect(SKRect.Create(x, Y, width, height), stroke);

        using var ink = Paint(isHeader || label ? SKColors.White : Ink);
        var center = cell.Center || isHeader;
        var y = Y + CellPad;
        var inner = width - 2 * CellPad;
        foreach (var p in items)
        {
            switch (p.Item)
            {
                case CellText t:
                    var indent = t.Bullet is null ? 0 : 10;
                    if (!string.IsNullOrEmpty(t.Bullet)) Canvas.DrawText(t.Bullet, x + CellPad + 2, y + p.Font.Size, SKTextAlign.Left, p.Font, ink);
                    Canvas.DrawText(t.Text, center ? x + width / 2 : x + CellPad + indent, y + p.Font.Size,
                        center ? SKTextAlign.Center : SKTextAlign.Left, p.Font, ink);
                    break;
                case CellImage img:
                    var (w, h) = Fit(img.Image, inner, img.MaxHeight);
                    var ix = center ? x + (width - w) / 2 : x + CellPad;
                    Canvas.DrawImage(img.Image, SKRect.Create(ix, y + 2, w, h), Sampling);
                    if (img.Caption is not null)
                        Canvas.DrawText(img.Caption, ix, y + 2 + h + p.Font.Size + 1, SKTextAlign.Left, p.Font, ink);
                    break;
            }
            y += p.Height;
        }
    }

    // ------------------------------------------------------------------ helpers

    public static SKSamplingOptions Sampling { get; } = new(SKFilterMode.Linear, SKMipmapMode.Linear);

    public static SKPaint Paint(SKColor color) => new() { Color = color, IsAntialias = true };

    public static (float Width, float Height) Fit(SKImage image, float maxWidth, float maxHeight)
    {
        var scale = Math.Min(maxWidth / image.Width, maxHeight / image.Height);
        return (image.Width * scale, image.Height * scale);
    }

    /// <summary>Word wrap; explicit line breaks are kept and over-long words are broken.</summary>
    public static List<string> Wrap(string text, SKFont font, float maxWidth)
    {
        var lines = new List<string>();
        foreach (var paragraph in (text ?? "").Replace("\r\n", "\n").Replace('\r', '\n').Replace('\t', ' ').Split('\n'))
        {
            var current = "";
            foreach (var raw in paragraph.Split(' ', StringSplitOptions.RemoveEmptyEntries))
            {
                var word = raw;
                var candidate = current.Length == 0 ? word : current + " " + word;
                if (font.MeasureText(candidate) <= maxWidth)
                {
                    current = candidate;
                    continue;
                }
                if (current.Length > 0) lines.Add(current);
                while (font.MeasureText(word) > maxWidth && word.Length > 1)
                {
                    var n = word.Length - 1;
                    while (n > 1 && font.MeasureText(word[..n]) > maxWidth) n--;
                    lines.Add(word[..n]);
                    word = word[n..];
                }
                current = word;
            }
            lines.Add(current);
        }
        return lines;
    }

    public byte[] Finish()
    {
        if (_page == 0) NewPage();
        EndPage();
        _doc.Close();
        return _output.ToArray();
    }

    public void Dispose()
    {
        _doc.Dispose();
        _output.Dispose();
        foreach (var typeface in new[] { _regular, _bold, _italic }.Distinct())
            if (!ReferenceEquals(typeface, SKTypeface.Default)) typeface.Dispose();
    }
}
