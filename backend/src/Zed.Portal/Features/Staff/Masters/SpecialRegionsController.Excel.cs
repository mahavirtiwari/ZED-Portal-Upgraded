using Microsoft.AspNetCore.Mvc;

namespace Zed.Portal.Features.Staff.Masters;

/// <summary>
/// Excel export, template and upload of the subsidy regions (V4; see <see cref="MasterSheet"/>). A row is an entry of a
/// list: a whole state (no district code) or a district. New rows are added to the list, changed ones enabled or
/// disabled, through the page's own Add and Enable / Disable; nothing is taken off a list.
/// </summary>
public sealed partial class SpecialRegionsController
{
    // A property: the lists (Categories) are a static field of the other part of the class, initialised in an unspecified order.
    internal static SheetSpec Sheet => new("Subsidy regions", "subsidy-regions",
    [
        new("List", "One of: " + string.Join(", ", Categories.Select(c => c.Name)) + ". Required."),
        new("State code", "The LGD code of the state, e.g. 9 (Masters → LG Directory). Required."),
        new("District code", "The LGD code of the district; empty = the whole state. " +
            string.Join(" and ", Categories.Where(c => c.Level == "district").Select(c => c.Name)) + " need a district.", Optional: true),
        new("State", "The state's name (for reading only; taken from the masters)."),
        new("District", "The district's name (for reading only; taken from the masters)."),
        new("Status", "Enabled (its MSMEs get the additional subsidy) or Disabled. Empty = Enabled."),
    ], 3, "Rows are matched by List + State code + District code: a new entry is added to its list, an existing one is enabled or disabled. " +
        "Nothing is taken off a list; to stop the subsidy, set Status to Disabled.",
        (column, value) => column == 0 && ListOf(value) is { } list ? list.Name : value);

    /// <summary>A list by its name or key (any case).</summary>
    private static Category? ListOf(string value) => Categories.FirstOrDefault(c =>
        string.Equals(c.Name, value, StringComparison.OrdinalIgnoreCase) || string.Equals(c.Key, value, StringComparison.OrdinalIgnoreCase));

    internal const string AllDistrictsSql =
        "SELECT LTRIM(RTRIM(StateCode)) AS StateCode, LTRIM(RTRIM(DistrictCode)) AS Code, DistrictName AS Name FROM dbo.Districts WHERE ISNULL(IsActive, 1) = 1;";

    public sealed record DistrictOption(string StateCode, string Code, string Name);

    [HttpGet("excel")]
    public async Task<FileContentResult> Excel(CancellationToken ct) =>
        MasterSheet.Export(Sheet, (await db.QuerySqlAsync<RegionRow>(RegionsSql, null, ct)).Select(Cells));

    [HttpGet("excel/template")]
    public FileContentResult Template() => MasterSheet.Template(Sheet);

    [HttpPost("excel/check")]
    [RequestSizeLimit(MasterSheet.MaxFileBytes + 64 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = MasterSheet.MaxFileBytes + 64 * 1024)]
    public Task<ActionResult<SheetCheck>> Check(IFormFile? file, CancellationToken ct) => MasterSheet.CheckAsync(this, Sheet, file, () => RulesAsync(ct), ct);

    [HttpPost("excel/apply")]
    [RequestSizeLimit(MasterSheet.MaxFileBytes + 64 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = MasterSheet.MaxFileBytes + 64 * 1024)]
    public Task<ActionResult<SheetApplied>> Apply(IFormFile? file, CancellationToken ct) =>
        MasterSheet.ApplyAsync(this, Sheet, file, () => RulesAsync(ct), async row =>
        {
            var req = new RegionRequest(Categories.First(c => c.Name == row.Cell(0)).Key, row.Cell(1), row.Cell(2), row.Cell(5) == "Enabled");
            return MasterSheet.Refusal(row.Current is null ? (await Add(req, ct)).Result : (await Set(req, ct)).Result);
        }, ct);

    private static string?[] Cells(RegionRow r) =>
        [CategoryName(r.Category), r.StateCode, r.DistrictCode, r.StateName ?? "", r.DistrictName ?? "", r.Enabled ? "Enabled" : "Disabled"];

    private async Task<(IEnumerable<string?[]>, Action<SheetRowContext>)> RulesAsync(CancellationToken ct)
    {
        var current = (await db.QuerySqlAsync<RegionRow>(RegionsSql, null, ct)).Select(Cells).ToList();
        var states = (await db.QuerySqlAsync<Option>(StatesSql, null, ct)).GroupBy(s => s.Code).ToDictionary(g => g.Key, g => g.First().Name);
        var districts = (await db.QuerySqlAsync<DistrictOption>(AllDistrictsSql, null, ct)).GroupBy(d => (d.StateCode, d.Code)).ToDictionary(g => g.Key, g => g.First().Name);
        return (current, row =>
        {
            var category = ListOf(row.Cell(0));
            if (category is null) row.Errors.Add("List must be one of: " + string.Join(", ", Categories.Select(c => c.Name)) + ".");
            if (MasterSheet.YesNo(row.Cell(5), "Yes") is { } yes) row.Cells[5] = yes == "Yes" ? "Enabled" : "Disabled";
            else if (row.Cell(5).ToLowerInvariant() is "enabled" or "disabled") row.Cells[5] = row.Cell(5).ToLowerInvariant() == "enabled" ? "Enabled" : "Disabled";
            else row.Errors.Add("Status must be Enabled or Disabled.");
            if (category is null) return;
            if (row.Current is not null)
            {
                row.Cells[3] = row.Current[3];
                row.Cells[4] = row.Current[4];
                return;
            }
            if (!states.TryGetValue(row.Cell(1), out var stateName)) { row.Errors.Add($"State code {row.Cell(1)} is not an active state."); return; }
            row.Cells[3] = stateName;
            if (row.Cell(2).Length == 0)
            {
                if (category.Level == "district") row.Errors.Add($"{category.Name} are districts: District code is required.");
                row.Cells[4] = "";
            }
            else if (districts.TryGetValue((row.Cell(1), row.Cell(2)), out var districtName)) row.Cells[4] = districtName;
            else row.Errors.Add($"District code {row.Cell(2)} is not an active district of state {row.Cell(1)}.");
        });
    }
}
