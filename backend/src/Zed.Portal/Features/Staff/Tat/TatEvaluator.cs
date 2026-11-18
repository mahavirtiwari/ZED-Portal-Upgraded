using System.Globalization;
using Zed.Core.Http;

namespace Zed.Portal.Features.Staff.Tat;

/// <summary>The days a status may last for one level (dbo.TatStatusDays).</summary>
public sealed record TatStatusRule(string Certification, string StatusCode, int Days);

/// <summary>A named rule "from → to in N days" (dbo.TatRelations); Certification null = every level.</summary>
public sealed record TatRelation(int Id, string Name, string? Certification, string FromStatus, string ToStatus, int Days, bool IsActive = true, int SortOrder = 0);

/// <summary>A portal's TAT rules, as the Admin set them (Administration → TAT).</summary>
public sealed class TatRules
{
    private readonly Dictionary<(string Level, string Status), int> _days;

    public static readonly TatRules None = new([], []);

    public TatRules(IEnumerable<TatStatusRule> statusDays, IEnumerable<TatRelation> relations)
    {
        _days = new(LevelStatusComparer.Instance);
        foreach (var r in statusDays)
            if (r.Days > 0 && !string.IsNullOrWhiteSpace(r.Certification) && !string.IsNullOrWhiteSpace(r.StatusCode))
                _days[(r.Certification.Trim(), r.StatusCode.Trim())] = r.Days;
        Relations = relations.OrderBy(r => r.SortOrder).ThenBy(r => r.Id).ToList();
    }

    public IReadOnlyList<TatRelation> Relations { get; }

    public bool IsEmpty => _days.Count == 0 && Relations.Count == 0;

    /// <summary>The days of a status at a level; null = no TAT.</summary>
    public int? DaysFor(string? level, string? status) =>
        level is not null && status is not null && _days.TryGetValue((level.Trim(), status.Trim()), out var d) ? d : null;

    /// <summary>The active relations that apply to a level (its own and those for every level), in the Admin's order.</summary>
    public IEnumerable<TatRelation> RelationsFor(string? level) =>
        Relations.Where(r => r.IsActive && (r.Certification is null || string.Equals(r.Certification, level?.Trim(), StringComparison.OrdinalIgnoreCase)));

    private sealed class LevelStatusComparer : IEqualityComparer<(string Level, string Status)>
    {
        public static readonly LevelStatusComparer Instance = new();
        public bool Equals((string Level, string Status) x, (string Level, string Status) y) =>
            string.Equals(x.Level, y.Level, StringComparison.OrdinalIgnoreCase) && string.Equals(x.Status, y.Status, StringComparison.OrdinalIgnoreCase);
        public int GetHashCode((string Level, string Status) k) =>
            HashCode.Combine(StringComparer.OrdinalIgnoreCase.GetHashCode(k.Level), StringComparer.OrdinalIgnoreCase.GetHashCode(k.Status));
    }
}

/// <summary>
/// One case as the evaluator sees it: its level, current status and since when, the date it reached each point of the
/// catalog (<see cref="TatCatalog"/>), the statuses it has passed without a recorded date, and whether it has ended
/// (certified, completed, rejected).
/// </summary>
public sealed record TatCase(
    string Level,
    string Status,
    DateTime? StatusDate,
    IReadOnlyDictionary<string, DateTime> Reached,
    IReadOnlyCollection<string>? Passed = null,
    bool Ended = false);

/// <summary>
/// One evaluated rule: the status rule of the current status (Kind "status") or a relation running (Kind "relation"), its
/// start, due date and how late it is now (negative = time left).
/// </summary>
public sealed record TatItem(string Kind, string Name, string From, string? To, int Days, DateTime Start, DateTime Due, double LateHours)
{
    public bool IsLate => LateHours > 0;
}

/// <summary>
/// The case's TAT: the current status's rule (when the Admin set days for it at the case's level) and every relation that has
/// started and not finished. <see cref="Primary"/> is what the monitoring list shows: the current status's rule, else the
/// most delayed relation.
/// </summary>
public sealed record TatResult(TatItem? Current, IReadOnlyList<TatItem> Relations)
{
    public static readonly TatResult Empty = new(null, []);

    public TatItem? Primary => Current ?? Relations.OrderByDescending(r => r.LateHours).FirstOrDefault();

    /// <summary>The most delayed of all (current status and relations).</summary>
    public TatItem? Worst => Relations.Append(Current).Where(i => i is not null).OrderByDescending(i => i!.LateHours).FirstOrDefault();
}

/// <summary>
/// 2026-11-18 (the user's decisions "TAT and monitoring"): decides from the Admin's TAT rules (Administration → TAT) whether a
/// case is delayed. Days are calendar days counted from the moment the case reached the status / the relation's start
/// (due = start + days); late = now − due. Nothing is hard-coded: a status or relation without days gives no TAT.
/// Shared by the three portals' monitoring pages (Assessment, Handholding, Surveillance).
/// </summary>
public static class TatEvaluator
{
    public const string OnTime = "on-time";
    public const string UnderOneDay = "lt1";
    public const string OneToFive = "1-5";
    public const string FiveToTen = "5-10";
    public const string OverTen = "gt10";

