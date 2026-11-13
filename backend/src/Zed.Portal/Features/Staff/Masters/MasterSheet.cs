using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Zed.Portal.Features.Staff.Reports;
using Zed.Portal.Features.Staff.Schemes;

namespace Zed.Portal.Features.Staff.Masters;

/// <summary>
/// A column of a master's Excel sheet: its header, and how to fill it (the template's "How to fill" sheet). A key column
/// may be <paramref name="Optional"/> (e.g. a region's district code: empty = the whole state). A column added later may be
/// <paramref name="MayBeAbsent"/>: a file exported before it was added still uploads, the column read as empty.
/// </summary>
public sealed record SheetColumn(string Name, string Help, bool Optional = false, bool MayBeAbsent = false);

/// <summary>
/// The Excel sheet of a master: its columns (the first <paramref name="KeyColumns"/> identify a row) and how rows are
/// matched, as the upload pop-up says it. <paramref name="KeyForm"/> puts a key cell (column index, value) in its stored
/// form before rows are matched (e.g. a list's key or name to its name).
/// </summary>
public sealed record SheetSpec(string Title, string FileName, IReadOnlyList<SheetColumn> Columns, int KeyColumns, string MatchRule,
    Func<int, string, string>? KeyForm = null);

/// <param name="Result">new, changed, same or error.</param>
/// <param name="Changed">The columns that differ from the master (changed rows).</param>
/// <param name="Was">The master's values of the row (changed rows), in the columns' order.</param>
/// <param name="Notes">What the upload leaves as it is in this row (it is still applied).</param>
public sealed record SheetRow(int Row, IReadOnlyList<string> Values, string Result, IReadOnlyList<string> Changed, IReadOnlyList<string>? Was,
    IReadOnlyList<string> Errors, IReadOnlyList<string> Notes);

public sealed record SheetCheck(IReadOnlyList<string> Columns, string MatchRule, int New, int Changed, int Unchanged, int Errors, IReadOnlyList<SheetRow> Rows);

/// <summary>Added + Updated rows were saved; Failed = rows with errors (in the file or when saving), which were skipped.</summary>
public sealed record SheetApplied(string Message, int Added, int Updated, int Failed, IReadOnlyList<SheetRow> Rows);

/// <summary>
/// A row of the uploaded sheet being checked: its cells in the columns' order (trimmed; the validator puts them in the
/// form they are stored in, e.g. "Active"), the master's row with the same key (null: new) and what is wrong with it.
/// </summary>
public sealed class SheetRowContext(int row, string[] cells, string[]? current)
{
    public int Row { get; } = row;
    public string[] Cells { get; } = cells;
    public string[]? Current { get; } = current;
    public List<string> Errors { get; } = [];
    public List<string> Notes { get; } = [];
    public string Cell(int i) => Cells[i];
}

/// <summary>
/// Excel export, template and upload of the Admin masters (V4; the legacy masters were edited one row at a time).
/// Export writes the whole master in the sheet's columns, so an exported file can be edited and uploaded again; the
/// template is the same sheet without rows plus a "How to fill" sheet. An upload is checked first (nothing is changed):
/// every row is new, changed, the same as the master or has errors, with the reasons. Applying re-reads the file, checks
/// it again and saves the new and changed rows through the master's own add / update rules; rows with errors are
/// skipped. Nothing is ever deleted by an upload.
/// </summary>
public static class MasterSheet
{
    public const long MaxFileBytes = 5 * 1024 * 1024;
    public const int MaxDataRows = XlsxSheetReader.MaxRows - 1;

    public static FileContentResult Export(SheetSpec spec, IEnumerable<string?[]> rows) =>
        File(spec, spec.FileName + ".xlsx", rows.Select(r => (IReadOnlyList<object?>)r.Cast<object?>().ToList()));

    public static FileContentResult Template(SheetSpec spec) => File(spec, spec.FileName + "-template.xlsx", []);

