using System.Data.Common;
using System.Globalization;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Zed.Core.Assessment;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Mobile;
using Zed.Core.Security;
using Zed.Main.MobileApi.Models.Assessor;

namespace Zed.Main.MobileApi.Controllers;

/// <summary>
/// V4, for the redesigned site assessor app (SA app 2.0): the assessor signs in with the assessor ID and password only
/// (<see cref="SignIn"/>), sees a dashboard of all its assessments (<see cref="Assessments"/>, <see cref="Notifications"/>,
/// <see cref="Reports"/>) and opens one unit at a time (<see cref="Assessment"/>, the answer SA/Login gives for that unit).
/// The writes stay the SA/Submit* calls, each checking the allotment, the stage and the token's assessor itself.
/// <para>
/// The sign-in makes the checks of SA/Login (version gate, throttle, password, master-password block, Users row with
/// RoleId 3 and site verification) and issues the app token without a unit. The reads are new calls that only the new app
/// makes, so they need a valid app token of the assessor named in them whatever <c>Mobile:AppTokens</c> says
/// (<see cref="DeviceBoundAttribute.TokenRequired"/>; the installed app stays on Monitor), and the assessor's Users row must
/// still be an active site assessor. Data comes from the legacy tables only (no new table or column).
/// </para>
/// </summary>
public sealed partial class SAController
{
    /// <summary>Finished assessments stay on the dashboard this long (certified, rejected).</summary>
    internal const int FinishedMonths = 12;

    /// <summary>Notifications from the unit's history cover this many days.</summary>
    internal const int NotificationDays = 30;

    // ------------------------------------------------------------------ Sign-in

