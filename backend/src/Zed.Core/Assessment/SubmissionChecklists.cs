using System.Text.Json;
using System.Text.RegularExpressions;
using Zed.Core.Data;
using Microsoft.Extensions.Logging;
using Zed.Core.Http;

namespace Zed.Core.Assessment;

/// <summary>One item the user ticks before a final submit or a quality-check approval. Empty <see cref="Stages"/>: always asked.</summary>
public sealed record ChecklistItem(string Id, string Text, IReadOnlyList<string> Stages, bool Active = true);

/// <summary>
/// One checklist (2026-11-17, approved): where it is asked, the stages an item can be limited to and its standard items.
/// </summary>
public sealed record ChecklistKind(string Code, string Title, string Who, string Key, IReadOnlyList<string> Stages, IReadOnlyList<ChecklistItem> Defaults);

/// <summary>
/// Admin → Submission checklists (2026-11-17, approved): the items the assessor (or consultant) ticks before the final submit and
/// the agency (or consultant organisation) before its quality-check approval. Per system, in the system's own dbo.V4Settings
/// (JSON, migration 0011), as <see cref="SiteTourSections"/>: the ZED Certification and Surveillance portals keep an agency
/// quality check and an assessor final submit list, the Consultancy portal a consultant organisation quality check and a
/// consultant final submit list. Every list covers all levels (the user, 2026-11-17). The ticks are recorded with the
/// submission (<see cref="RecordAsync"/>): one 'SubmitChk' row on the legacy dbo.AssessorComments with the items' wording as
/// ticked, who and when (migration 0095).
/// </summary>
public static partial class SubmissionChecklists
{
    public const string AgencyQc = "agency-qc", AssessorSubmit = "assessor-submit", CoQc = "co-qc", ConsultantSubmit = "consultant-submit";

    public const string Desktop = "Desktop", Site = "Site", Remote = "Remote", Onsite = "Onsite";

    public const int MaxItems = 15;
    public const int MaxText = 250;

    /// <summary>AssessorComments.AssessmentType (varchar(10) on the main database) of a recorded submission.</summary>
    public const string RecordType = "SubmitChk";

    public static readonly ChecklistKind AgencyQcKind = new(AgencyQc, "Agency quality check", "agency", "Checklist.AgencyQc", [Desktop, Site],
    [
        new("exemptions", "I have reviewed all the exemptions, and they have been applied correctly.", [Desktop]),
        new("quality", "I confirm that the quality check of the assessment has been done and relevant amendments made wherever applicable.", [Desktop, Site]),
        new("evidence", "Every requirement's evidence was verified against the assessor's answer.", [Desktop, Site]),
        new("photos", "The site photos are geo-tagged and belong to this unit.", [Site]),
        new("nc-remarks", "Every non-conformance has the assessor's remarks.", [Desktop, Site]),
    ]);

    public static readonly ChecklistKind AssessorSubmitKind = new(AssessorSubmit, "Assessor final submit", "assessor", "Checklist.AssessorSubmit",
        [Desktop, Remote, Onsite],
    [
        new("answers", "Every requirement has been assessed and has my remarks.", [Desktop, Remote, Onsite]),
        new("evidence", "I have checked the unit's evidence for every requirement.", [Desktop, Remote, Onsite]),
        new("photos", "Photos are taken for every site tour section.", [Onsite]),
        new("meetings", "The attendance of the opening and closing meetings is complete.", [Remote, Onsite]),
        new("coi", "I have no conflict of interest with the unit.", [Desktop, Remote, Onsite]),
    ]);

    public static readonly ChecklistKind CoQcKind = new(CoQc, "Consultant organisation quality check", "consultant organisation", "Checklist.CoQc", [],
    [
        new("quality", "I have checked the quality of the consultant's work on this milestone.", []),
        new("checkpoints", "Every checkpoint answer is justified by the consultant's remarks.", []),
        new("action-plan", "The action plan is adequate for the gaps found.", []),
        new("photos", "The photos are geo-tagged and belong to this unit.", []),
    ]);

