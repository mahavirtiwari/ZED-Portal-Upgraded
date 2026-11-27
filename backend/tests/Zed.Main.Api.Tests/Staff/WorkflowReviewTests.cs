using Zed.Core.Security;
using Zed.Portal.Features.Staff.Assessment;
using Zed.Portal.Features.Staff.Monitoring;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>2026-11-27, review of the workflows and permissions of every login: the rules changed that day.</summary>
public sealed class WorkflowReviewTests
{
    private static ZedUser Agency(params string[] subRoles) => new("AG1", "Agency One", (int)UserRole.Agency, null, null, null, null, SubRoles: subRoles);

    private static CertificationRecord Record(string level, int status, int nc, bool auto = false) => new()
    {
        ZedId = "ZEDM000001", Certification = level, CertificationStatus = status, NcCount = nc, CertificationBodyUserId = "AG1", IsAutoReject = auto,
    };

    [Theory]
    [InlineData(2)]   // 1 NC round set by the Admin: rejected with NcCount 2
    [InlineData(4)]   // 3 rounds
    [InlineData(6)]   // 5 rounds, or the closure job
    public void A_rejection_after_the_admins_rounds_can_be_rejected_or_sent_back_by_the_agency(int nc)
    {
        var actions = ReviewRules.For(Agency(SubRoles.SiteVerification), Record("Gold", ReviewRules.SiteRejected, nc), ReviewStage.Site);
        Assert.True(actions.Reject);
        Assert.True(actions.SendBack);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    public void A_status_17_that_is_not_a_failed_nc_round_offers_nothing(int nc) =>
        Assert.False(ReviewRules.For(Agency(SubRoles.SiteVerification), Record("Gold", ReviewRules.SiteRejected, nc), ReviewStage.Site).Any);

    [Fact]
    public void The_master_admin_re_allots_only_stuck_cases()
    {
        Dictionary<string, object?> Row(string? agency, string? time = null, string? reason = null, string? daReason = null) => new()
        {
            ["CertificationBodyUserId"] = agency, ["TimeDuration"] = time, ["ReasonForRejection"] = reason, ["DesktopReasonForRejection"] = daReason,
        };
        Assert.True(AssessmentAllotmentController.Allottable(Row(null)));                       // not allotted yet
        Assert.False(AssessmentAllotmentController.Allottable(Row("AG1")));                     // with its agency, on time
        Assert.True(AssessmentAllotmentController.Allottable(Row("AG1", time: "Reallot")));     // no assessor accepted within 72 hours
        Assert.True(AssessmentAllotmentController.Allottable(Row("AG1", reason: "No capacity")));
        Assert.True(AssessmentAllotmentController.Allottable(Row("AG1", daReason: "Conflict of interest")));
    }
}
