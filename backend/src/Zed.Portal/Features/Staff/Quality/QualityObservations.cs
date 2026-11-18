using System.Data.Common;
using System.Globalization;
using Zed.Core.Data;
using Zed.Portal.Features.Staff.Assessment;

namespace Zed.Portal.Features.Staff.Quality;

/// <summary>
/// 2026-11-16 (approved): the ZED team's quality observations on an assessment, kept on the legacy dbo.AssessorComments
/// (migration 0088): one 'QualityObs' row per observation and one 'QualityEvt' row per step of its history (raised,
/// responded, closed, reopened, with who and when), so the time to reply / close and the reopenings can be analysed and
/// the agencies and assessors ranked. NcCount stays NULL on these rows (the legacy procedures read and delete by NcCount).
/// </summary>
public static class QualityObservations
{
    public const string ObservationType = "QualityObs";
    public const string EventType = "QualityEvt";

    public const string Open = "Open", Responded = "Responded", Closed = "Closed";
    public const string Raised = "Raised", Reopened = "Reopened";

    public static readonly string[] Severities = ["Minor", "Major", "Critical"];
    public static readonly string[] Blocking = ["Major", "Critical"];
    public static readonly string[] Abouts = ["Desktop", "Lead", "Co", "Agency"];
    public static readonly string[] RefTypes = ["Overall", "Requirement", "Product", "Photo", "Meeting", "Attendance"];
    // 2026-11-17 (approved): the reasons (categories) and the severity each carries are the Admin's (ObservationReasons).

    public const int MaxText = 2000;

    public sealed class Row
    {
        public long Id { get; init; }
        public string? ZedId { get; init; }
        public string? Certification { get; init; }
        public string? AssessmentType { get; init; }
        public string? Text { get; init; }
        public DateTime? At { get; init; }
        public string? QoStatus { get; init; }
        public long? QoParentId { get; init; }
        public int? QoRound { get; init; }
        public string? QoStage { get; init; }
        public string? QoRefType { get; init; }
        public string? QoRefId { get; init; }
        public string? QoRefLabel { get; init; }
        public string? QoCategory { get; init; }
        public string? QoSeverity { get; init; }
        public string? QoAbout { get; init; }
        public string? QoAboutUserId { get; init; }
        public string? QoAgencyId { get; init; }
        public string? QoBy { get; init; }
        public string? QoByName { get; init; }
    }

    private const string Columns =
        "CAST(Id AS bigint) AS Id, ZedId, Certification, AssessmentType, AssessorRemarks AS Text, CertificationStatusDate AS At, QoStatus, " +
        "CAST(QoParentId AS bigint) AS QoParentId, QoRound, QoStage, QoRefType, QoRefId, QoRefLabel, QoCategory, QoSeverity, QoAbout, QoAboutUserId, " +
        "QoAgencyId, QoBy, QoByName";

    /// <summary>A unit's observations and their history steps.</summary>
    internal const string UnitSql =
        "SELECT " + Columns + " FROM dbo.AssessorComments WHERE ZedId = @ZedId AND Certification = @Certification " +
        "AND AssessmentType IN ('QualityObs', 'QualityEvt') ORDER BY Id;";

    /// <summary>
    /// Every observation and step (the lists and the dashboard filter them by role and scope). @From / @Before (exclusive,
    /// the day after "To"; NULL = up to now) bound the date the observation was raised; its later steps are kept, so the
    /// reply and close times stay whole. @Certification (NULL = every level) is the assessment's certification level
    /// (2026-11-18, the user: date range and certification level filters).
    /// </summary>
    internal const string AllSql =
        "SELECT " + Columns + " FROM dbo.AssessorComments WHERE AssessmentType IN ('QualityObs', 'QualityEvt') AND CertificationStatusDate >= @From " +
        "AND (@Before IS NULL OR AssessmentType = 'QualityEvt' OR CertificationStatusDate < @Before) " +
        "AND (@Certification IS NULL OR Certification = @Certification) ORDER BY Id;";

    internal const string OneSql = "SELECT " + Columns + " FROM dbo.AssessorComments WHERE Id = @Id AND AssessmentType = 'QualityObs';";

