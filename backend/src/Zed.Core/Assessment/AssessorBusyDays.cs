using System.Data.Common;
using System.Globalization;
using Microsoft.Extensions.Logging;
using Zed.Core.Data;

namespace Zed.Core.Assessment;

/// <summary>
/// 2026-11-21 (the product owner: "an assessor cannot do multiple assessments in a day for on-site ... for gold assessment the
/// mandate as defined in the backend will be applicable: in that period he cannot start any other assessment"): an onsite
/// assessment keeps its assessors (lead and co-assessor) busy from its assessment date for the level's man-days (Administration
/// → Certification Levels, <c>SectionTypes.ManDays</c>; <c>SurveillanceManDays</c> for a surveillance visit; one day when not set).
/// Counted: main's onsite site assessments (ModeOfAssessment 'Onsite Assessment', allotted to the assessor: status 8 on, not a
/// rejected/reset copy) and the Surveillance portal's onsite visits (AssessmentVisit 'Onsite'). Not counted (the owner's choice):
/// remote assessments, meeting-link surveillance, incentive scheme visits, and Bronze onsite assessments ("Bronze onsite assessment
/// can be done multiple in a day": a Bronze case blocks nobody, so several Bronze cases fit in a day; a Silver/Gold case's days
/// still keep its assessor from starting any other case, a Bronze one included). Checked when an agency allots an onsite assessment
/// (the assessors must be free on all its days) and when the ZED SA app starts one (attendance, opening meeting: no other
/// assessment's days may cover today). Both databases are read from either host (the cross-database names are mapped to the
/// installation's, <see cref="ZedDatabaseNames"/>).
/// </summary>
public static class AssessorBusyDays
{
    public const string MainSource = "Assessment";
    public const string SurveillanceSource = "Surveillance";

    /// <summary>An onsite assessment of the assessor: its unit, level, source and days (From..To, inclusive).</summary>
    public sealed record Busy(string Source, string ZedId, string Certification, DateTime From, DateTime To)
    {
        public string Days => From.Date == To.Date
            ? From.ToString("dd MMM yyyy", CultureInfo.InvariantCulture)
            : $"{From.ToString("dd MMM yyyy", CultureInfo.InvariantCulture)} to {To.ToString("dd MMM yyyy", CultureInfo.InvariantCulture)}";
    }

    private sealed class Row
    {
        public string? Source { get; init; }
        public string? ZedId { get; init; }
        public string? Certification { get; init; }
        public DateTime AssessmentDate { get; init; }
        public int Days { get; init; }
    }

    /// <summary>
    /// The assessor's onsite assessments whose days meet @From..@To. Each allotment column is searched on its own (UNION ALL of
    /// SiteAssessorId and CoAssessorId, both indexed as for the app's dashboard); an assessor named both ways is listed once.
    /// </summary>
    public const string Sql = """
        SELECT DISTINCT B.Source, B.ZedId, B.Certification, B.AssessmentDate, B.Days FROM (
            SELECT 'Assessment' AS Source, C.ZedId, C.Certification, CAST(C.AssessmentDate AS date) AS AssessmentDate,
                   ISNULL(NULLIF(S.ManDays, 0), 1) AS Days
            FROM (SELECT Id FROM ZEDCS_V2_LIVE.dbo.MsmeCertifications WHERE SiteAssessorId = @UserId
                  UNION SELECT Id FROM ZEDCS_V2_LIVE.dbo.MsmeCertifications WHERE CoAssessorId = @UserId) X
            INNER JOIN ZEDCS_V2_LIVE.dbo.MsmeCertifications C ON C.Id = X.Id
            LEFT JOIN ZEDCS_V2_LIVE.dbo.SectionTypes S ON S.SectionType = C.Certification AND S.IsCertificationLevel = 1
            WHERE C.ModeOfAssessment = 'Onsite Assessment' AND C.AssessmentDate IS NOT NULL AND C.Certification <> 'Bronze'
              AND C.CertificationStatus >= 8 AND CHARINDEX('_', C.ZedId) = 0
            UNION ALL
            SELECT 'Surveillance', C.ZedId, C.Certification, CAST(C.AssessmentDate AS date), ISNULL(NULLIF(S.SurveillanceManDays, 0), 1)
            FROM (SELECT Id FROM ZED_SURVEILLANCE.dbo.MsmeCertifications WHERE SiteAssessorId = @UserId
                  UNION SELECT Id FROM ZED_SURVEILLANCE.dbo.MsmeCertifications WHERE CoAssessorId = @UserId) X
            INNER JOIN ZED_SURVEILLANCE.dbo.MsmeCertifications C ON C.Id = X.Id
            LEFT JOIN ZEDCS_V2_LIVE.dbo.SectionTypes S ON S.SectionType = C.Certification AND S.IsCertificationLevel = 1
            WHERE C.AssessmentVisit = 'Onsite' AND C.AssessmentDate IS NOT NULL AND C.Certification <> 'Bronze' AND CHARINDEX('_', C.ZedId) = 0
        ) B
        WHERE B.AssessmentDate <= @To AND DATEADD(day, B.Days - 1, B.AssessmentDate) >= @From;
        """;

