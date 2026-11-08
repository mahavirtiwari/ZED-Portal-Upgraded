using System.Collections.Concurrent;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Caching.Distributed;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Documents;

namespace Zed.Portal.Features.Staff.AdminPortals;

/// <summary>
/// One Admin for the three portals (V4): the Admin signs in on the main portal and works on the Consultancy and
/// Surveillance portals' screens from there (the main Admin's portal switch). Each screen then calls that portal's own
/// API, so it reads and changes that portal's database with that portal's rules, as its own Admin did.
/// <para>
/// Hand-over of the sign-in: the main host stores a one-time pass in the legacy dbo.OTP table of the main database
/// (OtpType "AdminHandoff:{Portal}", MobileNo = the Admin's user id, OTP = SHA-256 of the pass, Response = the name) and
/// gives the pass to the browser; the browser posts it to the other portal's API, which reads the row through its
/// read-only connection to the main database (ConnectionStrings:Main) and signs the Admin in there. A pass is valid
/// for <see cref="Lifetime"/> and once (each host remembers the passes it took, and records them in the distributed cache
/// for the other servers). Only an Admin's own sign-in is handed over (not a sub-user's), only as the Admin role, and only
/// while the account is still an active Admin on main. The session here carries main's session stamp: blocking the Admin,
/// or a new password, on main ends it too (SessionStamps). Main's logout expires this portal's cookie in the browser.
/// </para>
/// <para>
/// One NEFT Admin (2026-11-07): the NEFT Admin (an MSME DFO of every state, see Neft/NeftAdminsController) signs in on main
/// for the financial assistance reimbursements and is handed over the same way to the Consultancy portal for the Technology
/// Upgradation ones (OtpType "NeftHandoff:Consultancy"), as the NEFT Admin there, while it is still an active NEFT Admin
/// on main.
/// </para>
/// <para>
/// One Dashboard Admin (2026-11-07): the Dashboard Admin (Users.RoleId 10) is handed over the same way to the portals where the
/// Admin ticked it screens (OtpType "DashHandoff:{Portal}"), with those screens (read from main's Users.ScreenAccess).
/// </para>
/// </summary>
[ApiController]
[Route("api/staff/admin-portals")]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed class AdminPortalsController(ISqlExecutor db, PortalHost host, ILogger<AdminPortalsController> log) : ControllerBase
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(2);
    public const string TypePrefix = "AdminHandoff:";
    public const string NeftTypePrefix = "NeftHandoff:";
    public const string DashboardTypePrefix = "DashHandoff:";

    public sealed record Portal(string Key, string Name);

    /// <summary>The portals the main Admin works on (the switch); the pages know the other two's API paths (/Consultancy, /surveillance).</summary>
    public static readonly IReadOnlyList<Portal> Portals =
    [
        new("main", "ZED Certification"), new("consultancy", "Consultancy"), new("surveillance", "Surveillance"),
    ];

    private static PortalSystem? SystemOf(string? key) => key?.ToLowerInvariant() switch
    {
        "consultancy" => PortalSystem.Consultancy,
        "surveillance" => PortalSystem.Surveillance,
        _ => null,
    };

    private static string KeyOf(PortalSystem system) => system.ToString().ToLowerInvariant();

    [HttpGet]
    [StaffRoles(UserRole.Admin)]
    public ActionResult<IReadOnlyList<Portal>> List() => host.System == PortalSystem.Main ? Ok(Portals) : NotFound();

    public sealed record HandoffIssued(string Token);

    internal const string InsertSql =
        "INSERT INTO dbo.OTP (OtpType, MobileNo, OTP, Response, CreatedDate) VALUES (@OtpType, @UserId, @Hash, @UserName, GETDATE());";

    /// <summary>POST api/staff/admin-portals/{portal}/handoff (main): a one-time pass to sign in on that portal's API.</summary>
    [HttpPost("{portal}/handoff")]
    [StaffRoles(UserRole.Admin, UserRole.StateCoordinator, UserRole.SuperAdmin)]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<ActionResult<HandoffIssued>> Issue(string portal, CancellationToken ct)
    {
        if (host.System != PortalSystem.Main || SystemOf(portal) is not { } system) return NotFound();
        var user = ZedUser.FromPrincipal(User)!;
        if (user.ActingUserId is not null)
            return Problem(title: "Only the Admin's own login can open the other portals.", statusCode: StatusCodes.Status403Forbidden);
        // An MSME DFO: only the NEFT Admin, only to the Consultancy portal (its Technology Upgradation reimbursements).
        var neft = user.RoleId == (int)UserRole.StateCoordinator;
        // The NEFT Admin, or an MSME DFO given the Handholding (Technology Upgradation) list (2026-11-07).
        var tuList = DashboardScreens.Parse(user.Screens)?.Contains("consultancy:neft") == true;
        if (neft && (!(IsNeftAdmin(user.StateCode) || tuList) || system != PortalSystem.Consultancy)) return NotFound();
        // A Dashboard Admin: only to a portal where it has screens.
        var dashboard = user.RoleId == (int)UserRole.SuperAdmin;
        if (dashboard && !DashboardScreens.HasAny(user, system)) return NotFound();
        var prefix = neft ? NeftTypePrefix : dashboard ? DashboardTypePrefix : TypePrefix;
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        await db.ExecuteSqlAsync(InsertSql, new { OtpType = prefix + system, user.UserId, Hash = Hash(token), UserName = Cut(user.UserName, 500) }, ct);
        log.LogInformation("Admin {UserId} handed over to the {Portal} portal", user.UserId, KeyOf(system));
        return new HandoffIssued(token);
    }

    public sealed record HandoffRequest(string? Token);

    public sealed record HandoffAccepted(string UserName, string XsrfToken);

    public sealed record HandoffRow(string? UserId, string? UserName);

    internal const string FindSql =
        "SELECT TOP (1) MobileNo AS UserId, Response AS UserName FROM dbo.OTP " +
        "WHERE OtpType = @OtpType AND OTP = @Hash AND CreatedDate >= DATEADD(SECOND, -@Seconds, GETDATE()) ORDER BY Id DESC;";

    /// <summary>The account must still be an active Admin on main when its pass is used (read through the read-only connection).</summary>
    internal const string ActiveAdminSql =
        "SELECT TOP (1) UserId FROM dbo.Users WHERE UserId = @UserId AND RoleId = @RoleId AND IsActive = 1;";

    /// <summary>The NEFT Admin must still be an active NEFT Admin (MSME DFO of every state) on main.</summary>
    internal const string ActiveNeftAdminSql =
        "SELECT TOP (1) UserId FROM dbo.Users WHERE UserId = @UserId AND RoleId = 6 AND StateCode = 'ALL' AND IsActive = 1;";

    /// <summary>An MSME DFO with the Handholding list, still active on main: its state and lists come from there.</summary>
    internal const string ActiveDfoSql =
        "SELECT TOP (1) UserId, StateCode, ScreenAccess FROM dbo.Users WHERE UserId = @UserId AND RoleId = 6 AND IsActive = 1 " +
        "AND ISNULL(StateCode, '') <> 'ALL' AND ',' + ISNULL(ScreenAccess, '') + ',' LIKE '%,consultancy:neft,%';";

    public sealed record ActiveDfoRow(string? UserId, string? StateCode, string? ScreenAccess);

    /// <summary>The Dashboard Admin must still be an active Dashboard Admin on main; its screens come from there.</summary>
    internal const string ActiveDashboardAdminSql =
        "SELECT TOP (1) UserId, ScreenAccess FROM dbo.Users WHERE UserId = @UserId AND RoleId = 10 AND IsActive = 1;";

    public sealed record ActiveDashboardAdminRow(string? UserId, string? ScreenAccess);

    private static bool IsNeftAdmin(string? stateCode) =>
        string.Equals(stateCode?.Trim(), Neft.NeftController.AllStates, StringComparison.OrdinalIgnoreCase);

    public sealed record ActiveAdminRow(string? UserId);

    /// <summary>Passes already taken on this host (until they expire).</summary>
    private static readonly ConcurrentDictionary<string, DateTime> Taken = new();

    /// <summary>Distributed cache key of a taken pass (shared by the servers and recycles when Cache:SqlServerTable is set).</summary>
    internal static string TakenKey(string hash) => "admin-handoff-taken:" + hash;

    /// <summary>
    /// POST api/staff/admin-portals/handoff (Consultancy / Surveillance): signs in the main portal's Admin with the pass
    /// and returns the request token this API expects in X-XSRF-TOKEN (its cookie is not readable from the main pages).
    /// No anti-forgery token yet: the one-time pass is what a forged request cannot have.
    /// </summary>
    [HttpPost("handoff")]
    [AllowAnonymous]
    [IgnoreAntiforgeryToken]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<ActionResult<HandoffAccepted>> Accept(HandoffRequest req, CancellationToken ct)
    {
        if (host.System == PortalSystem.Main) return NotFound();
        var token = req.Token?.Trim() ?? "";
        if (token.Length is < 40 or > 64 || !token.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_'))
            return Problem(title: "The sign-in from the main portal is not valid. Please open this portal again from the main Admin.", statusCode: StatusCodes.Status400BadRequest);
        var main = SystemDatabases.Open(HttpContext.RequestServices, PortalSystem.Main);
        if (main is null)
        {
            log.LogError("Admin hand-over refused: ConnectionStrings:Main is not configured on the {Portal} host", KeyOf(host.System));
            return Problem(title: "This portal cannot read the main portal's sign-in (its connection to the main database is not configured).", statusCode: StatusCodes.Status400BadRequest);
        }

        var hash = Hash(token);
        var now = DateTime.UtcNow;
        foreach (var old in Taken.Where(t => t.Value < now).Select(t => t.Key).ToList()) Taken.TryRemove(old, out _);
        var row = (await main.QuerySqlAsync<HandoffRow>(FindSql, new { OtpType = TypePrefix + host.System, Hash = hash, Seconds = (int)Lifetime.TotalSeconds }, ct))
            .FirstOrDefault();
        var neft = false;
        var dashboard = false;
        if (row is null && host.System == PortalSystem.Consultancy)
        {
            row = (await main.QuerySqlAsync<HandoffRow>(FindSql, new { OtpType = NeftTypePrefix + host.System, Hash = hash, Seconds = (int)Lifetime.TotalSeconds }, ct))
                .FirstOrDefault();
            neft = row is not null;
        }
        if (row is null)
        {
            row = (await main.QuerySqlAsync<HandoffRow>(FindSql, new { OtpType = DashboardTypePrefix + host.System, Hash = hash, Seconds = (int)Lifetime.TotalSeconds }, ct))
                .FirstOrDefault();
            dashboard = row is not null;
        }
        if (row?.UserId is not { Length: > 0 } userId || !Taken.TryAdd(hash, now + Lifetime + Lifetime) || !await TakeEverywhereAsync(hash, ct))
        {
            log.LogWarning("Admin hand-over refused on the {Portal} host: unknown, expired or used pass", KeyOf(host.System));
            return Problem(title: "The sign-in from the main portal has expired. Please open this portal again from the main Admin.", statusCode: StatusCodes.Status400BadRequest);
        }
        // The pass was issued up to two minutes ago: the Admin may have been blocked or changed since.
        string? screens = null;
        string? dfoState = null;
        IReadOnlyList<ActiveAdminRow> admin;
        if (dashboard)
        {
            var d = await main.QuerySqlAsync<ActiveDashboardAdminRow>(ActiveDashboardAdminSql, new { UserId = userId }, ct);
            screens = d.FirstOrDefault()?.ScreenAccess;
            admin = d.Select(x => new ActiveAdminRow(x.UserId)).ToList();
        }
        else if (neft)
        {
            admin = await main.QuerySqlAsync<ActiveAdminRow>(ActiveNeftAdminSql, new { UserId = userId }, ct);
            if (admin.Count == 0)
            {
                var dfo = await main.QuerySqlAsync<ActiveDfoRow>(ActiveDfoSql, new { UserId = userId }, ct);
                dfoState = dfo.FirstOrDefault()?.StateCode;
                screens = dfo.FirstOrDefault()?.ScreenAccess;
                admin = dfo.Select(x => new ActiveAdminRow(x.UserId)).ToList();
            }
        }
        else admin = await main.QuerySqlAsync<ActiveAdminRow>(ActiveAdminSql, new { UserId = userId, RoleId = (int)UserRole.Admin }, ct);
        if (admin.Count == 0)
        {
            log.LogWarning("Admin hand-over refused on the {Portal} host: {UserId} is no longer an active Admin on main", KeyOf(host.System), userId);
            return Problem(title: "The sign-in from the main portal is not valid. Please open this portal again from the main Admin.", statusCode: StatusCodes.Status400BadRequest);
        }

        var user = neft
            ? new ZedUser(userId, row.UserName ?? userId, (int)UserRole.StateCoordinator, null, null, dfoState ?? Neft.NeftController.AllStates, null,
                SubRoles: SubRoles.All, Screens: screens)
            : dashboard
                ? new ZedUser(userId, row.UserName ?? userId, (int)UserRole.SuperAdmin, null, null, null, null, SubRoles: SubRoles.All, Screens: screens)
                : new ZedUser(userId, row.UserName ?? userId, (int)UserRole.Admin, null, null, null, null, SubRoles: []);
        // The session ends with the Admin's main sessions (M12): its stamp is main's Users.SessionStamp, read through the
        // same read-only connection (SessionStampValidator).
        await HttpContext.SignInZedUserAsync(user, stampOnMain: true);
        var xsrf = HttpContext.RequestServices.GetRequiredService<IAntiforgery>().GetAndStoreTokens(HttpContext).RequestToken!;
        log.LogInformation("Admin {UserId} signed in on the {Portal} portal from the main portal", userId, KeyOf(host.System));
        return new HandoffAccepted(user.UserName, xsrf);
    }

    /// <summary>
    /// Records the pass as taken in the distributed cache too, so another server (or this one after a recycle) refuses it;
    /// false when it already is. Not atomic between servers (read, then write), which leaves a window of milliseconds
    /// instead of the pass's lifetime.
    /// </summary>
    private async Task<bool> TakeEverywhereAsync(string hash, CancellationToken ct)
    {
        if (HttpContext.RequestServices.GetService<IDistributedCache>() is not { } cache) return true;
        var key = TakenKey(hash);
        if (await cache.GetAsync(key, ct) is not null) return false;
        await cache.SetAsync(key, [1], new DistributedCacheEntryOptions { AbsoluteExpirationRelativeToNow = Lifetime + Lifetime }, ct);
        return true;
    }

    internal static string Hash(string token) => Convert.ToBase64String(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(token)));

    private static string Cut(string value, int max) => value.Length <= max ? value : value[..max];
}
