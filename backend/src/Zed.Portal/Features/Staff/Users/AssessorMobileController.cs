using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Mobile;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Users;

/// <summary>
/// Registered mobile (V4; 2026-11-18 for every ZED app but the ZED MSME app, the user: "Master admin will release the mobile
/// then assessor can use new one"): an assessor (Main: the site assessor app; Surveillance: the site assessor app and the
/// Bronze surveillance app) or a consultant (Consultancy: the consultant app) signs in on one phone only (the mobile API's
/// one-phone rule, <see cref="OnePhoneRule"/>). The Admin and this portal's Master Admin (never agencies or organisations)
/// see each user's registered phone (make, model, OS, app version, first registered, last sign-in and IP), the recent app
/// sign-ins (dbo.V4LoginEvents, refused ones with their reason and IP) and the release history, and release the phone with
/// a reason when the user changes or loses it: the next sign-in then registers the new phone. The lists get one row per user
/// with a phone or a refusal today (the Phone chip). Per system, in the system's own database (dbo.MobileDeviceBindings and
/// dbo.MobileDeviceEvents, migrations 0001 and 0099; each mobile host writes its own).
/// </summary>
[Route("api/staff/assessor-mobile")]
[StaffRoles(UserRole.Admin, UserRole.MasterAdmin)]
[PortalSystems(PortalSystem.Main, PortalSystem.Surveillance, PortalSystem.Consultancy)]
public sealed class AssessorMobileController(ISqlExecutor db, PortalHost portal, ILogger<AssessorMobileController> log) : StaffApiController
{
    public const int SignInsShown = 20;
    public const int ReasonMax = 500;

    /// <summary>An app of this portal whose users have the one-phone rule, and its name in the sign-in log (LoginAuditAttribute).</summary>
    public sealed record AppInfo(string App, string Name);

    /// <summary>The apps of each portal (MobileDeviceBindings.AppKind; the consultant app keeps the site assessor app's key).</summary>
    public static IReadOnlyList<AppInfo> AppsOf(PortalSystem system) => system switch
    {
        PortalSystem.Surveillance => [new(MobileApps.SiteAssessor, "Site assessment app"), new(MobileApps.Surveillance, "Surveillance app")],
        PortalSystem.Consultancy => [new(MobileApps.SiteAssessor, "Consultant app")],
        _ => [new(MobileApps.SiteAssessor, "Site assessment app")],
    };

    private IReadOnlyList<AppInfo> Apps => AppsOf(portal.System);
    private string[] AppKeys => Apps.Select(a => a.App).ToArray();
    private string AppName(string? app) => Apps.FirstOrDefault(a => string.Equals(a.App, app, StringComparison.OrdinalIgnoreCase))?.Name ?? app ?? "";

    /// <summary>A registered phone with what 0099 adds (null before it runs).</summary>
    public sealed record Phone(string App, string AppName, string DeviceId, string? Model, string? Make, string? OsVersion, int? ApiLevel, string? AppVersion,
        DateTime? FirstSeenAt, DateTime? LastLoginAt, DateTime? LastSeenAt, string? LastIp, string? FirstIp);

    public sealed record SignIn(DateTime At, string? App, string Result, string? Reason, string? DeviceId, string? DeviceModel, string? OsVersion,
        string? AppVersion, string? IpAddress);

    public sealed record Release(DateTime At, string? App, string? DeviceId, string? Model, string? ReleasedBy, string? Reason, string? Ip);

    /// <summary>
    /// The user's phones (<see cref="Device"/> the registered one, the most recent sign-in; <see cref="Devices"/> one per app of
    /// this portal), the recent sign-ins, the release history, and whether a sign-in or call from another phone was refused today.
    /// </summary>
    public sealed record MobileResponse(string UserId, Phone? Device, IReadOnlyList<Phone> Devices, IReadOnlyList<SignIn> SignIns,
        IReadOnlyList<Release> Releases, bool RefusedToday, IReadOnlyList<AppInfo> Apps);

    /// <summary>A row of the lists' Phone chip.</summary>
    public sealed record PhoneSummary(string UserId, string? App, string? AppName, string? Model, string? Make, DateTime? LastLoginAt, bool RefusedToday,
        DateTime? LastRefusedAt);

