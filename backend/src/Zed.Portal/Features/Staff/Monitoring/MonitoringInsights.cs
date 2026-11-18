using System.Data.Common;
using System.Globalization;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Portal.Features.CertLevels;
using Zed.Portal.Features.Staff.Tat;

namespace Zed.Portal.Features.Staff.Monitoring;

/// <summary>
/// 2026-11-18 (approved monitoring design, the user's decisions "TAT and monitoring"): what the monitoring pages of the three
/// portals add to the rows of SP_MONITORING_GET_LIST, from one read of the portal's own records (<see cref="FactsSql"/>):
/// <list type="bullet">
/// <item>the sub-section of each case: Desktop assessment (status below 8) or Site assessment (8 and above) on the
/// assessment portals; the milestone (NcCount) on the Consultancy portal (<see cref="TrackOf"/>);</item>
/// <item>the date the page's date range means, which follows the stage: Scheduled → allotted on, In progress → assessment
/// date, Quality check → submitted on, Non-conformance → NC raised on, Rejected → rejected on (<see cref="StageDate"/>);</item>
/// <item>where a site assessment in progress is (<see cref="StepOf"/>: parameters distributed, opening meeting conducted,
/// submitted through the mobile app) and whether its submission through the app is pending past the level's man-days
/// (<see cref="LevelManDays.SubmissionPending"/>);</item>
/// <item>its TAT from the Admin's rules (<see cref="TatEvaluator"/>): due date, how late, the delay chip;</item>
/// <item>the stage cards' counts per sub-section and how many are delayed (<see cref="Stages"/>), scoped as the list.</item>
/// </list>
/// </summary>
public static class MonitoringInsights
{
    public const string Desktop = TatCatalog.Desktop;
    public const string Site = TatCatalog.Site;

    public const string StepDistributed = "distributed";
    public const string StepOpening = "opening";
    public const string StepSubmitted = "submitted";

    /// <summary>Monitoring stages (the list's @Status): scheduled, in progress, NC, quality check, rejected.</summary>
    public static readonly int[] StageStatuses = [2, 3, 4, 5, 7];

    /// <summary>The certification statuses the stages cover (any portal).</summary>
    private static readonly int[] Covered = [1, 2, 3, 4, 5, 7, 8, 9, 13, 14, 15, 17];

    /// <summary>One case as the portal records it (MsmeCertifications, its MsmeHistory lines, the app's meetings).</summary>
    public sealed class Fact
    {
        public int Id { get; init; }
        public string? ZedId { get; init; }
        public string? Certification { get; init; }
        public int? CertificationStatus { get; init; }
        public DateTime? CertificationStatusDate { get; init; }
        public DateTime? AssessmentDate { get; init; }
        public string? ModeOfAssessment { get; init; }
        public int? JoinRoomStatus { get; init; }
        public bool DesktopAccepted { get; init; }
        public int? IsSelfieSynced { get; init; }
        public int? NcCount { get; init; }
        public string? CertificationBodyUserId { get; init; }
        public DateTime? DesktopAcceptOrRejectDate { get; init; }
        public DateTime? OpenMeetingOn { get; init; }
        public DateTime? CloseMeetingOn { get; init; }
        public DateTime? DistributedOn { get; init; }
        // MsmeHistory.StatusType, the latest line of each (TatCatalog's sources).
        public DateTime? ApplicationReceived { get; init; }
        public DateTime? BasicInfoStatus { get; init; }
        public DateTime? AgencyAlloted { get; init; }
        public DateTime? DocVerifiAllot { get; init; }
        public DateTime? DesktopVerification { get; init; }
        public DateTime? BronzeDesktopVerification { get; init; }
        public DateTime? ScheduledOn { get; init; }
        public DateTime? Completed { get; init; }
        public DateTime? Nc1Raised { get; init; }
        public DateTime? NcClosed { get; init; }
        public DateTime? GetCertified { get; init; }
        public DateTime? CoAlloted { get; init; }
        public DateTime? AllocationCompleted { get; init; }
        public DateTime? BdsScheduledOn { get; init; }
        public DateTime? HapScheduledOn { get; init; }
        public DateTime? SubmittedByConsultant { get; init; }

        public int Status => CertificationStatus ?? 0;
        public bool Remote => string.Equals(ModeOfAssessment?.Trim(), "Remote Assessment", StringComparison.OrdinalIgnoreCase);
        /// <summary>As SQL reads "ModeOfAssessment != 'Remote Assessment'": false when the mode is not set.</summary>
        public bool NotRemote => !string.IsNullOrWhiteSpace(ModeOfAssessment) && !Remote;

