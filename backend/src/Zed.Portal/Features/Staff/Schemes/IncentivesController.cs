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
/// OLE DB driver (.xls only) and returned exception text. Here the whole sheet is validated first, rows
/// are inserted only when every row is valid, and rows already uploaded are skipped.
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
        return sets[0].Select(r => SchemeRows.Pick(r, SubmissionColumns)).ToList();
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

    public sealed record RowError(int Row, string Column, string Message);

    public sealed record SkippedRow(int Row, string? UdyamNo, DateTime? UploadedOn);

    /// <summary>Rows = the rows saved by this upload; Skipped = rows that were already in ApiIncentives.</summary>
    public sealed record UploadResponse(string Message, int Inserted, IReadOnlyList<Dictionary<string, string?>> Rows, IReadOnlyList<SkippedRow> Skipped);

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

    /// <summary>POST api/staff/schemes/incentives/upload (multipart "file", .xlsx) — SP_API_SUBMIT_INCENTIVE_DETAILS_FROM_EXCEL per row.</summary>
    [HttpPost("upload")]
    [StaffRoles(UserRole.MasterAdmin)]
    [RequestSizeLimit(MaxUploadBytes + 64 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = MaxUploadBytes + 64 * 1024)]
    public async Task<ActionResult<UploadResponse>> Upload(IFormFile? file, CancellationToken ct)
    {
        if (file is null || file.Length == 0) return this.Problem400("Please choose the incentives Excel file.");
        if (file.Length > MaxUploadBytes) return this.Problem400("The file is larger than 5 MB.");
        if (!string.Equals(Path.GetExtension(file.FileName), ".xlsx", StringComparison.OrdinalIgnoreCase))
            return this.Problem400("Upload valid excel file (accepted format: .xlsx). Save an .xls file as .xlsx first.");

        await using var buffer = new MemoryStream();
        await file.CopyToAsync(buffer, ct);
        buffer.Position = 0;

        IReadOnlyList<string?[]> sheet;
        try { sheet = XlsxSheetReader.ReadFirstSheet(buffer); }
        catch (XlsxFormatException ex) { return this.Problem400(ex.Message); }

        var (rows, sheetRows, errors) = Validate(sheet);
        if (errors.Count > 0)
        {
            var problem = new ProblemDetails
            {
                Status = StatusCodes.Status400BadRequest,
                Title = errors.Count == 1 && errors[0].Row == 0 ? errors[0].Message : "The file has errors; nothing was uploaded. Please correct them and upload again.",
            };
            problem.Extensions["rowErrors"] = errors.Take(100).ToList();
            return BadRequest(problem);
        }

        // Keep the uploaded workbook, as the legacy page did (~/Excels), under a server-generated name.
        var saved = MsmeFilePathsResolve($"Excels/{DateTime.Now:yyyyMMddHHmmss}_{Guid.NewGuid():N}.xlsx");
        if (saved is not null)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(saved)!);
            buffer.Position = 0;
            await using var fs = System.IO.File.Create(saved);
            await buffer.CopyToAsync(fs, ct);
        }

        await UploadLock.WaitAsync(ct);
        try
        {
            var duplicates = await ExistingRowsAsync(rows, sheetRows, ct);
            var skipped = new List<SkippedRow>();
            var savedRows = new List<Dictionary<string, string?>>();
            for (var i = 0; i < rows.Count; i++)
            {
                if (duplicates.TryGetValue(sheetRows[i], out var firstUploaded))
                {
                    skipped.Add(new SkippedRow(sheetRows[i], rows[i]["UdyamNo"], firstUploaded));
                    continue;
                }
                try
                {
                    await db.ExecuteProcAsync("SP_API_SUBMIT_INCENTIVE_DETAILS_FROM_EXCEL", new Dapper.DynamicParameters(rows[i].ToDictionary(k => k.Key, k => (object?)k.Value)), ct);
                    savedRows.Add(rows[i]);
                }
                catch (DbException ex)
                {
                    log.LogError(ex, "Incentive upload by {UserId} stopped at row {Row} after {Inserted} rows", UserId, sheetRows[i], savedRows.Count);
                    return this.Problem400($"The upload stopped at row {sheetRows[i]}: {savedRows.Count} row(s) were saved. Upload the same file again to save the rest; rows already saved are skipped.");
                }
            }
            log.LogInformation("Incentive upload by {UserId}: {Inserted} rows from {File}, {Skipped} already uploaded", UserId, savedRows.Count, saved, skipped.Count);
            var message = savedRows.Count == 0
                ? $"Nothing new to upload: all {skipped.Count} row(s) were uploaded before."
                : skipped.Count == 0
                    ? "Incentives Uploaded successfully."
                    : $"Incentives Uploaded successfully. {skipped.Count} row(s) were uploaded before and were skipped.";
            return new UploadResponse(message, savedRows.Count, savedRows, skipped);
        }
        finally
        {
            UploadLock.Release();
        }
    }

    /// <summary>Sheet row number to first upload date, for file rows already in ApiIncentives.</summary>
    private async Task<Dictionary<int, DateTime?>> ExistingRowsAsync(List<Dictionary<string, string?>> rows, List<int> sheetRows, CancellationToken ct)
    {
        var keys = rows.Select((r, i) => new Dictionary<string, object?>
        {
            ["r"] = sheetRows[i],
            ["u"] = r["UdyamNo"],
            ["a"] = r["ApplicationId"],
            ["p"] = r["ApprovalId"],
            ["n"] = r["IncentiveName"],
            // Validate() normalised these to yyyyMMdd and 0.00.
            ["d"] = r["DisbursedDate"] is { } d ? $"{d[..4]}-{d[4..6]}-{d[6..]}" : null,
            ["m"] = r["DisbursedAmount"],
        });
        var json = System.Text.Json.JsonSerializer.Serialize(keys);
        var found = await db.QuerySqlAsync<DuplicateRow>(DuplicateSql, new { Rows = new Dapper.DbString { Value = json, IsAnsi = false, Length = -1 } }, ct);
        return found.ToDictionary(f => f.RowNo, f => f.FirstUploaded);
    }

    /// <summary>
    /// Checks every cell: header names, required Udyam number, lengths of the procedure's parameters, PIN,
    /// amount and date formats, the portal's unsafe-input rule (fn_IsSafeInput) and spreadsheet formula
    /// prefixes (= + - @), and duplicate rows within the file. Rows already in the database are found
    /// separately (<see cref="DuplicateSql"/>) and skipped, so the same file can be uploaded again safely.
    /// </summary>
    public static (List<Dictionary<string, string?>> Rows, List<int> SheetRows, List<RowError> Errors) Validate(IReadOnlyList<string?[]> sheet)
    {
        var rows = new List<Dictionary<string, string?>>();
        var sheetRows = new List<int>();
        var errors = new List<RowError>();
        if (sheet.Count < 2)
        {
            errors.Add(new RowError(0, "", "No data in excel."));
            return (rows, sheetRows, errors);
        }

        var header = sheet[0];
        var index = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i < header.Length; i++)
            if (header[i]?.Trim() is { Length: > 0 } h && !index.TryAdd(h, i))
                errors.Add(new RowError(1, h, "Duplicate column."));
        var missing = Columns.Where(c => !index.ContainsKey(c.Name)).Select(c => c.Name).ToList();
        if (missing.Count > 0)
        {
            errors.Add(new RowError(0, "", "Please upload valid excel (columns: " + string.Join(", ", Columns.Select(c => c.Name)) + "). Missing: " + string.Join(", ", missing) + "."));
            return (rows, sheetRows, errors);
        }

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (var r = 1; r < sheet.Count; r++)
        {
            var cells = sheet[r];
            if (Columns.All(c => string.IsNullOrWhiteSpace(cells[index[c.Name]]))) continue; // blank line
            if (rows.Count >= MaxDataRows) { errors.Add(new RowError(r + 1, "", $"At most {MaxDataRows} rows can be uploaded at once.")); break; }

            var values = new Dictionary<string, string?>();
            foreach (var (name, max, kind) in Columns)
            {
                var raw = cells[index[name]]?.Trim();
                var (value, error) = Cell(raw, max, kind);
                if (error is not null) errors.Add(new RowError(r + 1, name, error));
                values[name] = value;
            }
            var key = string.Join("|", values["UdyamNo"], values["ApplicationId"], values["ApprovalId"], values["IncentiveName"], values["DisbursedDate"], values["DisbursedAmount"]);
            if (!seen.Add(key)) errors.Add(new RowError(r + 1, "", "Duplicate of an earlier row."));
            rows.Add(values);
            sheetRows.Add(r + 1);
            if (errors.Count >= 100) break;
        }
        if (rows.Count == 0 && errors.Count == 0) errors.Add(new RowError(0, "", "No data in excel."));
        return (rows, sheetRows, errors);
    }

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