    /// <summary>The man-days of a level (the surveillance visit's when <paramref name="surveillance"/>); one when not set.</summary>
    public const string DaysSql =
        "SELECT TOP (1) ISNULL(NULLIF(CASE WHEN @Surveillance = 1 THEN SurveillanceManDays ELSE ManDays END, 0), 1) " +
        "FROM ZEDCS_V2_LIVE.dbo.SectionTypes WHERE SectionType = @Code AND IsCertificationLevel = 1;";

    /// <summary>
    /// The assessor's onsite assessments meeting <paramref name="from"/>..<paramref name="to"/>, without the one named by
    /// <paramref name="exceptSource"/>/<paramref name="exceptZedId"/>/<paramref name="exceptLevel"/> (the case being allotted or
    /// started). Empty when the databases cannot be read (logged: the check never blocks work because of its own failure).
    /// </summary>
    public static async Task<IReadOnlyList<Busy>> ForAsync(ISqlExecutor db, string userId, DateTime from, DateTime to,
        string? exceptSource, string? exceptZedId, string? exceptLevel, ILogger log, CancellationToken ct)
    {
        try
        {
            var rows = await db.QuerySqlAsync<Row>(Sql, new
            {
                UserId = new Dapper.DbString { Value = userId.Trim(), IsAnsi = true, Length = 50 },
                From = from.Date,
                To = to.Date,
            }, ct);
            return rows
                .Where(r => !string.IsNullOrWhiteSpace(r.ZedId))
                .Where(r => !(string.Equals(r.Source, exceptSource, StringComparison.OrdinalIgnoreCase) &&
                              string.Equals(r.ZedId?.Trim(), exceptZedId?.Trim(), StringComparison.OrdinalIgnoreCase) &&
                              string.Equals(r.Certification?.Trim(), exceptLevel?.Trim(), StringComparison.OrdinalIgnoreCase)))
                .Select(r => new Busy(r.Source ?? MainSource, r.ZedId!.Trim(), r.Certification?.Trim() ?? "", r.AssessmentDate.Date,
                    r.AssessmentDate.Date.AddDays(Math.Max(1, r.Days) - 1)))
                .OrderBy(b => b.From)
                .ToList();
        }
        catch (DbException ex)
        {
            log.LogError(ex, "The onsite assessments of assessor {UserId} could not be read; the one-at-a-time check is skipped", userId);
            return [];
        }
    }

    /// <summary>The man-days of a level (assessment, or surveillance visit); one when not set or not readable.</summary>
    public static async Task<int> DaysAsync(ISqlExecutor db, string level, bool surveillance, ILogger log, CancellationToken ct)
    {
        try
        {
            var days = (await db.QuerySqlAsync<int>(DaysSql, new { Code = new Dapper.DbString { Value = level, IsAnsi = true, Length = 50 }, Surveillance = surveillance ? 1 : 0 }, ct))
                .FirstOrDefault();
            return days is >= 1 and <= 30 ? days : 1;
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Man-days of {Level} not readable; one day assumed", level);
            return 1;
        }
    }

    /// <summary>"Unit ZEDM000123 (Gold onsite assessment, 21 Nov 2026 to 23 Nov 2026)".</summary>
    public static string Describe(Busy b) =>
        $"{b.ZedId} ({LevelRegistry.NameOf(b.Certification)} onsite {(b.Source == SurveillanceSource ? "surveillance visit" : "assessment")}, {b.Days})";

    /// <summary>The refusal of an allotment: the assessor already has an onsite assessment on one of the days.</summary>
    public static string AllotRefusal(string assessorId, Busy b) =>
        $"{assessorId} already has the onsite assessment of {Describe(b)} on those days. An assessor can do only one onsite assessment at a time; please choose another assessor or date.";

    /// <summary>The refusal of a start in the app: another onsite assessment's days cover today.</summary>
    public static string StartRefusal(Busy b) =>
        $"You cannot start this assessment today: you are allotted the onsite assessment of {Describe(b)}. An assessor can do only one onsite assessment at a time.";
}
