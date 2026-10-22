using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging;
using Zed.Core.Data;

namespace Zed.Core.Mobile;

/// <summary>
/// Sign-ins of the consultant app that V4 accepted (dbo.V4AppSessions in ZED_CONSULTANT, migration 0010). The app's
/// technology upgradation calls to the consultancy web site carry no identity at all, so the portal serves them only
/// for a unit whose allotted DFO signed in to the app for that unit recently (see the consultancy portal's TuAppController).
/// </summary>
public static class AppSessions
{
    public const string Consultant = "Consultant";

    /// <summary>Records a sign-in. Never fails the sign-in: a missing table (0010 not run) is logged.</summary>
    public static async Task RecordAsync(ISqlExecutor db, ILogger log, string app, string userId, string zedId, string? certification, string? ip, CancellationToken ct)
    {
        try
        {
            await db.ExecuteSqlAsync(
                "DELETE FROM dbo.V4AppSessions WHERE UserId = @UserId AND AppKind = @AppKind AND SignedInAt < DATEADD(DAY, -30, SYSUTCDATETIME()); " +
                "INSERT INTO dbo.V4AppSessions (AppKind, UserId, ZedId, Certification, Ip) VALUES (@AppKind, @UserId, @ZedId, @Certification, @Ip);",
                new { AppKind = app, UserId = Cut(userId, 50), ZedId = Cut(zedId, 50), Certification = Cut(certification, 50), Ip = Cut(ip, 50) }, ct);
        }
        catch (SqlException ex)
        {
            log.LogWarning(ex, "Could not record the {App} app sign-in of {UserId} for {ZedId} (is migration 0010 applied?)", app, userId, zedId);
        }
    }

    /// <summary>
    /// The time of the latest sign-in of <paramref name="userId"/> to the app for <paramref name="zedId"/> within the last
    /// <paramref name="hours"/> hours (from <paramref name="ip"/> when given), or null. Refuses (null) when the table is missing.
    /// </summary>
    public static async Task<DateTime?> LatestAsync(ISqlExecutor db, ILogger log, string app, string userId, string zedId, int hours, string? ip, CancellationToken ct)
    {
        try
        {
            var rows = await db.QuerySqlAsync<DateTime>(
                "SELECT TOP (1) SignedInAt FROM dbo.V4AppSessions WHERE ZedId = @ZedId AND UserId = @UserId AND AppKind = @AppKind " +
                "AND SignedInAt >= DATEADD(HOUR, -@Hours, SYSUTCDATETIME()) AND (@Ip IS NULL OR Ip = @Ip) ORDER BY SignedInAt DESC;",
                new { AppKind = app, UserId = userId, ZedId = zedId, Hours = hours, Ip = ip }, ct);
            return rows.Count > 0 ? rows[0] : null;
        }
        catch (SqlException ex)
        {
            log.LogWarning(ex, "Could not read the {App} app sign-ins (is migration 0010 applied?)", app);
            return null;
        }
    }

    private static string? Cut(string? s, int max) => s is null ? null : s.Length <= max ? s : s[..max];
}
