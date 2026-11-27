using System.Text.RegularExpressions;
using Dapper;
using Zed.Core.Data;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Assessment;

/// <summary>Input checks shared by the desktop-assessment endpoints.</summary>
public static partial class AssessmentInput
{
    /// <summary>ZED IDs (ZEDMSME000123, or ZEDMSME000123_D_45 for a rejected record) and user ids.</summary>
    [GeneratedRegex(@"^[A-Za-z0-9_]{1,50}$")]
    private static partial Regex IdPattern();

    public static bool IsId(string? value) => value is not null && IdPattern().IsMatch(value);

    /// <summary>Certification levels of a desktop assessment (MsmeCertifications.Certification).</summary>
    /// <remarks>Every level of Administration → Certification Levels (Zed.Core.Data.LevelRegistry; ZEDX = ZED-X; 2026-11-08 also the levels the Admin adds).</remarks>
    public static string[] Levels => [.. Zed.Core.Data.LevelRegistry.Codes];

    /// <summary>"bronze" → "Bronze"; null when not a level.</summary>
    public static string? Level(string? value) =>
        Levels.FirstOrDefault(l => string.Equals(l, value?.Trim(), StringComparison.OrdinalIgnoreCase));

    public static readonly string[] Sizes = ["Micro", "Small", "Medium"];
    public static readonly string[] Genders = ["male", "female", "Others"];

    /// <summary>A filter value from a fixed list (canonical spelling), null for "show all", or false when invalid.</summary>
    public static bool Filter(string? value, string[] allowed, out string? canonical)
    {
        canonical = null;
        if (string.IsNullOrWhiteSpace(value)) return true;
        canonical = allowed.FirstOrDefault(a => string.Equals(a, value.Trim(), StringComparison.OrdinalIgnoreCase));
        return canonical is not null;
    }

    /// <summary>State filter: LG state code (1..99) or empty.</summary>
    public static bool State(string? value, out string? state)
    {
        state = null;
        if (string.IsNullOrWhiteSpace(value)) return true;
        if (!int.TryParse(value.Trim(), out var n) || n < 1 || n > 99) return false;
        state = n.ToString(System.Globalization.CultureInfo.InvariantCulture);
        return true;
    }

    /// <summary>"Yes" / "No" answers of the validation pop-ups.</summary>
    public static string? YesNo(string? value) =>
        string.Equals(value?.Trim(), "Yes", StringComparison.OrdinalIgnoreCase) ? "Yes"
        : string.Equals(value?.Trim(), "No", StringComparison.OrdinalIgnoreCase) ? "No" : null;

    /// <summary>Trimmed text, or null when empty.</summary>
    public static string? Text(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    /// <summary>
    /// The MSME's own ZED ID of a rejected copy of a certification record
    /// (ZEDMSME000123_D_45 / ZEDMSME000123_R_45 / ZEDMSME000123_D → ZEDMSME000123).
    /// </summary>
    public static string BaseZedId(string zedId)
    {
        var i = zedId.IndexOf('_', StringComparison.Ordinal);
        return i > 0 ? zedId[..i] : zedId;
    }

    /// <summary>varchar parameter (the tables use varchar; nvarchar parameters would defeat the indexes).</summary>
    public static DbString Ansi(string? value, int length = 50) => new() { Value = value, IsAnsi = true, Length = length };
}

/// <summary>
/// The allotment columns of one MsmeCertifications row (who may see and assess it, and its stage).
/// The legacy update procedures do not check who calls them, so every write is checked against this row.
/// </summary>
public sealed class CertificationRecord
{
    public string? ZedId { get; init; }
    public string? Certification { get; init; }
    public int? CertificationStatus { get; init; }
    public int? NcCount { get; init; }
    public int? NcStatus { get; init; }
    public int? Nc1Status { get; init; }
    public int? Nc2Status { get; init; }
    public int? Nc3Status { get; init; }
    public int? Nc4Status { get; init; }
    public int? Nc5Status { get; init; }
    public string? DesktopAssessorId { get; init; }
    public bool? DesktopAccepted { get; init; }
    public string? DesktopReasonForRejection { get; init; }
    public string? CertificationBodyUserId { get; init; }
    public string? SiteAssessorId { get; init; }
    public string? CoAssessorId { get; init; }
    /// <summary>Set by the NC closure job when the MSME let the NC final closure date pass (status 7/17, NcCount 6).</summary>
    public bool? IsAutoReject { get; init; }
    /// <summary>The desktop certificate number (certified at the desktop, status 6) and the site one (after a visit, 16).</summary>
    public string? DaCertificateNo { get; init; }
    public string? SaCertificateNo { get; init; }
    /// <summary>ACTIVE, UPGRADED, EXPIRED ...: set by certification only (NULL while waiting).</summary>
    public string? CertificationPhase { get; init; }
    /// <summary>2026-11-27: the flow the case started with (main only, migration 0117; NULL = the level's flow).</summary>
    public string? AssessmentFlow { get; init; }

