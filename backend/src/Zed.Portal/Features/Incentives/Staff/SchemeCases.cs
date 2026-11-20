using System.Globalization;
using Zed.Core.Data;
using Zed.Portal.Features.Staff.Schemes;
using static Zed.Portal.Features.Incentives.SchemeApplications;

namespace Zed.Portal.Features.Incentives.Staff;

/// <summary>
/// Serialises the staff side's changes of scheme applications (allotment, accept, checks, decisions, the sweep), so a double
/// click or two people acting at once cannot both pass the "current status" check. Every save is also conditional on the status
/// read (<see cref="SchemeCases.SaveSql"/>), so a change made elsewhere (the applicant answering a correction) is never
/// overwritten. Single API server, as <see cref="SchemeLocks"/>.
/// </summary>
internal static class SchemeCaseLock
{
    private static readonly SemaphoreSlim Gate = new(1, 1);

    public static async Task<IDisposable> EnterAsync(CancellationToken ct)
    {
        await Gate.WaitAsync(ct);
        return new Releaser();
    }

    private sealed class Releaser : IDisposable
    {
        private int _done;
        public void Dispose() { if (Interlocked.Exchange(ref _done, 1) == 0) Gate.Release(); }
    }
}

/// <summary>
/// The workflow columns of one scheme application as the staff side changes them (read from <see cref="Row"/>, written back in
/// one statement, <see cref="SchemeCases.SaveSql"/>, only while the row still has the status it was read with).
/// </summary>
internal sealed class SchemeCase
{
    public required Row Row { get; init; }
    /// <summary>The SchemeStatus the row was read with (the save's condition).</summary>
    public required string Expected { get; init; }

    public string Status { get; set; } = Draft;
    public string? FormChecks { get; set; }
    public string? EligibleAmount { get; set; }
    public decimal? ApprovedAmount { get; set; }
    public int? CorrectionRound { get; set; }
    public DateTime? CorrectionDueOn { get; set; }
    public DateTime? DecidedOn { get; set; }
    public string? HoldReason { get; set; }
    public string? Agency { get; set; }
    public string? Assessor { get; set; }
    public DateTime? AssessorAcceptedOn { get; set; }
    public string? ReasonForRejection { get; set; }
    public string? ReasonForRejectionAgency { get; set; }
    public string? AllotmentType { get; set; }
    public DateTime? AllotmentDate { get; set; }
    public string? RejectedAgencies { get; set; }
    // Phase 2 (migration 0106): the onsite agency and assessor of the Desktop + Onsite flow.
    public string? OnsiteAgency { get; set; }
    public string? OnsiteAssessor { get; set; }
    public string? OnsiteAllotmentType { get; set; }
    public DateTime? OnsiteAllotmentDate { get; set; }
    public string? OnsiteRejectedAgencies { get; set; }

    public int Id => Row.Id;
    public string ZedId => Row.ZedId?.Trim() ?? "";
    public string Code => Row.SchemeCode?.Trim() ?? "";

    public static SchemeCase From(Row r) => new()
    {
        Row = r,
        Expected = r.SchemeStatus ?? Draft,
        Status = r.Status,
        FormChecks = r.FormChecks,
        EligibleAmount = r.EligibleAmount,
        ApprovedAmount = r.ApprovedAmount,
        CorrectionRound = r.CorrectionRound,
        CorrectionDueOn = r.CorrectionDueOn,
        DecidedOn = r.DecidedOn,
        HoldReason = r.HoldReason,
        Agency = Blank(r.CertificationBodyUserId),
        Assessor = Blank(r.FinancialAssessorId),
        AssessorAcceptedOn = r.AssessorAcceptedOn,
        ReasonForRejection = r.ReasonForRejection,
        ReasonForRejectionAgency = r.ReasonForRejectionAgency,
        AllotmentType = r.AllotmentType,
        AllotmentDate = r.AllotmentDate,
        RejectedAgencies = r.RejectedAgencies,
        OnsiteAgency = Blank(r.OnsiteAgencyId),
        OnsiteAssessor = Blank(r.OnsiteAssessorId),
        OnsiteAllotmentType = r.OnsiteAllotmentType,
        OnsiteAllotmentDate = r.OnsiteAllotmentDate,
        OnsiteRejectedAgencies = r.OnsiteRejectedAgencies,
    };

    public Dictionary<string, FieldCheck> Checks => FieldCheck.Parse(FormChecks);

    /// <summary>The agencies that returned the application (never offered it again by the round robin).</summary>
    public HashSet<string> Rejected => (RejectedAgencies ?? "").Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
        .ToHashSet(StringComparer.OrdinalIgnoreCase);