    /// <summary>
    /// The assessor's sign-in without a ZED ID: SP_APP_SA_CHECK_LOGIN with no unit (its unit sets are then empty) and the
    /// checks of <see cref="Login"/>. Answers the app token (no unit), the profile, the assessments and the site tour sections.
    /// </summary>
    [HttpPost]
    [LoginAudit(LoginChannels.Mobile, "Site assessment app")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public Task<IActionResult> SignIn(SaSignInRequest request, CancellationToken ct) => Guarded(nameof(SignIn), async () =>
    {
        var signIn = await CheckSignInAsync(request.assessorId, request.password, request.version, null, ct);
        if (signIn.Refusal is { } refusal) return LegacyJson(new SaSignInResponse { status = refusal.Status, errorMessage = refusal.Message });

        var userKey = signIn.UserKey!;
        if (await OtherPhoneAsync(userKey, request.deviceInfo, ct) is { } phone) return LegacyJson(new SaSignInResponse { status = "0", errorMessage = phone });
        var assessments = await AssessmentListAsync(userKey, ct);
        var response = new SaSignInResponse
        {
            status = "1",
            profile = await ProfileAsync(signIn.User!, userKey, ct),
            counts = Count(assessments),
            assessments = assessments,
            siteTourSections = (await SiteTourSections.LoadAsync(settings, ct)).Where(t => t.Active)
                .Select((t, i) => SiteTourSectionInfo.Of(t, i + 1, 0)).ToList(),
        };

        await RegisterPhoneAsync(userKey, request.deviceInfo, ct);
        // No unit: every SA call checks the allotment of the unit it names against the token's assessor.
        response.appToken = await tokens.IssueAsync(MobileApps.SiteAssessor, userKey, null, ct);
        log.LogInformation("SA app sign-in for {UserId} ({Count} assessments)", userKey, assessments.Count);
        return LegacyJson(response);
    });

    // ------------------------------------------------------------------ Dashboard reads

    /// <summary>The units the assessor is lead or co-assessor of: open ones, and those finished in the last <see cref="FinishedMonths"/> months.</summary>
    [HttpPost]
    [DeviceBound(MobileApps.SiteAssessor, "saId", TokenRequired = true)]
    public Task<IActionResult> Assessments(SaRequest request, CancellationToken ct) => Guarded(nameof(Assessments), async () =>
    {
        if (await AssessorRefusalAsync(nameof(Assessments), request.saId, ct) is { } refused) return refused;
        var list = await AssessmentListAsync(request.saId!.Trim(), ct);
        return LegacyJson(new SaAssessmentsResponse { status = "1", counts = Count(list), assessments = list });
    });

    /// <summary>
    /// One unit, exactly as <see cref="Login"/> answered it (same shape, same "not allocated" / "closed" refusals), without
    /// the password and without a new token. SP_APP_SA_CHECK_LOGIN picks the unit's open certification itself (SiteAssessorId
    /// set, SaCertificateNo empty); a <c>certificationType</c> that is not that one is refused as not allocated.
    /// </summary>
    [HttpPost]
    [DeviceBound(MobileApps.SiteAssessor, "saId", TokenRequired = true)]
    public Task<IActionResult> Assessment(SaAssessmentRequest request, CancellationToken ct) => Guarded(nameof(Assessment), async () =>
    {
        if (await AssessorRefusalAsync(nameof(Assessment), request.saId, ct) is { } refused) return refused;
        if (string.IsNullOrWhiteSpace(request.zedId))
            return LegacyJson(new AssessmentDetails { status = "0", errorMessage = NotAllocated + request.zedId });

        // The login procedure with a password nothing matches: set 0 (the Users row) stays empty, the unit's sets are as at login.
        var sets = await db.QueryProcMultipleAsync("SP_APP_SA_CHECK_LOGIN",
            new { ZedId = request.zedId, UserId = request.saId!.Trim(), Password = PasswordStore.RefusedValue }, ct);
        if (!string.IsNullOrWhiteSpace(request.certificationType) && sets[1].FirstOrDefault() is { } open &&
            !Same(open.Text("CertificationType"), request.certificationType))
        {
            log.LogInformation("SA/Assessment: {ZedId} {Requested} asked by {SaId}, open level is {Level}", request.zedId,
                request.certificationType, request.saId, open.Text("CertificationType"));
            return LegacyJson(new AssessmentDetails { status = "0", errorMessage = NotAllocated + request.zedId });
        }

        var answer = await UnitAnswerAsync(sets, request.zedId, ct);
        return LegacyJson(answer.Response ?? new AssessmentDetails { status = "0", errorMessage = answer.Refusal });
    });

    /// <summary>
    /// Read-only notices made from the data that exists (no notification table): allotments, NC rounds raised, certificates
    /// issued, send-backs and rejections from MsmeHistory of the last <see cref="NotificationDays"/> days; reminders for a site
    /// assessment today or tomorrow; NC answers waiting for the lead assessor's review on the web (status 14, Nc{n}Status 2).
    /// Newest first. The ids are stable, so the app can remember which it has shown.
    /// </summary>
    [HttpPost]
    [DeviceBound(MobileApps.SiteAssessor, "saId", TokenRequired = true)]
    public Task<IActionResult> Notifications(SaRequest request, CancellationToken ct) => Guarded(nameof(Notifications), async () =>
    {
        if (await AssessorRefusalAsync(nameof(Notifications), request.saId, ct) is { } refused) return refused;
        var saId = request.saId!.Trim();
        var rows = await RowsAsync(SaAppData.AssessmentsSql, saId, DateTime.Now.AddMonths(-FinishedMonths), ct);
        var history = await db.QuerySqlAsync<SaAppData.HistoryRow>(SaAppData.HistorySql,
            new { UserId = Ansi(saId), Since = DateTime.Now.AddDays(-NotificationDays) }, ct);
        return LegacyJson(new SaNotificationsResponse { status = "1", notifications = SaAppData.Notifications(rows, history, saId, DateTime.Now) });
    });

    /// <summary>
    /// The assessments the assessor has submitted (closing meeting done, status 13 on), the rejected and reset copies of a unit
    /// included, with whether the portal can draw the report (certified or rejected record) and its address there.
    /// </summary>
    [HttpPost]
    [DeviceBound(MobileApps.SiteAssessor, "saId", TokenRequired = true)]
    public Task<IActionResult> Reports(SaRequest request, CancellationToken ct) => Guarded(nameof(Reports), async () =>
    {
        if (await AssessorRefusalAsync(nameof(Reports), request.saId, ct) is { } refused) return refused;
        var saId = request.saId!.Trim();
        var rows = await RowsAsync(SaAppData.ReportsSql, saId, null, ct);
        return LegacyJson(new SaReportsResponse { status = "1", reports = rows.Select(r => SaAppData.Report(r, saId)).ToList() });
    });

    // ------------------------------------------------------------------ Helpers

    private async Task<List<SaAssessment>> AssessmentListAsync(string saId, CancellationToken ct) =>
        (await RowsAsync(SaAppData.AssessmentsSql, saId, DateTime.Now.AddMonths(-FinishedMonths), ct)).Select(r => SaAppData.Assessment(r, saId)).ToList();

    private Task<IReadOnlyList<SaAppData.AssessmentRow>> RowsAsync(string sql, string saId, DateTime? since, CancellationToken ct) =>
        db.QuerySqlAsync<SaAppData.AssessmentRow>(sql, new { UserId = Ansi(saId), Since = since }, ct);

    private static SaCounts Count(IReadOnlyCollection<SaAssessment> list) => new()
    {
        total = list.Count,
        upcoming = list.Count(a => a.stage == SaAppData.Scheduled),
        ongoing = list.Count(a => a.stage == SaAppData.InProgress),
        submitted = list.Count(a => a.stage is SaAppData.Submitted or SaAppData.NcRound or SaAppData.UnderReview),
        certified = list.Count(a => a.stage == SaAppData.Certified),
        closed = list.Count(a => a.stage is SaAppData.Rejected or SaAppData.Closed),
    };

    /// <summary>
    /// The token proves the sign-in; the Users row must still be what SA/Login lets in (RoleId 3, site verification, active),
    /// else the app is signed out. Null when the call may go on.
    /// </summary>
    private async Task<IActionResult?> AssessorRefusalAsync(string action, string? saId, CancellationToken ct)
    {
        var user = string.IsNullOrWhiteSpace(saId) ? null
            : (await db.QuerySqlAsync<SaAppData.UserRow>(SaAppData.AssessorSql, new { UserId = Ansi(saId.Trim()) }, ct)).FirstOrDefault();
        if (user is { RoleId: 3, IsActive: true, SiteVerification: true }) return null;
        log.LogWarning("Refused SA/{Action}: {SaId} is not an active site assessor", action, saId);
        return Fail(AppTokens.ExpiredMessage);
    }

    /// <summary>The profile from the Users row SP_APP_SA_CHECK_LOGIN answered (SELECT *: Main's and Surveillance's columns differ).</summary>
    private async Task<SaProfile> ProfileAsync(IDictionary<string, object?> user, string userKey, CancellationToken ct)
    {
        string? T(string column) => user.Text(column) is { Length: > 0 } v ? v.Trim() : null;
        var agencyId = T("CreatedBy");
        // The agency that created the assessor: its name and contact for the app's Help page.
        var agency = agencyId is null ? null
            : (await db.QuerySqlAsync<SaAppData.AgencyRow>(SaAppData.AgencySql, new { UserId = Ansi(agencyId) }, ct)).FirstOrDefault();
        static string? Clean(string? v) => string.IsNullOrWhiteSpace(v) ? null : v.Trim();
        var assessorType = T("AssessorType");
        return new SaProfile
        {
            assessorId = userKey,
            name = T("UserName"),
            email = T("Email"),
            mobile = T("MobileNo"),
            assessorType = assessorType,
            certificateNo = T("CertificateNo"),
            sectorActivity = T("SectorActivity"),
            agencyId = agencyId,
            agencyName = Clean(agency?.UserName),
            agencyEmail = Clean(agency?.Email),
            agencyMobile = Clean(agency?.MobileNo),
            desktopVerification = user.Bool("DesktopVerification"),
            siteVerification = user.Bool("SiteVerification"),
            levels = await LevelsAsync(assessorType, ct),
        };
    }

    /// <summary>
    /// The levels the assessor may assess, as far as the data says: the site levels (dbo.SectionTypes, AssessmentMode 'Site',
    /// enabled; migration 0028) for a site assessor, which every assessor who can sign in is, and Bronze (desktop) for a Bronze
    /// assessor (Users.AssessorType 'BronzeAssessor', whom the agency's Bronze allotment lists). Without the level settings:
    /// Silver and Gold.
    /// </summary>
    private async Task<List<SaLevel>> LevelsAsync(string? assessorType, CancellationToken ct)
    {
        List<SaLevel> site;
        try
        {
            site = (await db.QuerySqlAsync<SaAppData.LevelRow>(SaAppData.LevelsSql, null, ct))
                .Where(l => string.Equals(l.AssessmentMode?.Trim(), "Site", StringComparison.OrdinalIgnoreCase) && !string.IsNullOrWhiteSpace(l.SectionType))
                .Select(l => new SaLevel { code = l.SectionType!.Trim(), name = l.DisplayName?.Trim() is { Length: > 0 } n ? n : SaAppData.LevelName(l.SectionType), mode = "Site" })
                .ToList();
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Certification levels not read (is migration 0028 applied?)");
            site = [];
        }
        if (site.Count == 0)
            site = new[] { "Silver", "Gold" }.Select(l => new SaLevel { code = l, name = l, mode = "Site" }).ToList();
        if (string.Equals(assessorType, "BronzeAssessor", StringComparison.OrdinalIgnoreCase))
            site.Insert(0, new SaLevel { code = "Bronze", name = "Bronze", mode = "Desktop" });
        return site;
    }

    private static DbString Ansi(string? value) => new() { Value = value, IsAnsi = true, Length = 50 };
}

/// <summary>Queries and mapping of the SA app 2.0 reads (Main's and Surveillance's databases have the columns used here).</summary>
public static class SaAppData
{
    public const string Scheduled = "scheduled";
    public const string InProgress = "inProgress";
    public const string Submitted = "submitted";
    public const string NcRound = "ncRound";
    public const string UnderReview = "underReview";
    public const string Certified = "certified";
    public const string Rejected = "rejected";
    public const string Closed = "closed";

