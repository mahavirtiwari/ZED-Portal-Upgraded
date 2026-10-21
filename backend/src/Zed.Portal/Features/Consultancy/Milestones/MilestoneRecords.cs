using Zed.Core.Data;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.Assessment;

namespace Zed.Portal.Features.Consultancy.Milestones;

/// <summary>
/// MsmeCertifications.CertificationStatus values of a handholding milestone in ZED_CONSULTANT (one row per
/// milestone; NcCount is the milestone number 1..3).
/// </summary>
public static class MilestoneStatus
{
    /// <summary>Allotted to a CO, waiting for its acceptance.</summary>
    public const int AllottedToCo = 8;
    /// <summary>Accepted by the CO, lead consultant and co-consultants allotted (SP_ASSESSMENT_ACCEPT_UNIT_FOR_SA).</summary>
    public const int ConsultantsAllotted = 9;
    /// <summary>The consultant opened the meeting in the app, or the CO sent the milestone back.</summary>
    public const int InProgress = 13;
    /// <summary>The lead consultant's final submit (SP_ASSESSMENT_RA_FINAL_SUBMIT): the CO reviews.</summary>
    public const int CoReview = 15;
    /// <summary>The CO completed the milestone (SP_MONITORING_RA_FINAL_SUBMIT); the MSME accepts it on main (→ 100).</summary>
    public const int Completed = 16;
    public const int Rejected = 99;

    public static readonly int[] ConsultantEditable = [ConsultantsAllotted, InProgress];
}

/// <summary>The current milestone row of a unit (highest NcCount) with its allotment.</summary>
public sealed class MilestoneRecord
{
    public long Id { get; init; }
    public string? ZedId { get; init; }
    public string? Certification { get; init; }
    public int? CertificationStatus { get; init; }
    public int? NcCount { get; init; }
    public string? CertificationBodyUserId { get; init; }
    public string? SiteAssessorId { get; init; }
    /// <summary>CSV of co-consultant ids (the LIKE match on it is SECURITY-FINDINGS #93; only AllotedCoAssessors is used here).</summary>
    public string? CoAssessorId { get; init; }
    public string? TechExpert { get; init; }

    public int Status => CertificationStatus ?? 0;
    public int Milestone => NcCount ?? 0;
}

public sealed class CoConsultantRow
{
    public string? CoAssessorId { get; init; }
    public int? WebFinalSubmitStatus { get; init; }
    public DateTime? WebFinalSubmitDate { get; init; }
}

public sealed class MilestoneItem
{
    public long Id { get; init; }
    public int? NcCount { get; init; }
    public string? SectionCode { get; init; }
    public string? RequirementId { get; init; }
    public string? ReqType { get; init; }
    public string? TrainingType { get; init; }
    public string? AssessorId { get; init; }
}

/// <summary>What the signed-in user is for the unit's current milestone.</summary>
public enum MilestoneParty { None, Viewer, Lead, CoConsultant, Co }

/// <summary>
/// The unit, its current milestone and the user's part in it, read before every read and write. The legacy
/// procedures check nothing (UpdateColumnData, SECURITY-FINDINGS #86) or match co-consultants with LIKE on a
/// CSV (#93); here the user is matched by exact id against SiteAssessorId (lead), AllotedCoAssessors of the
/// milestone (co-consultants) and CertificationBodyUserId (the Consultant Organisation).
/// </summary>
public sealed class MilestoneContext
{
    public const string RecordSql =
        "SELECT TOP 1 CAST(Id AS bigint) AS Id, ZedId, Certification, CertificationStatus, NcCount, CertificationBodyUserId, " +
        "SiteAssessorId, CoAssessorId, TechExpert FROM MsmeCertifications WHERE ZedId = @ZedId AND Certification = @Certification " +
        "ORDER BY NcCount DESC, Id DESC";

    public const string CoConsultantsSql =
        "SELECT CoAssessorId, WebFinalSubmitStatus, WebFinalSubmitDate FROM AllotedCoAssessors " +
        "WHERE ZedId = @ZedId AND Certification = @Certification AND NcCount = @NcCount";

