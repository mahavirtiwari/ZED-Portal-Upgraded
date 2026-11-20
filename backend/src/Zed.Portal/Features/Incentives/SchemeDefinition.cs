using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Zed.Portal.Features.Incentives;

/// <summary>
/// An incentive scheme the Admin defines (Admin → Incentives → Schemes, 2026-11-20, approved design): its dashboard card, when it
/// opens (activation), how the benefit is graded, the generic applicant form ("Add more" items, documents, the standard blocks)
/// and its verification (desktop, or desktop + onsite; correction rounds). Stored as JSON in dbo.Incentives.SchemeJson
/// (migration 0105), the row's SchemeCode = <see cref="Code"/>.
/// </summary>
public sealed record SchemeDefinition
{
    public string Code { get; init; } = "";
    public string Name { get; init; } = "";
    public bool Active { get; init; }
    public int OrderNo { get; init; }
    public SchemeCard Card { get; init; } = new();
    public SchemeActivation Activation { get; init; } = new();
    public SchemeGrading Grading { get; init; } = new();
    public SchemeForm Form { get; init; } = new();
    public SchemeVerification Verification { get; init; } = new();
}

/// <summary>The dashboard card's wording (the applicant's page heading is <see cref="Title"/>).</summary>
public sealed record SchemeCard
{
    public string Title { get; init; } = "";
    public string? Highlight { get; init; }
    public string? Details { get; init; }
    /// <summary>One of the dashboard's card icons: star, rupee, zap, award, users, building, bank, trend, pin.</summary>
    public string Icon { get; init; } = "star";
}

/// <summary>
/// When the scheme opens for a unit. <see cref="Mode"/>: <see cref="SchemeRules.Levels"/> (certified at one of
/// <see cref="Levels"/>: one claim per level and certificate), <see cref="SchemeRules.Registration"/> (once registered: one
/// claim) or <see cref="SchemeRules.Handholding"/> (Handholding completed: one claim per handholding).
/// </summary>
public sealed record SchemeActivation
{
    public string Mode { get; init; } = SchemeRules.Levels;
    public IReadOnlyList<string> Levels { get; init; } = [];
}

/// <summary>
/// The benefit: <see cref="Mode"/> <see cref="SchemeRules.ByLevel"/> (a row per level code) or <see cref="SchemeRules.BySize"/>
/// (a row per enterprise size: Micro, Small, Medium). Eligible = share % of the claim, at most the row's maximum.
/// </summary>
public sealed record SchemeGrading
{
    public string Mode { get; init; } = SchemeRules.ByLevel;
    public IReadOnlyList<SchemeGrade> Rows { get; init; } = [];
}

public sealed record SchemeGrade(string Key, decimal SharePercent, decimal MaxAmount);

/// <summary>The applicant's form: the standard blocks, the Admin's sections and the document rules.</summary>
public sealed record SchemeForm
{
    public SchemeBlocks Blocks { get; init; } = new();
    public IReadOnlyList<FormSection> Sections { get; init; } = [];
    public IReadOnlyList<DocumentRule> Rules { get; init; } = [];
}

/// <summary>
/// The standard blocks, each on or off. Their wording is in Admin → Texts (msme.scheme.disclaimer / instructions / declaration,
/// with the scheme code: msme.scheme.{CODE}.disclaimer when the Admin writes one for the scheme).
/// </summary>
public sealed record SchemeBlocks
{
    public bool Disclaimer { get; init; } = true;
    public bool Instructions { get; init; } = true;
    public bool UnitConfirm { get; init; } = true;
    /// <summary>Account no. (twice), IFSC, branch, bank and the cancelled cheque (the FA / TU checks).</summary>
    public bool BankAccount { get; init; } = true;
    public bool Declaration { get; init; } = true;
}

/// <summary>
/// A section of the form. <see cref="Repeating"/>: "Add more" items (between <see cref="MinItems"/> and <see cref="MaxItems"/>),
/// each saved on its own; an item may start by picking an entry of <see cref="Pick"/> (e.g. a technology).
/// </summary>
public sealed record FormSection
{
    public string Key { get; init; } = "";
    public string Title { get; init; } = "";
    public string? Help { get; init; }
    public bool Repeating { get; init; }
    public int MinItems { get; init; } = 1;
    public int MaxItems { get; init; } = 1;
    public PickSource? Pick { get; init; }
    public IReadOnlyList<FormField> Fields { get; init; } = [];
}

