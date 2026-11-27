using System.Data.Common;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Mobile;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Settings;

/// <summary>
/// 2026-11-27 (the owner: "prepare only" the MSME app token enforcement): how ready each app is for Mobile:AppTokens = Enforce.
/// The installed apps that never send the token (the old ZED MSME app, the RA app) are allowed in Monitor and each such call is
/// recorded in dbo.MobileDeviceEvents (Outcome Token*, rate-limited per app, user, device and path). This counts, per app, the
/// units / users recorded without a valid token in the last 7 and 30 days: once an app's count stays at 0, its switch
/// (Mobile__AppTokens__Apps__{APP} = Enforce, in the Main and MobileMain sections) can be turned on without refusing anyone.
/// Read only, Admin, main portal (the apps' calls are recorded in main's database).
/// </summary>
[Route("api/staff/settings/app-tokens")]
[StaffRoles(UserRole.Admin)]
[PortalSystems(PortalSystem.Main)]
public sealed class AppTokenReadinessController(ISqlExecutor db, ILogger<AppTokenReadinessController> log) : StaffApiController
{
    internal const string MissesSql = """
        SELECT AppKind,
               COUNT(DISTINCT CASE WHEN At >= DATEADD(day, -7, SYSDATETIME()) THEN UserKey END) AS Users7,
               SUM(CASE WHEN At >= DATEADD(day, -7, SYSDATETIME()) THEN 1 ELSE 0 END) AS Calls7,
               COUNT(DISTINCT UserKey) AS Users30,
               COUNT(*) AS Calls30,
               MAX(At) AS LastAt
        FROM dbo.MobileDeviceEvents
        WHERE Outcome LIKE 'Token%' AND At >= DATEADD(day, -30, SYSDATETIME())
        GROUP BY AppKind;
        """;

    public sealed record MissRow(string? AppKind, int Users7, int Calls7, int Users30, int Calls30, DateTime? LastAt);

    public sealed record AppReadiness(string App, string Name, string Mode, int Users7, int Calls7, int Users30, int Calls30, DateTime? LastAt, bool Ready);

    public sealed record ReadinessResponse(IReadOnlyList<AppReadiness> Apps, bool Recorded);

    private static readonly (string Code, string Name)[] Apps =
    [
        (MobileApps.Msme, "ZED MSME app"), (MobileApps.RemoteAssessor, "Remote assessment app"), (MobileApps.SiteAssessor, "Site assessor / consultant app"),
        (MobileApps.Surveillance, "Bronze surveillance app"),
    ];

    [HttpGet]
    public async Task<ActionResult<ReadinessResponse>> Get(CancellationToken ct)
    {
        var tokens = HttpContext.RequestServices.GetService<AppTokens>();
        IReadOnlyList<MissRow> rows;
        var recorded = true;
        try
        {
            rows = await db.QuerySqlAsync<MissRow>(MissesSql, null, ct);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "App token misses not read (dbo.MobileDeviceEvents)");
            rows = [];
            recorded = false;
        }
        var byApp = rows.Where(r => r.AppKind is not null).ToDictionary(r => r.AppKind!.Trim(), StringComparer.OrdinalIgnoreCase);
        return new ReadinessResponse(Apps.Select(a =>
        {
            var r = byApp.GetValueOrDefault(a.Code);
            var mode = tokens?.ModeFor(a.Code).ToString() ?? "Off";
            return new AppReadiness(a.Code, a.Name, mode, r?.Users7 ?? 0, r?.Calls7 ?? 0, r?.Users30 ?? 0, r?.Calls30 ?? 0, r?.LastAt, Ready: (r?.Users30 ?? 0) == 0);
        }).ToList(), recorded);
    }
}
