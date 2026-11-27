using Microsoft.Extensions.Logging.Abstractions;
using Zed.Core.Security;
using Zed.Portal.Features.CertLevels;
using Zed.Portal.Features.Staff.Assessment;
using Zed.Portal.Features.Staff.Monitoring;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>
/// 2026-11-27 (migration 0117): each case keeps the assessment flow it started with (MsmeCertifications.AssessmentFlow, taken at the
/// documents' final submit); a case without one follows its level. The SQL side is replayed in database/tests/0117_case_flow_replay.sql.
/// </summary>
public sealed class CaseFlowsTests
{
    [Theory]
    [InlineData("Desktop", "Desktop")]
    [InlineData(" desktoponsite ", "DesktopOnsite")]
    [InlineData("Remote", "Remote")]
    [InlineData("Onsite", "Onsite")]
    [InlineData("DesktopRemote", "DesktopRemote")]
    [InlineData(null, null)]
    [InlineData("", null)]
    [InlineData("Site", null)]   // the old AssessmentMode value is no flow
    public void A_stored_case_flow_is_read_in_its_canonical_spelling(string? stored, string? expected) =>
        Assert.Equal(expected, CaseFlows.Stored(stored));

    [Theory]
    // The case's own flow wins over its level's, both ways.
    [InlineData("Desktop", "Silver", true)]
    [InlineData("DesktopOnsite", "Bronze", false)]
    [InlineData("Onsite", "Bronze", false)]
    [InlineData("Remote", "Bronze", false)]
    // No flow taken (not yet submitted, or before 0117): the level's (Bronze desktop, Silver / Gold with a visit by default).
    [InlineData(null, "Bronze", true)]
    [InlineData(null, "Gold", false)]
    [InlineData("junk", "Bronze", true)]
    public void Desktop_only_is_the_cases_flow_else_its_levels(string? caseFlow, string level, bool desktop) =>
        Assert.Equal(desktop, CaseFlows.IsDesktop(caseFlow, level));

    [Fact]
    public void The_case_flow_falls_back_to_the_level_flow() =>
        Assert.Equal(LevelFlows.DesktopRemote, CaseFlows.FlowOf(null, LevelFlows.DesktopRemote));

    [Fact]
    public async Task The_flow_of_a_case_is_read_from_its_row()
    {
        var sql = new FakeSql();
        sql.Queries[CaseFlows.ReadSql] = args => FakeSql.Arg(args, "ZedId") == "ZEDM000001" ? [new { AssessmentFlow = "Onsite" }] : [];
        Assert.Equal(LevelFlows.Onsite, await CaseFlows.FlowAsync(sql, "ZEDM000001", "Bronze", NullLogger.Instance, default));
        Assert.False(await CaseFlows.IsDesktopAsync(sql, "ZEDM000001", "Bronze", NullLogger.Instance, default));
        // Another unit of the same level has no flow of its own: Bronze's (desktop only by default).
        Assert.Equal(LevelFlows.Desktop, await CaseFlows.FlowAsync(sql, "ZEDM000002", "Bronze", NullLogger.Instance, default));
        Assert.True(await CaseFlows.IsDesktopAsync(sql, "ZEDM000002", "Bronze", NullLogger.Instance, default));
    }

    private static ZedUser Agency(params string[] subRoles) => new("AG1", "Agency One", (int)UserRole.Agency, null, null, null, null, SubRoles: subRoles);

    private static CertificationRecord Record(string level, int status, int nc, string? flow) => new()
    {
        ZedId = "ZEDM000001", Certification = level, CertificationStatus = status, NcCount = nc, CertificationBodyUserId = "AG1", AssessmentFlow = flow,
    };

    [Fact]
    public void Review_rules_follow_the_cases_flow_not_the_levels()
    {
        // A Gold case started as Desktop only (Gold is Desktop + Onsite by default): its desktop rejection can be confirmed, and
        // it has no site stage.
        var desktopGold = Record("Gold", ReviewRules.DesktopRejected, 2, LevelFlows.Desktop);
        Assert.True(desktopGold.DesktopOnly);
        Assert.True(ReviewRules.For(Agency(SubRoles.DesktopVerification), desktopGold, ReviewStage.Desktop).Reject);
        Assert.False(ReviewRules.For(Agency(SubRoles.SiteVerification), Record("Gold", ReviewRules.SiteQualityCheck, 0, LevelFlows.Desktop), ReviewStage.Site).Any);

        // A Bronze case started as Desktop + Onsite (Bronze is Desktop only by default): its onsite quality check is open to the agency.
        var visitBronze = Record("Bronze", ReviewRules.SiteQualityCheck, 0, LevelFlows.DesktopOnsite);
        Assert.False(visitBronze.DesktopOnly);
        var site = ReviewRules.For(Agency(SubRoles.SiteVerification), visitBronze, ReviewStage.Site);
        Assert.True(site.FinalSubmit);
        Assert.True(site.SendBack);

        // The same Bronze without a flow of its own follows the level: no site stage.
        Assert.False(ReviewRules.For(Agency(SubRoles.SiteVerification), Record("Bronze", ReviewRules.SiteQualityCheck, 0, null), ReviewStage.Site).Any);
    }
}
