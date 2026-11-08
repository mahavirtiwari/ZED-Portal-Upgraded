using System.Text;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.Schemes;

namespace Zed.Portal.Features.Staff.Masters;

/// <summary>
/// Admin → Masters → LG Directory (new in V4): brings the States and Districts masters up to date with the Local
/// Government Directory (lgdirectory.gov.in). LGD offers no open web service, so the Admin downloads its district list
/// ("Download Directory" → all districts of India, CSV or Excel: State Code, State Name (In English), District Code,
/// District Name (In English), ...) and uploads it here. The page shows the new states and districts, the renamed ones
/// and the active districts LGD no longer has; only the changes the Admin ticks are applied. Codes are LGD codes, as in
/// the masters (Msme.PLgDistrictCode). Names are kept in capitals, as stored. Main only.
/// </summary>
[Route("api/staff/masters/lgd")]
[StaffRoles(UserRole.Admin)]
[PortalSystems(PortalSystem.Main)]
public sealed class LgdDirectoryController(ISqlExecutor db, ILogger<LgdDirectoryController> log) : StaffApiController
{
    public const long MaxFileBytes = 5 * 1024 * 1024;

    public sealed record LgdDistrict(string StateCode, string StateName, string DistrictCode, string DistrictName);

    /// <param name="Kind">addState, renameState, addDistrict, renameDistrict or deactivateDistrict.</param>
    public sealed record Change(string Kind, string StateCode, string? StateName, string? DistrictCode, string? DistrictName, string? OldName);

    public sealed record PreviewResponse(int StatesInFile, int DistrictsInFile, IReadOnlyList<Change> Changes);

    public sealed record StateRow(string StateCode, string? StateName);

    public sealed record DistrictRow(string StateCode, string DistrictCode, string? DistrictName, bool? IsActive);

    internal const string StatesSql = "SELECT LTRIM(RTRIM(StateCode)) AS StateCode, StateName FROM dbo.States;";
    internal const string DistrictsSql = "SELECT LTRIM(RTRIM(StateCode)) AS StateCode, LTRIM(RTRIM(DistrictCode)) AS DistrictCode, DistrictName, IsActive FROM dbo.Districts;";

    /// <summary>The LGD district list's columns (V4 export and template): an exported file can be uploaded here again.</summary>
    internal static readonly SheetSpec Sheet = new("Districts", "lgd-districts",
    [
        new("State Code", "The LGD code of the state. Required."),
        new("State Name (In English)", "The state's name. Required."),
        new("District Code", "The LGD code of the district. Required."),
        new("District Name (In English)", "The district's name. Required."),
    ], 3, "Rows are matched by District Code. Upload the file here to see the new and renamed states and districts and the districts " +
        "no longer listed, then tick the changes to apply.");

    internal const string ExportSql =
        "SELECT LTRIM(RTRIM(d.DistrictCode)) AS DistrictCode, d.DistrictName, LTRIM(RTRIM(d.StateCode)) AS StateCode, " +
        "ISNULL((SELECT TOP 1 s.StateName FROM dbo.States s WHERE LTRIM(RTRIM(s.StateCode)) = LTRIM(RTRIM(d.StateCode))), d.StateName) AS StateName " +
        "FROM dbo.Districts d WHERE ISNULL(d.IsActive, 1) = 1;";

    public sealed record ExportRow(string StateCode, string? StateName, string DistrictCode, string? DistrictName);

    /// <summary>The active districts of the masters with their states, in the LGD file's columns (V4).</summary>
    [HttpGet("excel")]
    public async Task<FileContentResult> Excel(CancellationToken ct) =>
        MasterSheet.Export(Sheet, (await db.QuerySqlAsync<ExportRow>(ExportSql, null, ct))
            .OrderBy(r => r.StateName).ThenBy(r => r.DistrictName)
            .Select(r => new[] { r.StateCode, r.StateName, r.DistrictCode, r.DistrictName }));

    [HttpGet("excel/template")]
    public FileContentResult Template() => MasterSheet.Template(Sheet);