/// <summary>
/// What an item picks: <see cref="Kind"/> <see cref="SchemeRules.PickTechnologies"/> (Masters → Technologies; with
/// <see cref="SectorFilter"/> only those of the unit's NIC sector) or <see cref="SchemeRules.PickOptions"/> (<see cref="Options"/>).
/// <see cref="NoRepeat"/>: an entry can be picked once per application.
/// </summary>
public sealed record PickSource
{
    public string Kind { get; init; } = SchemeRules.PickOptions;
    public string Label { get; init; } = "";
    public IReadOnlyList<string> Options { get; init; } = [];
    public bool SectorFilter { get; init; } = true;
    public bool NoRepeat { get; init; } = true;
}

/// <summary>
/// A field. <see cref="Type"/>: text, longtext, number, amount, date, choice, multichoice, yesno, copy, document, photo
/// (<see cref="SchemeRules.FieldTypes"/>). Limits by type: <see cref="MaxLength"/> (text), <see cref="Min"/> / <see cref="Max"/>
/// (number, amount), <see cref="DateMin"/> / <see cref="DateMax"/> (date: "today", "certified", "days:N", "date:yyyy-MM-dd"),
/// <see cref="Options"/> (choice, multichoice), <see cref="CopyOf"/> (copy: an earlier field key of the same section, or
/// "section.field"), <see cref="MaxFiles"/> (document, photo: 1–3). <see cref="IsClaim"/>: an amount that adds up to the claim.
/// <see cref="AssessorChecks"/>: the desktop (or onsite) assessor marks the answer valid / not valid.
/// </summary>
public sealed record FormField
{
    public string Key { get; init; } = "";
    public string Label { get; init; } = "";
    public string? Help { get; init; }
    public string Type { get; init; } = "text";
    public bool Required { get; init; } = true;
    public bool AssessorChecks { get; init; }
    public int? MaxLength { get; init; }
    public decimal? Min { get; init; }
    public decimal? Max { get; init; }
    public string? DateMin { get; init; }
    public string? DateMax { get; init; }
    public IReadOnlyList<string> Options { get; init; } = [];
    public string? CopyOf { get; init; }
    public bool IsClaim { get; init; }
    public int? MaxFiles { get; init; }
    /// <summary>
    /// 2026-11-20 (phase 2): who checks the answer when <see cref="AssessorChecks"/>: "desktop" (default), "onsite" (the onsite
    /// assessor in the app) or "both" (<see cref="SchemeRules.CheckStages"/>).
    /// </summary>
    public string? CheckStage { get; init; }
}

/// <summary>
/// A rule across documents: <see cref="Kind"/> "AtLeast" (at least <see cref="Count"/> files among <see cref="Fields"/>, keys of
/// document fields of the same section, e.g. FA's CA certificate + invoice ≥ 2).
/// </summary>
public sealed record DocumentRule(string Kind, int Count, IReadOnlyList<string> Fields, string? Message);

/// <summary>
/// The verification: <see cref="Flow"/> <see cref="SchemeRules.Desktop"/> or <see cref="SchemeRules.DesktopOnsite"/> (onsite in
/// the assessor app: phase 2). Correction rounds: at most <see cref="CorrectionRounds"/>, each answered within
/// <see cref="CorrectionDays"/> days; then (or when the last round is still not valid) rejected automatically. Allotment:
/// round robin (<see cref="AutoAllot"/>) among the agencies ticked for the scheme, by the unit's states and sectors.
/// </summary>
public sealed record SchemeVerification
{
    public string Flow { get; init; } = SchemeRules.Desktop;
    public int CorrectionRounds { get; init; } = 2;
    public int CorrectionDays { get; init; } = 30;
    public bool AutoAllot { get; init; } = true;
    /// <summary>2026-11-20 (phase 2): the onsite assessor's photos of each "Add more" item (or of a plain section): 0–5 / 1–5.</summary>
    public int OnsitePhotosMin { get; init; } = 1;
    public int OnsitePhotosMax { get; init; } = 3;
}

/// <summary>The fixed vocabulary of the definitions, the JSON options and the Admin's checks.</summary>
public static partial class SchemeRules
{
    public const string Levels = "Levels";
    public const string Registration = "Registration";
    public const string Handholding = "Handholding";
    public static readonly IReadOnlyList<string> ActivationModes = [Levels, Registration, Handholding];

    public const string ByLevel = "Level";
    public const string BySize = "Size";
    public static readonly IReadOnlyList<string> Sizes = ["Micro", "Small", "Medium"];

    public const string Desktop = "Desktop";
    public const string DesktopOnsite = "DesktopOnsite";

    public const string StageDesktop = "desktop";
    public const string StageOnsite = "onsite";
    public const string StageBoth = "both";
    public static readonly IReadOnlyList<string> CheckStages = [StageDesktop, StageOnsite, StageBoth];

    /// <summary>The stage that checks a field (desktop when not set).</summary>
    public static string StageOf(FormField f) => CheckStages.Contains(f.CheckStage ?? "") ? f.CheckStage! : StageDesktop;

