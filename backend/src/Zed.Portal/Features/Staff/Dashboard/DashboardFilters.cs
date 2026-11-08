using System.Text.RegularExpressions;
using Zed.Core.Data;

namespace Zed.Portal.Features.Staff.Dashboard;

/// <summary>
/// Filter values the legacy dashboard pages offered in their drop-downs. Anything else is refused, so the
/// procedures only ever receive values a user could pick on the old pages.
/// </summary>
public static partial class DashboardFilters
{
    /// <summary>State drop-down of the list pages (value = Msme.StateId, the LGD state code): the LG Directory masters.</summary>
    public static IReadOnlyDictionary<string, string> States => Masters.StateMaster.ByCode;

    /// <summary>
    /// State drop-down of the home dashboard (value = Msme.PStateName, as in that page): the masters' names and the two
    /// names of before the 2020 merger that older units still carry.
    /// </summary>
    public static IReadOnlySet<string> StateNames =>
        new HashSet<string>(Masters.StateMaster.Names.Concat(Masters.StateMaster.FormerNames), StringComparer.OrdinalIgnoreCase);

    /// <summary>The levels of the filters (ZEDX = ZED-X, migrations 0028 / 0029).</summary>
    public static string[] Certifications => [.. Zed.Core.Data.LevelRegistry.Codes];
    public static readonly string[] Sizes = ["Micro", "Small", "Medium"];
    public static readonly string[] Genders = ["male", "female", "Others"];
    public static readonly string[] SocialCategories = ["General", "SC", "ST", "OBC"];

    /// <summary>Returns null for "Show All", the value in its canonical spelling, or <paramref name="invalid"/> = true.</summary>
    public static string? Pick(string? value, IEnumerable<string> allowed, ref bool invalid)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var match = allowed.FirstOrDefault(a => string.Equals(a, value.Trim(), StringComparison.OrdinalIgnoreCase));
        if (match is null) invalid = true;
        return match;
    }

    /// <summary>ZED IDs (ZEDMSME000123, UC3250522285, ...): letters and digits only, so LIKE patterns cannot be injected.</summary>
    public static bool IsZedId(string? value) => value is { Length: >= 3 and <= 30 } && ZedIdPattern().IsMatch(value);

    [GeneratedRegex("^[A-Za-z0-9]+$")]
    private static partial Regex ZedIdPattern();

    /// <summary>Copies only the listed columns of each row (the legacy actions sent every column of the procedure).</summary>
    public static List<Dictionary<string, object?>> Pick(IEnumerable<IDictionary<string, object?>> rows, IReadOnlyCollection<string> columns) =>
        rows.Select(r => columns.ToDictionary(c => c, c => r.TryGetValue(c, out var v) && v is not DBNull ? v : null)).ToList();

    public static Dictionary<string, object?> Pick(IDictionary<string, object?>? row, IReadOnlyCollection<string> columns) =>
        columns.ToDictionary(c => c, c => row is not null && row.TryGetValue(c, out var v) && v is not DBNull ? v : null);

    public static int Int(IDictionary<string, object?>? row, string column) =>
        row is not null && int.TryParse(row.Text(column), out var n) ? n : 0;
}
