using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging;
using Zed.Core.Data;

namespace Zed.Core.Forms;

/// <summary>
/// A question of the ESG checklist. <paramref name="Id"/> is the code the answers are stored under (null: a new
/// question, given the next free code on save). A top-level question is a single choice; its follow-ups are shown when
/// the answer is <see cref="EsgFollowUp.ShowOn"/> (Yes or No: the answers have one "if yes" and one "if no" column).
/// </summary>
public sealed record EsgQuestion(int? Id, string Question, IReadOnlyList<string> Options, IReadOnlyList<EsgFollowUp> FollowUps);

/// <summary>A follow-up question: a single choice or a text box (<see cref="EsgChecklistRules.Types"/>).</summary>
public sealed record EsgFollowUp(int? Id, string ShowOn, string Question, string Type, IReadOnlyList<string> Options);

public sealed record EsgSection(string Title, IReadOnlyList<EsgQuestion> Questions);

/// <summary>The checklist: always two sections, the ESG one and the Social / OHS one (the apps send them as two lists).</summary>
public sealed record EsgChecklistDefinition(IReadOnlyList<EsgSection> Sections);

/// <summary>The Admin's checklist as stored (dbo.V4EsgChecklist, migration 0022).</summary>
public sealed record EsgChecklistRow(int Revision, string ChecklistJson, string? UpdatedBy, DateTime? UpdatedOn);

/// <summary>The checklist the apps get: the Admin's, or the standard one.</summary>
public sealed record EffectiveEsgChecklist(EsgChecklistDefinition Definition, bool Customised, string Version, string? UpdatedBy, DateTime? UpdatedOn);

/// <summary>What the apps can fill in and send back (mobile/apps/msme/src/esg.ts): the checks of an Admin's checklist.</summary>
public static class EsgChecklistRules
{
    public const string SingleChoice = "single_choice";
    public const string TextBox = "text_box";
    public static readonly string[] Types = [SingleChoice, TextBox];
    public static readonly string[] ShowOnValues = ["Yes", "No"];

    public const int MaxQuestionsPerSection = 50;
    public const int MaxOptions = 6;
    public const int MaxQuestionLength = 500;
    public const int MaxOptionLength = 50;
    public const int MaxTitleLength = 100;

