using System.Globalization;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Zed.Core.Assessment;
using Zed.Core.Data;
using Zed.Core.Forms;
using Zed.Core.Http;
using Zed.Core.Mobile;
using Zed.Core.Security;
using Zed.Main.MobileApi.Models.Consultancy;
using SaNotification = Zed.Main.MobileApi.Models.Assessor.SaNotification;
using SaSpoc = Zed.Main.MobileApi.Models.Assessor.SaSpoc;
using SaTeamMember = Zed.Main.MobileApi.Models.Assessor.SaTeamMember;
using SiteTourSectionInfo = Zed.Main.MobileApi.Models.Assessor.SiteTourSectionInfo;

namespace Zed.Main.MobileApi.Controllers.Consultancy;

/// <summary>
/// V4, for the redesigned consultant app, after the site assessor app 2.0 (<see cref="SAController"/>.App): the consultant
/// signs in with the consultant ID and password only (<see cref="SignIn"/>), sees a dashboard of all its handholding cases
/// (<see cref="Assessments"/>, <see cref="Notifications"/>, <see cref="Reports"/>) and opens one unit at a time
/// (<see cref="Assessment"/>, the answer SA/Login gives for that unit). The writes stay the SA/Submit* calls, each checking
/// the allotment, the stage and the token's consultant itself.
/// <para>
/// The sign-in makes the checks of SA/Login (shared code: version gate, throttle, password, master-password block, the Users
/// row of SP_APP_SA_CHECK_LOGIN_V2 with RoleId 3) and issues the app token without a unit; it is for consultants (site
/// verification): a technology upgradation verifier (DFO) keeps signing in with the unit's ZED ID. The reads are new calls
/// that only the new app makes, so they need a valid app token of the consultant named in them whatever
/// <c>Mobile:AppTokens</c> says, and the Users row must still be an active consultant. Data comes from the legacy tables
/// only (no new table or column). Unlike the site assessor app, there is no one-phone rule.
/// </para>
/// </summary>
public sealed partial class ConsultancySAController
{
    /// <summary>Finished milestones stay on the dashboard this long (completed, accepted, rejected).</summary>
    internal const int FinishedMonths = 12;

    /// <summary>Notifications from the unit's history cover this many days.</summary>
    internal const int NotificationDays = 30;

    /// <summary>The milestone whose visit has the site tour (baseline diagnostic study).</summary>
    public const int SiteTourMilestone = 1;

    /// <summary>SP_APP_SA_CHECK_LOGIN_V2's text for a unit whose milestone is past the consultants' visit (status above 9).</summary>
    public const string LoginClosed = "Handholding Closing Meeting Submitted for the ZEDID: ";

    /// <summary>SA/SignIn of an account that is a technology upgradation verifier (DFO) only.</summary>
    public const string DfoSignIn = "Technology upgradation verifiers sign in with the unit's ZED ID.";

    // ------------------------------------------------------------------ Sign-in