    internal const string InsertSql =
        "INSERT INTO dbo.AssessorComments (ZedId, Certification, NcCount, AssessorRemarks, CertificationStatusDate, AssessmentType, QoStatus, QoParentId, " +
        "QoRound, QoStage, QoRefType, QoRefId, QoRefLabel, QoCategory, QoSeverity, QoAbout, QoAboutUserId, QoAgencyId, QoBy, QoByName) " +
        "OUTPUT CAST(INSERTED.Id AS bigint) " +
        "VALUES (@ZedId, @Certification, NULL, @Text, GETDATE(), @Type, @Status, @ParentId, @Round, @Stage, @RefType, @RefId, @RefLabel, @Category, " +
        "@Severity, @About, @AboutUserId, @AgencyId, @By, @ByName);";

    internal const string StatusSql = "UPDATE dbo.AssessorComments SET QoStatus = @Status WHERE Id = @Id AND AssessmentType = 'QualityObs';";

    /// <summary>The unit's history line (MsmeHistory), as the other steps of an application.</summary>
    internal const string HistorySql =
        "INSERT INTO dbo.MsmeHistory (ZedId, Descrip, CreatedDate, CertificationType, StatusType) VALUES (@ZedId, @Descrip, GETDATE(), @Certification, 'Quality Observation');";

    internal const string BlockingSql =
        "SELECT COUNT(*) FROM dbo.AssessorComments WHERE ZedId = @ZedId AND Certification = @Certification AND AssessmentType = 'QualityObs' " +
        "AND QoStatus = 'Open' AND QoSeverity IN ('Major', 'Critical');";

    internal const string NamesSql = "SELECT UserId, UserName, Email FROM dbo.Users WHERE UserId IN @Ids;";

    public sealed record UserRow(string? UserId, string? UserName, string? Email);

    /// <summary>The stage of the application when the observation is raised.</summary>
    public static string StageOf(CertificationRecord r, bool milestone) =>
        milestone ? $"Milestone {r.Nc}"
        : r.Status is 6 or 16 or 100 ? "Certified"
        : r.Nc is >= 1 and <= 6 ? "NC"
        : r.Status is >= 9 and <= 17 ? "Site"
        : "Desktop";