    public sealed record ReleaseRequest(string? Reason, string? App);

    /// <summary>An assessor / consultant (RoleId 3) of this system.</summary>
    public const string AssessorSql = "SELECT COUNT(*) FROM dbo.Users WHERE UserId = @UserId AND RoleId = 3;";

    /// <summary>The user's phones of this portal's apps, the registered one (signed in from last) first (0099 columns).</summary>
    public const string PhonesSql =
        "SELECT AppKind AS App, DeviceId, Model, Make, OsVersion, ApiLevel, AppVersion, FirstSeenAt, LastLoginAt, LastSeenAt, LastIp, FirstIp " +
        "FROM dbo.MobileDeviceBindings WHERE UserKey = @User AND AppKind IN @Apps ORDER BY LastLoginAt DESC, LastSeenAt DESC;";

    /// <summary><see cref="PhonesSql"/> before 0099.</summary>
    public const string PhonesLegacySql =
        "SELECT AppKind AS App, DeviceId, Model, OsVersion, FirstSeenAt, LastLoginAt, LastSeenAt, LastIp " +
        "FROM dbo.MobileDeviceBindings WHERE UserKey = @User AND AppKind IN @Apps ORDER BY LastLoginAt DESC, LastSeenAt DESC;";

    /// <summary>The user's latest sign-ins to this portal's apps (At is UTC), refused ones included.</summary>
    public const string SignInsSql =
        "SELECT TOP (20) At, App, Result, Reason, DeviceId, DeviceModel, OsVersion, AppVersion, IpAddress FROM dbo.V4LoginEvents " +
        "WHERE UserId = @UserId AND Channel = 'Mobile' AND App IN @AppNames ORDER BY At DESC;";

    /// <summary>The user's release history (0099 columns; server time).</summary>
    public const string ReleasesSql =
        "SELECT TOP (20) At, AppKind AS App, DeviceId, Model, ReleasedBy, Reason, Ip FROM dbo.MobileDeviceEvents " +
        "WHERE UserKey = @User AND AppKind IN @Apps AND Outcome = 'Released' ORDER BY At DESC;";

    /// <summary>Device refusals (another phone, at sign-in or on a call) since the start of the day <c>@Days</c> - 1 days ago.</summary>
    public const string RefusalsSql =
        "SELECT UserKey AS UserId, MAX(At) AS At FROM dbo.MobileDeviceEvents WHERE AppKind IN @Apps AND Refused = 1 AND Outcome IN ('Unknown', 'Missing') " +
        "AND At >= DATEADD(day, 1 - @Days, CAST(SYSDATETIME() AS date)) AND (@User IS NULL OR UserKey = @User) GROUP BY UserKey;";

    /// <summary>Every registered phone of this portal's apps, for the lists (0099 columns).</summary>
    public const string AllPhonesSql =
        "SELECT UserKey AS UserId, AppKind AS App, Model, Make, LastLoginAt FROM dbo.MobileDeviceBindings WHERE AppKind IN @Apps;";

    public const string AllPhonesLegacySql = "SELECT UserKey AS UserId, AppKind AS App, Model, LastLoginAt FROM dbo.MobileDeviceBindings WHERE AppKind IN @Apps;";

    /// <summary>A release in the history: the old phone, who released it, why and from where.</summary>
    public const string ReleaseEventSql =
        "INSERT INTO dbo.MobileDeviceEvents (AppKind, UserKey, DeviceId, Path, Ip, Outcome, Refused, At, Model, ReleasedBy, Reason) " +
        "VALUES (@App, @User, @Device, @Path, @Ip, 'Released', 0, SYSDATETIME(), @Model, @By, @Reason);";

    private sealed class PhoneRow
    {
        public string? App { get; init; }
        public string? DeviceId { get; init; }
        public string? Model { get; init; }
        public string? Make { get; init; }
        public string? OsVersion { get; init; }
        public int? ApiLevel { get; init; }
        public string? AppVersion { get; init; }
        public DateTime? FirstSeenAt { get; init; }
        public DateTime? LastLoginAt { get; init; }
        public DateTime? LastSeenAt { get; init; }
        public string? LastIp { get; init; }
        public string? FirstIp { get; init; }
    }

