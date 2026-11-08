using System.Data.Common;
using Dapper;
using Microsoft.Extensions.Logging;
using Zed.Core.Data;

namespace Zed.Core.Assessment;

/// <summary>
/// Yes / Partial / No for each checkpoint of a requirement (V4, migration 0039). A unit's checkpoints are its rows of
/// dbo.MsmeOptions (copied from the questionnaire at payment); the Admin's actions needed come from dbo.Options.ActionsNeeded
/// and the evidence of each checkpoint from dbo.Evidences.OptionCode (migration 0034; handholding reads main's questionnaire).
/// The desktop assessor, the site assessor (remote assessment page, and the SA app's SubmitParameter) and the handholding
/// consultant answer; the requirement's legacy conformance
/// is then Yes when every checkpoint is Yes, otherwise No (a Partial is not conforming). A requirement without checkpoint
/// rows, or a database before 0039, keeps the old Yes / No conformance.
/// </summary>
public static class CheckpointAnswers
{
    public const string Yes = "Yes";
    public const string Partial = "Partial";
    public const string No = "No";
    public const int MaxRemarks = 1000;
    public const int MaxRequirementRemarks = 2000;

    public enum Stage { Desktop, Site, Baseline, Review1, Review2 }

    /// <summary>An evidence of the checkpoint: <c>Uploaded</c> the unit sent its file, <c>Verified</c> the assessor's Yes / No.</summary>
    public sealed record Evidence(long Id, string Name, bool Mandatory, bool Uploaded, string? Verified);

    public sealed record Answer(string Value, IReadOnlyList<string> Actions, string? Remarks);

    /// <param name="Id">MsmeOptions.Id.</param>
    /// <param name="RequirementId">MsmeRequirements.Id of the unit's requirement row.</param>
    public sealed record Checkpoint(
        long Id, long RequirementId, string OptionCode, string Text, IReadOnlyList<string> Actions, IReadOnlyList<Evidence> Evidences,
        Answer? Desktop, Answer? Site, Answer? Baseline, string? Review1, string? Review2);

    public sealed record AnswerRequest(long Id, string? Answer, List<string>? Actions, string? Remarks);

    /// <param name="Remarks">The requirement's remarks for the unit; when empty and not conforming, the answers are summarised.</param>
    public sealed record SaveRequest(List<AnswerRequest>? Answers, string? Remarks);

    /// <summary>What a valid save writes: each checkpoint's answer, the requirement's conformance and its remarks.</summary>
    public sealed record Decision(IReadOnlyList<(Checkpoint Checkpoint, Answer Answer)> Answers, string Conformance, string? Remarks);

    // ------------------------------------------------------------------ read

    /// <summary>The unit's requirement rows with their checkpoints: those of the same round (NcCount), else the first copy.</summary>
    internal static string Rows(string select, string table, string join) => $"""
        WITH R AS (
            SELECT CAST(r.Id AS bigint) AS RequirementRowId, LTRIM(RTRIM(r.SectionCode)) AS Sc, LTRIM(RTRIM(r.RequirementCode)) AS Rc, ISNULL(r.NcCount, 0) AS Nc
            FROM dbo.MsmeRequirements r
            WHERE r.ZedId = @ZedId AND r.SectionType = @Certification AND (@RequirementId IS NULL OR r.Id = @RequirementId)
        ), X AS (
            SELECT x.*, LTRIM(RTRIM(x.SectionCode)) AS Sc, LTRIM(RTRIM(x.RequirementCode)) AS Rc, ISNULL(x.NcCount, 0) AS Nc
            FROM dbo.{table} x WHERE x.ZedId = @ZedId AND x.SectionType = @Certification
        )
        SELECT R.RequirementRowId, {select}
        FROM R JOIN X ON X.Sc = R.Sc AND X.Rc = R.Rc
            AND X.Nc = CASE WHEN EXISTS (SELECT 1 FROM X y WHERE y.Sc = R.Sc AND y.Rc = R.Rc AND y.Nc = R.Nc) THEN R.Nc ELSE 0 END
        {join}
        """;