    /// <summary>Reads the LGD file and lists what differs from the masters (nothing is changed).</summary>
    [HttpPost("preview")]
    [RequestSizeLimit(MaxFileBytes + 64 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = MaxFileBytes + 64 * 1024)]
    public async Task<ActionResult<PreviewResponse>> Preview(IFormFile? file, CancellationToken ct)
    {
        if (file is null || file.Length == 0) return this.Problem400("Please choose the LGD district list (CSV or Excel).");
        if (file.Length > MaxFileBytes) return this.Problem400("The file is too large (up to 5 MB).");
        IReadOnlyList<string?[]> rows;
        try
        {
            await using var stream = file.OpenReadStream();
            rows = Path.GetExtension(file.FileName).Equals(".xlsx", StringComparison.OrdinalIgnoreCase)
                ? XlsxSheetReader.ReadFirstSheet(stream)
                : ReadCsv(stream);
        }
        catch (Exception ex) when (ex is XlsxFormatException or InvalidDataException or System.IO.InvalidDataException or System.Xml.XmlException)
        {
            return this.Problem400("The file could not be read. Please upload the CSV or Excel (.xlsx) district list of LGD.");
        }
        var (districts, error) = Parse(rows);
        if (error is not null) return this.Problem400(error);
        var changes = Compare(districts!, await db.QuerySqlAsync<StateRow>(StatesSql, null, ct), await db.QuerySqlAsync<DistrictRow>(DistrictsSql, null, ct));
        return new PreviewResponse(districts!.Select(d => d.StateCode).Distinct().Count(), districts!.Count, changes);
    }

    public sealed record ApplyRequest(IReadOnlyList<Change>? Changes);

    /// <summary>Applies the ticked changes; each is checked against the masters again (one already applied is skipped).</summary>
    [HttpPost("apply")]
    public async Task<ActionResult<MessageResponse>> Apply(ApplyRequest req, CancellationToken ct)
    {
        var changes = req.Changes ?? [];
        if (changes.Count == 0) return this.Problem400("Please tick the changes to apply.");
        if (changes.Count > 5000) return this.Problem400("Too many changes at once.");
        var states = (await db.QuerySqlAsync<StateRow>(StatesSql, null, ct)).ToDictionary(s => s.StateCode, StringComparer.Ordinal);
        var districts = (await db.QuerySqlAsync<DistrictRow>(DistrictsSql, null, ct)).GroupBy(d => d.DistrictCode).ToDictionary(g => g.Key, g => g.First(), StringComparer.Ordinal);
        var applied = 0;
        foreach (var c in changes)
        {
            if (Invalid(c) is { } invalid) return this.Problem400(invalid);
            var stateName = Upper(c.StateName);
            var districtName = Upper(c.DistrictName);
            switch (c.Kind)
            {
                case "addState" when !states.ContainsKey(c.StateCode):
                    await db.ExecuteSqlAsync("INSERT INTO dbo.States (StateCode, StateName, IsActive) VALUES (@StateCode, @StateName, 1);", new { c.StateCode, StateName = stateName }, ct);
                    states[c.StateCode] = new StateRow(c.StateCode, stateName);
                    break;
                case "renameState" when states.ContainsKey(c.StateCode):
                    await db.ExecuteSqlAsync("UPDATE dbo.States SET StateName = @StateName WHERE LTRIM(RTRIM(StateCode)) = @StateCode; " +
                        "UPDATE dbo.Districts SET StateName = @StateName WHERE LTRIM(RTRIM(StateCode)) = @StateCode;", new { c.StateCode, StateName = stateName }, ct);
                    break;
                case "addDistrict" when !districts.ContainsKey(c.DistrictCode!):
                    await db.ExecuteSqlAsync(
                        "INSERT INTO dbo.Districts (StateCode, StateName, DistrictCode, DistrictName, IsActive, IsAspirationalDt) VALUES (@StateCode, @StateName, @DistrictCode, @DistrictName, 1, 0);",
                        new { c.StateCode, StateName = states.GetValueOrDefault(c.StateCode)?.StateName ?? stateName, c.DistrictCode, DistrictName = districtName }, ct);
                    districts[c.DistrictCode!] = new DistrictRow(c.StateCode, c.DistrictCode!, districtName, true);
                    break;
                case "renameDistrict" when districts.ContainsKey(c.DistrictCode!):
                    await db.ExecuteSqlAsync("UPDATE dbo.Districts SET DistrictName = @DistrictName WHERE LTRIM(RTRIM(DistrictCode)) = @DistrictCode;",
                        new { c.DistrictCode, DistrictName = districtName }, ct);
                    break;
                case "deactivateDistrict" when districts.ContainsKey(c.DistrictCode!):
                    await db.ExecuteSqlAsync("UPDATE dbo.Districts SET IsActive = 0 WHERE LTRIM(RTRIM(DistrictCode)) = @DistrictCode;", new { c.DistrictCode }, ct);
                    break;
                default:
                    continue;
            }
            applied++;
            log.LogWarning("LGD {Kind} {State}/{District} '{Name}' applied by {Actor}", c.Kind, c.StateCode, c.DistrictCode, districtName ?? stateName, UserId);
        }
        if (applied == 0) return new MessageResponse("Nothing to change: the masters already have these.");
        // V4 one Admin: the Consultancy and Surveillance portals keep their own copy of the states and districts.
        var copied = await DistrictCopies.CopyAsync(db, log, ct);
        // The drop-downs and checks of this portal at once; the other portals read the copies within minutes.
        try { await StateMaster.RefreshAsync(db, ct); }
        catch (Exception ex) when (ex is not OperationCanceledException) { log.LogWarning(ex, "States not re-read after the LGD import"); }
        return new MessageResponse($"{applied} change(s) applied to the states and districts.{copied}");
    }

