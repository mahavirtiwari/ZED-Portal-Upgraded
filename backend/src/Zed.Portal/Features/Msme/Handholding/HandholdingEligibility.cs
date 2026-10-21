using System.Globalization;
using Zed.Core.Data;

namespace Zed.Portal.Features.Msme.Handholding;

/// <summary>
/// Handholding Support (consultancy) is bought per level (Silver or Gold) in three milestones, each paid
/// at its start. Rules of Views/Msme/HandholdingSupport.cshtml, read from SP_CONSULTANCY_APP_MSME_STATUS
/// (ZED_CONSULTANT through the main database):
/// <list type="bullet">
/// <item>the level's card is usable only while <c>Enable{Level}</c> = 1;</item>
/// <item>the next milestone is <c>{Level}StatusOfNc</c> (milestones started) + 1, at most 3;</item>
/// <item>milestone n &gt; 1 opens once milestone n-1 is accepted by the MSME
/// (<c>MilestoneCompletionStatus{n-1}</c> / <c>MilestoneCompletionStatusGold{n-1}</c> = 100);</item>
/// <item>"ACCEPT MILESTONE n" is offered while that milestone waits for the MSME (status 16).</item>
/// </list>
/// The old page only enforced these in the browser (greyed panels); here every payment call checks them.
/// </summary>
public static class HandholdingEligibility
{
    public static readonly string[] Levels = ["Silver", "Gold"];

    public const int Milestones = 3;

    /// <summary>MsmeCertifications.CertificationStatus of a milestone waiting for the MSME's acceptance.</summary>
    public const int AwaitingAcceptance = 16;

    /// <summary>CertificationStatus of a milestone the MSME has accepted.</summary>
    public const int Accepted = 100;

    public static string? Canonical(string? level) =>
        Levels.FirstOrDefault(l => string.Equals(l, level?.Trim(), StringComparison.OrdinalIgnoreCase));

    /// <summary>SP_CONSULTANCY_APP_MSME_STATUS column with the CertificationStatus of milestone n of a level.</summary>
    public static string CompletionColumn(string level, int milestone) =>
        level == "Gold" ? $"MilestoneCompletionStatusGold{milestone}" : $"MilestoneCompletionStatus{milestone}";

    public static int Int(IDictionary<string, object?>? row, string column) =>
        row is not null && int.TryParse(row.Text(column), NumberStyles.Integer, CultureInfo.InvariantCulture, out var i) ? i : 0;

    public static LevelState Evaluate(IDictionary<string, object?>? status, string level)
    {
        var enabled = Int(status, "Enable" + level) == 1;
        var started = Int(status, level + "StatusOfNc");
        var next = started + 1;

        string? refusal = null;
        if (status is null || !enabled) refusal = "Handholding Support is not available for this level.";
        else if (next > Milestones) refusal = "All milestones of Handholding Support for this level have been paid.";
        else if (next > 1 && Int(status, CompletionColumn(level, next - 1)) != Accepted)
            refusal = $"Milestone {next - 1} must be completed and accepted before Milestone {next} can be paid.";

        var awaiting = Enumerable.Range(1, Milestones).FirstOrDefault(n => Int(status, CompletionColumn(level, n)) == AwaitingAcceptance);
        return new LevelState(level, enabled, started, Math.Min(next, Milestones), refusal is null, refusal, awaiting == 0 ? null : awaiting);
    }

    /// <param name="NextMilestone">Milestone the next payment is for (1–3).</param>
    /// <param name="CanPay">The next milestone can be paid now.</param>
    /// <param name="Refusal">Why not, when <paramref name="CanPay"/> is false.</param>
    /// <param name="AwaitingAcceptance">Milestone waiting for the MSME's acceptance, if any.</param>
    public sealed record LevelState(
        string Certification, bool Enabled, int MilestonesStarted, int NextMilestone, bool CanPay, string? Refusal, int? AwaitingAcceptance);
}
