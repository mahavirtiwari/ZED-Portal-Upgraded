using Zed.Core.Http;

namespace Zed.Core.Security;

/// <summary>A screen the Admin can give a Dashboard Admin, on the portals that have it.</summary>
/// <param name="Key">Stored as "{portal}:{key}" in dbo.Users.ScreenAccess (migration 0058), e.g. "consultancy:reports".</param>
/// <param name="ApiPrefixes">The staff APIs the screen uses (a call outside every granted screen's prefixes is refused).</param>
/// <param name="Routes">The pages (the menu shows them; Angular routes).</param>
public sealed record DashboardScreen(string Key, string Label, string Group, string? Hint, PortalSystem[] Systems, string[] ApiPrefixes, string[] Routes);

/// <summary>
/// One Dashboard Admin (2026-11-07, at the Admin's request): the three dashboard logins (Super Admin, Citizen Feedback, QC)
/// become one login type, "Dashboard Admin" (Users.RoleId 10), and the Admin ticks, per portal, the dashboard tabs and modules
/// it opens (dbo.Users.ScreenAccess, comma-separated "{portal}:{key}"; NULL = every screen, as a Super Admin had). It signs in
/// on the main portal and opens the Consultancy and Surveillance portals' screens from there (the hand-over of
/// Staff/AdminPortals). <see cref="HideNames"/> keeps the old QC login's rule: agency and assessor names are not shown.
/// </summary>
public static class DashboardScreens
{
    public const string HideNames = "hide-names";
    /// <summary>
    /// The Super Admin's changes (2026-11-08): resend an MSME's login details, deactivate an MSME, edit an MSME's profile, update a
    /// failed payment. Not a screen: a permission, ticked per portal (the old Citizen Feedback and QC logins did not have them).
    /// </summary>
    public const string Edits = "edits";
    private static readonly PortalSystem[] All = [PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance];

    /// <summary>The pages a unit's details open from (registered MSMEs, history).</summary>
    private static readonly string[] UnitDetailApis =
    [
        "/api/staff/msme-profile", "/api/staff/msme-edit-history", "/api/staff/assessment/da", "/api/staff/site-review",
        "/api/staff/app-form-values", "/api/staff/certification-documents", "/api/staff/pledge-certificate",
    ];

    public static readonly IReadOnlyList<DashboardScreen> Screens =
    [
        new("dash-registered", "ZED Dashboard", "Dashboard tabs", "Registered units, charts", All,
            ["/api/staff/dashboard/analytics", "/api/staff/dashboard/counts"], ["/staff/dashboard"]),
        new("dash-certified", "ZED Certification", "Dashboard tabs", "Certified units, status cards", All,
            ["/api/staff/dashboard/analytics", "/api/staff/dashboard/counts"], ["/staff/dashboard"]),
        new("registered-msme", "Registered MSMEs", "Modules", null, All,
            ["/api/staff/dashboard/registered-msme", .. UnitDetailApis], ["/staff/registered-msme", "/staff/msme-profile", "/staff/assessment/da-details", "/staff/site-review", "/staff/pledge-certificate"]),
        new("failed-transactions", "Failed Transactions", "Modules", null, All,
            ["/api/staff/dashboard/failed-transactions"], ["/staff/failed-transactions"]),
        new("financial-support", "Financial Support", "Modules", null, [PortalSystem.Main, PortalSystem.Surveillance],
            ["/api/staff/dashboard/financial-support"], ["/staff/financial-support"]),
        new("incentive-submissions", "Incentive Submissions", "Modules", null, [PortalSystem.Main],
            ["/api/staff/schemes/incentives/submissions"], ["/staff/incentives/submissions"]),
        new("reports", "Reports", "Modules", null, All, ["/api/staff/reports"], ["/staff/reports"]),
        new("history", "MSME / Customer History", "Modules", null, All,
            ["/api/staff/history", .. UnitDetailApis], ["/staff/history", "/staff/msme-profile"]),
        // Main and Consultancy have staff documents (Admin → Documents/Videos); Surveillance has none.
        new("documents", "Documents", "Modules", null, [PortalSystem.Main, PortalSystem.Consultancy], ["/api/staff/documents"], ["/staff/documents"]),
        new(Edits, "Can make changes", "Permissions", "Resend login details, deactivate an MSME, edit a profile, update a failed payment", All, [], []),
        new(HideNames, "Hide agency and assessor names", "Privacy", "As the QC login did", All, [], []),
    ];

