using Zed.Core.Data;

namespace Zed.Portal.Features.Staff.Assessment;

/// <summary>
/// 2026-11-18: units whose site assessment the allotted agency rejected (SiteAssessmentController.Reject,
/// SP_ASSESSMENT_REJECT_UNIT_FOR_SA) on main. They keep their status (6, waiting for the SA allotment, or 8) and agency with
/// ReasonForRejection set, and main's SP_ASSESSMENT_ALLOT_LIST gives the Master Admin only status 2/3, so they would reach
/// nobody: the Master Admin's Allot list adds them as re-allotments ("Agency Rejected" with the reason), and allotting one
/// to an agency (SP_ASSESSMENT_ALLOT_TO_AGENCY) clears the reason and puts it in that agency's SA list. Surveillance's list
/// already holds Silver/Gold at status 8 whatever their reason, so this is main only. Read-only and additive (no procedure
/// is changed).
/// <para>
/// 2026-11-26 (the user: an Onsite only Bronze unit auto-allotted to its agency was in no Master Admin or Operation Admin list):
/// a Remote only / Onsite only unit goes to status 6 as soon as it has its agency (DesktopSkip), so it left the 2/3 list at
/// once. While its agency has not allotted the site assessor it is listed here too, to re-allot ("Allotted to agency · site
/// assessor to be allotted"); re-allotting keeps it at 6 with the new agency. A Bronze unit rejected at the site allotment
/// (a Bronze level with a visit) is listed as the others; a desktop-certified Bronze (its certificate number) never.
/// </para>
/// </summary>
internal static class SiteRejections
{
    /// <summary>The columns of the Allot list's rows (AllotmentLists.ListFields and the place / size of the unit).</summary>
    internal const string Sql = """
        SELECT P.ZedId, P.Certification, M.PUnitName, CONCAT(M.PAddress, ', ', M.PDistrictName, ', ', M.PStateName, ', ', M.PPin) AS UnitAddress,
               M.OwnerName AS UnitSpocName, M.MobileNo AS UnitSpocMobileNo, M.EmailId AS UnitSpocEmailId,
               U.UserName AS AgencyName, P.CertificationBodyUserId, P.ReasonForRejection, P.DesktopReasonForRejection, P.DesktopAssessorId,
               CAST(P.DesktopAccepted AS bit) AS DesktopAccepted, P.CertificationStatus, P.NcStatus, P.ModeOfAssessment,
               M.PDistrictName, M.PStateName, M.EnterpriseTypee,
               CASE WHEN P.CertificationStatus = 6 AND NULLIF(P.DesktopAssessorId, '') IS NULL AND P.DaCertificateNo IS NULL
                    THEN CASE WHEN ST.AssessmentFlow = 'Remote' THEN 'Remote' ELSE 'Onsite' END END AS DesktopSkipped
        FROM dbo.MsmeCertifications P
        JOIN dbo.Msme M ON M.ZedId = P.ZedId
        LEFT JOIN dbo.MsmeBasicInformation B ON B.ZedId = P.ZedId
        LEFT JOIN dbo.Users U ON U.UserId = P.CertificationBodyUserId
        LEFT JOIN dbo.SectionTypes ST ON ST.SectionType = P.Certification AND ST.IsCertificationLevel = 1
        WHERE ISNULL(P.SiteAssessorId, '') = '' AND ISNULL(P.CertificationBodyUserId, '') <> ''
          AND (
                -- Rejected by its agency at the site allotment (a Bronze one only when it has a visit, not desktop-certified).
                (P.CertificationStatus IN (6, 8) AND ISNULL(P.ReasonForRejection, '') <> '' AND (P.Certification <> 'Bronze' OR P.DaCertificateNo IS NULL))
                -- No desktop step (Remote only / Onsite only), with its agency, the site assessor not yet allotted.
             OR (P.CertificationStatus = 6 AND ISNULL(P.ReasonForRejection, '') = '' AND NULLIF(P.DesktopAssessorId, '') IS NULL
                 AND P.DaCertificateNo IS NULL AND ISNULL(P.NcCount, 0) = 0 AND ISNULL(P.CertificationPhase, 'PENDING') IN ('PENDING', 'REJECTED'))
              )
          AND (@ZedId IS NULL OR P.ZedId = @ZedId) AND (@Certification IS NULL OR P.Certification = @Certification)
          AND (@State IS NULL OR M.StateId = @State) AND (@MsmeSize IS NULL OR M.EnterpriseTypee = @MsmeSize) AND (@Gender IS NULL OR B.Gender = @Gender)
        ORDER BY P.Id DESC
        """;

