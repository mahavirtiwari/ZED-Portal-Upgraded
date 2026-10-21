using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Zed.Jobs;

public sealed record ProcedureParameter(string Name, string SqlType, int MaxLength, bool IsOutput, bool IsReadOnly, bool HasDefault);

/// <param name="DefinitionReadable">False when the definition could not be read (encrypted, or no VIEW DEFINITION):
/// which parameters have defaults is then unknown.</param>
public sealed record ProcedureInfo(IReadOnlyList<ProcedureParameter> Parameters, bool DefinitionReadable);

public interface IProcedureCatalog
{
    /// <summary>dbo.<paramref name="procedure"/> in <paramref name="database"/>, or null when it does not exist.
    /// Throws when the database cannot be reached.</summary>
    Task<ProcedureInfo?> GetAsync(string database, string procedure, CancellationToken ct);
}

/// <summary>Reads procedures from the databases. sys.parameters.has_default_value is always 0 for T-SQL
/// procedures, so defaults are read from the definition's header (<see cref="ProcedureHeader"/>).</summary>
public sealed class SqlProcedureCatalog(IJobDatabases databases) : IProcedureCatalog
{
    internal const string ParametersSql = """
        SELECT p.name AS Name, TYPE_NAME(p.system_type_id) AS SqlType, CAST(p.max_length AS int) AS MaxLength,
               p.is_output AS IsOutput, p.is_readonly AS IsReadOnly, OBJECT_DEFINITION(o.object_id) AS Definition
        FROM sys.objects o
        LEFT JOIN sys.parameters p ON p.object_id = o.object_id AND p.parameter_id > 0
        WHERE o.object_id = OBJECT_ID(@Name) AND o.type IN ('P', 'PC')
        ORDER BY p.parameter_id
        """;

    private sealed record Row(string? Name, string? SqlType, int MaxLength, bool IsOutput, bool IsReadOnly, string? Definition);

    public async Task<ProcedureInfo?> GetAsync(string database, string procedure, CancellationToken ct)
    {
        var rows = await databases[database].QuerySqlAsync<Row>(ParametersSql, new { Name = "dbo." + procedure }, ct);
        if (rows.Count == 0) return null;
        var definition = rows[0].Definition;
        var named = rows.Where(r => r.Name is not null).ToList();
        var withDefault = definition is null ? [] : ProcedureHeader.ParametersWithDefault(definition, named.Select(r => r.Name!).ToList());
        return new ProcedureInfo(
            named.Select(r => new ProcedureParameter(r.Name!.TrimStart('@'), r.SqlType ?? "", r.MaxLength, r.IsOutput, r.IsReadOnly,
                withDefault.Contains(r.Name!))).ToList(),
            definition is not null);
    }
}

/// <summary>Which parameters of a procedure declare a default ("@X int = 0").</summary>
public static partial class ProcedureHeader
{
    public static HashSet<string> ParametersWithDefault(string definition, IReadOnlyList<string> parameterNames)
    {
        var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var text = StripComments(definition);
        var starts = new List<int>();
        var from = 0;
        foreach (var name in parameterNames)
        {
            var m = new Regex(Regex.Escape(name) + @"(?![A-Za-z0-9_@#$])", RegexOptions.IgnoreCase).Match(text, from);
            if (!m.Success) return result;
            starts.Add(m.Index);
            from = m.Index + m.Length;
        }
        if (starts.Count == 0) return result;
        // The header ends at the AS that starts the body ("WITH EXECUTE AS OWNER" is not it).
        var end = text.Length;
        foreach (Match m in BodyAs().Matches(text, from))
        {
            if (Regex.IsMatch(text[..m.Index], @"\bEXEC(UTE)?\s*$", RegexOptions.IgnoreCase)) continue;
            end = m.Index;
            break;
        }
        for (var i = 0; i < starts.Count; i++)
        {
            var segment = text[starts[i]..(i + 1 < starts.Count ? starts[i + 1] : end)];
            if (segment.Contains('=')) result.Add(parameterNames[i]);
        }
        return result;
    }

    /// <summary>Comments become spaces; string literals and bracketed names are kept.</summary>
    internal static string StripComments(string sql)
    {
        var sb = new StringBuilder(sql.Length);
        for (var i = 0; i < sql.Length; i++)
        {
            var c = sql[i];
            if (c == '-' && i + 1 < sql.Length && sql[i + 1] == '-')
            {
                while (i < sql.Length && sql[i] != '\n') i++;
                sb.Append('\n');
            }
            else if (c == '/' && i + 1 < sql.Length && sql[i + 1] == '*')
            {
                var depth = 0;
                for (; i < sql.Length; i++)
                {
                    if (sql[i] == '/' && i + 1 < sql.Length && sql[i + 1] == '*') { depth++; i++; }
                    else if (sql[i] == '*' && i + 1 < sql.Length && sql[i + 1] == '/') { depth--; i++; if (depth == 0) break; }
                }
                sb.Append(' ');
            }
            else if (c is '\'' or '[' or '"')
            {
                var close = c == '[' ? ']' : c;
                sb.Append(c);
                for (i++; i < sql.Length; i++)
                {
                    sb.Append(sql[i]);
                    if (sql[i] != close) continue;
                    if (i + 1 < sql.Length && sql[i + 1] == close) { sb.Append(sql[++i]); continue; }
                    break;
                }
            }
            else sb.Append(c);
        }
        return sb.ToString();
    }