    /// <summary>
    /// The consultant's sign-in without a ZED ID: the checks of <see cref="Login"/> (SP_APP_SA_CHECK_LOGIN_V2 without a unit).
    /// Answers the app token (no unit), the profile with the Consultant Organisation, the cases and the site tour sections.
    /// </summary>
    [HttpPost]
    [LoginAudit(LoginChannels.Mobile, "Consultant app")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public Task<IActionResult> SignIn(ConsultantSignInRequest request, CancellationToken ct) => Guarded(nameof(SignIn), async () =>
    {
        var signIn = await CheckSignInAsync(request.assessorId, request.password, request.version, null, ct);
        if (signIn.Refusal is { } refusal) return LegacyJson(new ConsultantSignInResponse { status = refusal.Status, errorMessage = refusal.Message });

        var user = signIn.User!;
        var userKey = signIn.UserKey!;
        if (!user.Bool("SiteVerification"))
        {
            log.LogInformation("Consultant app sign-in of {UserId} refused: a DFO account (no site verification)", userKey);
            return LegacyJson(new ConsultantSignInResponse { status = "0", errorMessage = DfoSignIn });
        }

        var cases = await CaseListAsync(userKey, ct);
        var response = new ConsultantSignInResponse
        {
            status = "1",
            profile = await ProfileAsync(user, userKey, ct),
            counts = Count(cases),
            assessments = cases,
            siteTourSections = (await SiteTourSections.LoadAsync(settings, ct)).Where(t => t.Active)
                .Select((t, i) => SiteTourSectionInfo.Of(t, i + 1, 0)).ToList(),
        };

        await devices.RememberAsync(App, userKey, request.deviceInfo, ClientIp, ct);
        // No unit: every SA call checks the allotment of the unit it names against the token's consultant.
        response.appToken = await tokens.IssueAsync(App, userKey, null, ct);
        log.LogInformation("Consultant app sign-in for {UserId} ({Count} cases)", userKey, cases.Count);
        return LegacyJson(response);
    });

    // ------------------------------------------------------------------ Dashboard reads

    /// <summary>
    /// The consultant's handholding cases (lead or co-consultant of a milestone): one per unit and level, at the latest
    /// milestone the consultant is allotted to; open ones, and finished ones of the last <see cref="FinishedMonths"/> months.
    /// </summary>
    [HttpPost]
    [DeviceBound(App, "saId", TokenRequired = true)]
    public Task<IActionResult> Assessments(ConsultantRequest request, CancellationToken ct) => Guarded(nameof(Assessments), async () =>
    {
        if (await ConsultantRefusalAsync(nameof(Assessments), request.saId, ct) is { } refused) return refused;
        var list = await CaseListAsync(request.saId!.Trim(), ct);
        return LegacyJson(new ConsultantAssessmentsResponse { status = "1", counts = Count(list), assessments = list });
    });

    /// <summary>
    /// One unit, exactly as <see cref="Login"/> answered it (same shape, same refusals), without the password and without a
    /// new token: SP_APP_SA_CHECK_LOGIN_V2's unit branch (<see cref="OpenUnitSql"/>: "closing meeting submitted" above
    /// status 9, else "not yet allocated"), then its consultant sub-procedure, which does not read the password. A
    /// <c>certificationType</c> that is not the unit's open one is refused as not allocated.
    /// </summary>
    [HttpPost]
    [DeviceBound(App, "saId", TokenRequired = true)]
    public Task<IActionResult> Assessment(ConsultantAssessmentRequest request, CancellationToken ct) => Guarded(nameof(Assessment), async () =>
    {
        if (await ConsultantRefusalAsync(nameof(Assessment), request.saId, ct) is { } refused) return refused;
        if (string.IsNullOrWhiteSpace(request.zedId)) return LoginFail(NotAllocated + request.zedId);
        var saId = request.saId!.Trim();
        var zedId = request.zedId.Trim();

        var open = (await db.QuerySqlAsync<int>(OpenUnitSql, new { ZedId = Ansi(zedId), UserId = Ansi(saId.Replace(' ', '_')) }, ct)).FirstOrDefault();
        if (open == 2) return LoginFail(LoginClosed + zedId);
        if (open != 1) return LoginFail(NotAllocated + zedId);

        // The sub-procedure's sets are SP_APP_SA_CHECK_LOGIN_V2's from set 1 on (its set 0 is the Users row).
        var unitSets = await db.QueryProcMultipleAsync("SP_APP_SA_CONSULTANCY_CHECK_LOGIN",
            new { UserId = saId, Password = PasswordStore.RefusedValue, ZedId = zedId }, ct);
        var shifted = new List<IReadOnlyList<IDictionary<string, object?>>> { Array.Empty<IDictionary<string, object?>>() };
        for (var i = 0; i < unitSets.Count; i++) shifted.Add(unitSets[i]);
        var sets = new ResultSets(shifted);
        if (!string.IsNullOrWhiteSpace(request.certificationType) && sets[1].FirstOrDefault() is { } unit &&
            !Same(unit.Text("CertificationType"), request.certificationType))
        {
            log.LogInformation("Consultancy SA/Assessment: {ZedId} {Requested} asked by {SaId}, open level is {Level}", zedId,
                request.certificationType, saId, unit.Text("CertificationType"));
            return LoginFail(NotAllocated + zedId);
        }

        var answer = await UnitAnswerAsync(nameof(Assessment), sets, zedId, dfo: false, saId, ct);
        return answer.Response is { } response ? LegacyJson(response) : LoginFail(answer.Refusal!);
    });

    /// <summary>
    /// Read-only notices made from the data that exists (no notification table): allotments, milestones completed by the
    /// Consultant Organisation and send-backs from MsmeHistory of the last <see cref="NotificationDays"/> days; reminders for
    /// a milestone visit today or tomorrow; milestones the MSME accepted. Newest first; the ids are stable.
    /// </summary>
    [HttpPost]
    [DeviceBound(App, "saId", TokenRequired = true)]
    public Task<IActionResult> Notifications(ConsultantRequest request, CancellationToken ct) => Guarded(nameof(Notifications), async () =>
    {
        if (await ConsultantRefusalAsync(nameof(Notifications), request.saId, ct) is { } refused) return refused;
        var saId = request.saId!.Trim();
        var rows = await RowsAsync(ConsultancyAppData.CasesSql, saId, DateTime.Now.AddMonths(-FinishedMonths), ct);
        var history = await db.QuerySqlAsync<ConsultancyAppData.HistoryRow>(ConsultancyAppData.HistorySql,
            new { UserId = Ansi(saId), Since = DateTime.Now.AddDays(-NotificationDays) }, ct);
        return LegacyJson(new ConsultantNotificationsResponse
        {
            status = "1", notifications = ConsultancyAppData.Notifications(ConsultancyAppData.Latest(rows), history, saId, DateTime.Now),
        });
    });

    /// <summary>
    /// The milestones the consultant has worked on from the closing meeting (status 13) on, with whether the consultancy
    /// portal serves the milestone report (Silver / Gold, completed, accepted or rejected) and its address there.
    /// </summary>
    [HttpPost]
    [DeviceBound(App, "saId", TokenRequired = true)]
    public Task<IActionResult> Reports(ConsultantRequest request, CancellationToken ct) => Guarded(nameof(Reports), async () =>
    {
        if (await ConsultantRefusalAsync(nameof(Reports), request.saId, ct) is { } refused) return refused;
        var saId = request.saId!.Trim();
        var rows = await RowsAsync(ConsultancyAppData.ReportsSql, saId, null, ct);
        var team = await TeamAsync(saId, ct);
        return LegacyJson(new ConsultantReportsResponse { status = "1", reports = rows.Select(r => ConsultancyAppData.Report(r, team, saId)).ToList() });
    });

    // ------------------------------------------------------------------ Helpers

    /// <summary>
    /// SP_APP_SA_CHECK_LOGIN_V2's unit branch for a consultant, with the co-consultant matched exactly (database fix 05):
    /// 1 the unit has a milestone at status 8 or 9 the consultant is on, 2 it is past that (closing meeting submitted), 0 none.
    /// </summary>
    public const string OpenUnitSql = """
        SELECT CASE
          WHEN EXISTS (SELECT 1 FROM dbo.MsmeCertifications WHERE ZedId = @ZedId AND CertificationStatus IN (8, 9)
                         AND (SiteAssessorId = @UserId OR CHARINDEX(',' + @UserId + ',', ',' + REPLACE(CoAssessorId, ' ', '') + ',') > 0)) THEN 1
          WHEN EXISTS (SELECT 1 FROM dbo.MsmeCertifications WHERE ZedId = @ZedId AND CertificationStatus > 9) THEN 2
          ELSE 0 END;
        """;

    /// <summary>The unit's current milestone (the row the procedures use: SiteAssessorId set, SaCertificateNo empty).</summary>
    public const string CurrentMilestoneSql =
        "SELECT TOP (1) NcCount FROM dbo.MsmeCertifications WHERE ZedId = @ZedId AND Certification = @Certification " +
        "AND SiteAssessorId IS NOT NULL AND SaCertificateNo IS NULL;";

    /// <summary>
    /// The site tour photos of the unit's current milestone, as SP_APP_SA_SAVE_PHOTOS stores them for SA/SubmitSiteTour
    /// (SaPhotos, PhotoType SiteTour, NcCount = the current milestone).
    /// </summary>
    public const string SiteTourPhotosSql =
        "SELECT PhotoId, Name FROM dbo.SaPhotos WHERE ZedId = @ZedId AND Certification = @Certification AND PhotoType = 'SiteTour' " +
        "AND NcCount = (SELECT TOP (1) NcCount FROM dbo.MsmeCertifications WHERE ZedId = @ZedId AND Certification = @Certification " +
        "AND SiteAssessorId IS NOT NULL AND SaCertificateNo IS NULL);";

    /// <summary>The site tour sections asked of the unit (Admin → Site Tour Sections of this system; its level and NIC sector).</summary>
    private async Task<IReadOnlyList<SiteTourSection>> UnitSiteTourSectionsAsync(string zedId, string certificationType, CancellationToken ct) =>
        SiteTourSections.For(await SiteTourSections.LoadAsync(settings, ct), await AppFormUnit.ForAsync(db, zedId, certificationType, ct));

    private Task<IReadOnlyList<SiteTourSections.PhotoRow>> SiteTourPhotosAsync(string zedId, string certificationType, CancellationToken ct) =>
        db.QuerySqlAsync<SiteTourSections.PhotoRow>(SiteTourPhotosSql, new { ZedId = Ansi(zedId), Certification = Ansi(certificationType) }, ct);

    private async Task<int?> CurrentMilestoneAsync(string zedId, string certificationType, CancellationToken ct) =>
        (await db.QuerySqlAsync<int?>(CurrentMilestoneSql, new { ZedId = Ansi(zedId), Certification = Ansi(certificationType) }, ct)).FirstOrDefault();

    private async Task<List<ConsultantCase>> CaseListAsync(string saId, CancellationToken ct)
    {
        var rows = await RowsAsync(ConsultancyAppData.CasesSql, saId, DateTime.Now.AddMonths(-FinishedMonths), ct);
        var team = await TeamAsync(saId, ct);
        return ConsultancyAppData.Latest(rows).Select(r => ConsultancyAppData.Case(r, team, saId)).ToList();
    }

    private Task<IReadOnlyList<ConsultancyAppData.CaseRow>> RowsAsync(string sql, string saId, DateTime? since, CancellationToken ct) =>
        db.QuerySqlAsync<ConsultancyAppData.CaseRow>(sql, new { UserId = Ansi(saId), Since = since }, ct);

    private Task<IReadOnlyList<ConsultancyAppData.TeamRow>> TeamAsync(string saId, CancellationToken ct) =>
        db.QuerySqlAsync<ConsultancyAppData.TeamRow>(ConsultancyAppData.TeamSql, new { UserId = Ansi(saId) }, ct);

    private static ConsultantCounts Count(IReadOnlyCollection<ConsultantCase> list) => new()
    {
        total = list.Count,
        upcoming = list.Count(a => a.stage == ConsultancyAppData.Scheduled),
        ongoing = list.Count(a => a.stage is ConsultancyAppData.InProgress or ConsultancyAppData.SentBack),
        submitted = list.Count(a => a.stage is ConsultancyAppData.Submitted or ConsultancyAppData.UnderReview),
        completed = list.Count(a => a.stage == ConsultancyAppData.Completed),
        closed = list.Count(a => a.stage is ConsultancyAppData.Rejected or ConsultancyAppData.Closed),
    };

    /// <summary>
    /// The token proves the sign-in; the Users row must still be what <see cref="SignIn"/> lets in (RoleId 3, site
    /// verification, active), else the app is signed out. Null when the call may go on.
    /// </summary>
    private async Task<IActionResult?> ConsultantRefusalAsync(string action, string? saId, CancellationToken ct)
    {
        var user = string.IsNullOrWhiteSpace(saId) ? null
            : (await db.QuerySqlAsync<SaAppData.UserRow>(SaAppData.AssessorSql, new { UserId = Ansi(saId.Trim()) }, ct)).FirstOrDefault();
        if (user is { RoleId: 3, IsActive: true, SiteVerification: true }) return null;
        log.LogWarning("Refused consultancy SA/{Action}: {SaId} is not an active consultant", action, saId);
        return Fail(AppTokens.ExpiredMessage);
    }

    /// <summary>
    /// The profile from the Users row of the sign-in. The consultant's organisation is the Consultant Organisation that created
    /// it (Users.CreatedBy, as the agency of a site assessor: StaffAssessorsController), read from its own Users row.
    /// </summary>
    private async Task<ConsultantProfile> ProfileAsync(IDictionary<string, object?> user, string userKey, CancellationToken ct)
    {
        string? T(string column) => user.Text(column) is { Length: > 0 } v ? v.Trim() : null;
        var agencyId = T("CreatedBy");
        var agency = agencyId is null ? null
            : (await db.QuerySqlAsync<SaAppData.AgencyRow>(SaAppData.AgencySql, new { UserId = Ansi(agencyId) }, ct)).FirstOrDefault();
        static string? Clean(string? v) => string.IsNullOrWhiteSpace(v) ? null : v.Trim();
        return new ConsultantProfile
        {
            assessorId = userKey,
            name = T("UserName"),
            email = T("Email"),
            mobile = T("MobileNo"),
            agencyId = agencyId,
            agencyName = Clean(agency?.UserName),
            agencyEmail = Clean(agency?.Email),
            agencyMobile = Clean(agency?.MobileNo),
        };
    }

    private static DbString Ansi(string? value) => new() { Value = value, IsAnsi = true, Length = 50 };
}

/// <summary>Queries and mapping of the redesigned consultant app's reads (ZED_CONSULTANT; one MsmeCertifications row per milestone).</summary>
public static class ConsultancyAppData
{
    public const string Scheduled = "scheduled";
    public const string InProgress = "inProgress";
    public const string Submitted = "submitted";
    public const string SentBack = "sentBack";
    public const string UnderReview = "underReview";
    public const string Completed = "completed";
    public const string Rejected = "rejected";
    public const string Closed = "closed";

