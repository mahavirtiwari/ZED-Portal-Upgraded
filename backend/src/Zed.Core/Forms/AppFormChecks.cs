using System.Text.Json;
using Dapper;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging;
using Zed.Core.Data;
using Zed.Core.Http;

namespace Zed.Core.Forms;

/// <summary>
/// V4 (migration 0080): "Validation required" answers of the Admin's own fields (Admin → App Forms). The assessor who raises
/// the NCs of the round checks each one: Valid, or Not valid with a remark. The final submit procedures raise an NC on each
/// Not valid one, which the unit answers in the ZED MSME app by entering the field again. Stored with the answer
/// (dbo.V4AppFormValues): ValidStatus / ValidRemarks / ValidStage / ValidRound / ValidBy / ValidOn for the check,
/// NcRound / NcValue / NcRemarks / NcAnsweredOn for the NC.
/// </summary>
public static class AppFormStages
{
    /// <summary>The desktop assessor (a level certified at the desktop).</summary>
    public const string Desktop = "DA";

    /// <summary>The lead assessor of the site visit, remote or onsite, on the web review (levels with a visit).</summary>
    public const string Site = "SA";

    /// <summary>
    /// Who checks a level's answers: whoever assesses the unit where its NCs are raised (user, 2026-11-15), by the level's
    /// flow (Administration → Certification Levels, migration 0078): the desktop assessor for a level certified at the
    /// desktop, the lead assessor of the visit otherwise. A Bronze with a visit is checked at the visit.
    /// </summary>
    public static string For(string level) => Data.LevelRegistry.IsDesktop(AppFormUnit.LevelOf(level)) ? Desktop : Site;

}

/// <summary>A stored answer with its check and NC (dbo.V4AppFormValues).</summary>
public sealed record AppFormCheckRow
{
    public string FormKey { get; init; } = "";
    public string FieldKey { get; init; } = "";
    public string? Value { get; init; }
    public string? ValidStatus { get; init; }
    public string? ValidRemarks { get; init; }
    public string? ValidStage { get; init; }
    public int? ValidRound { get; init; }
    public string? ValidBy { get; init; }
    public DateTime? ValidOn { get; init; }
    public int? NcRound { get; init; }
    public string? NcValue { get; init; }
    public string? NcRemarks { get; init; }
    public DateTime? NcAnsweredOn { get; init; }
}

/// <summary>An answer as the assessor checks it.</summary>
/// <param name="Status">"Yes" (Valid) / "No" (Not valid) in this round, null when not checked yet.</param>
/// <param name="NcRound">An NC round: the round it was raised in; with <paramref name="PreviousValue"/> (the answer found not
/// valid, as text) and <paramref name="NcRemarks"/> (the remark that raised it).</param>
public sealed record AppFormCheckItem(string Form, string FormName, string Key, string Label, string Type, string Value,
    string? Status, string? Remarks, int? NcRound, string? PreviousValue, string? NcRemarks, bool Answered);

/// <summary>An NC on an answer, as the unit answers it in the app.</summary>
public sealed record AppFormNcItem(string Form, string Key, string Label, string Type, string? Help, IReadOnlyList<string>? Options,
    string? Remarks, string? PreviousValue, string? Value, bool Answered);

/// <summary>Where a check is made: who, which NC round of the record (NcCount), and whether that round is an NC round.</summary>
public sealed record AppFormCheckRound(string Stage, int Round, bool NcRound);

public sealed class AppFormChecks(ISqlExecutor db, AppForms forms, ILogger<AppFormChecks> log)
{
    public const int MaxRemarks = 1000;

    public const string RowsSql =
        "SELECT FormKey, FieldKey, Value, ValidStatus, ValidRemarks, ValidStage, ValidRound, ValidBy, ValidOn, NcRound, NcValue, NcRemarks, NcAnsweredOn " +
        "FROM dbo.V4AppFormValues WHERE ZedId = @ZedId AND CertificationType = @CertificationType;";

    public const string CheckSql =
        "UPDATE dbo.V4AppFormValues SET ValidStatus = @Status, ValidRemarks = @Remarks, ValidStage = @Stage, ValidRound = @Round, ValidBy = @By, " +
        "ValidOn = SYSUTCDATETIME() WHERE FormKey = @FormKey AND ZedId = @ZedId AND CertificationType = @CertificationType AND FieldKey = @FieldKey;";

    /// <summary>Only while that NC is the unit's open round (checked by the caller) and on that round's item.</summary>
    public const string AnswerSql =
        "UPDATE dbo.V4AppFormValues SET Value = @Value, SubmittedBy = @By, UpdatedOn = SYSUTCDATETIME(), NcAnsweredOn = SYSUTCDATETIME() " +
        "WHERE FormKey = @FormKey AND ZedId = @ZedId AND CertificationType = @CertificationType AND FieldKey = @FieldKey AND NcRound = @NcRound;";

    private static DbString Ansi(string? value, int length) => new() { Value = value, IsAnsi = true, Length = length };