    public static readonly ChecklistKind ConsultantSubmitKind = new(ConsultantSubmit, "Consultant final submit", "consultant", "Checklist.ConsultantSubmit", [],
    [
        new("checkpoints", "Every checkpoint is answered with my remarks.", []),
        new("action-plan", "The action plan and the trainings of this milestone are recorded.", []),
        new("meetings", "The meetings' attendance and photos are complete.", []),
        new("coi", "I have no conflict of interest with the unit.", []),
    ]);

    /// <summary>The checklists of a system: the Consultancy portal's are the handholding ones.</summary>
    public static IReadOnlyList<ChecklistKind> For(PortalSystem system) =>
        system == PortalSystem.Consultancy ? [CoQcKind, ConsultantSubmitKind] : [AgencyQcKind, AssessorSubmitKind];

    public static ChecklistKind? Kind(PortalSystem system, string? code) =>
        For(system).FirstOrDefault(k => string.Equals(k.Code, code?.Trim(), StringComparison.OrdinalIgnoreCase));

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>The saved items in their order, or the standard ones (also when the saved text cannot be read).</summary>
    public static async Task<IReadOnlyList<ChecklistItem>> LoadAsync(IPortalSettings settings, ChecklistKind kind, CancellationToken ct)
    {
        var text = await settings.GetAsync(kind.Key, ct);
        if (string.IsNullOrWhiteSpace(text)) return kind.Defaults;
        try
        {
            var list = JsonSerializer.Deserialize<List<ChecklistItem>>(text, Json);
            return list is null ? kind.Defaults : list.Select(i => Clean(i, kind)).ToList();
        }
        catch (JsonException)
        {
            return kind.Defaults;
        }
    }

    public static Task SaveAsync(IPortalSettings settings, ChecklistKind kind, IReadOnlyList<ChecklistItem> items, string userId, CancellationToken ct) =>
        settings.SetAsync(kind.Key, JsonSerializer.Serialize(items.Select(i => Clean(i, kind)), Json), userId, ct);

    /// <summary>The items asked at a stage (in use, limited to the stage or to none), in order.</summary>
    public static IReadOnlyList<ChecklistItem> Asked(IReadOnlyList<ChecklistItem> all, string? stage) =>
        all.Where(i => i.Active && (i.Stages.Count == 0 || stage is null || i.Stages.Contains(stage, StringComparer.OrdinalIgnoreCase))).ToList();

    /// <summary>The items asked at the stage, loaded.</summary>
    public static async Task<IReadOnlyList<ChecklistItem>> AskedAsync(IPortalSettings settings, ChecklistKind kind, string? stage, CancellationToken ct) =>
        Asked(await LoadAsync(settings, kind, ct), stage);

