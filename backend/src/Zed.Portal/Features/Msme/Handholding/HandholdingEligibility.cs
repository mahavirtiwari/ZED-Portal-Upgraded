using System.Globalization;
using Zed.Core.Data;

namespace Zed.Portal.Features.Msme.Handholding;

/// <summary>
/// Handholding Support (consultancy) is bought per level (Silver, Gold or ZED-X) in three milestones, each paid
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
/// <para>
/// 2026-11-16 (approved): which levels a unit may take follows its latest certified level on the main portal (the
/// certified-by-record rule of migration 0079): Bronze → Silver or Gold, Silver → Gold, Gold → ZED-X, ZED-X → none.
/// A level already started stays open until its three milestones are accepted, whatever the rule says.
/// <see cref="Apply"/> sets <c>Enable{Level}</c> by it; ZED-X's own columns (the legacy procedure knows Silver and Gold
/// only) come from <see cref="ExtraSql"/>.
/// </para>
/// </summary>
public static class HandholdingEligibility
{
    public const string ZedX = "ZEDX";

    public static readonly string[] Levels = ["Silver", "Gold", ZedX];

    /// <summary>The name shown for a level (ZED-X for ZEDX).</summary>
    public static string Display(string level) => level == ZedX ? "ZED-X" : level;

    public const int Milestones = 3;

    /// <summary>MsmeCertifications.CertificationStatus of a milestone waiting for the MSME's acceptance.</summary>
    public const int AwaitingAcceptance = 16;

    /// <summary>CertificationStatus of a milestone the MSME has accepted.</summary>
    public const int Accepted = 100;

    public static string? Canonical(string? level) =>
        Levels.FirstOrDefault(l => string.Equals(l, level?.Trim(), StringComparison.OrdinalIgnoreCase));

    /// <summary>SP_CONSULTANCY_APP_MSME_STATUS column with the CertificationStatus of milestone n of a level.</summary>
    public static string CompletionColumn(string level, int milestone) =>
        level switch
        {
            "Gold" => $"MilestoneCompletionStatusGold{milestone}",
            ZedX => $"MilestoneCompletionStatusZEDX{milestone}",
            _ => $"MilestoneCompletionStatus{milestone}",
        };

    /// <summary>
    /// The unit's latest certified main level (Bronze / Silver / Gold / ZEDX, the highest certified by the 0079 rule) and
    /// ZED-X handholding's columns as the legacy procedure names Silver's and Gold's: milestones started, each milestone's
    /// CertificationStatus, the stepper values, the payment marks. Main database; ZED_CONSULTANT as the procedure reads it.
    /// </summary>
    public const string ExtraSql = """
        SELECT
          (SELECT TOP (1) C.Certification FROM dbo.MsmeCertifications C
            WHERE C.ZedId = @ZedId AND C.Certification IN ('Bronze', 'Silver', 'Gold', 'ZEDX')
              AND (C.CertificationStatus = 16 OR (C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL)))
            ORDER BY CASE C.Certification WHEN 'ZEDX' THEN 4 WHEN 'Gold' THEN 3 WHEN 'Silver' THEN 2 ELSE 1 END DESC, C.Id DESC) AS CertifiedLevel,
          ISNULL((SELECT MAX(H.NcCount) FROM ZED_CONSULTANT.dbo.MsmeCertifications H WHERE H.ZedId = @ZedId AND H.Certification = 'ZEDX'), 0) AS ZEDXStatusOfNc,
          (SELECT TOP (1) H.CertificationStatus FROM ZED_CONSULTANT.dbo.MsmeCertifications H WHERE H.ZedId = @ZedId AND H.Certification = 'ZEDX' AND H.NcCount = 1 ORDER BY H.Id DESC) AS ZEDX1,
          (SELECT TOP (1) H.CertificationStatus FROM ZED_CONSULTANT.dbo.MsmeCertifications H WHERE H.ZedId = @ZedId AND H.Certification = 'ZEDX' AND H.NcCount = 2 ORDER BY H.Id DESC) AS ZEDX2,
          (SELECT TOP (1) H.CertificationStatus FROM ZED_CONSULTANT.dbo.MsmeCertifications H WHERE H.ZedId = @ZedId AND H.Certification = 'ZEDX' AND H.NcCount = 3 ORDER BY H.Id DESC) AS ZEDX3,
          (SELECT COUNT(*) FROM ZED_CONSULTANT.dbo.MsmePaymentInfo P WHERE P.ZedId = @ZedId AND P.Certification = 'ZEDX') AS ZEDXPayments;
        """;

