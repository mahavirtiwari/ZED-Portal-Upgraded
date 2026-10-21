using System.Globalization;
using Zed.Core.Data;

namespace Zed.Main.MobileApi;

/// <summary>Row reads that behave like the old <c>Convert.ToInt32(row["X"].ToString())</c> but never throw.</summary>
public static class MobileRows
{
    public static int Int(this IDictionary<string, object?> row, string column)
    {
        var text = row.Text(column);
        if (int.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out var v)) return v;
        return decimal.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? (int)d : 0;
    }

    public static bool Bool(this IDictionary<string, object?> row, string column)
    {
        if (!row.TryGetValue(column, out var v) || v is null or DBNull) return false;
        if (v is bool b) return b;
        var s = v.ToString()!.Trim();
        return s.Equals("true", StringComparison.OrdinalIgnoreCase) || s == "1";
    }

    /// <summary>First row of a result set, or an empty row when the set is missing or empty.</summary>
    public static IDictionary<string, object?> FirstRow(this ResultSets sets, int index) =>
        index < sets.Count && sets[index].Count > 0 ? sets[index][0] : new Dictionary<string, object?>();
}
