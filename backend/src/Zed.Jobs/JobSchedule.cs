using System.Globalization;
using System.Text.RegularExpressions;

namespace Zed.Jobs;

public static partial class JobSchedule
{
    /// <summary>Configuration errors, empty when the job can run.</summary>
    public static IEnumerable<string> Validate(JobDefinition job)
    {
        if (string.IsNullOrWhiteSpace(job.Name)) yield return "Name is required.";
        if (!ProcedureName().IsMatch(job.Procedure)) yield return $"'{job.Procedure}' is not a valid procedure name.";
        if (job.DailyAt.Count == 0 && job.EveryMinutes is null) yield return "Set DailyAt or EveryMinutes.";
        if (job.DailyAt.Count > 0 && job.EveryMinutes is not null) yield return "Set DailyAt or EveryMinutes, not both.";
        if (job.EveryMinutes is < 1 or > 1440) yield return "EveryMinutes must be 1 to 1440.";
        foreach (var t in job.DailyAt)
            if (!TimeOnly.TryParseExact(t, "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out _))
                yield return $"'{t}' is not a time (HH:mm).";
    }

    /// <summary>
    /// The latest scheduled time at or before <paramref name="nowLocal"/>. A job is due when this is later than
    /// its last start, so a run missed while the service was down happens once when it comes back (as SQL
    /// Agent does not, but these jobs only catch up on state and mails, which is what the business expects).
    /// </summary>
    public static DateTime? LatestOccurrence(JobDefinition job, DateTime nowLocal)
    {
        if (job.EveryMinutes is int every)
        {
            var minutes = (int)nowLocal.TimeOfDay.TotalMinutes;
            return nowLocal.Date.AddMinutes(minutes - minutes % every);
        }
        DateTime? best = null;
        foreach (var text in job.DailyAt)
        {
            if (!TimeOnly.TryParseExact(text, "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var t)) continue;
            var today = nowLocal.Date + t.ToTimeSpan();
            var candidate = today <= nowLocal ? today : today.AddDays(-1);
            if (best is null || candidate > best) best = candidate;
        }
        return best;
    }

    public static bool IsDue(JobDefinition job, DateTime nowLocal, DateTime? lastStartLocal) =>
        LatestOccurrence(job, nowLocal) is { } due && (lastStartLocal is null || lastStartLocal < due);

    [GeneratedRegex(@"^[A-Za-z0-9_]{1,128}$")]
    private static partial Regex ProcedureName();
}