    [GeneratedRegex(@"\bAS\b", RegexOptions.IgnoreCase)]
    private static partial Regex BodyAs();
}

/// <summary>Converts the configured text values to the procedure's declared parameter types.</summary>
public static class ParameterValues
{
    public const string Null = "{NULL}";

    private static readonly string[] DateFormats =
        ["yyyy-MM-dd", "yyyyMMdd", "yyyy-MM-dd HH:mm", "yyyy-MM-dd HH:mm:ss", "yyyy-MM-ddTHH:mm", "yyyy-MM-ddTHH:mm:ss", "yyyy-MM-dd HH:mm:ss.fff", "yyyy-MM-ddTHH:mm:ss.fff"];

    public static bool TryConvert(ProcedureParameter p, string? value, out object converted, out string? error)
    {
        error = null;
        converted = DBNull.Value;
        if (value is null || value == Null) return true;
        var v = value.Trim();
        var inv = CultureInfo.InvariantCulture;
        switch (p.SqlType.ToLowerInvariant())
        {
            case "bit":
                if (v is "1" || v.Equals("true", StringComparison.OrdinalIgnoreCase)) converted = true;
                else if (v is "0" || v.Equals("false", StringComparison.OrdinalIgnoreCase)) converted = false;
                else error = "expects 0/1";
                break;
            case "tinyint": converted = Integer(v, 0, byte.MaxValue, ref error, b => (byte)b); break;
            case "smallint": converted = Integer(v, short.MinValue, short.MaxValue, ref error, b => (short)b); break;
            case "int": converted = Integer(v, int.MinValue, int.MaxValue, ref error, b => (int)b); break;
            case "bigint": converted = Integer(v, long.MinValue, long.MaxValue, ref error, b => b); break;
            case "decimal" or "numeric" or "money" or "smallmoney":
                if (decimal.TryParse(v, NumberStyles.Number, inv, out var d)) converted = d; else error = "expects a number";
                break;
            case "float" or "real":
                if (double.TryParse(v, NumberStyles.Float, inv, out var f)) converted = f; else error = "expects a number";
                break;
            case "date" or "datetime" or "datetime2" or "smalldatetime":
                if (DateTime.TryParseExact(v, DateFormats, inv, DateTimeStyles.None, out var dt)) converted = dt;
                else error = "expects a date (yyyy-MM-dd, or yyyy-MM-dd HH:mm)";
                break;
            case "time":
                if (TimeSpan.TryParseExact(v, [@"hh\:mm", @"hh\:mm\:ss"], inv, out var ts)) converted = ts; else error = "expects a time (HH:mm)";
                break;
            case "uniqueidentifier":
                if (Guid.TryParse(v, out var g)) converted = g; else error = "expects a GUID";
                break;
            case "char" or "varchar" or "nchar" or "nvarchar" or "text" or "ntext" or "sysname":
                var chars = p.MaxLength < 0 || p.SqlType is "text" or "ntext" ? int.MaxValue
                    : p.SqlType.StartsWith('n') || p.SqlType == "sysname" ? p.MaxLength / 2 : p.MaxLength;
                if (value.Length > chars) error = $"is longer than {chars} characters";
                else converted = value;
                break;
            default:
                error = $"has type {p.SqlType}, which a job cannot pass";
                break;
        }
        return error is null;
    }

    private static object Integer(string v, long min, long max, ref string? error, Func<long, object> cast)
    {
        if (long.TryParse(v, NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) && n >= min && n <= max) return cast(n);
        error = "expects a whole number";
        return DBNull.Value;
    }
}

/// <summary>A procedure call checked against the database, with its parameter values converted.</summary>
public sealed record PreparedCall(string Database, string Procedure, IReadOnlyList<KeyValuePair<string, object>> Parameters, bool ContinueOnFailure,
    int RetryAttempts = 0, int RetryIntervalMinutes = 0);

public enum JobCheckState { Ok, Invalid, Unreachable }

public sealed record JobCheck(JobCheckState State, IReadOnlyList<string> Errors, IReadOnlyList<string> Warnings, IReadOnlyList<PreparedCall> Calls);