    /// <param name="master">The questionnaire's schema: "dbo" (main, surveillance) or "ZEDCS_V2_LIVE.dbo" (handholding).</param>
    /// <remarks>
    /// The questionnaire's checkpoint is looked for within the unit's requirement only, by id and text first (2026-11-08):
    /// surveillance copies a unit's rows from main with main's ids, which are not the ids of surveillance's own questionnaire,
    /// and the Admin's edits renumber and re-create rows on both. An id that points into another requirement is never used.
    /// </remarks>
    public static string CheckpointSql(string master) => Rows(
        "CAST(X.Id AS bigint) AS Id, LTRIM(RTRIM(X.OptionCode)) AS OptionCode, X.OptionName, m.ActionsNeeded, " +
        "X.DaAnswer, X.DaActions, X.DaRemarks, X.SaAnswer, X.SaActions, X.SaRemarks, X.HhAnswer, X.HhActions, X.HhRemarks, X.HhReview1, X.HhReview2",
        "MsmeOptions",
        $"""
        OUTER APPLY (SELECT TOP 1 o.ActionsNeeded FROM {master}.Options o
            WHERE o.SectionType = X.SectionType AND LTRIM(RTRIM(o.SectionCode)) = X.Sc AND LTRIM(RTRIM(o.RequirementCode)) = X.Rc
              AND (o.Id = X.OptionId OR o.OptionName = X.OptionName OR LTRIM(RTRIM(o.OptionCode)) = LTRIM(RTRIM(X.OptionCode)))
            ORDER BY CASE WHEN o.Id = X.OptionId AND o.OptionName = X.OptionName THEN 0 WHEN o.OptionName = X.OptionName THEN 1
                          WHEN o.Id = X.OptionId THEN 2 ELSE 3 END) m
        ORDER BY R.RequirementRowId, TRY_CAST(X.OptionCode AS int), X.OptionCode;
        """);

    /// <summary>
    /// The unit's evidences that belong to a checkpoint. The Admin's edit renumbers the questionnaire's evidences, and
    /// surveillance's copies carry main's ids (the second surveillance id + 100), so an evidence is looked for within its
    /// requirement: id and name, then number and name, then id, then name.
    /// </summary>
    public static string EvidenceSql(string master) => Rows(
        "CAST(X.Id AS bigint) AS Id, LTRIM(RTRIM(m.OptionCode)) AS OptionCode, X.EvidenceName, CAST(ISNULL(X.EvidenceType, 0) AS bit) AS Mandatory, " +
        "CAST(CASE WHEN X.SyncedDate IS NULL THEN 0 ELSE 1 END AS bit) AS Uploaded, X.IsVerified",
        "MsmeEvidences",
        $"""
        CROSS APPLY (SELECT TOP 1 e.OptionCode FROM {master}.Evidences e
            WHERE e.SectionType = X.SectionType AND LTRIM(RTRIM(e.SectionCode)) = X.Sc AND LTRIM(RTRIM(e.RequirementCode)) = X.Rc
              AND (e.Id = X.EvidenceId OR e.EvidenceName = X.EvidenceName)
            ORDER BY CASE WHEN e.Id = X.EvidenceId AND e.EvidenceName = X.EvidenceName THEN 0
                          WHEN e.EvidenceCode = X.EvidenceCode AND e.EvidenceName = X.EvidenceName THEN 1
                          WHEN e.Id = X.EvidenceId THEN 2 ELSE 3 END) m
        WHERE NULLIF(LTRIM(RTRIM(m.OptionCode)), '') IS NOT NULL
        ORDER BY R.RequirementRowId, TRY_CAST(X.EvidenceCode AS int);
        """);