    /// <summary>The unit's answers with their checks; none before migration 0080 (or when the table cannot be read).</summary>
    public async Task<IReadOnlyList<AppFormCheckRow>> RowsAsync(string zedId, string certification, CancellationToken ct = default)
    {
        try
        {
            return await db.QuerySqlAsync<AppFormCheckRow>(RowsSql,
                new { ZedId = Ansi(zedId, 50), CertificationType = Ansi(certification, 50) }, ct);
        }
        catch (SqlException ex)
        {
            log.LogWarning(ex, "Could not read the App Forms checks (is migration 0080 applied?)");
            return [];
        }
    }

    /// <summary>
    /// The answers to check in this round, in form order. The first assessment: every answer to a shown "Validation
    /// required" field of the unit (and any answer already checked in the round, the setting since turned off). An NC round:
    /// the answers whose NC was raised in it.
    /// </summary>
    public async Task<IReadOnlyList<AppFormCheckItem>> ItemsAsync(PortalSystem system, string zedId, string certification, AppFormCheckRound round,
        CancellationToken ct = default)
    {
        var rows = await RowsAsync(zedId, certification, ct);
        if (rows.Count == 0) return [];
        var unit = await AppFormUnit.ForAsync(db, zedId, certification, ct);
        var result = new List<AppFormCheckItem>();
        foreach (var spec in AppFormCatalogue.For(system).Where(s => s.CanValidate(system)))
        {
            var form = (await forms.GetAsync(system, spec.Key, ct, unit))!;
            var mine = rows.Where(r => string.Equals(r.FormKey, spec.Key, StringComparison.OrdinalIgnoreCase)).ToList();
            foreach (var f in form.Fields.Where(f => f.Custom))
            {
                var row = mine.FirstOrDefault(r => string.Equals(r.FieldKey, f.Key, StringComparison.OrdinalIgnoreCase));
                if (row is null) continue;
                var checkedNow = IsCheckedIn(row, round);
                var wanted = round.NcRound
                    ? row.NcRound == round.Round
                    : (f.Active && f.ValidationRequired && !string.IsNullOrEmpty(row.Value)) || checkedNow;
                if (!wanted) continue;
                result.Add(new AppFormCheckItem(spec.Key, spec.Name, f.Key, f.Label, f.Type, AppFormRules.Display(f.Type, row.Value),
                    checkedNow ? row.ValidStatus : null, checkedNow ? row.ValidRemarks : null,
                    round.NcRound ? row.NcRound : null,
                    round.NcRound ? AppFormRules.Display(f.Type, row.NcValue) : null,
                    round.NcRound ? row.NcRemarks : null,
                    row.NcAnsweredOn is not null));
            }
        }
        return result;
    }

    private static bool IsCheckedIn(AppFormCheckRow row, AppFormCheckRound round) =>
        row.ValidStatus is "Yes" or "No" && row.ValidRound == round.Round && string.Equals(row.ValidStage, round.Stage, StringComparison.Ordinal);

    /// <summary>The check of one answer of this round; the error to show, or null.</summary>
    public async Task<string?> SaveAsync(PortalSystem system, string zedId, string certification, AppFormCheckRound round, string? form, string? key,
        string? status, string? remarks, string userId, CancellationToken ct = default)
    {
        var verdict = status?.Trim() switch
        {
            { } s when s.Equals("Yes", StringComparison.OrdinalIgnoreCase) || s.Equals("Valid", StringComparison.OrdinalIgnoreCase) => "Yes",
            { } s when s.Equals("No", StringComparison.OrdinalIgnoreCase) || s.Equals("NotValid", StringComparison.OrdinalIgnoreCase) => "No",
            _ => null,
        };
        if (verdict is null) return "Please choose Valid or Not valid.";
        var remark = string.IsNullOrWhiteSpace(remarks) ? null : remarks.Trim();
        if (verdict == "No" && remark is null) return "Please enter a remark: why the answer is not valid.";
        if (remark?.Length > MaxRemarks) return $"The remark is too long ({MaxRemarks} characters at most).";

        var item = (await ItemsAsync(system, zedId, certification, round, ct))
            .FirstOrDefault(i => string.Equals(i.Form, form?.Trim(), StringComparison.OrdinalIgnoreCase) && string.Equals(i.Key, key?.Trim(), StringComparison.OrdinalIgnoreCase));
        if (item is null) return "This answer is not one to check in this round. Please reload the page.";

        await db.ExecuteSqlAsync(CheckSql, new
        {
            Status = Ansi(verdict, 3), Remarks = remark, Stage = Ansi(round.Stage, 2), round.Round, By = Ansi(userId.Length <= 50 ? userId : userId[..50], 50),
            FormKey = Ansi(item.Form, 50), ZedId = Ansi(zedId, 50), CertificationType = Ansi(certification, 50), FieldKey = Ansi(item.Key, 100),
        }, ct);
        log.LogInformation("App form check: {Form}/{Key} of {ZedId} {Certification} marked {Status} by {UserId} ({Stage}, round {Round})",
            item.Form, item.Key, zedId, certification, verdict, userId, round.Stage, round.Round);
        return null;
    }