    /// <summary>Handholding milestones (MsmeCertifications.NcCount 1 to 3; the technology upgradation is the DFO's).</summary>
    public const int Milestones = 3;

    /// <summary>The handholding levels (as the consultant calls' upload paths).</summary>
    private const string Levels = "'Bronze', 'Silver', 'Gold'";

    /// <summary>
    /// The milestone rows the consultant is on: the lead (SiteAssessorId) or a co-consultant of that milestone
    /// (AllotedCoAssessors, NcCount = the milestone; a re-allotment renames the old rows, ZedId + '_del', so they drop out).
    /// The two are searched separately (UNION), so each can use an index; the per-unit look-ups seek by ZED ID.
    /// </summary>
    private const string Mine = """

        FROM (SELECT Id FROM dbo.MsmeCertifications WHERE SiteAssessorId = @UserId
              UNION SELECT M.Id FROM dbo.AllotedCoAssessors A
                    INNER JOIN dbo.MsmeCertifications M ON M.ZedId = A.ZedId AND M.Certification = A.Certification AND M.NcCount = A.NcCount
                    WHERE A.CoAssessorId = @UserId) X
        INNER JOIN dbo.MsmeCertifications C ON C.Id = X.Id
        """;

    /// <summary>
    /// One row per milestone of the consultant, with the unit, the lead, the unit's representative and location, whether the
    /// milestone's open meeting is in, and the status of each of the unit's milestones (for the progress).
    /// </summary>
    private const string Select = """
         C.ZedId, C.Certification, C.NcCount, C.CertificationStatus, C.CertificationStatusDate, C.AssessmentDate, C.SendBackStatus,
               C.SiteAssessorId, L.UserName AS LeadName, L.Email AS LeadEmail, L.MobileNo AS LeadMobile,
               ISNULL(B.EnterpriseName, M.EnterpriseName) AS EnterpriseName, M.PUnitName AS UnitName, M.PAddress AS Address,
               M.PDistrictName AS District, M.PStateName AS State, M.PPin AS Pincode, M.OwnerName, M.MobileNo AS UnitMobile,
               B.EmailId AS UnitEmail, R.RepresentativeName, R.Designation AS RepresentativeDesignation,
               ISNULL(G.Latitude, OM.Latitude) AS Latitude, ISNULL(G.Longitude, OM.Longitude) AS Longitude,
               CAST(CASE WHEN OM.Id IS NULL THEN 0 ELSE 1 END AS bit) AS OpenMeetingSubmitted,
               S.Milestone1Status, S.Milestone2Status, S.Milestone3Status, S.LatestMilestone
        """ + Mine + """

        OUTER APPLY (SELECT TOP (1) EnterpriseName, PUnitName, PAddress, PDistrictName, PStateName, PPin, OwnerName, MobileNo
                     FROM dbo.Msme WHERE ZedId = C.ZedId) M
        OUTER APPLY (SELECT TOP (1) EnterpriseName, EmailId FROM dbo.MsmeBasicInformation WHERE ZedId = C.ZedId) B
        OUTER APPLY (SELECT TOP (1) UserName, Email, MobileNo FROM dbo.Users WHERE UserId = C.SiteAssessorId) L
        OUTER APPLY (SELECT TOP (1) RepresentativeName, Designation FROM dbo.MsmeSelfies
                     WHERE ZedId = C.ZedId AND Certification = C.Certification AND RepresentativeName IS NOT NULL ORDER BY Id DESC) R
        OUTER APPLY (SELECT TOP (1) Latitude, Longitude FROM dbo.MsmeLocations
                     WHERE ZedId = C.ZedId AND Certification = C.Certification AND Latitude IS NOT NULL ORDER BY Id DESC) G
        OUTER APPLY (SELECT TOP (1) Id, Latitude, Longitude FROM dbo.Meetings
                     WHERE ZedId = C.ZedId AND CertificationType = C.Certification AND NcCount = C.NcCount AND AssessorId = C.SiteAssessorId
                       AND MeetingType = 'Open Meeting' ORDER BY Id DESC) OM
        OUTER APPLY (SELECT MAX(CASE WHEN NcCount = 1 THEN CertificationStatus END) AS Milestone1Status,
                            MAX(CASE WHEN NcCount = 2 THEN CertificationStatus END) AS Milestone2Status,
                            MAX(CASE WHEN NcCount = 3 THEN CertificationStatus END) AS Milestone3Status,
                            MAX(NcCount) AS LatestMilestone
                     FROM dbo.MsmeCertifications WHERE ZedId = C.ZedId AND Certification = C.Certification AND NcCount BETWEEN 1 AND 3) S
        WHERE C.Certification IN (
        """ + Levels + """
        ) AND C.NcCount BETWEEN 1 AND 3 AND CHARINDEX('_', C.ZedId) = 0
        """;

