using System.Data.Common;
using System.Globalization;
using Zed.Core.Data;

namespace Zed.Portal.Features.Staff.SiteReview;

/// <summary>
/// 2026-11-16 (approved): the assessors' punch-in / punch-out of a remote or onsite assessment, read straight from
/// dbo.ZedDailyAttendance (the assessor app's SA/SubmitAttendance; main, and ZED_SURVEILLANCE since migration 0076). The
/// old Attendance result set of SP_ASSESSMENT_DA_DETAILS joined MsmeCertifications on NcCount = 0, so the tab went empty
/// as soon as an NC was raised, and surveillance had none. One row per assessor and day: the first punch-in, the last
/// punch-out, the selfies (served by <see cref="SiteReviewController.File"/>) and where they were taken.
/// </summary>
public static class SiteAttendance
{
    internal const string Sql =
        "SELECT A.ConsultantId, U.UserName AS AssessorName, A.AttendanceType, A.[Timestamp] AS Stamp, A.CreatedDate, A.Latitude, A.Longitude, A.PhotoId " +
        "FROM dbo.ZedDailyAttendance A LEFT JOIN dbo.Users U ON U.UserId = A.ConsultantId " +
        "WHERE A.ZedId = @ZedId AND A.Certification = @Certification AND A.FinancialAssistanceId IS NULL ORDER BY A.CreatedDate, A.Id;";

    public sealed class Punch
    {
        public string? ConsultantId { get; init; }
        public string? AssessorName { get; init; }
        public string? AttendanceType { get; init; }
        public string? Stamp { get; init; }
        public DateTime? CreatedDate { get; init; }
        public string? Latitude { get; init; }
        public string? Longitude { get; init; }
        public string? PhotoId { get; init; }
    }

    /// <summary>The app's time stamp ("Nov 15, 2026 9:42 AM", taken on the phone, also when sent later), else when it arrived.</summary>
    internal static DateTime? When(Punch p) =>
        DateTime.TryParseExact(p.Stamp?.Trim(), ["MMM dd, yyyy h:mm tt", "MMM d, yyyy h:mm tt", "MMM dd, yyyy hh:mm tt"], CultureInfo.InvariantCulture,
            DateTimeStyles.AllowWhiteSpaces, out var d) ? d : p.CreatedDate;

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
    /// The page's rows (the fields the old set had, plus AssessorName and the locations) and its assessors: the allotted
    /// ones (<paramref name="allotted"/>: ConsultantId, AssessorType) and anyone else who punched in (an assessor replaced later).
    /// </summary>
    /// <param name="app">The app's storage folder: mobileapi (main) or surveillancemobileapi.</param>
    public static (List<Dictionary<string, object?>> Rows, List<Dictionary<string, object?>> Assessors) Build(
        IReadOnlyList<Punch> punches, IEnumerable<Dictionary<string, object?>> allotted, string zedId, string level, string app)
    {
        static string Key(string? id) => (id ?? "").Trim().ToUpperInvariant();
        string? Photo(Punch? p) => string.IsNullOrWhiteSpace(p?.PhotoId) ? null
            : SiteReviewFiles.Url(zedId, level, $"{app}/Attendance/{zedId}/{level}/{p!.PhotoId!.Trim()}.jpg");
        static string? Place(Punch? p) =>
            p is not null && double.TryParse(p.Latitude, NumberStyles.Float, CultureInfo.InvariantCulture, out var lat) &&
            double.TryParse(p.Longitude, NumberStyles.Float, CultureInfo.InvariantCulture, out var lng) && (lat != 0 || lng != 0)
                ? string.Create(CultureInfo.InvariantCulture, $"{lat:0.######},{lng:0.######}") : null;

        var assessors = allotted.Select(a => new Dictionary<string, object?>(a)).ToList();
        var known = assessors.Select(a => Key(a.GetValueOrDefault("ConsultantId") as string)).ToHashSet();
        var rows = new List<Dictionary<string, object?>>();
        foreach (var person in punches.Where(p => !string.IsNullOrWhiteSpace(p.ConsultantId)).GroupBy(p => Key(p.ConsultantId)))
        {
            var id = person.First().ConsultantId!.Trim();
            var name = person.Select(p => p.AssessorName).FirstOrDefault(n => !string.IsNullOrWhiteSpace(n))?.Trim();
            if (known.Add(person.Key)) assessors.Add(new() { ["ConsultantId"] = id, ["AssessorType"] = "Assessor", ["AssessorName"] = name });
            else foreach (var a in assessors.Where(a => Key(a.GetValueOrDefault("ConsultantId") as string) == person.Key))
                if (a.GetValueOrDefault("AssessorName") is null) a["AssessorName"] = name;

            var day = 0;
            foreach (var date in person.Select(p => (Punch: p, When: When(p))).Where(x => x.When is not null).GroupBy(x => x.When!.Value.Date).OrderBy(g => g.Key))
            {
                var login = date.Where(x => string.Equals(x.Punch.AttendanceType, "LOGIN", StringComparison.OrdinalIgnoreCase)).OrderBy(x => x.When).FirstOrDefault();
                var logout = date.Where(x => string.Equals(x.Punch.AttendanceType, "LOGOUT", StringComparison.OrdinalIgnoreCase)).OrderBy(x => x.When).LastOrDefault();
                var minutes = login.Punch is not null && logout.Punch is not null && logout.When > login.When ? (int)(logout.When!.Value - login.When!.Value).TotalMinutes : (int?)null;
                rows.Add(new()
                {
                    ["ConsultantId"] = id, ["AssessorName"] = name, ["RowNumber"] = ++day,
                    ["TimeStamps"] = date.Key.ToString("dd MMM yyyy", CultureInfo.InvariantCulture),
                    ["LoginTime"] = login.When?.ToString("hh:mm tt", CultureInfo.InvariantCulture),
                    ["LogoutTime"] = logout.When?.ToString("hh:mm tt", CultureInfo.InvariantCulture),
                    ["NoOfHours"] = minutes / 60, ["NoOfMinutes"] = minutes % 60,
                    ["LoginPhotoUrl"] = Photo(login.Punch), ["LogoutPhotoUrl"] = Photo(logout.Punch),
                    ["LoginLocation"] = Place(login.Punch), ["LogoutLocation"] = Place(logout.Punch),
                });
            }
        }
        return (rows, assessors);
    }
}
