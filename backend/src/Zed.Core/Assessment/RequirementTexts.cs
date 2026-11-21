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
/// </summary>
public static class RequirementTexts
{
    /// <param name="master">The questionnaire's schema: "dbo" (main, surveillance) or "ZEDCS_V2_LIVE.dbo" (handholding).</param>
    public static string Sql(string master) =>
        $"SELECT LTRIM(RTRIM(SectionCode)) AS SectionCode, LTRIM(RTRIM(RequirementCode)) AS RequirementCode, LTRIM(RTRIM(RequirementName)) AS RequirementName " +
        $"FROM {master}.Requirements WHERE SectionType = @SectionType AND NULLIF(LTRIM(RTRIM(RequirementName)), '') IS NOT NULL;";

    public sealed record Row(string? SectionCode, string? RequirementCode, string? RequirementName);

    /// <summary>The level's requirement texts by parameter and requirement code.</summary>
    public sealed class Map(IReadOnlyDictionary<(string, string), string> texts)
    {
        public static readonly Map Empty = new(new Dictionary<(string, string), string>());

        public int Count => texts.Count;

        public string? For(object? sectionCode, object? requirementCode) =>
            texts.TryGetValue((Key(sectionCode), Key(requirementCode)), out var text) ? text : null;

        /// <summary>Sets "RequirementName" of each row from its SectionCode and RequirementCode (the row's own text when none).</summary>
        public void AttachTo(IEnumerable<IDictionary<string, object?>> rows, string sectionColumn = "SectionCode", string requirementColumn = "RequirementCode")
        {
            foreach (var row in rows)
                if (For(row.TryGetValue(sectionColumn, out var s) ? s : null, row.TryGetValue(requirementColumn, out var r) ? r : null) is { } text)
                    row["RequirementName"] = text;
        }
    }

    public static async Task<Map> LoadAsync(ISqlExecutor db, string master, string? level, ILogger? log, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(level)) return Map.Empty;
        try
        {
            var rows = await db.QuerySqlAsync<Row>(Sql(master), new { SectionType = level.Trim() }, ct);
            return From(rows);
        }
        catch (DbException ex)
        {
            log?.LogWarning(ex, "Requirement texts not readable; the unit's copies are shown");
            return Map.Empty;
        }
    }

    /// <summary>The first text of each parameter and requirement code (a requirement may have several rows).</summary>
    public static Map From(IEnumerable<Row> rows)
    {
        var map = new Dictionary<(string, string), string>();
        foreach (var r in rows)
            if (!string.IsNullOrWhiteSpace(r.RequirementName) && !string.IsNullOrWhiteSpace(r.RequirementCode))
                map.TryAdd((Key(r.SectionCode), Key(r.RequirementCode)), r.RequirementName!.Trim());
        return new Map(map);
    }

    private static string Key(object? code) => (code is DBNull ? null : code)?.ToString()?.Trim() ?? "";
}