    /// <summary>
    /// The dashboard: the consultant's milestone rows from the allotment (status 8) on; finished ones (above 15) while their
    /// status date (else the visit date) is after @Since. Grouped per unit and level in code (<see cref="Latest"/>).
    /// </summary>
    public const string CasesSql = "SELECT TOP (1000)" + Select + """
          AND C.CertificationStatus >= 8
          AND (C.CertificationStatus <= 15 OR ISNULL(C.CertificationStatusDate, C.AssessmentDate) >= @Since)
        ORDER BY C.AssessmentDate DESC;
        """;

    /// <summary>Reports: every milestone of the consultant from the closing meeting (status 13) on, newest first.</summary>
    public const string ReportsSql = "SELECT TOP (300)" + Select + """
          AND C.CertificationStatus >= 13
        ORDER BY ISNULL(C.CertificationStatusDate, C.AssessmentDate) DESC;
        """;

    /// <summary>The co-consultants of each of the consultant's milestones.</summary>
    public const string TeamSql = "SELECT TOP (3000) C.ZedId, C.Certification, C.NcCount, A.CoAssessorId, U.UserName, U.Email, U.MobileNo " + Mine + """

        INNER JOIN dbo.AllotedCoAssessors A ON A.ZedId = C.ZedId AND A.Certification = C.Certification AND A.NcCount = C.NcCount
        OUTER APPLY (SELECT TOP (1) UserName, Email, MobileNo FROM dbo.Users WHERE UserId = A.CoAssessorId) U
        WHERE CHARINDEX('_', C.ZedId) = 0 AND C.NcCount BETWEEN 1 AND 3
        ORDER BY A.Id;
        """;