    internal sealed class Row
    {
        public string? ZedId { get; init; }
        public string? Certification { get; init; }
        public string? PUnitName { get; init; }
        public string? UnitAddress { get; init; }
        public string? UnitSpocName { get; init; }
        public string? UnitSpocMobileNo { get; init; }
        public string? UnitSpocEmailId { get; init; }
        public string? AgencyName { get; init; }
        public string? CertificationBodyUserId { get; init; }
        public string? ReasonForRejection { get; init; }
        public string? DesktopReasonForRejection { get; init; }
        public string? DesktopAssessorId { get; init; }
        public bool? DesktopAccepted { get; init; }
        public int? CertificationStatus { get; init; }
        public int? NcStatus { get; init; }
        public string? ModeOfAssessment { get; init; }
        public string? PDistrictName { get; init; }
        public string? PStateName { get; init; }
        public string? EnterpriseTypee { get; init; }
        public string? DesktopSkipped { get; init; }
    }

    /// <summary>The rejected units for the Allot list's filters (none for "ALLOT": they all have an agency), as procedure-like rows.</summary>
    public static async Task<List<IDictionary<string, object?>>> ListAsync(ISqlExecutor db, string? zedId, string? allotmentType, AllotmentLists.Filter f,
        ILogger log, CancellationToken ct)
    {
        if (allotmentType == "ALLOT") return [];
        try
        {
            var rows = await db.QuerySqlAsync<Row>(Sql, new
            {
                ZedId = AssessmentInput.Ansi(zedId),
                Certification = AssessmentInput.Ansi(f.Certification),
                State = f.State,
                MsmeSize = f.Size,
                Gender = f.Gender,
            }, ct);
            return rows.Select(r => (IDictionary<string, object?>)new Dictionary<string, object?>
            {
                ["ZedId"] = r.ZedId, ["Certification"] = r.Certification, ["PUnitName"] = r.PUnitName, ["UnitAddress"] = r.UnitAddress,
                ["UnitSpocName"] = r.UnitSpocName, ["UnitSpocMobileNo"] = r.UnitSpocMobileNo, ["UnitSpocEmailId"] = r.UnitSpocEmailId,
                ["AgencyName"] = r.AgencyName, ["CertificationBodyUserId"] = r.CertificationBodyUserId, ["ReasonForRejection"] = r.ReasonForRejection,
                ["DesktopReasonForRejection"] = r.DesktopReasonForRejection, ["DesktopAssessorId"] = r.DesktopAssessorId, ["DesktopAccepted"] = r.DesktopAccepted,
                ["CertificationStatus"] = r.CertificationStatus, ["NcStatus"] = r.NcStatus, ["ModeOfAssessment"] = r.ModeOfAssessment,
                ["PDistrictName"] = r.PDistrictName, ["PStateName"] = r.PStateName, ["EnterpriseTypee"] = r.EnterpriseTypee,
                [DesktopSkip.Field] = r.DesktopSkipped,
                ["TimeDuration"] = null, ["UdyamStatus"] = null, ["RowNumber"] = null,
            }).ToList();
        }
        catch (System.Data.Common.DbException ex)
        {
            log.LogWarning(ex, "Units rejected at the site allotment (or waiting there without a desktop step) could not be read for the Allot list");
            return [];
        }
    }
}
