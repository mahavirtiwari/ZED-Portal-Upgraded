using Zed.Core.Data;

namespace Zed.Portal.Features.Staff.Fees;

/// <summary>
/// 2026-11-17 (the user, approved): the Admin's subsidy share applies to the Andhra Pradesh state fee rows too
/// (StateAssessmentFee: Silver and Gold certification on the main portal, handholding milestones on Consultancy). Before,
/// nothing in V4 edited that table, so a 100% subsidy set by the Admin did not reach an Andhra Pradesh unit.
/// <para>
/// A state row keeps its own fee and its state share (StateSubsidyPercentage): with the new central share its amounts are
/// worked out as an ordinary row's (<see cref="FeeCalculator.Recalculate"/>), then the state pays its share of the
/// applicant's contribution (StateContributionAfterSubsidy) and the applicant the rest (the applicant columns × the
/// remaining share). With the usual state share of 100% the applicant pays nothing, as before.
/// </para>
/// </summary>
public static class StateFeeSubsidy
{
    /// <summary>One state fee row (the columns this needs).</summary>
    public sealed record StateRow(
        int Id, string EnterpriseTypee, string Certification, int? SpecialCategory, decimal? SubsidyPercentage, decimal? AssessmentFee,
        decimal? StateSubsidyPercentage, string? MileStone);

    /// <summary>The state rows of a type without a reward (Consultancy: with their milestone).</summary>
    public static string RowsSql(bool byMilestone) =>
        "SELECT Id, EnterpriseTypee, Certification, SpecialCategory, SubsidyPercentage, AssessmentFee, StateSubsidyPercentage, " +
        (byMilestone ? "CAST(MileStone AS varchar(10)) MileStone" : "CAST(NULL AS varchar(10)) MileStone") +
        " FROM StateAssessmentFee WHERE EnterpriseTypee = @EnterpriseTypee AND Coupon IS NULL;";

    public const string UpdateSql =
        "UPDATE StateAssessmentFee SET SubsidyPercentage = @SubsidyPercentage, Gst = @Gst, Total = @Total, SubsidyPer = @SubsidyPer, " +
        "GstAfterSubsidy = @GstAfterSubsidy, ApplicantContributionAfterSubsidy = @ApplicantContributionAfterSubsidy, " +
        "StateContributionAfterSubsidy = @StateContributionAfterSubsidy, Tds15 = @Tds15, Tds75 = @Tds75, " +
        "NetPaybleTds15 = @NetPaybleTds15, NetPaybleTds75 = @NetPaybleTds75 WHERE Id = @Id AND EnterpriseTypee = @EnterpriseTypee;";

    /// <summary>The new amounts of a state row (the parameters of <see cref="UpdateSql"/>).</summary>
    public sealed record StateAmounts(
        int Id, string EnterpriseTypee, decimal SubsidyPercentage, decimal? Gst, decimal? Total, decimal SubsidyPer, decimal GstAfterSubsidy,
        decimal ApplicantContributionAfterSubsidy, decimal StateContributionAfterSubsidy, decimal Tds15, decimal Tds75,
        decimal NetPaybleTds15, decimal NetPaybleTds75);

    /// <summary>The new amounts of a state row for a central share; null when the row cannot be worked out (no fee).</summary>
    public static StateAmounts? Amounts(StateRow s, decimal share)
    {
        if (s.AssessmentFee is not { } fee) return null;
        var row = new FeeRow(s.Id, s.EnterpriseTypee, s.Certification, s.SpecialCategory, true, share, fee, null, null, null, null, null, null,
            null, null, null, null, null, null, null, s.MileStone);
        var (r, error) = FeeCalculator.Recalculate(row, fee, null, rejected: false);
        if (error is not null || r is null) return null;
        var statePct = Math.Clamp(s.StateSubsidyPercentage ?? 0m, 0m, 100m);
        var left = (100m - statePct) / 100m;
        decimal Part(decimal? v) => FeeCalculator.Round((v ?? 0m) * left);
        var applicant = Part(r.ApplicantContributionAfterSubsidy);
        var tds15 = Part(r.Tds15);
        var tds75 = Part(r.Tds75);
        return new StateAmounts(s.Id, s.EnterpriseTypee, share, r.Gst, r.Total, Part(r.SubsidyPer), Part(r.GstAfterSubsidy), applicant,
            (r.ApplicantContributionAfterSubsidy ?? 0m) - applicant, tds15, tds75, applicant - tds15, applicant - tds75);
    }

    /// <summary>
    /// The state rows of the type whose level (Consultancy: level and milestone) and category had their central share
    /// changed take the new share. Returns the rows changed.
    /// </summary>
    public static async Task<int> ApplyAsync(ISqlExecutor db, string type, IReadOnlyList<FeeRow> before, IReadOnlyList<FeeRow> after,
        bool byMilestone, CancellationToken ct)
    {
        var changed = after.Where(a => !a.IsCouponRow && a.SubsidyPercentage is not null &&
                                       before.FirstOrDefault(b => b.Id == a.Id)?.SubsidyPercentage != a.SubsidyPercentage).ToList();
        if (changed.Count == 0) return 0;
        var state = await db.QuerySqlAsync<StateRow>(RowsSql(byMilestone), new { EnterpriseTypee = type }, ct);
        var count = 0;
        foreach (var s in state)
        {
            var source = changed.FirstOrDefault(a => Same(a.Certification, s.Certification) && (a.SpecialCategory ?? 0) == (s.SpecialCategory ?? 0) &&
                                                     (!byMilestone || Same(a.MileStone, s.MileStone)));
            if (source?.SubsidyPercentage is not { } share || share == s.SubsidyPercentage) continue;
            if (Amounts(s, share) is not { } amounts) continue;
            await db.ExecuteSqlAsync(UpdateSql, amounts, ct);
            count++;
        }
        return count;
    }

    private static bool Same(string? a, string? b) => string.Equals(a?.Trim(), b?.Trim(), StringComparison.OrdinalIgnoreCase);
}