    /// <summary>
    /// MsmeHistory rows of the consultant's units that make a notice: the allotment with the visit date (ScheduledOn,
    /// SP_ASSESSMENT_ACCEPT_UNIT_FOR_SA), the CO's completion (Completed, SP_MONITORING_RA_FINAL_SUBMIT) and send-back.
    /// </summary>
    public const string HistorySql = """
        SELECT TOP (300) CAST(H.Id AS bigint) AS Id, H.ZedId, H.CertificationType, H.StatusType, H.Descrip, H.CreatedDate, H.NcCount
        FROM dbo.MsmeHistory H
        WHERE H.CreatedDate >= @Since
          AND H.StatusType IN ('ScheduledOn', 'Completed', 'CO Send back to Consultant')
          AND (EXISTS (SELECT 1 FROM dbo.MsmeCertifications C
                       WHERE C.ZedId = H.ZedId AND C.Certification = H.CertificationType AND C.SiteAssessorId = @UserId)
               OR EXISTS (SELECT 1 FROM dbo.AllotedCoAssessors A
                          WHERE A.ZedId = H.ZedId AND A.Certification = H.CertificationType AND A.CoAssessorId = @UserId))
        ORDER BY H.Id DESC;
        """;

    public sealed class CaseRow
    {
        public string? ZedId { get; init; }
        public string? Certification { get; init; }
        public int? NcCount { get; init; }
        public int? CertificationStatus { get; init; }
        public DateTime? CertificationStatusDate { get; init; }
        public DateTime? AssessmentDate { get; init; }
        public int? SendBackStatus { get; init; }
        public string? SiteAssessorId { get; init; }
        public string? LeadName { get; init; }
        public string? LeadEmail { get; init; }
        public string? LeadMobile { get; init; }
        public string? EnterpriseName { get; init; }
        public string? UnitName { get; init; }
        public string? Address { get; init; }
        public string? District { get; init; }
        public string? State { get; init; }
        public string? Pincode { get; init; }
        public string? OwnerName { get; init; }
        public string? UnitMobile { get; init; }
        public string? UnitEmail { get; init; }
        public string? RepresentativeName { get; init; }
        public string? RepresentativeDesignation { get; init; }
        public string? Latitude { get; init; }
        public string? Longitude { get; init; }
        public bool OpenMeetingSubmitted { get; init; }
        public int? Milestone1Status { get; init; }
        public int? Milestone2Status { get; init; }
        public int? Milestone3Status { get; init; }
        public int? LatestMilestone { get; init; }