    /// <summary>
    /// Checks the Admin's checklist and gives the new questions their codes: the next after every code used so far
    /// (the saved and the standard checklist's too), so that a code never names two different questions.
    /// </summary>
    public static (EsgChecklistDefinition? Checklist, string? Error) Check(EsgChecklistDefinition? input, params EsgChecklistDefinition[] earlier)
    {
        if (input?.Sections is not { Count: 2 } sections) return (null, "The checklist has two sections: ESG and Social / OHS.");
        var used = new HashSet<int>();
        var next = earlier.SelectMany(Ids).Concat(sections.SelectMany(s => s.Questions ?? []).SelectMany(QuestionIds)).DefaultIfEmpty(0).Max() + 1;
        var result = new List<EsgSection>();
        for (var si = 0; si < sections.Count; si++)
        {
            var section = sections[si];
            var title = section?.Title?.Trim() ?? "";
            if (title.Length is 0 or > MaxTitleLength) return (null, $"Please enter the title of section {si + 1} (up to {MaxTitleLength} characters).");
            if (section!.Questions is not { Count: > 0 } questions) return (null, $"The section \"{title}\" needs at least one question.");
            if (questions.Count > MaxQuestionsPerSection) return (null, $"A section can have up to {MaxQuestionsPerSection} questions.");
            var checkedQuestions = new List<EsgQuestion>();
            for (var qi = 0; qi < questions.Count; qi++)
            {
                var q = questions[qi];
                var where = $"{title}, question {qi + 1}";
                var text = q?.Question?.Trim() ?? "";
                if (text.Length is 0 or > MaxQuestionLength) return (null, $"{where}: please enter the question (up to {MaxQuestionLength} characters).");
                var (options, optionError) = CheckOptions(q!.Options, where);
                if (optionError is not null) return (null, optionError);
                if (!TakeId(q.Id, used, ref next, out var id)) return (null, $"{where}: the code {q.Id} is used twice.");
                var followUps = new List<EsgFollowUp>();
                foreach (var f in q.FollowUps ?? [])
                {
                    var fWhere = $"{where}, follow-up";
                    if (f is null) continue;
                    var showOn = ShowOnValues.FirstOrDefault(v => string.Equals(v, f.ShowOn?.Trim(), StringComparison.OrdinalIgnoreCase));
                    if (showOn is null) return (null, $"{fWhere}: it is shown on Yes or on No.");
                    if (!options!.Contains(showOn)) return (null, $"{fWhere}: the question has no \"{showOn}\" option to show it on.");
                    if (followUps.Any(x => x.ShowOn == showOn)) return (null, $"{where}: only one follow-up can be shown on {showOn}.");
                    var fText = f.Question?.Trim() ?? "";
                    if (fText.Length is 0 or > MaxQuestionLength) return (null, $"{fWhere}: please enter the question (up to {MaxQuestionLength} characters).");
                    var type = Types.FirstOrDefault(t => string.Equals(t, f.Type?.Trim(), StringComparison.OrdinalIgnoreCase));
                    if (type is null) return (null, $"{fWhere}: please choose single choice or text box.");
                    IReadOnlyList<string> fOptions = [];
                    if (type == SingleChoice)
                    {
                        (var o, var e) = CheckOptions(f.Options, fWhere);
                        if (e is not null) return (null, e);
                        fOptions = o!;
                    }
                    if (!TakeId(f.Id, used, ref next, out var fId)) return (null, $"{fWhere}: the code {f.Id} is used twice.");
                    followUps.Add(new EsgFollowUp(fId, showOn, fText, type, fOptions));
                }
                checkedQuestions.Add(new EsgQuestion(id, text, options!, followUps));
            }
            result.Add(new EsgSection(title, checkedQuestions));
        }
        return (new EsgChecklistDefinition(result), null);
    }

    private static (IReadOnlyList<string>? Options, string? Error) CheckOptions(IReadOnlyList<string>? input, string where)
    {
        var options = (input ?? []).Select(o => o?.Trim() ?? "").ToList();
        if (options.Count is < 2 or > MaxOptions) return (null, $"{where}: give 2 to {MaxOptions} options.");
        if (options.Any(o => o.Length is 0 or > MaxOptionLength)) return (null, $"{where}: an option is empty or longer than {MaxOptionLength} characters.");
        if (options.Distinct(StringComparer.OrdinalIgnoreCase).Count() != options.Count) return (null, $"{where}: the options must differ.");
        // The apps compare the answer with "Yes" / "No" as written.
        return (options.Select(o => ShowOnValues.FirstOrDefault(v => string.Equals(v, o, StringComparison.OrdinalIgnoreCase)) ?? o).ToList(), null);
    }

    private static bool TakeId(int? given, HashSet<int> used, ref int next, out int id)
    {
        id = given is > 0 ? given.Value : next++;
        return used.Add(id);
    }

    private static IEnumerable<int> QuestionIds(EsgQuestion? q) =>
        q is null ? [] : new[] { q.Id ?? 0 }.Concat((q.FollowUps ?? []).Select(f => f?.Id ?? 0));

    internal static IEnumerable<int> Ids(EsgChecklistDefinition d) => d.Sections.SelectMany(s => s.Questions).SelectMany(QuestionIds);
}

/// <summary>The checklist in the apps' JSON (the old EnvironmentalChecklist.json), and back.</summary>
public static class EsgChecklistFormat
{
    private static readonly JsonSerializerOptions StoreOptions = new(JsonSerializerDefaults.Web);

