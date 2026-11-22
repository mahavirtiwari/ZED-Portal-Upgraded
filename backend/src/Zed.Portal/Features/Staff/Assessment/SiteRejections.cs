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
/// </summary>
internal static class SiteRejections
{
    /// <summary>The columns of the Allot list's rows (AllotmentLists.ListFields and the place / size of the unit).</summary>
    internal const string Sql = """
        SELECT P.ZedId, P.Certification, M.PUnitName, CONCAT(M.PAddress, ', ', M.PDistrictName, ', ', M.PStateName, ', ', M.PPin) AS UnitAddress,
               M.OwnerName AS UnitSpocName, M.MobileNo AS UnitSpocMobileNo, M.EmailId AS UnitSpocEmailId,
               U.UserName AS AgencyName, P.CertificationBodyUserId, P.ReasonForRejection, P.DesktopReasonForRejection, P.DesktopAssessorId,
               CAST(P.DesktopAccepted AS bit) AS DesktopAccepted, P.CertificationStatus, P.NcStatus, P.ModeOfAssessment,
               M.PDistrictName, M.PStateName, M.EnterpriseTypee
        FROM dbo.MsmeCertifications P
        JOIN dbo.Msme M ON M.ZedId = P.ZedId
        LEFT JOIN dbo.MsmeBasicInformation B ON B.ZedId = P.ZedId
        LEFT JOIN dbo.Users U ON U.UserId = P.CertificationBodyUserId
        WHERE P.CertificationStatus IN (6, 8) AND P.Certification <> 'Bronze'
          AND ISNULL(P.ReasonForRejection, '') <> '' AND ISNULL(P.SiteAssessorId, '') = '' AND ISNULL(P.CertificationBodyUserId, '') <> ''
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
                ["TimeDuration"] = null, ["UdyamStatus"] = null, ["RowNumber"] = null,
            }).ToList();
        }
        catch (System.Data.Common.DbException ex)
        {
            log.LogWarning(ex, "Units rejected at the site allotment could not be read for the Allot list");
            return [];
        }
    }
}
