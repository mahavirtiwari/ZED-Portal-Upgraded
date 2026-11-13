using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Portal.Features.Staff.Masters;

namespace Zed.Portal.Features.Staff.Questionnaire;

/// <summary>
/// 2026-11-13: the requirements of every parameter of a level in one Excel sheet (Parameters page and Requirements page,
/// "Requirements of all parameters"). The sheet is a parameter's sheet with a Parameter column first; each row is checked
/// and saved by its parameter's own rules (<see cref="SheetRules"/>, <see cref="SaveSheetRowAsync"/>), so a level upload
/// behaves exactly like uploading each parameter's rows on its page. A parameter the level does not have is an error.
/// Nothing is deleted.
/// </summary>
public sealed partial class QuestionnaireController
{
    private const string LevelBase = "~/api/staff/questionnaire/{sectionType}/all-requirements/";

    internal static SheetSpec LevelSheet(string type)
    {
        var inner = RequirementSheet(new Section(type, "P", "")).Columns;
        return new SheetSpec($"{type} requirements", $"requirements-{type.ToLowerInvariant()}-all-parameters",
            [new SheetColumn("Parameter", $"The parameter's code, e.g. P1 (as on the {type} Parameters page). The parameter must exist."), .. inner],
            3,
            "Rows are matched by Parameter + Requirement + Checkpoint: a new one is added, an existing one is updated. Nothing is deleted. " +
            "Each parameter's rows follow its own numbering (a new requirement after its last, a new checkpoint after the requirement's last). " +
            "Sample copies and the evidences of a whole requirement are kept and managed on the Requirements page.",
            (column, value) => column == 0 ? value.ToUpperInvariant()
                : int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var n) ? n.ToString(CultureInfo.InvariantCulture) : value);
    }

    /// <summary>The level's code as stored and its parameters in code order (P1, P2 … P10); null for an unknown level.</summary>
    private async Task<(string Type, List<Section> Sections)?> LevelAsync(string sectionType, CancellationToken ct)
    {
        var type = (await Zed.Portal.Features.CertLevels.CertificationLevels.FindAsync(db, sectionType, log, ct))?.Code;
        if (type is null) return null;
        var sections = (await db.QueryProcMultipleAsync("SP_MASTER_GET_SECTIONS", new { SectionType = type }, ct))[0]
            .Select(r => new Section(type, r.Text("SectionCode").Trim(), r.Text("SectionName")))
            .Where(s => s.Code.Length > 0)
            .GroupBy(s => s.Code, StringComparer.OrdinalIgnoreCase).Select(g => g.First())
            .OrderBy(s => Order(new string(s.Code.Where(char.IsDigit).ToArray()))).ThenBy(s => s.Code, StringComparer.OrdinalIgnoreCase)
            .ToList();
        return (type, sections);
    }

    /// <summary>Every parameter's rows (the Parameter column first) and a validator that hands each row to its parameter's rules.</summary>
    private async Task<(IEnumerable<string?[]> Current, Action<SheetRowContext> Validate)> LevelRulesAsync(string type, List<Section> sections, CancellationToken ct)
    {
        var current = new List<string?[]>();
        var rules = new Dictionary<string, Action<SheetRowContext>>(StringComparer.OrdinalIgnoreCase);
        foreach (var s in sections)
        {
            var (rows, validate) = SheetRules(await FullAsync(s, ct));
            current.AddRange(rows.Select(r => (string?[])[s.Code, .. r]));
            rules[s.Code] = validate;
        }
        return (current, row =>
        {
            if (!rules.TryGetValue(row.Cell(0), out var validate))
            {
                row.Errors.Add($"{type} has no parameter {row.Cell(0)}: please add it on the Parameters page first.");
                return;
            }
            var sub = SubRow(row);
            validate(sub);
            for (var i = 0; i < sub.Cells.Length; i++) row.Cells[i + 1] = sub.Cells[i];
            row.Errors.AddRange(sub.Errors);
            row.Notes.AddRange(sub.Notes);
        });
    }

    /// <summary>The row without its Parameter column, as a parameter's sheet has it.</summary>
    private static SheetRowContext SubRow(SheetRowContext row) => new(row.Row, row.Cells[1..], row.Current?[1..]);

    [HttpGet(LevelBase + "excel")]
    public async Task<ActionResult> LevelRequirementsExcel(string sectionType, CancellationToken ct)
    {
        if (await LevelAsync(sectionType, ct) is not { } level) return NotFound();
        var rows = new List<string?[]>();
        foreach (var s in level.Sections)
            rows.AddRange(SheetRows(await FullAsync(s, ct)).Select(r => (string?[])[s.Code, .. r]));
        return MasterSheet.Export(LevelSheet(level.Type), rows);
    }

    [HttpGet(LevelBase + "excel/template")]
    public async Task<ActionResult> LevelRequirementsTemplate(string sectionType, CancellationToken ct) =>
        await LevelAsync(sectionType, ct) is { } level ? MasterSheet.Template(LevelSheet(level.Type)) : NotFound();

    [HttpPost(LevelBase + "excel/check")]
    [RequestSizeLimit(MasterSheet.MaxFileBytes + 64 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = MasterSheet.MaxFileBytes + 64 * 1024)]
    public async Task<ActionResult<SheetCheck>> LevelRequirementsCheck(string sectionType, IFormFile? file, CancellationToken ct)
    {
        if (await LevelAsync(sectionType, ct) is not { } level) return NotFound();
        if (level.Sections.Count == 0) return this.Problem400($"{level.Type} has no parameters yet. Please add them on the Parameters page first.");
        if (await ExtrasAsync(level.Sections[0], ct) is null) return this.Problem400(NotReady);
        return await MasterSheet.CheckAsync(this, LevelSheet(level.Type), file, () => LevelRulesAsync(level.Type, level.Sections, ct), ct);
    }

    [HttpPost(LevelBase + "excel/apply")]
    [RequestSizeLimit(MasterSheet.MaxFileBytes + 64 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = MasterSheet.MaxFileBytes + 64 * 1024)]
    public async Task<ActionResult<SheetApplied>> LevelRequirementsApply(string sectionType, IFormFile? file, CancellationToken ct)
    {
        if (await LevelAsync(sectionType, ct) is not { } level) return NotFound();
        if (level.Sections.Count == 0) return this.Problem400($"{level.Type} has no parameters yet. Please add them on the Parameters page first.");
        if (await ExtrasAsync(level.Sections[0], ct) is null) return this.Problem400(NotReady);
        var byCode = level.Sections.ToDictionary(s => s.Code, StringComparer.OrdinalIgnoreCase);
        var result = await MasterSheet.ApplyAsync(this, LevelSheet(level.Type), file, () => LevelRulesAsync(level.Type, level.Sections, ct),
            row => SaveSheetRowAsync(byCode[row.Cell(0)], SubRow(row), ct), ct);
        log.LogInformation("Requirements of every {Type} parameter uploaded from Excel by {Actor}", level.Type, UserId);
        return result;
    }
}