    /// <summary>The case is certified at the desktop: its own flow is Desktop only (else its level's, <see cref="CertLevels.CaseFlows"/>).</summary>
    public bool DesktopOnly => CertLevels.CaseFlows.IsDesktop(AssessmentFlow, Certification);

    /// <summary>2026-11-15: certified, whatever the level's flow (status 6 with its desktop number, or 16 with its site number).</summary>
    public bool IsCertified => Documents.DocumentLevels.IsCertifiedRecord(CertificationStatus, DaCertificateNo, CertificationPhase);

    /// <summary>Certified at the desktop (else after a visit); null while not certified.</summary>
    public bool? CertifiedAtDesktop => IsCertified ? Status == Documents.DocumentLevels.BronzeCertified : null;

    public int Status => CertificationStatus ?? 0;
    public int Nc => NcCount ?? 0;

    /// <summary>Status of the current NC round (Nc{NcCount}Status: 1 raised, 2 submitted by the MSME).</summary>
    public int CurrentNcStatus => Nc switch
    {
        1 => Nc1Status ?? 0, 2 => Nc2Status ?? 0, 3 => Nc3Status ?? 0, 4 => Nc4Status ?? 0, 5 => Nc5Status ?? 0, _ => 0,
    };

    private static bool Is(string? column, string userId) =>
        !string.IsNullOrEmpty(column) && string.Equals(column.Trim(), userId, StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Same rule as SP_ASSESSMENT_DA_DETAILS: master admin, super admin, ministry, citizen feedback and QC
    /// see every record; an agency the records allotted to it; an assessor the records it is desktop,
    /// site or co-assessor of.
    /// </summary>
    public bool CanView(ZedUser user) => (UserRole)user.RoleId switch
    {
        UserRole.MasterAdmin or UserRole.SuperAdmin or UserRole.Ministry or UserRole.CitizenFeedback or UserRole.QC => true,
        UserRole.Agency => Is(CertificationBodyUserId, user.UserId),
        UserRole.DesktopAssessor => Is(DesktopAssessorId, user.UserId) || Is(SiteAssessorId, user.UserId) || Is(CoAssessorId, user.UserId),
        _ => false,
    };

    /// <summary>The user is the desktop assessor of this record and accepted it.</summary>
    public bool IsDesktopAssessor(ZedUser user) =>
        user.RoleId == (int)UserRole.DesktopAssessor && Is(DesktopAssessorId, user.UserId) && DesktopAccepted == true &&
        string.IsNullOrEmpty(DesktopReasonForRejection);

    /// <summary>
    /// Desktop verification is open: before the first final submit (status 2/3), or an NC round the MSME
    /// has answered (status 4 with Nc{n}Status 2), as on the old page (Edit buttons: status &lt; 4 or
    /// status 4 in the current NC round; Final Submit: status 3, or status 4 with Nc{n}Status 2).
    /// </summary>
    public bool IsOpenForDesktopAssessment =>
        Status is 2 or 3 || (Status == 4 && Nc is >= 1 and <= 5 && CurrentNcStatus == 2);

    public bool CanAssess(ZedUser user) => IsDesktopAssessor(user) && IsOpenForDesktopAssessment;

    /// <summary>Final Submit button of the old page.</summary>
    public bool CanFinalSubmit(ZedUser user) =>
        IsDesktopAssessor(user) && (Status == 3 || (Status == 4 && Nc is >= 1 and <= 5 && CurrentNcStatus == 2));
}

/// <summary>Look-ups used to check that ids sent by the browser belong to the record being assessed.</summary>
public static class AssessmentRecords
{
    public const string CertificationSql =
        "SELECT TOP 1 ZedId, Certification, CertificationStatus, NcCount, NcStatus, Nc1Status, Nc2Status, Nc3Status, Nc4Status, Nc5Status, " +
        "DesktopAssessorId, DesktopAccepted, DesktopReasonForRejection, CertificationBodyUserId, SiteAssessorId, CoAssessorId, IsAutoReject, " +
        "DaCertificateNo, SaCertificateNo, CertificationPhase, AssessmentFlow " +
        "FROM MsmeCertifications WHERE ZedId = @ZedId AND Certification = @Certification";

    /// <summary><see cref="CertificationSql"/> before migration 0117 (no MsmeCertifications.AssessmentFlow: the level's flow applies).</summary>
    internal static readonly string CertificationSqlWithoutFlow = CertificationSql.Replace(", AssessmentFlow ", " ");

