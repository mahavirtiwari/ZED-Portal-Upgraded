using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.SubUsers;

/// <param name="Key">Stored in dbo.V4SubUsers.Permissions.</param>
/// <param name="OwnerRole">The owner role whose screen this is (MasterAdmin or Agency).</param>
/// <param name="Systems">The systems that have the screen.</param>
/// <param name="AnySubRole">The owner needs one of these sub-roles to have the screen (agencies), as its menu entry.</param>
/// <param name="Routes">The Angular screens (menu routes) it opens.</param>
/// <param name="ApiPaths">The API paths those screens call (prefixes, by path segment).</param>
/// <param name="ConsultancyLabel">2026-11-21 (Assessment Agency UI audit, item 6): the screen's name on the Consultancy portal when
/// it differs (consultants, consultancy allotment); <paramref name="Label"/> is the main and surveillance portals' name.</param>
public sealed record SubUserPermission(
    string Key, string Label, UserRole OwnerRole, PortalSystem[] Systems, string[] AnySubRole, string[] Routes, string[] ApiPaths,
    string? ConsultancyLabel = null)
{
    /// <summary>The screen's name on <paramref name="system"/>.</summary>
    public string LabelFor(PortalSystem system) => system == PortalSystem.Consultancy && ConsultancyLabel is not null ? ConsultancyLabel : Label;
}

/// <summary>
/// The screens an owner can give its sub-users: the owner's own menu (staff-menu.ts), one entry per screen or group of
/// screens, with the API paths behind it. A sub-user's request to /api/staff/… or /api/consultancy/… is let through only when one
/// of its permissions covers the path (<see cref="SubUserAccessFilter"/>), apart from the read-only calls every screen makes
/// (<see cref="AlwaysReadable"/>).
/// </summary>
public static class SubUserPermissions
{
    private static readonly PortalSystem[] All = [PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance];
    private static readonly PortalSystem[] Main = [PortalSystem.Main];
    private static readonly PortalSystem[] Consultancy = [PortalSystem.Consultancy];
    private static readonly string[] None = [];
    private static readonly string[] SiteOrDesktop = [SubRoles.SiteVerification, SubRoles.DesktopVerification];
    /// <summary>2026-11-20 (incentive schemes): an onsite verification agency (its sign-in carries this pseudo sub-role).</summary>
    private static readonly string[] OnsiteAgency = [Incentives.Agencies.IncentiveAgencies.OnsiteSubRole];
    /// <summary>2026-11-20 (the product owner): a desktop verification agency (its sign-in carries this pseudo sub-role).</summary>
    private static readonly string[] DesktopAgency = [Incentives.Agencies.IncentiveAgencies.DesktopSubRole];

