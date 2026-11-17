using Zed.Portal.Features.Staff.Fees;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>2026-11-17 (the user): the Admin's subsidy share reaches the Andhra Pradesh state fee rows.</summary>
public sealed class StateFeeSubsidyTests
{
    private static StateFeeSubsidy.StateRow State(decimal statePct, decimal share = 80m, string? milestone = null) =>
        new(19, "Micro", "Silver", 0, share, 50000m, statePct, milestone);

    [Fact]
    public void The_state_pays_its_share_of_what_the_central_subsidy_leaves()
    {
        // 80% central: Rs 10,000 + 18% GST left, all paid by the state (100%).
        var full = StateFeeSubsidy.Amounts(State(100m), 80m)!;
        Assert.Equal((0m, 11800m, 0m, 0m), (full.ApplicantContributionAfterSubsidy, full.StateContributionAfterSubsidy, full.NetPaybleTds15, full.GstAfterSubsidy));

        // Half by the state: the applicant pays the other half.
        var half = StateFeeSubsidy.Amounts(State(50m), 80m)!;
        Assert.Equal((5900m, 5900m), (half.ApplicantContributionAfterSubsidy, half.StateContributionAfterSubsidy));
        Assert.Equal(half.ApplicantContributionAfterSubsidy - half.Tds15, half.NetPaybleTds15);

        // The Admin's 100%: nothing left for anyone.
        var none = StateFeeSubsidy.Amounts(State(50m), 100m)!;
        Assert.Equal((100m, 0m, 0m), (none.SubsidyPercentage, none.ApplicantContributionAfterSubsidy, none.StateContributionAfterSubsidy));
    }

    [Fact]
    public async Task Only_the_state_rows_of_a_changed_level_category_and_milestone_are_updated()
    {
        var sql = new FakeSql();
        sql.Queries[StateFeeSubsidy.RowsSql(byMilestone: true)] = _ =>
        [
            new { Id = 19, EnterpriseTypee = "Micro", Certification = "Silver", SpecialCategory = 0, SubsidyPercentage = 80m, AssessmentFee = 50000m, StateSubsidyPercentage = 50m, MileStone = "1" },
            new { Id = 20, EnterpriseTypee = "Micro", Certification = "Silver", SpecialCategory = 0, SubsidyPercentage = 80m, AssessmentFee = 50000m, StateSubsidyPercentage = 50m, MileStone = "2" },
            new { Id = 22, EnterpriseTypee = "Micro", Certification = "Gold", SpecialCategory = 0, SubsidyPercentage = 80m, AssessmentFee = 75000m, StateSubsidyPercentage = 50m, MileStone = "1" },
        ];
        FeeRow Fee(int id, string level, string milestone, decimal pct) =>
            new(id, "Micro", level, 0, true, pct, 50000m, 9000m, 59000m, null, null, null, null, null, null, null, null, null, null, null, milestone);
        var before = new[] { Fee(1, "Silver", "1", 80m), Fee(2, "Silver", "2", 80m), Fee(3, "Gold", "1", 80m) };
        var after = new[] { Fee(1, "Silver", "1", 100m), Fee(2, "Silver", "2", 80m), Fee(3, "Gold", "1", 80m) };

        Assert.Equal(1, await StateFeeSubsidy.ApplyAsync(sql, "Micro", before, after, byMilestone: true, CancellationToken.None));
        var update = Assert.Single(sql.Calls, c => c.Name == StateFeeSubsidy.UpdateSql);
        var amounts = Assert.IsType<StateFeeSubsidy.StateAmounts>(update.Args);
        Assert.Equal((19, 100m, 0m), (amounts.Id, amounts.SubsidyPercentage, amounts.ApplicantContributionAfterSubsidy));
    }
}
