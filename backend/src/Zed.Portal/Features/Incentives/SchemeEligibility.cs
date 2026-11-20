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
/// <para>
/// 2026-11-20 (the legacy validations carried over): a unit the ZED team blocked for financial assistance
/// (MsmeBasicInformation.IsEligibleForFinancial = 0) cannot claim any scheme, as one without benefits; when the unit's highest
/// certificate is suspended or withdrawn the window stays closed even if a lower certificate is still active.
/// </para>
/// <para>
/// Re-certification (verified 2026-11-20 on SP_RESET_FOR_RE_CERTIFICATION / SP_ADD_CERTIFICATION_ID and the certificate
/// procedures): the earlier MsmeCertifications row of the level is kept under the ZED ID "{ZedId}_R_{Id}", so it leaves
/// <see cref="CertifiedSql"/>, and the new cycle's row gets a new certificate number (Bronze: the date + serial; Silver / Gold:
/// the agency's number) when certified: the new number is a new window. The earlier rows are read by <see cref="ArchivedSql"/>.
/// </para>
/// <para>
/// Legacy claims (<see cref="LegacyClaim"/>): the Financial Assistance applications made before the framework (dbo.FinancialAssistance
/// rows without a SchemeCode; the level in CertificationType, no ZED certificate number: CertficateNumber is the testing / system /
/// product certificate) and the consultant-recommended Technology Upgradation applications (ZED_CONSULTANT.dbo.FinancialAssistance;
/// the handholding's level in CertificationType). Rejected ones (VerificationStatus 5; TU also TechUpgradeStatus 7) do not
/// count; paid = VerificationStatus 6; anything else is in progress (a TU draft has no VerificationStatus yet). A legacy claim
/// is matched to a claim window by <see cref="LegacyCounts"/>.
/// </para>
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

    /// <summary>The unit's earlier certificates, kept under "{ZedId}_R_{Id}" at a re-certification (SP_RESET_FOR_RE_CERTIFICATION).</summary>
    internal const string ArchivedSql =
        "SELECT Certification, CAST(ISNULL(SaCertificateNo, DaCertificateNo) AS varchar(100)) AS CertNo, CertificationStatusDate AS CertifiedOn, " +
        "CertificationPhase AS Phase FROM dbo.MsmeCertifications WHERE ZedId LIKE @Archived AND (DaCertificateNo IS NOT NULL OR SaCertificateNo IS NOT NULL);";

    internal const string HandholdingSql =
        "SELECT TOP 1 CAST(Id AS varchar(20)) AS Ref, CertificationStatusDate AS CompletedOn FROM ZED_CONSULTANT.dbo.MsmeCertifications " +
        "WHERE ZedId = @ZedId AND NcCount = 3 AND CertificationStatus = 100 ORDER BY Id DESC;";

    internal const string UnitSql =
        "SELECT TOP 1 M.EnterpriseType, M.TwoDigitActivity, M.CreatedDate AS RegisteredOn FROM dbo.Msme M WHERE M.ZedId = @ZedId;";

    /// <summary>The unit's Financial Assistance applications before the framework (not rejected), with the invoice numbers used.</summary>
    internal const string LegacyFaSql =
        "SELECT Id, CertificationType AS Level, VerificationStatus, CreatedDate AS CreatedOn, InvoiceNo FROM dbo.FinancialAssistance " +
        "WHERE ZedId = @ZedId AND SchemeCode IS NULL AND ISNULL(VerificationStatus, 1) <> 5;";

    /// <summary>The unit's consultant-recommended Technology Upgradation applications (ZED_CONSULTANT; not rejected; drafts included).</summary>
    internal const string LegacyTuSql =
        "SELECT Id, CertificationType AS Level, VerificationStatus, CreatedDate AS CreatedOn, CAST(NULL AS varchar(50)) AS InvoiceNo " +
        "FROM ZED_CONSULTANT.dbo.FinancialAssistance WHERE ZedId = @ZedId AND ISNULL(VerificationStatus, 0) <> 5 AND ISNULL(TechUpgradeStatus, 0) <> 7;";

    public sealed record CertifiedRow(string? Certification, string? CertNo, DateTime? CertifiedOn, string? Phase);
    public sealed record HandholdingRow(string? Ref, DateTime? CompletedOn);
    public sealed record UnitRow(string? EnterpriseType, string? TwoDigitActivity, DateTime? RegisteredOn);

    /// <summary>A legacy application row (<see cref="LegacyFaSql"/> / <see cref="LegacyTuSql"/>).</summary>
    public sealed record LegacyRow(int Id, string? Level, int? VerificationStatus, DateTime? CreatedOn, string? InvoiceNo);

    /// <summary>A legacy FA / TU application of the unit (not rejected): its level, when it was made, paid or in progress.</summary>
    public sealed record LegacyClaim(int Id, string? Level, DateTime? CreatedOn, bool Paid, string? InvoiceNo = null)
    {
        public bool InProgress => !Paid;

        public static LegacyClaim Of(LegacyRow r) =>
            new(r.Id, LevelRegistry.Canonical(r.Level) ?? r.Level?.Trim(), r.CreatedOn, r.VerificationStatus == 6, r.InvoiceNo?.Trim());
    }

    /// <summary>Which legacy flow a scheme replaces (its legacy applications count in its claim window).</summary>
    public enum LegacyKind { None, FinancialAssistance, TechnologyUpgradation }

    /// <summary>A certificate of the unit that counts (active phase).</summary>
    public sealed record Certificate(string Level, string CertNo, DateTime? CertifiedOn, string? Phase, int Rank);

    /// <summary>What the rules read about a unit.</summary>
    /// <param name="Benefits">MsmeBasicInformation.IsEligibleForBenefits = 1 (0: the ZED team withdrew all benefits).</param>
    public sealed record UnitFacts(string ZedId, string? Size, string? TwoDigitActivity, bool Benefits, DateTime? RegisteredOn,
        IReadOnlyList<Certificate> Certificates, IReadOnlyList<CertifiedRow> AllCertified, HandholdingRow? Handholding)
    {
        /// <summary>MsmeBasicInformation.IsEligibleForFinancial (0: the ZED team blocked financial assistance; empty = allowed).</summary>
        public bool Financial { get; init; } = true;

        /// <summary>The legacy Financial Assistance applications (read when asked: <see cref="FactsAsync"/> with legacy).</summary>
        public IReadOnlyList<LegacyClaim> LegacyFa { get; init; } = [];

        /// <summary>The legacy (consultant-recommended) Technology Upgradation applications.</summary>
        public IReadOnlyList<LegacyClaim> LegacyTu { get; init; } = [];

        /// <summary>The unit's earlier certificates (before a re-certification of their level).</summary>
        public IReadOnlyList<CertifiedRow> Archived { get; init; } = [];

        /// <summary>The unit's highest active certificate (by the levels' order), or null.</summary>
        public Certificate? Highest => Certificates.OrderByDescending(c => c.Rank).ThenByDescending(c => c.CertifiedOn).FirstOrDefault();

        /// <summary>
        /// A suspended or withdrawn certificate above the highest active one (2026-11-20: then no window opens, even though a
        /// lower certificate is still active), or null.
        /// </summary>
        public CertifiedRow? HeldAbove
        {
            get
            {
                var top = Highest is { } h ? Rank(h.Level) : -1;
                return AllCertified
                    .Where(c => HoldPhases.Contains(c.Phase?.Trim() ?? "") && LevelRegistry.Canonical(c.Certification) is not null && Rank(c.Certification) > top)
                    .OrderByDescending(c => Rank(c.Certification)).FirstOrDefault();
            }
        }

        public IReadOnlyList<LegacyClaim> Legacy(LegacyKind kind) => kind switch
        {
            LegacyKind.FinancialAssistance => LegacyFa,
            LegacyKind.TechnologyUpgradation => LegacyTu,
            _ => [],
        };
    }

    /// <summary>The claim a unit may make now: the level, the certificate it belongs to, the date it opened and the grade.</summary>
    public sealed record ClaimWindow(string Level, string CertRef, DateTime? OpenedOn, SchemeGrade? Grade);

    /// <summary>
    /// The unit's facts. <paramref name="financial"/>: MsmeBasicInformation.IsEligibleForFinancial (the staff side, which reads
    /// the facts for the grade only, leaves it true). <paramref name="legacy"/>: also read the legacy FA / TU applications and the
    /// earlier certificates (the applicant side); a database that cannot be read leaves them empty (logged).
    /// </summary>
    public static async Task<UnitFacts> FactsAsync(ISqlExecutor db, string zedId, bool benefits, ILogger log, CancellationToken ct,
        bool financial = true, bool legacy = false)
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
        var facts = new UnitFacts(zedId, Size(unit?.EnterpriseType), unit?.TwoDigitActivity, benefits, unit?.RegisteredOn, certificates, certified, hh)
        {
            Financial = financial,
        };
        if (!legacy) return facts;
        return facts with
        {
            LegacyFa = (await ReadAsync<LegacyRow>(db, LegacyFaSql, new { ZedId = Ansi(zedId) }, "legacy Financial Assistance", zedId, log, ct)).Select(LegacyClaim.Of).ToList(),
            LegacyTu = (await ReadAsync<LegacyRow>(db, LegacyTuSql, new { ZedId = Ansi(zedId) }, "legacy Technology Upgradation", zedId, log, ct)).Select(LegacyClaim.Of).ToList(),
            Archived = await ReadAsync<CertifiedRow>(db, ArchivedSql, new { Archived = new Dapper.DbString { Value = ArchivedPattern(zedId), IsAnsi = true, Length = 60 } },
                "earlier certificates", zedId, log, ct),
        };
    }

    /// <summary>The LIKE pattern of a unit's earlier certificates ("{ZedId}_R_{Id}"; _ escaped).</summary>
    public static string ArchivedPattern(string zedId) => zedId.Replace("[", "[[]").Replace("%", "[%]").Replace("_", "[_]") + "[_]R[_]%";

    private static async Task<IReadOnlyList<T>> ReadAsync<T>(ISqlExecutor db, string sql, object args, string what, string zedId, ILogger log, CancellationToken ct)
    {
        try
        {
            return await db.QuerySqlAsync<T>(sql, args, ct);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "The {What} of {ZedId} could not be read", what, zedId);
            return [];
        }
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
    /// reason it cannot (<paramref name="locked"/>: "notEligible" (no benefits), "financialBlocked" (IsEligibleForFinancial = 0),
    /// "notCertified", "suspended" (the highest certificate is suspended / withdrawn), "levelNotCovered", "handholding").
    /// </summary>
    public static ClaimWindow? Window(SchemeActivation activation, SchemeGrading? grading, UnitFacts unit, out string? locked)
    {
        locked = null;
        if (!unit.Benefits) { locked = "notEligible"; return null; }
        if (!unit.Financial) { locked = "financialBlocked"; return null; }
        switch (activation.Mode)
        {
            case SchemeRules.Registration:
                return new ClaimWindow(SchemeRules.Registration, unit.ZedId, unit.RegisteredOn, Grade(grading, SchemeRules.Registration, unit));
            case SchemeRules.Handholding:
                if (string.IsNullOrWhiteSpace(unit.Handholding?.Ref)) { locked = "handholding"; return null; }
                return new ClaimWindow(SchemeRules.Handholding, unit.Handholding!.Ref!, unit.Handholding.CompletedOn, Grade(grading, SchemeRules.Handholding, unit));
            default:
                // The highest certificate decides: a lower level's window closes once a higher level is certified, and stays
                // closed while that higher certificate is suspended or withdrawn.
                if (unit.HeldAbove is not null) { locked = "suspended"; return null; }
                var top = unit.Highest;
                if (top is null) { locked = "notCertified"; return null; }
                if (!activation.Levels.Contains(top.Level, StringComparer.OrdinalIgnoreCase)) { locked = "levelNotCovered"; return null; }
                return new ClaimWindow(top.Level, top.CertNo, top.CertifiedOn, Grade(grading, top.Level, unit));
        }
    }

    /// <summary>
    /// Whether a legacy application is the claim of a window (2026-11-20; the legacy rows have the level but no ZED certificate
    /// number): same level, and made for the window's certificate: on or after its date, or before it when the level was never
    /// certified before (a first certificate: e.g. a Technology Upgradation claimed after the handholding, before the
    /// certification). Made before the certificate of a level that was certified earlier (a re-certification) = the earlier
    /// certificate's claim. Only certificate windows are matched (Registration / Handholding windows never).
    /// </summary>
    public static bool LegacyCounts(LegacyClaim claim, ClaimWindow window, UnitFacts unit)
    {
        if (window.Level is SchemeRules.Registration or SchemeRules.Handholding) return false;
        if (!string.Equals(claim.Level, window.Level, StringComparison.OrdinalIgnoreCase)) return false;
        if (window.OpenedOn is not { } opened || claim.CreatedOn is not { } made || made >= opened.Date) return true;
        return !unit.Archived.Any(a => string.Equals(LevelRegistry.Canonical(a.Certification), window.Level, StringComparison.OrdinalIgnoreCase)
                                       && (a.CertifiedOn is null || a.CertifiedOn < opened));
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
