using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Mobile;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Users;

/// <summary>
/// Master Admin → assessor → Registered mobile (V4): an assessor signs in to the site assessor app on one phone only (the
/// mobile API's one-phone rule). The Master Admin sees the registered phone (make and model, OS, first registered, last
/// sign-in, IP) and the assessor's recent app sign-ins (dbo.V4LoginEvents, refused ones included) and releases the phone
/// when the assessor changes or loses it: the next sign-in then registers the new phone. Agencies cannot. Per system, in
/// the system's own database (dbo.MobileDeviceBindings, migration 0001; the Main and Surveillance mobile hosts write there).
/// </summary>
[Route("api/staff/assessor-mobile/{userId}")]
[StaffRoles(UserRole.Admin, UserRole.MasterAdmin)]
[PortalSystems(PortalSystem.Main, PortalSystem.Surveillance)]
public sealed class AssessorMobileController(ISqlExecutor db, ILogger<AssessorMobileController> log) : StaffApiController
{
    public const int SignInsShown = 20;

    public sealed record SignIn(DateTime At, string Result, string? Reason, string? DeviceId, string? DeviceModel, string? OsVersion, string? AppVersion, string? IpAddress);

    public sealed record MobileResponse(string UserId, RegisteredDevice? Device, IReadOnlyList<SignIn> SignIns);

    /// <summary>A site assessor (RoleId 3) of this system.</summary>
    public const string AssessorSql = "SELECT COUNT(*) FROM dbo.Users WHERE UserId = @UserId AND RoleId = 3;";

    /// <summary>The assessor's latest sign-ins to the site assessor app (At is UTC).</summary>
    public const string SignInsSql =
        "SELECT TOP (20) At, Result, Reason, DeviceId, DeviceModel, OsVersion, AppVersion, IpAddress FROM dbo.V4LoginEvents " +
        "WHERE UserId = @UserId AND Channel = 'Mobile' AND App = 'Site assessment app' ORDER BY At DESC;";

    [HttpGet]
    public async Task<ActionResult<MobileResponse>> Get(string userId, CancellationToken ct)
    {
        if (await FindAsync(userId, ct) is not { } id) return NotFound();
        var device = await SqlDeviceBindings.ReadRegisteredAsync(db, MobileApps.SiteAssessor, id, ct);
        IReadOnlyList<SignIn> signIns;
        try
        {
            signIns = await db.QuerySqlAsync<SignIn>(SignInsSql, new { UserId = id }, ct);
        }
        catch (Microsoft.Data.SqlClient.SqlException ex)
        {
            log.LogWarning(ex, "Sign-in log not read (is migration 0013 applied?)");
            signIns = [];
        }
        return new MobileResponse(id, device, signIns);
    }

    /// <summary>Releases the assessor's phone: the next sign-in registers the phone it comes from.</summary>
    [HttpDelete]
    public async Task<ActionResult<MessageResponse>> Release(string userId, CancellationToken ct)
    {
        if (await FindAsync(userId, ct) is not { } id) return NotFound();
        var device = await SqlDeviceBindings.ReadRegisteredAsync(db, MobileApps.SiteAssessor, id, ct);
        if (device is null) return this.Problem400("No mobile is registered for this assessor.");
        await db.ExecuteSqlAsync(SqlDeviceBindings.ReleaseSql, new { App = MobileApps.SiteAssessor, User = id }, ct);
        log.LogInformation("Site assessor app phone of {Assessor} ({Model}, {Device}) released by {UserId}", id, device.Model, device.DeviceId, UserId);
        return new MessageResponse("Mobile released. The assessor can now sign in on a new mobile; that mobile is then registered.");
    }

    private async Task<string?> FindAsync(string userId, CancellationToken ct)
    {
        var id = userId?.Trim();
        if (string.IsNullOrEmpty(id) || id.Length > 50) return null;
        return (await db.QuerySqlAsync<int>(AssessorSql, new { UserId = id }, ct)).FirstOrDefault() > 0 ? id : null;
    }
}