    private static string? Invalid(Change c)
    {
        string[] kinds = ["addState", "renameState", "addDistrict", "renameDistrict", "deactivateDistrict"];
        if (!kinds.Contains(c.Kind)) return "Unknown change.";
        if (!IsCode(c.StateCode)) return "Invalid state code.";
        var district = c.Kind.EndsWith("District", StringComparison.Ordinal);
        if (district && !IsCode(c.DistrictCode)) return "Invalid district code.";
        if (c.Kind is "addState" or "renameState" && !IsName(c.StateName)) return "Invalid state name.";
        if (c.Kind is "addDistrict" or "renameDistrict" && !IsName(c.DistrictName)) return "Invalid district name.";
        return null;
    }

    private static bool IsCode(string? v) => v is { Length: > 0 and <= 10 } && v.All(char.IsAsciiDigit);

    private static bool IsName(string? v) => v is { Length: > 0 } && v.Trim().Length is > 0 and <= 200 && !v.Any(char.IsControl);

    private static string? Upper(string? v) => v?.Trim().ToUpperInvariant();

    /// <summary>The district rows of the LGD file, found by their headers (any column order, extra columns ignored).</summary>
    public static (List<LgdDistrict>? Districts, string? Error) Parse(IReadOnlyList<string?[]> rows)
    {
        static string Norm(string? h) => new string((h ?? "").Where(char.IsLetter).ToArray()).ToLowerInvariant();
        for (var h = 0; h < Math.Min(rows.Count, 10); h++)
        {
            var header = rows[h].Select(Norm).ToList();
            var stateCode = header.IndexOf("statecode");
            var districtCode = header.IndexOf("districtcode");
            var stateName = header.FindIndex(x => x.StartsWith("statename", StringComparison.Ordinal) && !x.Contains("local", StringComparison.Ordinal));
            var districtName = header.FindIndex(x => x.StartsWith("districtname", StringComparison.Ordinal) && !x.Contains("local", StringComparison.Ordinal));
            if (stateCode < 0 || districtCode < 0 || stateName < 0 || districtName < 0) continue;
            var list = new List<LgdDistrict>();
            foreach (var row in rows.Skip(h + 1))
            {
                string Cell(int i) => i < row.Length ? (row[i] ?? "").Trim() : "";
                var sc = Cell(stateCode);
                var dc = Cell(districtCode);
                if (sc.Length == 0 && dc.Length == 0) continue;
                if (!IsCode(sc) || !IsCode(dc) || !IsName(Cell(stateName)) || !IsName(Cell(districtName)))
                    return (null, $"Row {list.Count + h + 2} of the file is not a valid district (state code, state name, district code, district name).");
                list.Add(new LgdDistrict(sc, Cell(stateName), dc, Cell(districtName)));
            }
            if (list.Count == 0) return (null, "The file has no districts.");
            if (list.GroupBy(d => d.DistrictCode).Any(g => g.Count() > 1)) return (null, "The file lists a district code twice.");
            return (list, null);
        }
        return (null, "This is not the LGD district list: the columns State Code, State Name, District Code and District Name were not found.");
    }

