using System.Text.Json;
using Zed.Core.Data;

namespace Zed.Portal.Features.Incentives;

/// <summary>
/// A scheme application: a dbo.FinancialAssistance row with SchemeCode (migration 0105; CertificationType = SchemeCode, so the
/// Financial Assistance procedures that read Bronze / Silver / Gold never see it). The flow follows the assessment
/// (2026-11-20, approved): <see cref="Draft"/> → <see cref="Submitted"/> (waiting for an agency) → <see cref="WithAgency"/> →
/// <see cref="WithAssessor"/> → <see cref="Verifying"/> ⇄ <see cref="Correction"/> (rounds) → <see cref="Qc"/> (agency) →
/// <see cref="Approved"/> (NEFT lists it: VerificationStatus 4) → <see cref="Paid"/> (the NEFT page sets VerificationStatus 6);
/// <see cref="Rejected"/> (the applicant may apply again while the window is open); <see cref="OnHold"/> (the certificate was
/// suspended or withdrawn: the Master Admin resumes or rejects).
/// </summary>
public static class SchemeApplications
{
    public const string Draft = "Draft";
    public const string Submitted = "Submitted";
    public const string WithAgency = "WithAgency";
    public const string WithAssessor = "WithAssessor";
    public const string Verifying = "Verifying";
    public const string Correction = "Correction";
    public const string Qc = "Qc";
    public const string Approved = "Approved";
    public const string Paid = "Paid";
    public const string Rejected = "Rejected";
    public const string OnHold = "OnHold";

    /// <summary>Finished: a new application may follow a rejected one; a paid one closes the claim.</summary>
    public static readonly IReadOnlySet<string> Final = new HashSet<string> { Rejected, Paid };

    /// <summary>FinancialAssistance.VerificationStatus for each status (1 new, 2 in progress, 3 QC, 4 approved, 5 rejected, 6 reimbursed).</summary>
    public static int VerificationStatus(string status) => status switch
    {
        Draft or Submitted or WithAgency => 1,
        WithAssessor or Verifying or Correction or OnHold => 2,
        Qc => 3,
        Approved => 4,
        Rejected => 5,
        Paid => 6,
        _ => 1,
    };

    /// <summary>The status of a row: SchemeStatus, else from VerificationStatus (the NEFT page sets 6 only).</summary>
    public static string StatusOf(Row r) => r.VerificationStatus == 6 ? Paid : r.SchemeStatus ?? Draft;

    public const string Columns =
        "Id, ZedId, SchemeCode, SchemeLevel, SchemeCertNo, SchemeStatus, VerificationStatus, FormAnswers, FormChecks, ClaimAmount, SharePercent, " +
        "MaxAmount, EligibleAmount, ApprovedAmount, CorrectionRound, CorrectionDueOn, SubmittedOn, DecidedOn, HoldReason, CertificationBodyUserId, " +
        "FinancialAssessorId, AssessorAcceptedOn, ReasonForRejection, ReasonForRejectionAgency, AccountNo, IfscCode, BranchAddress, BankName, " +
        "CreatedDate, AllotmentType, AllotmentDate, RejectedAgencies, ApproverAmount, ApproverReferenceNo, ApproverDateOfReceiptOfPayment, Comments";

    /// <summary>The unit's applications of a scheme, newest first.</summary>
    public const string OfUnitSql = "SELECT " + Columns + " FROM dbo.FinancialAssistance WHERE ZedId = @ZedId AND SchemeCode = @SchemeCode ORDER BY Id DESC;";

    /// <summary>All the unit's scheme applications (the dashboard), newest first.</summary>
    public const string AllOfUnitSql = "SELECT " + Columns + " FROM dbo.FinancialAssistance WHERE ZedId = @ZedId AND SchemeCode IS NOT NULL ORDER BY Id DESC;";

    public const string ByIdSql = "SELECT " + Columns + " FROM dbo.FinancialAssistance WHERE Id = @Id AND SchemeCode IS NOT NULL;";

    /// <summary>A new draft (FinancialAssistanceId = Id, as the legacy rows key their documents).</summary>
    public const string InsertDraftSql = """
        INSERT INTO dbo.FinancialAssistance (ZedId, CertificationType, SchemeCode, SchemeLevel, SchemeCertNo, SchemeStatus, VerificationStatus,
            FormAnswers, SharePercent, MaxAmount, CreatedDate, SubmittedFrom)
        VALUES (@ZedId, @SchemeCode, @SchemeCode, @SchemeLevel, @SchemeCertNo, 'Draft', 1, @FormAnswers, @SharePercent, @MaxAmount, GETDATE(), 'Web');
        DECLARE @Id int = CAST(SCOPE_IDENTITY() AS int);
        UPDATE dbo.FinancialAssistance SET FinancialAssistanceId = @Id WHERE Id = @Id;
        SELECT @Id;
        """;

