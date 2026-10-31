using System.Globalization;
using System.Text.RegularExpressions;
using Zed.Core.Data;
using Zed.Core.Documents;

namespace Zed.Portal.Features.Payments;

/// <summary>Certification levels paid through the dashboard (Msme flags IsBronzePaymentDone etc.).</summary>
public static partial class Certifications
{
    public static readonly string[] Paid = ["Bronze", "Silver", "Gold"];

    public static string? Canonical(string? value) =>
        Paid.FirstOrDefault(c => string.Equals(c, value, StringComparison.OrdinalIgnoreCase));

    /// <summary>
    /// The levels an MSME applies and pays for: the three and ZED-X (code ZEDX; migrations 0028 / 0029); also their
    /// surveillance (<see cref="CanonicalSurveillance"/>).
    /// </summary>
    public static readonly string[] Applicable = [.. Paid, "ZEDX"];

    public static string? CanonicalApplicable(string? value) =>
        Applicable.FirstOrDefault(c => string.Equals(c, value, StringComparison.OrdinalIgnoreCase));

    /// <summary>
    /// The levels whose surveillance is paid on the dashboard: the three, and ZED-X (migrations 0032 / 0033; its schedule
    /// and flags are V4's, <see cref="LevelSurveillance"/>).
    /// </summary>
    public static string? CanonicalSurveillance(string? value) => CanonicalApplicable(value);

    /// <summary>A level the MSME may apply for now: known and enabled by the Admin (Administration → Certification Levels).</summary>
    public static async Task<string?> OpenForApplyingAsync(ISqlExecutor db, string? value, ILogger log, CancellationToken ct) =>
        CanonicalApplicable(value) is { } code && (await CertLevels.CertificationLevels.FindAsync(db, code, log, ct))?.IsEnabled == true ? code : null;

    /// <summary>A level started and not yet certified (the old dashboard's conditions: Bronze 1–5 or 7, the others 1–15 or 17).</summary>
    public static bool InProgress(string level, int status) =>
        level == "Bronze" ? status > 0 && (status < 6 || status == 7) : status > 0 && (status < 16 || status == 17);

    /// <summary>
    /// The level that keeps <paramref name="cert"/> from being applied for. Two certifications never run at once: ZED-X and
    /// Bronze/Silver/Gold exclude each other while one of them is in progress. ZED-X is the highest level, so once it is
    /// certified (16, or 17 as Gold's) the three are closed, as Gold certified closes Bronze and Silver. The dashboard greys the
    /// card out on the same conditions (dashboard.ts levelDisabled); Bronze/Silver/Gold among themselves keep the old page's
    /// rules, checked in the browser only as before.
    /// </summary>
    public static string? BlockedBy(string cert, IReadOnlyDictionary<string, int> statuses)
    {
        int S(string l) => statuses.TryGetValue(l, out var s) ? s : 0;
        if (S(cert) >= 1) return null;   // already applied: the checkout refuses it (AlreadyPaidAsync, the payment procedures)
        return cert == "ZEDX"
            ? Paid.FirstOrDefault(l => InProgress(l, S(l)))
            : S("ZEDX") > 0 ? "ZEDX" : null;   // ZED-X in progress or certified
    }

