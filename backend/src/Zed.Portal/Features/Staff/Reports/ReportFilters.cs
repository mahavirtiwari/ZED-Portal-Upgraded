using System.Globalization;

namespace Zed.Portal.Features.Staff.Reports;

/// <summary>
/// 2026-11-26 (the user: "Please put filters like statuses, date range, size, gender, etc." on Reports): the filters a report's
/// download applies to its rows. The reports are the legacy procedures, each with its own columns (most build them at run time),
/// so a filter applies where the sheet has a matching column and is reported as not applied where it has none; the file's
/// "Filters" sheet says which column each filter used. Nothing is sent to the procedures (they take no filter).
/// </summary>
public sealed record ReportFilter(string? State, string? Level, string? Size, string? Gender, string? Status, DateOnly? From, DateOnly? To, string DateOf)
{
    public const string Registration = "registration";
    public const string Certification = "certification";
    public const string Payment = "payment";
    public static readonly string[] DateBases = [Registration, Certification, Payment];

    public bool Any => State is not null || Level is not null || Size is not null || Gender is not null || Status is not null || From is not null || To is not null;
}

/// <summary>What one filter did on one sheet: the column it used, or null when the sheet has none.</summary>
public sealed record AppliedFilter(string Filter, string Value, string? Column);

public static class ReportFilters
{
    internal static readonly string[] StateColumns = ["PStateName", "StateName", "State", "UnitState"];
    internal static readonly string[] LevelColumns = ["Certification", "CertificationType", "CertificationLevel", "Level"];
    internal static readonly string[] SizeColumns = ["EnterpriseTypee", "EnterpriseType", "MsmeSize", "Size", "EnterpriseSize"];
    internal static readonly string[] GenderColumns = ["Gender"];

    /// <summary>The date column per basis, the first present is used (the procedures' own spellings, "CertificactionDate" too).</summary>
    internal static readonly IReadOnlyDictionary<string, string[]> DateColumns = new Dictionary<string, string[]>
    {
        [ReportFilter.Registration] = ["RegistrationDate", "RegisteredDate", "RegdDate", "RegDate", "CreatedDate"],
        [ReportFilter.Certification] = ["CertificactionDate", "CertificationDate", "CertifiedDate", "CertificateDate", "CompletionDate"],
        [ReportFilter.Payment] = ["TransactionDate", "PaymentDate", "PaidOn", "ApproverDateOfReceiptOfPayment"],
    };

    /// <summary>The rows of one sheet that pass the filters, and what each filter did there.</summary>
    public static (IReadOnlyList<IDictionary<string, object?>> Rows, IReadOnlyList<AppliedFilter> Applied) Apply(
        IReadOnlyList<IDictionary<string, object?>> rows, ReportFilter f)
    {
        var keys = rows.FirstOrDefault()?.Keys.ToList() ?? [];
        string? Col(IEnumerable<string> names) => names.Select(n => keys.FirstOrDefault(k => string.Equals(k, n, StringComparison.OrdinalIgnoreCase))).FirstOrDefault(k => k is not null);
        var tests = new List<Func<IDictionary<string, object?>, bool>>();
        var applied = new List<AppliedFilter>();

        void Add(string name, string? value, string? column, Func<string, bool> matches)
        {
            if (value is null) return;
            applied.Add(new AppliedFilter(name, value, column));
            if (column is not null) tests.Add(r => matches(Text(r, column)));
        }

        Add("State", f.State, Col(StateColumns), v => string.Equals(v, f.State, StringComparison.OrdinalIgnoreCase));
        Add("Certification level", f.Level, Col(LevelColumns), v => Letters(v) == Letters(f.Level));
        Add("MSME size", f.Size, Col(SizeColumns), v => v.StartsWith(f.Size!, StringComparison.OrdinalIgnoreCase));
        Add("Gender", f.Gender, Col(GenderColumns), v => SameGender(v, f.Gender!));

        // Status: any column named ...Status (UnitStatus, AssessmentStatus, TransactionStatus, ZedIdStatus...), the text contained.
        if (f.Status is not null)
        {
            var statusColumns = keys.Where(k => k.EndsWith("Status", StringComparison.OrdinalIgnoreCase) || k.EndsWith("StatusName", StringComparison.OrdinalIgnoreCase)).ToList();
            applied.Add(new AppliedFilter("Status", f.Status, statusColumns.Count == 0 ? null : string.Join(", ", statusColumns)));
            if (statusColumns.Count > 0)
                tests.Add(r => statusColumns.Any(c => Text(r, c).Contains(f.Status, StringComparison.OrdinalIgnoreCase)));
        }

        if (f.From is not null || f.To is not null)
        {
            var column = Col(DateColumns.TryGetValue(f.DateOf, out var names) ? names : []);
            var value = $"{f.From?.ToString("dd-MM-yyyy", CultureInfo.InvariantCulture) ?? "…"} to {f.To?.ToString("dd-MM-yyyy", CultureInfo.InvariantCulture) ?? "…"} ({f.DateOf} date)";
            applied.Add(new AppliedFilter("Date", value, column));
            if (column is not null)
                tests.Add(r => DateOf(r.TryGetValue(column, out var v) ? v : null) is { } d && (f.From is null || d >= f.From) && (f.To is null || d <= f.To));
        }

        return (tests.Count == 0 ? rows : rows.Where(r => tests.All(t => t(r))).ToList(), applied);
    }