    /// <summary>The site assessment levels (RemoteAssessmentController.Levels); Bronze has no site assessment.</summary>
    /// 2026-11-08: every site level of Administration → Certification Levels (codes are letters and digits).
    public static string SiteLevels => string.Join(", ", LevelRegistry.Codes.Where(c => !LevelRegistry.IsDesktop(c)).Select(c => $"'{c}'"));

    /// <summary>
    /// One row per certification of the assessor (lead or co-assessor), with the unit, the team, the unit's representative and
    /// location, and whether the open meeting is in. The two allotment columns are searched separately (UNION), so each can use
    /// an index; the per-unit look-ups seek by ZED ID. A rejected or reset copy (ZedId with "_") is matched to its unit by
    /// its base ZED ID.
    /// </summary>
    private const string Select = """
         C.ZedId, K.BaseZedId, C.Certification, C.CertificationStatus, C.CertificationStatusDate, C.AssessmentDate, C.ModeOfAssessment,
               C.NcCount, C.Nc1Status, C.Nc2Status, C.Nc3Status, C.Nc4Status, C.Nc5Status, C.JoinRoomStatus,
               C.SiteAssessorId, L.UserName AS LeadName, L.Email AS LeadEmail, L.MobileNo AS LeadMobile,
               C.CoAssessorId, O.UserName AS CoName, O.Email AS CoEmail, O.MobileNo AS CoMobile,
               ISNULL(B.EnterpriseName, M.EnterpriseName) AS EnterpriseName, M.PUnitName AS UnitName, M.PAddress AS Address,
               M.PDistrictName AS District, M.PStateName AS State, M.PPin AS Pincode, M.OwnerName, M.MobileNo AS UnitMobile,
               B.EmailId AS UnitEmail, R.RepresentativeName, R.Designation AS RepresentativeDesignation,
               ISNULL(G.Latitude, OM.Latitude) AS Latitude, ISNULL(G.Longitude, OM.Longitude) AS Longitude,
               CAST(CASE WHEN OM.Id IS NULL THEN 0 ELSE 1 END AS bit) AS OpenMeetingSubmitted
        FROM (SELECT Id FROM dbo.MsmeCertifications WHERE SiteAssessorId = @UserId
              UNION SELECT Id FROM dbo.MsmeCertifications WHERE CoAssessorId = @UserId) X
        INNER JOIN dbo.MsmeCertifications C ON C.Id = X.Id
        CROSS APPLY (SELECT LEFT(C.ZedId, CHARINDEX('_', C.ZedId + '_') - 1) AS BaseZedId) K
        OUTER APPLY (SELECT TOP (1) EnterpriseName, PUnitName, PAddress, PDistrictName, PStateName, PPin, OwnerName, MobileNo
                     FROM dbo.Msme WHERE ZedId = K.BaseZedId) M
        OUTER APPLY (SELECT TOP (1) EnterpriseName, EmailId FROM dbo.MsmeBasicInformation WHERE ZedId = K.BaseZedId) B
        OUTER APPLY (SELECT TOP (1) UserName, Email, MobileNo FROM dbo.Users WHERE UserId = C.SiteAssessorId) L
        OUTER APPLY (SELECT TOP (1) UserName, Email, MobileNo FROM dbo.Users WHERE UserId = C.CoAssessorId) O
        OUTER APPLY (SELECT TOP (1) RepresentativeName, Designation FROM dbo.MsmeSelfies
                     WHERE ZedId = C.ZedId AND Certification = C.Certification AND RepresentativeName IS NOT NULL ORDER BY Id DESC) R
        OUTER APPLY (SELECT TOP (1) Latitude, Longitude FROM dbo.MsmeLocations
                     WHERE ZedId = C.ZedId AND Certification = C.Certification AND Latitude IS NOT NULL ORDER BY Id DESC) G
        OUTER APPLY (SELECT TOP (1) Id, Latitude, Longitude FROM dbo.Meetings
                     WHERE ZedId = C.ZedId AND CertificationType = C.Certification AND AssessorId = C.SiteAssessorId
                       AND MeetingType = 'Open Meeting' ORDER BY Id DESC) OM
        """;