    /// <summary>The assessor (or agency) an observation is about.</summary>
    public static string? AboutUserOf(CertificationRecord r, string about) => about switch
    {
        "Desktop" => r.DesktopAssessorId?.Trim(),
        "Lead" => r.SiteAssessorId?.Trim(),
        "Co" => r.CoAssessorId?.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).FirstOrDefault(),
        _ => r.CertificationBodyUserId?.Trim(),
    };

    /// <summary>Open major / critical observations hold the agency's final submit until it replies; 0 before migration 0088.</summary>
    public static async Task<int> BlockingAsync(ISqlExecutor db, string zedId, string level, ILogger log, CancellationToken ct)
    {
        try
        {
            return (await db.QuerySqlAsync<int>(BlockingSql, new { ZedId = AssessmentInput.Ansi(zedId), Certification = AssessmentInput.Ansi(level) }, ct)).FirstOrDefault();
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Quality observations of {ZedId} {Level} not readable (is migration 0088 applied?)", zedId, level);
            return 0;
        }
    }

    public static string BlockingMessage(int n) =>
        $"There {(n == 1 ? "is 1 major / critical observation" : $"are {n} major / critical observations")} of the ZED team waiting for your reply. Please reply first.";

    // ------------------------------------------------------------------ the page's view

    public sealed record Step(string Kind, string? Text, DateTime? At, string? By, string? ByName);

    public sealed record Observation(
        long Id, string ZedId, string Certification, string Status, string? Text, DateTime? RaisedOn, string? RaisedBy, string? RaisedByName,
        int Round, string? Stage, string? RefType, string? RefId, string? RefLabel, string? Category, string? Severity, string? About,
        string? AboutUserId, string? AboutName, string? AgencyId, string? AgencyName, IReadOnlyList<Step> History)
    {
        /// <summary>Hours from raising to the first reply (null while none).</summary>
        public double? ReplyHours { get; init; }

        /// <summary>Hours from raising to the last close (null while not closed).</summary>
        public double? CloseHours { get; init; }

        public int Reopens { get; init; }
    }

    public static List<Observation> Build(IReadOnlyList<Row> rows, IReadOnlyDictionary<string, string> names)
    {
        var steps = rows.Where(r => r.AssessmentType == EventType && r.QoParentId is not null).GroupBy(r => r.QoParentId!.Value)
            .ToDictionary(g => g.Key, g => g.OrderBy(s => s.At).ThenBy(s => s.Id).ToList());
        string? Name(string? id) => id is not null && names.TryGetValue(id.Trim(), out var n) ? n : null;
        return rows.Where(r => r.AssessmentType == ObservationType).Select(r =>
        {
            var history = steps.GetValueOrDefault(r.Id) ?? [];
            var firstReply = history.FirstOrDefault(h => h.QoStatus == Responded)?.At;
            var lastClose = history.LastOrDefault(h => h.QoStatus == Closed)?.At;
            return new Observation(r.Id, r.ZedId?.Trim() ?? "", r.Certification?.Trim() ?? "", r.QoStatus ?? Open, r.Text, r.At, r.QoBy, r.QoByName,
                r.QoRound ?? 0, r.QoStage, r.QoRefType, r.QoRefId, r.QoRefLabel, r.QoCategory, r.QoSeverity, r.QoAbout, r.QoAboutUserId,
                Name(r.QoAboutUserId), r.QoAgencyId, Name(r.QoAgencyId),
                history.Select(h => new Step(h.QoStatus ?? "", h.Text, h.At, h.QoBy, h.QoByName)).ToList())
            {
                ReplyHours = firstReply is { } fr && r.At is { } at ? Math.Round((fr - at).TotalHours, 1) : null,
                CloseHours = r.QoStatus == Closed && lastClose is { } lc && r.At is { } at2 ? Math.Round((lc - at2).TotalHours, 1) : null,
                Reopens = history.Count(h => h.QoStatus == Reopened),
            };
        }).OrderByDescending(o => o.RaisedOn).ToList();
    }

    // ------------------------------------------------------------------ dashboard and ranking

    /// <summary>One agency's or assessor's figures; Rank 1 = fewest weighted observations per assessment.</summary>
    public sealed record Standing(
        string Kind, string UserId, string? Name, string? AgencyId, int Assessments, int Total, int Open, int Responded, int Closed,
        int Minor, int Major, int Critical, int Reopens, double? AvgReplyHours, double? AvgCloseHours, double Score)
    {
        public int Rank { get; init; }
    }

    /// <summary>Minor 1, major 3, critical 5 points; the score is the points per assessment with an observation.</summary>
    public static int Points(string? severity) => severity switch { "Critical" => 5, "Major" => 3, _ => 1 };

    public static List<Standing> Rank(IEnumerable<Observation> observations, string kind)
    {
        var list = observations
            .Select(o => (Key: kind == "Agency" ? o.AgencyId : o.About == "Agency" ? null : o.AboutUserId, O: o))
            .Where(x => !string.IsNullOrWhiteSpace(x.Key))
            .GroupBy(x => x.Key!.Trim(), StringComparer.OrdinalIgnoreCase)
            .Select(g =>
            {
                var os = g.Select(x => x.O).ToList();
                var assessments = os.Select(o => o.ZedId + "|" + o.Certification).Distinct(StringComparer.OrdinalIgnoreCase).Count();
                var replies = os.Where(o => o.ReplyHours is not null).Select(o => o.ReplyHours!.Value).ToList();
                var closes = os.Where(o => o.CloseHours is not null).Select(o => o.CloseHours!.Value).ToList();
                var first = os[0];
                return new Standing(kind, g.Key, kind == "Agency" ? first.AgencyName : first.AboutName, kind == "Agency" ? null : first.AgencyId,
                    assessments, os.Count, os.Count(o => o.Status == Open), os.Count(o => o.Status == Responded), os.Count(o => o.Status == Closed),
                    os.Count(o => o.Severity == "Minor"), os.Count(o => o.Severity == "Major"), os.Count(o => o.Severity == "Critical"),
                    os.Sum(o => o.Reopens),
                    replies.Count > 0 ? Math.Round(replies.Average(), 1) : null, closes.Count > 0 ? Math.Round(closes.Average(), 1) : null,
                    Math.Round(os.Sum(o => Points(o.Severity)) / (double)Math.Max(assessments, 1), 2));
            })
            .OrderBy(s => s.Score).ThenBy(s => s.AvgReplyHours ?? double.MaxValue).ThenBy(s => s.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
        return list.Select((s, i) => s with { Rank = i + 1 }).ToList();
    }

    public static string Hours(double h) => h.ToString("0.#", CultureInfo.InvariantCulture);
}