    public sealed class CheckpointRow
    {
        public long RequirementRowId { get; init; }
        public long Id { get; init; }
        public string? OptionCode { get; init; }
        public string? OptionName { get; init; }
        public string? ActionsNeeded { get; init; }
        public string? DaAnswer { get; init; }
        public string? DaActions { get; init; }
        public string? DaRemarks { get; init; }
        public string? SaAnswer { get; init; }
        public string? SaActions { get; init; }
        public string? SaRemarks { get; init; }
        public string? HhAnswer { get; init; }
        public string? HhActions { get; init; }
        public string? HhRemarks { get; init; }
        public string? HhReview1 { get; init; }
        public string? HhReview2 { get; init; }
    }

    public sealed class EvidenceRow
    {
        public long RequirementRowId { get; init; }
        public long Id { get; init; }
        public string? OptionCode { get; init; }
        public string? EvidenceName { get; init; }
        public bool Mandatory { get; init; }
        public bool Uploaded { get; init; }
        public string? IsVerified { get; init; }
    }

    /// <summary>
    /// The checkpoints of the unit's requirement rows (one row when <paramref name="requirementId"/> is given). Empty before
    /// migration 0039 (or 0034): the pages then keep the old Yes / No conformance.
    /// </summary>
    public static async Task<IReadOnlyList<Checkpoint>> LoadAsync(ISqlExecutor db, string zedId, string level, long? requirementId, string master,
        ILogger log, CancellationToken ct)
    {
        var args = new { ZedId = Ansi(zedId), Certification = Ansi(level), RequirementId = requirementId };
        try
        {
            var rows = await db.QuerySqlAsync<CheckpointRow>(CheckpointSql(master), args, ct);
            if (rows.Count == 0) return [];
            var evidences = await db.QuerySqlAsync<EvidenceRow>(EvidenceSql(master), args, ct);
            return rows.Select(r => ToCheckpoint(r, evidences)).ToList();
        }
        catch (Exception ex) when (ex is DbException or System.Data.DataException or InvalidCastException or FormatException)
        {
            // DataException / InvalidCast: a column Dapper could not map (2026-11-07: a mapping error no longer fails the page).
            log.LogWarning(ex, "Checkpoint answers of {ZedId} {Level} not read (are migrations 0034 and 0039 applied?); the requirement conformance is used",
                zedId, level);
            return [];
        }
    }

    private static Checkpoint ToCheckpoint(CheckpointRow r, IReadOnlyList<EvidenceRow> evidences)
    {
        var code = r.OptionCode?.Trim() ?? "";
        return new Checkpoint(
            r.Id, r.RequirementRowId, code, r.OptionName?.Trim() ?? "", Lines(r.ActionsNeeded),
            evidences.Where(e => e.RequirementRowId == r.RequirementRowId && e.OptionCode?.Trim() == code)
                .Select(e => new Evidence(e.Id, e.EvidenceName?.Trim() ?? "", e.Mandatory, e.Uploaded, Normalise(e.IsVerified))).ToList(),
            Stored(r.DaAnswer, r.DaActions, r.DaRemarks), Stored(r.SaAnswer, r.SaActions, r.SaRemarks), Stored(r.HhAnswer, r.HhActions, r.HhRemarks),
            Normalise(r.HhReview1), Normalise(r.HhReview2));
    }

    private static Answer? Stored(string? value, string? actions, string? remarks) =>
        Normalise(value) is { } v ? new Answer(v, Lines(actions), string.IsNullOrWhiteSpace(remarks) ? null : remarks.Trim()) : null;

    private static List<string> Lines(string? stored) =>
        (stored ?? "").Split('\n', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).ToList();

    /// <summary>"Yes", "Partial" or "No" (any case), else null.</summary>
    public static string? Normalise(string? value) => value?.Trim().ToLowerInvariant() switch
    {
        "yes" => Yes,
        "partial" => Partial,
        "no" => No,
        _ => null,
    };

    // ------------------------------------------------------------------ rules

