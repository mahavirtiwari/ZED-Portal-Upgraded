using Zed.Core.Http;

namespace Zed.Portal.Features.Staff.Tat;

/// <summary>
/// 2026-11-18 (the user's decisions "TAT and monitoring"): the statuses each portal's cases go through (the codes of
/// MsmeCertifications.CertificationStatus, as the monitoring procedures and the apps read them) and the milestones of a case's
/// history, for Administration → TAT. The Admin gives each status its days per level (dbo.TatStatusDays) and joins two
/// points with a relation (dbo.TatRelations); <see cref="TatEvaluator"/> decides from these which case is delayed.
/// <para>
/// When a case reached a point is read from what the system already records: the current status since
/// MsmeCertifications.CertificationStatusDate, the history lines of dbo.MsmeHistory (StatusType: ApplicationReceived,
/// DocVerifiAllot, ScheduledOn, Nc1Raised, NcClosed, GetCertified, ...), the app's meetings (dbo.Meetings: Open Meeting, Close
/// Meeting) and the lead assessor's parameter distribution (the MsmeHistory line "Sections allocation done ...", written with
/// the move from 8 to 9 by SP_APP_SA_ALLOT_SECTIONS_TO_COASSESSOR). <see cref="Sources"/> names them.
/// </para>
/// </summary>
public static class TatCatalog
{
    /// <summary>A status of the cases (days per level and relation end) or a milestone of the case history (relation end only).</summary>
    public const string StatusKind = "status";
    public const string MilestoneKind = "milestone";

    /// <summary>History sources that are not MsmeHistory.StatusType values.</summary>
    public const string OpenMeeting = "@OpenMeeting";
    public const string CloseMeeting = "@CloseMeeting";
    public const string Distributed = "@Distributed";

    /// <param name="Code">The status number ('15') or the milestone's key ('registered').</param>
    /// <param name="Track">desktop / site for the assessment portals (null: neither); handholding: null.</param>
    /// <param name="Sources">What marks the point reached (MsmeHistory.StatusType values or the @ sources above).</param>
    /// <param name="Final">The case ends here (certified, completed, rejected): no days of its own.</param>
    public sealed record Point(string Code, string Name, string Kind, int Order, string? Track, IReadOnlyList<string> Sources, bool Final = false)
    {
        public bool IsStatus => Kind == StatusKind;
    }

    private static Point S(int code, string name, int order, string? track, params string[] sources) =>
        new(code.ToString(System.Globalization.CultureInfo.InvariantCulture), name, StatusKind, order, track, sources);

    private static Point F(int code, string name, int order, string? track, params string[] sources) =>
        S(code, name, order, track, sources) with { Final = true };

    private static Point M(string code, string name, int order, params string[] sources) => new(code, name, MilestoneKind, order, null, sources);

    public const string Desktop = "desktop";
    public const string Site = "site";

    /// <summary>ZED Certification (main): desktop 2-7, site 8-17 (SP_MONITORING_GET_LIST's stages).</summary>
    public static readonly IReadOnlyList<Point> Assessment =
    [
        M("registered", "Registration (application received)", 5, "ApplicationReceived"),
        S(1, "Payment done, documents pending", 10, null),
        M("documents", "Basic information and documents submitted", 15, "BasicInfoStatus"),
        M("agency", "Allotted to the assessment agency", 17, "AgencyAlloted"),
        S(2, "Desktop assessment scheduled, not started", 20, Desktop, "DocVerifiAllot"),
        S(3, "Desktop assessment in progress", 30, Desktop),
        S(4, "Desktop assessment non-conformance", 40, Desktop),
        S(5, "Desktop assessment quality check", 50, Desktop),
        S(6, "Desktop assessment completed", 60, Desktop, "DesktopVerification", "BronzeDesktopVerification"),
        F(7, "Desktop assessment rejected", 65, Desktop),
        S(8, "Site assessment scheduled, not started", 80, Site, "ScheduledOn"),
        S(9, "Parameters distributed (site assessment in progress)", 90, Site, Distributed),
        M("opening-meeting", "Opening meeting conducted", 95, OpenMeeting),
        S(13, "Assessment submitted through mobile app", 130, Site, CloseMeeting),
        S(14, "Site assessment non-conformance", 140, Site),
        S(15, "Site assessment quality check", 150, Site, "Completed"),
        M("nc-raised", "First non-conformance raised", 152, "Nc1Raised"),
        M("nc-closed", "Non-conformances closed", 155, "NcClosed"),
        F(16, "Certified", 160, null, "GetCertified"),
        F(17, "Site assessment rejected", 170, Site),
        // 2026-11-22 (the product owner: "check all statuses are listed here"): rejected by the agency / Master Admin
        // (CertificationPhase REJECTED; SP_ASSESSMENT_REJECT_* and the Master Admin's rejection set 99).
        F(99, "Rejected", 180, null),
    ];

