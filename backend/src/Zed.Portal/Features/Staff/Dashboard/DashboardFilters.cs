using System.Text.RegularExpressions;
using Zed.Core.Data;

namespace Zed.Portal.Features.Staff.Dashboard;

/// <summary>
/// Filter values the legacy dashboard pages offered in their drop-downs. Anything else is refused, so the
/// procedures only ever receive values a user could pick on the old pages.
/// </summary>
public static partial class DashboardFilters
{
    /// <summary>State drop-down of the list pages (value = Msme.StateId, the LGD state code).</summary>
    public static readonly IReadOnlyDictionary<string, string> States = new Dictionary<string, string>
    {
        ["35"] = "ANDAMAN AND NICOBAR ISLANDS", ["28"] = "ANDHRA PRADESH", ["12"] = "ARUNACHAL PRADESH", ["18"] = "ASSAM",
        ["10"] = "BIHAR", ["4"] = "CHANDIGARH", ["22"] = "CHHATTISGARH", ["7"] = "DELHI", ["30"] = "GOA", ["24"] = "GUJARAT",
        ["6"] = "HARYANA", ["2"] = "HIMACHAL PRADESH", ["1"] = "JAMMU AND KASHMIR", ["20"] = "JHARKHAND", ["29"] = "KARNATAKA",
        ["32"] = "KERALA", ["37"] = "LADAKH", ["31"] = "LAKSHADWEEP", ["23"] = "MADHYA PRADESH", ["27"] = "MAHARASHTRA",
        ["14"] = "MANIPUR", ["17"] = "MEGHALAYA", ["15"] = "MIZORAM", ["13"] = "NAGALAND", ["21"] = "ODISHA",
        ["34"] = "PUDUCHERRY", ["3"] = "PUNJAB", ["8"] = "RAJASTHAN", ["11"] = "SIKKIM", ["33"] = "TAMIL NADU",
        ["36"] = "TELANGANA", ["38"] = "THE DADRA AND NAGAR HAVELI AND DAMAN AND DIU", ["16"] = "TRIPURA",
        ["9"] = "UTTAR PRADESH", ["5"] = "UTTARAKHAND", ["19"] = "WEST BENGAL",
    };

    /// <summary>State drop-down of the home dashboard (value = Msme.PStateName, as in that page).</summary>
    public static readonly IReadOnlySet<string> StateNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "ANDAMAN AND NICOBAR ISLANDS", "ANDHRA PRADESH", "ARUNACHAL PRADESH", "ASSAM", "BIHAR", "CHANDIGARH", "CHHATTISGARH",
        "DADAR AND NAGAR HAVELI", "DAMAN AND DIU", "DELHI", "GOA", "GUJARAT", "HARYANA", "HIMACHAL PRADESH", "JAMMU AND KASHMIR",
        "JHARKHAND", "KARNATAKA", "KERALA", "LADAKH", "MADHYA PRADESH", "MAHARASHTRA", "MANIPUR", "MEGHALAYA", "MIZORAM",
        "NAGALAND", "ODISHA", "PUDUCHERRY", "PUNJAB", "RAJASTHAN", "SIKKIM", "TAMIL NADU", "TELANGANA", "TRIPURA",
        "UTTAR PRADESH", "UTTARAKHAND", "WEST BENGAL",
        // Names of the list pages' states that the home page did not offer (used for state-bound Ministry users).
        "LAKSHADWEEP", "THE DADRA AND NAGAR HAVELI AND DAMAN AND DIU",
    };

    public static readonly string[] Certifications = ["Bronze", "Silver", "Gold"];
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
