using System.Globalization;
using System.Text.Json;
using Zed.Portal.Features.Msme.Schemes;
using Zed.Portal.Features.Staff.Schemes;

namespace Zed.Portal.Features.Incentives.Applicant;

/// <summary>
/// The applicant's answers to a scheme's generic form (2026-11-20, approved design): each field checked and normalised by its
/// type, an "Add more" item checked as a whole (its pick, its fields, the copies, the section's document rules), and the whole
/// form at submission. Values are strings: numbers and amounts in invariant culture, dates yyyy-MM-dd, a multiple choice and a
/// document / photo field as a JSON list (of options, of stored file names).
/// </summary>
public static class ApplicantForm
{
    /// <summary>The unit's folder of scheme documents (mobileapi/Photos/{ZedId}/Schemes, <see cref="SchemeUploads"/> rules).</summary>
    public const string Folder = "Schemes";

    /// <summary>
    /// The standard bank block in the answers and the checks: section "_bank" (a section key never starts with "_"), item 0,
    /// field "cheque" (the cancelled cheque, a document) and "account" (the account details, a check path only).
    /// </summary>
    public const string BankSection = "_bank";
    public const string ChequeField = "cheque";
    public const string AccountField = "account";
    public static readonly string ChequePath = SchemeApplications.PathOf(BankSection, 0, ChequeField);
    public static readonly string AccountPath = SchemeApplications.PathOf(BankSection, 0, AccountField);

    /// <summary>The check path of an item's pick (e.g. the technology).</summary>
    public const string PickField = "pick";

    public const int DefaultTextLength = 200;
    public const int DefaultLongTextLength = 2000;
    public const int MaxChequeFiles = 3;

    /// <summary>An entry an item may pick (a technology of Masters → Technologies, or an option).</summary>
    public sealed record PickEntry(string Code, string Name, string? Description);

    /// <summary>What the checks read: today, the date the claim window opened ("certified") and whether a stored file is the unit's.</summary>
    public sealed record Context(DateOnly Today, DateOnly? CertifiedOn, Func<string, bool> FileExists);