        /// <summary>The history dates by source (MsmeHistory.StatusType and TatCatalog's @ sources).</summary>
        public IReadOnlyDictionary<string, DateTime?> Sources() => new Dictionary<string, DateTime?>(StringComparer.OrdinalIgnoreCase)
        {
            ["ApplicationReceived"] = ApplicationReceived, ["BasicInfoStatus"] = BasicInfoStatus, ["AgencyAlloted"] = AgencyAlloted,
            ["DocVerifiAllot"] = DocVerifiAllot, ["DesktopVerification"] = DesktopVerification, ["BronzeDesktopVerification"] = BronzeDesktopVerification,
            ["ScheduledOn"] = ScheduledOn, ["Completed"] = Completed, ["Nc1Raised"] = Nc1Raised, ["NcClosed"] = NcClosed, ["GetCertified"] = GetCertified,
            ["CoAlloted"] = CoAlloted, ["AllocationCompleted"] = AllocationCompleted, ["BdsScheduledOn"] = BdsScheduledOn,
            ["HapScheduledOn"] = HapScheduledOn, ["SubmittedByConsultant"] = SubmittedByConsultant,
            [TatCatalog.OpenMeeting] = OpenMeetingOn, [TatCatalog.CloseMeeting] = CloseMeetingOn, [TatCatalog.Distributed] = DistributedOn,
        };
    }

    private static readonly string[] HistoryColumns =
    [
        "ApplicationReceived", "BasicInfoStatus", "AgencyAlloted", "DocVerifiAllot", "DesktopVerification", "BronzeDesktopVerification",
        "ScheduledOn", "Completed", "Nc1Raised", "NcClosed", "GetCertified", "CoAlloted", "AllocationCompleted", "BdsScheduledOn",
        "HapScheduledOn", "SubmittedByConsultant",
    ];

    /// <summary>The start of <see cref="FactsSql"/> (the same on every portal).</summary>
    public const string FactsPrefix = "SELECT C.Id, C.ZedId, C.Certification, C.CertificationStatus, C.CertificationStatusDate,";

    /// <summary>
    /// Every case of the levels in the stages' statuses (an agency: its own), with the latest date of each history line the
    /// TAT reads, the app's opening and closing meetings and the lead assessor's parameter distribution. As the monitoring
    /// procedures: the agency accepted the case (DesktopAccepted), on Surveillance also a site rejection (17). Only
    /// ZED_SURVEILLANCE has IsSelfieSynced (its scheduled / in progress split).
    /// </summary>
    public static string FactsSql(PortalSystem system)
    {
        var history = string.Join(", ", HistoryColumns.Select(c => $"MAX(CASE WHEN StatusType = '{c}' THEN CreatedDate END) AS {c}"));
        var selfie = system == PortalSystem.Surveillance ? "C.IsSelfieSynced" : "CAST(NULL AS int)";
        var accepted = system == PortalSystem.Surveillance ? "(C.DesktopAccepted = 1 OR C.CertificationStatus = 17)" : "C.DesktopAccepted = 1";
        return FactsPrefix + $"""
             C.AssessmentDate, C.ModeOfAssessment, C.JoinRoomStatus,
               CAST(ISNULL(C.DesktopAccepted, 0) AS bit) AS DesktopAccepted, {selfie} AS IsSelfieSynced, C.NcCount, C.CertificationBodyUserId,
               C.DesktopAcceptOrRejectDate, MT.OpenMeetingOn, MT.CloseMeetingOn, H.DistributedOn, {string.Join(", ", HistoryColumns.Select(c => "H." + c))}
            FROM dbo.MsmeCertifications C WITH (NOLOCK)
            OUTER APPLY (SELECT {history}, MAX(CASE WHEN Descrip LIKE 'Sections allocation done%' THEN CreatedDate END) AS DistributedOn
                         FROM dbo.MsmeHistory WITH (NOLOCK) WHERE ZedId = C.ZedId AND CertificationType = C.Certification) H
            OUTER APPLY (SELECT MAX(CASE WHEN MeetingType = 'Open Meeting' THEN CreatedDate END) AS OpenMeetingOn,
                                MAX(CASE WHEN MeetingType = 'Close Meeting' THEN CreatedDate END) AS CloseMeetingOn
                         FROM dbo.Meetings WITH (NOLOCK) WHERE ZedId = C.ZedId AND CertificationType = C.Certification) MT
            WHERE C.CertificationStatus IN ({string.Join(", ", Covered)}) AND C.Certification IN @Levels
              AND (@AgencyId IS NULL OR C.CertificationBodyUserId = @AgencyId) AND {accepted};
            """;
    }

