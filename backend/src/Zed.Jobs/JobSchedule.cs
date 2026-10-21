using System.Globalization;
using System.Text.RegularExpressions;

namespace Zed.Jobs;

/// <summary>One procedure call of a job, with the step's database resolved.</summary>
public sealed record JobCall(string Database, string Procedure, IReadOnlyDictionary<string, string?> Parameters, bool ContinueOnFailure,
    int RetryAttempts = 0, int RetryIntervalMinutes = 0);

public static partial class JobSchedule
{
    /// <summary>The procedures the job runs, in order: its Steps, or its one Procedure.</summary>
    public static IReadOnlyList<JobCall> Calls(JobDefinition job) => job.Steps.Count > 0
        ? job.Steps.Select(s => new JobCall(string.IsNullOrWhiteSpace(s.Database) ? job.Database : s.Database!, s.Procedure,
            s.Parameters, s.ContinueOnFailure, s.RetryAttempts, s.RetryIntervalMinutes)).ToList()
        : [new JobCall(job.Database, job.Procedure, job.Parameters, false, job.RetryAttempts, job.RetryIntervalMinutes)];

    /// <summary>Configuration errors, empty when the job can run.</summary>
    public static IEnumerable<string> Validate(JobDefinition job)
    {
        if (string.IsNullOrWhiteSpace(job.Name)) yield return "Name is required.";
        if (job.Steps.Count > 0 && (!string.IsNullOrWhiteSpace(job.Procedure) || job.Parameters.Count > 0))
            yield return "Set Procedure (and Parameters) or Steps, not both.";
        foreach (var (call, i) in Calls(job).Select((c, i) => (c, i + 1)))
        {
            var where = job.Steps.Count > 0 ? $"Step {i}: " : "";
            if (!ProcedureName().IsMatch(call.Procedure ?? "")) yield return $"{where}'{call.Procedure}' is not a valid procedure name.";
            if (!ProcedureName().IsMatch(call.Database ?? "")) yield return $"{where}'{call.Database}' is not a valid database name.";
            foreach (var name in call.Parameters.Keys)
                if (!ParameterName().IsMatch(name)) yield return $"{where}'{name}' is not a valid parameter name.";
        }

        if (job.DailyAt.Count == 0 && job.EveryMinutes is null) yield return "Set DailyAt or EveryMinutes.";
        if (job.DailyAt.Count > 0 && job.EveryMinutes is not null) yield return "Set DailyAt or EveryMinutes, not both.";
        if (job.EveryMinutes is < 1 or > 1440) yield return "EveryMinutes must be 1 to 1440.";
        foreach (var t in job.DailyAt)
            if (Time(t) is null) yield return $"'{t}' is not a time (HH:mm).";
        if ((job.WindowStart ?? job.WindowEnd) is not null && job.EveryMinutes is null) yield return "WindowStart/WindowEnd need EveryMinutes.";
        if (job.WindowStart is { } ws && Time(ws) is null) yield return $"WindowStart '{ws}' is not a time (HH:mm).";
        if (job.WindowEnd is { } we && Time(we) is null) yield return $"WindowEnd '{we}' is not a time (HH:mm).";
        if (Time(job.WindowStart ?? "00:00") is { } a && Time(job.WindowEnd ?? "23:59") is { } b && a > b)
            yield return "WindowStart is after WindowEnd.";

        if (job.DaysOfWeek.Count > 0 && job.DaysOfMonth.Count > 0) yield return "Set DaysOfWeek or DaysOfMonth, not both.";
        foreach (var d in job.DaysOfWeek)
            if (Day(d) is null) yield return $"'{d}' is not a day of the week (Monday ... Sunday).";
        foreach (var d in job.DaysOfMonth)
            if (d is < 1 or > 31) yield return $"{d} is not a day of the month (1 to 31).";
        foreach (var c in Calls(job))
        {
            if (c.RetryAttempts is < 0 or > 10) yield return $"{c.Procedure}: RetryAttempts must be 0 to 10.";
            if (c.RetryIntervalMinutes is < 0 or > 1440) yield return $"{c.Procedure}: RetryIntervalMinutes must be 0 to 1440.";
        }
    }

