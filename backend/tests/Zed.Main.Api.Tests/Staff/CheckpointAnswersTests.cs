using Zed.Core.Assessment;
using Zed.Portal.Features.Staff.Assessment;
using static Zed.Core.Assessment.CheckpointAnswers;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>The rules of Yes / Partial / No for each checkpoint (migration 0039), as every page applies them.</summary>
public sealed class CheckpointAnswersTests
{
    private static Checkpoint Point(long id, string code, string[]? actions = null, params Evidence[] evidences) =>
        new(id, 11, code, "Checkpoint " + code, actions ?? ["Write it", "Display it"], evidences, null, null, null, null, null);

    private static SaveRequest Answers(params AnswerRequest[] answers) => new([.. answers], null);

    [Fact]
    public void Every_checkpoint_needs_an_answer_of_its_own()
    {
        var list = new[] { Point(1, "1"), Point(2, "2") };
        Assert.Contains("Checkpoint 2: please choose", Decide(list, Answers(new AnswerRequest(1, "Yes", null, null)), Stage.Desktop).Problem);
        Assert.Equal("Invalid request.", Decide(list, Answers(new AnswerRequest(1, "Yes", null, null), new AnswerRequest(3, "Yes", null, null)), Stage.Desktop).Problem);
        Assert.Equal("Invalid request.", Decide(list, Answers(new AnswerRequest(1, "Yes", null, null), new AnswerRequest(1, "No", null, null)), Stage.Desktop).Problem);
        Assert.Contains("please choose", Decide(list, Answers(new AnswerRequest(1, "Maybe", null, null), new AnswerRequest(2, "Yes", null, null)), Stage.Desktop).Problem);
        Assert.Equal("This requirement has no checkpoints.", Decide([], Answers(), Stage.Desktop).Problem);
    }

    [Fact]
    public void Yes_needs_every_mandatory_evidence_uploaded_and_not_refused()
    {
        var missing = Point(1, "1", null, new Evidence(5, "Policy", true, false, null), new Evidence(6, "Photo", false, false, null));
        Assert.Contains("\"Policy\" is not uploaded", Decide([missing], Answers(new AnswerRequest(1, "yes", null, null)), Stage.Desktop).Problem);

        var refused = Point(1, "1", null, new Evidence(5, "Policy", true, true, "No"));
        Assert.Contains("\"Policy\" was not verified", Decide([refused], Answers(new AnswerRequest(1, "Yes", null, null)), Stage.Site).Problem);

        // Optional evidence may be missing.
        var ok = Point(1, "1", null, new Evidence(5, "Policy", true, true, "Yes"), new Evidence(6, "Photo", false, false, null));
        var (decision, _) = Decide([ok], Answers(new AnswerRequest(1, "Yes", ["Write it"], null)), Stage.Desktop);
        Assert.Equal(Yes, decision!.Conformance);
        Assert.Null(decision.Remarks);
        Assert.Empty(decision.Answers[0].Answer.Actions);
    }

    [Fact]
    public void Handholding_needs_a_photo_for_a_yes_with_mandatory_evidence()
    {
        var point = Point(1, "1", null, new Evidence(5, "Policy", true, false, null));
        Assert.Contains("add a photo", Decide([point], Answers(new AnswerRequest(1, "Yes", null, null)), Stage.Baseline).Problem);
        Assert.Null(Decide([point], Answers(new AnswerRequest(1, "Yes", null, null)), Stage.Baseline, hasPhoto: true).Problem);
    }

    [Fact]
    public void No_or_partial_needs_the_actions_and_makes_the_requirement_not_conforming()
    {
        var list = new[] { Point(1, "1"), Point(2, "2", []) };
        Assert.Contains("Checkpoint 1: please tick the actions needed.", Decide(list, Answers(new AnswerRequest(1, "Partial", null, null), new AnswerRequest(2, "Yes", null, null)), Stage.Desktop).Problem);
        Assert.Contains("choose the actions from the list", Decide(list, Answers(new AnswerRequest(1, "No", ["Something else"], null), new AnswerRequest(2, "Yes", null, null)), Stage.Desktop).Problem);
        Assert.Contains("Checkpoint 2: please write what is needed.", Decide(list, Answers(new AnswerRequest(1, "Yes", null, null), new AnswerRequest(2, "No", null, null)), Stage.Desktop).Problem);

        var (decision, problem) = Decide(list, Answers(new AnswerRequest(1, "partial", ["display it"], null), new AnswerRequest(2, "No", null, "Set yearly targets")), Stage.Desktop);
        Assert.Null(problem);
        Assert.Equal(No, decision!.Conformance);
        Assert.Equal([Partial, No], decision.Answers.Select(a => a.Answer.Value));
        // The Admin's wording is kept.
        Assert.Equal(["Display it"], decision.Answers[0].Answer.Actions);
        // No remarks given: the answers are written for the unit.
        Assert.Equal("1. Partial: Display it. 2. No: Set yearly targets.", decision.Remarks);
        Assert.Equal("Own words", Decide(list, new([new AnswerRequest(1, "No", ["Write it"], null), new AnswerRequest(2, "No", null, "x")], " Own words "), Stage.Desktop).Decision!.Remarks);
    }

    [Fact]
    public void Progress_reviews_record_the_answer_only()
    {
        var (decision, problem) = Decide([Point(1, "1")], Answers(new AnswerRequest(1, "No", ["Write it"], null)), Stage.Review1);
        Assert.Null(problem);
        Assert.Empty(decision!.Answers[0].Answer.Actions);
        Assert.Contains("HhReview1 = @Answer0", UpdateSql(Stage.Review1, 0));
        Assert.Contains("HhAnswer = @Answer2, HhActions = @Actions2", UpdateSql(Stage.Baseline, 2));
        Assert.Contains("SaAnswer", UpdateSql(Stage.Site, 0));
    }

    [Fact]
    public void Long_or_odd_remarks_are_refused()
    {
        Assert.Contains("up to 1000", Decide([Point(1, "1", [])], Answers(new AnswerRequest(1, "No", null, new string('x', 1001))), Stage.Desktop).Problem);
        Assert.Contains("invalid characters", Decide([Point(1, "1", [])], Answers(new AnswerRequest(1, "No", null, "a\u0001b")), Stage.Desktop).Problem);
    }

    [Fact]
    public void The_questionnaire_is_read_from_main_for_handholding()
    {
        Assert.Contains("FROM ZEDCS_V2_LIVE.dbo.Options o", CheckpointSql("ZEDCS_V2_LIVE.dbo"));
        Assert.Contains("FROM dbo.Options o", CheckpointSql("dbo"));
        // 2026-11-08: the questionnaire's checkpoint only within the unit's requirement (surveillance copies main's ids).
        Assert.Contains("o.SectionType = X.SectionType AND LTRIM(RTRIM(o.SectionCode)) = X.Sc AND LTRIM(RTRIM(o.RequirementCode)) = X.Rc", CheckpointSql("dbo"));
        Assert.Contains("e.SectionType = X.SectionType AND LTRIM(RTRIM(e.SectionCode)) = X.Sc", EvidenceSql("dbo"));
        Assert.Contains("ZEDCS_V2_LIVE.dbo.Evidences", EvidenceSql("ZEDCS_V2_LIVE.dbo"));
    }
}
