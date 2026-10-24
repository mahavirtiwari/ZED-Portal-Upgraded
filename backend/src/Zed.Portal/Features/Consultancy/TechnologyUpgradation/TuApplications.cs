using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Msme;
using Zed.Portal.Features.Staff.Neft;
using Zed.Portal.Features.Staff.Schemes;

namespace Zed.Portal.Features.Consultancy.TechnologyUpgradation;

/// <summary>
/// FinancialAssistance.TechUpgradeStatus in ZED_CONSULTANT (the technology upgradation, TU, workflow). The
/// procedures keep VerificationStatus (<see cref="FaStatus"/>) as on main and set this column beside it.
/// </summary>
public static class TuStatus
{
    /// <summary>Applied on main (SP_APP_MSME_INSERT_TECHNOLOGY_UPGRADATION auto-allots a CO by TuPreferredState); VerificationStatus 1.</summary>
    public const int Applied = 2;
    /// <summary>The CO accepted and allotted a DFO (SP_FINANCIAL_ASSESSMENT_ACCEPT_UNIT_FOR_VERIFICATION); VerificationStatus 2.</summary>
    public const int DfoAllotted = 4;
    /// <summary>The DFO validated a document (SP_FINANCIAL_ASSISTANCE_VALIDATE_EVIDENCES).</summary>
    public const int Verifying = 5;
    /// <summary>The DFO approved; the CO does the QC; VerificationStatus 3.</summary>
    public const int DfoApproved = 6;
    /// <summary>Rejected by the DFO or the master admin; VerificationStatus 5.</summary>
    public const int Rejected = 7;
    /// <summary>The CO approved in QC; waiting for the NEFT payout; VerificationStatus 4.</summary>
    public const int CoApproved = 8;
    /// <summary>The CO sent it back to the DFO (meetings and validations are reset by the procedure); VerificationStatus 2.</summary>
    public const int SentBack = 9;
    /// <summary>The DFO submitted the opening meeting from the app (SP_FINANCIAL_ASSISTANCE_SUBMIT_OPEN_MEETING).</summary>
    public const int MeetingSubmitted = 10;

    /// <summary>The list tabs of SP_FINANCIAL_ASSISTANCE_GET_LIST (2 = 2+4, 5 = 5+10, 9 = 7+9).</summary>
    public static readonly int[] Tabs = [Applied, Verifying, DfoApproved, CoApproved, SentBack];

    /// <summary>The list's landing status for the master admin and the CO (legacy GetSections(99)); the DFO lands on <see cref="Applied"/>.</summary>
    public const int Landing = 99;

    public static string Text(int? tuStatus, int? verificationStatus) => verificationStatus == FaStatus.Reimbursed ? "Reimbursed" : tuStatus switch
    {
        Applied => "Allotted to Consultant Organisation",
        DfoAllotted => "Allotted to MSME-DFO",
        MeetingSubmitted => "Opening meeting submitted",
        Verifying => "Verification in progress",
        DfoApproved => "Approved by MSME-DFO, quality check pending",
        CoApproved => "Approved, payout pending",
        SentBack => "Sent back to MSME-DFO",
        Rejected => "Rejected",
        _ => "",
    };
}