    /// <summary>
    /// The latest scheduled time at or before <paramref name="nowLocal"/>. A job is due when this is later than
    /// its last start, so a run missed while the service was down happens once when it comes back (as SQL
    /// Agent does not, but these jobs only catch up on state and mails, which is what the business expects).
    /// </summary>
    public static DateTime? LatestOccurrence(JobDefinition job, DateTime nowLocal)
    {
        // Monthly on the 31st can skip two months; a year back covers every valid schedule.
        for (var back = 0; back <= 366; back++)
        {
            var date = nowLocal.Date.AddDays(-back);
            if (!RunsOn(job, date)) continue;
            var limit = back == 0 ? TimeOnly.FromTimeSpan(nowLocal.TimeOfDay) : TimeOnly.MaxValue;
            if (LastTimeOfDay(job, limit) is { } t) return date + t.ToTimeSpan();
        }
        return null;
    }

    public static bool IsDue(JobDefinition job, DateTime nowLocal, DateTime? lastStartLocal) =>
        LatestOccurrence(job, nowLocal) is { } due && (lastStartLocal is null || lastStartLocal < due);

    /// <summary>Human-readable schedule, for logs and the --check report.</summary>
    public static string Describe(JobDefinition job)
    {
        var when = job.EveryMinutes is int n
            ? $"every {n} min" + (job.WindowStart is null && job.WindowEnd is null ? "" : $" {job.WindowStart ?? "00:00"}-{job.WindowEnd ?? "23:59"}")
            : job.DailyAt.Count > 0 ? "at " + string.Join(", ", job.DailyAt) : null;
        if (when is null) return "no time set";
        var days = job.DaysOfWeek.Count > 0 ? " on " + string.Join(", ", job.DaysOfWeek)
            : job.DaysOfMonth.Count > 0 ? " on day " + string.Join(", ", job.DaysOfMonth) + " of the month"
            : " daily";
        return when + days;
    }

    private static bool RunsOn(JobDefinition job, DateTime date) =>
        (job.DaysOfWeek.Count == 0 || job.DaysOfWeek.Any(d => Day(d) == date.DayOfWeek))
        && (job.DaysOfMonth.Count == 0 || job.DaysOfMonth.Contains(date.Day));

    private static TimeOnly? LastTimeOfDay(JobDefinition job, TimeOnly limit)
    {
        if (job.EveryMinutes is int every && every > 0)
        {
            var start = Time(job.WindowStart ?? "00:00") ?? TimeOnly.MinValue;
            var end = Time(job.WindowEnd ?? "23:59") ?? new TimeOnly(23, 59);
            var upTo = limit < end ? limit : end;
            if (upTo < start) return null;
            var steps = (int)(upTo - start).TotalMinutes / every;
            return start.AddMinutes(steps * every);
        }
        TimeOnly? best = null;
        foreach (var text in job.DailyAt)
            if (Time(text) is { } t && t <= limit && (best is null || t > best)) best = t;
        return best;
    }

    internal static TimeOnly? Time(string text) =>
        TimeOnly.TryParseExact(text, "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var t) ? t : null;

    internal static DayOfWeek? Day(string text) =>
        Enum.TryParse<DayOfWeek>(text, ignoreCase: true, out var d) && Enum.IsDefined(d) && !int.TryParse(text, out _) ? d : null;

    [GeneratedRegex(@"^[A-Za-z0-9_]{1,128}$")]
    private static partial Regex ProcedureName();

    [GeneratedRegex(@"^@?[A-Za-z0-9_]{1,127}$")]
    private static partial Regex ParameterName();
}