    /// <summary>
    /// <see cref="CertificationSql"/> for ZED_CONSULTANT and ZED_SURVEILLANCE, whose MsmeCertifications has no
    /// CertificationPhase (main's only): their records are read without it. 2026-11-16: these keep a row per milestone /
    /// round (a payment adds one and disables the open ones), so the live row added last is the record (milestone 2's
    /// report answered "not available": TOP 1 without an order gave milestone 1's row).
    /// </summary>
    internal const string CertificationSqlWithoutPhase =
        "SELECT TOP 1 ZedId, Certification, CertificationStatus, NcCount, NcStatus, Nc1Status, Nc2Status, Nc3Status, Nc4Status, Nc5Status, " +
        "DesktopAssessorId, DesktopAccepted, DesktopReasonForRejection, CertificationBodyUserId, SiteAssessorId, CoAssessorId, IsAutoReject, " +
        "DaCertificateNo, SaCertificateNo " +
        "FROM MsmeCertifications WHERE ZedId = @ZedId AND Certification = @Certification " +
        "ORDER BY CASE WHEN IdDisabled IS NULL THEN 0 ELSE 1 END, Id DESC";

    /// <summary>The databases (one executor each) found without CertificationPhase: asked without it from then on.</summary>
    private static readonly System.Runtime.CompilerServices.ConditionalWeakTable<ISqlExecutor, object> NoPhase = new();

    public const string RequirementSql =
        "SELECT TOP 1 CAST(Id AS bigint) AS Id, NcCount FROM MsmeRequirements WHERE Id = @Id AND ZedId = @ZedId AND SectionType = @Certification";

    public const string EvidenceSql =
        "SELECT TOP 1 CAST(Id AS bigint) AS Id, NcCount, SectionCode, RequirementCode, EvidenceCode, ValidationRequired FROM MsmeEvidences " +
        "WHERE Id = @Id AND ZedId = @ZedId AND SectionType = @Certification";

    public const string ProductSql =
        "SELECT TOP 1 CAST(Id AS bigint) AS Id, NcCount FROM MsmeProducts WHERE Id = @Id AND ZedId = @ZedId AND Certification = @Certification";

    public const string SectionSql =
        "SELECT TOP 1 CAST(Id AS bigint) AS Id, NcCount, IsAssessmentExcempted FROM MsmeSections WHERE Id = @Id AND ZedId = @ZedId AND SectionType = @Certification";

    public const string SiteExteriorPhotoSql =
        "SELECT TOP 1 CAST(Id AS bigint) AS Id, NcCount FROM MsmePhotos WHERE Id = @Id AND ZedId = @ZedId AND Certification = @Certification AND PhotoType = 'SiteExteriorPhotos'";

    public sealed class Item
    {
        public long Id { get; init; }
        public int? NcCount { get; init; }
        public string? SectionCode { get; init; }
        public string? RequirementCode { get; init; }
        public string? EvidenceCode { get; init; }
        public bool? ValidationRequired { get; init; }
        public string? IsAssessmentExcempted { get; init; }
    }

    public static async Task<CertificationRecord?> CertificationAsync(ISqlExecutor db, string zedId, string certification, CancellationToken ct)
    {
        var args = new { ZedId = AssessmentInput.Ansi(zedId), Certification = AssessmentInput.Ansi(certification) };
        if (!NoPhase.TryGetValue(db, out _))
        {
            try
            {
                return (await db.QuerySqlAsync<CertificationRecord>(CertificationSql, args, ct)).FirstOrDefault();
            }
            catch (Microsoft.Data.SqlClient.SqlException ex) when (ex.Number == 207)
            {
                // Invalid column: ZED_CONSULTANT / ZED_SURVEILLANCE have no CertificationPhase (2026-11-15), nor AssessmentFlow;
                // main before migration 0117 has no AssessmentFlow.
                try
                {
                    return (await db.QuerySqlAsync<CertificationRecord>(CertificationSqlWithoutFlow, args, ct)).FirstOrDefault();
                }
                catch (Microsoft.Data.SqlClient.SqlException ex2) when (ex2.Number == 207)
                {
                    NoPhase.AddOrUpdate(db, new object());
                }
            }
        }
        return (await db.QuerySqlAsync<CertificationRecord>(CertificationSqlWithoutPhase, args, ct)).FirstOrDefault();
    }

    public static async Task<Item?> ItemAsync(ISqlExecutor db, string sql, long id, string zedId, string certification, CancellationToken ct) =>
        (await db.QuerySqlAsync<Item>(sql,
            new { Id = id, ZedId = AssessmentInput.Ansi(zedId), Certification = AssessmentInput.Ansi(certification) }, ct)).FirstOrDefault();
}