    /// <summary>
    /// The dashboard: the unit's own certification rows (no copies) from the allotment (status 8) on; finished ones (above 15)
    /// while their status date (else the assessment date) is after @Since.
    /// </summary>
    public static string AssessmentsSql => "SELECT TOP (500)" + Select + """

        WHERE C.Certification IN (
        """ + SiteLevels + """
        ) AND C.CertificationStatus >= 8 AND CHARINDEX('_', C.ZedId) = 0
          AND (C.CertificationStatus <= 15 OR ISNULL(C.CertificationStatusDate, C.AssessmentDate) >= @Since)
        ORDER BY C.AssessmentDate DESC;
        """;

    /// <summary>Reports: every record from the closing meeting (status 13) on, rejected and reset copies included, newest first.</summary>
    public static string ReportsSql => "SELECT TOP (200)" + Select + """

        WHERE C.Certification IN (
        """ + SiteLevels + """
        ) AND C.CertificationStatus >= 13
        ORDER BY ISNULL(C.CertificationStatusDate, C.AssessmentDate) DESC;
        """;

    /// <summary>The assessor's Users row, for the checks of the reads.</summary>
    public const string AssessorSql =
        "SELECT TOP (1) UserId, RoleId, IsActive, SiteVerification FROM dbo.Users WHERE UserId = @UserId;";