    /// <summary>The desktop assessor checks the field (Desktop flow: every checked field).</summary>
    public static bool DesktopChecks(FormField f, string flow) => f.AssessorChecks && (flow == Desktop || StageOf(f) != StageOnsite);

    /// <summary>The onsite assessor checks the field (Desktop + Onsite flow only).</summary>
    public static bool OnsiteChecks(FormField f, string flow) => f.AssessorChecks && flow == DesktopOnsite && StageOf(f) != StageDesktop;

    public const string PickTechnologies = "Technologies";
    public const string PickOptions = "Options";

    public static readonly IReadOnlyList<string> FieldTypes =
        ["text", "longtext", "number", "amount", "date", "choice", "multichoice", "yesno", "copy", "document", "photo"];

    public const int MaxSections = 10;
    public const int MaxFields = 40;
    public const int MaxItemsLimit = 50;
    public const int MaxOptions = 50;
    public const int MaxTextLength = 4000;
    /// <summary>The largest amount a field accepts (10 crore, as FA / TU).</summary>
    public const decimal AmountCeiling = 100_000_000m;
    /// <summary>A document file: PDF / JPEG / PNG up to 5 MB (SchemeUploads).</summary>
    public const int MaxFileMb = 5;

    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    [GeneratedRegex(@"^[A-Z][A-Z0-9_]{1,39}$")]
    public static partial Regex CodePattern();

    [GeneratedRegex(@"^[a-z][a-z0-9_]{0,39}$")]
    public static partial Regex KeyPattern();

    [GeneratedRegex(@"^(today|certified|days:\d{1,4}|date:\d{4}-\d{2}-\d{2})$")]
    public static partial Regex DateBoundPattern();