    private static FileContentResult File(SheetSpec spec, string name, IEnumerable<IReadOnlyList<object?>> rows)
    {
        var help = spec.Columns.Select(c => (IReadOnlyList<object?>)[c.Name, c.Help]).Append(["", ""]).Append(["Matching", spec.MatchRule]).ToList();
        var bytes = XlsxWriter.Write([new XlsxSheet(spec.Title, spec.Columns.Select(c => c.Name).ToList(), rows), new XlsxSheet("How to fill", ["Column", "How to fill"], help)]);
        return new FileContentResult(bytes, XlsxWriter.ContentType) { FileDownloadName = name };
    }

    /// <summary>The rows of the uploaded .xlsx (first sheet), or what is wrong with the file.</summary>
    public static async Task<(IReadOnlyList<string?[]>? Rows, string? Error)> ReadAsync(IFormFile? file, CancellationToken ct)
    {
        if (file is null || file.Length == 0) return (null, "Please choose the Excel file (.xlsx).");
        if (file.Length > MaxFileBytes) return (null, "The file is larger than 5 MB.");
        if (!string.Equals(Path.GetExtension(file.FileName), ".xlsx", StringComparison.OrdinalIgnoreCase))
            return (null, "Please upload an Excel file (.xlsx). Save an .xls or .csv file as .xlsx first.");
        await using var buffer = new MemoryStream();
        await file.CopyToAsync(buffer, ct);
        buffer.Position = 0;
        try { return (XlsxSheetReader.ReadFirstSheet(buffer), null); }
        catch (XlsxFormatException ex) { return (null, ex.Message); }
        catch (Exception ex) when (ex is InvalidDataException or System.Xml.XmlException)
        {
            return (null, "The file is not a valid .xlsx workbook.");
        }
    }

    /// <summary>
    /// Checks every row of the sheet against the master (<paramref name="current"/>: its rows in the sheet's columns, in
    /// stored form). Columns are found by their headers (any order; other columns are ignored); empty rows are skipped.
    /// </summary>
    public static (SheetCheck? Check, List<SheetRowContext> Rows, string? Error) Check(
        SheetSpec spec, IReadOnlyList<string?[]> sheet, IEnumerable<string?[]> current, Action<SheetRowContext> validate)
    {
        if (sheet.Count == 0) return (null, [], "The file is empty.");
        var header = sheet[0].Select(Header).ToList();
        var index = spec.Columns.Select(c => header.IndexOf(Header(c.Name))).ToArray();
        var missing = spec.Columns.Where((c, i) => index[i] < 0 && !c.MayBeAbsent).Select(c => c.Name).ToList();
        if (missing.Count > 0)
            return (null, [], $"The first row must have the template's column headers; missing: {string.Join(", ", missing)}. Please download the template.");

        var masters = new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase);
        foreach (var r in current) masters.TryAdd(Key(spec, r), r.Select(v => v ?? "").ToArray());

        var rows = new List<SheetRowContext>();
        var seen = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        for (var i = 1; i < sheet.Count; i++)
        {
            var cells = index.Select(c => c >= 0 && c < sheet[i].Length ? Clean(sheet[i][c]) : "").ToArray();
            if (cells.All(c => c.Length == 0)) continue;
            if (spec.KeyForm is { } form)
                for (var k = 0; k < spec.KeyColumns; k++) cells[k] = form(k, cells[k]);
            var key = Key(spec, cells);
            var row = new SheetRowContext(i + 1, cells, masters.GetValueOrDefault(key));
            for (var k = 0; k < spec.KeyColumns; k++)
                if (cells[k].Length == 0 && !spec.Columns[k].Optional) row.Errors.Add($"{spec.Columns[k].Name} is required.");
            if (row.Errors.Count == 0 && seen.TryGetValue(key, out var first)) row.Errors.Add($"Row {first} has the same {KeyName(spec)}.");
            else if (row.Errors.Count == 0) seen[key] = row.Row;
            if (row.Errors.Count == 0) validate(row);
            rows.Add(row);
        }
        if (rows.Count == 0) return (null, [], "The file has no rows below the headers.");