    /// <summary>
    /// Surveillance: as main, but a desktop surveillance is scheduled at 1 (agency accepted) and runs at 2 and 3 (that portal's
    /// SP_MONITORING_GET_LIST).
    /// </summary>
    public static readonly IReadOnlyList<Point> Surveillance =
    [
        M("registered", "Application received for surveillance", 5, "ApplicationReceived"),
        S(1, "Desktop assessment scheduled, not started", 10, Desktop, "DocVerifiAllot"),
        M("documents", "Basic information and documents submitted", 15, "BasicInfoStatus"),
        S(2, "Desktop assessment started", 20, Desktop),
        S(3, "Desktop assessment in progress", 30, Desktop),
        S(4, "Desktop assessment non-conformance", 40, Desktop),
        S(5, "Desktop assessment quality check", 50, Desktop),
        S(6, "Desktop assessment completed", 60, Desktop, "DesktopVerification"),
        F(7, "Desktop assessment rejected", 65, Desktop),
        S(8, "Site assessment scheduled, not started", 80, Site, "ScheduledOn"),
        S(9, "Parameters distributed (site assessment in progress)", 90, Site, Distributed),
        M("opening-meeting", "Opening meeting conducted", 95, OpenMeeting),
        S(13, "Assessment submitted through mobile app", 130, Site, CloseMeeting),
        S(14, "Site assessment non-conformance", 140, Site),
        S(15, "Site assessment quality check", 150, Site, "Completed"),
        M("nc-raised", "First non-conformance raised", 152, "Nc1Raised"),
        M("nc-closed", "Non-conformances closed", 155, "NcClosed"),
        F(16, "Surveillance completed", 160, null, "GetCertified"),
        F(17, "Site assessment rejected", 170, Site),
        // 2026-11-22: rejected (that portal's rejection procedures set 99), as on main.
        F(99, "Rejected", 180, null),
    ];

    /// <summary>
    /// Handholding (Consultancy): one row per unit and level whose NcCount is the current milestone (ConsultancySAController
    /// StageOf: 8 allotted to the CO, 9 consultants allotted, 13 closing meeting done, 15 with the CO, 16 completed, 100
    /// accepted by the MSME, 99 rejected).
    /// </summary>
    public static readonly IReadOnlyList<Point> Handholding =
    [
        S(1, "Milestone payment done", 10, null, "ApplicationReceived"),
        S(8, "Allotted to the consulting organisation", 80, null, "CoAlloted"),
        S(9, "Consultants allotted", 90, null, "AllocationCompleted"),
        M("opening-meeting", "Opening meeting conducted", 95, OpenMeeting),
        M("bds", "Baseline diagnostic study scheduled", 100, "BdsScheduledOn"),
        M("hap", "Handholding action plan scheduled", 110, "HapScheduledOn"),
        S(13, "Submitted by the consultant (closing meeting done)", 130, null, CloseMeeting),
        S(15, "Quality check by the consulting organisation", 150, null, "SubmittedByConsultant"),
        S(16, "Milestone completed", 160, null),
        F(100, "Deliverables accepted by the MSME", 170, null),
        F(99, "Milestone rejected", 180, null),
    ];

    public static IReadOnlyList<Point> For(PortalSystem system) => system switch
    {
        PortalSystem.Consultancy => Handholding,
        PortalSystem.Surveillance => Surveillance,
        _ => Assessment,
    };

    /// <summary>"Assessment", "Handholding" or "Surveillance": the module the portal's TAT is for.</summary>
    public static string ModuleOf(PortalSystem system) => system switch
    {
        PortalSystem.Consultancy => "Handholding",
        PortalSystem.Surveillance => "Surveillance",
        _ => "Assessment",
    };

    public static Point? Find(PortalSystem system, string? code) =>
        string.IsNullOrWhiteSpace(code) ? null : For(system).FirstOrDefault(p => string.Equals(p.Code, code.Trim(), StringComparison.OrdinalIgnoreCase));

    /// <summary>The statuses that take days (not the final ones).</summary>
    public static IEnumerable<Point> TimedStatuses(PortalSystem system) => For(system).Where(p => p.IsStatus && !p.Final);

    /// <summary>Every history source of the portal's points (the columns the monitoring query reads).</summary>
    public static IReadOnlyList<string> HistoryTypes(PortalSystem system) =>
        For(system).SelectMany(p => p.Sources).Where(s => !s.StartsWith('@')).Distinct(StringComparer.OrdinalIgnoreCase).ToList();

    /// <summary>A relation the Admin can add with one click ("Add suggested relations"); never added on its own.</summary>
    public sealed record Suggestion(string Name, string From, string To, int Days);

    public static IReadOnlyList<Suggestion> Suggestions(PortalSystem system) => system switch
    {
        PortalSystem.Consultancy =>
        [
            new("Milestone payment to deliverables accepted", "1", "100", 90),
            new("Allotment to opening meeting", "8", "opening-meeting", 7),
            new("Consultants allotted to submission", "9", "13", 30),
            new("Submission to quality check completed", "15", "16", 7),
        ],
        PortalSystem.Surveillance =>
        [
            new("Allocation to desktop assessment", "1", "6", 15),
            new("Desktop assessment to NC closure", "4", "nc-closed", 30),
            new("Site assessment to NC closure", "14", "nc-closed", 60),
            new("Site assessment scheduled to submission", "8", "13", 10),
            new("Application to surveillance completed", "registered", "16", 90),
        ],
        _ =>
        [
            new("Allocation to desktop assessment", "2", "6", 15),
            new("Desktop assessment to NC closure", "4", "nc-closed", 30),
            new("Site assessment to NC closure", "14", "nc-closed", 60),
            new("Site assessment scheduled to submission", "8", "13", 10),
            new("Registration to certification", "registered", "16", 90),
        ],
    };
}