    public void AddRejected(string agency)
    {
        var set = Rejected;
        if (!set.Add(agency.Trim())) return;
        var text = string.Join(',', set);
        RejectedAgencies = text.Length <= 2000 ? text : text[^2000..];
    }

    /// <summary>The onsite agencies that rejected the application (never offered it again by the onsite round robin).</summary>
    public HashSet<string> OnsiteRejected => (OnsiteRejectedAgencies ?? "").Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
        .ToHashSet(StringComparer.OrdinalIgnoreCase);

    public void AddOnsiteRejected(string agency)
    {
        var set = OnsiteRejected;
        if (!set.Add(agency.Trim())) return;
        var text = string.Join(',', set);
        OnsiteRejectedAgencies = text.Length <= 2000 ? text : text[^2000..];
    }

    /// <summary>In the onsite stage of the Desktop + Onsite flow (waiting for or with the onsite agency, its assessor or its QC).</summary>
    public bool OnsiteStage => Status is OnsiteAllot or OnsiteWithAgency or OnsiteWithAssessor or OnsiteVisit || (Status == Qc && OnsiteAgency is not null);

    public static string? Blank(string? v) => string.IsNullOrWhiteSpace(v) ? null : v.Trim();
}

/// <summary>Reads and saves scheme applications for the staff side; the contacts of units and staff.</summary>
internal static class SchemeCases
{
    public const string SaveSql = """
        UPDATE dbo.FinancialAssistance SET SchemeStatus = @SchemeStatus, VerificationStatus = @VerificationStatus, FormChecks = @FormChecks,
            EligibleAmount = @EligibleAmount, ApprovedAmount = @ApprovedAmount, CorrectionRound = @CorrectionRound, CorrectionDueOn = @CorrectionDueOn,
            DecidedOn = @DecidedOn, HoldReason = @HoldReason, CertificationBodyUserId = @CertificationBodyUserId, FinancialAssessorId = @FinancialAssessorId,
            AssessorAcceptedOn = @AssessorAcceptedOn, ReasonForRejection = @ReasonForRejection, ReasonForRejectionAgency = @ReasonForRejectionAgency,
            AllotmentType = @AllotmentType, AllotmentDate = @AllotmentDate, RejectedAgencies = @RejectedAgencies,
            OnsiteAgencyId = @OnsiteAgencyId, OnsiteAssessorId = @OnsiteAssessorId, OnsiteAllotmentType = @OnsiteAllotmentType,
            OnsiteAllotmentDate = @OnsiteAllotmentDate, OnsiteRejectedAgencies = @OnsiteRejectedAgencies
        WHERE Id = @Id AND SchemeCode IS NOT NULL AND ISNULL(SchemeStatus, 'Draft') = @Expected AND ISNULL(VerificationStatus, 0) <> 6;
        """;

    public const string UnitSql = "SELECT TOP 1 EnterpriseName, EmailId, PUnitName, PAddress, PCity, PStateName FROM dbo.Msme WHERE ZedId = @ZedId;";

    public const string UserSql = "SELECT TOP 1 UserId, UserName, Email, MobileNo, RoleId, IsActive, CreatedBy, SchemeVerification, AgencyKind FROM dbo.Users WHERE UserId = @UserId;";

    public const string HistorySql =
        "SELECT TOP 100 Descrip, CreatedDate FROM dbo.MsmeHistory WHERE ZedId = @ZedId AND CertificationType = @Code ORDER BY CreatedDate DESC;";

    public sealed class UnitRow
    {
        public string? EnterpriseName { get; init; }
        public string? EmailId { get; init; }
        public string? PUnitName { get; init; }
        public string? PAddress { get; init; }
        public string? PCity { get; init; }
        public string? PStateName { get; init; }

        public string Name => (EnterpriseName ?? PUnitName ?? "").Trim();
        public string Address => string.Join(", ", new[] { PAddress, PCity, PStateName }.Where(s => !string.IsNullOrWhiteSpace(s)).Select(s => s!.Trim()));
    }

    public sealed class UserRow
    {
        public string? UserId { get; init; }
        public string? UserName { get; init; }
        public string? Email { get; init; }
        public string? MobileNo { get; init; }
        public int? RoleId { get; init; }
        public bool? IsActive { get; init; }
        public string? CreatedBy { get; init; }
        public string? SchemeVerification { get; init; }
        /// <summary>Migration 0106 / 0107: 'SchemeOnsite' / 'SchemeDesktop' for an incentive verification agency.</summary>
        public string? AgencyKind { get; init; }

        public bool IsOnsiteAgency => RoleId == 2 && Agencies.IncentiveAgencies.IsOnsite(AgencyKind);
        public bool IsDesktopAgency => RoleId == 2 && Agencies.IncentiveAgencies.IsDesktop(AgencyKind);
    }

