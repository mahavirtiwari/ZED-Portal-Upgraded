using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;

namespace Zed.Portal.Features.Msme;

/// <summary>
/// 2026-11-17 (the user: "Notification bell: yes, build it"): the bell of the applicant's header. Its notifications are
/// the unit's history lines that the portal already writes (MsmeHistory: payment received, documents submitted, desktop
/// verification, NC raised / closed, certified, handholding milestones, surveillance), from the certification
/// (ZEDCS_V2_LIVE), handholding (ZED_CONSULTANT) and surveillance (ZED_SURVEILLANCE) databases, newest first. The unread
/// ones are those after the unit last opened the bell (Msme.NotificationsSeenOn, migration 0097).
/// </summary>
[Route("api/msme/notifications")]
public sealed class MsmeNotificationsController(ISqlExecutor db) : MsmeApiController
{
    public const int Shown = 20;

    public sealed record Notification(DateTime At, string Text, string? Level, string Module);

    public sealed record NotificationsResponse(int Unread, IReadOnlyList<Notification> Items);

    /// <summary>One history line (any database).</summary>
    public sealed record Row(DateTime CreatedDate, string? Descrip, string? CertificationType, string Module);

    /// <summary>The newest lines of the three histories.</summary>
    public const string ListSql =
        "SELECT TOP (@Top) CreatedDate, Descrip, CertificationType, Module FROM (" +
        "SELECT CreatedDate, Descrip, CertificationType, 'Certification' Module FROM dbo.MsmeHistory WHERE ZedId = @ZedId " +
        "UNION ALL SELECT CreatedDate, Descrip, CertificationType, 'Handholding' FROM ZED_CONSULTANT.dbo.MsmeHistory WHERE ZedId = @ZedId " +
        "UNION ALL SELECT CreatedDate, Descrip, CertificationType, 'Surveillance' FROM ZED_SURVEILLANCE.dbo.MsmeHistory WHERE ZedId = @ZedId" +
        ") H WHERE CreatedDate IS NOT NULL AND NULLIF(LTRIM(RTRIM(Descrip)), '') IS NOT NULL ORDER BY CreatedDate DESC;";

    public sealed record Seen(DateTime? NotificationsSeenOn);

    public const string SeenSql = "SELECT NotificationsSeenOn FROM dbo.Msme WHERE ZedId = @ZedId;";

    public const string MarkSql = "UPDATE dbo.Msme SET NotificationsSeenOn = GETDATE() WHERE ZedId = @ZedId;";

    [HttpGet]
    public async Task<NotificationsResponse> List(CancellationToken ct)
    {
        var id = new Dapper.DbString { Value = ZedId, IsAnsi = true, Length = 50 };
        var rows = await db.QuerySqlAsync<Row>(ListSql, new { ZedId = id, Top = Shown }, ct);
        var seen = (await db.QuerySqlAsync<Seen>(SeenSql, new { ZedId = id }, ct)).FirstOrDefault()?.NotificationsSeenOn;
        var items = rows.Select(r => new Notification(r.CreatedDate, r.Descrip!.Trim(), Level(r.CertificationType), r.Module)).ToList();
        return new NotificationsResponse(items.Count(i => seen is null || i.At > seen), items);
    }

    /// <summary>The unit opened the bell: everything so far is read.</summary>
    [HttpPost("seen")]
    public async Task<IActionResult> MarkSeen(CancellationToken ct)
    {
        await db.ExecuteSqlAsync(MarkSql, new { ZedId = new Dapper.DbString { Value = ZedId, IsAnsi = true, Length = 50 } }, ct);
        return NoContent();
    }

    /// <summary>The level of a line as the unit knows it (ZEDX is ZED-X); null when the line has none.</summary>
    public static string? Level(string? certification) =>
        string.IsNullOrWhiteSpace(certification) ? null : string.Equals(certification.Trim(), "ZEDX", StringComparison.OrdinalIgnoreCase) ? "ZED-X" : certification.Trim();
}