    /// <param name="hasPhoto">Handholding: the requirement has an evidence photo (handholding has no per-evidence uploads).</param>
    public static (Decision? Decision, string? Problem) Decide(IReadOnlyList<Checkpoint> checkpoints, SaveRequest req, Stage stage, bool hasPhoto = false)
    {
        if (checkpoints.Count == 0) return (null, "This requirement has no checkpoints.");
        var given = req.Answers ?? [];
        if (given.Any(a => checkpoints.All(c => c.Id != a.Id)) || given.GroupBy(a => a.Id).Any(g => g.Count() > 1)) return (null, "Invalid request.");
        var review = stage is Stage.Review1 or Stage.Review2;
        var result = new List<(Checkpoint, Answer)>();
        foreach (var c in checkpoints)
        {
            var a = given.FirstOrDefault(x => x.Id == c.Id);
            var name = $"Checkpoint {c.OptionCode}";
            if (Normalise(a?.Answer) is not { } value) return (null, $"{name}: please choose Yes, Partial or No.");
            var remarks = string.IsNullOrWhiteSpace(a!.Remarks) ? null : a.Remarks.Trim();
            if (remarks?.Length > MaxRemarks) return (null, $"{name}: the remark can be up to {MaxRemarks} characters.");
            if (remarks is not null && remarks.Any(ch => char.IsControl(ch) && ch is not '\n' and not '\r')) return (null, $"{name}: the remark contains invalid characters.");

            var ticked = (a.Actions ?? []).Select(x => x?.Trim() ?? "").Where(x => x.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase)
                .Select(x => c.Actions.FirstOrDefault(y => string.Equals(y, x, StringComparison.OrdinalIgnoreCase))).ToList();
            if (ticked.Any(x => x is null)) return (null, $"{name}: please choose the actions from the list.");
            List<string> actions = value == Yes || review ? [] : ticked.Select(x => x!).ToList();

            if (value == Yes)
            {
                var mandatory = c.Evidences.Where(e => e.Mandatory).ToList();
                if (stage is Stage.Desktop or Stage.Site)
                {
                    if (mandatory.FirstOrDefault(e => !e.Uploaded) is { } missing)
                        return (null, $"{name}: Yes needs every mandatory evidence; \"{missing.Name}\" is not uploaded.");
                    if (mandatory.FirstOrDefault(e => e.Verified == No) is { } refused)
                        return (null, $"{name}: Yes needs every mandatory evidence; \"{refused.Name}\" was not verified.");
                }
                else if (mandatory.Count > 0 && !hasPhoto)
                    return (null, $"{name}: Yes needs the mandatory evidence; please add a photo of it to this parameter first.");
            }
            else if (!review && c.Actions.Count > 0 && actions.Count == 0)
                return (null, $"{name}: please tick the actions needed.");
            else if (!review && c.Actions.Count == 0 && remarks is null)
                return (null, $"{name}: please write what is needed.");
            result.Add((c, new Answer(value, actions, remarks)));
        }

        var conformance = result.All(x => x.Item2.Value == Yes) ? Yes : No;
        var own = string.IsNullOrWhiteSpace(req.Remarks) ? null : req.Remarks.Trim();
        if (own?.Length > MaxRequirementRemarks) return (null, $"The remarks can be up to {MaxRequirementRemarks} characters.");
        return (new Decision(result, conformance, own ?? (conformance == No ? Summary(result) : null)), null);
    }

    /// <summary>"2. Partial: Set measurable quality objectives. 3. No: Train all employees; Display the policy." for the unit's NC page.</summary>
    public static string Summary(IEnumerable<(Checkpoint Checkpoint, Answer Answer)> answers)
    {
        var text = string.Join(" ", answers.Where(x => x.Answer.Value != Yes).Select(x =>
        {
            var what = x.Answer.Actions.Count > 0 ? string.Join("; ", x.Answer.Actions) : x.Answer.Remarks ?? x.Checkpoint.Text;
            return $"{x.Checkpoint.OptionCode}. {x.Answer.Value}: {what.TrimEnd('.')}.";
        }));
        return text.Length <= MaxRequirementRemarks ? text : text[..(MaxRequirementRemarks - 1)] + "…";
    }