    /// <summary>The cases (none when they cannot be read: the page then shows the procedure's counts only).</summary>
    public static async Task<IReadOnlyList<Fact>?> FactsAsync(ISqlExecutor db, PortalSystem system, IReadOnlyList<string> levels, string? agencyId,
        ILogger log, CancellationToken ct)
    {
        if (levels.Count == 0) return [];
        try
        {
            return await db.QuerySqlAsync<Fact>(FactsSql(system), new { Levels = levels, AgencyId = agencyId }, ct);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Monitoring details (sub-sections, TAT) not readable");
            return null;
        }
    }

    // ------------------------------------------------------------------ classification

    /// <summary>
    /// The monitoring stage of a case as SP_MONITORING_GET_LIST lists it (main and Consultancy; Surveillance: desktop at 1-3,
    /// a site visit not started until the selfie is synced); null for a status no stage shows.
    /// </summary>
    public static int? StageOf(PortalSystem system, Fact f)
    {
        var s = f.Status;
        var join = f.JoinRoomStatus ?? 0;
        if (system == PortalSystem.Surveillance)
        {
            var selfie = (f.IsSelfieSynced ?? 0) == 1;
            if ((s == 1 && f.DesktopAccepted) || s == 8 || (s == 9 && f.NotRemote && !selfie) || (s == 9 && f.Remote && join == 0)) return 2;
            if (s is 2 or 3 or 13 || (s == 9 && f.NotRemote && selfie) || (s == 9 && f.Remote && join == 1)) return 3;
        }
        else
        {
            if (s is 2 or 8 || (s == 9 && f.Remote && join == 0)) return 2;
            if (s is 3 or 13 || (s == 9 && (f.NotRemote || (f.Remote && join == 1)))) return 3;
        }
        return s switch { 4 or 14 => 4, 5 or 15 => 5, 7 or 17 => 7, _ => null };
    }

    /// <summary>Desktop assessment (below 8) or Site assessment; the milestone ("m1"...) on the Consultancy portal.</summary>
    public static string TrackOf(PortalSystem system, int status, int? milestone) =>
        system == PortalSystem.Consultancy ? $"m{Math.Max(1, milestone ?? 1)}" : status < 8 ? Desktop : Site;

    /// <summary>The date the page's date range filters on, by stage (see the class summary).</summary>
    public static DateTime? StageDate(PortalSystem system, int stage, Fact f)
    {
        var site = system == PortalSystem.Consultancy || f.Status >= 8;
        return stage switch
        {
            2 when system == PortalSystem.Consultancy => f.CoAlloted ?? f.CertificationStatusDate,
            2 => site ? f.ScheduledOn ?? f.CertificationStatusDate : f.DocVerifiAllot ?? f.DesktopAcceptOrRejectDate ?? f.CertificationStatusDate,
            3 => site ? f.AssessmentDate ?? f.CertificationStatusDate : f.CertificationStatusDate,
            _ => f.CertificationStatusDate,
        };
    }

    /// <summary>
    /// Where a site assessment in progress is (the app's records): submitted through the mobile app (status 13), the opening
    /// meeting conducted (dbo.Meetings "Open Meeting"), else the parameters distributed (8 → 9). Null for other cases.
    /// </summary>
    public static string? StepOf(PortalSystem system, int stage, Fact f)
    {
        if (stage != 3 || (system != PortalSystem.Consultancy && f.Status < 8)) return null;
        if (f.Status == 13) return StepSubmitted;
        return f.OpenMeetingOn is not null ? StepOpening : StepDistributed;
    }

    /// <summary>What the page adds to one case.</summary>
    public sealed record Insight(int? Stage, string Track, DateTime? StageDate, string? Step, bool SubmissionPending, TatResult Tat);

    public static Insight Of(PortalSystem system, Fact f, TatRules rules, IReadOnlyDictionary<string, int> manDays, DateTime now)
    {
        var stage = StageOf(system, f);
        var track = TrackOf(system, f.Status, f.NcCount);
        var step = stage is { } st ? StepOf(system, st, f) : null;
        var pending = system != PortalSystem.Consultancy && stage == 3 && track == Site && f.Status != 13 &&
            LevelManDays.SubmissionPending(f.OpenMeetingOn, f.AssessmentDate, false, manDays.TryGetValue(f.Certification?.Trim() ?? "", out var d) ? d : null, now);
        var tat = TatEvaluator.Evaluate(TatEvaluator.BuildCase(system, f.Certification?.Trim() ?? "", f.Status, f.CertificationStatusDate, f.Sources()), rules, now);
        return new Insight(stage, track, stage is { } s2 ? StageDate(system, s2, f) : null, step, pending, tat);
    }

