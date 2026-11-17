using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.Users;

namespace Zed.Portal.Features.Staff.Reports;

/// <summary>
/// 2026-11-17 (the user's staff designs, approved: "Export" on the dashboard, payments received and completed
/// assessments): the table a staff page already shows, as an .xlsx workbook. The page sends the columns and rows it has
/// loaded for this login (nothing is read from the database here, so nobody gets more than their page shows) and gets
/// the file back, written by <see cref="XlsxWriter"/> (formula-safe text, numbers as numbers).
/// </summary>
[Route("api/staff/export")]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed partial class TableExportController : StaffApiController
{
    public const int MaxRows = 50_000;
    public const int MaxColumns = 60;
    public const int MaxSheets = 10;

    public sealed record ExportSheet(string? Name, IReadOnlyList<string>? Columns, IReadOnlyList<IReadOnlyList<object?>>? Rows);

    public sealed record ExportRequest(string? FileName, IReadOnlyList<ExportSheet>? Sheets);

    [HttpPost("xlsx")]
    [RequestSizeLimit(20_000_000)]
    public IActionResult Xlsx(ExportRequest req)
    {
        var sheets = req.Sheets ?? [];
        if (sheets.Count == 0 || sheets.Count > MaxSheets) return this.Problem400("Nothing to export.");
        var built = new List<XlsxSheet>();
        foreach (var (s, i) in sheets.Select((s, i) => (s, i)))
        {
            var columns = s.Columns ?? [];
            var rows = s.Rows ?? [];
            if (columns.Count == 0 || columns.Count > MaxColumns) return this.Problem400("The export has no columns, or too many.");
            if (rows.Count > MaxRows) return this.Problem400($"At most {MaxRows:N0} rows can be exported at a time.");
            built.Add(new XlsxSheet(SheetName(s.Name, i), columns.Select(c => c ?? "").ToList(),
                rows.Select(r => (IReadOnlyList<object?>)columns.Select((_, c) => c < r.Count ? Cell(r[c]) : null).ToList())));
        }
        return File(XlsxWriter.Write(built), XlsxWriter.ContentType, FileName(req.FileName));
    }

    /// <summary>A JSON number stays a number; everything else is text.</summary>
    private static object? Cell(object? v) => v switch
    {
        null => null,
        System.Text.Json.JsonElement { ValueKind: System.Text.Json.JsonValueKind.Number } j => j.TryGetDecimal(out var d) ? d : j.GetDouble(),
        System.Text.Json.JsonElement { ValueKind: System.Text.Json.JsonValueKind.Null or System.Text.Json.JsonValueKind.Undefined } => null,
        System.Text.Json.JsonElement { ValueKind: System.Text.Json.JsonValueKind.String } j => j.GetString(),
        System.Text.Json.JsonElement j => j.ToString(),
        _ => v.ToString(),
    };

    /// <summary>Excel's sheet name rules: at most 31 characters, none of : \ / ? * [ ].</summary>
    public static string SheetName(string? name, int index)
    {
        var n = SheetChars().Replace((name ?? "").Trim(), " ").Trim();
        if (n.Length == 0) n = $"Sheet{index + 1}";
        return n.Length > 31 ? n[..31] : n;
    }

    /// <summary>A safe file name ending in .xlsx.</summary>
    public static string FileName(string? name)
    {
        var n = FileChars().Replace((name ?? "").Trim(), "-").Trim('-', '.', ' ');
        if (n.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase)) n = n[..^5];
        if (n.Length == 0) n = "zed-export";
        return (n.Length > 80 ? n[..80] : n) + ".xlsx";
    }

    [GeneratedRegex(@"[:\\/?*\[\]]")]
    private static partial Regex SheetChars();

    [GeneratedRegex(@"[^A-Za-z0-9 ._-]+")]
    private static partial Regex FileChars();
}