/// <summary>
/// One technology upgradation application with its documents (main's <see cref="FaApplication"/>), the
/// purchased technologies, the DFO's opening meeting and the consultant's recommended technologies, and
/// who may do what with it. Every rule is checked again by the controllers inside <see cref="SchemeLocks"/>.
/// </summary>
public sealed class TuApplication(
    FaApplication fa,
    IReadOnlyList<IDictionary<string, object?>> technologies,
    IReadOnlyList<IDictionary<string, object?>> meetings,
    IReadOnlyList<IDictionary<string, object?>> participants,
    IReadOnlyList<IDictionary<string, object?>> meetingPhotos,
    IReadOnlyList<IDictionary<string, object?>> recommended,
    IReadOnlyList<IDictionary<string, object?>>? attendance = null,
    IDictionary<string, object?>? overview = null,
    IDictionary<string, object?>? location = null)
{
    public FaApplication Fa { get; } = fa;
    public IReadOnlyList<IDictionary<string, object?>> Technologies { get; } = technologies;
    public IReadOnlyList<IDictionary<string, object?>> Meetings { get; } = meetings;
    public IReadOnlyList<IDictionary<string, object?>> Participants { get; } = participants;
    public IReadOnlyList<IDictionary<string, object?>> MeetingPhotos { get; } = meetingPhotos;
    public IReadOnlyList<IDictionary<string, object?>> Recommended { get; } = recommended;
    /// <summary>The DFO's daily attendance from the app (ConsultantDailyAttendance without a milestone) for this level.</summary>
    public IReadOnlyList<IDictionary<string, object?>> Attendance { get; } = attendance ?? [];
    /// <summary>The unit's overview (name, Udyam number, address, milestone completion dates) of the level the technologies were recommended for.</summary>
    public IDictionary<string, object?>? Overview { get; } = overview;
    /// <summary>The unit location: the consultants' milestone-3 opening meeting.</summary>
    public IDictionary<string, object?>? Location { get; } = location;

    public string Certification => Fa.Certification;
    public IDictionary<string, object?> Row => Fa.Row;
    public int Id => Fa.Id;
    public string ZedId => Fa.ZedId;
    public int? Status => Fa.Status;
    public int? Tu => SchemeRows.Int(Row, "TechUpgradeStatus");
    public int? IsApproved => Fa.IsApproved;
    public string AgencyUserId => Fa.AgencyUserId;
    public string AssessorUserId => Fa.AssessorUserId;
    public bool RejectedByAgency => Fa.RejectedByAgency;
    public int? TransactionStatus => SchemeRows.Int(Row, "TransactionStatus");

    /// <summary>The procedure counts TuMeetings rows of this application; the meeting rows are a fallback.</summary>
    public bool MeetingDone => SchemeRows.Int(Row, "MeetingSubmitted") > 0 || Meetings.Count > 0;

    /// <summary>VerificationStatus 4 and the NEFT payout not recorded yet (SP_NEFT_UPDATE_TRANSACTION_STATUS sets 1/2).</summary>
    public bool PayoutPending => Status == FaStatus.Approved && TransactionStatus is not (1 or 2);

    public IDictionary<string, object?>? Technology(int id) => Technologies.FirstOrDefault(t => SchemeRows.Int(t, "Id") == id);

    public IDictionary<string, object?>? MeetingPhoto(int id) => MeetingPhotos.FirstOrDefault(p => SchemeRows.Int(p, "Id") == id);

    public bool IsAgency(ZedUser user) =>
        user.RoleId == (int)UserRole.Agency && user.HasSubRole(SubRoles.FinancialVerification) && SchemeRows.Same(AgencyUserId, user.UserId);

    public bool IsDfo(ZedUser user) =>
        user.RoleId == (int)UserRole.DesktopAssessor && user.HasSubRole(SubRoles.FinancialVerification) && SchemeRows.Same(AssessorUserId, user.UserId);

    /// <summary>
    /// Master admin; the allotted CO; the assigned DFO; a state coordinator for an application in their NEFT lists
    /// (<paramref name="coordinatorInScope"/>, see <see cref="TuCoordinatorScope"/>).
    /// </summary>
    public bool CanView(ZedUser user, bool coordinatorInScope) => user.RoleId switch
    {
        (int)UserRole.MasterAdmin => true,
        (int)UserRole.Agency => IsAgency(user),
        (int)UserRole.DesktopAssessor => IsDfo(user),
        (int)UserRole.StateCoordinator => coordinatorInScope,
        _ => false,
    };

    /// <summary>The DFO validates documents while the application is with them (VerificationStatus 2).</summary>
    public bool CanValidate(ZedUser user) => IsDfo(user) && Status == FaStatus.InProgress;

    /// <summary>
    /// SP_FINANCIAL_ASSISTANCE_FINAL_AUBMIT on the web: the CO in QC (status 3 after the DFO approved) or the master admin
    /// (reject only, <see cref="CanAdminReject"/>; the procedure's RoleId 7 branch). The DFO decides from the consultant
    /// app (<see cref="TuAppController.FinalSubmit"/>): the legacy page has the DFO's ACCEPT / REJECT commented out and
    /// shows the DFO only the ACCEPTED / REJECTED outcome.
    /// </summary>
    public bool CanDecide(ZedUser user) => user.RoleId switch
    {
        (int)UserRole.Agency => IsAgency(user) && Status == FaStatus.Qc && IsApproved == 1,
        (int)UserRole.MasterAdmin => CanAdminReject,
        _ => false,
    };

    /// <summary>
    /// As the legacy page's master admin REJECT (<c>IsApproved==0 &amp;&amp; CertificationBodyUserId==null</c>): before the
    /// DFO's decision and while no CO is set, on an application that is still open.
    /// </summary>
    public bool CanAdminReject =>
        (IsApproved is null or 0) && string.IsNullOrWhiteSpace(AgencyUserId) &&
        (Status is FaStatus.New or FaStatus.InProgress) && Tu != TuStatus.Rejected;

    /// <summary>Approve is offered to the CO in QC; the master admin can only reject.</summary>
    public bool CanApprove(ZedUser user) => user.RoleId != (int)UserRole.MasterAdmin && CanDecide(user);

    /// <summary>
    /// The verified purchase amounts (SP_FINANCIAL_ASSISTANCE_UPDATE_TECHNOLOGY_DATA): the state coordinator,
    /// as on the legacy page, while the payout is pending.
    /// </summary>
    public bool CanEditAmounts(ZedUser user, bool coordinatorInScope) =>
        user.RoleId == (int)UserRole.StateCoordinator && coordinatorInScope && PayoutPending;

    /// <summary>The payout bank account: the state coordinator (legacy page) or the master admin, while the payout is pending.</summary>
    public bool CanEditAccount(ZedUser user, bool coordinatorInScope) => PayoutPending && user.RoleId switch
    {
        (int)UserRole.StateCoordinator => coordinatorInScope,
        (int)UserRole.MasterAdmin => true,
        _ => false,
    };

    /// <summary>The verification report exists once the DFO approved (QC, approved, reimbursed).</summary>
    public bool HasReport => Status is FaStatus.Qc or FaStatus.Approved or FaStatus.Reimbursed;
}