    private static readonly Lazy<EsgChecklistDefinition> StandardChecklist = new(() => FromAppJson(EsgChecklistJson.Text));

    /// <summary>The standard checklist (EsgChecklistJson).</summary>
    public static EsgChecklistDefinition Standard => StandardChecklist.Value;

    public const string StandardVersion = "1.7";

    public static string ToStore(EsgChecklistDefinition d) => JsonSerializer.Serialize(d, StoreOptions);

    public static EsgChecklistDefinition? FromStore(string json) => JsonSerializer.Deserialize<EsgChecklistDefinition>(json, StoreOptions);

    /// <summary>Reads the apps' JSON (dependent fields of a dependent field are not used by the apps and are left out).</summary>
    public static EsgChecklistDefinition FromAppJson(string json)
    {
        var root = JsonNode.Parse(json)!.AsObject();
        static IReadOnlyList<string> Options(JsonNode? n) => n?.AsArray().Select(o => o!.GetValue<string>()).ToList() ?? [];
        static int? Id(JsonNode? n) => int.TryParse(n?.ToString(), out var i) ? i : null;
        var sections = root["sections"]!.AsArray().Select(s => new EsgSection(
            s!["section_title"]?.GetValue<string>() ?? "",
            s["fields"]!.AsArray().Select(f => new EsgQuestion(
                Id(f!["id"]), f["question"]?.GetValue<string>() ?? "", Options(f["options"]),
                (f["dependent_fields"]?.AsArray() ?? []).Select(d => new EsgFollowUp(
                    Id(d!["id"]), d["selected_option"]?.GetValue<string>() ?? "", d["question"]?.GetValue<string>() ?? "",
                    d["type"]?.GetValue<string>() ?? EsgChecklistRules.SingleChoice, Options(d["options"]))).ToList())).ToList())).ToList();
        return new EsgChecklistDefinition(sections);
    }

    /// <summary>The apps' JSON, field for field as the old file (strings for ids and flags, its spellings included).</summary>
    public static string ToAppJson(EsgChecklistDefinition d, string version)
    {
        static JsonArray Options(IEnumerable<string> options) => new(options.Select(o => (JsonNode)JsonValue.Create(o)!).ToArray());
        var root = new JsonObject
        {
            ["version"] = version,
            ["user_name"] = "",
            ["certification_type"] = "",
            ["sections"] = new JsonArray(d.Sections.Select(s => (JsonNode)new JsonObject
            {
                ["section_title"] = s.Title,
                ["fields"] = new JsonArray(s.Questions.Select(q => (JsonNode)new JsonObject
                {
                    ["id"] = q.Id.ToString(),
                    ["type"] = EsgChecklistRules.SingleChoice,
                    ["selected_option"] = "",
                    ["question"] = q.Question,
                    ["options"] = Options(q.Options),
                    ["answer"] = "",
                    ["is_visable"] = "true",
                    ["dependent_fields"] = new JsonArray(q.FollowUps.Select(f => (JsonNode)new JsonObject
                    {
                        ["id"] = f.Id.ToString(),
                        ["type"] = f.Type,
                        ["selected_option"] = f.ShowOn,
                        ["question"] = f.Question,
                        ["options"] = Options(f.Options),
                        ["answer"] = "",
                        ["is_visable"] = "false",
                        ["dependent_fields"] = new JsonArray(),
                    }).ToArray()),
                }).ToArray()),
            }).ToArray()),
        };
        return root.ToJsonString(new JsonSerializerOptions { WriteIndented = true });
    }
}

public interface IEsgChecklistStore
{
    /// <summary>The Admin's checklist, or null (the standard one; also when migration 0022 is not applied).</summary>
    Task<EsgChecklistRow?> GetAsync(CancellationToken ct = default);

    Task SaveAsync(string checklistJson, string userId, CancellationToken ct = default);

    /// <summary>Back to the standard checklist (the row is removed).</summary>
    Task ResetAsync(CancellationToken ct = default);
}

