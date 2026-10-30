using Microsoft.AspNetCore.Mvc;
using Zed.Core.Http;
using Zed.Portal.Features.Staff.Users;

namespace Zed.Portal.Features.Staff.Masters;

/// <summary>
/// Excel export, template and upload of the sectors, categories, technologies and questionnaire parameters (V4; see
/// <see cref="MasterSheet"/>). Uploaded rows are saved through the same actions as the page's Add and Edit, so they
/// follow the same rules; rows are matched by their code and nothing is deleted.
/// </summary>
public sealed partial class StaffMastersController
{
    private const string ByCode = "Rows are matched by Code: a new code is added, an existing one is updated. Nothing is deleted.";

    internal static readonly SheetSpec SectorSheet = new("Sectors", "sectors",
    [
        new("Code", "The NIC 2-digit code, e.g. 24 (up to 50 characters, no comma). Required."),
        new("Name", "The sector name (up to 200 characters). Required."),
        new("Type", "Manufacturing or Services. Required."),
    ], 1, ByCode);

    internal static readonly SheetSpec CategorySheet = new("Categories", "categories",
    [
        new("Code", "The category code (up to 50 characters, no comma). Required."),
        new("Name", "The category name (up to 200 characters). Required."),
    ], 1, ByCode);

    internal static readonly SheetSpec TechnologySheet = new("Technologies", "technologies",
    [
        new("Code", "The technology code (up to 200 characters). Required."),
        new("Technology", "The technology name (up to 200 characters). Required."),
        new("Description", "Optional (up to 2000 characters)."),
        new("NIC sectors", "Codes of the sectors it applies to, separated by commas, e.g. 10, 13 (Masters → Sectors). Optional."),
        new("Categories", "Codes of its categories, separated by commas (Masters → Categories). Optional."),
        new("Status", "Active or Inactive (empty = Active). Inactive switches the technology off."),
    ], 1, ByCode + " To switch a technology off, set Status to Inactive.");

    internal static SheetSpec ParameterSheet(string level) => new($"{level} parameters", $"parameters-{level.ToLowerInvariant()}",
    [
        new("Code", "The parameter code, e.g. P1 (up to 50 characters). Required."),
        new("Name", "The parameter name (up to 200 characters). Required."),
        new("Description", "Shown with the parameter (up to 1990 characters). Optional."),
        new("NIC sectors", "Codes of the sectors it applies to, separated by commas, e.g. 10, 13. Empty = all sectors."),
        new("In surveillance", "Yes: assessed again in surveillance; No or empty: not."),
    ], 1, ByCode + $" Only the {level} parameters are read and changed.");

    // ---- Sectors ------------------------------------------------------------------------------

    [HttpGet("sectors/excel")]
    public async Task<FileContentResult> SectorsExcel(CancellationToken ct) =>
        MasterSheet.Export(SectorSheet, (await Sectors(ct)).Select(s => new[] { s.Code, s.Name, s.Activity }));

    [HttpGet("sectors/excel/template")]
    public FileContentResult SectorsTemplate() => MasterSheet.Template(SectorSheet);

    [HttpPost("sectors/excel/check")]
    [RequestSizeLimit(MasterSheet.MaxFileBytes + 64 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = MasterSheet.MaxFileBytes + 64 * 1024)]
    public Task<ActionResult<SheetCheck>> SectorsCheck(IFormFile? file, CancellationToken ct) =>
        MasterSheet.CheckAsync(this, SectorSheet, file, () => SectorRulesAsync(ct), ct);

