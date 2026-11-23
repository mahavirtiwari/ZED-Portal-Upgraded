using System.Data.Common;
using Microsoft.Extensions.Logging;
using Zed.Core.Data;

namespace Zed.Core.Assessment;

/// <summary>
/// 2026-11-21 (UI audit W1): the text of each requirement of a unit, taken from the level's questionnaire
/// (dbo.Requirements of that level, by parameter and requirement code) rather than from the unit's copied row. A unit's
/// requirement rows (MsmeRequirements) are copies made by the legacy procedures; on some units they hold another level's
/// text (seen on a Silver unit: requirements 7.1 to 14.1 all with one Bronze text, 6.1 with an energy requirement under
/// "Human Resource Management"), because the recovery procedure copies rows without matching the level and parameter.
/// The copy's text is kept only when the questionnaire has no text for that code.
/// 2026-11-21 (Assessment Agency UI audit, item 1): the checkpoint texts (dbo.Options.OptionName, by parameter, requirement and
/// checkpoint code) and the sub-point texts (dbo.SubOptions.SubOptionName, also by sub-point code) come from the level's
/// questionnaire the same way; migration 0108 repairs the stored copies and the legacy procedures that copied across levels.
/// 2026-11-21 (review): the same rule as 0108's repair: the level's text replaces a stored text only when the stored one is
/// empty or is ANOTHER level's text for the same codes (a cross-level copy). A stored text that differs because the Admin
/// reworded the questionnaire after the unit applied is what the unit was assessed against: it is shown as stored.
/// </summary>
public static class RequirementTexts
{
    /// <param name="master">The questionnaire's schema: "dbo" (main, surveillance) or "ZED_CONSULTANT.dbo" (handholding).</param>
    /// <summary>Every level's requirement texts (the record's level is <c>@SectionType</c>; the others tell a cross-level copy).</summary>
    public static string Sql(string master) =>
        $"SELECT LTRIM(RTRIM(SectionType)) AS SectionType, LTRIM(RTRIM(SectionCode)) AS SectionCode, LTRIM(RTRIM(RequirementCode)) AS RequirementCode, " +
        $"LTRIM(RTRIM(RequirementName)) AS RequirementName " +
        $"FROM {master}.Requirements WHERE NULLIF(LTRIM(RTRIM(RequirementName)), '') IS NOT NULL ORDER BY Id;";

    /// <summary>The level's checkpoint ("O") and sub-point ("S") texts; the first row (by Id) of a code wins, as in migration 0108.</summary>
    public static string CheckpointSql(string master) =>
        $"SELECT 'O' AS Kind, LTRIM(RTRIM(SectionType)) AS SectionType, LTRIM(RTRIM(SectionCode)) AS SectionCode, LTRIM(RTRIM(RequirementCode)) AS RequirementCode, LTRIM(RTRIM(OptionCode)) AS OptionCode, " +
        $"CAST(NULL AS varchar(50)) AS SubOptionCode, LTRIM(RTRIM(OptionName)) AS Text, Id " +
        $"FROM {master}.Options WHERE NULLIF(LTRIM(RTRIM(OptionName)), '') IS NOT NULL " +
        $"UNION ALL SELECT 'S', LTRIM(RTRIM(SectionType)), LTRIM(RTRIM(SectionCode)), LTRIM(RTRIM(RequirementCode)), LTRIM(RTRIM(OptionCode)), LTRIM(RTRIM(SubOptionCode)), LTRIM(RTRIM(SubOptionName)), Id " +
        $"FROM {master}.SubOptions WHERE NULLIF(LTRIM(RTRIM(SubOptionName)), '') IS NOT NULL " +
        $"ORDER BY Kind, Id;";

    /// <param name="SectionType">The text's level (null: the record's own, as callers that pass one level's rows).</param>
    public sealed record Row(string? SectionCode, string? RequirementCode, string? RequirementName)
    {
        /// <summary>For Dapper: the query's columns (SectionType first) do not match the positional constructor, so it fills the properties.</summary>
        public Row() : this(null, null, null) { }
        public string? SectionType { get; init; }
    }

    /// <param name="Kind">"O" a checkpoint (dbo.Options), "S" a sub-point (dbo.SubOptions).</param>
    public sealed record CheckpointRow(string? Kind, string? SectionCode, string? RequirementCode, string? OptionCode, string? SubOptionCode, string? Text)
    {
        /// <summary>For Dapper (the query also returns SectionType and Id): it fills the properties (2026-11-21 review: a real
        /// database refused the positional constructor; the fake-SQL tests could not see it).</summary>
        public CheckpointRow() : this(null, null, null, null, null, null) { }
        public string? SectionType { get; init; }
    }