public sealed class SqlEsgChecklistStore(ISqlExecutor db, ILogger<SqlEsgChecklistStore> log) : IEsgChecklistStore
{
    internal const string Key = "esg";
    private static readonly TimeSpan Lifetime = TimeSpan.FromSeconds(30);
    private sealed record Cached(EsgChecklistRow? Row, DateTime Until);
    private volatile Cached? cached;

    public async Task<EsgChecklistRow?> GetAsync(CancellationToken ct = default)
    {
        if (cached is { } c && c.Until > DateTime.UtcNow) return c.Row;
        EsgChecklistRow? row;
        try
        {
            var rows = await db.QuerySqlAsync<EsgChecklistRow>(
                "SELECT Revision, ChecklistJson, UpdatedBy, UpdatedOn FROM dbo.V4EsgChecklist WHERE ChecklistKey = @Key;", new { Key }, ct);
            row = rows.Count > 0 ? rows[0] : null;
        }
        catch (SqlException ex)
        {
            log.LogWarning(ex, "Could not read dbo.V4EsgChecklist (is migration 0022 applied?); the standard ESG checklist is served.");
            row = null;
        }
        cached = new Cached(row, DateTime.UtcNow + Lifetime);
        return row;
    }

    public async Task SaveAsync(string checklistJson, string userId, CancellationToken ct = default)
    {
        await db.ExecuteSqlAsync(
            "MERGE dbo.V4EsgChecklist AS t USING (SELECT @Key AS ChecklistKey) AS s ON t.ChecklistKey = s.ChecklistKey " +
            "WHEN MATCHED THEN UPDATE SET Revision = t.Revision + 1, ChecklistJson = @Json, UpdatedBy = @UpdatedBy, UpdatedOn = SYSUTCDATETIME() " +
            "WHEN NOT MATCHED THEN INSERT (ChecklistKey, ChecklistJson, UpdatedBy) VALUES (@Key, @Json, @UpdatedBy);",
            new { Key, Json = checklistJson, UpdatedBy = userId.Length <= 50 ? userId : userId[..50] }, ct);
        cached = null;
    }

    public async Task ResetAsync(CancellationToken ct = default)
    {
        await db.ExecuteSqlAsync("DELETE FROM dbo.V4EsgChecklist WHERE ChecklistKey = @Key;", new { Key }, ct);
        cached = null;
    }
}

/// <summary>The ESG checklist of this system: the Admin's, or the standard one.</summary>
public sealed class EsgChecklists(IEsgChecklistStore store, ILogger<EsgChecklists> log)
{
    public IEsgChecklistStore Store => store;

    public async Task<EffectiveEsgChecklist> GetAsync(CancellationToken ct = default)
    {
        if (await store.GetAsync(ct) is { } row)
        {
            try
            {
                if (EsgChecklistFormat.FromStore(row.ChecklistJson) is { Sections.Count: 2 } d)
                    return new EffectiveEsgChecklist(d, true, Version(row.Revision), row.UpdatedBy, row.UpdatedOn);
            }
            catch (JsonException ex)
            {
                log.LogError(ex, "dbo.V4EsgChecklist holds a checklist that cannot be read; the standard one is served.");
            }
        }
        return new EffectiveEsgChecklist(EsgChecklistFormat.Standard, false, EsgChecklistFormat.StandardVersion, null, null);
    }

    /// <summary>The apps' JSON of the Admin's checklist, or null when there is none (the standard one or the old file applies).</summary>
    public async Task<string?> SavedAppJsonAsync(CancellationToken ct = default)
    {
        var c = await GetAsync(ct);
        return c.Customised ? EsgChecklistFormat.ToAppJson(c.Definition, c.Version) : null;
    }

    /// <summary>The version the apps see: changes with every save, so an app holding an older form can tell.</summary>
    internal static string Version(int revision) => $"{EsgChecklistFormat.StandardVersion}.{revision}";
}