    private sealed class SummaryRow
    {
        public string? UserId { get; init; }
        public string? App { get; init; }
        public string? Model { get; init; }
        public string? Make { get; init; }
        public DateTime? LastLoginAt { get; init; }
    }

    private sealed class RefusalRow
    {
        public string? UserId { get; init; }
        public DateTime? At { get; init; }
    }

    /// <summary>
    /// The lists' Phone chip: one row per user with a registered phone (the one signed in from last, whatever the app) or a
    /// device refusal in the last <paramref name="days"/> days (1: today).
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<PhoneSummary>>> List(int days = 1, CancellationToken ct = default)
    {
        days = Math.Clamp(days, 1, 30);
        IReadOnlyList<SummaryRow> phones;
        try
        {
            phones = await db.QuerySqlAsync<SummaryRow>(AllPhonesSql, new { Apps = AppKeys }, ct);
        }
        catch (SqlException ex) when (ex.Number == 207)
        {
            phones = await db.QuerySqlAsync<SummaryRow>(AllPhonesLegacySql, new { Apps = AppKeys }, ct);
        }
        var refusals = (await db.QuerySqlAsync<RefusalRow>(RefusalsSql, new { Apps = AppKeys, Days = days, User = (string?)null }, ct))
            .Where(r => !string.IsNullOrWhiteSpace(r.UserId))
            .GroupBy(r => r.UserId!.Trim(), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.Max(r => r.At), StringComparer.OrdinalIgnoreCase);

        var list = new List<PhoneSummary>();
        foreach (var g in phones.Where(p => !string.IsNullOrWhiteSpace(p.UserId)).GroupBy(p => p.UserId!.Trim(), StringComparer.OrdinalIgnoreCase))
        {
            var p = g.OrderByDescending(r => r.LastLoginAt).First();
            var refused = refusals.Remove(g.Key, out var refusedAt);
            list.Add(new PhoneSummary(g.Key, p.App, AppName(p.App), p.Model, p.Make, p.LastLoginAt, refused, refusedAt));
        }
        list.AddRange(refusals.Select(r => new PhoneSummary(r.Key, null, null, null, null, null, true, r.Value)));
        return list;
    }

    [HttpGet("{userId}")]
    public async Task<ActionResult<MobileResponse>> Get(string userId, CancellationToken ct)
    {
        if (await FindAsync(userId, ct) is not { } id) return NotFound();
        var devices = await PhonesAsync(id, ct);
        IReadOnlyList<SignIn> signIns;
        try
        {
            signIns = await db.QuerySqlAsync<SignIn>(SignInsSql, new { UserId = id, AppNames = Apps.Select(a => a.Name).Distinct().ToArray() }, ct);
        }
        catch (SqlException ex)
        {
            log.LogWarning(ex, "Sign-in log not read (is migration 0013 applied?)");
            signIns = [];
        }
        var refused = (await db.QuerySqlAsync<RefusalRow>(RefusalsSql, new { Apps = AppKeys, Days = 1, User = id }, ct)).Count > 0;
        return new MobileResponse(id, devices.FirstOrDefault(), devices, signIns, await ReleasesAsync(id, ct), refused, Apps);
    }

    /// <summary>The release history of the user's phones on this portal (who released which phone, when and why).</summary>
    [HttpGet("{userId}/releases")]
    public async Task<ActionResult<IReadOnlyList<Release>>> Releases(string userId, CancellationToken ct)
    {
        if (await FindAsync(userId, ct) is not { } id) return NotFound();
        return Ok(await ReleasesAsync(id, ct));
    }

