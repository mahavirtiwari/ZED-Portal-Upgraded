using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Assessment;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Fees;

/// <summary>
/// Assessment fee master ("Payment Details" / Certification Payments). Port of AssessmentController
/// PaymentDetails / GetAmounts (SP_MASTER_GET_ASSESSMENT_FEE) / UpdateAmounts (SP_MASTER_UPDATE_ASSESSMENT_FEE).
/// Admin only, as before. The AssessmentFee rows decide what an MSME pays (ApplicantContributionAfterSubsidy
/// and NetPaybleTds15/75 are charged by the payment procedures), so:
/// <list type="bullet">
/// <item>the browser sends only the assessment fee and the coupon of each level; every derived amount is
/// computed here (<see cref="FeeCalculator"/>) instead of being taken from the page, which posted every
/// column of every row (any amount could be written to any row);</item>
/// <item>amounts are range-checked (no negative values, coupon not above the total, two decimals);</item>
/// <item>only rows of the chosen enterprise type and level are changed, by their own Id, and every changed
/// row is written to the audit log with the old and new amounts and the admin's user id.</item>
/// </list>
/// <para>
/// Also served by Surveillance (same procedures and columns; the rows main's surveillance payment charges) and by
/// Consultancy, whose AssessmentFee rows carry a MileStone column: the handholding fee is set per level (Silver, Gold) and
/// milestone for Micro / Small / Medium (the old page's three MileStone inputs set one fee for both levels), the coupon
/// stays as stored. Consultancy also has the payment schedule: milestone by milestone, or all three at milestone 1 from a
/// date (migration 0044, <see cref="PayAllRows"/>). Main also has the Recertification fee (migration 0046): the full fee
/// a unit pays to re-certify a level, set like the Rejected fee.
/// </para>
/// </summary>
[Route("api/staff/fees")]
[StaffRoles(UserRole.Admin)]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed class AssessmentFeesController(ISqlExecutor db, PortalHost host, ILoggerFactory loggers) : StaffApiController
{
    /// <summary>Log category of the fee audit trail (who changed which row from what to what).</summary>
    public const string AuditCategory = "Zed.Audit.AssessmentFee";

    public static readonly string[] EnterpriseTypes = ["Micro", "Small", "Medium", "Rejected"];
    /// <summary>Main: also the Recertification fee (AssessmentFee EnterpriseTypee 'RECERTIFICATION', migration 0046).</summary>
    public static readonly string[] MainEnterpriseTypes = ["Micro", "Small", "Medium", "Rejected", "Recertification"];

    /// <summary>The types charged the full fee: no subsidy, no joining reward (one row per level).</summary>
    public static bool IsFullFee(string type) => type is "Rejected" or "Recertification";
    /// <summary>The levels with fee rows (ZEDX = ZED-X, migration 0028; a level shows once it has rows).</summary>
    public static readonly string[] Levels = ["Bronze", "Silver", "Gold", "ZEDX"];

    /// <param name="Level">Consultancy: the handholding level (Silver, Gold) of the milestone in <paramref name="Certification"/>.</param>
    public sealed record LevelFee(string Certification, decimal? AssessmentFee, decimal? Coupon, bool HasCouponRows, string? Level = null);
    /// <param name="GroupBy">"Certification" (one fee per level), or "MileStone" on Consultancy (Levels[].Certification is then the milestone).</param>
    /// <param name="Schedule">Consultancy: how units pay the three milestones.</param>
    public sealed record FeesResponse(string EnterpriseType, IReadOnlyList<LevelFee> Levels, IReadOnlyList<FeeRow> Rows, string GroupBy = "Certification",
        PaymentSchedule? Schedule = null);

    /// <param name="PayAllAtMilestone1">Units starting handholding from <paramref name="From"/> pay all three milestones at milestone 1.</param>
    /// <param name="Prepared">The milestone-1 rows of that schedule exist (made when it is first switched on).</param>
    public sealed record PaymentSchedule(bool PayAllAtMilestone1, DateOnly? From, bool Prepared);

    /// <summary>Consultancy's fee page offered Micro, Small and Medium only.</summary>
    public static readonly string[] ConsultancyEnterpriseTypes = ["Micro", "Small", "Medium"];

    private bool ByMilestone => host.System == PortalSystem.Consultancy;

    private string? Type(string enterpriseType) => Canonical(enterpriseType, host.System switch
    {
        PortalSystem.Consultancy => ConsultancyEnterpriseTypes,
        PortalSystem.Main => MainEnterpriseTypes,
        _ => EnterpriseTypes,
    });

    private FeesResponse Response(string type, List<FeeRow> rows) =>
        ByMilestone ? new FeesResponse(type, MilestoneSummary(rows), rows, "MileStone", ScheduleOf(rows)) : new FeesResponse(type, Summary(rows), rows);

    [HttpGet("{enterpriseType}")]
    public async Task<ActionResult<FeesResponse>> Get(string enterpriseType, CancellationToken ct)
    {
        var type = Type(enterpriseType);
        if (type is null) return NotFound();
        var rows = await LoadAsync(type, ct);
        return Response(type, rows);
    }

    /// <param name="Level">Consultancy: the handholding level whose milestone fee changes (null: Silver and Gold alike).</param>
    public sealed record LevelRequest(string? Certification, decimal? AssessmentFee, decimal? Coupon, string? Level = null);
    public sealed record FeesRequest(List<LevelRequest>? Levels);

    /// <summary>The rows as they would be saved, without saving (the page shows the computed amounts while editing).</summary>
    [HttpPost("{enterpriseType}/preview")]
    public async Task<ActionResult<FeesResponse>> Preview(string enterpriseType, FeesRequest req, CancellationToken ct)
    {
        var type = Type(enterpriseType);
        if (type is null) return NotFound();
        var current = await LoadAsync(type, ct);
        var (updated, error) = ByMilestone ? ApplyConsultancy(current, req) : Apply(type, current, req);
        if (error is not null) return this.Problem400(error);
        return Response(type, updated!);
    }

    [HttpPut("{enterpriseType}")]
    public async Task<ActionResult<MessageResponse>> Update(string enterpriseType, FeesRequest req, CancellationToken ct)
    {
        var type = Type(enterpriseType);
        if (type is null) return NotFound();
        var current = await LoadAsync(type, ct);
        var (updated, error) = ByMilestone ? ApplyConsultancy(current, req) : Apply(type, current, req);
        if (error is not null) return this.Problem400(error);
        var changed = await WriteAsync(current, updated!, ct);
        loggers.CreateLogger(AuditCategory).LogInformation("Assessment fees of {EnterpriseType} saved by {Actor}: {Changed} row(s) changed", type, UserId, changed);
        return new MessageResponse(changed == 0 ? "No changes to save." : "Data updated.");
    }

    /// <summary>
    /// The subsidy categories (AssessmentFee.SpecialCategory), the same on the three portals since migration 0041: 0 General,
    /// 1 SC-owned, 2 woman-owned, 3 ST-owned, 4 aspirational district, 5 LWE district, 6 Himalayan region, 7 island
    /// territory, 8 North Eastern Region. The payment procedures charge a unit the category it fits with the highest
    /// subsidy (dbo.FN_V4_SUBSIDY_CATEGORY; the regions from Admin → Masters → Subsidy Regions). No value is the general row.
    /// </summary>
    public static readonly int[] Categories = [0, 1, 2, 3, 4, 5, 6, 7, 8];

    public static int CategoryOf(FeeRow r) => r.SpecialCategory ?? 0;

    /// <param name="Category">0 general (the base share), or one of the special <see cref="Categories"/>.</param>
    /// <param name="BaseShare">General: the subsidy every unit of the type gets (%); the other categories keep their additional share on top.</param>
    /// <param name="AdditionalShare">A special category: the share on top of the base (%).</param>
    /// <param name="Certification">The level, or on Consultancy the milestone, whose share changes.</param>
    /// <param name="AllLevels">The same shares for every level (Bronze, Silver, Gold, ZED-X), or on Consultancy every milestone.</param>
    /// <param name="Level">Consultancy: the handholding level whose share changes (null: Silver and Gold alike).</param>
    public sealed record SubsidyRequest(string? Certification, int? Category, decimal? BaseShare, decimal? AdditionalShare, bool AllLevels, string? Level = null);

    /// <summary>
    /// V4: the subsidy share of a category (AssessmentFee.SubsidyPercentage, which the MSME's payment page shows and charges),
    /// with every amount of the changed rows worked out again (joining reward rows keep their reward). Consultancy: per
    /// milestone (its Silver and Gold rows alike, as its fee), or for every milestone.
    /// </summary>
    [HttpPut("{enterpriseType}/subsidy")]
    public async Task<ActionResult<MessageResponse>> UpdateSubsidy(string enterpriseType, SubsidyRequest req, CancellationToken ct)
    {
        var type = Type(enterpriseType);
        if (type is null) return NotFound();
        if (IsFullFee(type)) return this.Problem400(type == "Rejected" ? "Rejected units get no subsidy." : $"{type} fees have no subsidy.");
        var current = await LoadAsync(type, ct);
        var (updated, error) = ByMilestone ? ApplyConsultancySubsidy(current, req) : ApplySubsidy(current, req);
        if (error is not null) return this.Problem400(error);
        var changed = await WriteAsync(current, updated!, ct);
        loggers.CreateLogger(AuditCategory).LogInformation(
            "Subsidy share of {EnterpriseType} {Certification} category {Category} saved by {Actor} (all levels {AllLevels}): {Changed} row(s) changed",
            type, req.AllLevels ? "all" : req.Certification, req.Category, UserId, req.AllLevels, changed);
        return new MessageResponse(changed == 0 ? "No changes to save." : "Subsidy share updated.");
    }

    /// <summary>Consultancy's handholding milestones (AssessmentFee.MileStone, an int there).</summary>
    public static readonly string[] ConsultancyMilestones = ["1", "2", "3"];

    /// <param name="Certification">The level, or on Consultancy the milestone ("1" to "3").</param>
    /// <param name="Reward">The joining reward (0 when none); the reward rows are made with it.</param>
    /// <param name="GeneralShare">The subsidy every unit of the type gets (%).</param>
    /// <param name="AdditionalShares">Per special category of the portal: the share on top of the general one (%).</param>
    /// <param name="AlsoTypes">Other enterprise types to give the same fees (those that already have fees are left alone).</param>
    /// <param name="Levels">Consultancy: the handholding levels to add the milestone's fees for (null: Silver and Gold).</param>
    public sealed record AddRequest(string? Certification, decimal? AssessmentFee, decimal? Reward, decimal? GeneralShare,
        Dictionary<int, decimal?>? AdditionalShares, List<string>? AlsoTypes, List<string>? Levels = null);

    /// <summary>
    /// V4: the fees of a level (Consultancy: a milestone) that has no AssessmentFee rows for the type, so its units can pay.
    /// Makes the rows the payment procedures read: per subsidy category of the portal, one without and one with the joining
    /// reward (Coupon IS NULL / IS NOT NULL); Rejected units one row at full fee. Every amount comes from <see cref="FeeCalculator"/>.
    /// </summary>
    [HttpPost("{enterpriseType}/add")]
    public async Task<ActionResult<MessageResponse>> Add(string enterpriseType, AddRequest req, CancellationToken ct)
    {
        var type = Type(enterpriseType);
        if (type is null) return NotFound();
        var group = ByMilestone
            ? ConsultancyMilestones.FirstOrDefault(m => m == req.Certification?.Trim())
            : Canonical(req.Certification, Levels);
        if (group is null) return this.Problem400(ByMilestone ? "Please select a valid milestone." : "Please select a valid certification level.");
        var (levels, levelError) = AddLevels(req, host.System, group);
        if (levelError is not null) return this.Problem400(levelError);
        var types = new List<string> { type };
        foreach (var also in req.AlsoTypes ?? [])
            if (Type(also) is { } t && !IsFullFee(t) && !IsFullFee(type) && !types.Contains(t)) types.Add(t);

        var added = new List<string>();
        var skipped = new List<string>();
        foreach (var t in types)
        {
            var current = await LoadAsync(t, ct);
            if (current.Any(r => !PayAllRows.IsPayAll(r) && (ByMilestone
                    ? Same(r.MileStone, group) && levels!.Any(l => Same(r.Certification, l))
                    : Same(r.Certification, group))))
            {
                if (t == type) return this.Problem400($"{type} {GroupName(group, levels)} already has fees: change them on this page instead.");
                skipped.Add(t);
                continue;
            }
            var (rows, error) = NewRows(t, group, req, host.System);
            if (error is not null) return this.Problem400(error);
            await InsertAsync(rows!, ct);
            added.Add(t);
            // The schedule "pay all at milestone 1" is on: the new milestone may complete a level's three.
            if (ByMilestone && ScheduleOf(current) is { PayAllAtMilestone1: true, From: { } from })
                await AddPayAllRowsAsync(t, from, ct);
            loggers.CreateLogger(AuditCategory).LogInformation(
                "Fees of {EnterpriseType} {Group} added by {Actor} (system {System}): {Rows} row(s), fee {Fee}, reward {Reward}, general share {Share}",
                t, group, UserId, host.System, rows!.Count, req.AssessmentFee, req.Reward, req.GeneralShare);
        }
        var message = $"Fees added for {string.Join(", ", added)} {GroupName(group, levels)}.";
        if (skipped.Count > 0) message += $" {string.Join(", ", skipped)} already had fees and were left as they were.";
        return new MessageResponse(message);
    }

    private string GroupName(string group, IReadOnlyList<string>? levels = null) =>
        ByMilestone ? (levels is { Count: > 0 } ? string.Join(" and ", levels) + " " : "") + "milestone " + group : group == "ZEDX" ? "ZED-X" : group;

    /// <summary>Consultancy's handholding levels (the order the page lists them in).</summary>
    public static readonly string[] HandholdingLevels = ["Silver", "Gold"];

    /// <summary>The levels a new milestone's fees are added for: Consultancy the chosen handholding levels (default both), else the level.</summary>
    public static (List<string>? Levels, string? Error) AddLevels(AddRequest req, PortalSystem system, string group)
    {
        if (system != PortalSystem.Consultancy) return ([group], null);
        if (req.Levels is null || req.Levels.Count == 0) return ([.. HandholdingLevels], null);
        var levels = new List<string>();
        foreach (var l in req.Levels)
        {
            if (HandholdingLevels.FirstOrDefault(h => Same(l, h)) is not { } level) return (null, "Please select Silver or Gold.");
            if (!levels.Contains(level)) levels.Add(level);
        }
        return ([.. HandholdingLevels.Where(levels.Contains)], null);
    }

    // ---- Consultancy: the payment schedule --------------------------------------------------------

    /// <param name="PayAllAtMilestone1">Units pay all three milestones at milestone 1 (from <paramref name="From"/>), else milestone by milestone.</param>
    public sealed record ScheduleRequest(bool PayAllAtMilestone1, DateOnly? From);

    /// <summary>
    /// V4 (migration 0044): how units pay the three handholding milestones, for Micro, Small and Medium alike. Switched on,
    /// it makes the rows the payment procedures read (<see cref="PayAllRows"/>) for every level and subsidy category that
    /// has fees for all three milestones, and from the date units whose milestone 1 is paid then pay all three at once;
    /// units already started keep paying milestone by milestone. Switched off, new units pay milestone by milestone again;
    /// a unit that paid all three still has nothing more to pay.
    /// </summary>
    [HttpPut("schedule")]
    public async Task<ActionResult<MessageResponse>> UpdateSchedule(ScheduleRequest req, CancellationToken ct)
    {
        if (!ByMilestone) return NotFound();
        var today = DateOnly.FromDateTime(DateTime.Now);
        var before = new List<PaymentSchedule>();
        foreach (var t in ConsultancyEnterpriseTypes) before.Add(ScheduleOf(await LoadAsync(t, ct)));
        DateOnly? from = null;
        if (req.PayAllAtMilestone1)
        {
            if (req.From is not { } f) return this.Problem400("Please enter the date from which units pay all three milestones at milestone 1.");
            if (f < today && !before.Any(b => b.PayAllAtMilestone1 && b.From == f)) return this.Problem400("The date cannot be in the past.");
            from = f;
        }

        var incomplete = new List<string>();
        foreach (var t in ConsultancyEnterpriseTypes)
        {
            if (from is { } start) await AddPayAllRowsAsync(t, start, ct);
            var rows = await LoadAsync(t, ct);
            var (normal, payAll) = Split(rows);
            await WriteAsync(payAll, PayAllRows.Sync(normal, payAll), ct);
            await db.ExecuteSqlAsync(ScheduleSql, new { EnterpriseTypee = t, From = from?.ToDateTime(TimeOnly.MinValue) }, ct);
            if (from is not null) incomplete.AddRange(PayAllRows.IncompleteLevels(normal).Select(l => $"{t} {l}"));
        }
        loggers.CreateLogger(AuditCategory).LogWarning("Handholding payment schedule set by {Actor}: pay all at milestone 1 {PayAll} from {From}",
            UserId, req.PayAllAtMilestone1, from);

        if (from is not { } on)
            return new MessageResponse("Units starting handholding now pay milestone by milestone. Units that paid all three milestones at milestone 1 have nothing more to pay.");
        var message = $"From {on:dd-MM-yyyy}, units starting handholding pay all three milestones at milestone 1. Units already started keep paying milestone by milestone.";
        if (incomplete.Count > 0)
            message += $" {string.Join(", ", incomplete)}: fees are not set for all three milestones, so those units still pay milestone by milestone.";
        return new MessageResponse(message);
    }

    /// <summary>Starts or stops the schedule of a type: the date on its milestone-1 PayAllAtMilestone1 rows (NULL: off).</summary>
    internal const string ScheduleSql =
        "UPDATE AssessmentFee SET PayAllFrom = @From WHERE EnterpriseTypee = @EnterpriseTypee AND PayAllAtMilestone1 = 1 AND MileStone = 1;";

    /// <summary>Makes the PayAllAtMilestone1 rows a type is missing (levels and categories with fees for all three milestones).</summary>
    private async Task AddPayAllRowsAsync(string type, DateOnly from, CancellationToken ct)
    {
        var (normal, payAll) = Split(await LoadAsync(type, ct));
        var missing = PayAllRows.Missing(normal, payAll, from);
        if (missing.Count == 0) return;
        await InsertAsync(missing, ct);
        loggers.CreateLogger(AuditCategory).LogInformation("Pay-all-at-milestone-1 rows of {EnterpriseType} added by {Actor}: {Rows} row(s)", type, UserId, missing.Count);
    }

    /// <summary>The schedule shown on the page: on when a milestone-1 PayAllAtMilestone1 row has a start date.</summary>
    public static PaymentSchedule ScheduleOf(IReadOnlyList<FeeRow> rows)
    {
        var first = rows.Where(r => PayAllRows.IsPayAll(r) && Same(r.MileStone, "1")).ToList();
        var from = first.Where(r => r.PayAllFrom is not null).Select(r => r.PayAllFrom).Min();
        return new PaymentSchedule(from is not null, from, first.Count > 0);
    }

    /// <summary>Consultancy fee change: the ordinary rows as <see cref="ApplyMilestones"/>, the PayAllAtMilestone1 rows worked out again from them.</summary>
    public static (List<FeeRow>? Rows, string? Error) ApplyConsultancy(IReadOnlyList<FeeRow> current, FeesRequest req)
    {
        var (normal, payAll) = Split(current);
        var (updated, error) = ApplyMilestones(normal, req);
        return error is not null ? (null, error) : ([.. updated!, .. PayAllRows.Sync(updated!, payAll)], null);
    }

    /// <summary>Consultancy share change: the ordinary rows as <see cref="ApplySubsidy"/>, the PayAllAtMilestone1 rows worked out again from them.</summary>
    public static (List<FeeRow>? Rows, string? Error) ApplyConsultancySubsidy(IReadOnlyList<FeeRow> current, SubsidyRequest req)
    {
        var (normal, payAll) = Split(current);
        var (updated, error) = ApplySubsidy(normal, req, byMilestone: true);
        return error is not null ? (null, error) : ([.. updated!, .. PayAllRows.Sync(updated!, payAll)], null);
    }

    private static (List<FeeRow> Normal, List<FeeRow> PayAll) Split(IReadOnlyList<FeeRow> rows) =>
        (rows.Where(r => !PayAllRows.IsPayAll(r)).ToList(), rows.Where(PayAllRows.IsPayAll).ToList());


    /// <summary>The new rows of <paramref name="type"/> for a level (or milestone); validated, with every amount worked out.</summary>
    public static (List<FeeRow>? Rows, string? Error) NewRows(string type, string group, AddRequest req, PortalSystem system)
    {
        if (FeeCalculator.AmountError(req.AssessmentFee, "fee") is { } feeError) return (null, feeError);
        var fee = req.AssessmentFee!.Value;
        var rejected = IsFullFee(type);
        var consultancy = system == PortalSystem.Consultancy;
        // The levels a row is made for: the level itself, or on Consultancy the chosen handholding levels of the milestone.
        var (levels, levelError) = AddLevels(req, system, group);
        if (levelError is not null) return (null, levelError);
        var milestone = consultancy ? group : null;
        var rows = new List<FeeRow>();
        FeeRow Blank(string level, int? category, decimal share, decimal? coupon) => new(
            0, type, level, category, true, share, null, null, null, coupon, null, null, null, null, null, null, null, null, null, null, milestone);

        if (rejected)
        {
            foreach (var level in levels!)
            {
                var (row, error) = FeeCalculator.Recalculate(Blank(level, null, 0m, null), fee, null, rejected: true);
                if (error is not null) return (null, error);
                rows.Add(row!);
            }
            return (rows, null);
        }

        if (ShareError(req.GeneralShare, "general subsidy share") is { } shareError) return (null, shareError);
        var reward = req.Reward ?? 0m;
        if (FeeCalculator.AmountError(reward, "joining reward") is { } rewardError) return (null, rewardError);
        if (reward > FeeCalculator.Round(fee * (1 + FeeCalculator.GstRate))) return (null, "The joining reward cannot be more than the fee with GST.");
        foreach (var category in Categories)
        {
            var additional = 0m;
            if (category != 0)
            {
                var value = req.AdditionalShares is { } a && a.TryGetValue(category, out var v) ? v : 0m;
                if (ShareError(value, $"additional share of category {category}") is { } addError) return (null, addError);
                additional = value!.Value;
            }
            var share = req.GeneralShare!.Value + additional;
            if (share > 100) return (null, $"The subsidy of category {category} would be {share:0.##}%: it must be at most 100%.");
            foreach (var level in levels!)
                foreach (var coupon in new decimal?[] { null, reward })
                {
                    var (row, error) = FeeCalculator.Recalculate(Blank(level, category, share, coupon), fee, coupon, rejected: false);
                    if (error is not null) return (null, error);
                    rows.Add(row!);
                }
        }
        return (rows, null);
    }

    /// <summary>The new rows in one transaction (AssessmentFee is the legacy table the procedures read; no procedure inserts one).</summary>
    private async Task InsertAsync(IReadOnlyList<FeeRow> rows, CancellationToken ct)
    {
        var p = new Dapper.DynamicParameters();
        var sql = new System.Text.StringBuilder("SET XACT_ABORT ON; BEGIN TRANSACTION;\n");
        for (var i = 0; i < rows.Count; i++)
        {
            var r = rows[i];
            sql.Append(InsertSql(i, r.MileStone is not null, PayAllRows.IsPayAll(r))).Append('\n');
            p.Add($"EnterpriseTypee{i}", r.EnterpriseTypee);
            p.Add($"Certification{i}", r.Certification);
            p.Add($"SpecialCategory{i}", r.SpecialCategory);
            p.Add($"SubsidyPercentage{i}", r.SubsidyPercentage);
            p.Add($"AssessmentFee{i}", r.AssessmentFee);
            p.Add($"Gst{i}", r.Gst);
            p.Add($"Total{i}", r.Total);
            p.Add($"Coupon{i}", r.Coupon);
            p.Add($"AssessmentFeeAfterCoupon{i}", r.AssessmentFeeAfterCoupon);
            p.Add($"GstAfterCoupon{i}", r.GstAfterCoupon);
            p.Add($"TotalAfterCoupon{i}", r.TotalAfterCoupon);
            p.Add($"SubsidyPer{i}", r.SubsidyPer);
            p.Add($"GstAfterSubsidy{i}", r.GstAfterSubsidy);
            p.Add($"ApplicantContributionAfterSubsidy{i}", r.ApplicantContributionAfterSubsidy);
            p.Add($"Tds15{i}", r.Tds15);
            p.Add($"Tds75{i}", r.Tds75);
            p.Add($"NetPaybleTds15{i}", r.NetPaybleTds15);
            p.Add($"NetPaybleTds75{i}", r.NetPaybleTds75);
            if (r.MileStone is not null) p.Add($"MileStone{i}", int.Parse(r.MileStone, CultureInfo.InvariantCulture));
            if (PayAllRows.IsPayAll(r)) p.Add($"PayAllFrom{i}", r.PayAllFrom?.ToDateTime(TimeOnly.MinValue));
        }
        sql.Append("COMMIT;");
        await db.ExecuteSqlAsync(sql.ToString(), p, ct);
    }

    /// <summary>One new row; SubsidyAmount holds the applicant's share as SP_MASTER_UPDATE_ASSESSMENT_FEE stores it.</summary>
    /// <param name="payAll">A Consultancy PayAllAtMilestone1 row (migration 0044).</param>
    internal static string InsertSql(int i, bool milestone, bool payAll = false) =>
        "INSERT INTO AssessmentFee (EnterpriseTypee, Certification, SpecialCategory, IsActive, SubsidyPercentage, AssessmentFee, Gst, Total, Coupon, " +
        "AssessmentFeeAfterCoupon, GstAfterCoupon, TotalAfterCoupon, SubsidyPer, SubsidyAmount, GstAfterSubsidy, ApplicantContributionAfterSubsidy, " +
        "Tds15, Tds75, NetPaybleTds15, NetPaybleTds75" + (milestone ? ", MileStone" : "") + (payAll ? ", PayAllAtMilestone1, PayAllFrom" : "") + ") VALUES (" +
        $"@EnterpriseTypee{i}, @Certification{i}, @SpecialCategory{i}, 1, @SubsidyPercentage{i}, @AssessmentFee{i}, @Gst{i}, @Total{i}, @Coupon{i}, " +
        $"@AssessmentFeeAfterCoupon{i}, @GstAfterCoupon{i}, @TotalAfterCoupon{i}, @SubsidyPer{i}, @SubsidyPer{i}, @GstAfterSubsidy{i}, " +
        $"@ApplicantContributionAfterSubsidy{i}, @Tds15{i}, @Tds75{i}, @NetPaybleTds15{i}, @NetPaybleTds75{i}" + (milestone ? $", @MileStone{i}" : "") +
        (payAll ? $", 1, @PayAllFrom{i}" : "") + ");";

    /// <summary>The subsidy share of a row: SP_MASTER_UPDATE_ASSESSMENT_FEE has no SubsidyPercentage parameter.</summary>
    internal const string ShareSql = "UPDATE AssessmentFee SET SubsidyPercentage = @SubsidyPercentage WHERE Id = @Id AND EnterpriseTypee = @EnterpriseTypee;";

    internal const string FeeSql =
        "EXEC dbo.SP_MASTER_UPDATE_ASSESSMENT_FEE @Id = @Id, @EnterpriseTypee = @EnterpriseTypee, @Certification = @Certification, " +
        "@AssessmentFee = @AssessmentFee, @Gst = @Gst, @Total = @Total, @Coupon = @Coupon, @AssessmentFeeAfterCoupon = @AssessmentFeeAfterCoupon, " +
        "@GstAfterCoupon = @GstAfterCoupon, @TotalAfterCoupon = @TotalAfterCoupon, @SubsidyPer = @SubsidyPer, @SubsidyAmount = @SubsidyAmount, " +
        "@GstAfterSubsidy = @GstAfterSubsidy, @ApplicantContributionAfterSubsidy = @ApplicantContributionAfterSubsidy, " +
        "@Tds15 = @Tds15, @Tds75 = @Tds75, @NetPaybleTds15 = @NetPaybleTds15, @NetPaybleTds75 = @NetPaybleTds75;";

    /// <summary>
    /// One row's save as one batch in one transaction (as CheckpointAnswers.SaveAsync): the subsidy share, when it changed,
    /// and the amounts. Sent separately, a failure of the second left a share that the stored amounts did not follow.
    /// </summary>
    internal static string SaveSql(bool shareChanged) =>
        "SET XACT_ABORT ON; BEGIN TRANSACTION;\n" + (shareChanged ? ShareSql + "\n" : "") + FeeSql + "\nCOMMIT;";

    /// <summary>Writes the rows whose subsidy share or amounts changed, each with an audit line; the number written.</summary>
    private async Task<int> WriteAsync(IReadOnlyList<FeeRow> current, IReadOnlyList<FeeRow> updated, CancellationToken ct)
    {
        var audit = loggers.CreateLogger(AuditCategory);
        var changed = 0;
        foreach (var row in updated)
        {
            var before = current.First(r => r.Id == row.Id);
            var shareChanged = row.SubsidyPercentage != before.SubsidyPercentage;
            if (row.SameAmounts(before) && !shareChanged) continue;
            var p = new Dapper.DynamicParameters();
            p.Add("Id", row.Id);
            p.Add("EnterpriseTypee", row.EnterpriseTypee);
            if (shareChanged) p.Add("SubsidyPercentage", row.SubsidyPercentage);
            p.Add("Certification", row.Certification);
            p.Add("AssessmentFee", row.AssessmentFee);
            p.Add("Gst", row.Gst);
            p.Add("Total", row.Total);
            p.Add("Coupon", row.Coupon);
            p.Add("AssessmentFeeAfterCoupon", row.AssessmentFeeAfterCoupon);
            p.Add("GstAfterCoupon", row.GstAfterCoupon);
            p.Add("TotalAfterCoupon", row.TotalAfterCoupon);
            p.Add("SubsidyPer", row.SubsidyPer);
            // The procedure stores @SubsidyPer in SubsidyAmount whatever is passed here.
            p.Add("SubsidyAmount", row.SubsidyPer);
            p.Add("GstAfterSubsidy", row.GstAfterSubsidy);
            p.Add("ApplicantContributionAfterSubsidy", row.ApplicantContributionAfterSubsidy);
            p.Add("Tds15", row.Tds15);
            p.Add("Tds75", row.Tds75);
            p.Add("NetPaybleTds15", row.NetPaybleTds15);
            p.Add("NetPaybleTds75", row.NetPaybleTds75);
            await db.ExecuteSqlAsync(SaveSql(shareChanged), p, ct);
            changed++;
            audit.LogWarning(
                "Assessment fee row {Id} ({EnterpriseType} {Certification} {MileStone}, system {System}, special category {SpecialCategory}, coupon row {CouponRow}) changed by {Actor}: " +
                "fee {OldFee} -> {NewFee}, coupon {OldCoupon} -> {NewCoupon}, subsidy {OldShare}% -> {NewShare}%, applicant contribution {OldContribution} -> {NewContribution}, " +
                "net payable (TDS 2%) {OldNet2} -> {NewNet2}, net payable (TDS 10%) {OldNet10} -> {NewNet10}",
                row.Id, row.EnterpriseTypee, row.Certification, row.MileStone, host.System, row.SpecialCategory, row.IsCouponRow, UserId,
                before.AssessmentFee, row.AssessmentFee, before.Coupon, row.Coupon, before.SubsidyPercentage, row.SubsidyPercentage,
                before.ApplicantContributionAfterSubsidy, row.ApplicantContributionAfterSubsidy,
                before.NetPaybleTds15, row.NetPaybleTds15, before.NetPaybleTds75, row.NetPaybleTds75);
        }
        return changed;
    }

    // ---- helpers ------------------------------------------------------------------------------

    private static string? Canonical(string? value, string[] allowed) =>
        allowed.FirstOrDefault(a => string.Equals(a, value?.Trim(), StringComparison.OrdinalIgnoreCase));

    private async Task<List<FeeRow>> LoadAsync(string type, CancellationToken ct) =>
        (await db.QueryProcMultipleAsync("SP_MASTER_GET_ASSESSMENT_FEE", new { MsmeType = type }, ct))[0]
            .Select(FeeRow.From).Where(r => r.Id > 0).OrderBy(r => r.Id).ToList();

    /// <summary>Fee and coupon shown in the level inputs: those of the level's first row and first coupon row (as the old page bound them).</summary>
    private static List<LevelFee> Summary(IReadOnlyList<FeeRow> rows) =>
        Levels.Where(l => rows.Any(r => Same(r.Certification, l)))
            .Select(l =>
            {
                var of = rows.Where(r => Same(r.Certification, l)).ToList();
                var coupon = of.FirstOrDefault(r => r.IsCouponRow);
                return new LevelFee(l, of[0].AssessmentFee, coupon?.Coupon, coupon is not null);
            }).ToList();

    /// <summary>Consultancy: the fee of each level's milestones (that of its first ordinary row), Silver first.</summary>
    private static List<LevelFee> MilestoneSummary(IReadOnlyList<FeeRow> rows)
    {
        var normal = rows.Where(r => !PayAllRows.IsPayAll(r)).ToList();
        var levels = normal.Select(r => r.Certification?.Trim() ?? "").Where(l => l.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(l => Array.FindIndex(HandholdingLevels, h => Same(l, h)) is var i && i >= 0 ? i : HandholdingLevels.Length)
            .ThenBy(l => l, StringComparer.OrdinalIgnoreCase).ToList();
        return levels.SelectMany(level => Milestones(normal).Select(m =>
            {
                var of = normal.Where(r => Same(r.MileStone, m) && Same(r.Certification, level)).ToList();
                return of.Count == 0 ? null
                    : new LevelFee(m, of[0].AssessmentFee, of.FirstOrDefault(r => r.IsCouponRow)?.Coupon, of.Any(r => r.IsCouponRow), of[0].Certification.Trim());
            }))
            .OfType<LevelFee>().ToList();
    }

    private static List<string> Milestones(IReadOnlyList<FeeRow> rows) =>
        rows.Select(r => r.MileStone?.Trim() ?? "").Where(m => m.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(m => m, StringComparer.OrdinalIgnoreCase).ToList();

    /// <summary>
    /// Consultancy: one fee per level and milestone, applied to every ordinary row (with and without coupon) of that level and
    /// milestone; without a level, to Silver and Gold alike (as the old page did). The coupon of a coupon row is kept and must
    /// still fit in the new total. The PayAllAtMilestone1 rows are not passed here (<see cref="ApplyConsultancy"/>).
    /// </summary>
    public static (List<FeeRow>? Rows, string? Error) ApplyMilestones(IReadOnlyList<FeeRow> current, FeesRequest req)
    {
        if (current.Count == 0) return (null, "No fee rows exist for this enterprise type.");
        var levels = req.Levels ?? [];
        if (levels.Count == 0) return (null, "Please enter the handholding fees.");
        var milestones = Milestones(current);
        var result = current.ToList();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var level in levels)
        {
            var milestone = milestones.FirstOrDefault(m => string.Equals(m, level?.Certification?.Trim(), StringComparison.OrdinalIgnoreCase));
            if (level is null || milestone is null) return (null, "Please select a valid milestone.");
            string? handholding = null;
            if (level.Level is not null && (handholding = HandholdingLevels.FirstOrDefault(h => Same(level.Level, h))) is null)
                return (null, "Please select Silver or Gold.");
            // A milestone once per level; one for both levels excludes that milestone of either level.
            var key = milestone + "|" + (handholding ?? "*");
            if (!seen.Add(key) || (handholding is null
                    ? seen.Any(k => k != key && k.StartsWith(milestone + "|", StringComparison.OrdinalIgnoreCase))
                    : seen.Contains(milestone + "|*")))
                return (null, "Please select a valid milestone.");
            bool InScope(FeeRow r) => Same(r.MileStone, milestone) && (handholding is null || Same(r.Certification, handholding));
            if (!result.Any(InScope)) return (null, $"{handholding} has no fees for milestone {milestone}: add them first.");
            var label = (handholding is null ? "" : handholding + " ") + $"milestone {milestone} fee";
            if (FeeCalculator.AmountError(level.AssessmentFee, label) is { } feeError) return (null, feeError);
            if (level.Coupon is not null && result.Any(r => InScope(r) && r.IsCouponRow && r.Coupon != level.Coupon))
                return (null, "The coupon cannot be changed on this page.");
            var fee = level.AssessmentFee!.Value;
            for (var i = 0; i < result.Count; i++)
            {
                if (!InScope(result[i])) continue;
                if (result[i].IsCouponRow && result[i].Coupon > FeeCalculator.Round(fee * (1 + FeeCalculator.GstRate)))
                    return (null, $"The {label} with GST cannot be less than the coupon of row {result[i].Id}.");
                var (row, error) = FeeCalculator.Recalculate(result[i], fee, null, rejected: false);
                if (error is not null) return (null, error);
                result[i] = row!;
            }
        }
        return (result, null);
    }

    private static bool Same(string? a, string b) => string.Equals(a?.Trim(), b, StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// The new subsidy shares: General sets the base (the other categories move with it, keeping their additional share);
    /// a category sets its additional share on top of the level's base. Every changed row is recalculated.
    /// </summary>
    /// <param name="byMilestone">Consultancy: <c>req.Certification</c> is a milestone; the share changes for its rows of every
    /// level, each level against its own general row.</param>
    public static (List<FeeRow>? Rows, string? Error) ApplySubsidy(IReadOnlyList<FeeRow> current, SubsidyRequest req, bool byMilestone = false)
    {
        if (current.Count == 0) return (null, "No fee rows exist for this enterprise type.");
        if (req.Category is not { } category || !Categories.Contains(category)) return (null, "Please choose the subsidy category.");
        var share = category == 0 ? req.BaseShare : req.AdditionalShare;
        var label = category == 0 ? "base share" : "additional share";
        if (ShareError(share, label) is { } shareError) return (null, shareError);
        // The rows of one group: a level, or on Consultancy a milestone.
        Func<FeeRow, string?> groupOf = byMilestone ? r => r.MileStone : r => r.Certification;
        string[] groups;
        if (byMilestone)
        {
            var milestones = Milestones(current);
            if (req.AllLevels) groups = [.. milestones];
            else if (milestones.FirstOrDefault(m => string.Equals(m, req.Certification?.Trim(), StringComparison.OrdinalIgnoreCase)) is { } one) groups = [one];
            else return (null, "Please select a valid milestone.");
        }
        else if (req.AllLevels) groups = Levels.Where(l => current.Any(r => Same(r.Certification, l))).ToArray();
        else if (Canonical(req.Certification, Levels) is { } one && current.Any(r => Same(r.Certification, one))) groups = [one];
        else return (null, "Please select a valid certification level.");

        string? only = null;
        if (byMilestone && req.Level is not null && (only = HandholdingLevels.FirstOrDefault(h => Same(req.Level, h))) is null)
            return (null, "Please select Silver or Gold.");
        var result = current.ToList();
        foreach (var (group, level) in groups.SelectMany(g => current.Where(r => Same(groupOf(r), g)).Select(r => r.Certification?.Trim() ?? "")
                     .Distinct(StringComparer.OrdinalIgnoreCase).Where(l => only is null || Same(l, only)).Select(l => (g, l))))
        {
            var name = byMilestone ? $"{group} {level}" : level;
            bool InGroup(FeeRow r) => Same(groupOf(r), group) && Same(r.Certification, level);
            var general = current.FirstOrDefault(r => InGroup(r) && CategoryOf(r) == 0 && !r.IsCouponRow)
                          ?? current.FirstOrDefault(r => InGroup(r) && CategoryOf(r) == 0);
            if (general?.SubsidyPercentage is not { } oldBase) return (null, $"The {name} fees have no general row with a subsidy; please correct the master data first.");
            for (var i = 0; i < result.Count; i++)
            {
                var row = result[i];
                if (!InGroup(row)) continue;
                decimal pct;
                if (category == 0) pct = CategoryOf(row) == 0 ? share!.Value : share!.Value + ((row.SubsidyPercentage ?? oldBase) - oldBase);
                else if (CategoryOf(row) == category) pct = oldBase + share!.Value;
                else continue;
                if (pct is < 0 or > 100) return (null, $"The {name} subsidy of category {CategoryOf(row)} would be {pct:0.##}%: it must be between 0 and 100.");
                if (pct == row.SubsidyPercentage) continue;
                if (row.AssessmentFee is not { } fee) return (null, $"Fee row {row.Id} ({name}) has no fee; please save the fee first.");
                var (recalculated, error) = FeeCalculator.Recalculate(row with { SubsidyPercentage = pct }, fee, null, rejected: false);
                if (error is not null) return (null, error);
                result[i] = recalculated!;
            }
        }
        return (result, null);
    }


    private static string? ShareError(decimal? value, string label)
    {
        if (value is null) return $"Please enter the {label}.";
        if (value is < 0 or > 100) return $"The {label} must be between 0 and 100%.";
        if (value != FeeCalculator.Round(value.Value)) return $"The {label} can have at most 2 decimals.";
        return null;
    }

    /// <summary>Validates the request and returns every row of the type with the new amounts.</summary>
    public static (List<FeeRow>? Rows, string? Error) Apply(string type, IReadOnlyList<FeeRow> current, FeesRequest req)
    {
        if (current.Count == 0) return (null, "No fee rows exist for this enterprise type.");
        var levels = req.Levels ?? [];
        if (levels.Count == 0) return (null, "Please enter the assessment fees.");
        var rejected = IsFullFee(type);
        var result = current.ToList();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var level in levels)
        {
            var certification = Canonical(level?.Certification, Levels);
            if (level is null || certification is null || !seen.Add(certification) || !current.Any(r => Same(r.Certification, certification)))
                return (null, "Please select a valid certification level.");
            if (FeeCalculator.AmountError(level.AssessmentFee, $"{certification} assessment fee") is { } feeError) return (null, feeError);
            var fee = level.AssessmentFee!.Value;
            var hasCoupon = current.Any(r => Same(r.Certification, certification) && r.IsCouponRow);
            decimal? coupon = null;
            if (!rejected && hasCoupon)
            {
                if (FeeCalculator.AmountError(level.Coupon, $"{certification} coupon") is { } couponError) return (null, couponError);
                coupon = level.Coupon!.Value;
                if (coupon > FeeCalculator.Round(fee * (1 + FeeCalculator.GstRate)))
                    return (null, $"The {certification} coupon cannot be more than the total fee with GST.");
            }
            else if (level.Coupon is not null && level.Coupon != 0)
            {
                return (null, $"Coupons do not apply to {certification} fees of {type} units.");
            }

            for (var i = 0; i < result.Count; i++)
            {
                if (!Same(result[i].Certification, certification)) continue;
                var (row, error) = FeeCalculator.Recalculate(result[i], fee, coupon, rejected);
                if (error is not null) return (null, error);
                result[i] = row!;
            }
        }
        return (result, null);
    }
}

/// <summary>One AssessmentFee row (the columns the page shows and the procedure writes).</summary>
public sealed record FeeRow(
    int Id, string EnterpriseTypee, string Certification, int? SpecialCategory, bool? IsActive, decimal? SubsidyPercentage,
    decimal? AssessmentFee, decimal? Gst, decimal? Total,
    decimal? Coupon, decimal? AssessmentFeeAfterCoupon, decimal? GstAfterCoupon, decimal? TotalAfterCoupon,
    decimal? SubsidyPer, decimal? GstAfterSubsidy, decimal? ApplicantContributionAfterSubsidy,
    decimal? Tds15, decimal? Tds75, decimal? NetPaybleTds15, decimal? NetPaybleTds75, string? MileStone = null,
    bool? PayAllAtMilestone1 = null, DateOnly? PayAllFrom = null)
{
    /// <summary>Rows with a coupon value are the coupon variants (the payment procedures pick them with Coupon IS NOT NULL).</summary>
    public bool IsCouponRow => Coupon is not null;

    public static FeeRow From(IDictionary<string, object?> r) => new(
        int.TryParse(r.Text("Id"), out var id) ? id : 0, r.Text("EnterpriseTypee"), r.Text("Certification"),
        int.TryParse(r.Text("SpecialCategory"), out var sc) ? sc : null,
        r.Text("IsActive") is { Length: > 0 } a ? a is "1" or "True" or "true" : null,
        Dec(r, "SubsidyPercentage"), Dec(r, "AssessmentFee"), Dec(r, "Gst"), Dec(r, "Total"),
        Dec(r, "Coupon"), Dec(r, "AssessmentFeeAfterCoupon"), Dec(r, "GstAfterCoupon"), Dec(r, "TotalAfterCoupon"),
        Dec(r, "SubsidyPer"), Dec(r, "GstAfterSubsidy"), Dec(r, "ApplicantContributionAfterSubsidy"),
        Dec(r, "Tds15"), Dec(r, "Tds75"), Dec(r, "NetPaybleTds15"), Dec(r, "NetPaybleTds75"),
        r.Text("MileStone") is { Length: > 0 } m ? m : null,
        r.Text("PayAllAtMilestone1") is "1" or "True" or "true" ? true : null,
        r.TryGetValue("PayAllFrom", out var from) ? from switch
        {
            DateTime d => DateOnly.FromDateTime(d),
            DateOnly d => d,
            string t when DateOnly.TryParse(t, CultureInfo.InvariantCulture, out var d) => d,
            _ => null,
        } : null);

    private static decimal? Dec(IDictionary<string, object?> r, string column) =>
        r.TryGetValue(column, out var v) && v is not null and not DBNull
            ? v is decimal d ? d : decimal.TryParse(Convert.ToString(v, CultureInfo.InvariantCulture), NumberStyles.Number, CultureInfo.InvariantCulture, out var p) ? p : null
            : null;

    public bool SameAmounts(FeeRow o) =>
        AssessmentFee == o.AssessmentFee && Gst == o.Gst && Total == o.Total && Coupon == o.Coupon &&
        AssessmentFeeAfterCoupon == o.AssessmentFeeAfterCoupon && GstAfterCoupon == o.GstAfterCoupon && TotalAfterCoupon == o.TotalAfterCoupon &&
        SubsidyPer == o.SubsidyPer && GstAfterSubsidy == o.GstAfterSubsidy && ApplicantContributionAfterSubsidy == o.ApplicantContributionAfterSubsidy &&
        Tds15 == o.Tds15 && Tds75 == o.Tds75 && NetPaybleTds15 == o.NetPaybleTds15 && NetPaybleTds75 == o.NetPaybleTds75;
}

/// <summary>
/// Consultancy's "pay all at milestone 1" rows (AssessmentFee.PayAllAtMilestone1, migration 0044), made and kept by the fee
/// page from the ordinary rows (no coupon) of each enterprise type, level and subsidy category:
/// <list type="bullet">
/// <item>milestone 1: what milestone 1 charges a unit paying that way, every amount of the three milestones' rows added
/// up (each milestone's GST, subsidy and TDS as on its own row), with milestone 1's subsidy share as its label;</item>
/// <item>milestones 2 and 3: nothing to pay (all amounts 0, the milestone's share as its label), recorded as a Rs. 0
/// payment when the milestone opens (ZED_CONSULTANT SP_MSME_ZERO_PAYMENT_DETAILS, PaymentType 'PaidAtMilestone1').</item>
/// </list>
/// SP_CONSULTANCY_MSME_GET_PAYMENT_DETAILS chooses them through FN_V4_PAY_ALL_AT_MILESTONE1 (milestone 1: the schedule's
/// date, PayAllFrom; 2 and 3: the unit's milestone 1 was paid on such a row).
/// </summary>
public static class PayAllRows
{
    public static bool IsPayAll(FeeRow r) => r.PayAllAtMilestone1 == true;

    private static readonly string[] Three = ["1", "2", "3"];

    private static string Group(FeeRow r) =>
        string.Join('|', r.EnterpriseTypee?.Trim() ?? "", r.Certification?.Trim() ?? "", AssessmentFeesController.CategoryOf(r)).ToUpperInvariant();

    private static bool Same(string? a, string b) => string.Equals(a?.Trim(), b, StringComparison.OrdinalIgnoreCase);

    /// <summary>The ordinary rows without a coupon of each group, by milestone 1 to 3 (null where one is missing).</summary>
    private static Dictionary<string, FeeRow?[]> Ordinary(IEnumerable<FeeRow> normal) =>
        normal.Where(r => !IsPayAll(r) && !r.IsCouponRow && Three.Any(m => Same(r.MileStone, m)))
            .GroupBy(Group)
            .ToDictionary(g => g.Key, g => Three.Select(m => g.Where(r => Same(r.MileStone, m)).OrderBy(r => r.Id).FirstOrDefault()).ToArray());

    private static decimal? Sum(FeeRow[] rows, Func<FeeRow, decimal?> column) => rows.Sum(r => column(r) ?? 0m);

    /// <summary>The amounts of a pay-all row from its group's three ordinary rows.</summary>
    public static FeeRow Worked(FeeRow row, FeeRow[] three)
    {
        var zero = row with
        {
            Coupon = null, AssessmentFeeAfterCoupon = null, GstAfterCoupon = null, TotalAfterCoupon = null,
            AssessmentFee = 0m, Gst = 0m, Total = 0m, SubsidyPer = 0m, GstAfterSubsidy = 0m, ApplicantContributionAfterSubsidy = 0m,
            Tds15 = 0m, Tds75 = 0m, NetPaybleTds15 = 0m, NetPaybleTds75 = 0m,
        };
        if (!Same(row.MileStone, "1"))
            return zero with { SubsidyPercentage = three[int.Parse(row.MileStone!.Trim(), CultureInfo.InvariantCulture) - 1].SubsidyPercentage };
        return zero with
        {
            SubsidyPercentage = three[0].SubsidyPercentage,
            AssessmentFee = Sum(three, r => r.AssessmentFee), Gst = Sum(three, r => r.Gst), Total = Sum(three, r => r.Total),
            SubsidyPer = Sum(three, r => r.SubsidyPer), GstAfterSubsidy = Sum(three, r => r.GstAfterSubsidy),
            ApplicantContributionAfterSubsidy = Sum(three, r => r.ApplicantContributionAfterSubsidy),
            Tds15 = Sum(three, r => r.Tds15), Tds75 = Sum(three, r => r.Tds75),
            NetPaybleTds15 = Sum(three, r => r.NetPaybleTds15), NetPaybleTds75 = Sum(three, r => r.NetPaybleTds75),
        };
    }

    /// <summary>The existing pay-all rows with their amounts worked out again (a row whose group lacks a milestone is kept as it is).</summary>
    public static List<FeeRow> Sync(IReadOnlyList<FeeRow> normal, IReadOnlyList<FeeRow> payAll)
    {
        var groups = Ordinary(normal);
        return payAll.Select(p => Three.Any(m => Same(p.MileStone, m)) && groups.TryGetValue(Group(p), out var three) && three.All(r => r is not null)
            ? Worked(p, three!) : p).ToList();
    }

    /// <summary>The pay-all rows a type is missing: for each group with all three milestones, those of its milestones without one.</summary>
    public static List<FeeRow> Missing(IReadOnlyList<FeeRow> normal, IReadOnlyList<FeeRow> payAll, DateOnly from)
    {
        var have = payAll.Select(p => Group(p) + "|" + p.MileStone?.Trim()).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var rows = new List<FeeRow>();
        foreach (var (key, three) in Ordinary(normal).OrderBy(g => g.Key, StringComparer.Ordinal))
        {
            if (three.Any(r => r is null)) continue;
            foreach (var m in Three)
            {
                if (have.Contains(key + "|" + m)) continue;
                var like = three[0]!;
                var blank = like with { Id = 0, IsActive = true, MileStone = m, PayAllAtMilestone1 = true, PayAllFrom = m == "1" ? from : null };
                rows.Add(Worked(blank, three!));
            }
        }
        return rows;
    }

    /// <summary>The levels of a type without fees for all three milestones (their units keep paying milestone by milestone).</summary>
    public static List<string> IncompleteLevels(IReadOnlyList<FeeRow> normal) =>
        normal.Where(r => !IsPayAll(r) && !r.IsCouponRow).GroupBy(r => r.Certification?.Trim() ?? "", StringComparer.OrdinalIgnoreCase)
            .Where(g => g.Key.Length > 0 && Three.Any(m => !g.Any(r => Same(r.MileStone, m))))
            .Select(g => g.Key).OrderBy(l => l, StringComparer.OrdinalIgnoreCase).ToList();
}

/// <summary>
/// The fee arithmetic of the old page (ChangeBronze / ChangeCoupon / ChangeRejected in
/// Views/Assessment/PaymentDetails.cshtml), done on the server:
/// <code>
/// Gst = Fee × 18%;  Total = Fee + Gst
/// coupon rows: TotalAfterCoupon = Total − Coupon; GstAfterCoupon = TotalAfterCoupon × 18/118;
///              AssessmentFeeAfterCoupon = TotalAfterCoupon − GstAfterCoupon (the base below)
/// SubsidyPer ("assessment fee after subsidy", the applicant's share) = base × (100 − SubsidyPercentage)/100
///              (Rejected units: the whole base)
/// GstAfterSubsidy = SubsidyPer × 18%;  ApplicantContributionAfterSubsidy = SubsidyPer + GstAfterSubsidy
/// Tds15 = SubsidyPer × 2%;  Tds75 = SubsidyPer × 10%;  NetPaybleTds15/75 = contribution − Tds15/75
/// </code>
/// The old page hard-coded the applicant's share per row position (20/40/50 %, 10/30/40 %, 0 % for
/// Micro/Small/Medium); here it comes from the row's own SubsidyPercentage, which is the subsidy shown to
/// the MSME on the payment page, so the label and the amount charged can no longer disagree. Values are
/// computed at full precision and each stored value is rounded to 2 decimals (as SQL Server did with the
/// strings the old page posted), except NetPaybleTds15/75: the rounded contribution less the rounded TDS.
/// </summary>
public static class FeeCalculator
{
    public const decimal GstRate = 0.18m;
    public const decimal TdsLowRate = 0.02m;
    public const decimal TdsHighRate = 0.10m;

    /// <summary>Largest fee accepted (₹1 crore); AssessmentFee columns are decimal(10,2).</summary>
    public const decimal MaxAmount = 10_000_000m;

    public static decimal Round(decimal v) => Math.Round(v, 2, MidpointRounding.AwayFromZero);

    public static string? AmountError(decimal? value, string label)
    {
        if (value is null) return $"Please enter the {label}.";
        if (value < 0) return $"The {label} cannot be negative.";
        if (value > MaxAmount) return $"The {label} cannot be more than {MaxAmount.ToString("N0", CultureInfo.InvariantCulture)}.";
        if (value != Round(value.Value)) return $"The {label} can have at most 2 decimals.";
        return null;
    }

    public static (FeeRow? Row, string? Error) Recalculate(FeeRow row, decimal fee, decimal? coupon, bool rejected)
    {
        decimal share;
        if (rejected)
        {
            share = 1m;
        }
        else
        {
            if (row.SubsidyPercentage is not { } pct || pct < 0 || pct > 100)
                return (null, $"Fee row {row.Id} ({row.Certification}) has no valid subsidy percentage; please correct the master data first.");
            share = (100m - pct) / 100m;
        }

        var gst = fee * GstRate;
        var total = fee + gst;
        var updated = row with { AssessmentFee = Round(fee), Gst = Round(gst), Total = Round(total) };
        var subsidyBase = fee;
        if (row.IsCouponRow && !rejected)
        {
            var c = coupon ?? row.Coupon!.Value;
            var totalAfter = total - c;
            var gstAfter = totalAfter * 18m / 118m;
            var feeAfter = totalAfter - gstAfter;
            subsidyBase = feeAfter;
            updated = updated with
            {
                Coupon = Round(c), TotalAfterCoupon = Round(totalAfter), GstAfterCoupon = Round(gstAfter), AssessmentFeeAfterCoupon = Round(feeAfter),
            };
        }

        var applicantFee = subsidyBase * share;
        var gstAfterSubsidy = applicantFee * GstRate;
        // The net payable is the stored contribution less the stored TDS, so the three columns always add up (rounding the
        // full-precision difference instead could differ by a paisa from what the payment page shows).
        var contribution = Round(applicantFee + gstAfterSubsidy);
        var tdsLow = Round(applicantFee * TdsLowRate);
        var tdsHigh = Round(applicantFee * TdsHighRate);
        updated = updated with
        {
            SubsidyPer = Round(applicantFee),
            GstAfterSubsidy = Round(gstAfterSubsidy),
            ApplicantContributionAfterSubsidy = contribution,
            Tds15 = tdsLow,
            Tds75 = tdsHigh,
            NetPaybleTds15 = contribution - tdsLow,
            NetPaybleTds75 = contribution - tdsHigh,
        };
        return (updated, null);
    }
}