    /// <summary>The level's requirement texts by parameter and requirement code.</summary>
    public sealed class Map(
        IReadOnlyDictionary<(string, string), string> texts,
        IReadOnlyDictionary<(string, string, string), string>? options = null,
        IReadOnlyDictionary<(string, string, string, string), string>? subOptions = null,
        IReadOnlySet<string>? otherLevelTexts = null)
    {
        public static readonly Map Empty = new(new Dictionary<(string, string), string>());

        /// <summary>The other levels' texts, keyed "code|code|…|text" (<see cref="OtherKey"/>), to tell a cross-level copy.</summary>
        private readonly IReadOnlySet<string> _others = otherLevelTexts ?? new HashSet<string>();

        /// <summary>
        /// The text to show: the level's when the stored one is empty or another level's text for the same codes (a cross-level
        /// copy); otherwise the stored one (also when the Admin reworded the questionnaire after the unit applied).
        /// </summary>
        private string? Pick(string? stored, string? levelText, params object?[] codes)
        {
            if (levelText is null) return null;
            var s = stored?.Trim() ?? "";
            if (s.Length == 0) return levelText;
            if (string.Equals(s, levelText, StringComparison.Ordinal)) return null;
            return _others.Contains(OtherKey(s, codes)) ? levelText : null;
        }

        private readonly IReadOnlyDictionary<(string, string, string), string> _options = options ?? new Dictionary<(string, string, string), string>();
        private readonly IReadOnlyDictionary<(string, string, string, string), string> _subOptions = subOptions ?? new Dictionary<(string, string, string, string), string>();

        public int Count => texts.Count;
        public int CheckpointCount => _options.Count;
        public int SubPointCount => _subOptions.Count;

        public string? For(object? sectionCode, object? requirementCode) =>
            texts.TryGetValue((Key(sectionCode), Key(requirementCode)), out var text) ? text : null;

        /// <summary>The level's text of a checkpoint (dbo.Options), else null.</summary>
        public string? Checkpoint(object? sectionCode, object? requirementCode, object? optionCode) =>
            _options.TryGetValue((Key(sectionCode), Key(requirementCode), Key(optionCode)), out var text) ? text : null;

        /// <summary>The level's text of a sub-point (dbo.SubOptions), else null.</summary>
        public string? SubPoint(object? sectionCode, object? requirementCode, object? optionCode, object? subOptionCode) =>
            _subOptions.TryGetValue((Key(sectionCode), Key(requirementCode), Key(optionCode), Key(subOptionCode)), out var text) ? text : null;

        /// <summary>Sets "OptionName" of each checkpoint row from its codes (the row's own text when none).</summary>
        public void AttachToCheckpoints(IEnumerable<IDictionary<string, object?>> rows)
        {
            foreach (var row in rows)
            {
                object? s = Get(row, "SectionCode"), r = Get(row, "RequirementCode"), o = Get(row, "OptionCode");
                if (Pick(Get(row, "OptionName")?.ToString(), Checkpoint(s, r, o), "O", s, r, o) is { } text) row["OptionName"] = text;
            }
        }

        /// <summary>Sets "SubOptionName" of each sub-point row from its codes (the row's own text when none).</summary>
        public void AttachToSubPoints(IEnumerable<IDictionary<string, object?>> rows)
        {
            foreach (var row in rows)
            {
                object? s = Get(row, "SectionCode"), r = Get(row, "RequirementCode"), o = Get(row, "OptionCode"), u = Get(row, "SubOptionCode");
                if (Pick(Get(row, "SubOptionName")?.ToString(), SubPoint(s, r, o, u), "S", s, r, o, u) is { } text) row["SubOptionName"] = text;
            }
        }

        /// <summary>The checkpoint answers' texts (<see cref="CheckpointAnswers.Checkpoint.Text"/>), by the requirement rows' codes.</summary>
        public IReadOnlyList<CheckpointAnswers.Checkpoint> AttachTo(IReadOnlyList<CheckpointAnswers.Checkpoint> checkpoints,
            IEnumerable<IDictionary<string, object?>> requirementRows)
        {
            if (_options.Count == 0 || checkpoints.Count == 0) return checkpoints;
            var codes = new Dictionary<long, (object?, object?)>();
            foreach (var r in requirementRows)
                if (long.TryParse(Key(Get(r, "Id")), out var id)) codes.TryAdd(id, (Get(r, "SectionCode"), Get(r, "RequirementCode")));
            return checkpoints.Select(c => codes.TryGetValue(c.RequirementId, out var k)
                && Pick(c.Text, Checkpoint(k.Item1, k.Item2, c.OptionCode), "O", k.Item1, k.Item2, c.OptionCode) is { } text
                ? c with { Text = text } : c).ToList();
        }

        private static object? Get(IDictionary<string, object?> row, string column) => row.TryGetValue(column, out var v) ? v : null;

        /// <summary>Sets "RequirementName" of each row from its SectionCode and RequirementCode (the row's own text when none).</summary>
        public void AttachTo(IEnumerable<IDictionary<string, object?>> rows, string sectionColumn = "SectionCode", string requirementColumn = "RequirementCode")
        {
            foreach (var row in rows)
            {
                var s = row.TryGetValue(sectionColumn, out var sv) ? sv : null;
                var r = row.TryGetValue(requirementColumn, out var rv) ? rv : null;
                if (Pick(Get(row, "RequirementName")?.ToString(), For(s, r), "R", s, r) is { } text) row["RequirementName"] = text;
            }
        }
    }