    /// <summary>The "Filters" sheet: each filter, its value and where it applied; the rows kept.</summary>
    public static XlsxSheet Sheet(IReadOnlyList<(string Sheet, IReadOnlyList<AppliedFilter> Applied, int Before, int After)> sheets)
    {
        var rows = new List<IReadOnlyList<object?>>();
        foreach (var (sheet, applied, before, after) in sheets)
        {
            foreach (var a in applied)
                rows.Add([sheet, a.Filter, a.Value, a.Column is null ? "Not applied: this report has no such column" : "Applied on column " + a.Column]);
            rows.Add([sheet, "Rows", $"{after} of {before}", ""]);
        }
        return new XlsxSheet("Filters", ["Sheet", "Filter", "Value", "Applied"], rows);
    }

    private static string Text(IDictionary<string, object?> r, string k) => r.TryGetValue(k, out var v) ? v?.ToString()?.Trim() ?? "" : "";

    private static string Letters(string? s) => new string((s ?? "").Where(char.IsLetterOrDigit).ToArray()).ToUpperInvariant();

    private static bool SameGender(string value, string wanted)
    {
        var v = value.Trim().ToLowerInvariant();
        return wanted.ToLowerInvariant() switch
        {
            "male" => v is "male" or "m",
            "female" => v is "female" or "f",
            _ => v.Length > 0 && v is not "male" and not "m" and not "female" and not "f",
        };
    }

    private static readonly string[] Formats =
        ["yyyy-MM-dd", "dd-MM-yyyy", "dd/MM/yyyy", "d/M/yyyy", "MMMM d, yyyy", "MMM d, yyyy", "dd MMM yyyy", "d MMM yyyy", "yyyy-MM-ddTHH:mm:ss", "yyyy-MM-dd HH:mm:ss"];

    /// <summary>A date out of a cell: a date, an Excel day number (the procedures' DATEDIFF from 1899-12-30), or text.</summary>
    internal static DateOnly? DateOf(object? v)
    {
        switch (v)
        {
            case null: return null;
            case DateTime dt: return DateOnly.FromDateTime(dt);
            case DateTimeOffset dto: return DateOnly.FromDateTime(dto.DateTime);
            case DateOnly d: return d;
            case int or long or short or double or decimal or float:
                var n = Convert.ToDouble(v, CultureInfo.InvariantCulture);
                return n is > 10000 and < 80000 ? DateOnly.FromDateTime(new DateTime(1899, 12, 30).AddDays(Math.Floor(n))) : null;
        }
        var s = v.ToString()?.Trim() ?? "";
        if (s.Length == 0) return null;
        if (DateTime.TryParseExact(s, Formats, CultureInfo.InvariantCulture, DateTimeStyles.AllowWhiteSpaces, out var exact)) return DateOnly.FromDateTime(exact);
        // SQL Server's convert style 9, "Nov 10 2026  5:35:29:627PM" (the payment reports' TransactionDate): its date part.
        var style9 = System.Text.RegularExpressions.Regex.Match(s, @"^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})");
        if (style9.Success && DateTime.TryParseExact($"{style9.Groups[1].Value} {style9.Groups[2].Value} {style9.Groups[3].Value}", "MMM d yyyy",
                CultureInfo.InvariantCulture, DateTimeStyles.None, out var nine)) return DateOnly.FromDateTime(nine);
        if (s.Length >= 10 && DateTime.TryParseExact(s[..10], ["yyyy-MM-dd", "dd-MM-yyyy", "dd/MM/yyyy"], CultureInfo.InvariantCulture, DateTimeStyles.None, out var head)) return DateOnly.FromDateTime(head);
        return DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AllowWhiteSpaces, out var any) ? DateOnly.FromDateTime(any) : null;
    }
}