    /// <summary>One row of <see cref="ExtraSql"/>.</summary>
    public sealed record Extra(string? CertifiedLevel, int ZEDXStatusOfNc, int? ZEDX1, int? ZEDX2, int? ZEDX3, int ZEDXPayments);

    /// <summary>
    /// Adds ZED-X's columns to the procedure's row and sets <c>EnableSilver</c> / <c>EnableGold</c> / <c>EnableZEDX</c> by
    /// the rule (see the class). Without <paramref name="extra"/> (not readable) the procedure's Silver and Gold stay and
    /// ZED-X is closed. Returns a copy; null stays null.
    /// </summary>
    public static Dictionary<string, object?>? Apply(IDictionary<string, object?>? status, Extra? extra)
    {
        if (status is null) return null;
        var row = new Dictionary<string, object?>(status, StringComparer.OrdinalIgnoreCase);
        if (extra is null)
        {
            row["EnableZEDX"] = 0;
            return row;
        }
        int?[] zedx = [extra.ZEDX1, extra.ZEDX2, extra.ZEDX3];
        row["ZEDXStatusOfNc"] = extra.ZEDXStatusOfNc;
        row["IsZEDXPaymentDone"] = extra.ZEDXPayments > 0 ? 1 : 0;
        for (var n = 1; n <= Milestones; n++)
        {
            var s = zedx[n - 1];
            row[$"MilestoneCompletionStatusZEDX{n}"] = s ?? 0;
            // Paid = the milestone's record exists (the gateway creates it); the stepper values of the procedure's Silver.
            row[n == 1 ? "ZEDXStatus" : $"ZEDXStatus{n}"] = s is not { } v ? 0 : v > 16 ? 4 : v > 8 ? 3 : v > 2 ? 2 : 1;
            row[$"ZEDXStatusOfNc{n}"] = s is null ? 0 : 1;
        }

        var certified = extra.CertifiedLevel;
        bool InProgress(string level)
        {
            var started = Int(row, level + "StatusOfNc");
            return started > 0 && !(started >= Milestones && Int(row, CompletionColumn(level, Milestones)) == Accepted);
        }
        bool Done(string level) => Int(row, level + "StatusOfNc") >= Milestones && Int(row, CompletionColumn(level, Milestones)) == Accepted;
        var silver = (certified == "Bronze" && Int(row, "GoldStatusOfNc") == 0) || InProgress("Silver");
        var gold = (certified is "Bronze" or "Silver" && (Int(row, "SilverStatusOfNc") == 0 || Done("Silver"))) || InProgress("Gold");
        var zedxOpen = certified == "Gold" || InProgress(ZedX);
        row["EnableSilver"] = silver ? 1 : 0;
        row["EnableGold"] = gold ? 1 : 0;
        row["EnableZEDX"] = zedxOpen ? 1 : 0;
        return row;
    }

    /// <summary>The procedure's row with <see cref="Apply"/> (what every handholding call evaluates).</summary>
    public static async Task<Dictionary<string, object?>?> StatusAsync(ISqlExecutor db, string zedId, ILogger log, CancellationToken ct)
    {
        var status = (await db.QueryProcMultipleAsync("SP_CONSULTANCY_APP_MSME_STATUS", new { ZedId = zedId, CertificationType = (string?)null }, ct))[0].FirstOrDefault();
        if (status is null) return null;
        Extra? extra = null;
        try
        {
            extra = (await db.QuerySqlAsync<Extra>(ExtraSql, new { ZedId = zedId }, ct)).FirstOrDefault();
        }
        catch (System.Data.Common.DbException ex)
        {
            log.LogWarning(ex, "Handholding levels could not be read for {ZedId}; ZED-X is closed", zedId);
        }
        return Apply(status, extra);
    }

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
