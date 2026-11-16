using System.Globalization;
using Dapper;
using Microsoft.Extensions.Logging;
using Zed.Core.Data;

namespace Zed.Core.Assessment;

/// <summary>
/// The handholding consultants' checkpoint answers (migration 0039), shared by the milestone page (Zed.Portal) and the
/// consultant app (Zed.Main.MobileApi, 2026-11-16): the baseline in milestone 1, whose Partial / No actions are added to the
/// requirement's Handholding Action Plan (once; they stay editable and deletable there), and the progress reviews in
/// milestones 2 and 3. A Yes on a checkpoint with mandatory evidence needs a photo on the requirement (handholding keeps its
/// photos per requirement). The requirement is the milestone-1 row (the plan row) of ZED_CONSULTANT.dbo.MsmeRequirements.
/// </summary>
public static class HandholdingCheckpoints
{
    /// <summary>Handholding reads main's questionnaire (the payment copies ZEDCS_V2_LIVE's parameters).</summary>
    public const string Master = "ZEDCS_V2_LIVE.dbo";

    /// <summary>Milestone 1 answers the baseline, milestones 2 and 3 the progress reviews.</summary>
    public static CheckpointAnswers.Stage? StageOf(int milestone) => milestone switch
    {
        1 => CheckpointAnswers.Stage.Baseline,
        2 => CheckpointAnswers.Stage.Review1,
        3 => CheckpointAnswers.Stage.Review2,
        _ => null,
    };

    public const string PhotoCountSql =
        "SELECT COUNT(*) AS Total FROM SaRequirementPhotos p WHERE p.ZedId = @ZedId AND p.Certification = @Certification " +
        "AND p.RequirementId = (SELECT TOP 1 r.RequirementId FROM MsmeRequirements r WHERE r.Id = @Id AND r.ZedId = @ZedId AND r.SectionType = @Certification)";

    public const string ActionPlanSql =
        "SELECT BulletPoints FROM MsmeRequirementBullets WHERE ZedId = @ZedId AND CertificationType = @Certification " +
        "AND RequirementId = @RequirementId AND ReqType = 'HandholdingActionPlan'";

    public const string HandholdingActionPlan = "HandholdingActionPlan";

    public sealed class CountRow { public int Total { get; init; } }

    public sealed class BulletRow { public string? BulletPoints { get; init; } }

    /// <param name="Problem">Why nothing was saved (the user's message), or null.</param>
    /// <param name="Added">Actions added to the action plan.</param>
    public sealed record Result(string? Problem, int Added);

    /// <summary>Checks and saves one requirement's answers; null result problem = saved.</summary>
    /// <param name="requirementId">The plan row (milestone 1's MsmeRequirements.Id).</param>
    /// <param name="photoInRequest">The consultant app sends a photo of the requirement with the same submit.</param>
    public static async Task<Result> SaveAsync(ISqlExecutor db, string zedId, string level, int milestone, long requirementId,
        CheckpointAnswers.SaveRequest req, string userId, ILogger log, CancellationToken ct, bool photoInRequest = false)
    {
        if (StageOf(milestone) is not { } stage) return new("The checkpoints are answered in milestones 1 to 3.", 0);
        var checkpoints = await CheckpointAnswers.LoadAsync(db, zedId, level, requirementId, Master, log, ct);
        var args = new { Id = requirementId, ZedId = Ansi(zedId), Certification = Ansi(level) };
        // The app sends the requirement's photos with the same submit (they are stored after the answers are checked).
        var hasPhoto = photoInRequest || (await db.QuerySqlAsync<CountRow>(PhotoCountSql, args, ct)).FirstOrDefault()?.Total > 0;
        var (decision, problem) = CheckpointAnswers.Decide(checkpoints, req, stage, hasPhoto);
        if (decision is null) return new(problem, 0);
        await CheckpointAnswers.SaveAsync(db, zedId, level, stage, decision, userId, ct);

        var added = 0;
        if (stage == CheckpointAnswers.Stage.Baseline)
        {
            var id = requirementId.ToString(CultureInfo.InvariantCulture);
            var existing = (await db.QuerySqlAsync<BulletRow>(ActionPlanSql, new { args.ZedId, args.Certification, RequirementId = Ansi(id, 500) }, ct))
                .Select(b => b.BulletPoints?.Trim() ?? "").ToHashSet(StringComparer.OrdinalIgnoreCase);
            foreach (var action in decision.Answers.SelectMany(a => a.Answer.Actions).Where(a => existing.Add(a.Trim())))
            {
                await db.ExecuteProcAsync("SP_CONSULTANCY_INSERT_BULLETS", new
                {
                    ZedId = Ansi(zedId),
                    Certification = Ansi(level),
                    RequirementId = Ansi(id),
                    ReqType = Ansi(HandholdingActionPlan, 200),
                    BulletPoints = Ansi(action.Trim(), 2000),
                    UserId = Ansi(userId),
                }, ct);
                added++;
            }
        }
        return new(null, added);
    }

    public static string Message(int added) =>
        added > 0 ? $"Saved. {added} action{(added == 1 ? "" : "s")} added to the Handholding Action Plan." : "Saved.";

    private static DbString Ansi(string? value, int length = 50) => new() { Value = value, IsAnsi = true, Length = length };
}
