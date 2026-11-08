using System.Data.Common;
using Microsoft.Extensions.Logging;
using Zed.Core.Data;

namespace Zed.Core.Assessment;

/// <summary>
/// The video the Admin gave a requirement (Questionnaire → Requirements, dbo.Requirements.VideoUrl, migration 0056), for every
/// screen that lists a unit's requirements (2026-11-08): the MSME's pages and app, the desktop, site and remote assessment,
/// the review pages, handholding and the assessor and consultant apps. A unit's requirement rows are copies, so the video is
/// found by level, parameter and requirement code. Only http(s) addresses; none before migration 0056.
/// </summary>
public static class RequirementVideos
{
    /// <param name="master">The questionnaire's schema: "dbo" (main, surveillance) or "ZEDCS_V2_LIVE.dbo" (handholding).</param>
    public static string Sql(string master) =>
        $"SELECT LTRIM(RTRIM(SectionCode)) AS SectionCode, LTRIM(RTRIM(RequirementCode)) AS RequirementCode, LTRIM(RTRIM(VideoUrl)) AS VideoUrl " +
        $"FROM {master}.Requirements WHERE SectionType = @SectionType AND NULLIF(LTRIM(RTRIM(VideoUrl)), '') IS NOT NULL;";

    public sealed record Row(string? SectionCode, string? RequirementCode, string? VideoUrl);

    /// <summary>The level's videos by parameter and requirement code.</summary>
    public sealed class Map(IReadOnlyDictionary<(string, string), string> videos)
    {
        public static readonly Map Empty = new(new Dictionary<(string, string), string>());

        public int Count => videos.Count;

        public string? For(object? sectionCode, object? requirementCode) =>
            videos.TryGetValue((Key(sectionCode), Key(requirementCode)), out var url) ? url : null;

        /// <summary>Adds "VideoUrl" to each row from its SectionCode and RequirementCode.</summary>
        public void AttachTo(IEnumerable<IDictionary<string, object?>> rows, string sectionColumn = "SectionCode", string requirementColumn = "RequirementCode")
        {
            foreach (var row in rows)
                row["VideoUrl"] = For(row.TryGetValue(sectionColumn, out var s) ? s : null, row.TryGetValue(requirementColumn, out var r) ? r : null);
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
            log?.LogWarning(ex, "Requirement videos not readable (is migration 0056 applied?)");
            return Map.Empty;
        }
    }

    public static Map From(IEnumerable<Row> rows)
    {
        var map = new Dictionary<(string, string), string>();
        foreach (var r in rows)
            if (IsWebAddress(r.VideoUrl) && !string.IsNullOrWhiteSpace(r.RequirementCode))
                map.TryAdd((Key(r.SectionCode), Key(r.RequirementCode)), r.VideoUrl!.Trim());
        return new Map(map);
    }

    public static bool IsWebAddress(string? url) =>
        Uri.TryCreate(url?.Trim(), UriKind.Absolute, out var u) && (u.Scheme == Uri.UriSchemeHttps || u.Scheme == Uri.UriSchemeHttp);

    private static string Key(object? code) => (code is DBNull ? null : code)?.ToString()?.Trim() ?? "";
}