    /// <summary>The first problem of a list the Admin saves, or null. An empty list (or every item off) asks nothing.</summary>
    public static string? Problem(ChecklistKind kind, IReadOnlyList<ChecklistItem>? items)
    {
        if (items is null) return "Invalid request.";
        if (items.Count > MaxItems) return $"At most {MaxItems} items.";
        var texts = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var i in items)
        {
            var text = i.Text?.Trim() ?? "";
            if (text.Length == 0) return "Every item needs its text.";
            if (text.Length > MaxText) return $"An item can have at most {MaxText} characters.";
            if (!texts.Add(text)) return $"\"{Short(text)}\" is listed twice.";
            if (string.IsNullOrWhiteSpace(i.Id) || !IdPattern().IsMatch(i.Id) || !ids.Add(i.Id)) return $"\"{Short(text)}\": invalid item key.";
            var stages = i.Stages ?? [];
            if (stages.Any(s => !kind.Stages.Contains(s?.Trim() ?? "", StringComparer.OrdinalIgnoreCase))) return $"\"{Short(text)}\": invalid stage.";
            if (kind.Stages.Count > 0 && stages.Count == 0) return $"\"{Short(text)}\": choose where it is asked.";
        }
        return null;
    }

    /// <summary>
    /// The first problem of the ticks sent with a submission (the ids of the ticked items), or null when every item asked is
    /// ticked. Null <paramref name="ticked"/> is treated as nothing ticked.
    /// </summary>
    public static string? Unticked(IReadOnlyList<ChecklistItem> asked, IReadOnlyCollection<string>? ticked)
    {
        var set = new HashSet<string>((ticked ?? []).Where(t => !string.IsNullOrWhiteSpace(t)).Select(t => t.Trim()), StringComparer.OrdinalIgnoreCase);
        var missing = asked.Count(i => !set.Contains(i.Id));
        return missing == 0 ? null
            : missing == 1 ? "Please tick the checklist item before you submit."
            : $"Please tick all {asked.Count} checklist items before you submit ({missing} not ticked).";
    }

    /// <summary>
    /// The items asked of a submission at the stage and the problem of its ticks (null when every one is ticked), for the final
    /// submits to check before they run.
    /// </summary>
    public static async Task<(IReadOnlyList<ChecklistItem> Asked, string? Problem)> CheckAsync(IPortalSettings settings, ChecklistKind kind, string? stage,
        IReadOnlyCollection<string>? ticked, CancellationToken ct)
    {
        var asked = await AskedAsync(settings, kind, kind.Stages.Count == 0 ? null : stage, ct);
        return (asked, Unticked(asked, ticked));
    }

    /// <summary>
    /// <see cref="RecordAsync"/> after the submission has committed: a failure is logged and never undoes or hides the submission.
    /// </summary>
    public static async Task TryRecordAsync(ISqlExecutor db, ILogger log, string zedId, string level, ChecklistKind kind, string? stage, int? round,
        IReadOnlyList<ChecklistItem> asked, string role, string? agencyId, string by, string? byName, CancellationToken ct)
    {
        try
        {
            await RecordAsync(db, zedId, level, kind, stage, round, asked, role, agencyId, by, byName, ct);
        }
        catch (System.Data.Common.DbException ex)
        {
            log.LogError(ex, "The {Checklist} checklist of {ZedId} {Level} was not recorded (are migrations 0088 / 0095 applied?)", kind.Code, zedId, level);
        }
    }

    // ------------------------------------------------------------------ the record of a submission

    /// <summary>The ticked items' wording, one per line ("1. …"), as stored (AssessorComments.AssessorRemarks, varchar(5000)).</summary>
    public static string RecordText(IReadOnlyList<ChecklistItem> asked) =>
        string.Join("\n", asked.Select((i, n) => $"{n + 1}. {i.Text}"));

    internal const string InsertSql =
        "INSERT INTO dbo.AssessorComments (ZedId, Certification, NcCount, AssessorRemarks, CertificationStatusDate, AssessmentType, QoRound, QoStage, " +
        "QoCategory, QoRefLabel, QoAgencyId, QoBy, QoByName) " +
        "VALUES (@ZedId, @Certification, NULL, @Text, GETDATE(), 'SubmitChk', @Round, @Stage, @Checklist, @Role, @AgencyId, @By, @ByName);";

    internal const string UnitSql =
        "SELECT CAST(Id AS bigint) AS Id, AssessorRemarks AS Text, CertificationStatusDate AS At, QoRound AS Round, QoStage AS Stage, " +
        "QoCategory AS Checklist, QoRefLabel AS Role, QoBy AS By, QoByName AS ByName FROM dbo.AssessorComments " +
        "WHERE ZedId = @ZedId AND Certification = @Certification AND AssessmentType = 'SubmitChk' ORDER BY Id DESC;";

    /// <summary>A recorded submission as the review pages show it.</summary>
    public sealed class Record
    {
        public long Id { get; init; }
        public string? Text { get; init; }
        public DateTime? At { get; init; }
        public int? Round { get; init; }
        public string? Stage { get; init; }
        public string? Checklist { get; init; }
        public string? Role { get; init; }
        public string? By { get; init; }
        public string? ByName { get; init; }

        /// <summary>The items as ticked (without their numbers).</summary>
        public IReadOnlyList<string> Items =>
            (Text ?? "").Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(l => ItemNumber().Replace(l, "")).ToList();

        public string Title => Checklist switch
        {
            AgencyQc => AgencyQcKind.Title, AssessorSubmit => AssessorSubmitKind.Title, CoQc => CoQcKind.Title, ConsultantSubmit => ConsultantSubmitKind.Title,
            _ => Checklist ?? "",
        };
    }

    /// <summary>
    /// Records the ticks of a submission (nothing when no item was asked). <paramref name="role"/> is who ticked as shown
    /// ("Agency", "Assessor", …); <paramref name="agencyId"/> the agency of the assessment, when known.
    /// </summary>
    public static async Task RecordAsync(ISqlExecutor db, string zedId, string level, ChecklistKind kind, string? stage, int? round,
        IReadOnlyList<ChecklistItem> asked, string role, string? agencyId, string by, string? byName, CancellationToken ct)
    {
        if (asked.Count == 0) return;
        await db.ExecuteSqlAsync(InsertSql, new
        {
            ZedId = Ansi(zedId, 50), Certification = Ansi(level, 50), Text = Ansi(RecordText(asked), 5000), Round = round, Stage = stage,
            Checklist = kind.Code, Role = role, AgencyId = agencyId?.Trim(), By = Ansi(by, 50), ByName = Cut(byName ?? by, 150),
        }, ct);
    }

    internal const string RecordedSql =
        "SELECT COUNT(*) FROM dbo.AssessorComments WHERE ZedId = @ZedId AND Certification = @Certification AND AssessmentType = 'SubmitChk' " +
        "AND QoCategory = @Checklist AND QoStage = @Stage AND ISNULL(QoRound, 0) = @Round AND QoBy = @By;";

    /// <summary>Whether <paramref name="by"/> already ticked the checklist at the stage in this round (false when it cannot be read).</summary>
    public static async Task<bool> RecordedAsync(ISqlExecutor db, string zedId, string level, ChecklistKind kind, string stage, int round, string by,
        CancellationToken ct)
    {
        try
        {
            return (await db.QuerySqlAsync<int>(RecordedSql, new
            {
                ZedId = Ansi(zedId, 50), Certification = Ansi(level, 50), Checklist = kind.Code, Stage = stage, Round = round, By = Ansi(by.Trim(), 50),
            }, ct)).FirstOrDefault() > 0;
        }
        catch (System.Data.Common.DbException)
        {
            return false;
        }
    }

    public static async Task<IReadOnlyList<Record>> RecordsAsync(ISqlExecutor db, string zedId, string level, CancellationToken ct) =>
        await db.QuerySqlAsync<Record>(UnitSql, new { ZedId = Ansi(zedId, 50), Certification = Ansi(level, 50) }, ct);

    private static Dapper.DbString Ansi(string value, int length) =>
        new() { Value = value.Length <= length ? value : value[..length], IsAnsi = true, Length = length };

    private static string? Cut(string? value, int max) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim().Length <= max ? value.Trim() : value.Trim()[..max];

    private static string Short(string text) => text.Length <= 40 ? text : text[..40] + "…";

    private static ChecklistItem Clean(ChecklistItem i, ChecklistKind kind) => i with
    {
        Id = i.Id?.Trim() ?? "",
        Text = i.Text?.Trim() ?? "",
        Stages = kind.Stages.Where(s => (i.Stages ?? []).Contains(s, StringComparer.OrdinalIgnoreCase)).ToList(),
    };

    [GeneratedRegex(@"^[a-z0-9][a-z0-9_-]{0,39}$", RegexOptions.IgnoreCase)]
    private static partial Regex IdPattern();

    [GeneratedRegex(@"^\d+\.\s*")]
    private static partial Regex ItemNumber();
}