    /// <summary>The only screens an onsite verification agency has (and gives its sub-users): its assessors and its scheme onsite work.</summary>
    public static readonly IReadOnlySet<string> OnsiteAgencyKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "assessors", "scheme-onsite" };

    /// <summary>The only screens a desktop verification agency has (and gives its sub-users): its assessors and its scheme allotment and QC.</summary>
    public static readonly IReadOnlySet<string> DesktopAgencyKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "assessors", "scheme-verification" };

    /// <summary>The Desktop Assessment details page, opened from monitoring, allotment and the result lists.</summary>
    private const string DaDetails = "/api/staff/assessment/da/";

    /// <summary>2026-11-24: the incentives dashboard (the Incentives Master Admin's home; Users/IncentivesAdmins), with any incentive screen.</summary>
    private const string IncentivesDashboard = Users.IncentivesAdmins.DashboardApi;

    /// <summary>A handholding milestone page (Consultancy), opened from monitoring and the result lists.</summary>
    private const string Milestones = "/api/consultancy/milestones/";

    /// <summary>2026-11-16: the ZED team's quality observations (an agency sub-user on Monitoring or the results replies to them).</summary>
    private const string QualityObservations = "/api/staff/quality-observations";

    /// <summary>The Consultants list's milestone counts (Consultancy; StaffDashboardController narrows them to an agency's own).</summary>
    private const string ConsultantMilestones = "/api/staff/dashboard/consultant-milestones";

    /// <summary>The API roots whose calls a sub-user needs a permission for (<see cref="SubUserAccessFilter"/>).</summary>
    public static readonly string[] CheckedRoots = ["/api/staff", "/api/consultancy"];

    public static readonly IReadOnlyList<SubUserPermission> Catalogue =
    [
        // MasterAdmin ("operation admins")
        new("users", "Agencies and their assessors", UserRole.MasterAdmin, All, None,
            ["/staff/users/agencies", "/staff/users/bronze-agencies", "/staff/users/assessors", "/staff/users/surveillance-agencies", "/staff/users/surveillance-assessors"],
            // 2026-11-18: the purchase orders card on Agency Level Allocation / the Consultant Organisations page.
            // 2026-11-22 (Consultancy Operation Admin audit: the Consultants list showed every phone "Not registered" and every
            // milestone count 0, both calls answering 403): the registered phones (and their release) and the consultants'
            // milestone counts, as the Master Admin's own list.
            ["/api/staff/users/agencies", "/api/staff/users/assessors", "/api/staff/surveillance-users", "/api/staff/expenditure/po",
             "/api/staff/assessor-mobile", ConsultantMilestones],
            ConsultancyLabel: "Consultant organisations and their consultants"),
        new("payments", "Payment Received", UserRole.MasterAdmin, All, None,
            ["/staff/payments-received"], ["/api/staff/dashboard/payments-received"]),
        new("allot", "Allotment", UserRole.MasterAdmin, All, None,
            ["/staff/assessment/allot"], ["/api/staff/assessment/allot"]),
        new("monitoring", "Monitoring", UserRole.MasterAdmin, All, None,
            ["/staff/monitoring"], ["/api/staff/monitoring", DaDetails, Milestones]),
        new("results", "Completed and rejected", UserRole.MasterAdmin, All, None,
            ["/staff/assessment/completed", "/staff/assessment/rejected"], ["/api/staff/assessment/completed", "/api/staff/assessment/rejected", DaDetails, Milestones]),
        new("password-reset", "Password Reset Link", UserRole.MasterAdmin, All, None,
            ["/staff/users/password-reset"], ["/api/staff/password-reset"]),
        new("history", "ZED ID History", UserRole.MasterAdmin, Main, None,
            ["/staff/history"], ["/api/staff/history"]),
        new("financial-assistance", "Financial Assistance", UserRole.MasterAdmin, Main, None,
            ["/staff/financial-assistance"], ["/api/staff/schemes/fa", IncentivesDashboard]),
        // 2026-11-16 (approved): raise, close and reopen the ZED team's quality observations, and their dashboard.
        new("quality-observations", "Quality observations", UserRole.MasterAdmin, All, None,
            ["/staff/quality-observations"], ["/api/staff/quality-observations"]),
        new("incentive-upload", "Upload API Incentives", UserRole.MasterAdmin, Main, None,
            ["/staff/incentives/upload"], ["/api/staff/schemes/incentives/upload", "/api/staff/schemes/incentives/template", IncentivesDashboard]),
        // 2026-11-18 (approved): Expenditure (cases, payable, POs, the monthly invoices' review).
        new("expenditure", "Expenditure", UserRole.MasterAdmin, [PortalSystem.Main, PortalSystem.Consultancy], None,
            ["/staff/expenditure"], ["/api/staff/expenditure"]),
        // 2026-11-20: the incentive schemes (Features/Incentives).
        new("scheme-applications", "Scheme Applications", UserRole.MasterAdmin, Main, None,
            ["/staff/schemes-verify/applications"], ["/api/staff/scheme-applications", IncentivesDashboard]),
        // 2026-11-20: the incentive verification agencies, desktop and onsite (the key stays: it is stored in dbo.V4SubUsers.Permissions).
        new("scheme-onsite-agencies", "Incentive Verification Agencies", UserRole.MasterAdmin, Main, None,
            ["/staff/scheme-agencies", "/staff/scheme-onsite/agencies"], ["/api/staff/scheme-agencies", "/api/staff/scheme-onsite/agencies", IncentivesDashboard]),
        // 2026-11-26: technology upgradation moved to the incentive schemes (no Operation Admin tick on the consultancy portal).

        // Agencies, consultant organisations and surveillance agencies
        new("monitoring", "Monitoring", UserRole.Agency, All, SiteOrDesktop,
            ["/staff/monitoring", "/staff/quality-observations"], ["/api/staff/monitoring", DaDetails, Milestones, QualityObservations]),
        new("assessors", "Assessors", UserRole.Agency, All, None,
            ["/staff/users/my-assessors", "/staff/users/assessors", "/staff/users/surveillance-assessors"],
            ["/api/staff/users/assessors", "/api/staff/surveillance-users/assessors", ConsultantMilestones], ConsultancyLabel: "Consultants"),
        new("da-allotment", "Desktop allotment", UserRole.Agency, [PortalSystem.Main, PortalSystem.Surveillance], [SubRoles.DesktopVerification],
            ["/staff/assessment/da-allotment"], ["/api/staff/assessment/da-allotment", DaDetails]),
        new("sa-allotment", "Site assessment allotment", UserRole.Agency, All, [SubRoles.SiteVerification],
            ["/staff/sa-allotment", "/staff/site-assessment/co-allotment"],
            ["/api/staff/site-assessment/allotments", "/api/staff/site-assessment/consultancy/allotments"], ConsultancyLabel: "Consultancy allotment"),
        new("results", "Completed and rejected", UserRole.Agency, All, SiteOrDesktop,
            ["/staff/assessment/completed", "/staff/assessment/rejected", "/staff/quality-observations"],
            ["/api/staff/assessment/completed", "/api/staff/assessment/rejected", DaDetails, Milestones, QualityObservations]),
        new("reports", "Reports", UserRole.Agency, All, None,
            ["/staff/reports"], ["/api/staff/reports"]),
        new("financial-assistance", "Financial Assistance verification", UserRole.Agency, Main, [SubRoles.FinancialVerification],
            ["/staff/financial-assistance"], ["/api/staff/schemes/fa"]),
        // 2026-11-18 (approved): the agency's / organisation's monthly invoices (upload, status, its own PDFs).
        // 2026-11-18 (the user): now its Expenditure page: its figures, POs (read-only), cases, the one-time GSTIN / PAN (the key
        // stays "invoices": it is stored in dbo.V4SubUsers.Permissions).
        new("invoices", "Expenditure", UserRole.Agency, [PortalSystem.Main, PortalSystem.Consultancy], None,
            ["/staff/expenditure/invoices"],
            ["/api/staff/expenditure/my", "/api/staff/expenditure/invoices", "/api/staff/expenditure/summary", "/api/staff/expenditure/cases",
             "/api/staff/expenditure/po", "/api/staff/expenditure/tax"]),
        // 2026-11-20 (the product owner): a desktop verification agency's scheme allotment and QC (assessment agencies no longer verify schemes).
        new("scheme-verification", "Scheme allotment and QC", UserRole.Agency, Main, DesktopAgency,
            ["/staff/schemes-verify/allotment", "/staff/schemes-verify/qc"], ["/api/staff/scheme-verification/agency"]),
        // 2026-11-20 (phase 2): an onsite verification agency's scheme onsite allotment and onsite QC.
        new("scheme-onsite", "Scheme onsite allotment and QC", UserRole.Agency, Main, OnsiteAgency,
            ["/staff/scheme-onsite/allotment", "/staff/scheme-onsite/qc"], ["/api/staff/scheme-onsite/agency"]),
    ];

    /// <summary>Roles that can have sub-users.</summary>
    public static bool CanOwn(int roleId) => roleId is (int)UserRole.MasterAdmin or (int)UserRole.Agency;

    /// <summary>What an owner with this role and these sub-roles can give, on this system.</summary>
    public static IReadOnlyList<SubUserPermission> For(int roleId, IReadOnlyCollection<string> subRoles, PortalSystem system)
    {
        // An incentive verification agency has only its own screens (never the assessment ones, nor the other stage's scheme ones).
        // 2026-11-24: an Incentives Master Admin has only the incentive screens (Users/IncentivesAdmins).
        var agency = roleId == (int)UserRole.Agency;
        var only = Users.IncentivesAdmins.Is(roleId, subRoles) ? Users.IncentivesAdmins.Keys
            : !agency ? null
            : subRoles.Contains(Incentives.Agencies.IncentiveAgencies.OnsiteSubRole) ? OnsiteAgencyKeys
            : subRoles.Contains(Incentives.Agencies.IncentiveAgencies.DesktopSubRole) ? DesktopAgencyKeys
            : null;
        // 2026-11-25: the main Master Admin's Operation Admins no longer get the incentive screens (the Incentives Master Admin's).
        var except = roleId == (int)UserRole.MasterAdmin && only is null ? Users.IncentivesAdmins.IncentiveKeys : null;
        return Catalogue.Where(p => (int)p.OwnerRole == roleId && p.Systems.Contains(system)
                                    && (p.AnySubRole.Length == 0 || p.AnySubRole.Any(subRoles.Contains))
                                    && (only is null || only.Contains(p.Key))
                                    && (except is null || !except.Contains(p.Key))).ToList();
    }

    /// <summary>The permissions among <paramref name="keys"/> that the owner can give (unknown or no longer available keys drop out).</summary>
    public static IReadOnlyList<SubUserPermission> Granted(string? keys, int roleId, IReadOnlyCollection<string> subRoles, PortalSystem system)
    {
        var set = Split(keys).ToHashSet(StringComparer.OrdinalIgnoreCase);
        return For(roleId, subRoles, system).Where(p => set.Contains(p.Key)).ToList();
    }

    public static IEnumerable<string> Split(string? keys) =>
        (keys ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    /// <summary>Calls every screen of a sub-user may make whatever it was given: the home dashboard and the read-only MSME views.</summary>
    public static bool AlwaysReadable(string method, string path) =>
        // 2026-11-17: "Export" turns the table the page already shows into a workbook (TableExportController reads nothing).
        (HttpMethods.IsPost(method) && path.Equals("/api/staff/export/xlsx", StringComparison.OrdinalIgnoreCase)) ||
        HttpMethods.IsGet(method) && (
            path.Equals("/api/staff/dashboard", StringComparison.OrdinalIgnoreCase)
            || path.Equals("/api/staff/dashboard/counts", StringComparison.OrdinalIgnoreCase)
            // 2026-11-21 (production: an Operation Admin's dashboard showed "You do not have access"): the dashboard's figures
            // come from /analytics now (StaffDashboardController applies the sub-user's states).
            || path.Equals("/api/staff/dashboard/analytics", StringComparison.OrdinalIgnoreCase)
            // 2026-11-21: the MSME profile's "Edit history" section (read-only, as the profile itself).
            || Under(path, "/api/staff/msme-edit-history")
            // 2026-11-22 (Consultancy Operation Admin audit: a milestone page's checklist answered 403): the submission checklists
            // a case page shows (read-only; the controller's roles still apply).
            || Under(path, "/api/staff/submission-checklists")
            // 2026-11-22 (Consultant Organisation audit): the ZED team's documents for the owner's role (Documents page, read-only).
            || Under(path, "/api/staff/documents")
            // 2026-11-26: an incentive verification agency's home (its own applications; the controller refuses the other agencies).
            || path.Equals(IncentivesDashboard, StringComparison.OrdinalIgnoreCase)
            // 2026-11-17: the header's bell; it lists only the screens the sub-user was given (AttentionController).
            || path.Equals("/api/staff/attention", StringComparison.OrdinalIgnoreCase)
            || Under(path, "/api/staff/msme-profile")
            || Under(path, "/api/staff/certification-documents"));

    /// <summary>Whether <paramref name="path"/> is <paramref name="prefix"/> or below it (whole path segments).</summary>
    public static bool Under(string path, string prefix)
    {
        var p = prefix.TrimEnd('/');
        return path.StartsWith(p, StringComparison.OrdinalIgnoreCase) && (path.Length == p.Length || path[p.Length] == '/');
    }

    public static bool Covers(IEnumerable<SubUserPermission> granted, string path) =>
        granted.Any(g => g.ApiPaths.Any(a => Under(path, a)));
}