    [HttpPost("sectors/excel/apply")]
    [RequestSizeLimit(MasterSheet.MaxFileBytes + 64 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = MasterSheet.MaxFileBytes + 64 * 1024)]
    public async Task<ActionResult<SheetApplied>> SectorsApply(IFormFile? file, CancellationToken ct)
    {
        var ids = (await LoadSectorsAsync(ct)).GroupBy(s => s.Code.Trim(), StringComparer.OrdinalIgnoreCase).ToDictionary(g => g.Key, g => g.First().Id, StringComparer.OrdinalIgnoreCase);
        return await MasterSheet.ApplyAsync(this, SectorSheet, file, () => SectorRulesAsync(ct), async row => row.Current is null
            ? MasterSheet.Refusal((await AddSector(new SectorRequest(row.Cell(0), row.Cell(1), row.Cell(2)), ct)).Result)
            : MasterSheet.Refusal((await UpdateSector(ids[row.Cell(0)], new SectorUpdateRequest(row.Cell(1), row.Cell(2)), ct)).Result), ct);
    }

    private async Task<(IEnumerable<string?[]>, Action<SheetRowContext>)> SectorRulesAsync(CancellationToken ct)
    {
        var current = (await Sectors(ct)).Select(s => new[] { s.Code.Trim(), s.Name, s.Activity ?? "" }).ToList();
        return (current, row =>
        {
            CodeNameErrors(row, "Sector", "Name");
            if (Activity(row.Cell(2)) is { } activity) row.Cells[2] = activity;
            else row.Errors.Add("Type must be Manufacturing or Services.");
        });
    }

    // ---- Categories ---------------------------------------------------------------------------

    [HttpGet("categories/excel")]
    [SystemOnly(PortalSystem.Main)]
    public async Task<FileContentResult> CategoriesExcel(CancellationToken ct) =>
        MasterSheet.Export(CategorySheet, (await LoadCategoriesAsync(ct)).Select(c => new[] { c.Code, c.Name }));

    [HttpGet("categories/excel/template")]
    [SystemOnly(PortalSystem.Main)]
    public FileContentResult CategoriesTemplate() => MasterSheet.Template(CategorySheet);

    [HttpPost("categories/excel/check")]
    [SystemOnly(PortalSystem.Main)]
    [RequestSizeLimit(MasterSheet.MaxFileBytes + 64 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = MasterSheet.MaxFileBytes + 64 * 1024)]
    public Task<ActionResult<SheetCheck>> CategoriesCheck(IFormFile? file, CancellationToken ct) =>
        MasterSheet.CheckAsync(this, CategorySheet, file, () => CategoryRulesAsync(ct), ct);

    [HttpPost("categories/excel/apply")]
    [SystemOnly(PortalSystem.Main)]
    [RequestSizeLimit(MasterSheet.MaxFileBytes + 64 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = MasterSheet.MaxFileBytes + 64 * 1024)]
    public async Task<ActionResult<SheetApplied>> CategoriesApply(IFormFile? file, CancellationToken ct)
    {
        var ids = (await LoadCategoriesAsync(ct)).GroupBy(s => s.Code.Trim(), StringComparer.OrdinalIgnoreCase).ToDictionary(g => g.Key, g => g.First().Id, StringComparer.OrdinalIgnoreCase);
        return await MasterSheet.ApplyAsync(this, CategorySheet, file, () => CategoryRulesAsync(ct), async row => row.Current is null
            ? MasterSheet.Refusal((await AddCategory(new CodeNameRequest(row.Cell(0), row.Cell(1)), ct)).Result)
            : MasterSheet.Refusal((await UpdateCategory(ids[row.Cell(0)], new NameRequest(row.Cell(1)), ct)).Result), ct);
    }

    private async Task<(IEnumerable<string?[]>, Action<SheetRowContext>)> CategoryRulesAsync(CancellationToken ct)
    {
        var current = (await LoadCategoriesAsync(ct)).Select(c => new[] { c.Code.Trim(), c.Name }).ToList();
        return (current, row => CodeNameErrors(row, "Category", "Name"));
    }

    private static void CodeNameErrors(SheetRowContext row, string label, string nameColumn)
    {
        if (ValidateCodeName(new CodeNameRequest(row.Cell(0), row.Cell(1)), label).Error is { } error)
            row.Errors.Add(error.Replace($"{label} Code", "Code", StringComparison.Ordinal).Replace($"{label} Name", nameColumn, StringComparison.Ordinal));
    }