    public sealed class HistoryRow
    {
        public string? Descrip { get; init; }
        public DateTime? CreatedDate { get; init; }
    }

    /// <summary>The case with its onsite columns (migration 0106).</summary>
    public static async Task<SchemeCase?> LoadAsync(ISqlExecutor db, int id, CancellationToken ct) =>
        (await db.QuerySqlAsync<Row>(ByIdWithOnsiteSql, new { Id = id }, ct)).FirstOrDefault() is { } r ? SchemeCase.From(r) : null;

    /// <summary>Writes the case; false when the row changed meanwhile (another status) or is gone.</summary>
    public static async Task<bool> SaveAsync(ISqlExecutor db, SchemeCase c, CancellationToken ct)
    {
        var n = await db.ExecuteSqlAsync(SaveSql, new
        {
            c.Id,
            SchemeStatus = c.Status,
            VerificationStatus = SchemeApplications.VerificationStatus(c.Status),
            c.FormChecks,
            c.EligibleAmount,
            c.ApprovedAmount,
            c.CorrectionRound,
            c.CorrectionDueOn,
            c.DecidedOn,
            HoldReason = Cut(c.HoldReason, 500),
            CertificationBodyUserId = c.Agency,
            FinancialAssessorId = c.Assessor,
            c.AssessorAcceptedOn,
            ReasonForRejection = Cut(c.ReasonForRejection, 2000),
            ReasonForRejectionAgency = Cut(c.ReasonForRejectionAgency, 5000),
            c.AllotmentType,
            c.AllotmentDate,
            c.RejectedAgencies,
            OnsiteAgencyId = c.OnsiteAgency,
            OnsiteAssessorId = c.OnsiteAssessor,
            c.OnsiteAllotmentType,
            c.OnsiteAllotmentDate,
            c.OnsiteRejectedAgencies,
            c.Expected,
        }, ct);
        return n > 0;
    }

    public static async Task<UnitRow?> UnitAsync(ISqlExecutor db, string zedId, CancellationToken ct) =>
        (await db.QuerySqlAsync<UnitRow>(UnitSql, new { ZedId = Ansi(zedId, 50) }, ct)).FirstOrDefault();

    public static async Task<UserRow?> UserAsync(ISqlExecutor db, string? userId, CancellationToken ct) =>
        string.IsNullOrWhiteSpace(userId) ? null : (await db.QuerySqlAsync<UserRow>(UserSql, new { UserId = Ansi(userId.Trim(), 50) }, ct)).FirstOrDefault();

    /// <summary>The staff side's history entry (MsmeHistory, CertificationType = the scheme code), as the FA pages record theirs.</summary>
    public static Task HistoryAsync(ISqlExecutor db, ILogger log, SchemeCase c, string text, CancellationToken ct) =>
        SchemeRows.AuditAsync(db, log, c.ZedId, c.Code, text, ct);

    public static string Money(decimal v) => v.ToString("0.00", CultureInfo.InvariantCulture);

    public static decimal? ParseMoney(string? v) =>
        decimal.TryParse(v, NumberStyles.Number, CultureInfo.InvariantCulture, out var d) ? d : null;

    private static string? Cut(string? v, int max) => v is null ? null : v.Length <= max ? v : v[..max];
}

/// <summary>
/// Users.SchemeVerification (migration 0105): the schemes an agency or assessor verifies, "CODE:D" (desktop verification) and
/// "CODE:O" (onsite verification, phase 2), comma-separated.
/// </summary>
public static class SchemeTicks
{
    public const string Desktop = "D";
    public const string Onsite = "O";
    public const int MaxLength = 2000;

    public static HashSet<string> Parse(string? value) =>
        (value ?? "").Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
            .Select(t => t.ToUpperInvariant()).ToHashSet(StringComparer.OrdinalIgnoreCase);

    public static bool Has(string? value, string code, string kind) => Parse(value).Contains($"{code.Trim().ToUpperInvariant()}:{kind}");

    /// <summary>The value with the ticks of <paramref name="codes"/> replaced by <paramref name="ticks"/> (others kept as they are).</summary>
    public static string? Replace(string? existing, IReadOnlyCollection<string> codes, IEnumerable<string> ticks)
    {
        var known = codes.Select(c => c.ToUpperInvariant()).ToHashSet();
        var kept = Parse(existing).Where(t => !known.Contains(t.Split(':')[0]));
        var all = kept.Concat(ticks.Select(t => t.ToUpperInvariant())).Distinct(StringComparer.OrdinalIgnoreCase).Order(StringComparer.Ordinal).ToList();
        return all.Count == 0 ? null : string.Join(',', all);
    }
}