    /// <summary>New and renamed states and districts, and the active districts of the file's states that LGD no longer has.</summary>
    public static List<Change> Compare(IReadOnlyList<LgdDistrict> lgd, IReadOnlyList<StateRow> states, IReadOnlyList<DistrictRow> districts)
    {
        static bool SameName(string? a, string? b) =>
            string.Equals(string.Join(' ', (a ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries)), string.Join(' ', (b ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries)), StringComparison.OrdinalIgnoreCase);
        var changes = new List<Change>();
        var stateByCode = states.GroupBy(s => s.StateCode).ToDictionary(g => g.Key, g => g.First());
        foreach (var s in lgd.GroupBy(d => d.StateCode).Select(g => g.First()).OrderBy(s => s.StateName))
        {
            if (!stateByCode.TryGetValue(s.StateCode, out var current)) changes.Add(new Change("addState", s.StateCode, s.StateName, null, null, null));
            else if (!SameName(current.StateName, s.StateName)) changes.Add(new Change("renameState", s.StateCode, s.StateName, null, null, current.StateName));
        }
        var districtByCode = districts.GroupBy(d => d.DistrictCode).ToDictionary(g => g.Key, g => g.First());
        foreach (var d in lgd.OrderBy(d => d.StateName).ThenBy(d => d.DistrictName))
        {
            if (!districtByCode.TryGetValue(d.DistrictCode, out var current)) changes.Add(new Change("addDistrict", d.StateCode, d.StateName, d.DistrictCode, d.DistrictName, null));
            else if (!SameName(current.DistrictName, d.DistrictName)) changes.Add(new Change("renameDistrict", d.StateCode, d.StateName, d.DistrictCode, d.DistrictName, current.DistrictName));
        }
        var inFile = lgd.Select(d => d.DistrictCode).ToHashSet(StringComparer.Ordinal);
        var fileStates = lgd.Select(d => d.StateCode).ToHashSet(StringComparer.Ordinal);
        foreach (var d in districts.Where(d => d.IsActive != false && fileStates.Contains(d.StateCode) && !inFile.Contains(d.DistrictCode)).OrderBy(d => d.DistrictName))
            changes.Add(new Change("deactivateDistrict", d.StateCode, stateByCode.GetValueOrDefault(d.StateCode)?.StateName, d.DistrictCode, d.DistrictName, null));
        return changes;
    }

    /// <summary>A CSV file (comma-separated, double quotes around a field with commas, UTF-8 with or without BOM).</summary>
    public static IReadOnlyList<string?[]> ReadCsv(Stream stream)
    {
        using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
        var rows = new List<string?[]>();
        string? line;
        while ((line = reader.ReadLine()) is not null)
        {
            var fields = new List<string?>();
            var field = new StringBuilder();
            var quoted = false;
            for (var i = 0; i < line.Length; i++)
            {
                var ch = line[i];
                if (quoted)
                {
                    if (ch == '"' && i + 1 < line.Length && line[i + 1] == '"') { field.Append('"'); i++; }
                    else if (ch == '"') quoted = false;
                    else field.Append(ch);
                }
                else if (ch == '"') quoted = true;
                else if (ch == ',') { fields.Add(field.ToString()); field.Clear(); }
                else field.Append(ch);
            }
            fields.Add(field.ToString());
            rows.Add([.. fields]);
        }
        return rows;
    }
}
