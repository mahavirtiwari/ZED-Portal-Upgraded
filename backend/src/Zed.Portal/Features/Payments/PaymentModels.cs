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

    public decimal Amount(string field) =>
        Row.TryGetValue(field, out var v) && v is not null and not DBNull && decimal.TryParse(Convert.ToString(v, CultureInfo.InvariantCulture),
            NumberStyles.Number, CultureInfo.InvariantCulture, out var d) ? d : 0m;

    /// <summary>What the MSME pays: after subsidy, less TDS when TDS is deducted (same fields the old page used).</summary>
    public decimal Payable(string? tds) => tds switch
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
