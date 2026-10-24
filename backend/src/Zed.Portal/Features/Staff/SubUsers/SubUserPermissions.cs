using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.SubUsers;

/// <param name="Key">Stored in dbo.V4SubUsers.Permissions.</param>
/// <param name="OwnerRole">The owner role whose screen this is (MasterAdmin or Agency).</param>
/// <param name="Systems">The systems that have the screen.</param>
/// <param name="AnySubRole">The owner needs one of these sub-roles to have the screen (agencies), as its menu entry.</param>
/// <param name="Routes">The Angular screens (menu routes) it opens.</param>
/// <param name="ApiPaths">The API paths those screens call (prefixes, by path segment).</param>
public sealed record SubUserPermission(
    string Key, string Label, UserRole OwnerRole, PortalSystem[] Systems, string[] AnySubRole, string[] Routes, string[] ApiPaths);

/// <summary>
/// The screens an owner can give its sub-users: the owner's own menu (staff-menu.ts), one entry per screen or group of
/// screens, with the API paths behind it. A sub-user's request to /api/staff/… or /api/account/… is let through only when one
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

    /// <summary>The Desktop Assessment details page, opened from monitoring, allotment and the result lists.</summary>
    private const string DaDetails = "/api/staff/assessment/da/";

    public static readonly IReadOnlyList<SubUserPermission> Catalogue =
    [
        // MasterAdmin ("operation admins")
        new("users", "Agencies / organisations and their assessors", UserRole.MasterAdmin, All, None,
            ["/staff/users/agencies", "/staff/users/bronze-agencies", "/staff/users/assessors", "/staff/users/surveillance-agencies", "/staff/users/surveillance-assessors"],
            ["/api/staff/users/agencies", "/api/staff/users/assessors", "/api/staff/surveillance-users"]),
        new("payments", "Payment Received", UserRole.MasterAdmin, All, None,
            ["/staff/payments-received"], ["/api/staff/dashboard/payments-received"]),
        new("allot", "Allotment", UserRole.MasterAdmin, All, None,
            ["/staff/assessment/allot"], ["/api/staff/assessment/allot"]),
        new("monitoring", "Monitoring", UserRole.MasterAdmin, All, None,
            ["/staff/monitoring"], ["/api/staff/monitoring", DaDetails]),
        new("results", "Completed and rejected", UserRole.MasterAdmin, All, None,
            ["/staff/assessment/completed", "/staff/assessment/rejected"], ["/api/staff/assessment/completed", "/api/staff/assessment/rejected", DaDetails]),
        new("password-reset", "Password Reset Link", UserRole.MasterAdmin, All, None,
            ["/staff/users/password-reset"], ["/api/staff/password-reset"]),
        new("history", "ZED ID History", UserRole.MasterAdmin, Main, None,
            ["/staff/history"], ["/api/staff/history"]),
        new("financial-assistance", "Financial Assistance", UserRole.MasterAdmin, Main, None,
            ["/staff/financial-assistance"], ["/api/staff/schemes/fa"]),
        new("incentive-upload", "Upload API Incentives", UserRole.MasterAdmin, Main, None,
            ["/staff/incentives/upload"], ["/api/staff/schemes/incentives/upload", "/api/staff/schemes/incentives/template"]),
        new("technology-upgradation", "Technology Upgradation", UserRole.MasterAdmin, Consultancy, None,
            ["/staff/consultancy/technology"], ["/api/staff/consultancy/tu", "/api/staff/consultancy/technology"]),

        // Agencies, consultant organisations and surveillance agencies
        new("monitoring", "Monitoring", UserRole.Agency, All, SiteOrDesktop,
            ["/staff/monitoring"], ["/api/staff/monitoring", DaDetails]),
        new("assessors", "Assessors / consultants", UserRole.Agency, All, None,
            ["/staff/users/my-assessors", "/staff/users/assessors", "/staff/users/surveillance-assessors"],
            ["/api/staff/users/assessors", "/api/staff/surveillance-users/assessors"]),
        new("da-allotment", "Desktop allotment", UserRole.Agency, [PortalSystem.Main, PortalSystem.Surveillance], [SubRoles.DesktopVerification],
            ["/staff/assessment/da-allotment"], ["/api/staff/assessment/da-allotment", DaDetails]),
        new("sa-allotment", "Site / consultancy allotment", UserRole.Agency, All, [SubRoles.SiteVerification],
            ["/staff/sa-allotment", "/staff/site-assessment/co-allotment"],
            ["/api/staff/site-assessment/allotments", "/api/staff/site-assessment/consultancy/allotments"]),
        new("results", "Completed and rejected", UserRole.Agency, All, SiteOrDesktop,
            ["/staff/assessment/completed", "/staff/assessment/rejected"], ["/api/staff/assessment/completed", "/api/staff/assessment/rejected", DaDetails]),
        new("reports", "Reports", UserRole.Agency, All, None,
            ["/staff/reports"], ["/api/staff/reports"]),
        new("financial-assistance", "Financial Assistance verification", UserRole.Agency, Main, [SubRoles.FinancialVerification],
            ["/staff/financial-assistance"], ["/api/staff/schemes/fa"]),
        new("technology-upgradation", "Technology Upgradation", UserRole.Agency, Consultancy, [SubRoles.FinancialVerification],
            ["/staff/consultancy/technology"], ["/api/staff/consultancy/tu", "/api/staff/consultancy/technology"]),
    ];

    /// <summary>Roles that can have sub-users.</summary>
    public static bool CanOwn(int roleId) => roleId is (int)UserRole.MasterAdmin or (int)UserRole.Agency;

    /// <summary>What an owner with this role and these sub-roles can give, on this system.</summary>
    public static IReadOnlyList<SubUserPermission> For(int roleId, IReadOnlyCollection<string> subRoles, PortalSystem system) =>
        Catalogue.Where(p => (int)p.OwnerRole == roleId && p.Systems.Contains(system)
                             && (p.AnySubRole.Length == 0 || p.AnySubRole.Any(subRoles.Contains))).ToList();

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
        HttpMethods.IsGet(method) && (
            path.Equals("/api/staff/dashboard", StringComparison.OrdinalIgnoreCase)
            || path.Equals("/api/staff/dashboard/counts", StringComparison.OrdinalIgnoreCase)
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
