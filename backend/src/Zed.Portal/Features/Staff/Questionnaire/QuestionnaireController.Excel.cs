using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Http;
using Zed.Portal.Features.Staff.Masters;
using Zed.Portal.Features.Staff.Users;

namespace Zed.Portal.Features.Staff.Questionnaire;

/// <summary>
/// Excel export, template and upload of a parameter's requirements, one row per checkpoint (V4; see <see cref="MasterSheet"/>).
/// Each row is saved through the same edit as the page: a new requirement is added after the last, a new checkpoint after
/// the requirement's last; nothing is deleted. Sample copies are files, so they are kept (matched by the evidence's name)
/// and uploaded on the page; so are the evidences of a whole requirement added before V4.
/// </summary>
public sealed partial class QuestionnaireController
{
    internal static SheetSpec RequirementSheet(Section section) => new($"{section.Code} requirements", $"requirements-{section.Type.ToLowerInvariant()}-{section.Code.ToLowerInvariant()}",
    [
        new("Requirement", "The requirement's number, e.g. 1 (for 1.1). A new requirement takes the next number after the last."),
        new("Checkpoint", "The checkpoint's number within the requirement, e.g. 1. A new checkpoint takes the next number after the requirement's last."),
        new("Purpose", $"The requirement's purpose (up to {PurposeMax} characters), on any of its rows. Empty = unchanged."),
        new("Benefits", $"The requirement's benefits (up to {PurposeMax} characters), on any of its rows. Empty = unchanged."),
        new("Checkpoint text", "The Yes / No question. Required."),
        new("Evidence (if Yes)", "The evidences the unit shows when the answer is Yes, one per line (Alt+Enter in the cell)."),
        new("Mandatory evidence", "Yes or No for each evidence, one per line in the same order. Empty = Yes."),
        new("Action needed (if No / Partial)", $"The actions, one per line (each up to {ActionMax} characters, at most {MaxActions})."),
        // 2026-11-13: last, so files exported before still upload.
        new("Requirement text", $"The requirement itself (up to {RequirementNameMax} characters), on any of its rows. Empty = unchanged; required for a new requirement.", MayBeAbsent: true),
    ], 2, "Rows are matched by Requirement + Checkpoint: a new one is added, an existing one is updated. Nothing is deleted. Sample copies " +
        "and the evidences of a whole requirement (added before checkpoints) are kept and managed on the page.",
        (_, value) => int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var n) ? n.ToString(CultureInfo.InvariantCulture) : value);

    [HttpGet("excel")]
    public async Task<ActionResult> RequirementsExcel(string sectionType, string sectionCode, CancellationToken ct)
    {
        if (await SectionAsync(sectionType, sectionCode, ct) is not { } section) return NotFound();
        return MasterSheet.Export(RequirementSheet(section), SheetRows(await FullAsync(section, ct)));
    }

    [HttpGet("excel/template")]
    public async Task<ActionResult> RequirementsTemplate(string sectionType, string sectionCode, CancellationToken ct) =>
        await SectionAsync(sectionType, sectionCode, ct) is { } section ? MasterSheet.Template(RequirementSheet(section)) : NotFound();

    [HttpPost("excel/check")]
    [RequestSizeLimit(MasterSheet.MaxFileBytes + 64 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = MasterSheet.MaxFileBytes + 64 * 1024)]
    public async Task<ActionResult<SheetCheck>> RequirementsCheck(string sectionType, string sectionCode, IFormFile? file, CancellationToken ct)
    {
        if (await SectionAsync(sectionType, sectionCode, ct) is not { } section) return NotFound();
        if (await ExtrasAsync(section, ct) is null) return this.Problem400(NotReady);
        return await MasterSheet.CheckAsync(this, RequirementSheet(section), file, async () => SheetRules(await FullAsync(section, ct)), ct);
    }

    [HttpPost("excel/apply")]
    [RequestSizeLimit(MasterSheet.MaxFileBytes + 64 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = MasterSheet.MaxFileBytes + 64 * 1024)]
    public async Task<ActionResult<SheetApplied>> RequirementsApply(string sectionType, string sectionCode, IFormFile? file, CancellationToken ct)
    {
        if (await SectionAsync(sectionType, sectionCode, ct) is not { } section) return NotFound();
        if (await ExtrasAsync(section, ct) is null) return this.Problem400(NotReady);
        var result = await MasterSheet.ApplyAsync(this, RequirementSheet(section), file, async () => SheetRules(await FullAsync(section, ct)),
            row => SaveSheetRowAsync(section, row, ct), ct);
        log.LogInformation("Requirements of {Type}/{Code} uploaded from Excel by {Actor}", section.Type, section.Code, UserId);
        return result;
    }

    /// <summary>The requirements with the 0034 columns (as the page shows them).</summary>
    private async Task<List<Requirement>> FullAsync(Section section, CancellationToken ct)
    {
        var requirements = await LoadAsync(section, ct);
        return await ExtrasAsync(section, ct) is { } extras ? WithExtras(requirements, extras) : requirements;
    }

    private static IEnumerable<Evidence> EvidencesOf(Requirement r, string? optionCode) =>
        r.MandatoryEvidences.Concat(r.OptionalEvidences).Where(e => e.OptionCode == optionCode);

    private static bool IsMandatory(Requirement r, Evidence e) => r.MandatoryEvidences.Contains(e);

    private static IEnumerable<string?[]> SheetRows(List<Requirement> requirements) =>
        requirements.OrderBy(r => Order(Trim(r.RequirementCode))).SelectMany(r => r.Points.OrderBy(p => Order(Trim(p.OptionCode))).Select((p, i) =>
        {
            var evidences = EvidencesOf(r, Trim(p.OptionCode)).ToList();
            return new string?[]
            {
                Trim(r.RequirementCode), Trim(p.OptionCode), i == 0 ? r.Purpose ?? "" : "", i == 0 ? r.Benefits ?? "" : "", p.Name,
                string.Join("\n", evidences.Select(e => e.EvidenceName)), string.Join("\n", evidences.Select(e => IsMandatory(r, e) ? "Yes" : "No")),
                string.Join("\n", p.Actions ?? []), i == 0 ? r.RequirementName ?? "" : "",
            };
        }));

    private static List<string> Lines(string cell) => cell.Split('\n', StringSplitOptions.TrimEntries).Where(l => l.Length > 0).ToList();

    private static (IEnumerable<string?[]>, Action<SheetRowContext>) SheetRules(List<Requirement> requirements)
    {
        var current = SheetRows(requirements).ToList();
        var byCode = requirements.ToDictionary(r => Trim(r.RequirementCode));
        // The rows come in the file's order: new requirements and checkpoints must follow on from the last ones.
        var nextRequirement = requirements.Select(r => Order(Trim(r.RequirementCode))).Where(n => n < int.MaxValue).DefaultIfEmpty(0).Max() + 1;
        var lastPoint = requirements.ToDictionary(r => Trim(r.RequirementCode),
            r => r.Points.Select(p => Order(Trim(p.OptionCode))).Where(n => n < int.MaxValue).DefaultIfEmpty(0).Max());
        // The requirements that have their text (stored, or given on an earlier row of the file): a save needs it.
        var named = requirements.Where(r => !string.IsNullOrWhiteSpace(r.RequirementName)).Select(r => Trim(r.RequirementCode)).ToHashSet();
        return (current, row =>
        {
            var requirementNo = int.TryParse(row.Cell(0), NumberStyles.None, CultureInfo.InvariantCulture, out var rq) && rq > 0 ? rq : 0;
            var pointNo = int.TryParse(row.Cell(1), NumberStyles.None, CultureInfo.InvariantCulture, out var cp) && cp > 0 ? cp : 0;
            if (requirementNo == 0) row.Errors.Add("Requirement must be a number, e.g. 1.");
            if (pointNo == 0) row.Errors.Add("Checkpoint must be a number, e.g. 1.");
            if (!StaffUserRules.TryText(row.Cell(4), PointMax, true, true, out _)) row.Errors.Add($"Checkpoint text is required (up to {PointMax} characters).");
            for (var c = 2; c <= 3; c++)
                if (!StaffUserRules.TryText(row.Cell(c), PurposeMax, false, true, out _)) row.Errors.Add($"{(c == 2 ? "Purpose" : "Benefits")} can be up to {PurposeMax} characters.");

            var evidences = Lines(row.Cell(5));
            var flags = Lines(row.Cell(6));
            if (evidences.Any(e => e.Length > EvidenceMax)) row.Errors.Add($"Each evidence can be up to {EvidenceMax} characters.");
            if (flags.Count > evidences.Count) row.Errors.Add("Mandatory evidence has more lines than Evidence.");
            var mandatory = evidences.Select((_, i) => MasterSheet.YesNo(i < flags.Count ? flags[i] : "", "Yes")).ToList();
            if (mandatory.Any(m => m is null)) row.Errors.Add("Mandatory evidence must be Yes or No on each line.");
            var actions = Lines(row.Cell(7));
            if (actions.Any(a => a.Length > ActionMax)) row.Errors.Add($"Each action needed can be up to {ActionMax} characters.");
            if (actions.Count > MaxActions) row.Errors.Add($"At most {MaxActions} actions for a checkpoint.");
            if (!StaffUserRules.TryText(row.Cell(8), RequirementNameMax, false, true, out _)) row.Errors.Add($"Requirement text can be up to {RequirementNameMax} characters.");
            if (row.Errors.Count > 0) return;

            row.Cells[0] = requirementNo.ToString(CultureInfo.InvariantCulture);
            row.Cells[1] = pointNo.ToString(CultureInfo.InvariantCulture);
            row.Cells[5] = string.Join("\n", evidences);
            row.Cells[6] = string.Join("\n", mandatory);
            row.Cells[7] = string.Join("\n", actions);
            // Empty purpose / benefits = unchanged.
            for (var c = 2; c <= 3; c++)
                if (row.Cell(c).Length == 0) row.Cells[c] = row.Current?[c] ?? "";
            if (row.Cell(8).Length == 0) row.Cells[8] = row.Current?[8] ?? "";

            var key = row.Cell(0);
            if (row.Cell(8).Length > 0) named.Add(key);
            else if (byCode.ContainsKey(key) && !named.Contains(key) && (row.Current is null || !row.Cells.SequenceEqual(row.Current)))
            {
                row.Errors.Add($"Requirement {key} has no Requirement text yet: please add it on this row.");
                return;
            }
            if (!byCode.ContainsKey(key) && !lastPoint.ContainsKey(key))
            {
                if (requirementNo != nextRequirement) { row.Errors.Add($"A new requirement takes the next number: {nextRequirement}."); return; }
                if (row.Cell(8).Length == 0) { row.Errors.Add("A new requirement needs its Requirement text (on its first row)."); return; }
                nextRequirement++;
                lastPoint[key] = 0;
            }
            if (row.Current is null)
            {
                if (pointNo != lastPoint[key] + 1) { row.Errors.Add($"A new checkpoint of requirement {key} takes the next number: {lastPoint[key] + 1}."); return; }
                lastPoint[key] = pointNo;
            }
        });
    }

    /// <summary>Saves one row: the requirement as it is now, with this checkpoint added or replaced (and purpose / benefits when given).</summary>
    private async Task<string?> SaveSheetRowAsync(Section section, SheetRowContext row, CancellationToken ct)
    {
        var requirements = await FullAsync(section, ct);
        var requirement = requirements.FirstOrDefault(r => Trim(r.RequirementCode) == row.Cell(0));
        var evidenceNames = Lines(row.Cell(5));
        var flags = Lines(row.Cell(6));
        var actions = Lines(row.Cell(7));
        string? Text(int c) => row.Cell(c).Length > 0 ? row.Cell(c) : null;

        if (requirement is null)
        {
            var point = new PointIn(null, row.Cell(4), evidenceNames.Select((n, i) => new EvidenceIn(n, flags.ElementAtOrDefault(i) != "No", null, null, false)).ToList(), actions);
            await AddChecklistAsync(section, new ChecklistIn(Text(2), Text(3), [point], [], RequirementName: Text(8)), ct);
            return null;
        }
        var input = ToInput(requirement);
        var old = input.Points.FirstOrDefault(p => p.OptionCode == row.Cell(1));
        // An evidence of the same name keeps its sample copy, help text and validation.
        var evidences = evidenceNames.Select((n, i) =>
        {
            var same = old?.Evidences.FirstOrDefault(e => string.Equals(e.Name, n, StringComparison.OrdinalIgnoreCase));
            return new EvidenceIn(n, flags.ElementAtOrDefault(i) != "No", same?.SampleFile, same?.HelpText, same?.ValidationRequired ?? false);
        }).ToList();
        var updated = new PointIn(old?.OptionCode, row.Cell(4), evidences, actions);
        var points = old is null ? [.. input.Points, updated] : input.Points.Select(p => p == old ? updated : p).ToList();
        var full = new ChecklistIn(Text(2) ?? input.Purpose, Text(3) ?? input.Benefits, points, input.General, input.VideoUrl, Text(8) ?? input.RequirementName);
        var (_, error) = ValidateChecklist(ToRequest(full));
        if (error is not null) return error;
        await UpdateChecklistAsync(section, requirement, full, ct);
        return null;
    }

    private static ChecklistIn ToInput(Requirement r)
    {
        EvidenceIn In(Evidence e) => new(e.EvidenceName, IsMandatory(r, e), e.SampleFile, e.HelpText, e.ValidationRequired);
        return new ChecklistIn(r.Purpose, r.Benefits,
            r.Points.Select(p => new PointIn(Trim(p.OptionCode), p.Name, EvidencesOf(r, Trim(p.OptionCode)).Select(In).ToList(), [.. p.Actions ?? []])).ToList(),
            EvidencesOf(r, null).Select(In).ToList(), r.VideoUrl, r.RequirementName);
    }

    private static ChecklistRequest ToRequest(ChecklistIn c)
    {
        static ChecklistEvidence Out(EvidenceIn e) => new(e.Name, e.Mandatory, e.SampleFile, e.HelpText, e.ValidationRequired);
        return new ChecklistRequest(c.Purpose, c.Benefits,
            c.Points.Select(p => new ChecklistPoint(p.OptionCode, p.Text, p.Evidences.Select(Out).ToList(), [.. p.Actions])).ToList(),
            c.General.Select(Out).ToList(), c.VideoUrl, c.RequirementName);
    }
}
