using System.Data.Common;
using System.Globalization;
using Zed.Core.Data;

namespace Zed.Portal.Features.Consultancy.Milestones;

/// <summary>
/// 2026-11-21 (Consultancy UI audit, item 5): the consultants' punch-in / punch-out of a handholding case, read straight from
/// dbo.ConsultantDailyAttendance (the consultant app's attendance; the technology upgradation rows, with a
/// FinancialAssistanceId, are left out). The Attendance result set of SP_ASSESSMENT_DA_DETAILS paired the n-th punch-in of
/// a day with its n-th punch-out, so a punch-out was shown against a later punch-in ("17:14 in, 16:42 out: 0 Hours
/// (-32 Minutes)"). Here each punch-out is paired with the latest punch-in before it on the same day (same consultant
/// and milestone); a punch-in with no punch-out after it, or a punch-out with no punch-in before it, is a row of its own
/// with no duration. A duration is never negative. Dates are dates only, times hh:mm tt.
/// </summary>
public static class MilestoneAttendance
{
    internal const string Sql =
        "SELECT A.ConsultantId, A.MileStoneNo, A.AttendanceType, A.[Timestamp] AS Stamp, A.CreatedDate, A.PhotoId " +
        "FROM dbo.ConsultantDailyAttendance A " +
        "WHERE A.ZedId = @ZedId AND A.Certification = @Certification AND A.FinancialAssistanceId IS NULL ORDER BY A.CreatedDate, A.Id;";

    /// <summary>The consultants' names (the attendance headings show the name, not only the ID).</summary>
    internal const string NamesSql = "SELECT UserId, UserName FROM dbo.Users WHERE UserId IN @Ids;";

    public sealed class Punch
    {
        public string? ConsultantId { get; init; }
        public string? MileStoneNo { get; init; }
        public string? AttendanceType { get; init; }
        public string? Stamp { get; init; }
        public DateTime? CreatedDate { get; init; }
        public string? PhotoId { get; init; }
    }

    public sealed class ConsultantName
    {
        public string? UserId { get; init; }
        public string? UserName { get; init; }
    }

    /// <summary>The consultants of the attendance headings with their names (AssessorName); a name that cannot be read is left out.</summary>
    public static async Task<List<Dictionary<string, object?>>> WithNamesAsync(ISqlExecutor db, List<Dictionary<string, object?>> consultants,
        ILogger log, CancellationToken ct)
    {
        var ids = consultants.Select(c => c.GetValueOrDefault("ConsultantId")?.ToString()?.Trim()).Where(i => !string.IsNullOrEmpty(i)).Distinct().ToList();
        if (ids.Count == 0) return consultants;
        try
        {
            var names = (await db.QuerySqlAsync<ConsultantName>(NamesSql, new { Ids = ids }, ct))
                .Where(n => !string.IsNullOrWhiteSpace(n.UserId))
                .GroupBy(n => n.UserId!.Trim(), StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.First().UserName?.Trim(), StringComparer.OrdinalIgnoreCase);
            foreach (var c in consultants)
                if (c.GetValueOrDefault("ConsultantId")?.ToString()?.Trim() is { Length: > 0 } id && names.TryGetValue(id, out var name) && !string.IsNullOrEmpty(name))
                    c["AssessorName"] = name;
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Consultant names of the attendance not readable");
        }
        return consultants;
    }

    private static readonly string[] StampFormats =
        ["MMM dd, yyyy h:mm tt", "MMM d, yyyy h:mm tt", "MMM dd, yyyy hh:mm tt", "MMM d, yyyy hh:mm tt", "yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd HH:mm"];

    /// <summary>The app's time stamp ("Nov 16, 2026 5:32 AM", taken on the phone), else when it arrived.</summary>
    internal static DateTime? When(Punch p) =>
        DateTime.TryParseExact(p.Stamp?.Trim(), StampFormats, CultureInfo.InvariantCulture, DateTimeStyles.AllowWhiteSpaces, out var d) ? d : p.CreatedDate;