        var results = rows.Select(r => Result(spec, r)).ToList();
        return (new SheetCheck(spec.Columns.Select(c => c.Name).ToList(), spec.MatchRule,
            results.Count(r => r.Result == "new"), results.Count(r => r.Result == "changed"), results.Count(r => r.Result == "same"),
            results.Count(r => r.Result == "error"), results), rows, null);
    }

    /// <summary>POST …/excel/check: reads the upload and checks it (nothing is changed).</summary>
    public static async Task<ActionResult<SheetCheck>> CheckAsync(ControllerBase c, SheetSpec spec, IFormFile? file,
        Func<Task<(IEnumerable<string?[]> Current, Action<SheetRowContext> Validate)>> prepare, CancellationToken ct)
    {
        var (sheet, error) = await ReadAsync(file, ct);
        if (error is not null) return c.Problem(title: error, statusCode: StatusCodes.Status400BadRequest);
        var (current, validate) = await prepare();
        var (check, _, checkError) = Check(spec, sheet!, current, validate);
        return checkError is not null ? c.Problem(title: checkError, statusCode: StatusCodes.Status400BadRequest) : check!;
    }

    // Check-then-save must not interleave between two uploads (single server).
    private static readonly SemaphoreSlim ApplyLock = new(1, 1);

    /// <summary>POST …/excel/apply: reads the upload, checks it again against the master as it is now, and saves the new and changed rows.</summary>
    public static async Task<ActionResult<SheetApplied>> ApplyAsync(ControllerBase c, SheetSpec spec, IFormFile? file,
        Func<Task<(IEnumerable<string?[]> Current, Action<SheetRowContext> Validate)>> prepare, Func<SheetRowContext, Task<string?>> save, CancellationToken ct)
    {
        var (sheet, error) = await ReadAsync(file, ct);
        if (error is not null) return c.Problem(title: error, statusCode: StatusCodes.Status400BadRequest);
        await ApplyLock.WaitAsync(ct);
        try
        {
            var (current, validate) = await prepare();
            var (_, rows, checkError) = Check(spec, sheet!, current, validate);
            if (checkError is not null) return c.Problem(title: checkError, statusCode: StatusCodes.Status400BadRequest);
            return await ApplyAsync(spec, rows, save);
        }
        finally { ApplyLock.Release(); }
    }

    /// <summary>Saves the new and changed rows (<paramref name="save"/> returns an error message, or null when saved).</summary>
    public static async Task<SheetApplied> ApplyAsync(SheetSpec spec, List<SheetRowContext> rows, Func<SheetRowContext, Task<string?>> save)
    {
        int added = 0, updated = 0;
        var results = new List<SheetRow>();
        foreach (var row in rows)
        {
            var result = Result(spec, row);
            if (result.Result is "new" or "changed")
            {
                if (await save(row) is { } error) row.Errors.Add(error);
                else if (result.Result == "new") added++;
                else updated++;
            }
            results.Add(Result(spec, row) is { Result: "error" } failed ? failed : result);
        }
        var failedRows = results.Count(r => r.Result == "error");
        var message = added + updated == 0
            ? (failedRows == 0 ? "Nothing to change: the master already has these rows." : "Nothing was saved: every changed row has errors.")
            : $"{added} added, {updated} updated" + (failedRows == 0 ? "." : $"; {failedRows} row(s) with errors skipped.");
        return new SheetApplied(message, added, updated, failedRows, results);
    }

    /// <summary>The problem title of a refused add / update action (its 400), or a short reason for another refusal.</summary>
    public static string? Refusal(IActionResult? result) => result switch
    {
        null => null,
        ObjectResult { Value: ProblemDetails p, StatusCode: >= 400 } => p.Title ?? "It could not be saved.",
        ObjectResult { StatusCode: >= 400 } or StatusCodeResult { StatusCode: >= 400 } => "It could not be saved (it may have been changed meanwhile).",
        _ => null,
    };

    /// <summary>Yes / No (any case; also Y, N, True, False, 1, 0) as stored; null for anything else. Empty = <paramref name="empty"/>.</summary>
    public static string? YesNo(string value, string? empty = "No") => value.ToLowerInvariant() switch
    {
        "" => empty,
        "yes" or "y" or "true" or "1" => "Yes",
        "no" or "n" or "false" or "0" => "No",
        _ => null,
    };

    /// <summary>Active / Inactive (any case); empty = Active.</summary>
    public static string? Status(string value) => value.ToLowerInvariant() switch
    {
        "" or "active" or "yes" => "Active",
        "inactive" or "no" => "Inactive",
        _ => null,
    };

    /// <summary>A comma list of codes, trimmed, without repeats and sorted ("10, 13"), as written by the export.</summary>
    public static List<string> Codes(string value) =>
        value.Split([',', ';'], StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
            .Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(c => c, CodeOrder.Instance).ToList();

    public static string CodeList(IEnumerable<string> codes) => string.Join(", ", codes.OrderBy(c => c, CodeOrder.Instance));

    private static SheetRow Result(SheetSpec spec, SheetRowContext row)
    {
        if (row.Errors.Count > 0) return new SheetRow(row.Row, row.Cells, "error", [], row.Current, row.Errors.Distinct().ToList(), row.Notes);
        if (row.Current is null) return new SheetRow(row.Row, row.Cells, "new", [], null, [], row.Notes);
        var changed = spec.Columns.Where((_, i) => i >= spec.KeyColumns && !string.Equals(row.Cells[i], row.Current[i], StringComparison.Ordinal))
            .Select(c => c.Name).ToList();
        return new SheetRow(row.Row, row.Cells, changed.Count == 0 ? "same" : "changed", changed, row.Current, [], row.Notes);
    }

    private static string Key(SheetSpec spec, IReadOnlyList<string?> cells) =>
        string.Join("\u001f", Enumerable.Range(0, spec.KeyColumns).Select(i => (cells[i] ?? "").Trim()));

    private static string KeyName(SheetSpec spec) =>
        spec.KeyColumns == 1 ? spec.Columns[0].Name : string.Join(" + ", spec.Columns.Take(spec.KeyColumns).Select(c => c.Name));

    private static string Header(string? value) => new string((value ?? "").Where(char.IsLetterOrDigit).ToArray()).ToLowerInvariant();

    /// <summary>
    /// The cell as text: trimmed, inner line breaks kept, and the apostrophe the export puts before = + - @ (so that
    /// Excel does not read a formula) removed again.
    /// </summary>
    private static string Clean(string? value)
    {
        var v = (value ?? "").Trim();
        return v.Length > 1 && v[0] == '\'' && v[1] is '=' or '+' or '-' or '@' ? v[1..] : v;
    }

    /// <summary>Numeric codes in number order (2 before 10), others after them as text.</summary>
    private sealed class CodeOrder : IComparer<string>
    {
        public static readonly CodeOrder Instance = new();

        public int Compare(string? x, string? y)
        {
            var nx = long.TryParse(x, NumberStyles.None, CultureInfo.InvariantCulture, out var a);
            var ny = long.TryParse(y, NumberStyles.None, CultureInfo.InvariantCulture, out var b);
            if (nx && ny) return a.CompareTo(b) is var c && c != 0 ? c : string.CompareOrdinal(x, y);
            if (nx != ny) return nx ? -1 : 1;
            return string.Compare(x, y, StringComparison.OrdinalIgnoreCase);
        }
    }
}
