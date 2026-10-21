using System.IO.Compression;
using System.Security;
using System.Text;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.Schemes;

namespace Zed.Portal.Features.Msme.Schemes;

/// <summary>
/// The workbook template of the incentive upload (staff page /staff/incentives/upload). Port of
/// IncentiveController.DownloadTemplate, which served <c>~/Templates/IncentiveTemplate.xls</c> to anyone; the
/// upload page linked to <c>Center/DownloadTemplate</c>, which does not exist in this portal, so the link was
/// broken. The V4 upload reads .xlsx only, so the template is generated as .xlsx with the 15 column headers
/// the upload matches (<see cref="IncentivesController.Columns"/>), for the master admin who uploads.
/// </summary>
[Route("api/staff/schemes/incentives/template")]
[StaffRoles(UserRole.MasterAdmin)]
public sealed class IncentiveTemplateController : StaffApiController
{
    public const string FileName = "IncentiveTemplate.xlsx";

    [HttpGet]
    public FileContentResult Get() =>
        File(Build(IncentivesController.Columns.Select(c => c.Name).ToArray()),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", FileName);

    /// <summary>A one-sheet workbook whose first row holds the given headers (inline strings, no styles).</summary>
    public static byte[] Build(IReadOnlyList<string> headers)
    {
        using var ms = new MemoryStream();
        using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
        {
            Add(zip, "[Content_Types].xml",
                """<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>""");
            Add(zip, "_rels/.rels",
                """<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>""");
            Add(zip, "xl/workbook.xml",
                """<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>""");
            Add(zip, "xl/_rels/workbook.xml.rels",
                """<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>""");

            var row = new StringBuilder();
            for (var i = 0; i < headers.Count; i++)
                row.Append($"""<c r="{Column(i)}1" t="inlineStr"><is><t>{SecurityElement.Escape(headers[i])}</t></is></c>""");
            Add(zip, "xl/worksheets/sheet1.xml",
                $"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">{row}</row></sheetData></worksheet>""");
        }
        return ms.ToArray();
    }

    private static string Column(int index)
    {
        var name = "";
        for (var n = index + 1; n > 0; n = (n - 1) / 26) name = (char)('A' + (n - 1) % 26) + name;
        return name;
    }

    private static void Add(ZipArchive zip, string path, string content)
    {
        using var w = new StreamWriter(zip.CreateEntry(path, CompressionLevel.Optimal).Open(), new UTF8Encoding(false));
        w.Write(content);
    }
}