    public const string AgencySql = "SELECT TOP (1) UserName, Email, MobileNo FROM dbo.Users WHERE UserId = @UserId;";

    public sealed class AgencyRow
    {
        public string? UserName { get; init; }
        public string? Email { get; init; }
        public string? MobileNo { get; init; }
    }

    public const string LevelsSql =
        "SELECT SectionType, DisplayName, AssessmentMode FROM dbo.SectionTypes WHERE IsCertificationLevel = 1 AND ISNULL(IsEnabled, 1) = 1 ORDER BY OrderNo;";

    /// <summary>MsmeHistory.StatusType values the legacy procedures write that make a notice (the rest are the unit's own steps).</summary>
    public const string HistorySql = """
        SELECT TOP (300) CAST(H.Id AS bigint) AS Id, H.ZedId, H.CertificationType, H.StatusType, H.Descrip, H.CreatedDate
        FROM dbo.MsmeHistory H
        WHERE H.CreatedDate >= @Since
          AND H.StatusType IN ('ScheduledOn', 'GetCertified', 'Agency Send back to Assessor', 'MasterAdmin Send back to Assessor from Rejection',
                               'Unit Rejected due to NCs', 'Assessor Rejected in NC 5', 'Certification auto Rejected due to NC closure time is exceeded',
                               'Nc1Raised', 'Nc2Raised', 'Nc3Raised', 'Nc4Raised', 'Nc5Raised',
                               'Nc1Submitted', 'Nc2Submitted', 'Nc3Submitted', 'Nc4Submitted', 'Nc5Submitted')
          AND EXISTS (SELECT 1 FROM dbo.MsmeCertifications C
                      WHERE C.ZedId = H.ZedId AND C.Certification = H.CertificationType AND (C.SiteAssessorId = @UserId OR C.CoAssessorId = @UserId))
        ORDER BY H.Id DESC;
        """;

