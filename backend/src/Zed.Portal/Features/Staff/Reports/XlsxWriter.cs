using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Xml;

namespace Zed.Portal.Features.Staff.Reports;

public sealed record XlsxSheet(string Name, IReadOnlyList<string> Columns, IEnumerable<IReadOnlyList<object?>> Rows);

/// <summary>
/// Writes a plain .xlsx workbook (one sheet per result set, header row in bold), replacing the legacy
/// ExcelHelper.CreateExcelDocumentAsStream (OpenXML SDK). An .xlsx file is a zip of a few XML parts, so
/// System.IO.Compression and XmlWriter are enough: no third-party package is needed for a report export.
/// <para>
/// Text is written as inline strings, which Excel never evaluates. In addition, text starting with
/// = + - @ (or tab / carriage return) gets a leading apostrophe, so the value stays inert if the sheet is
/// re-saved as CSV and opened again (CSV/formula injection). Numbers are written as numeric cells.
/// </para>
/// </summary>
public static class XlsxWriter
{
    public const string ContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    public static byte[] Write(IReadOnlyList<XlsxSheet> sheets)
    {
        if (sheets.Count == 0) sheets = [new XlsxSheet("Sheet1", [], [])];
        var names = UniqueSheetNames(sheets.Select(s => s.Name));

        using var buffer = new MemoryStream();
        using (var zip = new ZipArchive(buffer, ZipArchiveMode.Create, leaveOpen: true))
        {
            Part(zip, "[Content_Types].xml", w =>
            {
                w.WriteStartElement("Types", "http://schemas.openxmlformats.org/package/2006/content-types");
                Default(w, "rels", "application/vnd.openxmlformats-package.relationships+xml");
                Default(w, "xml", "application/xml");
                Override(w, "/xl/workbook.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml");
                Override(w, "/xl/styles.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml");
                for (var i = 1; i <= sheets.Count; i++)
                    Override(w, $"/xl/worksheets/sheet{i}.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml");
                w.WriteEndElement();
            });

            Part(zip, "_rels/.rels", w =>
            {
                w.WriteStartElement("Relationships", RelNs);
                Relationship(w, "rId1", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument", "xl/workbook.xml");
                w.WriteEndElement();
            });

            Part(zip, "xl/workbook.xml", w =>
            {
                w.WriteStartElement("workbook", MainNs);
                w.WriteAttributeString("xmlns", "r", null, DocRelNs);
                w.WriteStartElement("sheets", MainNs);
                for (var i = 0; i < sheets.Count; i++)
                {
                    w.WriteStartElement("sheet", MainNs);
                    w.WriteAttributeString("name", names[i]);
                    w.WriteAttributeString("sheetId", (i + 1).ToString(CultureInfo.InvariantCulture));
                    w.WriteAttributeString("id", DocRelNs, $"rId{i + 1}");
                    w.WriteEndElement();
                }
                w.WriteEndElement();
                w.WriteEndElement();
            });

            Part(zip, "xl/_rels/workbook.xml.rels", w =>
            {
                w.WriteStartElement("Relationships", RelNs);
                for (var i = 1; i <= sheets.Count; i++)
                    Relationship(w, $"rId{i}", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet", $"worksheets/sheet{i}.xml");
                Relationship(w, $"rId{sheets.Count + 1}", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles", "styles.xml");
                w.WriteEndElement();
            });

            Part(zip, "xl/styles.xml", w =>
            {
                w.WriteStartElement("styleSheet", MainNs);
                w.WriteStartElement("fonts", MainNs); w.WriteAttributeString("count", "2");
                w.WriteStartElement("font", MainNs); w.WriteEndElement();
                w.WriteStartElement("font", MainNs); w.WriteStartElement("b", MainNs); w.WriteEndElement(); w.WriteEndElement();
                w.WriteEndElement();
                w.WriteStartElement("fills", MainNs); w.WriteAttributeString("count", "1");
                w.WriteStartElement("fill", MainNs); w.WriteStartElement("patternFill", MainNs); w.WriteAttributeString("patternType", "none"); w.WriteEndElement(); w.WriteEndElement();
                w.WriteEndElement();
                w.WriteStartElement("borders", MainNs); w.WriteAttributeString("count", "1");
                w.WriteStartElement("border", MainNs); w.WriteEndElement();
                w.WriteEndElement();
                w.WriteStartElement("cellXfs", MainNs); w.WriteAttributeString("count", "2");
                w.WriteStartElement("xf", MainNs); w.WriteAttributeString("fontId", "0"); w.WriteEndElement();
                w.WriteStartElement("xf", MainNs); w.WriteAttributeString("fontId", "1"); w.WriteAttributeString("applyFont", "1"); w.WriteEndElement();
                w.WriteEndElement();
                w.WriteEndElement();
            });

            for (var i = 0; i < sheets.Count; i++)
            {
                var sheet = sheets[i];
                Part(zip, $"xl/worksheets/sheet{i + 1}.xml", w =>
                {
                    w.WriteStartElement("worksheet", MainNs);
                    w.WriteStartElement("sheetData", MainNs);
                    var rowNo = 1;
                    if (sheet.Columns.Count > 0) WriteRow(w, rowNo++, sheet.Columns, header: true);
                    foreach (var row in sheet.Rows) WriteRow(w, rowNo++, row, header: false);
                    w.WriteEndElement();
                    w.WriteEndElement();
                });
            }
        }
        return buffer.ToArray();
    }

    /// <summary>Text that a spreadsheet would read as a formula gets a leading apostrophe.</summary>
    public static string Neutralise(string text) =>
        text.Length > 0 && text[0] is '=' or '+' or '-' or '@' or '\t' or '\r' ? "'" + text : text;

    private const string MainNs = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
    private const string RelNs = "http://schemas.openxmlformats.org/package/2006/relationships";
    private const string DocRelNs = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

    private static void WriteRow(XmlWriter w, int rowNo, IReadOnlyList<object?> values, bool header)
    {
        w.WriteStartElement("row", MainNs);
        w.WriteAttributeString("r", rowNo.ToString(CultureInfo.InvariantCulture));
        for (var c = 0; c < values.Count; c++)
        {
            var value = values[c];
            if (value is null or DBNull) continue;
            w.WriteStartElement("c", MainNs);
            w.WriteAttributeString("r", ColumnName(c) + rowNo.ToString(CultureInfo.InvariantCulture));
            if (header) w.WriteAttributeString("s", "1");
            if (!header && Number(value) is { } number)
            {
                w.WriteElementString("v", MainNs, number);
            }
            else
            {
                w.WriteAttributeString("t", "inlineStr");
                w.WriteStartElement("is", MainNs);
                w.WriteStartElement("t", MainNs);
                w.WriteAttributeString("xml", "space", null, "preserve");
                w.WriteString(CleanXml(Neutralise(Text(value))));
                w.WriteEndElement();
                w.WriteEndElement();
            }
            w.WriteEndElement();
        }
        w.WriteEndElement();
    }

    private static string? Number(object value) => value switch
    {
        byte or sbyte or short or ushort or int or uint or long or ulong => Convert.ToString(value, CultureInfo.InvariantCulture),
        decimal d => d.ToString(CultureInfo.InvariantCulture),
        double d when double.IsFinite(d) => d.ToString("R", CultureInfo.InvariantCulture),
        float f when float.IsFinite(f) => f.ToString("R", CultureInfo.InvariantCulture),
        _ => null,
    };

    private static string Text(object value) => value switch
    {
        DateTime d => d.TimeOfDay == TimeSpan.Zero ? d.ToString("dd-MMM-yyyy", CultureInfo.InvariantCulture) : d.ToString("dd-MMM-yyyy HH:mm:ss", CultureInfo.InvariantCulture),
        DateTimeOffset d => d.ToString("dd-MMM-yyyy HH:mm:ss", CultureInfo.InvariantCulture),
        bool b => b ? "TRUE" : "FALSE",
        _ => Convert.ToString(value, CultureInfo.InvariantCulture) ?? "",
    };

    /// <summary>Drops characters XML cannot carry (control characters stored in some free-text columns).</summary>
    private static string CleanXml(string s)
    {
        if (s.All(XmlConvert.IsXmlChar)) return s;
        var sb = new StringBuilder(s.Length);
        for (var i = 0; i < s.Length; i++)
        {
            if (XmlConvert.IsXmlChar(s[i])) sb.Append(s[i]);
            else if (i + 1 < s.Length && XmlConvert.IsXmlSurrogatePair(s[i + 1], s[i])) { sb.Append(s[i]).Append(s[i + 1]); i++; }
        }
        return sb.ToString();
    }

    public static string ColumnName(int index)
    {
        var name = "";
        for (var n = index + 1; n > 0; n = (n - 1) / 26) name = (char)('A' + (n - 1) % 26) + name;
        return name;
    }

    private static List<string> UniqueSheetNames(IEnumerable<string> names)
    {
        var result = new List<string>();
        foreach (var raw in names)
        {
            var name = new string((raw ?? "").Where(ch => ch is not ('[' or ']' or ':' or '*' or '?' or '/' or '\\')).ToArray()).Trim('\'').Trim();
            if (name.Length == 0) name = "Sheet";
            if (name.Length > 31) name = name[..31];
            var candidate = name;
            for (var n = 2; result.Contains(candidate, StringComparer.OrdinalIgnoreCase); n++)
                candidate = (name.Length > 27 ? name[..27] : name) + " (" + n + ")";
            result.Add(candidate);
        }
        return result;
    }

    private static void Part(ZipArchive zip, string path, Action<XmlWriter> write)
    {
        var entry = zip.CreateEntry(path, CompressionLevel.Optimal);
        using var stream = entry.Open();
        using var w = XmlWriter.Create(stream, new XmlWriterSettings { Encoding = new UTF8Encoding(false) });
        w.WriteStartDocument(standalone: true);
        write(w);
        w.WriteEndDocument();
    }

    private static void Default(XmlWriter w, string ext, string type)
    {
        w.WriteStartElement("Default", "http://schemas.openxmlformats.org/package/2006/content-types");
        w.WriteAttributeString("Extension", ext);
        w.WriteAttributeString("ContentType", type);
        w.WriteEndElement();
    }

    private static void Override(XmlWriter w, string part, string type)
    {
        w.WriteStartElement("Override", "http://schemas.openxmlformats.org/package/2006/content-types");
        w.WriteAttributeString("PartName", part);
        w.WriteAttributeString("ContentType", type);
        w.WriteEndElement();
    }

    private static void Relationship(XmlWriter w, string id, string type, string target)
    {
        w.WriteStartElement("Relationship", RelNs);
        w.WriteAttributeString("Id", id);
        w.WriteAttributeString("Type", type);
        w.WriteAttributeString("Target", target);
        w.WriteEndElement();
    }
}