    /// <summary>The answers of this round not checked yet, and those checked Not valid (the final submit raises an NC on them).</summary>
    public async Task<(int Unchecked, int NotValid)> SummaryAsync(PortalSystem system, string zedId, string certification, AppFormCheckRound round,
        CancellationToken ct = default)
    {
        var items = await ItemsAsync(system, zedId, certification, round, ct);
        return (items.Count(i => i.Status is null), items.Count(i => i.Status == "No"));
    }

    /// <summary>The refusal of a final submit while answers are not checked, or null.</summary>
    public static string? UncheckedMessage(int count) => count switch
    {
        0 => null,
        1 => "You have not checked 1 answer under \"to validate\" (Basic Information). Please mark it Valid or Not valid before final submit.",
        _ => $"You have not checked {count} answers under \"to validate\" (Basic Information). Please mark each Valid or Not valid before final submit.",
    };

    // ---------- The unit's side (ZED MSME app) ----------

    /// <summary>The NCs raised on answers in this round, in form order.</summary>
    public async Task<IReadOnlyList<AppFormNcItem>> NcItemsAsync(PortalSystem system, string zedId, string certification, int ncRound, CancellationToken ct = default)
    {
        if (ncRound <= 0) return [];
        var rows = (await RowsAsync(zedId, certification, ct)).Where(r => r.NcRound == ncRound).ToList();
        if (rows.Count == 0) return [];
        var result = new List<AppFormNcItem>();
        foreach (var spec in AppFormCatalogue.For(system))
        {
            var mine = rows.Where(r => string.Equals(r.FormKey, spec.Key, StringComparison.OrdinalIgnoreCase)).ToList();
            if (mine.Count == 0) continue;
            // Every level and sector: an NC raised on a field stays answerable even if the field was limited since.
            var form = (await forms.GetAsync(system, spec.Key, ct))!;
            foreach (var row in mine.OrderBy(r => form.Fields.ToList().FindIndex(f => string.Equals(f.Key, r.FieldKey, StringComparison.OrdinalIgnoreCase))))
            {
                var f = form.Find(row.FieldKey);
                var type = f?.Type ?? AppFieldTypes.Text;
                result.Add(new AppFormNcItem(spec.Key, row.FieldKey, f?.Label ?? row.FieldKey, type, f?.Help, f?.Options, row.NcRemarks,
                    AppFormRules.Display(type, row.NcValue), row.NcAnsweredOn is null ? null : row.Value, row.NcAnsweredOn is not null));
            }
        }
        return result;
    }

    /// <summary>The NCs of this round the unit has not answered yet.</summary>
    public async Task<int> UnansweredAsync(PortalSystem system, string zedId, string certification, int ncRound, CancellationToken ct = default) =>
        (await NcItemsAsync(system, zedId, certification, ncRound, ct)).Count(i => !i.Answered);

    /// <summary>The unit's new answer to an NC of its open round (checked against the field's type and choices); the error, or null.</summary>
    public async Task<string?> AnswerNcAsync(PortalSystem system, string zedId, string certification, int ncRound, string? form, string? key,
        JsonElement value, string submittedBy, CancellationToken ct = default)
    {
        var item = (await NcItemsAsync(system, zedId, certification, ncRound, ct))
            .FirstOrDefault(i => string.Equals(i.Form, form?.Trim(), StringComparison.OrdinalIgnoreCase) && string.Equals(i.Key, key?.Trim(), StringComparison.OrdinalIgnoreCase));
        if (item is null) return "This non-conformance is not open. Please refresh.";
        var spec = AppFormCatalogue.Find(system, item.Form)!;
        var field = (await forms.GetAsync(system, spec.Key, ct))!.Find(item.Key)
                    ?? new AppField { Key = item.Key, Label = item.Label, Type = item.Type, Section = spec.Sections[0].Key, Custom = true };
        var (stored, error) = AppFormRules.Normalise(field, value);
        if (error is not null) return $"{item.Label}: {error}";
        if (stored is null) return $"Please fill in: {item.Label}.";

        var changed = await db.ExecuteSqlAsync(AnswerSql, new
        {
            Value = stored, By = Ansi(submittedBy.Length <= 50 ? submittedBy : submittedBy[..50], 50),
            FormKey = Ansi(spec.Key, 50), ZedId = Ansi(zedId, 50), CertificationType = Ansi(certification, 50), FieldKey = Ansi(item.Key, 100), NcRound = ncRound,
        }, ct);
        if (changed == 0) return "This non-conformance is not open. Please refresh.";
        log.LogInformation("App form NC {Round}: {Form}/{Key} of {ZedId} {Certification} answered", ncRound, spec.Key, item.Key, zedId, certification);
        return null;
    }
}