    public sealed class AssessmentRow
    {
        public string? ZedId { get; init; }
        public string? BaseZedId { get; init; }
        public string? Certification { get; init; }
        public int? CertificationStatus { get; init; }
        public DateTime? CertificationStatusDate { get; init; }
        public DateTime? AssessmentDate { get; init; }
        public string? ModeOfAssessment { get; init; }
        public int? NcCount { get; init; }
        public int? Nc1Status { get; init; }
        public int? Nc2Status { get; init; }
        public int? Nc3Status { get; init; }
        public int? Nc4Status { get; init; }
        public int? Nc5Status { get; init; }
        public int? JoinRoomStatus { get; init; }
        public string? SiteAssessorId { get; init; }
        public string? LeadName { get; init; }
        public string? LeadEmail { get; init; }
        public string? LeadMobile { get; init; }
        public string? CoAssessorId { get; init; }
        public string? CoName { get; init; }
        public string? CoEmail { get; init; }
        public string? CoMobile { get; init; }
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

        public int Status => CertificationStatus ?? 0;
        public int Nc => NcCount ?? 0;

        /// <summary>Nc{NcCount}Status of the current round: 1 raised, 2 answered by the MSME.</summary>
        public int CurrentNcStatus => Nc switch
        {
            1 => Nc1Status ?? 0, 2 => Nc2Status ?? 0, 3 => Nc3Status ?? 0, 4 => Nc4Status ?? 0, 5 => Nc5Status ?? 0, _ => 0,
        };

        public bool Remote => string.Equals(ModeOfAssessment?.Trim(), "Remote Assessment", StringComparison.OrdinalIgnoreCase);
    }

    public sealed class HistoryRow
    {
        public long Id { get; init; }
        public string? ZedId { get; init; }
        public string? CertificationType { get; init; }
        public string? StatusType { get; init; }
        public string? Descrip { get; init; }
        public DateTime? CreatedDate { get; init; }
    }

    public sealed class UserRow
    {
        public string? UserId { get; init; }
        public int? RoleId { get; init; }
        public bool? IsActive { get; init; }
        public bool? SiteVerification { get; init; }
    }

    public sealed class LevelRow
    {
        public string? SectionType { get; init; }
        public string? DisplayName { get; init; }
        public string? AssessmentMode { get; init; }
    }

    public static string LevelName(string? level) =>
        LevelRegistry.Find(level?.Trim()) is { } known ? known.Name : level?.Trim() ?? "";

    /// <summary>
    /// The app's stage of a certification row. 8: allotted; 9: the lead allotted the parameters, started once the open meeting
    /// is in (remote mode: once the remote assessment was joined, JoinRoomStatus); 13: closing meeting done, the lead reviews
    /// and final-submits on the web; 14: an NC round (answered when Nc{n}Status is 2); 15: NCs closed or none, with the agency;
    /// 16: certified; 17 / 99 / 100: rejected (NC closure missed, rejected record).
    /// </summary>
    public static (string Stage, string Label) StageOf(AssessmentRow r) => r.Status switch
    {
        8 => (Scheduled, "Scheduled"),
        >= 9 and <= 12 => (r.Remote ? r.JoinRoomStatus == 1 : r.OpenMeetingSubmitted) ? (InProgress, "In Progress") : (Scheduled, "Scheduled"),
        13 => (Submitted, "Submitted"),
        14 => (NcRound, r.Nc is >= 1 and <= 5 ? $"NC Round {r.Nc}" + (r.CurrentNcStatus == 2 ? " - Answered" : "") : "NC Round"),
        15 => (UnderReview, "Under Review"),
        16 => (Certified, "Certified"),
        17 or 99 or 100 => (Rejected, "Rejected"),
        _ => (Closed, "Closed"),
    };

    private static bool Same(string? a, string? b) =>
        !string.IsNullOrWhiteSpace(a) && !string.IsNullOrWhiteSpace(b) && string.Equals(a.Trim(), b.Trim(), StringComparison.OrdinalIgnoreCase);

    private static string? Iso(DateTime? d) => d?.ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture);

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    private static List<SaTeamMember> Team(AssessmentRow r)
    {
        var team = new List<SaTeamMember>
        {
            new() { assessorId = Clean(r.SiteAssessorId), name = Clean(r.LeadName), email = Clean(r.LeadEmail), mobile = Clean(r.LeadMobile), role = "Lead", userType = 1 },
        };
        if (Clean(r.CoAssessorId) is { } co)
            team.Add(new SaTeamMember { assessorId = co, name = Clean(r.CoName), email = Clean(r.CoEmail), mobile = Clean(r.CoMobile), role = "Co", userType = 2 });
        return team;
    }