    /// <summary>The delay chips of the monitoring page, in order.</summary>
    public static readonly IReadOnlyList<(string Key, string Label)> Buckets =
    [
        (OnTime, "On time"), (UnderOneDay, "Delayed less than 1 day"), (OneToFive, "1–5 days"), (FiveToTen, "5–10 days"), (OverTen, "More than 10 days"),
    ];

    public static TatResult Evaluate(TatCase c, TatRules rules, DateTime now)
    {
        if (rules.IsEmpty || c.Ended) return TatResult.Empty;

        TatItem? current = null;
        if (c.StatusDate is { } since && rules.DaysFor(c.Level, c.Status) is { } days)
        {
            var due = since.AddDays(days);
            current = new TatItem("status", "", c.Status, null, days, since, due, (now - due).TotalHours);
        }

        var running = new List<TatItem>();
        foreach (var r in rules.RelationsFor(c.Level))
        {
            if (!c.Reached.TryGetValue(r.FromStatus, out var start)) continue;           // not started
            if (Finished(c, r.ToStatus, start)) continue;
            var due = start.AddDays(r.Days);
            running.Add(new TatItem("relation", r.Name, r.FromStatus, r.ToStatus, r.Days, start, due, (now - due).TotalHours));
        }
        return new TatResult(current, running);
    }

    /// <summary>The relation's end reached: on or after its start, or a status the case has passed (its date not recorded).</summary>
    private static bool Finished(TatCase c, string to, DateTime start) =>
        (c.Reached.TryGetValue(to, out var end) && end >= start) ||
        (c.Passed?.Contains(to, StringComparer.OrdinalIgnoreCase) ?? false) ||
        string.Equals(c.Status, to, StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// The case from what the portal records: its status number and date, and the latest date of each history source
    /// (MsmeHistory.StatusType values, <see cref="TatCatalog.OpenMeeting"/>, <see cref="TatCatalog.CloseMeeting"/>,
    /// <see cref="TatCatalog.Distributed"/>). A point is reached on the latest date of its sources; the current status at its
    /// status date when no source dated it. The first NC (Nc1Raised) is the desktop NC (4) when raised before the site
    /// assessment was scheduled (ScheduledOn), else the site NC (14). Statuses before the current one (not a rejection) are
    /// passed. The case has ended at a final point (certified, completed, rejected) or once one is reached.
    /// </summary>
    public static TatCase BuildCase(PortalSystem system, string level, int status, DateTime? statusDate, IReadOnlyDictionary<string, DateTime?> sources)
    {
        var catalog = TatCatalog.For(system);
        DateTime? Source(string key) => sources.TryGetValue(key, out var d) ? d : null;
        var reached = new Dictionary<string, DateTime>(StringComparer.OrdinalIgnoreCase);
        foreach (var p in catalog)
        {
            var dates = p.Sources.Select(Source).Where(d => d is not null).Select(d => d!.Value).ToList();
            if (dates.Count > 0) reached[p.Code] = dates.Max();
        }
        if (system != PortalSystem.Consultancy && Source("Nc1Raised") is { } nc)
        {
            var scheduled = Source("ScheduledOn");
            reached[scheduled is { } s && nc >= s ? "14" : "4"] = nc;
        }

        var code = status.ToString(CultureInfo.InvariantCulture);
        var current = catalog.FirstOrDefault(p => p.IsStatus && p.Code == code);
        if (current is not null && statusDate is { } since && !reached.ContainsKey(code)) reached[code] = since;
        var passed = current is null ? [] : catalog.Where(p => p.IsStatus && !p.Final && p.Order < current.Order).Select(p => p.Code).ToList();
        var ended = (current?.Final ?? false) || catalog.Any(p => p.Final && p.Code != code && reached.ContainsKey(p.Code) && p.Sources.Count > 0);
        return new TatCase(level, code, statusDate, reached, passed, ended);
    }

    /// <summary>The delay chip of a lateness (hours past the due date); null = no TAT.</summary>
    public static string? Bucket(double? lateHours) => lateHours switch
    {
        null => null,
        <= 0 => OnTime,
        < 24 => UnderOneDay,
        <= 5 * 24 => OneToFive,
        <= 10 * 24 => FiveToTen,
        _ => OverTen,
    };

    /// <summary>"13 days late", "18 hours late", "On time · 2 days left", "On time · due in 5 hours".</summary>
    public static string Label(double lateHours)
    {
        if (lateHours > 0)
        {
            if (lateHours < 24)
            {
                var h = Math.Max(1, (int)Math.Ceiling(lateHours));
                return h == 1 ? "1 hour late" : $"{h} hours late";
            }
            var d = (int)Math.Floor(lateHours / 24);
            return d == 1 ? "1 day late" : $"{d} days late";
        }
        var left = -lateHours;
        if (left >= 24)
        {
            var d = (int)Math.Floor(left / 24);
            return d == 1 ? "On time · 1 day left" : $"On time · {d} days left";
        }
        var hl = Math.Max(1, (int)Math.Floor(left));
        return hl == 1 ? "On time · due in 1 hour" : $"On time · due in {hl} hours";
    }
}