    // ---- Technologies -------------------------------------------------------------------------

    [HttpGet("technologies/excel")]
    [SystemOnly(PortalSystem.Main)]
    public async Task<FileContentResult> TechnologiesExcel(CancellationToken ct) =>
        MasterSheet.Export(TechnologySheet, (await LoadTechnologiesAsync(ct)).Select(TechnologyCells));

    [HttpGet("technologies/excel/template")]
    [SystemOnly(PortalSystem.Main)]
    public FileContentResult TechnologiesTemplate() => MasterSheet.Template(TechnologySheet);

    [HttpPost("technologies/excel/check")]
    [SystemOnly(PortalSystem.Main)]
    [RequestSizeLimit(MasterSheet.MaxFileBytes + 64 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = MasterSheet.MaxFileBytes + 64 * 1024)]
    public async Task<ActionResult<SheetCheck>> TechnologiesCheck(IFormFile? file, CancellationToken ct)
        => await MasterSheet.CheckAsync(this, TechnologySheet, file, async () => TechnologyRules(await TechnologyDataAsync(ct)), ct);

    [HttpPost("technologies/excel/apply")]
    [SystemOnly(PortalSystem.Main)]
    [RequestSizeLimit(MasterSheet.MaxFileBytes + 64 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = MasterSheet.MaxFileBytes + 64 * 1024)]
    public async Task<ActionResult<SheetApplied>> TechnologiesApply(IFormFile? file, CancellationToken ct)
    {
        TechnologyData data = null!;
        return await MasterSheet.ApplyAsync(this, TechnologySheet, file, async () => TechnologyRules(data = await TechnologyDataAsync(ct)), async row =>
        {
            var existing = row.Current is null ? null : data.Technologies.First(t => SameCode(t.TechnologyCode, row.Cell(0)));
            // The labels as stored: those the technology already has for a code (a sector renamed since keeps its label), else the master's.
            var request = new TechnologyRequest(row.Cell(0), row.Cell(1), row.Cell(2),
                Labels(MasterSheet.Codes(row.Cell(3)), existing?.Sectors, data.SectorLabels, SectorCodeOf),
                Labels(MasterSheet.Codes(row.Cell(4)), existing?.Categories, data.CategoryLabels, CategoryCodeOf));
            var active = row.Cell(5) == "Active";
            if (existing is null)
            {
                if (MasterSheet.Refusal((await AddTechnology(request, ct)).Result) is { } refused) return refused;
                if (active) return null;
                var added = (await LoadTechnologiesAsync(ct)).Where(t => SameCode(t.TechnologyCode, row.Cell(0))).Select(t => t.Id).DefaultIfEmpty(0).Max();
                return added == 0 ? "Added, but it could not be switched off: please set it Inactive on the page."
                    : MasterSheet.Refusal((await SetTechnologyActive(added, new ActiveRequest(false), ct)).Result);
            }
            var fieldsChanged = !TechnologyCells(existing)[1..5].SequenceEqual(row.Cells[1..5], StringComparer.Ordinal);
            if (fieldsChanged && MasterSheet.Refusal((await UpdateTechnology(existing.Id, request, ct)).Result) is { } error) return error;
            return active == existing.IsActive ? null : MasterSheet.Refusal((await SetTechnologyActive(existing.Id, new ActiveRequest(active), ct)).Result);
        }, ct);
    }

    private sealed record TechnologyData(List<Technology> Technologies, List<string> SectorLabels, List<string> CategoryLabels);

    private async Task<TechnologyData> TechnologyDataAsync(CancellationToken ct) =>
        new(await LoadTechnologiesAsync(ct), (await LoadSectorsAsync(ct)).Select(SectorLabel).ToList(), (await LoadCategoriesAsync(ct)).Select(CategoryLabel).ToList());