    /// <summary>
    /// <see cref="BlockedBy"/> for the unit, as a message to show; null when the level may be applied for. The statuses are
    /// the dashboard's: SP_MSME_GET_DETAILS for the three, the certification row or payment flag for ZED-X.
    /// </summary>
    public static async Task<string?> OtherLevelInProgressAsync(ISqlExecutor db, string zedId, string cert, ILogger log, CancellationToken ct)
    {
        var sets = await db.QueryProcMultipleAsync("SP_MSME_GET_DETAILS", new { ZedId = zedId, CertificationType = (string?)null }, ct);
        var row = sets[2].FirstOrDefault();
        var statuses = Paid.ToDictionary(l => l, l => int.TryParse(row?.Text(l + "Status"), out var s) ? s : 0);
        try
        {
            var zedx = (await db.QuerySqlAsync<Msme.MsmeDashboardController.ZedXRow>(Msme.MsmeDashboardController.ZedXSql, new { ZedId = zedId }, ct))
                .FirstOrDefault();
            statuses["ZEDX"] = zedx is null ? 0 : zedx.Status ?? zedx.PaymentDone;
        }
        catch (System.Data.Common.DbException ex)
        {
            log.LogWarning(ex, "ZED-X status not read (is migration 0029 applied?)");
            statuses["ZEDX"] = 0;
        }
        return BlockedBy(cert, statuses) switch
        {
            null => null,
            var other when InProgress(other, statuses[other]) =>
                $"{LevelName(cert)} certification cannot be applied for while your {LevelName(other)} certification is in progress.",
            _ => $"{LevelName(cert)} certification cannot be applied for: your unit is certified at ZED-X, the highest level.",
        };
    }

    private static string LevelName(string level) => level == "ZEDX" ? "ZED-X" : level;

    /// <summary>
    /// The level is already paid or applied for: no new payment of it may be recorded. The legacy zero-amount procedure
    /// refuses only Bronze / Silver / Gold (Is{Level}PaymentDone) and records ZED-X again on every call (another
    /// MsmePaymentInfo row, the questionnaire copied again), so ZED-X is checked here: a recorded payment or a certification
    /// row of the unit. Not Msme.IsZEDXPaymentDone: SP_V4_CERTIFICATION_PAID sets it only after a recorded payment, and the
    /// legacy rejection (which renames the rows to ZedId_D) leaves it set, so it would refuse a rejected unit's new
    /// application. For the three this is the zero procedure's own condition.
    /// </summary>
    internal static string PaidSql(string level) => level == "ZEDX"
        ? "SELECT 1 WHERE EXISTS (SELECT 1 FROM dbo.MsmePaymentInfo WHERE ZedId = @ZedId AND Certification = 'ZEDX') " +
          "OR EXISTS (SELECT 1 FROM dbo.MsmeCertifications WHERE ZedId = @ZedId AND Certification = 'ZEDX');"
        : $"SELECT 1 FROM dbo.Msme M WHERE M.ZedId = @ZedId AND ISNULL(M.Is{level}PaymentDone, 0) = 1;";

    /// <summary>
    /// <see cref="PaidSql"/> for the unit. The level comes from <see cref="Applicable"/> only (it names the flag column).
    /// Fails closed: when the check cannot be read the level counts as paid.
    /// </summary>
    public static async Task<bool> AlreadyPaidAsync(ISqlExecutor db, string zedId, string level, ILogger log, CancellationToken ct)
    {
        if (CanonicalApplicable(level) is not { } code) return true;
        try
        {
            return (await db.QuerySqlAsync<int>(PaidSql(code), new { ZedId = new Dapper.DbString { Value = zedId, IsAnsi = true, Length = 50 } }, ct)).Count > 0;
        }
        catch (System.Data.Common.DbException ex)
        {
            log.LogError(ex, "Payment state of {ZedId}/{Level} not read; the payment is refused", zedId, code);
            return true;
        }
    }


    [GeneratedRegex(@"^([0][1-9]|[1-2][0-9]|[3][0-8])[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")]
    public static partial Regex Gstin();

    [GeneratedRegex(@"^[A-Z]{4}[0-9]{5}[A-Z]$")]
    public static partial Regex Tan();

    [GeneratedRegex(@"^[A-Z]{5}[0-9]{4}[A-Z]$")]
    public static partial Regex Pan();

    /// <summary>Characters 3–12 of a GSTIN are the holder's PAN.</summary>
    public static string PanOf(string gstin) => gstin.Substring(2, 10);
}

/// <summary>One AssessmentFee / StateAssessmentFee row returned by SP_MSME_GET_PAYMENT_DETAILS.</summary>
public sealed class FeeOption(IDictionary<string, object?> row)
{
    public IDictionary<string, object?> Row { get; } = row;

    public string Id => Row.Text("Id");