    /// <summary>Sections of the milestone allotted to a consultant (MsmeSections.AssessorId, equality, not LIKE).</summary>
    public const string OwnSectionsSql =
        "SELECT SectionCode FROM MsmeSections WHERE ZedId = @ZedId AND SectionType = @Certification AND NcCount = @NcCount AND AssessorId = @UserId";

    public required MilestoneRecord Record { get; init; }
    public required IReadOnlyList<CoConsultantRow> CoConsultants { get; init; }
    public required MilestoneParty Party { get; init; }
    public required ZedUser User { get; init; }

    public string ZedId => Record.ZedId!.Trim();
    public string Level => Record.Certification!.Trim();
    public int Milestone => Record.Milestone;
    public int Status => Record.Status;

    /// <summary>The co-consultant has done the web final submit of this milestone.</summary>
    public bool CoSubmitted => Party == MilestoneParty.CoConsultant &&
        CoConsultants.Any(c => Same(c.CoAssessorId, User.UserId) && c.WebFinalSubmitStatus == 1);

    /// <summary>The consultants' editing window: lead (all sections) or co-consultant (own sections, until its own final submit) at status 9/13.</summary>
    public bool ConsultantCanEdit =>
        User.HasSubRole(SubRoles.SiteVerification) &&
        MilestoneStatus.ConsultantEditable.Contains(Status) &&
        (Party == MilestoneParty.Lead || (Party == MilestoneParty.CoConsultant && !CoSubmitted));

    /// <summary>The CO's review window (status 15).</summary>
    public bool CoCanReview => Party == MilestoneParty.Co && User.HasSubRole(SubRoles.SiteVerification) && Status == MilestoneStatus.CoReview;

    public bool CanEdit => ConsultantCanEdit || CoCanReview;

    /// <summary>Lead at 13 (the procedure then checks the co-consultants), co-consultant at 13 until it has submitted.</summary>
    public bool CanConsultantFinalSubmit =>
        User.HasSubRole(SubRoles.SiteVerification) && Status == MilestoneStatus.InProgress &&
        (Party == MilestoneParty.Lead || (Party == MilestoneParty.CoConsultant && !CoSubmitted));

    public static bool Same(string? a, string? b) =>
        !string.IsNullOrWhiteSpace(a) && !string.IsNullOrWhiteSpace(b) &&
        string.Equals(a.Trim(), b.Trim(), StringComparison.OrdinalIgnoreCase);

    public static async Task<MilestoneContext?> LoadAsync(ISqlExecutor db, ZedUser user, string zedId, string level, CancellationToken ct)
    {
        var record = (await db.QuerySqlAsync<MilestoneRecord>(RecordSql,
            new { ZedId = AssessmentInput.Ansi(zedId), Certification = AssessmentInput.Ansi(level) }, ct)).FirstOrDefault();
        if (record is null || record.ZedId is null || record.Certification is null || record.Milestone is < 1 or > 3) return null;

        var co = await db.QuerySqlAsync<CoConsultantRow>(CoConsultantsSql,
            new { ZedId = AssessmentInput.Ansi(zedId), Certification = AssessmentInput.Ansi(level), NcCount = record.Milestone }, ct);

        var party = (UserRole)user.RoleId switch
        {
            UserRole.MasterAdmin or UserRole.SuperAdmin or UserRole.Ministry => MilestoneParty.Viewer,
            UserRole.Agency when Same(record.CertificationBodyUserId, user.UserId) => MilestoneParty.Co,
            UserRole.DesktopAssessor when Same(record.SiteAssessorId, user.UserId) => MilestoneParty.Lead,
            UserRole.DesktopAssessor when co.Any(c => Same(c.CoAssessorId, user.UserId)) => MilestoneParty.CoConsultant,
            _ => MilestoneParty.None,
        };
        return new MilestoneContext { Record = record, CoConsultants = co, Party = party, User = user };
    }
}