    private static (IEnumerable<string?[]>, Action<SheetRowContext>) TechnologyRules(TechnologyData data) =>
        (data.Technologies.Select(t => (string?[])TechnologyCells(t)), row =>
        {
            if (!StaffUserRules.TryText(row.Cell(0), 200, true, false, out _)) row.Errors.Add("Code is required (up to 200 characters).");
            if (!StaffUserRules.TryText(row.Cell(1), 200, true, false, out _)) row.Errors.Add("Technology is required (up to 200 characters).");
            if (!StaffUserRules.TryText(row.Cell(2), 2000, false, true, out _)) row.Errors.Add("Description can be up to 2000 characters.");
            var existing = row.Current is null ? null : data.Technologies.First(t => SameCode(t.TechnologyCode, row.Cell(0)));
            row.Cells[3] = CodesIn(row, MasterSheet.Codes(row.Cell(3)), data.SectorLabels.Concat(existing?.Sectors ?? []).Select(SectorCodeOf), "NIC sector", "Masters → Sectors");
            row.Cells[4] = CodesIn(row, MasterSheet.Codes(row.Cell(4)), data.CategoryLabels.Concat(existing?.Categories ?? []).Select(CategoryCodeOf), "Category", "Masters → Categories");
            if (MasterSheet.Status(row.Cell(5)) is { } status) row.Cells[5] = status;
            else row.Errors.Add("Status must be Active or Inactive.");
        });

    private static string[] TechnologyCells(Technology t) =>
    [
        t.TechnologyCode.Trim(), t.TechnologyName, t.Description ?? "", MasterSheet.CodeList(t.Sectors.Select(SectorCodeOf).Distinct()),
        MasterSheet.CodeList(t.Categories.Select(CategoryCodeOf).Distinct()), t.IsActive ? "Active" : "Inactive",
    ];

