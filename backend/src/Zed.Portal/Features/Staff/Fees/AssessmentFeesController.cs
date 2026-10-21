using System.Globalization;
using Microsoft.AspNetCore.Mvc;
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
/// </summary>
[Route("api/staff/fees")]
[StaffRoles(UserRole.Admin)]
public sealed class AssessmentFeesController(ISqlExecutor db, ILoggerFactory loggers) : StaffApiController
{
    /// <summary>Log category of the fee audit trail (who changed which row from what to what).</summary>
    public const string AuditCategory = "Zed.Audit.AssessmentFee";

    public static readonly string[] EnterpriseTypes = ["Micro", "Small", "Medium", "Rejected"];
    public static readonly string[] Levels = ["Bronze", "Silver", "Gold"];

    public sealed record LevelFee(string Certification, decimal? AssessmentFee, decimal? Coupon, bool HasCouponRows);
    public sealed record FeesResponse(string EnterpriseType, IReadOnlyList<LevelFee> Levels, IReadOnlyList<FeeRow> Rows);

    [HttpGet("{enterpriseType}")]
    public async Task<ActionResult<FeesResponse>> Get(string enterpriseType, CancellationToken ct)
    {
        var type = Canonical(enterpriseType, EnterpriseTypes);
        if (type is null) return NotFound();
        var rows = await LoadAsync(type, ct);
        return new FeesResponse(type, Summary(rows), rows);
    }

    public sealed record LevelRequest(string? Certification, decimal? AssessmentFee, decimal? Coupon);
    public sealed record FeesRequest(List<LevelRequest>? Levels);

    /// <summary>The rows as they would be saved, without saving (the page shows the computed amounts while editing).</summary>
    [HttpPost("{enterpriseType}/preview")]
    public async Task<ActionResult<FeesResponse>> Preview(string enterpriseType, FeesRequest req, CancellationToken ct)
    {
        var type = Canonical(enterpriseType, EnterpriseTypes);
        if (type is null) return NotFound();
        var current = await LoadAsync(type, ct);
        var (updated, error) = Apply(type, current, req);
        if (error is not null) return this.Problem400(error);
        return new FeesResponse(type, Summary(updated!), updated!);
    }

    [HttpPut("{enterpriseType}")]
    public async Task<ActionResult<MessageResponse>> Update(string enterpriseType, FeesRequest req, CancellationToken ct)
    {
        var type = Canonical(enterpriseType, EnterpriseTypes);
        if (type is null) return NotFound();
        var current = await LoadAsync(type, ct);
        var (updated, error) = Apply(type, current, req);
        if (error is not null) return this.Problem400(error);

        var audit = loggers.CreateLogger(AuditCategory);
        var changed = 0;
        foreach (var row in updated!)
        {
            var before = current.First(r => r.Id == row.Id);
            if (row.SameAmounts(before)) continue;
            await db.ExecuteProcAsync("SP_MASTER_UPDATE_ASSESSMENT_FEE", new
            {
                row.Id,
                row.EnterpriseTypee,
                row.Certification,
                row.AssessmentFee,
                row.Gst,
                row.Total,
                row.Coupon,
                row.AssessmentFeeAfterCoupon,
                row.GstAfterCoupon,
                row.TotalAfterCoupon,
                row.SubsidyPer,
                // The procedure stores @SubsidyPer in SubsidyAmount whatever is passed here.
                SubsidyAmount = row.SubsidyPer,
                row.GstAfterSubsidy,
                row.ApplicantContributionAfterSubsidy,
                row.Tds15,
                row.Tds75,
                row.NetPaybleTds15,
                row.NetPaybleTds75,
            }, ct);
            changed++;
            audit.LogWarning(
                "Assessment fee row {Id} ({EnterpriseType} {Certification}, special category {SpecialCategory}, coupon row {CouponRow}) changed by {Actor}: " +
                "fee {OldFee} -> {NewFee}, coupon {OldCoupon} -> {NewCoupon}, applicant contribution {OldContribution} -> {NewContribution}, " +
                "net payable (TDS 2%) {OldNet2} -> {NewNet2}, net payable (TDS 10%) {OldNet10} -> {NewNet10}",
                row.Id, row.EnterpriseTypee, row.Certification, row.SpecialCategory, row.IsCouponRow, UserId,
                before.AssessmentFee, row.AssessmentFee, before.Coupon, row.Coupon,
                before.ApplicantContributionAfterSubsidy, row.ApplicantContributionAfterSubsidy,
                before.NetPaybleTds15, row.NetPaybleTds15, before.NetPaybleTds75, row.NetPaybleTds75);
        }
        audit.LogInformation("Assessment fees of {EnterpriseType} saved by {Actor}: {Changed} row(s) changed", type, UserId, changed);
        return new MessageResponse(changed == 0 ? "No changes to save." : "Data updated.");
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

    private static bool Same(string? a, string b) => string.Equals(a?.Trim(), b, StringComparison.OrdinalIgnoreCase);

    /// <summary>Validates the request and returns every row of the type with the new amounts.</summary>
    public static (List<FeeRow>? Rows, string? Error) Apply(string type, IReadOnlyList<FeeRow> current, FeesRequest req)
    {
        if (current.Count == 0) return (null, "No fee rows exist for this enterprise type.");
        var levels = req.Levels ?? [];
        if (levels.Count == 0) return (null, "Please enter the assessment fees.");
        var rejected = type == "Rejected";
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
    decimal? Tds15, decimal? Tds75, decimal? NetPaybleTds15, decimal? NetPaybleTds75)
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
        Dec(r, "Tds15"), Dec(r, "Tds75"), Dec(r, "NetPaybleTds15"), Dec(r, "NetPaybleTds75"));

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
/// strings the old page posted).
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
        var contribution = applicantFee + gstAfterSubsidy;
        var tdsLow = applicantFee * TdsLowRate;
        var tdsHigh = applicantFee * TdsHighRate;
        updated = updated with
        {
            SubsidyPer = Round(applicantFee),
            GstAfterSubsidy = Round(gstAfterSubsidy),
            ApplicantContributionAfterSubsidy = Round(contribution),
            Tds15 = Round(tdsLow),
            Tds75 = Round(tdsHigh),
            NetPaybleTds15 = Round(contribution - tdsLow),
            NetPaybleTds75 = Round(contribution - tdsHigh),
        };
        return (updated, null);
    }
}