public static class TuApplications
{
    /// <summary>
    /// ZED_CONSULTANT's SP_FINANCIAL_ASSISTANCE_GET_DETAILS: sets 0–8 as on main (applications, documents,
    /// screenshots per level), 9–11 the purchased technologies (TechnologyUpgradation), 12 TuMeetings,
    /// 13 TuMeetingParticipants, 14 TuMeetingPhotos, 15 the DFO's attendance, 16 the unit overview,
    /// 17 the milestone-3 opening meeting location, 18 the recommended technologies.
    /// </summary>
    public static async Task<List<TuApplication>> LoadAsync(ISqlExecutor db, string zedId, CancellationToken ct)
    {
        var sets = await db.QueryProcMultipleAsync("SP_FINANCIAL_ASSISTANCE_GET_DETAILS", new { ZedId = zedId }, ct);
        return FaApplications.FromSets(sets).Select(fa =>
        {
            var level = Array.IndexOf(FaApplications.Certifications, fa.Certification);
            var faId = fa.Row.Text("FinancialAssistanceId");
            bool Own(IDictionary<string, object?> r) => string.IsNullOrEmpty(faId) || r.Text("FinancialAssistanceId") == faId;
            bool Level(IDictionary<string, object?> r, string column) => string.Equals(r.Text(column), fa.Certification, StringComparison.OrdinalIgnoreCase);
            return new TuApplication(fa,
                sets[9 + level].Where(Own).ToList(),
                sets[12].Where(r => Own(r) && Level(r, "CertificationType")).ToList(),
                sets[13].Where(r => Own(r) && Level(r, "CertificationType")).ToList(),
                sets[14].Where(r => Own(r) && Level(r, "Certification")).ToList(),
                sets[18].Where(r => Level(r, "Certification")).ToList(),
                sets[15].Where(r => Level(r, "Certification")).ToList(),
                sets[16].FirstOrDefault(),
                sets[17].FirstOrDefault());
        }).ToList();
    }

    public static async Task<TuApplication?> FindAsync(ISqlExecutor db, string zedId, string certification, CancellationToken ct) =>
        (await LoadAsync(db, zedId, ct)).FirstOrDefault(a => a.Certification == certification);
}

/// <summary>
/// Where the TU files are. Relative paths are resolved under <c>Portal:StorageRoot</c> of the consultancy host
/// (the old <c>/Consultancy</c> site root, which held <c>Uploads/TechnologyUpgradation</c>) and then under
/// <c>Consultancy:SharedStorageRoot</c> (the old main site root, which holds <c>mobileapi/Photos</c>, where the MSME's
/// documents are uploaded from main); the second defaults to the first.
/// <list type="bullet">
/// <item>MSME documents: <c>mobileapi/Photos/{ZedId}/TechnologyUpgradation/{PhotoId}</c> (moved copies under <c>CertifiedPhotos</c>).</item>
/// <item>DFO's validation screenshots: <c>Uploads/TechnologyUpgradation/{ZedId}/{Certification}/Screenshots/{FileName}</c>.</item>
/// <item>Opening meeting photos from the app: <c>Uploads/TechnologyUpgradation/{ZedId}/{Certification}/OpenMeeting/{Name}_{PhotoId}.jpg</c>
/// (the name the procedures rebuild in their <c>src</c> column).</item>
/// </list>
/// </summary>
public sealed class TuStorage(IWebHostEnvironment env, Microsoft.Extensions.Options.IOptions<PortalOptions> portal, IConfiguration config)
{
    public const string SharedRootSetting = "Consultancy:SharedStorageRoot";