    /// <summary>
    /// The checkout's refusal when <see cref="Due"/> cannot be read: a missing amount is never taken as nothing to pay.
    /// </summary>
    public const string Unreadable = "The fee amount could not be confirmed. Please contact zed.support@qcin.org.";

    /// <summary>An amount of the row; null when the column is missing, empty or not a number (never read as 0).</summary>
    public decimal? Amount(string field) =>
        Row.TryGetValue(field, out var v) && v is not null and not DBNull && decimal.TryParse(Convert.ToString(v, CultureInfo.InvariantCulture),
            NumberStyles.Number, CultureInfo.InvariantCulture, out var d) ? d : null;

    /// <summary>ApplicantContributionAfterSubsidy: what decides the zero-amount path. Null when unreadable (the checkout is refused).</summary>
    public decimal? Due => Amount("ApplicantContributionAfterSubsidy");

    /// <summary>What the MSME pays: after subsidy, less TDS when TDS is deducted (same fields the old page used); null when unreadable.</summary>
    public decimal? Payable(string? tds) => tds switch
    {
        "1.5" => Amount("NetPaybleTds15"),
        "7.5" => Amount("NetPaybleTds75"),
        _ => Amount("ApplicantContributionAfterSubsidy"),
    };
}

/// <summary>The payment summary lines, as on the old dashboard summary, receipt page and e-mail.</summary>
public static class PaymentSummary
{
    private static string V(IDictionary<string, object?> r, string c) =>
        r.TryGetValue(c, out var v) && v is not null and not DBNull ? Convert.ToString(v, CultureInfo.InvariantCulture) ?? "" : "";

    public static List<SummaryLine> Lines(IDictionary<string, object?> p)
    {
        var lines = new List<SummaryLine> { new("Certification Fee", "₹ " + V(p, "Total")) };
        if (V(p, "UseCoupon") == "Yes")
        {
            lines.Add(new("Joining Reward", "- ₹ " + V(p, "Coupon")));
            lines.Add(new("Final Certification Fee", "₹ " + V(p, "TotalAfterCoupon"), "(After adjusting joining reward)"));
            lines.Add(new("Subsidy " + V(p, "SubsidyLabel"), "- ₹ " + V(p, "SubsidyCoupon"), "(On final certification fee)"));
            if (V(p, "StateSubsidyCoupon") is { Length: > 0 } sc && sc != "0")
                lines.Add(new("Andhra Pradesh Govt. Subsidy " + V(p, "StateSubsidyLabel"), "- ₹ " + sc, "(On final certification fee)"));
        }
        else
        {
            lines.Add(new("Final Certification Fee", "₹ " + V(p, "Total")));
            lines.Add(new("Subsidy " + V(p, "SubsidyLabel"), "- ₹ " + V(p, "Subsidy")));
            if (V(p, "StateSubsidy") is { Length: > 0 } ss && ss != "0")
                lines.Add(new("Andhra Pradesh Govt. Subsidy " + V(p, "StateSubsidyLabel"), "- ₹ " + ss));
        }
        lines.Add(new("Amount Payable", "₹ " + V(p, "ApplicantContributionAfterSubsidy")));
        lines.Add(new("Amount", "₹ " + V(p, "SubsidyAmount")));
        lines.Add(new("GST(18%)", "₹ " + V(p, "GstAfterSubsidy")));
        if (V(p, "TdsDeductible") == "Yes")
        {
            var tds = V(p, "Tds");
            if (tds == "1.5") lines.Add(new("TDS Deducted (2%)", "₹ " + V(p, "Tds15")));
            else if (tds == "7.5") lines.Add(new("TDS Deducted (10%)", "₹ " + V(p, "Tds75")));
            lines.Add(new("Net Payable Amount", "₹ " + (tds == "7.5" ? V(p, "NetPaybleTds75") : V(p, "NetPaybleTds15")), Bold: true));
        }
        else
        {
            lines.Add(new("Net Payable Amount", "₹ " + V(p, "ApplicantContributionAfterSubsidy"), Bold: true));
        }
        return lines;
    }
}