    public static async Task<Map> LoadAsync(ISqlExecutor db, string master, string? level, ILogger? log, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(level)) return Map.Empty;
        try
        {
            var rows = await db.QuerySqlAsync<Row>(Sql(master), new { SectionType = level.Trim() }, ct);
            IReadOnlyList<CheckpointRow> checkpoints = [];
            try { checkpoints = await db.QuerySqlAsync<CheckpointRow>(CheckpointSql(master), new { SectionType = level.Trim() }, ct); }
            catch (DbException ex) { log?.LogWarning(ex, "Checkpoint texts not readable; the unit's copies are shown"); }
            return From(rows, checkpoints, level.Trim());
        }
        catch (DbException ex)
        {
            log?.LogWarning(ex, "Requirement texts not readable; the unit's copies are shown");
            return Map.Empty;
        }
    }

    /// <summary>The first text of each parameter and requirement code (a requirement may have several rows), and of each
    /// checkpoint and sub-point code.</summary>
    /// <param name="level">The record's level: rows of another level (SectionType) only tell cross-level copies; rows without a
    /// level are the record's own.</param>
    public static Map From(IEnumerable<Row> rows, IEnumerable<CheckpointRow>? checkpoints = null, string? level = null)
    {
        bool Own(string? type) => string.IsNullOrWhiteSpace(type) || level is null || string.Equals(type.Trim(), level, StringComparison.OrdinalIgnoreCase);
        var others = new HashSet<string>(StringComparer.Ordinal);
        var map = new Dictionary<(string, string), string>();
        foreach (var r in rows)
            if (!string.IsNullOrWhiteSpace(r.RequirementName) && !string.IsNullOrWhiteSpace(r.RequirementCode))
            {
                if (Own(r.SectionType)) map.TryAdd((Key(r.SectionCode), Key(r.RequirementCode)), r.RequirementName!.Trim());
                else others.Add(OtherKey(r.RequirementName!.Trim(), ["R", r.SectionCode, r.RequirementCode]));
            }
        var options = new Dictionary<(string, string, string), string>();
        var subOptions = new Dictionary<(string, string, string, string), string>();
        foreach (var c in checkpoints ?? [])
        {
            if (string.IsNullOrWhiteSpace(c.Text) || string.IsNullOrWhiteSpace(c.RequirementCode) || string.IsNullOrWhiteSpace(c.OptionCode)) continue;
            if (!Own(c.SectionType))
            {
                others.Add(c.Kind == "S"
                    ? OtherKey(c.Text!.Trim(), ["S", c.SectionCode, c.RequirementCode, c.OptionCode, c.SubOptionCode])
                    : OtherKey(c.Text!.Trim(), ["O", c.SectionCode, c.RequirementCode, c.OptionCode]));
                continue;
            }
            if (c.Kind == "S")
            {
                if (!string.IsNullOrWhiteSpace(c.SubOptionCode))
                    subOptions.TryAdd((Key(c.SectionCode), Key(c.RequirementCode), Key(c.OptionCode), Key(c.SubOptionCode)), c.Text!.Trim());
            }
            else options.TryAdd((Key(c.SectionCode), Key(c.RequirementCode), Key(c.OptionCode)), c.Text!.Trim());
        }
        return new Map(map, options, subOptions, others);
    }

    /// <summary>"kind|codes…|text": one other-level text of a code.</summary>
    internal static string OtherKey(string text, object?[] codes) => string.Join('|', codes.Select(Key)) + "|" + text.Trim();

    private static string Key(object? code) => (code is DBNull ? null : code)?.ToString()?.Trim() ?? "";
}
