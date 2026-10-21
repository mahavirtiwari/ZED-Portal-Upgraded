using System.Globalization;
using System.IO.Compression;
using System.Xml;

namespace Zed.Portal.Features.Staff.Schemes;

/// <summary>
/// Minimal, bounded reader of the first worksheet of an .xlsx file (Office Open XML: a zip of XML parts),
/// enough for the incentive upload. Written here rather than adding an Excel package. Cell values are
/// returned as text: shared and inline strings as is, numbers in invariant culture (dates stay Excel
/// serial numbers; the caller knows which columns are dates). Formulas are not evaluated; their cached
/// value is read.
/// <para>Limits: at most <see cref="MaxRows"/> rows and <see cref="MaxColumns"/> columns, parts of at most
/// <see cref="MaxPartChars"/> characters, no DTDs. Anything else is a <see cref="XlsxFormatException"/>.</para>
/// </summary>
public static class XlsxSheetReader
{
    public const int MaxRows = 5001;          // header + 5000 data rows
    public const int MaxColumns = 64;
    public const long MaxPartChars = 20_000_000;

    public static IReadOnlyList<string?[]> ReadFirstSheet(Stream xlsx)
    {
        ZipArchive zip;
        try { zip = new ZipArchive(xlsx, ZipArchiveMode.Read, leaveOpen: true); }
        catch (InvalidDataException) { throw new XlsxFormatException("The file is not a valid .xlsx workbook."); }

        using (zip)
        {
            var sheetPath = FirstSheetPath(zip) ?? "xl/worksheets/sheet1.xml";
            var shared = zip.GetEntry("xl/sharedStrings.xml") is { } s ? SharedStrings(s) : [];
            var sheet = zip.GetEntry(sheetPath) ?? throw new XlsxFormatException("The workbook has no worksheet.");
            return Rows(sheet, shared);
        }
    }

    private static XmlReader Open(ZipArchiveEntry entry) =>
        XmlReader.Create(entry.Open(), new XmlReaderSettings
        {
            DtdProcessing = DtdProcessing.Prohibit,
            XmlResolver = null,
            MaxCharactersInDocument = MaxPartChars,
            IgnoreWhitespace = false,
            CloseInput = true,
        });

    private static string? FirstSheetPath(ZipArchive zip)
    {
        if (zip.GetEntry("xl/workbook.xml") is not { } wb) return null;
        string? relId = null;
        using (var r = Open(wb))
        {
            while (Safe(r.Read))
            {
                if (r.NodeType == XmlNodeType.Element && r.LocalName == "sheet")
                {
                    relId = r.GetAttribute("id", "http://schemas.openxmlformats.org/officeDocument/2006/relationships");
                    break;
                }
            }
        }
        if (relId is null || zip.GetEntry("xl/_rels/workbook.xml.rels") is not { } rels) return null;
        using var rr = Open(rels);
        while (Safe(rr.Read))
        {
            if (rr.NodeType == XmlNodeType.Element && rr.LocalName == "Relationship" && rr.GetAttribute("Id") == relId)
            {
                var target = rr.GetAttribute("Target")?.Replace('\\', '/');
                if (string.IsNullOrEmpty(target) || target.Contains("..")) return null;
                return target.StartsWith('/') ? target[1..] : "xl/" + target;
            }
        }
        return null;
    }

    private static List<string> SharedStrings(ZipArchiveEntry entry)
    {
        var list = new List<string>();
        using var r = Open(entry);
        System.Text.StringBuilder? current = null;
        var advance = true;
        while (true)
        {
            // ReadElementContentAsString already moves to the next node: do not Read again after it.
            if (advance && !Safe(r.Read)) break;
            advance = true;
            if (r.NodeType == XmlNodeType.Element && r.LocalName == "si") current = new System.Text.StringBuilder();
            else if (r.NodeType == XmlNodeType.Element && r.LocalName == "rPh") { Safe(() => { r.Skip(); return true; }); advance = false; } // phonetic runs are not cell text
            else if (r.NodeType == XmlNodeType.Element && r.LocalName == "t" && current is not null)
            {
                current.Append(Safe(r.ReadElementContentAsString));
                advance = false;
            }
            else if (r.NodeType == XmlNodeType.EndElement && r.LocalName == "si" && current is not null)
            {
                list.Add(current.ToString());
                current = null;
                if (list.Count > 1_000_000) throw new XlsxFormatException("The workbook is too large.");
            }
            if (r.EOF) break;
        }
        return list;
    }