    /// <summary>Calls every Dashboard Admin may make (sign-in, the hand-over, the dashboard's own tiles).</summary>
    private static readonly string[] Always = ["/api/staff/auth", "/api/staff/admin-portals"];

    public static string KeyOf(PortalSystem system) => system.ToString().ToLowerInvariant();

    /// <summary>The ticked "{portal}:{key}" entries of a stored value (null = no limit).</summary>
    public static IReadOnlySet<string>? Parse(string? stored) =>
        stored is null ? null
            : stored.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).ToHashSet(StringComparer.OrdinalIgnoreCase);

    public static bool IsLimited(ZedUser user) => user.RoleId == (int)UserRole.SuperAdmin && user.Screens is not null;

    public static bool Has(ZedUser user, PortalSystem system, string key) =>
        !IsLimited(user) || Parse(user.Screens)!.Contains(KeyOf(system) + ":" + key);

    /// <summary>A permission or privacy setting, not a screen (it opens nothing by itself).</summary>
    public static bool IsSetting(string key) => key is HideNames or Edits;

    /// <summary>A Dashboard Admin's changes (<see cref="Edits"/>): every Dashboard Admin with every screen (NULL), else ticked.</summary>
    public static bool MayEdit(ZedUser user, PortalSystem system) => user.RoleId == (int)UserRole.SuperAdmin && Has(user, system, Edits);

    /// <summary>The old QC login, or a Dashboard Admin the Admin set to hide them.</summary>
    public static bool HidesNames(ZedUser user, PortalSystem system) =>
        user.RoleId == (int)UserRole.QC || (IsLimited(user) && Parse(user.Screens)!.Contains(KeyOf(system) + ":" + HideNames));

    /// <summary>Whether a limited Dashboard Admin may call a staff API on this portal.</summary>
    public static bool Allows(ZedUser user, PortalSystem system, string path)
    {
        if (!IsLimited(user)) return true;
        if (Always.Any(p => Under(path, p))) return true;
        var granted = Parse(user.Screens)!;
        var portal = KeyOf(system) + ":";
        var mine = Screens.Where(s => s.Systems.Contains(system) && granted.Contains(portal + s.Key)).ToList();
        // The dashboard's own summary (GET api/staff/dashboard) with any of its tabs.
        if (string.Equals(path.TrimEnd('/'), "/api/staff/dashboard", StringComparison.OrdinalIgnoreCase))
            return mine.Any(s => s.Key.StartsWith("dash-", StringComparison.Ordinal));
        return mine.Any(s => s.ApiPrefixes.Any(p => Under(path, p)));
    }

    /// <summary>The pages of a limited Dashboard Admin on any portal (the main portal's menu; null = every page).</summary>
    public static IReadOnlyList<string>? Routes(ZedUser user)
    {
        if (!IsLimited(user)) return null;
        var granted = Parse(user.Screens)!;
        return Screens.Where(s => granted.Any(g => g.EndsWith(":" + s.Key, StringComparison.OrdinalIgnoreCase)))
            .SelectMany(s => s.Routes).Distinct().ToList();
    }

    /// <summary>Whether a limited Dashboard Admin has anything on a portal (it is handed over there only then).</summary>
    public static bool HasAny(ZedUser user, PortalSystem system) =>
        !IsLimited(user) || Parse(user.Screens)!.Any(g => g.StartsWith(KeyOf(system) + ":", StringComparison.OrdinalIgnoreCase) && !IsSetting(g[(g.IndexOf(':') + 1)..]));

    private static bool Under(string path, string prefix) =>
        path.Equals(prefix, StringComparison.OrdinalIgnoreCase) || path.StartsWith(prefix + "/", StringComparison.OrdinalIgnoreCase);
}