    private static string Role(AssessmentRow r, string saId) => Same(r.SiteAssessorId, saId) ? "Lead" : "Co";

    public static SaAssessment Assessment(AssessmentRow r, string saId)
    {
        var (stage, label) = StageOf(r);
        var representative = Clean(r.RepresentativeName);
        var role = Role(r, saId);
        return new SaAssessment
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
            modeOfAssessment = Clean(r.ModeOfAssessment),
            certificationStatus = r.Status,
            statusDate = Iso(r.CertificationStatusDate),
            stage = stage,
            statusLabel = label,
            ncRound = r.Status == 14 && r.Nc is >= 1 and <= 5 ? r.Nc : 0,
            ncAnswered = r.Status == 14 && r.CurrentNcStatus == 2,
            openMeetingSubmitted = r.OpenMeetingSubmitted,
            canOpen = r.Status is >= 8 and < 13,
            role = role,
            userType = role == "Lead" ? 1 : 2,
            team = Team(r),
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
        };
    }

    /// <summary>Address of the report PDF on the deployment's portal (Zed.Portal AssessorAppController).</summary>
    public static string ReportPath(string zedId, string level) =>
        $"SA/AppReport?zedId={Uri.EscapeDataString(zedId)}&certificationType={Uri.EscapeDataString(level)}";

    public static SaReport Report(AssessmentRow r, string saId)
    {
        var (stage, label) = StageOf(r);
        // As the portal's report download (CertificationDownloads.HasReport): a certified or a rejected record.
        var available = r.Status is 16 or 99 && Clean(r.ZedId) is not null && Clean(r.Certification) is not null;
        return new SaReport
        {
            zedId = Clean(r.ZedId),
            baseZedId = Clean(r.BaseZedId) ?? Clean(r.ZedId),
            certificationType = Clean(r.Certification),
            levelName = LevelName(r.Certification),
            enterpriseName = Clean(r.EnterpriseName),
            district = Clean(r.District),
            state = Clean(r.State),
            assessmentDate = Iso(r.AssessmentDate),
            certificationStatus = r.Status,
            statusDate = Iso(r.CertificationStatusDate),
            stage = stage,
            statusLabel = label,
            role = Role(r, saId),
            team = Team(r),
            reportAvailable = available,
            reportPath = available ? ReportPath(r.ZedId!.Trim(), r.Certification!.Trim()) : null,
        };
    }

    /// <summary>The notices of <see cref="SAController.Notifications"/>, newest first (at most 100).</summary>
    public static List<SaNotification> Notifications(IReadOnlyList<AssessmentRow> rows, IReadOnlyList<HistoryRow> history, string saId, DateTime now)
    {
        var units = rows.GroupBy(r => Key(r.ZedId, r.Certification)).ToDictionary(g => g.Key, g => g.First());
        string Unit(string? zedId, string? level)
        {
            var name = units.GetValueOrDefault(Key(zedId, level))?.EnterpriseName;
            return Clean(name) is { } n ? $"{n} ({zedId?.Trim()})" : zedId?.Trim() ?? "";
        }
        string Level(string? level) => "ZED " + LevelName(level);

        var list = new List<SaNotification>();
        SaNotification Notice(string id, string type, string title, string text, string? zedId, string? level, DateTime? date) => new()
        {
            id = id, type = type, title = title, text = text, zedId = zedId?.Trim(), certificationType = level?.Trim(),
            enterpriseName = Clean(units.GetValueOrDefault(Key(zedId, level))?.EnterpriseName), date = Iso(date),
        };

        // From the history: the newest row of each kind per unit and level.
        foreach (var h in history.GroupBy(h => (Key(h.ZedId, h.CertificationType), h.StatusType?.Trim())).Select(g => g.OrderByDescending(x => x.Id).First()))
        {
            var type = h.StatusType?.Trim() ?? "";
            var unit = units.GetValueOrDefault(Key(h.ZedId, h.CertificationType));
            var id = "h" + h.Id.ToString(CultureInfo.InvariantCulture);
            var what = $"{Unit(h.ZedId, h.CertificationType)} · {Level(h.CertificationType)}";
            if (type == "ScheduledOn")
            {
                var role = unit is null ? "" : (Role(unit, saId) == "Lead" ? "Lead Assessor · " : "Co-Assessor · ");
                var when = unit?.AssessmentDate is { } d ? $" Site assessment on {d.ToString("dd MMM yyyy", CultureInfo.InvariantCulture)}." : "";
                list.Add(Notice(id, "allotted", "New assessment assigned", $"{role}{what}.{when}", h.ZedId, h.CertificationType, h.CreatedDate));
            }
            else if (type.StartsWith("Nc", StringComparison.Ordinal) && type.EndsWith("Raised", StringComparison.Ordinal))
                list.Add(Notice(id, "ncRaised", $"NC round {type[2..^6]} raised", $"{what}: NC round {type[2..^6]} has been raised and waits for the MSME's answers.",
                    h.ZedId, h.CertificationType, h.CreatedDate));
            else if (type == "GetCertified")
                list.Add(Notice(id, "certified", "Certificate issued", $"{what}: the certificate has been issued.", h.ZedId, h.CertificationType, h.CreatedDate));
            else if (type.Contains("Send back", StringComparison.OrdinalIgnoreCase))
                list.Add(Notice(id, "sentBack", "Sent back to the assessor", $"{what}: {Clean(h.Descrip) ?? "sent back"}.", h.ZedId, h.CertificationType, h.CreatedDate));
            else if (type.Contains("Rejected", StringComparison.OrdinalIgnoreCase))
                list.Add(Notice(id, "rejected", "Assessment closed", $"{what}: {Clean(h.Descrip) ?? "rejected"}.", h.ZedId, h.CertificationType, h.CreatedDate));
        }

        foreach (var r in rows)
        {
            var what = $"{Unit(r.ZedId, r.Certification)} · {Level(r.Certification)}";
            // A site assessment today or tomorrow that has not started.
            if (r.AssessmentDate is { } date && StageOf(r).Stage == Scheduled && (date.Date == now.Date || date.Date == now.Date.AddDays(1)))
            {
                var today = date.Date == now.Date;
                var where = Clean(r.District) is { } district ? $" at {district}" : "";
                list.Add(Notice($"r-{r.ZedId?.Trim()}-{r.Certification?.Trim()}-{date:yyyyMMdd}", "reminder",
                    today ? "Site assessment today" : "Site assessment tomorrow",
                    $"{what}{where}, {date.ToString("dd MMM yyyy, hh:mm tt", CultureInfo.InvariantCulture)}.", r.ZedId, r.Certification, now));
            }
            // The MSME answered the current NC round: the lead assessor reviews it on the web.
            if (r.Status == 14 && r.Nc is >= 1 and <= 5 && r.CurrentNcStatus == 2)
            {
                var answered = history.Where(h => Key(h.ZedId, h.CertificationType) == Key(r.ZedId, r.Certification) && h.StatusType?.Trim() == $"Nc{r.Nc}Submitted")
                    .OrderByDescending(h => h.Id).FirstOrDefault();
                list.Add(Notice($"nc-{r.ZedId?.Trim()}-{r.Certification?.Trim()}-{r.Nc}", "ncAnswered", "NC answers to review",
                    $"{what}: the MSME has answered NC round {r.Nc}. The lead assessor reviews it on the ZED portal (Remote / Onsite Assessment).",
                    r.ZedId, r.Certification, answered?.CreatedDate ?? r.CertificationStatusDate));
            }
            // Certified without a history row in the window (certified by a V4 path that writes none): from the status date.
            if (r.Status == 16 && r.CertificationStatusDate is { } certified && certified >= now.AddDays(-SAController.NotificationDays) &&
                !list.Any(n => n.type == "certified" && n.zedId == r.ZedId?.Trim() && n.certificationType == r.Certification?.Trim()))
                list.Add(Notice($"c-{r.ZedId?.Trim()}-{r.Certification?.Trim()}", "certified", "Certificate issued", $"{what}: the certificate has been issued.",
                    r.ZedId, r.Certification, certified));
        }
        return list.OrderByDescending(n => n.date, StringComparer.Ordinal).Take(100).ToList();
    }

    private static string Key(string? zedId, string? level) => (zedId?.Trim() ?? "").ToUpperInvariant() + "|" + (level?.Trim() ?? "").ToUpperInvariant();
}