    // ------------------------------------------------------------------ write

    public static string UpdateSql(Stage stage, int i) => stage switch
    {
        Stage.Desktop => Update($"DaAnswer = @Answer{i}, DaActions = @Actions{i}, DaRemarks = @Remarks{i}", i),
        Stage.Site => Update($"SaAnswer = @Answer{i}, SaActions = @Actions{i}, SaRemarks = @Remarks{i}", i),
        Stage.Baseline => Update($"HhAnswer = @Answer{i}, HhActions = @Actions{i}, HhRemarks = @Remarks{i}", i),
        Stage.Review1 => Update($"HhReview1 = @Answer{i}", i),
        _ => Update($"HhReview2 = @Answer{i}", i),
    };

    private static string Update(string set, int i) =>
        $"UPDATE dbo.MsmeOptions SET {set}, AnsweredBy = @AnsweredBy, AnsweredOn = GETDATE() WHERE Id = @Id{i} AND ZedId = @ZedId AND SectionType = @Certification;";

    /// <summary>The start of the one batch a save sends (the answers, then the requirement's conformance, in one transaction).</summary>
    public const string SaveBatchStart = "SET XACT_ABORT ON; BEGIN TRANSACTION;";

    /// <summary>
    /// The legacy procedure that sets the requirement's conformance after the answers; its parameters are given by name.
    /// Only the assessment pages' own procedures are passed here.
    /// </summary>
    public sealed record Conformance(string Procedure, IReadOnlyDictionary<string, object?> Args);

    /// <summary>
    /// Stores the answers and, with <paramref name="conformance"/>, the requirement's conformance, all or nothing: one batch in
    /// one transaction, so a failure leaves neither half of it.
    /// </summary>
    public static async Task SaveAsync(ISqlExecutor db, string zedId, string level, Stage stage, Decision decision, string userId, CancellationToken ct,
        Conformance? conformance = null)
    {
        var sql = new System.Text.StringBuilder(SaveBatchStart).Append('\n');
        var p = new Dapper.DynamicParameters();
        p.Add("ZedId", Ansi(zedId));
        p.Add("Certification", Ansi(level));
        p.Add("AnsweredBy", Ansi(userId.Length <= 50 ? userId : userId[..50]));
        for (var i = 0; i < decision.Answers.Count; i++)
        {
            var (c, a) = decision.Answers[i];
            sql.Append(UpdateSql(stage, i)).Append('\n');
            p.Add("Id" + i, c.Id);
            p.Add("Answer" + i, Ansi(a.Value, 10));
            p.Add("Actions" + i, a.Actions.Count == 0 ? null : string.Join("\n", a.Actions));
            p.Add("Remarks" + i, a.Remarks);
        }
        if (conformance is not null)
        {
            if (!ConformanceProcedures.Contains(conformance.Procedure)) throw new ArgumentException("Unknown procedure.", nameof(conformance));
            sql.Append("EXEC dbo.").Append(conformance.Procedure).Append(' ')
                .Append(string.Join(", ", conformance.Args.Keys.Select(k => $"@{k} = @c{k}"))).Append(";\n");
            foreach (var (k, v) in conformance.Args) p.Add("c" + k, v);
        }
        sql.Append("COMMIT;");
        await db.ExecuteSqlAsync(sql.ToString(), p, ct);
    }

    private static readonly HashSet<string> ConformanceProcedures = ["SP_ASSESSMENT_DA_UPDATE_REQUIREMENT", "SP_ASSESSMENT_RA_UPDATE_REQUIREMENT"];

    private static DbString Ansi(string? value, int length = 50) => new() { Value = value, IsAnsi = true, Length = length };
}