    public static async Task<IReadOnlyList<Punch>> ReadAsync(ISqlExecutor db, string zedId, string level, ILogger log, CancellationToken ct)
    {
        try
        {
            return await db.QuerySqlAsync<Punch>(Sql, new { ZedId = zedId, Certification = level }, ct);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Attendance of {ZedId} {Level} not readable", zedId, level);
            return [];
        }
    }

    /// <summary>
    /// The page's rows (ConsultantId, MileStoneNo, RowNumber = the consultant's day 1, 2, ..., TimeStamps = the date, LoginTime,
    /// LogoutTime, NoOfHours / NoOfMinutes or null, LoginPhotoUrl, LogoutPhotoUrl), oldest first.
    /// </summary>
    /// <param name="photoUrl">The page's address of a selfie by its photo id (null when it cannot be served).</param>
    public static List<Dictionary<string, object?>> Build(IReadOnlyList<Punch> punches, Func<string, string?> photoUrl)
    {
        static string Key(string? id) => (id ?? "").Trim().ToUpperInvariant();
        string? Photo(Punch? p) => string.IsNullOrWhiteSpace(p?.PhotoId) ? null : photoUrl(p!.PhotoId!.Trim());
        static bool Is(Punch p, string type) => string.Equals(p.AttendanceType?.Trim(), type, StringComparison.OrdinalIgnoreCase);

        var rows = new List<Dictionary<string, object?>>();
        foreach (var person in punches.Where(p => !string.IsNullOrWhiteSpace(p.ConsultantId)).GroupBy(p => Key(p.ConsultantId)))
        {
            var id = person.First().ConsultantId!.Trim();
            var dated = person.Select(p => (Punch: p, When: When(p))).Where(x => x.When is not null).ToList();
            var days = dated.Select(x => x.When!.Value.Date).Distinct().OrderBy(d => d).ToList();
            foreach (var group in dated.GroupBy(x => (Milestone: x.Punch.MileStoneNo?.Trim() ?? "", Date: x.When!.Value.Date))
                         .OrderBy(g => g.Key.Date).ThenBy(g => g.Key.Milestone, StringComparer.Ordinal))
            {
                var sessions = new List<((Punch Punch, DateTime? When)? In, (Punch Punch, DateTime? When)? Out)>();
                (Punch Punch, DateTime? When)? open = null;
                foreach (var x in group.OrderBy(x => x.When))
                {
                    if (Is(x.Punch, "LOGIN"))
                    {
                        // An earlier punch-in with no punch-out stays a row of its own: a punch-out pairs with the latest punch-in.
                        if (open is not null) sessions.Add((open, null));
                        open = x;
                    }
                    else if (Is(x.Punch, "LOGOUT"))
                    {
                        sessions.Add((open, x));
                        open = null;
                    }
                }
                if (open is not null) sessions.Add((open, null));

                foreach (var (inPunch, outPunch) in sessions)
                {
                    var minutes = inPunch?.When is { } a && outPunch?.When is { } b && b >= a ? (int)(b - a).TotalMinutes : (int?)null;
                    rows.Add(new()
                    {
                        ["ConsultantId"] = id,
                        ["MileStoneNo"] = group.Key.Milestone,
                        ["RowNumber"] = days.IndexOf(group.Key.Date) + 1,
                        ["TimeStamps"] = group.Key.Date.ToString("MMMM d, yyyy", CultureInfo.InvariantCulture),
                        ["LoginTime"] = inPunch?.When?.ToString("hh:mm tt", CultureInfo.InvariantCulture),
                        ["LogoutTime"] = outPunch?.When?.ToString("hh:mm tt", CultureInfo.InvariantCulture),
                        ["NoOfHours"] = minutes / 60,
                        ["NoOfMinutes"] = minutes % 60,
                        ["LoginPhotoUrl"] = Photo(inPunch?.Punch),
                        ["LogoutPhotoUrl"] = Photo(outPunch?.Punch),
                    });
                }
            }
        }
        return rows;
    }
}