    // ------------------------------------------------------------------ the list

    /// <summary>One stage card: its cases per sub-section and how many are delayed (TAT).</summary>
    public sealed record StageCount(int Status, int Total, int Delayed, Dictionary<string, int> Tracks);

    public static List<StageCount> Stages(PortalSystem system, IEnumerable<Insight?> cases, IEnumerable<int> stages)
    {
        var list = cases.Where(c => c?.Stage is not null).Select(c => c!).ToList();
        return stages.Select(s =>
        {
            var inStage = list.Where(c => c.Stage == s).ToList();
            var tracks = system == PortalSystem.Consultancy
                ? new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase)
                : new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase) { [Desktop] = 0, [Site] = 0 };
            foreach (var c in inStage) tracks[c.Track] = tracks.GetValueOrDefault(c.Track) + 1;
            return new StageCount(s, inStage.Count, inStage.Count(c => c.Tat.Primary?.IsLate ?? false), tracks);
        }).ToList();
    }

    /// <summary>
    /// Adds the case's details to a row of the procedure (matched by Id, else ZED ID and level): Track, StageDate, Step,
    /// SubmissionPending and the TAT (TatDue, TatLateHours, TatBucket, TatLabel, TatRule). A row without its case keeps the
    /// sub-section of its status only.
    /// </summary>
    public static void Enrich(PortalSystem system, IDictionary<string, object?> row, int stage, Fact? fact, Insight? insight)
    {
        var status = Int(row, "CertificationStatus") ?? fact?.Status ?? 0;
        row["Track"] = insight?.Track ?? TrackOf(system, status, Int(row, "NcCount"));
        var stageDate = fact is null ? null : StageDate(system, stage, fact);
        row["StageDate"] = Iso(stageDate);
        row["Step"] = fact is null ? null : StepOf(system, stage, fact);
        row["SubmissionPending"] = insight?.SubmissionPending ?? false;
        var primary = insight?.Tat.Primary;
        row["TatDue"] = Iso(primary?.Due);
        row["TatLateHours"] = primary is null ? null : Math.Round(primary.LateHours, 1);
        row["TatBucket"] = TatEvaluator.Bucket(primary?.LateHours);
        row["TatLabel"] = primary is null ? null : TatEvaluator.Label(primary.LateHours);
        row["TatRule"] = primary is null ? null : RuleName(system, primary);
    }

    /// <summary>The relation's name, or "Days allowed in {status}" for the current status's rule.</summary>
    public static string RuleName(PortalSystem system, TatItem item) =>
        item.Kind == "relation" ? item.Name : $"Days allowed in {TatCatalog.Find(system, item.From)?.Name ?? item.From}";

    /// <summary>The rows whose stage date is within the range (inclusive dates); a row without one is left out once a range is set.</summary>
    public static bool InRange(object? stageDate, DateOnly? from, DateOnly? to)
    {
        if (from is null && to is null) return true;
        if (stageDate is not string s || !DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)) return false;
        var day = DateOnly.FromDateTime(d);
        return (from is null || day >= from) && (to is null || day <= to);
    }

    /// <summary>Most delayed first (no TAT last), the procedure's order otherwise.</summary>
    public static List<Dictionary<string, object?>> MostDelayedFirst(IEnumerable<Dictionary<string, object?>> rows) =>
        rows.Select((r, i) => (r, i))
            .OrderBy(x => x.r.GetValueOrDefault("TatLateHours") is double ? 0 : 1)
            .ThenByDescending(x => x.r.GetValueOrDefault("TatLateHours") as double? ?? 0)
            .ThenBy(x => x.i).Select(x => x.r).ToList();

    public static string Key(string? zedId, string? level) => $"{zedId?.Trim()}|{level?.Trim()}".ToUpperInvariant();

    private static string? Iso(DateTime? d) => d?.ToString("yyyy-MM-dd'T'HH:mm:ss", CultureInfo.InvariantCulture);

    private static int? Int(IDictionary<string, object?> row, string field) =>
        row.TryGetValue(field, out var v) && v is not null and not DBNull && int.TryParse(Convert.ToString(v, CultureInfo.InvariantCulture), out var n) ? n : null;
}