        public int Status => CertificationStatus ?? 0;
        public int Milestone => NcCount ?? 0;
    }

    public sealed class TeamRow
    {
        public string? ZedId { get; init; }
        public string? Certification { get; init; }
        public int? NcCount { get; init; }
        public string? CoAssessorId { get; init; }
        public string? UserName { get; init; }
        public string? Email { get; init; }
        public string? MobileNo { get; init; }
    }

    public sealed class HistoryRow
    {
        public long Id { get; init; }
        public string? ZedId { get; init; }
        public string? CertificationType { get; init; }
        public string? StatusType { get; init; }
        public string? Descrip { get; init; }
        public DateTime? CreatedDate { get; init; }
        public int? NcCount { get; init; }
    }

    /// <summary>What each milestone's visit covers (the consultant app's milestone screens).</summary>
    public static string MilestoneLabel(int milestone) => milestone switch
    {
        1 => "Baseline Diagnostic & Action Plan",
        2 => "Progress Review 1",
        3 => "Progress Review 2",
        _ => "Milestone " + milestone.ToString(CultureInfo.InvariantCulture),
    };

    /// <summary>A milestone completed by the Consultant Organisation (16) or accepted by the MSME (100).</summary>
    public static bool IsDone(int? status) => status is 16 or 100;

    /// <summary>
    /// The app's stage of a milestone row. 8 allotted to the CO, 9 consultants allotted (started once the milestone's open
    /// meeting is in); 13 closing meeting done, the lead final-submits on the web (sent back by the CO: SendBackStatus 1);
    /// 15 with the Consultant Organisation; 16 completed, 100 accepted by the MSME; 99 rejected.
    /// </summary>
    public static (string Stage, string Label) StageOf(CaseRow r) => r.Status switch
    {
        8 => (Scheduled, "Scheduled"),
        9 => r.OpenMeetingSubmitted ? (InProgress, "In Progress") : (Scheduled, "Scheduled"),
        13 => r.SendBackStatus == 1 ? (SentBack, "Sent Back") : (Submitted, "Submitted"),
        15 => (UnderReview, "Under Review"),
        16 => (Completed, "Completed"),
        100 => (Completed, "Accepted"),
        99 => (Rejected, "Rejected"),
        _ => (Closed, "Closed"),
    };

    /// <summary>
    /// The unit's milestones 1 to 3: done (completed or accepted, or a later milestone exists), current (the unit's latest
    /// milestone, not done) or locked (not started yet).
    /// </summary>
    public static List<MilestoneStep> Progress(CaseRow r)
    {
        var latest = r.LatestMilestone ?? r.Milestone;
        int? StatusOf(int no) => no switch { 1 => r.Milestone1Status, 2 => r.Milestone2Status, 3 => r.Milestone3Status, _ => null };
        return Enumerable.Range(1, Milestones).Select(no => new MilestoneStep
        {
            no = no,
            status = no < latest || (no == latest && IsDone(StatusOf(no))) ? "done" : no == latest ? "current" : "locked",
            label = MilestoneLabel(no),
        }).ToList();
    }

