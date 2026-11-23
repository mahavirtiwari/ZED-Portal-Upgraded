using System.Globalization;
using System.Text.RegularExpressions;

namespace Zed.Portal.Features.Staff.Fees;

/// <summary>
/// 2026-11-23 (the user: "put the new fees effect from date also for all the modules ... keep date range according amend the
/// database"): the fees of a portal are kept as dated fee sets, as Expenditure rates keeps its rate sets (migration 0112).
/// A fee set is every dbo.AssessmentFee row with the same EffectiveFrom (NULL: the set the portal started with, "initial");
/// EffectiveTo is its last day (NULL: open). The payment procedures charge the set in force today (<see cref="InForce"/>);
/// ended sets are kept as they were, so a payment's PaymentRefId still points at the amounts it was charged.
/// </summary>
public static class FeeSets
{
    /// <summary>The key of the set the portal started with (EffectiveFrom NULL).</summary>
    public const string Initial = "initial";

    public const string Past = "past";
    public const string Current = "current";
    public const string Future = "future";

    /// <summary>One set as stored: its start, its last day and its number of rows.</summary>
    public sealed class SetRow
    {
        public DateTime? EffectiveFrom { get; init; }
        public DateTime? EffectiveTo { get; init; }
        public int Rows { get; init; }
    }

    /// <param name="Key">"initial", or the date of effect (yyyy-MM-dd); the page sends it back as ?set=.</param>
    /// <param name="From">The date of effect (yyyy-MM-dd); null: since the beginning.</param>
    /// <param name="To">The last day (yyyy-MM-dd); null: no later set yet.</param>
    /// <param name="Status">past, current (in force today) or future.</param>
    public sealed record FeeSet(string Key, string? From, string? To, string Status, int Rows)
    {
        public DateOnly? FromDate => From is null ? null : DateOnly.ParseExact(From, "yyyy-MM-dd", CultureInfo.InvariantCulture);
        public DateOnly? ToDate => To is null ? null : DateOnly.ParseExact(To, "yyyy-MM-dd", CultureInfo.InvariantCulture);
    }

    public static string KeyOf(DateOnly? from) => from?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) ?? Initial;

    private static string? Day(DateTime? d) => d is { } v ? v.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : null;

    internal const string SetsSql =
        "SELECT EffectiveFrom, MAX(EffectiveTo) AS EffectiveTo, COUNT(*) AS Rows FROM dbo.AssessmentFee GROUP BY EffectiveFrom;";

    /// <summary>The columns a new set copies (every column but the identity and the two dates); names are checked before use.</summary>
    internal const string ColumnsSql =
        "SELECT name FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.AssessmentFee') AND is_identity = 0 AND is_computed = 0 " +
        "AND name NOT IN (N'EffectiveFrom', N'EffectiveTo') ORDER BY column_id;";

    /// <summary>The condition "in force today" on an AssessmentFee row (alias with its dot, or empty).</summary>
    public static string InForce(string alias = "") =>
        $"CAST(GETDATE() AS date) BETWEEN ISNULL({alias}EffectiveFrom, '19000101') AND ISNULL({alias}EffectiveTo, '99991231')";

    /// <summary>The sets in date order, each with its status on <paramref name="today"/>; no rows: the initial set, in force.</summary>
    public static List<FeeSet> Build(IReadOnlyList<SetRow> rows, DateOnly today)
    {
        if (rows.Count == 0) return [new FeeSet(Initial, null, null, Current, 0)];
        return rows.OrderBy(r => r.EffectiveFrom ?? DateTime.MinValue).Select(r =>
        {
            var from = r.EffectiveFrom is { } f ? DateOnly.FromDateTime(f) : (DateOnly?)null;
            var to = r.EffectiveTo is { } t ? DateOnly.FromDateTime(t) : (DateOnly?)null;
            var status = to < today ? Past : from > today ? Future : Current;
            return new FeeSet(KeyOf(from), Day(r.EffectiveFrom), Day(r.EffectiveTo), status, r.Rows);
        }).ToList();
    }

    /// <summary>The set a request means: its key, or with none the set in force today (else the latest that started).</summary>
    public static FeeSet? Pick(IReadOnlyList<FeeSet> sets, string? key)
    {
        if (string.IsNullOrWhiteSpace(key))
            return sets.FirstOrDefault(s => s.Status == Current) ?? sets.LastOrDefault(s => s.Status == Past) ?? sets.FirstOrDefault();
        return sets.FirstOrDefault(s => string.Equals(s.Key, key.Trim(), StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>The set a day falls in (the one a new set starting that day is copied from).</summary>
    public static FeeSet? On(IReadOnlyList<FeeSet> sets, DateOnly day) =>
        sets.FirstOrDefault(s => (s.FromDate is null || s.FromDate <= day) && (s.ToDate is null || s.ToDate >= day));

    private static readonly Regex ColumnName = new("^[A-Za-z_][A-Za-z0-9_]*$", RegexOptions.CultureInvariant);

    /// <summary>
    /// A new set from @From: the rows in force that day are copied with EffectiveFrom = @From and EffectiveTo = the day
    /// before the next set (@Next, NULL: open); then the rows they were copied from end the day before @From. One transaction.
    /// </summary>
    public static string CopySql(IReadOnlyList<string> columns)
    {
        if (columns.Count == 0 || columns.Any(c => !ColumnName.IsMatch(c)))
            throw new InvalidOperationException("dbo.AssessmentFee has an unexpected column list.");
        var list = string.Join(", ", columns.Select(c => "[" + c + "]"));
        return "SET XACT_ABORT ON; BEGIN TRANSACTION;\n" +
               $"INSERT INTO dbo.AssessmentFee ({list}, EffectiveFrom, EffectiveTo)\n" +
               $"SELECT {list}, @From, DATEADD(day, -1, @Next) FROM dbo.AssessmentFee WITH (UPDLOCK, HOLDLOCK)\n" +
               "WHERE @From BETWEEN ISNULL(EffectiveFrom, '19000101') AND ISNULL(EffectiveTo, '99991231');\n" +
               "UPDATE dbo.AssessmentFee SET EffectiveTo = DATEADD(day, -1, @From)\n" +
               "WHERE @From BETWEEN ISNULL(EffectiveFrom, '19000101') AND ISNULL(EffectiveTo, '99991231') AND ISNULL(EffectiveFrom, '19000101') < @From;\n" +
               "COMMIT;";
    }

    /// <summary>
    /// Removes a future set (none of its rows can have been charged): its rows go and the set before it runs on to the
    /// removed set's last day. One transaction; nothing changes once the set has started.
    /// </summary>
    internal const string DeleteSql =
        "SET XACT_ABORT ON; BEGIN TRANSACTION;\n" +
        "DECLARE @To date = (SELECT MAX(EffectiveTo) FROM dbo.AssessmentFee WHERE EffectiveFrom = @From);\n" +
        "DELETE FROM dbo.AssessmentFee WHERE EffectiveFrom = @From AND EffectiveFrom > CAST(GETDATE() AS date);\n" +
        "IF @@ROWCOUNT > 0 UPDATE dbo.AssessmentFee SET EffectiveTo = @To WHERE EffectiveTo = DATEADD(day, -1, @From);\n" +
        "COMMIT;";
}
