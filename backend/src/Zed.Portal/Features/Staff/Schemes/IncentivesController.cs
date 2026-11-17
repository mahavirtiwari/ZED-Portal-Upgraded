using System.Data.Common;
using System.Globalization;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Schemes;

/// <summary>
/// Incentives disbursed to ZED-certified units by other schemes (ApiIncentives) and the technology
/// upgradation reimbursements of ZED_CONSULTANT (SP_GET_API_INCENTIVES reads both, the latter through
/// three-part names). Port of IncentiveController.Submissions (SuperAdmin, Views/Incentive/Submissions)
/// and UploadIncentives (MasterAdmin, Views/Incentive/UploadIncentives).
/// <para>
/// The legacy upload never stored anything: SaveParticipantsFromExcel returned as soon as the validation
/// found no error (the test was inverted) and otherwise inserted every row; and the validation procedure
/// reports failures as Status 1 while the code tested for 0. It also read the workbook through the Jet
/// OLE DB driver (.xls only) and returned exception text. Here the whole sheet is validated first and rows
/// already uploaded are skipped. 2026-11-17 (approved): the upload is two steps, check (nothing is saved: the valid rows and
/// the errors by row) and apply (the file is checked again and its valid rows are saved; rows with errors are not).
/// </para>
/// </summary>
[Route("api/staff/schemes/incentives")]
public sealed partial class IncentivesController(
    ISqlExecutor db,
    IWebHostEnvironment env,
    IOptions<PortalOptions> portal,
    ILogger<IncentivesController> log) : StaffApiController
{
    public const long MaxUploadBytes = 5 * 1024 * 1024;
    public const int MaxDataRows = 5000;

    public static readonly string[] SubmissionColumns =
    [
        "PUnitName", "PStateName", "UnitAddress", "EnterpriseTypee", "Certification", "UdyamNo", "Certificateno", "ApplicationId",
        "UnitName", "District", "ServiceName", "IncentiveName", "AppliedDate", "ApprovalId", "ApprovedDate", "DisbursedDate",
        "DisbursedAmount", "Gender", "DataFrom",
    ];

    private static readonly string[] Genders = ["male", "female", "Others"];
    private static readonly string[] Sizes = ["Micro", "Small", "Medium"];

    /// <summary>GET api/staff/schemes/incentives/submissions?state=&amp;certification=&amp;msmeSize=&amp;gender=&amp;sector=</summary>
    [HttpGet("submissions")]
    [StaffRoles(UserRole.SuperAdmin)]
    public async Task<ActionResult<IReadOnlyList<Dictionary<string, object?>>>> Submissions(
        [FromQuery] int? state, [FromQuery] string? certification, [FromQuery] string? msmeSize, [FromQuery] string? gender,
        [FromQuery] string? sector, CancellationToken ct)
    {
        if (state is < 1 or > 99) return this.Problem400("Invalid state.");
        string? cert = null, size = null, sex = null;
        if (!string.IsNullOrEmpty(certification) && (cert = FaApplications.Canonical(certification)) is null) return this.Problem400("Invalid certification.");
        if (!string.IsNullOrEmpty(msmeSize) && (size = Sizes.FirstOrDefault(s => s.Equals(msmeSize, StringComparison.OrdinalIgnoreCase))) is null) return this.Problem400("Invalid MSME size.");
        if (!string.IsNullOrEmpty(gender) && (sex = Genders.FirstOrDefault(s => s.Equals(gender, StringComparison.OrdinalIgnoreCase))) is null) return this.Problem400("Invalid gender.");
        if (!string.IsNullOrEmpty(sector) && !TwoDigits().IsMatch(sector)) return this.Problem400("Invalid sector.");

        var sets = await db.QueryProcMultipleAsync("SP_GET_API_INCENTIVES", new
        {
            UdyamNo = (string?)null, CertificateNo = (string?)null,
            State = state?.ToString(CultureInfo.InvariantCulture), CertificationType = cert, MsmeSize = size,
            Sector = string.IsNullOrEmpty(sector) ? null : sector, Gender = sex,
        }, ct);
        // A scoped login: its units only (2026-11-08).
        return (await Users.ScopeFilter.ApplyAsync(HttpContext, sets[0], ct)).Select(r => SchemeRows.Pick(r, SubmissionColumns)).ToList();
    }

    // ----- upload -----

    /// <summary>The 15 columns of Templates/IncentiveTemplate.xls, matched by header name.</summary>
    public static readonly (string Name, int Max, IncentiveField Kind)[] Columns =
    [
        ("UdyamNo", 50, IncentiveField.Udyam), ("Certificateno", 50, IncentiveField.Text), ("Pin", 50, IncentiveField.Pin),
        ("ApplicationId", 50, IncentiveField.Text), ("UnitName", 200, IncentiveField.Text), ("District", 50, IncentiveField.Text),
        ("FCI", 50, IncentiveField.Text), ("ServiceName", 200, IncentiveField.Text), ("ApprovalId", 50, IncentiveField.Text),
        ("IncentiveName", 2000, IncentiveField.Text), ("DisbursedAmount", 18, IncentiveField.Amount), ("DisbursedDate", 0, IncentiveField.Date),
        ("DateOfProduction", 0, IncentiveField.Date), ("AppliedDate", 0, IncentiveField.Date), ("ApprovedDate", 0, IncentiveField.Date),
    ];

    public enum IncentiveField { Text, Udyam, Pin, Amount, Date }

    /// <summary>An error of a cell (or of the row, Column ""); Value = the cell as written.</summary>
    public sealed record RowError(int Row, string Column, string Message)
    {
        public string? Value { get; init; }
    }

    public sealed record SkippedRow(int Row, string? UdyamNo, DateTime? UploadedOn);

    /// <summary>A row with errors: its cells as written (in <see cref="Columns"/> order) and its problems, for the download.</summary>
    public sealed record RejectedRow(int Row, IReadOnlyList<string?> Cells, string Problems);

    /// <summary>
    /// The check of a workbook: Total rows read, Valid rows ready to save, AlreadyUploaded rows (skipped on save), Invalid rows
    /// (with errors). Errors lists at most <see cref="MaxListedErrors"/> of the ErrorCount errors; Rejected has every invalid row.
    /// </summary>
    public sealed record CheckResponse(
        string FileName, int Total, int Valid, int AlreadyUploaded, int Invalid, IReadOnlyList<RowError> Errors, int ErrorCount,
        IReadOnlyList<RejectedRow> Rejected, IReadOnlyList<SkippedRow> Skipped, IReadOnlyList<string> Columns);

    /// <summary>Rows = the rows saved; Skipped = valid rows already in ApiIncentives; Rejected = rows with errors, not saved.</summary>
    public sealed record UploadResponse(string Message, int Inserted, IReadOnlyList<Dictionary<string, string?>> Rows, IReadOnlyList<SkippedRow> Skipped)
    {
        public int Rejected { get; init; }
    }

    /// <summary>
    /// File rows that match an existing ApiIncentives row (uploaded before, or sent by the scheme API): same
    /// Udyam number, application id, approval id, incentive, disbursed date and amount (blank = blank).
    /// </summary>
    internal const string DuplicateSql = """
        SELECT j.RowNo, MIN(a.CreatedDate) AS FirstUploaded
        FROM OPENJSON(@Rows) WITH (
            RowNo int '$.r', UdyamNo varchar(50) '$.u', ApplicationId varchar(50) '$.a', ApprovalId varchar(50) '$.p',
            IncentiveName varchar(2000) '$.n', DisbursedDate date '$.d', DisbursedAmount decimal(18,2) '$.m') j
        JOIN dbo.ApiIncentives a ON a.UdyamNo = j.UdyamNo
         AND ISNULL(a.ApplicationId, '') = ISNULL(j.ApplicationId, '')
         AND ISNULL(a.ApprovalId, '') = ISNULL(j.ApprovalId, '')
         AND ISNULL(a.IncentiveName, '') = ISNULL(j.IncentiveName, '')
         AND ((a.DisbursedDate IS NULL AND j.DisbursedDate IS NULL) OR CAST(a.DisbursedDate AS date) = j.DisbursedDate)
         AND ((a.DisbursedAmount IS NULL AND j.DisbursedAmount IS NULL) OR a.DisbursedAmount = j.DisbursedAmount)
        GROUP BY j.RowNo
        """;

    internal sealed record DuplicateRow(int RowNo, DateTime? FirstUploaded);

    // Check-then-insert must not interleave between two uploads of the same file (single server).
    private static readonly SemaphoreSlim UploadLock = new(1, 1);

    /// <summary>
    /// POST api/staff/schemes/incentives/upload/check (multipart "file", .xlsx) — 2026-11-17 (approved): checks every row and
    /// saves nothing. Answers the rows read, the rows ready to save, the rows uploaded before (skipped on save) and the rows with
    /// errors (row, column, value, problem), with the cells of the rejected rows so the page can offer them as a download.
    /// A file that cannot be read at all (not .xlsx, columns missing, no data, too many rows) is refused (400).
    /// </summary>
    [HttpPost("upload/check")]
    [StaffRoles(UserRole.MasterAdmin)]
    [RequestSizeLimit(MaxUploadBytes + 64 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = MaxUploadBytes + 64 * 1024)]
    public async Task<ActionResult<CheckResponse>> CheckUpload(IFormFile? file, CancellationToken ct)
    {
        var (read, refused) = await ReadAsync(file, ct);
        if (refused is not null) return refused;
        var sheet = read!.Sheet;
        var valid = sheet.Rows.Where(r => r.Valid).ToList();
        var duplicates = await ExistingRowsAsync(valid, ct);
        var invalid = sheet.Rows.Where(r => !r.Valid).ToList();
        var errors = invalid.SelectMany(r => r.Errors).ToList();
        return new CheckResponse(
            Path.GetFileName(file!.FileName), sheet.Rows.Count, valid.Count - duplicates.Count, duplicates.Count, invalid.Count,
            errors.Take(MaxListedErrors).ToList(), errors.Count,
            invalid.Select(r => new RejectedRow(r.SheetRow, r.Cells, string.Join(" ", r.Errors.Select(e => Problem(e))))).ToList(),
            valid.Where(r => duplicates.ContainsKey(r.SheetRow)).Select(r => new SkippedRow(r.SheetRow, r.Values["UdyamNo"], duplicates[r.SheetRow])).ToList(),
            Columns.Select(c => c.Name).ToList());
    }

    /// <summary>
    /// POST api/staff/schemes/incentives/upload/apply (multipart "file", the same workbook) — 2026-11-17 (approved): checks the
    /// file again (the check the page showed is not trusted) and saves the valid rows, SP_API_SUBMIT_INCENTIVE_DETAILS_FROM_EXCEL
    /// per row. Rows with errors are not saved; rows already uploaded are skipped. Refused when no row is valid.
    /// </summary>
    [HttpPost("upload/apply")]
    [StaffRoles(UserRole.MasterAdmin)]
    [RequestSizeLimit(MaxUploadBytes + 64 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = MaxUploadBytes + 64 * 1024)]
    public async Task<ActionResult<UploadResponse>> ApplyUpload(IFormFile? file, CancellationToken ct)
    {
        var (read, refused) = await ReadAsync(file, ct);
        if (refused is not null) return refused;
        var sheet = read!.Sheet;
        var valid = sheet.Rows.Where(r => r.Valid).ToList();
        var rejected = sheet.Rows.Count - valid.Count;
        if (valid.Count == 0) return this.Problem400("No row can be saved: every row has errors. Please correct them and upload again.");

        // Keep the uploaded workbook, as the legacy page did (~/Excels), under a server-generated name.
        var saved = MsmeFilePathsResolve($"Excels/{DateTime.Now:yyyyMMddHHmmss}_{Guid.NewGuid():N}.xlsx");
        if (saved is not null)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(saved)!);
            read.Buffer.Position = 0;
            await using var fs = System.IO.File.Create(saved);
            await read.Buffer.CopyToAsync(fs, ct);
        }

        await UploadLock.WaitAsync(ct);
        try
        {
            var duplicates = await ExistingRowsAsync(valid, ct);
            var skipped = new List<SkippedRow>();
            var savedRows = new List<Dictionary<string, string?>>();
            foreach (var row in valid)
            {
                if (duplicates.TryGetValue(row.SheetRow, out var firstUploaded))
                {
                    skipped.Add(new SkippedRow(row.SheetRow, row.Values["UdyamNo"], firstUploaded));
                    continue;
                }
                try
                {
                    await db.ExecuteProcAsync("SP_API_SUBMIT_INCENTIVE_DETAILS_FROM_EXCEL", new Dapper.DynamicParameters(row.Values.ToDictionary(k => k.Key, k => (object?)k.Value)), ct);
                    savedRows.Add(row.Values);
                }
                catch (DbException ex)
                {
                    log.LogError(ex, "Incentive upload by {UserId} stopped at row {Row} after {Inserted} rows", UserId, row.SheetRow, savedRows.Count);
                    return this.Problem400($"The upload stopped at row {row.SheetRow}: {savedRows.Count} row(s) were saved. Upload the same file again to save the rest; rows already saved are skipped.");
                }
            }
            log.LogInformation("Incentive upload by {UserId}: {Inserted} rows from {File}, {Skipped} already uploaded, {Rejected} with errors",
                UserId, savedRows.Count, saved, skipped.Count, rejected);
            var parts = new List<string>();
            if (rejected > 0) parts.Add($"{rejected} row(s) with errors were not saved.");
            if (skipped.Count > 0) parts.Add($"{skipped.Count} row(s) were uploaded before and were skipped.");
            var message = savedRows.Count == 0
                ? $"Nothing new to upload: all {skipped.Count} valid row(s) were uploaded before."
                : string.Join(" ", new[] { $"{savedRows.Count} row(s) saved." }.Concat(parts));
            return new UploadResponse(message, savedRows.Count, savedRows, skipped) { Rejected = rejected };
        }
        finally
        {
            UploadLock.Release();
        }
    }

    /// <summary>At most this many errors are listed in a check (every rejected row is still counted and offered as a download).</summary>
    public const int MaxListedErrors = 2000;

    private sealed record ReadSheet(MemoryStream Buffer, SheetCheck Sheet);

    /// <summary>The file checks of both steps: size, .xlsx, readable, the columns, the number of rows.</summary>
    private async Task<(ReadSheet? Read, ActionResult? Refused)> ReadAsync(IFormFile? file, CancellationToken ct)
    {
        if (file is null || file.Length == 0) return (null, this.Problem400("Please choose the incentives Excel file."));
        if (file.Length > MaxUploadBytes) return (null, this.Problem400("The file is larger than 5 MB."));
        if (!string.Equals(Path.GetExtension(file.FileName), ".xlsx", StringComparison.OrdinalIgnoreCase))
            return (null, this.Problem400("Upload valid excel file (accepted format: .xlsx). Save an .xls file as .xlsx first."));

        var buffer = new MemoryStream();
        await file.CopyToAsync(buffer, ct);
        buffer.Position = 0;

        IReadOnlyList<string?[]> cells;
        try { cells = XlsxSheetReader.ReadFirstSheet(buffer); }
        catch (XlsxFormatException ex) { return (null, this.Problem400(ex.Message)); }

        var sheet = Check(cells);
        return sheet.FileError is { } error ? (null, this.Problem400(error)) : (new ReadSheet(buffer, sheet), null);
    }

    private static string Problem(RowError e) => e.Column.Length > 0 ? $"{e.Column}: {e.Message}" : e.Message;

    /// <summary>Sheet row number to first upload date, for valid file rows already in ApiIncentives.</summary>
    private async Task<Dictionary<int, DateTime?>> ExistingRowsAsync(IReadOnlyList<CheckedRow> rows, CancellationToken ct)
    {
        if (rows.Count == 0) return [];
        var keys = rows.Select(r => new Dictionary<string, object?>
        {
            ["r"] = r.SheetRow,
            ["u"] = r.Values["UdyamNo"],
            ["a"] = r.Values["ApplicationId"],
            ["p"] = r.Values["ApprovalId"],
            ["n"] = r.Values["IncentiveName"],
            // Check() normalised these to yyyyMMdd and 0.00.
            ["d"] = r.Values["DisbursedDate"] is { } d ? $"{d[..4]}-{d[4..6]}-{d[6..]}" : null,
            ["m"] = r.Values["DisbursedAmount"],
        });
        var json = System.Text.Json.JsonSerializer.Serialize(keys);
        var found = await db.QuerySqlAsync<DuplicateRow>(DuplicateSql, new { Rows = new Dapper.DbString { Value = json, IsAnsi = false, Length = -1 } }, ct);
        return found.ToDictionary(f => f.RowNo, f => f.FirstUploaded);
    }

    /// <summary>One data row of the sheet: its values (normalised), its cells as written, and its errors (none = valid).</summary>
    public sealed record CheckedRow(int SheetRow, Dictionary<string, string?> Values, IReadOnlyList<string?> Cells, List<RowError> Errors)
    {
        public bool Valid => Errors.Count == 0;
    }

    /// <summary>The file's refusal (columns missing, no data, too many rows), or its data rows.</summary>
    public sealed record SheetCheck(string? FileError, List<CheckedRow> Rows);

    /// <summary>
    /// Checks every cell: header names, required Udyam number, lengths of the procedure's parameters, PIN,
    /// amount and date formats, the portal's unsafe-input rule (fn_IsSafeInput) and spreadsheet formula
    /// prefixes (= + - @), and duplicate rows within the file. Each row is valid or has its errors; a row with an error is
    /// not saved. Rows already in the database are found separately (<see cref="DuplicateSql"/>) and skipped, so the same file
    /// can be uploaded again safely.
    /// </summary>
    public static SheetCheck Check(IReadOnlyList<string?[]> sheet)
    {
        var rows = new List<CheckedRow>();
        if (sheet.Count < 2) return new SheetCheck("No data in excel.", rows);

        var header = sheet[0];
        var index = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i < header.Length; i++)
            if (header[i]?.Trim() is { Length: > 0 } h && !index.TryAdd(h, i))
                return new SheetCheck($"Please upload valid excel: the column {h} appears twice.", rows);
        var missing = Columns.Where(c => !index.ContainsKey(c.Name)).Select(c => c.Name).ToList();
        if (missing.Count > 0)
            return new SheetCheck("Please upload valid excel (columns: " + string.Join(", ", Columns.Select(c => c.Name)) + "). Missing: " + string.Join(", ", missing) + ".", rows);

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (var r = 1; r < sheet.Count; r++)
        {
            var cells = sheet[r];
            if (Columns.All(c => string.IsNullOrWhiteSpace(cells[index[c.Name]]))) continue; // blank line
            if (rows.Count >= MaxDataRows) return new SheetCheck($"At most {MaxDataRows} rows can be uploaded at once.", []);

            var values = new Dictionary<string, string?>();
            var written = new string?[Columns.Length];
            var errors = new List<RowError>();
            for (var c = 0; c < Columns.Length; c++)
            {
                var (name, max, kind) = Columns[c];
                var raw = cells[index[name]]?.Trim();
                written[c] = raw;
                var (value, error) = Cell(raw, max, kind);
                if (error is not null) errors.Add(new RowError(r + 1, name, error) { Value = Shown(raw) });
                values[name] = value;
            }
            var key = string.Join("|", values["UdyamNo"], values["ApplicationId"], values["ApprovalId"], values["IncentiveName"], values["DisbursedDate"], values["DisbursedAmount"]);
            if (!seen.Add(key)) errors.Add(new RowError(r + 1, "", "Duplicate of an earlier row."));
            rows.Add(new CheckedRow(r + 1, values, written, errors));
        }
        return rows.Count == 0 ? new SheetCheck("No data in excel.", rows) : new SheetCheck(null, rows);
    }

    /// <summary>The cell as shown beside its error (cut to 100 characters).</summary>
    private static string? Shown(string? raw) => raw is { Length: > 100 } ? raw[..100] + "…" : raw;

    private static (string? Value, string? Error) Cell(string? raw, int max, IncentiveField kind)
    {
        if (string.IsNullOrEmpty(raw)) return kind == IncentiveField.Udyam ? (null, "Udyam number is required.") : (null, null);
        switch (kind)
        {
            case IncentiveField.Udyam:
                var udyam = raw.ToUpperInvariant();
                return Udyam().IsMatch(udyam) ? (udyam, null) : (null, "Invalid Udyam number (UDYAM-XX-00-0000000).");
            case IncentiveField.Pin:
                return Pin().IsMatch(raw) ? (raw, null) : (null, "Invalid PIN code (6 digits).");
            case IncentiveField.Amount:
                return decimal.TryParse(raw, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var amount) && amount <= 999_999_999_999m
                    ? (decimal.Round(amount, 2).ToString("0.00", CultureInfo.InvariantCulture), null)
                    : (null, "Invalid amount.");
            case IncentiveField.Date:
                return ParseDate(raw) is { } date ? (date.ToString("yyyyMMdd", CultureInfo.InvariantCulture), null) : (null, "Invalid date (dd-mm-yyyy).");
            default:
                if (raw.Length > max) return (null, $"Longer than {max} characters.");
                if (!IsSafe(raw)) return (null, "Contains characters or words that are not allowed.");
                return (raw, null);
        }
    }

    /// <summary>Excel serial number (the workbook stores dates as numbers) or dd-MM-yyyy / dd/MM/yyyy / yyyy-MM-dd text.</summary>
    public static DateOnly? ParseDate(string raw)
    {
        DateOnly d;
        if (double.TryParse(raw, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var serial))
        {
            if (serial is < 1 or > 2958465) return null;
            d = DateOnly.FromDateTime(DateTime.FromOADate(Math.Floor(serial)));
        }
        else if (!DateOnly.TryParseExact(raw, ["dd-MM-yyyy", "dd/MM/yyyy", "d-M-yyyy", "d/M/yyyy", "yyyy-MM-dd", "dd-MMM-yyyy"], CultureInfo.InvariantCulture, DateTimeStyles.None, out d))
            return null;
        return d.Year is >= 1950 and <= 2100 ? d : null;
    }

    /// <summary>fn_IsSafeInput, plus spreadsheet formula prefixes so the values cannot run as formulas when exported.</summary>
    public static bool IsSafe(string value)
    {
        if (value[0] is '=' or '+' or '-' or '@' or '\t' or '\r') return false;
        if (value.Any(c => char.IsControl(c) && c is not '\n')) return false;
        string[] banned = ["<", ">", "script", "onerror=", "onload=", "onclick=", "javascript:", "vbscript:", "eval(", "alert(", "{{", "}}"];
        return !banned.Any(b => value.Contains(b, StringComparison.OrdinalIgnoreCase));
    }

    private string? MsmeFilePathsResolve(string relative) =>
        Zed.Portal.Features.Msme.MsmeFilePaths.Resolve(Path.GetFullPath(Path.Combine(env.ContentRootPath, portal.Value.StorageRoot)), relative);

    [GeneratedRegex(@"^\d{2}$")]
    private static partial Regex TwoDigits();

    [GeneratedRegex(@"^UDYAM-[A-Z]{2}-\d{2}-\d{7}$")]
    private static partial Regex Udyam();

    [GeneratedRegex(@"^\d{6}$")]
    private static partial Regex Pin();
}