    /// <summary>The stored file names of a document / photo value (a JSON list), empty when none.</summary>
    public static IReadOnlyList<string> Files(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return [];
        try
        {
            return JsonSerializer.Deserialize<List<string?>>(value)?.Where(n => !string.IsNullOrWhiteSpace(n)).Select(n => n!.Trim()).ToList() ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    public static string ListValue(IEnumerable<string> items) => JsonSerializer.Serialize(items.ToList());

    public static bool IsDocument(FormField f) => f.Type is "document" or "photo";

    public static int MaxFiles(FormField f) => Math.Clamp(f.MaxFiles ?? 1, 1, 3);

    /// <summary>
    /// A date bound: "today", "certified" (the claim window's opening date; none when unknown), "days:N" (earliest: N days before
    /// today; latest: N days after today) or "date:yyyy-MM-dd".
    /// </summary>
    public static DateOnly? Bound(string? bound, Context ctx, bool latest)
    {
        if (string.IsNullOrWhiteSpace(bound)) return null;
        if (bound == "today") return ctx.Today;
        if (bound == "certified") return ctx.CertifiedOn;
        if (bound.StartsWith("days:", StringComparison.Ordinal) && int.TryParse(bound[5..], NumberStyles.None, CultureInfo.InvariantCulture, out var n))
            return latest ? ctx.Today.AddDays(n) : ctx.Today.AddDays(-n);
        if (bound.StartsWith("date:", StringComparison.Ordinal) &&
            DateOnly.TryParseExact(bound[5..], "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d))
            return d;
        return null;
    }

    private static string Iso(DateOnly d) => d.ToString("dd-MM-yyyy", CultureInfo.InvariantCulture);

    /// <summary>One field's value checked by its type and limits: the value to store (null when empty) or the problem.</summary>
    public static (string? Value, string? Problem) Field(FormField f, string? raw, Context ctx)
    {
        var label = f.Label;
        var text = raw?.Trim();
        var empty = string.IsNullOrEmpty(text) || (IsDocument(f) || f.Type == "multichoice") && Files(text).Count == 0;
        if (empty) return (null, f.Required ? $"Please fill in \"{label}\"." : null);

        switch (f.Type)
        {
            case "text":
            {
                var max = Math.Min(f.MaxLength ?? DefaultTextLength, SchemeRules.MaxTextLength);
                return SchemeInput.Text(text, max) is { } s ? (s, null) : (null, $"\"{label}\": up to {max} characters on one line.");
            }
            case "longtext":
            {
                var max = Math.Min(f.MaxLength ?? DefaultLongTextLength, SchemeRules.MaxTextLength);
                return SchemeRows.CleanText(raw, max) is { } s ? (s, null) : (null, $"\"{label}\": up to {max} characters.");
            }
            case "number":
            case "amount":
            {
                if (!decimal.TryParse(text, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var v))
                    return (null, $"\"{label}\": please enter a number.");
                var amount = f.Type == "amount";
                if (amount && decimal.Round(v, 2) != v) return (null, $"\"{label}\": at most two decimals.");
                var min = f.Min ?? (amount ? 0m : decimal.MinValue);
                var max = Math.Min(f.Max ?? SchemeRules.AmountCeiling, SchemeRules.AmountCeiling);
                if (v < min || v > max)
                    return (null, f.Min is not null ? $"\"{label}\": between {Money(min)} and {Money(max)}." : $"\"{label}\": up to {Money(max)}.");
                return (Money(v), null);
            }
            case "date":
            {
                if (!DateOnly.TryParseExact(text, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) || d.Year < 1900)
                    return (null, $"\"{label}\": please enter a valid date.");
                var min = Bound(f.DateMin, ctx, latest: false);
                var max = Bound(f.DateMax, ctx, latest: true);
                if (min is { } a && d < a) return (null, max is { } b0 ? $"\"{label}\": between {Iso(a)} and {Iso(b0)}." : $"\"{label}\": on or after {Iso(a)}.");
                if (max is { } b && d > b) return (null, min is { } a0 ? $"\"{label}\": between {Iso(a0)} and {Iso(b)}." : $"\"{label}\": on or before {Iso(b)}.");
                return (d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), null);
            }
            case "choice":
                return f.Options.FirstOrDefault(o => o == text) is { } o ? (o, null) : (null, $"\"{label}\": please choose one of the options.");
            case "multichoice":
            {
                var picked = Files(text);
                if (picked.Any(p => !f.Options.Contains(p)) || picked.Distinct().Count() != picked.Count)
                    return (null, $"\"{label}\": please choose among the options.");
                return (ListValue(f.Options.Where(picked.Contains)), null);
            }
            case "yesno":
                return text is "Yes" or "No" ? (text, null) : (null, $"\"{label}\": please choose Yes or No.");
            case "document":
            case "photo":
            {
                var files = Files(text);
                var max = MaxFiles(f);
                if (files.Count > max) return (null, $"\"{label}\": up to {max} file(s).");
                if (files.Distinct(StringComparer.OrdinalIgnoreCase).Count() != files.Count) return (null, $"\"{label}\": a file is listed twice.");
                if (files.Any(n => !SchemeUploads.IsGenerated(n) || !ctx.FileExists(n))) return (null, $"\"{label}\": please upload the document again.");
                if (f.Type == "photo" && files.Any(SchemeUploads.IsPdf)) return (null, $"\"{label}\": a photo (JPG / PNG).");
                return (ListValue(files), null);
            }
            case "copy":
                return (text, null);
            default:
                return (null, $"\"{label}\": unknown field.");
        }
    }

    public static string Money(decimal v) => v.ToString("0.##", CultureInfo.InvariantCulture);

    /// <summary>The value a copy field shows: the field of the same item, or "section.field" of a plain section.</summary>
    public static string? CopyValue(FormField f, FormItem item, FormAnswers answers)
    {
        var source = f.CopyOf?.Trim();
        if (string.IsNullOrEmpty(source)) return null;
        var dot = source.IndexOf('.');
        if (dot < 0) return item.Values.GetValueOrDefault(source);
        var section = source[..dot];
        var field = source[(dot + 1)..];
        return answers.Sections.TryGetValue(section, out var items) && items.Count > 0 ? items[0].Values.GetValueOrDefault(field) : null;
    }

    /// <summary>
    /// An item checked as a whole and normalised (marked saved): its pick (from <paramref name="picks"/>, null = not checked again;
    /// once per application with NoRepeat), its fields, its copies and the section's document rules. <paramref name="index"/> is
    /// its place in the section (repeated picks are looked for in the other items).
    /// </summary>
    public static (FormItem? Item, string? Problem) Item(SchemeForm form, FormSection s, FormItem input, FormAnswers answers, int index,
        Context ctx, IReadOnlyList<PickEntry>? picks)
    {
        string? pick = null, pickName = null;
        if (s.Pick is { } p)
        {
            var label = string.IsNullOrWhiteSpace(p.Label) ? "the entry" : $"\"{p.Label}\"";
            pick = input.Pick?.Trim();
            if (string.IsNullOrEmpty(pick)) return (null, $"Please choose {label}.");
            if (picks is not null)
            {
                var entry = picks.FirstOrDefault(e => string.Equals(e.Code, pick, StringComparison.OrdinalIgnoreCase));
                if (entry is null) return (null, $"Please choose {label} from the list.");
                pick = entry.Code;
                pickName = entry.Name;
            }
            else
            {
                pickName = input.PickName;
            }
            if (p.NoRepeat && answers.Sections.TryGetValue(s.Key, out var others) &&
                others.Where((_, i) => i != index).Any(o => string.Equals(o.Pick, pick, StringComparison.OrdinalIgnoreCase)))
                return (null, $"{(pickName ?? pick)} is already added. Each entry can be added once.");
        }

        var values = new Dictionary<string, string?>();
        foreach (var f in s.Fields.Where(f => f.Type != "copy"))
        {
            var (v, problem) = Field(f, input.Values.GetValueOrDefault(f.Key), ctx);
            if (problem is not null) return (null, problem);
            values[f.Key] = v;
        }
        var item = new FormItem { Pick = pick, PickName = pickName, Values = values, Saved = true };
        foreach (var f in s.Fields.Where(f => f.Type == "copy"))
            values[f.Key] = CopyValue(f, item, answers);

        foreach (var r in form.Rules.Where(r => SectionOf(form, r)?.Key == s.Key))
        {
            var count = r.Fields.Sum(k => Files(values.GetValueOrDefault(k)).Count);
            if (count < r.Count) return (null, string.IsNullOrWhiteSpace(r.Message) ? $"Please upload at least {r.Count} of the documents." : r.Message);
        }
        return (item, null);
    }

    /// <summary>The section a document rule belongs to (the section of its first field).</summary>
    public static FormSection? SectionOf(SchemeForm form, DocumentRule r) =>
        r.Fields.Count == 0 ? null : form.Sections.FirstOrDefault(s => s.Fields.Any(f => f.Key == r.Fields[0] && IsDocument(f)));

    /// <summary>
    /// The whole form at submission: every section filled (a plain section's one item, an "Add more" section's saved items between
    /// its minimum and maximum), every item valid again (dates against today and the window), copies brought up to date. Picks are
    /// not looked up again (a technology the Admin later deactivates stays). Returns the answers to store or the first problem.
    /// </summary>
    public static (FormAnswers? Answers, string? Problem) Check(SchemeForm form, FormAnswers answers, Context ctx)
    {
        var result = new Dictionary<string, List<FormItem>>();
        // Plain sections first: the copies of the "Add more" items read them.
        var current = new FormAnswers { Sections = new(answers.Sections) };
        foreach (var s in form.Sections.OrderBy(s => s.Repeating))
        {
            var items = answers.Sections.GetValueOrDefault(s.Key) ?? [];
            if (!s.Repeating)
            {
                if (items.Count == 0) return (null, $"Please fill in the section \"{s.Title}\".");
                var (item, problem) = Item(form, s, items[0], current, 0, ctx, null);
                if (problem is not null) return (null, $"{s.Title}: {problem}");
                result[s.Key] = [item!];
                current.Sections[s.Key] = [item!];
                continue;
            }
            var saved = items.Where(i => i.Saved).ToList();
            if (saved.Count < s.MinItems) return (null, $"\"{s.Title}\": please add at least {s.MinItems}.");
            if (saved.Count > s.MaxItems) return (null, $"\"{s.Title}\": at most {s.MaxItems}.");
            var list = new List<FormItem>();
            current.Sections[s.Key] = saved;
            for (var i = 0; i < saved.Count; i++)
            {
                var (item, problem) = Item(form, s, saved[i], current, i, ctx, null);
                if (problem is not null) return (null, $"{s.Title} {i + 1}: {problem}");
                list.Add(item!);
            }
            result[s.Key] = list;
        }
        if (answers.Sections.TryGetValue(BankSection, out var bank)) result[BankSection] = bank;
        return (new FormAnswers { Sections = result }, null);
    }

    /// <summary>Every stored document of the answers with its place: (path "{section}/{item}/{field}", file name, field label).</summary>
    public static IEnumerable<(string Path, string File, string Label)> Documents(SchemeForm form, FormAnswers answers)
    {
        foreach (var s in form.Sections)
        {
            if (!answers.Sections.TryGetValue(s.Key, out var items)) continue;
            for (var i = 0; i < items.Count; i++)
                foreach (var f in s.Fields.Where(IsDocument))
                    foreach (var file in Files(items[i].Values.GetValueOrDefault(f.Key)))
                        yield return (SchemeApplications.PathOf(s.Key, i, f.Key), file, f.Label);
        }
        if (answers.Sections.TryGetValue(BankSection, out var bank) && bank.Count > 0)
            foreach (var file in Files(bank[0].Values.GetValueOrDefault(ChequeField)))
                yield return (ChequePath, file, "Cancelled cheque");
    }
}