    /// <summary>One application row (the columns of <see cref="Columns"/>).</summary>
    public sealed class Row
    {
        public int Id { get; init; }
        public string? ZedId { get; init; }
        public string? SchemeCode { get; init; }
        public string? SchemeLevel { get; init; }
        public string? SchemeCertNo { get; init; }
        public string? SchemeStatus { get; init; }
        public int? VerificationStatus { get; init; }
        public string? FormAnswers { get; init; }
        public string? FormChecks { get; init; }
        public decimal? ClaimAmount { get; init; }
        public decimal? SharePercent { get; init; }
        public decimal? MaxAmount { get; init; }
        public string? EligibleAmount { get; init; }
        public decimal? ApprovedAmount { get; init; }
        public int? CorrectionRound { get; init; }
        public DateTime? CorrectionDueOn { get; init; }
        public DateTime? SubmittedOn { get; init; }
        public DateTime? DecidedOn { get; init; }
        public string? HoldReason { get; init; }
        public string? CertificationBodyUserId { get; init; }
        public string? FinancialAssessorId { get; init; }
        public DateTime? AssessorAcceptedOn { get; init; }
        public string? ReasonForRejection { get; init; }
        public string? ReasonForRejectionAgency { get; init; }
        public string? AccountNo { get; init; }
        public string? IfscCode { get; init; }
        public string? BranchAddress { get; init; }
        public string? BankName { get; init; }
        public DateTime? CreatedDate { get; init; }
        public string? AllotmentType { get; init; }
        public DateTime? AllotmentDate { get; init; }
        public string? RejectedAgencies { get; init; }
        public decimal? ApproverAmount { get; init; }
        public string? ApproverReferenceNo { get; init; }
        public DateTime? ApproverDateOfReceiptOfPayment { get; init; }
        public string? Comments { get; init; }

        public string Status => StatusOf(this);
        public Incentives.FormAnswers Answers => Incentives.FormAnswers.Parse(FormAnswers);
        public Dictionary<string, FieldCheck> Checks => FieldCheck.Parse(FormChecks);
    }

    public static async Task<IReadOnlyList<Row>> OfUnitAsync(ISqlExecutor db, string zedId, string schemeCode, CancellationToken ct) =>
        await db.QuerySqlAsync<Row>(OfUnitSql, new { ZedId = Ansi(zedId, 50), SchemeCode = Ansi(schemeCode, 40) }, ct);

    public static async Task<Row?> ByIdAsync(ISqlExecutor db, int id, CancellationToken ct) =>
        (await db.QuerySqlAsync<Row>(ByIdSql, new { Id = id }, ct)).FirstOrDefault();

    /// <summary>A path of an answer or document in the form: "{section}/{item}/{field}" (item 0 in a plain section).</summary>
    public static string PathOf(string section, int item, string field) => $"{section}/{item}/{field}";

    public static Dapper.DbString Ansi(string? v, int length) => new() { Value = v, IsAnsi = true, Length = length };
}

/// <summary>
/// The answers of an application (FinancialAssistance.FormAnswers): per section key, its items (one item in a plain section),
/// each with the picked entry (a technology code / an option), the field values and whether the item is saved. A document or
/// photo field's value is a JSON list of stored file names (SchemeUploads, folder "Schemes").
/// </summary>
public sealed record FormAnswers
{
    public Dictionary<string, List<FormItem>> Sections { get; init; } = new();

    public static FormAnswers Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new();
        try { return JsonSerializer.Deserialize<FormAnswers>(json, SchemeRules.Json) ?? new(); }
        catch (JsonException) { return new(); }
    }

    public string Serialize() => JsonSerializer.Serialize(this, SchemeRules.Json);

    /// <summary>The claim: the claim amounts of every saved item.</summary>
    public decimal Claim(SchemeForm form)
    {
        decimal total = 0;
        foreach (var s in form.Sections)
        {
            var claimKeys = s.Fields.Where(f => f.IsClaim).Select(f => f.Key).ToList();
            if (claimKeys.Count == 0 || !Sections.TryGetValue(s.Key, out var items)) continue;
            foreach (var item in items.Where(i => i.Saved || !s.Repeating))
                foreach (var k in claimKeys)
                    if (decimal.TryParse(item.Values.GetValueOrDefault(k), System.Globalization.NumberStyles.Number, System.Globalization.CultureInfo.InvariantCulture, out var v))
                        total += v;
        }
        return total;
    }
}

public sealed record FormItem
{
    public string? Pick { get; init; }
    public string? PickName { get; init; }
    public Dictionary<string, string?> Values { get; init; } = new();
    public bool Saved { get; init; }
}

/// <summary>
/// The assessor's check of one answer or document (FinancialAssistance.FormChecks, keyed by <see cref="SchemeApplications.PathOf"/>):
/// "Yes" (valid) or "No" (not valid, with the remark the applicant corrects), the correction round and who checked when.
/// </summary>
public sealed record FieldCheck(string Status, string? Remarks, int Round, string? By, DateTime? On)
{
    public static Dictionary<string, FieldCheck> Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new();
        try { return JsonSerializer.Deserialize<Dictionary<string, FieldCheck>>(json, SchemeRules.Json) ?? new(); }
        catch (JsonException) { return new(); }
    }

    public static string Serialize(Dictionary<string, FieldCheck> checks) => JsonSerializer.Serialize(checks, SchemeRules.Json);
}