    /// <summary>
    /// Releases the user's phone of <c>App</c> (every app of this portal when not given) with a reason: the rows are deleted,
    /// so the next sign-in registers the phone it comes from; each released phone is kept in the release history.
    /// </summary>
    [HttpPost("{userId}/release")]
    public async Task<ActionResult<MessageResponse>> ReleasePhone(string userId, ReleaseRequest request, CancellationToken ct)
    {
        if (await FindAsync(userId, ct) is not { } id) return NotFound();
        var reason = request?.Reason?.Trim();
        if (string.IsNullOrEmpty(reason)) return this.Problem400("Please enter the reason for releasing the mobile.");
        if (reason.Length > ReasonMax) return this.Problem400($"The reason can have at most {ReasonMax} characters.");
        var app = string.IsNullOrWhiteSpace(request!.App) ? null : request.App.Trim();
        if (app is not null && !AppKeys.Contains(app, StringComparer.OrdinalIgnoreCase)) return this.Problem400("Please choose an app of this portal.");

        var phones = (await PhonesAsync(id, ct)).Where(p => app is null || string.Equals(p.App, app, StringComparison.OrdinalIgnoreCase)).ToList();
        if (phones.Count == 0) return this.Problem400("No mobile is registered for this user.");
        foreach (var released in phones.GroupBy(p => p.App, StringComparer.OrdinalIgnoreCase))
        {
            await db.ExecuteSqlAsync(SqlDeviceBindings.ReleaseSql, new { App = released.Key, User = id }, ct);
            foreach (var p in released) await RecordReleaseAsync(id, p, reason, ct);
        }
        log.LogInformation("Mobile of {User} ({Phones}) released by {By}: {Reason}", id, string.Join(", ", phones.Select(p => $"{p.App} {p.Model} {p.DeviceId}")), ActorId, reason);
        return new MessageResponse("Mobile released. The next sign-in registers the phone it comes from; only that phone can be used then.");
    }

    private async Task RecordReleaseAsync(string user, Phone p, string reason, CancellationToken ct)
    {
        try
        {
            await db.ExecuteSqlAsync(ReleaseEventSql, new
            {
                p.App, User = user, Device = Cut(p.DeviceId, 200), Path = Cut(Request.Path.Value, 200) ?? "", Ip = Cut(HttpContext.Connection.RemoteIpAddress?.ToString(), 50),
                Model = Cut(p.Model, 100), By = Cut(ActorId, 50), Reason = reason,
            }, ct);
        }
        catch (SqlException ex) when (ex.Number == 207)
        {
            // Before 0099 there is no place for the reason: the phone is released all the same, and the log keeps it.
            log.LogWarning("Release of {User}'s mobile not kept in the history: run migration 0099", user);
        }
    }

    private async Task<IReadOnlyList<Phone>> PhonesAsync(string user, CancellationToken ct)
    {
        IReadOnlyList<PhoneRow> rows;
        try
        {
            rows = await db.QuerySqlAsync<PhoneRow>(PhonesSql, new { User = user, Apps = AppKeys }, ct);
        }
        catch (SqlException ex) when (ex.Number == 207)
        {
            rows = await db.QuerySqlAsync<PhoneRow>(PhonesLegacySql, new { User = user, Apps = AppKeys }, ct);
        }
        return rows.Where(r => !string.IsNullOrWhiteSpace(r.DeviceId))
            .Select(r => new Phone(r.App ?? "", AppName(r.App), r.DeviceId!, r.Model, r.Make, r.OsVersion, r.ApiLevel, r.AppVersion, r.FirstSeenAt, r.LastLoginAt,
                r.LastSeenAt, r.LastIp, r.FirstIp))
            .ToList();
    }

    private async Task<IReadOnlyList<Release>> ReleasesAsync(string user, CancellationToken ct)
    {
        try
        {
            return (await db.QuerySqlAsync<Release>(ReleasesSql, new { User = user, Apps = AppKeys }, ct))
                .Select(r => r with { App = AppName(r.App) }).ToList();
        }
        catch (SqlException ex) when (ex.Number == 207)
        {
            return [];
        }
    }

    private async Task<string?> FindAsync(string userId, CancellationToken ct)
    {
        var id = userId?.Trim();
        if (string.IsNullOrEmpty(id) || id.Length > 50) return null;
        return (await db.QuerySqlAsync<int>(AssessorSql, new { UserId = id }, ct)).FirstOrDefault() > 0 ? id : null;
    }

    private static string? Cut(string? s, int max) => s is null ? null : s.Length <= max ? s : s[..max];
}