    /// <summary>Each unit and level once: the latest milestone the consultant is on.</summary>
    public static List<CaseRow> Latest(IEnumerable<CaseRow> rows) =>
        rows.GroupBy(r => Key(r.ZedId, r.Certification)).Select(g => g.OrderByDescending(r => r.Milestone).First()).ToList();

    public static string LevelName(string? level) => level?.Trim() ?? "";

    private static bool Same(string? a, string? b) =>
        !string.IsNullOrWhiteSpace(a) && !string.IsNullOrWhiteSpace(b) && string.Equals(a.Trim(), b.Trim(), StringComparison.OrdinalIgnoreCase);

    private static string? Iso(DateTime? d) => d?.ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture);

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    private static List<SaTeamMember> Team(CaseRow r, IReadOnlyList<TeamRow> team)
    {
        var list = new List<SaTeamMember>
        {
            new() { assessorId = Clean(r.SiteAssessorId), name = Clean(r.LeadName), email = Clean(r.LeadEmail), mobile = Clean(r.LeadMobile), role = "Lead", userType = 1 },
        };
        foreach (var co in team.Where(t => Key(t.ZedId, t.Certification) == Key(r.ZedId, r.Certification) && t.NcCount == r.NcCount))
            if (Clean(co.CoAssessorId) is { } id && !list.Any(m => Same(m.assessorId, id)))
                list.Add(new SaTeamMember { assessorId = id, name = Clean(co.UserName), email = Clean(co.Email), mobile = Clean(co.MobileNo), role = "Co", userType = 2 });
        return list;
    }

    private static string Role(CaseRow r, string saId) => Same(r.SiteAssessorId, saId) ? "Lead" : "Co";

    public static ConsultantCase Case(CaseRow r, IReadOnlyList<TeamRow> team, string saId)
    {
        var (stage, label) = StageOf(r);
        var representative = Clean(r.RepresentativeName);
        var role = Role(r, saId);
        return new ConsultantCase
        {
            zedId = Clean(r.ZedId),
            certificationType = Clean(r.Certification),
            levelName = LevelName(r.Certification),
            enterpriseName = Clean(r.EnterpriseName),
            unitName = Clean(r.UnitName),
            address = Clean(r.Address),
            district = Clean(r.District),
            state = Clean(r.State),
            pincode = Clean(r.Pincode),
            assessmentDate = Iso(r.AssessmentDate),
            certificationStatus = r.Status,
            statusDate = Iso(r.CertificationStatusDate),
            stage = stage,
            statusLabel = label,
            openMeetingSubmitted = r.OpenMeetingSubmitted,
            // What SA/Login opens: the unit's milestone at status 8 or 9 (SP_APP_SA_CHECK_LOGIN_V2).
            canOpen = r.Status is 8 or 9 && r.Milestone == (r.LatestMilestone ?? r.Milestone),
            role = role,
            userType = role == "Lead" ? 1 : 2,
            team = Team(r, team),
            spoc = new SaSpoc
            {
                name = representative ?? Clean(r.OwnerName),
                designation = representative is null ? null : Clean(r.RepresentativeDesignation),
                email = Clean(r.UnitEmail),
                phone = Clean(r.UnitMobile),
                source = representative is not null ? "representative" : Clean(r.OwnerName) is not null ? "owner" : null,
            },
            latitude = Clean(r.Latitude),
            longitude = Clean(r.Longitude),
            milestone = r.Milestone,
            milestones = Progress(r),
        };
    }

    /// <summary>Address of the milestone report PDF on the consultancy portal (Zed.Portal ConsultantAppController).</summary>
    public static string ReportPath(string zedId, string level, int milestone) =>
        $"SA/AppReport?zedId={Uri.EscapeDataString(zedId)}&certificationType={Uri.EscapeDataString(level)}&milestone={milestone.ToString(CultureInfo.InvariantCulture)}";

    public static ConsultantReport Report(CaseRow r, IReadOnlyList<TeamRow> team, string saId)
    {
        var (stage, label) = StageOf(r);
        // As the portal's milestone report (MilestoneDownloads): Silver / Gold, a milestone completed, accepted or rejected.
        var level = Clean(r.Certification);
        var available = (IsDone(r.Status) || r.Status == 99) && Clean(r.ZedId) is not null && r.Milestone is >= 1 and <= Milestones
                        && (Same(level, "Silver") || Same(level, "Gold"));
        return new ConsultantReport
        {
            zedId = Clean(r.ZedId),
            certificationType = level,
            levelName = LevelName(r.Certification),
            milestone = r.Milestone,
            milestoneLabel = MilestoneLabel(r.Milestone),
            enterpriseName = Clean(r.EnterpriseName),
            district = Clean(r.District),
            state = Clean(r.State),
            assessmentDate = Iso(r.AssessmentDate),
            certificationStatus = r.Status,
            statusDate = Iso(r.CertificationStatusDate),
            stage = stage,
            statusLabel = label,
            role = Role(r, saId),
            team = Team(r, team),
            reportAvailable = available,
            reportPath = available ? ReportPath(r.ZedId!.Trim(), level!, r.Milestone) : null,
        };
    }