    /// <summary>The codes as written by the export ("10, 13"); an unknown one is an error of the row.</summary>
    private static string CodesIn(SheetRowContext row, List<string> codes, IEnumerable<string> known, string label, string master)
    {
        var set = known.ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var unknown in codes.Where(c => !set.Contains(c))) row.Errors.Add($"{label} {unknown} is not in {master}.");
        return MasterSheet.CodeList(codes.Select(c => set.TryGetValue(c, out var k) ? k : c));
    }

    private static List<string> Labels(List<string> codes, IReadOnlyList<string>? own, List<string> master, Func<string, string> codeOf) =>
        codes.Select(c => (own ?? []).FirstOrDefault(l => SameCode(codeOf(l), c)) ?? master.First(l => SameCode(codeOf(l), c))).ToList();

    /// <summary>The code of a stored sector label "{Code}-{Name}".</summary>
    private static string SectorCodeOf(string label) => (label.IndexOf('-') is var i and > 0 ? label[..i] : label).Trim();

    /// <summary>The code of a stored category label "{Code} -{Name}".</summary>
    private static string CategoryCodeOf(string label) => (label.IndexOf(" -", StringComparison.Ordinal) is var i and > 0 ? label[..i] : label).Trim();

    private static bool SameCode(string? a, string? b) => string.Equals(a?.Trim(), b?.Trim(), StringComparison.OrdinalIgnoreCase);

    // ---- Questionnaire parameters ------------------------------------------------------------

    [HttpGet("parameters/{sectionType}/excel")]
    [SystemOnly(PortalSystem.Main, PortalSystem.Surveillance)]
    public async Task<ActionResult> ParametersExcel(string sectionType, CancellationToken ct)
    {
        if (await SectionTypeAsync(sectionType, ct) is not { } type) return NotFound();
        return MasterSheet.Export(ParameterSheet(type), (await LoadParametersAsync(type, ct)).Select(ParameterCells));
    }

    [HttpGet("parameters/{sectionType}/excel/template")]
    [SystemOnly(PortalSystem.Main, PortalSystem.Surveillance)]
    public async Task<ActionResult> ParametersTemplate(string sectionType, CancellationToken ct) =>
        await SectionTypeAsync(sectionType, ct) is { } type ? MasterSheet.Template(ParameterSheet(type)) : NotFound();

    [HttpPost("parameters/{sectionType}/excel/check")]
    [SystemOnly(PortalSystem.Main, PortalSystem.Surveillance)]
    [RequestSizeLimit(MasterSheet.MaxFileBytes + 64 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = MasterSheet.MaxFileBytes + 64 * 1024)]
    public async Task<ActionResult<SheetCheck>> ParametersCheck(string sectionType, IFormFile? file, CancellationToken ct)
    {
        if (await SectionTypeAsync(sectionType, ct) is not { } type) return NotFound();
        return await MasterSheet.CheckAsync(this, ParameterSheet(type), file, () => ParameterRulesAsync(type, ct), ct);
    }

    [HttpPost("parameters/{sectionType}/excel/apply")]
    [SystemOnly(PortalSystem.Main, PortalSystem.Surveillance)]
    [RequestSizeLimit(MasterSheet.MaxFileBytes + 64 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = MasterSheet.MaxFileBytes + 64 * 1024)]
    public async Task<ActionResult<SheetApplied>> ParametersApply(string sectionType, IFormFile? file, CancellationToken ct)
    {
        if (await SectionTypeAsync(sectionType, ct) is not { } type) return NotFound();
        var ids = (await LoadParametersAsync(type, ct)).GroupBy(p => p.SectionCode.Trim(), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First().Id, StringComparer.OrdinalIgnoreCase);
        return await MasterSheet.ApplyAsync(this, ParameterSheet(type), file, () => ParameterRulesAsync(type, ct), async row =>
        {
            var sectors = MasterSheet.Codes(row.Cell(3));
            var surveillance = row.Cell(4) == "Yes";
            return row.Current is null
                ? MasterSheet.Refusal((await AddParameter(type, new ParameterRequest(row.Cell(0), row.Cell(1), row.Cell(2), sectors, surveillance), ct)).Result)
                : MasterSheet.Refusal((await UpdateParameter(type, ids[row.Cell(0)], new ParameterUpdateRequest(row.Cell(1), row.Cell(2), sectors, surveillance), ct)).Result);
        }, ct);
    }

    private async Task<(IEnumerable<string?[]>, Action<SheetRowContext>)> ParameterRulesAsync(string type, CancellationToken ct)
    {
        var current = (await LoadParametersAsync(type, ct)).Select(p => (string?[])ParameterCells(p)).ToList();
        var sectors = (await LoadSectorsAsync(ct)).Select(s => s.Code.Trim()).ToList();
        var keepsFlag = KeepsSurveillanceFlag;
        return (current, row =>
        {
            if (!StaffUserRules.TryText(row.Cell(0), 50, true, false, out _)) row.Errors.Add("Code is required (up to 50 characters).");
            if (!StaffUserRules.TryText(row.Cell(1), 200, true, false, out _)) row.Errors.Add("Name is required (up to 200 characters).");
            if (!StaffUserRules.TryText(row.Cell(2), 1990, false, true, out _)) row.Errors.Add("Description can be up to 1990 characters.");
            row.Cells[3] = CodesIn(row, MasterSheet.Codes(row.Cell(3)), sectors, "NIC sector", "Masters → Sectors");
            if (MasterSheet.YesNo(row.Cell(4)) is { } yes) row.Cells[4] = yes;
            else row.Errors.Add("In surveillance must be Yes or No.");
            if (!keepsFlag && row.Cells[4] != (row.Current?[4] ?? "No"))
            {
                row.Notes.Add("In surveillance is kept in the main portal's parameters only; it is not changed here.");
                row.Cells[4] = row.Current?[4] ?? "No";
            }
        });
    }

    private static string[] ParameterCells(Parameter p) =>
        [p.SectionCode.Trim(), p.SectionName, p.Description ?? "", MasterSheet.CodeList(p.NicSectors ?? []), p.InSurveillance ? "Yes" : "No"];
}