    private static List<string?[]> Rows(ZipArchiveEntry entry, List<string> shared)
    {
        var rows = new List<string?[]>();
        using var r = Open(entry);
        string?[]? row = null;
        while (Safe(r.Read))
        {
            if (r.NodeType == XmlNodeType.Element && r.LocalName == "row")
            {
                if (rows.Count >= MaxRows) throw new XlsxFormatException($"The sheet has more than {MaxRows - 1} rows.");
                row = new string?[MaxColumns];
                // Rows may be numbered with gaps; keep their position so error messages match Excel's row numbers.
                if (int.TryParse(r.GetAttribute("r"), NumberStyles.None, CultureInfo.InvariantCulture, out var number) && number > rows.Count + 1)
                {
                    if (number > MaxRows) throw new XlsxFormatException($"The sheet has more than {MaxRows - 1} rows.");
                    while (rows.Count < number - 1) rows.Add(new string?[MaxColumns]);
                }
                if (r.IsEmptyElement) { rows.Add(row); row = null; }
            }
            else if (r.NodeType == XmlNodeType.EndElement && r.LocalName == "row" && row is not null)
            {
                rows.Add(row);
                row = null;
            }
            else if (r.NodeType == XmlNodeType.Element && r.LocalName == "c" && row is not null)
            {
                var col = ColumnIndex(r.GetAttribute("r"));
                var type = r.GetAttribute("t");
                var value = CellValue(r, type, shared);
                if (col is >= 0 and < MaxColumns) row[col] = value;
                else if (col >= MaxColumns && !string.IsNullOrEmpty(value)) throw new XlsxFormatException($"The sheet has more than {MaxColumns} columns.");
            }
        }
        return rows;
    }

    private static string? CellValue(XmlReader r, string? type, List<string> shared)
    {
        if (r.IsEmptyElement) return null;
        string? v = null, inline = null;
        var depth = r.Depth;
        Safe(r.Read);
        // Ends positioned on </c>.
        while (!r.EOF && !(r.NodeType == XmlNodeType.EndElement && r.Depth == depth))
        {
            if (r.NodeType == XmlNodeType.Element && r.LocalName == "v") { v = Safe(r.ReadElementContentAsString); continue; }
            if (r.NodeType == XmlNodeType.Element && r.LocalName == "t") { inline = (inline ?? "") + Safe(r.ReadElementContentAsString); continue; }
            Safe(r.Read);
        }
        return type switch
        {
            "s" => int.TryParse(v, NumberStyles.None, CultureInfo.InvariantCulture, out var i) && i < shared.Count ? shared[i] : throw new XlsxFormatException("The workbook is damaged (shared string)."),
            "inlineStr" => inline,
            "b" => v == "1" ? "TRUE" : "FALSE",
            "e" => null,
            _ => v,
        };
    }

    /// <summary>"C12" → 2.</summary>
    public static int ColumnIndex(string? reference)
    {
        if (string.IsNullOrEmpty(reference)) return -1;
        var n = 0;
        var letters = 0;
        foreach (var ch in reference)
        {
            if (ch is >= 'A' and <= 'Z') { n = n * 26 + (ch - 'A' + 1); if (++letters > 3) return int.MaxValue; }
            else break;
        }
        return letters == 0 ? -1 : n - 1;
    }

    private static T Safe<T>(Func<T> read)
    {
        try { return read(); }
        catch (XmlException ex) { throw new XlsxFormatException("The workbook could not be read: " + (ex.Message.Contains("MaxCharactersInDocument") ? "it is too large." : "invalid content.")); }
        catch (InvalidDataException) { throw new XlsxFormatException("The workbook could not be read (damaged file)."); }
    }
}

public sealed class XlsxFormatException(string message) : Exception(message);