/// <summary>Checks that a job's procedures exist and get every parameter they need, before it is scheduled.</summary>
public sealed class JobChecker(IProcedureCatalog catalog, IJobDatabases databases)
{
    public async Task<JobCheck> CheckAsync(JobDefinition job, CancellationToken ct, bool includeSchedule = true)
    {
        var errors = includeSchedule ? JobSchedule.Validate(job).ToList()
            : JobSchedule.Validate(job).Where(e => !IsScheduleError(e)).ToList();
        var warnings = new List<string>();
        if (errors.Count > 0) return new(JobCheckState.Invalid, errors, warnings, []);

        var calls = new List<PreparedCall>();
        var unreachable = false;
        var multi = job.Steps.Count > 0;
        foreach (var (call, i) in JobSchedule.Calls(job).Select((c, i) => (c, i + 1)))
        {
            var where = multi ? $"Step {i} ({call.Database}.{call.Procedure}): " : $"{call.Database}.{call.Procedure}: ";
            if (!databases.Names.Contains(call.Database, StringComparer.OrdinalIgnoreCase))
            {
                errors.Add($"{where}ConnectionStrings:{call.Database} is not configured.");
                continue;
            }
            ProcedureInfo? info;
            try
            {
                info = await catalog.GetAsync(call.Database, call.Procedure, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                warnings.Add($"{where}database not reachable ({ex.Message}).");
                unreachable = true;
                continue;
            }
            if (info is null)
            {
                errors.Add($"{where}procedure dbo.{call.Procedure} does not exist.");
                continue;
            }
            if (!info.DefinitionReadable)
                warnings.Add($"{where}definition not readable; required parameters not checked.");

            var given = call.Parameters.ToDictionary(p => p.Key.TrimStart('@'), p => p.Value, StringComparer.OrdinalIgnoreCase);
            var values = new List<KeyValuePair<string, object>>();
            foreach (var name in given.Keys.Where(n => !info.Parameters.Any(p => p.Name.Equals(n, StringComparison.OrdinalIgnoreCase))))
                errors.Add($"{where}has no parameter @{name}.");
            foreach (var p in info.Parameters)
            {
                if (given.TryGetValue(p.Name, out var value))
                {
                    if (p.IsOutput || p.IsReadOnly) errors.Add($"{where}@{p.Name} is an OUTPUT or table parameter; a job cannot pass it.");
                    else if (ParameterValues.TryConvert(p, value, out var converted, out var error)) values.Add(new(p.Name, converted));
                    else errors.Add($"{where}@{p.Name} {error}.");
                }
                else if (!p.HasDefault && !p.IsReadOnly && info.DefinitionReadable)
                    errors.Add($"{where}@{p.Name} ({p.SqlType}) has no default: set it in Parameters.");
            }
            calls.Add(new PreparedCall(call.Database, call.Procedure, values, call.ContinueOnFailure, call.RetryAttempts, call.RetryIntervalMinutes));
        }
        var state = errors.Count > 0 ? JobCheckState.Invalid : unreachable ? JobCheckState.Unreachable : JobCheckState.Ok;
        return new(state, errors, warnings, state == JobCheckState.Ok ? calls : []);
    }

    private static bool IsScheduleError(string e) =>
        e.StartsWith("Set DailyAt or EveryMinutes.", StringComparison.Ordinal);

    /// <summary>The --check report for every schedule. Returns the process exit code: 1 when an enabled job has
    /// a problem (disabled ones are reported, not counted), 0 otherwise.</summary>
    public async Task<int> ReportAsync(IReadOnlyList<JobDefinition> jobs, TextWriter output, CancellationToken ct)
    {
        output.WriteLine($"Zed.Jobs check: {jobs.Count} entries in Jobs:Schedules, {jobs.Count(j => j.Enabled)} enabled.");
        var problems = 0;
        foreach (var job in jobs)
        {
            var check = await CheckAsync(job, ct, includeSchedule: job.Enabled);
            var calls = string.Join(" > ", JobSchedule.Calls(job).Select(c => $"{c.Database}.{c.Procedure}"));
            var status = check.State switch
            {
                JobCheckState.Ok when check.Warnings.Count == 0 => "OK",
                JobCheckState.Ok => "WARN",
                JobCheckState.Unreachable => "UNREACHABLE",
                _ => "ERROR",
            };
            if (!job.Enabled && status != "OK") status = "(disabled) " + status;
            if (job.Enabled && check.State != JobCheckState.Ok) problems++;
            output.WriteLine($"{status,-22} {job.Name}  [{calls}]  {(job.Enabled ? "enabled" : "disabled")}, {JobSchedule.Describe(job)}");
            foreach (var e in check.Errors) output.WriteLine("    error: " + e);
            foreach (var w in check.Warnings) output.WriteLine("    warning: " + w);
        }
        output.WriteLine(problems == 0 ? "No problems in enabled jobs." : $"{problems} enabled job(s) have problems: they will not run.");
        return problems == 0 ? 0 : 1;
    }
}