/// <summary>
/// The fields the milestone page may change, replacing SP_CONSULTANCY_UPDATE_COLUMN_VALUE (any table, any column, dynamic
/// SQL: SECURITY-FINDINGS #86). Each field belongs to one milestone, as on the old page: the baseline diagnostic study,
/// the handholding action plan and the technology intervention in milestone 1, progress review 1 in milestone 2 and
/// progress review 2 in milestone 3. The statements are constants; only values are parameters.
/// </summary>
public static class MilestoneFields
{
    public sealed record Field(string Column, int Milestone, int MaxLength, string Sql);

    private static Field Requirement(string column, int milestone, int max) => new(column, milestone, max,
        $"UPDATE MsmeRequirements SET {column} = @Value WHERE Id = @Id AND ZedId = @ZedId AND SectionType = @Certification AND NcCount = 1");

    /// <summary>MsmeRequirements columns (the milestone plan rows are the NcCount 1 rows; later milestones fill their progress review columns).</summary>
    public static readonly IReadOnlyDictionary<string, Field> Requirements = new Dictionary<string, Field>(StringComparer.OrdinalIgnoreCase)
    {
        ["BaselineRemarks"] = Requirement("BaselineRemarks", 1, 2000),
        ["EstimatedTimeInDays"] = Requirement("EstimatedTimeInDays", 1, 50),
        ["HActionPlanRemarks"] = Requirement("HActionPlanRemarks", 1, 2000),
        ["Intervention"] = Requirement("Intervention", 1, 2000),
        ["InterventionRemarks"] = Requirement("InterventionRemarks", 1, 2000),
        ["ProgressReviewRemarks"] = Requirement("ProgressReviewRemarks", 2, 2000),
        ["ProgressReviewRemarks2"] = Requirement("ProgressReviewRemarks2", 3, 2000),
    };

    /// <summary>MsmeRequirementBullets.ReqType values: the bullet lists of milestone 1.</summary>
    public static readonly string[] BulletTypes = ["BaselineDiagnostic", "HandholdingActionPlan", "TechnologyIntervention"];

    public const int BulletMaxLength = 500;
    public const int TrainingRemarksMaxLength = 2000;
    public const int BulletMilestone = 1;

    public const string RequirementSql =
        "SELECT TOP 1 CAST(Id AS bigint) AS Id, NcCount, SectionCode FROM MsmeRequirements WHERE Id = @Id AND ZedId = @ZedId AND SectionType = @Certification";

    public const string BulletSql =
        "SELECT TOP 1 CAST(Id AS bigint) AS Id, NcCount, RequirementId, ReqType FROM MsmeRequirementBullets " +
        "WHERE Id = @Id AND ZedId = @ZedId AND CertificationType = @Certification";

    public const string TrainingSql =
        "SELECT TOP 1 CAST(Id AS bigint) AS Id, NcCount, TrainingType, AssessorId FROM TrainingInfo " +
        "WHERE Id = @Id AND ZedId = @ZedId AND CertificationType = @Certification";

    public const string UpdateBulletSql =
        "UPDATE MsmeRequirementBullets SET BulletPoints = @Value WHERE Id = @Id AND ZedId = @ZedId AND CertificationType = @Certification";

    /// <summary>The soft delete of SP_CONSULTANCY_UPDATE_COLUMN_VALUE ('Delete'): the row drops out of every ZED ID / requirement filter.</summary>
    public const string DeleteBulletSql =
        "UPDATE MsmeRequirementBullets SET ZedId = CONCAT(ZedId, 'DELETED'), RequirementId = CONCAT(RequirementId, 'DELETED') " +
        "WHERE Id = @Id AND ZedId = @ZedId AND CertificationType = @Certification";

    public const string UpdateTrainingSql =
        "UPDATE TrainingInfo SET Remarks = @Value WHERE Id = @Id AND ZedId = @ZedId AND CertificationType = @Certification";

    public static string? BulletType(string? value) =>
        BulletTypes.FirstOrDefault(t => string.Equals(t, value?.Trim(), StringComparison.OrdinalIgnoreCase));
}
