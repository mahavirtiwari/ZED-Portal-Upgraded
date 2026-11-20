using System.Data.Common;
using Zed.Core.Data;

namespace Zed.Portal.Features.Incentives;

/// <summary>
/// When a unit may claim a scheme (the user, 2026-11-20): one claim per certification level the scheme covers, graded for that
/// level; the window opens at certification and stays open until the benefit is availed, the unit is certified at a higher
/// level, or the certificate is suspended / withdrawn (expired, rejected or pending certificates do not count either); a
/// re-certification (a new certificate of the level) opens the same level again. "After registration": one claim. "After
/// handholding": one claim per completed handholding (milestone 3 accepted). A rejected application may be followed by a new
/// one while the window is open; an application in progress continues whatever happens to the window (an upgrade does not
/// stop it; a suspension or withdrawal puts it on hold, <see cref="SchemeApplications"/>).
/// </summary>
public static class SchemeEligibility
{
    /// <summary>Certificate phases that do not count (MsmeCertifications.CertificationPhase).</summary>
    public static readonly IReadOnlySet<string> InactivePhases = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        { "EXPIRED", "WITHDRAWN", "SUSPENDED", "PENDING", "REJECTED" };

    /// <summary>The phases that hold an application in progress (the Master Admin then resumes or rejects it).</summary>
    public static readonly IReadOnlySet<string> HoldPhases = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "WITHDRAWN", "SUSPENDED" };

    internal const string CertifiedSql =
        "SELECT Certification, CAST(CASE WHEN CertificationStatus = 16 THEN SaCertificateNo ELSE DaCertificateNo END AS varchar(100)) AS CertNo, " +
        "CertificationStatusDate AS CertifiedOn, CertificationPhase AS Phase FROM dbo.MsmeCertifications WHERE ZedId = @ZedId " +
        "AND ((CertificationStatus = 6 AND DaCertificateNo IS NOT NULL) OR (CertificationStatus = 16 AND SaCertificateNo IS NOT NULL));";

    internal const string HandholdingSql =
        "SELECT TOP 1 CAST(Id AS varchar(20)) AS Ref, CertificationStatusDate AS CompletedOn FROM ZED_CONSULTANT.dbo.MsmeCertifications " +
        "WHERE ZedId = @ZedId AND NcCount = 3 AND CertificationStatus = 100 ORDER BY Id DESC;";

    internal const string UnitSql =
        "SELECT TOP 1 M.EnterpriseType, M.TwoDigitActivity, M.CreatedDate AS RegisteredOn FROM dbo.Msme M WHERE M.ZedId = @ZedId;";

    public sealed record CertifiedRow(string? Certification, string? CertNo, DateTime? CertifiedOn, string? Phase);
    public sealed record HandholdingRow(string? Ref, DateTime? CompletedOn);
    public sealed record UnitRow(string? EnterpriseType, string? TwoDigitActivity, DateTime? RegisteredOn);

    /// <summary>A certificate of the unit that counts (active phase).</summary>
    public sealed record Certificate(string Level, string CertNo, DateTime? CertifiedOn, string? Phase, int Rank);

    /// <summary>What the rules read about a unit.</summary>
    /// <param name="Benefits">MsmeBasicInformation.IsEligibleForBenefits = 1 (0: the ZED team withdrew all benefits).</param>
    public sealed record UnitFacts(string ZedId, string? Size, string? TwoDigitActivity, bool Benefits, DateTime? RegisteredOn,
        IReadOnlyList<Certificate> Certificates, IReadOnlyList<CertifiedRow> AllCertified, HandholdingRow? Handholding)
    {
        /// <summary>The unit's highest active certificate (by the levels' order), or null.</summary>
        public Certificate? Highest => Certificates.OrderByDescending(c => c.Rank).ThenByDescending(c => c.CertifiedOn).FirstOrDefault();
    }

    /// <summary>The claim a unit may make now: the level, the certificate it belongs to, the date it opened and the grade.</summary>
    public sealed record ClaimWindow(string Level, string CertRef, DateTime? OpenedOn, SchemeGrade? Grade);

    public static async Task<UnitFacts> FactsAsync(ISqlExecutor db, string zedId, bool benefits, ILogger log, CancellationToken ct)
    {
        var unit = (await db.QuerySqlAsync<UnitRow>(UnitSql, new { ZedId = Ansi(zedId) }, ct)).FirstOrDefault();
        var certified = await db.QuerySqlAsync<CertifiedRow>(CertifiedSql, new { ZedId = Ansi(zedId) }, ct);
        HandholdingRow? hh = null;
        try
        {
            hh = (await db.QuerySqlAsync<HandholdingRow>(HandholdingSql, new { ZedId = Ansi(zedId) }, ct)).FirstOrDefault();
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Handholding of {ZedId} not readable", zedId);
        }
        var certificates = certified
            .Where(c => LevelRegistry.Canonical(c.Certification) is not null && !string.IsNullOrWhiteSpace(c.CertNo) && !InactivePhases.Contains(c.Phase?.Trim() ?? ""))
            .Select(c => new Certificate(LevelRegistry.Canonical(c.Certification)!, c.CertNo!.Trim(), c.CertifiedOn, c.Phase?.Trim(), Rank(c.Certification)))
            .ToList();
        return new UnitFacts(zedId, Size(unit?.EnterpriseType), unit?.TwoDigitActivity, benefits, unit?.RegisteredOn, certificates, certified, hh);
    }

    /// <summary>The level's place in Administration → Certification Levels (Bronze below Silver below Gold ...).</summary>
    public static int Rank(string? level)
    {
        var all = LevelRegistry.All;
        var e = LevelRegistry.Find(level);
        if (e is null) return -1;
        return e.OrderNo > 0 ? e.OrderNo : all.ToList().IndexOf(e) + 1;
    }

    public static string? Size(string? enterpriseType) =>
        SchemeRules.Sizes.FirstOrDefault(s => string.Equals(s, enterpriseType?.Trim(), StringComparison.OrdinalIgnoreCase));

    /// <summary>
    /// The claim the unit may make under the activation (a scheme's, or a built-in card's ActivatesAfter), or null with the
    /// reason it cannot (<paramref name="locked"/>: "notCertified", "notEligible", "levelNotCovered", "handholding").
    /// </summary>
    public static ClaimWindow? Window(SchemeActivation activation, SchemeGrading? grading, UnitFacts unit, out string? locked)
    {
        locked = null;
        if (!unit.Benefits) { locked = "notEligible"; return null; }
        switch (activation.Mode)
        {
            case SchemeRules.Registration:
                return new ClaimWindow(SchemeRules.Registration, unit.ZedId, unit.RegisteredOn, Grade(grading, SchemeRules.Registration, unit));
            case SchemeRules.Handholding:
                if (string.IsNullOrWhiteSpace(unit.Handholding?.Ref)) { locked = "handholding"; return null; }
                return new ClaimWindow(SchemeRules.Handholding, unit.Handholding!.Ref!, unit.Handholding.CompletedOn, Grade(grading, SchemeRules.Handholding, unit));
            default:
                // The highest active certificate decides: a lower level's window closes once a higher level is certified.
                var top = unit.Highest;
                if (top is null) { locked = "notCertified"; return null; }
                if (!activation.Levels.Contains(top.Level, StringComparer.OrdinalIgnoreCase)) { locked = "levelNotCovered"; return null; }
                return new ClaimWindow(top.Level, top.CertNo, top.CertifiedOn, Grade(grading, top.Level, unit));
        }
    }

    /// <summary>The grade of a claim: the row of its level (or "All"), or of the unit's enterprise size.</summary>
    public static SchemeGrade? Grade(SchemeGrading? grading, string level, UnitFacts unit)
    {
        if (grading is null) return null;
        var key = grading.Mode == SchemeRules.BySize ? unit.Size : level;
        return grading.Rows.FirstOrDefault(r => string.Equals(r.Key, key, StringComparison.OrdinalIgnoreCase))
            ?? grading.Rows.FirstOrDefault(r => string.Equals(r.Key, "All", StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>Eligible = share % of the claim (whole rupees), at most the grade's maximum (FA / TU: truncate, then the share).</summary>
    public static decimal Eligible(decimal claim, SchemeGrade? grade) =>
        grade is null ? 0m : Math.Min(decimal.Round(decimal.Truncate(claim) * grade.SharePercent / 100m, 2), grade.MaxAmount);

    /// <summary>An activation from a built-in card's ActivatesAfter (level codes, or Registration / Handholding).</summary>
    public static SchemeActivation FromCardSetting(IReadOnlyList<string> values, IReadOnlyList<string> defaultLevels)
    {
        if (values.Contains(SchemeRules.Registration, StringComparer.OrdinalIgnoreCase)) return new() { Mode = SchemeRules.Registration };
        if (values.Contains(SchemeRules.Handholding, StringComparer.OrdinalIgnoreCase)) return new() { Mode = SchemeRules.Handholding };
        var levels = values.Select(LevelRegistry.Canonical).Where(l => l is not null).Select(l => l!).ToList();
        return new() { Mode = SchemeRules.Levels, Levels = levels.Count > 0 ? levels : defaultLevels };
    }

    private static Dapper.DbString Ansi(string v) => new() { Value = v, IsAnsi = true, Length = 50 };
}
