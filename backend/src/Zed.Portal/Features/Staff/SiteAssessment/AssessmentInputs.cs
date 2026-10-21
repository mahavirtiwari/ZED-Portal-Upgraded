using System.Globalization;
using System.Text.RegularExpressions;

namespace Zed.Portal.Features.Staff.SiteAssessment;

/// <summary>
/// Input checks and row shaping shared by the site-assessment and monitoring endpoints. The legacy
/// actions passed whatever the browser sent straight to the procedures and returned whole DataSets.
/// </summary>
internal static partial class AssessmentInputs
{
    /// <summary>ZED IDs (ZEDMSME000123) and agency/assessor user ids: letters, digits, underscore, up to 50.</summary>
    [GeneratedRegex(@"^[A-Za-z0-9_]{1,50}$")]
    private static partial Regex IdPattern();

    public static bool IsId(string? value) => value is not null && IdPattern().IsMatch(value);

    /// <summary>Certification levels with a site assessment (the SA branch of SP_ASSESSMENT_ALLOT_LIST excludes Bronze).</summary>
    public static readonly string[] SiteLevels = ["Silver", "Gold"];

    /// <summary>Levels on the monitoring screen.</summary>
    public static readonly string[] Levels = ["Bronze", "Silver", "Gold"];

    /// <summary>Canonical spelling ("silver" → "Silver") or null when not one of <paramref name="allowed"/>.</summary>
    public static string? Level(string? value, string[] allowed) =>
        allowed.FirstOrDefault(l => string.Equals(l, value?.Trim(), StringComparison.OrdinalIgnoreCase));

    /// <summary>yyyy-MM-dd (what an &lt;input type="date"&gt; sends).</summary>
    public static DateOnly? IsoDate(string? value) =>
        DateOnly.TryParseExact(value?.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : null;

    /// <summary>Copies the listed columns of each row (null when the procedure did not return them).</summary>
    public static List<Dictionary<string, object?>> Pick(IEnumerable<IDictionary<string, object?>> rows, IEnumerable<string> fields)
    {
        var list = fields.ToList();
        return rows.Select(row => list.ToDictionary(f => f, f => row.TryGetValue(f, out var v) && v is not DBNull ? v : null)).ToList();
    }

    public static bool Same(IDictionary<string, object?> row, string column, string value) =>
        row.TryGetValue(column, out var v) && v is not null and not DBNull &&
        string.Equals(v.ToString()?.Trim(), value, StringComparison.OrdinalIgnoreCase);

    public static int Int(IDictionary<string, object?> row, string column) =>
        row.TryGetValue(column, out var v) && v is not null and not DBNull && int.TryParse(v.ToString(), out var i) ? i : 0;

    /// <summary>
    /// An absolute http/https address without spaces or control characters, at most <paramref name="max"/>
    /// characters (meeting and recording links typed by agencies and assessors), or null. Anything else
    /// (javascript:, data:, relative paths) is refused, because the value ends up in an href.
    /// </summary>
    public static string? WebLink(string? value, int max = 2000)
    {
        var v = value?.Trim();
        if (string.IsNullOrEmpty(v) || v.Length > max || v.Any(c => char.IsWhiteSpace(c) || char.IsControl(c))) return null;
        return Uri.TryCreate(v, UriKind.Absolute, out var uri) &&
               (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp) && uri.Host.Length > 0
            ? v : null;
    }

    /// <summary>Comma-separated id list as the legacy procedures store it ("A,B"), split and trimmed.</summary>
    public static List<string> SplitIds(string? csv) =>
        (csv ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();
}