    public static SchemeDefinition? Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { return JsonSerializer.Deserialize<SchemeDefinition>(json, Json); }
        catch (JsonException) { return null; }
    }

    public static string Serialize(SchemeDefinition d) => JsonSerializer.Serialize(d, Json);

    /// <summary>The first problem of a definition the Admin saves, or null.</summary>
    public static string? Problem(SchemeDefinition? d, IReadOnlyCollection<string> levelCodes)
    {
        if (d is null) return "Please fill in the scheme.";
        if (!CodePattern().IsMatch(d.Code ?? "")) return "The code: 2–40 capital letters, digits or _ , starting with a letter.";
        if (string.IsNullOrWhiteSpace(d.Name) || d.Name.Length > 200) return "The name is required (up to 200 characters).";
        if (string.IsNullOrWhiteSpace(d.Card?.Title) || d.Card.Title.Length > 200) return "The card title is required (up to 200 characters).";
        if ((d.Card.Highlight?.Length ?? 0) > 300 || (d.Card.Details?.Length ?? 0) > 2000) return "The card's highlight (300) or details (2000) are too long.";

        if (!ActivationModes.Contains(d.Activation?.Mode)) return "Choose when the scheme opens.";
        if (d.Activation!.Mode == Levels)
        {
            if (d.Activation.Levels.Count == 0) return "Choose at least one certification level the scheme opens after.";
            if (d.Activation.Levels.FirstOrDefault(l => !levelCodes.Contains(l, StringComparer.OrdinalIgnoreCase)) is { } bad) return $"Unknown level {bad}.";
        }

        if (d.Grading?.Mode is not (ByLevel or BySize)) return "Choose how the benefit is graded.";
        if (d.Grading.Rows.Count == 0) return "Add the share % and maximum of at least one row.";
        foreach (var g in d.Grading.Rows)
        {
            // By level: a level code, or "All" (every level), "Registration" / "Handholding" (the schemes that open then).
            var known = d.Grading.Mode == BySize ? Sizes.Contains(g.Key)
                : levelCodes.Contains(g.Key, StringComparer.OrdinalIgnoreCase) || g.Key is "All" or Registration or Handholding;
            if (!known) return $"Grading: unknown row {g.Key}.";
            if (g.SharePercent is < 0 or > 100) return $"Grading {g.Key}: the share is 0–100 %.";
            if (g.MaxAmount is < 0 || g.MaxAmount > AmountCeiling) return $"Grading {g.Key}: the maximum is 0 to 10 crore.";
        }
        if (d.Grading.Rows.GroupBy(g => g.Key, StringComparer.OrdinalIgnoreCase).Any(g => g.Count() > 1)) return "Grading: a row is listed twice.";

        if (d.Verification?.Flow is not (Desktop or DesktopOnsite)) return "Choose the verification flow.";
        if (d.Verification.CorrectionRounds is < 0 or > 5) return "Correction rounds: 0 to 5.";
        if (d.Verification.CorrectionDays is < 1 or > 180) return "Correction days: 1 to 180.";
        if (d.Verification.OnsitePhotosMin is < 0 or > 5 || d.Verification.OnsitePhotosMax is < 1 or > 5 || d.Verification.OnsitePhotosMin > d.Verification.OnsitePhotosMax)
            return "Onsite photos per item: 0–5 at least, 1–5 at most, the minimum not above the maximum.";

        return FormProblem(d.Form);
    }

    public static string? FormProblem(SchemeForm? f)
    {
        if (f is null || f.Sections.Count == 0) return "Add at least one section to the form.";
        if (f.Sections.Count > MaxSections) return $"At most {MaxSections} sections.";
        var sectionKeys = new HashSet<string>();
        var claims = 0;
        foreach (var s in f.Sections)
        {
            if (!KeyPattern().IsMatch(s.Key ?? "") || !sectionKeys.Add(s.Key!)) return $"Section \"{s.Title}\": invalid or repeated key.";
            if (string.IsNullOrWhiteSpace(s.Title) || s.Title.Length > 200) return "Every section needs a title (up to 200 characters).";
            if (s.Repeating && (s.MinItems < 0 || s.MaxItems < 1 || s.MaxItems > MaxItemsLimit || s.MinItems > s.MaxItems))
                return $"Section \"{s.Title}\": items between 0 and {MaxItemsLimit}, the minimum not above the maximum.";
            if (s.Pick is { } p)
            {
                if (!s.Repeating) return $"Section \"{s.Title}\": a pick list belongs to an \"Add more\" section.";
                if (p.Kind is not (PickTechnologies or PickOptions)) return $"Section \"{s.Title}\": choose what an item picks.";
                if (p.Kind == PickOptions && (p.Options.Count == 0 || p.Options.Count > MaxOptions)) return $"Section \"{s.Title}\": 1–{MaxOptions} options to pick from.";
            }
            if (s.Fields.Count == 0) return $"Section \"{s.Title}\": add at least one field.";
            if (s.Fields.Count > MaxFields) return $"Section \"{s.Title}\": at most {MaxFields} fields.";
            var keys = new HashSet<string>();
            foreach (var x in s.Fields)
            {
                if (!KeyPattern().IsMatch(x.Key ?? "") || !keys.Add(x.Key!)) return $"\"{x.Label}\": invalid or repeated field key.";
                if (string.IsNullOrWhiteSpace(x.Label) || x.Label.Length > 200) return "Every field needs a label (up to 200 characters).";
                if (!FieldTypes.Contains(x.Type)) return $"\"{x.Label}\": unknown type.";
                if (x.MaxLength is < 1 or > MaxTextLength) return $"\"{x.Label}\": the length is 1–{MaxTextLength}.";
                if (x.Min is { } mn && x.Max is { } mx && mn > mx) return $"\"{x.Label}\": the minimum is above the maximum.";
                if (x.DateMin is { } dmin && !DateBoundPattern().IsMatch(dmin)) return $"\"{x.Label}\": invalid earliest date.";
                if (x.DateMax is { } dmax && !DateBoundPattern().IsMatch(dmax)) return $"\"{x.Label}\": invalid latest date.";
                if (x.Type is "choice" or "multichoice" && (x.Options.Count == 0 || x.Options.Count > MaxOptions || x.Options.Any(o => string.IsNullOrWhiteSpace(o) || o.Length > 100)))
                    return $"\"{x.Label}\": 1–{MaxOptions} options of up to 100 characters.";
                if (x.Type == "copy" && string.IsNullOrWhiteSpace(x.CopyOf)) return $"\"{x.Label}\": choose the field it copies.";
                if (x.Type is "document" or "photo" && x.MaxFiles is < 1 or > 3) return $"\"{x.Label}\": 1–3 files.";
                if (x.IsClaim && x.Type != "amount") return $"\"{x.Label}\": only an amount can be the claim.";
                if (x.CheckStage is { } stage && !CheckStages.Contains(stage)) return $"\"{x.Label}\": checked at desktop, onsite or both.";
                if (x.IsClaim) claims++;
            }
        }
        if (claims == 0) return "Mark one amount field as the claim.";
        foreach (var r in f.Rules)
        {
            if (r.Kind != "AtLeast" || r.Count < 1 || r.Fields.Count == 0) return "A document rule needs a count and its documents.";
            var all = f.Sections.SelectMany(s => s.Fields).Where(x => x.Type is "document" or "photo").Select(x => x.Key).ToHashSet();
            if (r.Fields.Any(k => !all.Contains(k))) return "A document rule names a field that is not a document.";
        }
        return null;
    }
}