    /// <summary>Where this host writes (Portal:StorageRoot).</summary>
    public string OwnRoot => Full(portal.Value.StorageRoot);

    public IEnumerable<string> Roots
    {
        get
        {
            yield return OwnRoot;
            if (config[SharedRootSetting] is { Length: > 0 } shared && Full(shared) is var s && !string.Equals(s, OwnRoot, StringComparison.OrdinalIgnoreCase))
                yield return s;
        }
    }

    private string Full(string path) => Path.GetFullPath(Path.IsPathRooted(path) ? path : Path.Combine(env.ContentRootPath, path));

    /// <summary>The first existing file among the candidates, in either root; every candidate stays under its root.</summary>
    public string? Find(IEnumerable<string> candidates)
    {
        var list = candidates.ToList();
        return Roots.SelectMany(root => list.Select(c => MsmeFilePaths.Resolve(root, c)))
            .FirstOrDefault(p => p is not null && File.Exists(p));
    }

    /// <summary>Full path of a file to write under the own root, or null when the path would leave it.</summary>
    public string? Target(string relative) => MsmeFilePaths.Resolve(OwnRoot, relative);

    public static IEnumerable<string> DocumentCandidates(string zedId, string photoFile)
    {
        yield return $"mobileapi/Photos/{zedId}/TechnologyUpgradation/{photoFile}";
        yield return $"mobileapi/CertifiedPhotos/{zedId}/TechnologyUpgradation/{photoFile}";
    }

    public static string ScreenshotFolder(string zedId, string certification) => $"Uploads/TechnologyUpgradation/{zedId}/{certification}/Screenshots";

    public static string MeetingFolder(string zedId, string certification) => $"Uploads/TechnologyUpgradation/{zedId}/{certification}/OpenMeeting";

    /// <summary>Photo name and id as the app sends them: letters, digits, spaces, '-' and '_' only.</summary>
    public static bool IsPlainName(string? value, int max) =>
        !string.IsNullOrWhiteSpace(value) && value.Length <= max && value.Trim() == value &&
        value.All(c => char.IsAsciiLetterOrDigit(c) || c is ' ' or '-' or '_');

    /// <summary>The DFO's attendance selfies, saved by the consultant app (<c>consultancymobileapi/Attendance/{ZedId}/{Certification}/{PhotoId}.jpg</c>).</summary>
    public static string? AttendanceFile(string zedId, string certification, string? photoId) =>
        IsPlainName(photoId, 100) ? $"consultancymobileapi/Attendance/{zedId}/{certification}/{photoId}.jpg" : null;

    /// <summary><c>{Name}_{PhotoId}.jpg</c> of a meeting photo, or null when either part is not a plain name.</summary>
    public static string? MeetingFile(string? name, string? photoId) =>
        IsPlainName(name, 100) && IsPlainName(photoId, 50) ? $"{name}_{photoId}.jpg" : null;
}

/// <summary>
/// A state coordinator sees a TU application only while it is in their NEFT lists: the rows of
/// SP_NEFT_TRANSACTIONS_BY_STATUS (VerificationStatus 4 for "new", 6 for "approved") for the unit's state,
/// with the same state rule and <c>Neft:AllStatesUserIds</c> exception as <see cref="NeftController"/>.
/// </summary>
public static class TuCoordinatorScope
{
    public static async Task<bool> InScopeAsync(ISqlExecutor db, IConfiguration config, ZedUser user, FaApplication app, CancellationToken ct)
    {
        if (user.RoleId != (int)UserRole.StateCoordinator) return false;
        var list = app.Status switch { FaStatus.Approved => "0", FaStatus.Reimbursed => "1", _ => null };
        if (list is null) return false;
        var rows = (await db.QueryProcMultipleAsync("SP_NEFT_TRANSACTIONS_BY_STATUS", new { Status = list }, ct))[0]
            .Where(r => SchemeRows.Same(r.Text("ZedId"), app.ZedId) && SchemeRows.Same(r.Text("CertificationType"), app.Certification))
            .ToList();
        if (rows.Count == 0) return false;
        var allStates = (config.GetSection("Neft:AllStatesUserIds").Get<string[]>() ?? [])
            .Any(u => string.Equals(u?.Trim(), user.UserId, StringComparison.OrdinalIgnoreCase));
        if (allStates) return true;
        var state = NeftController.NormaliseState(user.StateCode);
        return state is not null && rows.Any(r => NeftController.NormaliseState(r.Text("StateId")) == state || NeftController.NormaliseState(r.Text("PStateId")) == state);
    }
}