    /// <summary>The notices of <see cref="ConsultancySAController.Notifications"/>, newest first (at most 100).</summary>
    public static List<SaNotification> Notifications(IReadOnlyList<CaseRow> cases, IReadOnlyList<HistoryRow> history, string saId, DateTime now)
    {
        var units = cases.ToDictionary(r => Key(r.ZedId, r.Certification));
        string Unit(string? zedId, string? level)
        {
            var name = units.GetValueOrDefault(Key(zedId, level))?.EnterpriseName;
            return Clean(name) is { } n ? $"{n} ({zedId?.Trim()})" : zedId?.Trim() ?? "";
        }
        string Level(string? level) => "ZED " + LevelName(level);
        string MilestoneOf(int? no) => no is >= 1 and <= Milestones ? $"Milestone {no.Value.ToString(CultureInfo.InvariantCulture)}" : "Milestone";

        var list = new List<SaNotification>();
        SaNotification Notice(string id, string type, string title, string text, string? zedId, string? level, DateTime? date) => new()
        {
            id = id, type = type, title = title, text = text, zedId = zedId?.Trim(), certificationType = level?.Trim(),
            enterpriseName = Clean(units.GetValueOrDefault(Key(zedId, level))?.EnterpriseName), date = Iso(date),
        };

        // From the history: the newest row of each kind per unit, level and milestone.
        foreach (var h in history.GroupBy(h => (Key(h.ZedId, h.CertificationType), h.StatusType?.Trim(), h.NcCount)).Select(g => g.OrderByDescending(x => x.Id).First()))
        {
            var type = h.StatusType?.Trim() ?? "";
            var unit = units.GetValueOrDefault(Key(h.ZedId, h.CertificationType));
            var milestone = h.NcCount ?? unit?.NcCount;
            var id = "h" + h.Id.ToString(CultureInfo.InvariantCulture);
            var what = $"{Unit(h.ZedId, h.CertificationType)} · {Level(h.CertificationType)} · {MilestoneOf(milestone)}";
            if (type == "ScheduledOn")
            {
                var role = unit is null ? "" : (Role(unit, saId) == "Lead" ? "Lead Consultant · " : "Co-Consultant · ");
                var when = unit?.AssessmentDate is { } d && unit.Milestone == milestone
                    ? $" Visit on {d.ToString("dd MMM yyyy", CultureInfo.InvariantCulture)}." : "";
                list.Add(Notice(id, "allotted", "New handholding case assigned", $"{role}{what}.{when}", h.ZedId, h.CertificationType, h.CreatedDate));
            }
            else if (type == "Completed")
                list.Add(Notice(id, "completed", $"{MilestoneOf(milestone)} completed", $"{what}: the Consultant Organisation has completed the milestone.",
                    h.ZedId, h.CertificationType, h.CreatedDate));
            else if (type.Contains("Send back", StringComparison.OrdinalIgnoreCase))
                list.Add(Notice(id, "sentBack", "Sent back to the consultant", $"{what}: {Clean(h.Descrip) ?? "sent back"}.", h.ZedId, h.CertificationType, h.CreatedDate));
        }

        foreach (var r in cases)
        {
            var what = $"{Unit(r.ZedId, r.Certification)} · {Level(r.Certification)} · {MilestoneOf(r.Milestone)}";
            // A milestone visit today or tomorrow that has not started.
            if (r.AssessmentDate is { } date && StageOf(r).Stage == Scheduled && (date.Date == now.Date || date.Date == now.Date.AddDays(1)))
            {
                var today = date.Date == now.Date;
                var where = Clean(r.District) is { } district ? $" at {district}" : "";
                list.Add(Notice($"r-{r.ZedId?.Trim()}-{r.Certification?.Trim()}-{r.Milestone}-{date:yyyyMMdd}", "reminder",
                    today ? "Milestone visit today" : "Milestone visit tomorrow",
                    $"{what}{where}, {date.ToString("dd MMM yyyy, hh:mm tt", CultureInfo.InvariantCulture)}.", r.ZedId, r.Certification, now));
            }
            // The MSME accepted the milestone (status 100), dated by the status date.
            if (r.Status == 100 && r.CertificationStatusDate is { } accepted && accepted >= now.AddDays(-ConsultancySAController.NotificationDays))
                list.Add(Notice($"a-{r.ZedId?.Trim()}-{r.Certification?.Trim()}-{r.Milestone}", "accepted", $"{MilestoneOf(r.Milestone)} accepted",
                    $"{what}: the MSME has accepted the milestone.", r.ZedId, r.Certification, accepted));
        }
        return list.OrderByDescending(n => n.date, StringComparer.Ordinal).Take(100).ToList();
    }

    private static string Key(string? zedId, string? level) => (zedId?.Trim() ?? "").ToUpperInvariant() + "|" + (level?.Trim() ?? "").ToUpperInvariant();
}
