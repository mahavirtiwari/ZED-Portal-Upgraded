using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.Users;

namespace Zed.Portal.Features.Staff.PasswordReset;

/// <summary>
/// 2026-11-17 (approved staff redesign, Password Reset Link): before a MasterAdmin sends a link, the page shows who it goes
/// to (name, role, status, the address: in full since 2026-11-18, the user) and, up front, why it cannot be sent (blocked, no valid e-mail, own account,
/// password held by the main portal). Read-only, scoped exactly like the send (<see cref="StaffPasswordResetAdminController"/>:
/// MasterAdmin, the same portals, the same account lookup SP_V4_STAFF_RESET_ACCOUNT, MSMEs and unknown IDs are 404) and
/// never shows more than the send's answer would (its address, which the signed-in Master Admin sees in full).
/// </summary>
[Route("api/staff/password-reset")]
[StaffRoles(UserRole.MasterAdmin)]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed class StaffPasswordResetLookupController(StaffPasswordResets resets, ISqlExecutor db, IServiceProvider services) : StaffApiController
{
    /// <param name="Role">The account's role in words ("Assessment agency", "Master Admin", …).</param>
    /// <param name="Email">The registered address in full, as the send's answer names it (2026-11-18, the user: never masked); null without a valid one.</param>
    /// <param name="CanSend">Whether Send would e-mail a link now; else <paramref name="Reason"/> says why (the send's own refusal).</param>
    public sealed record ResetTarget(string UserId, string UserName, int RoleId, string Role, bool IsActive, string? Email, bool CanSend, string? Reason);

    [HttpGet("{userId}")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<ActionResult<ResetTarget>> Lookup(string userId, CancellationToken ct)
    {
        var o = resets.Options;
        if (!o.Enabled) return this.Problem400("Password reset is switched off on this portal.");
        var id = Clean(userId);
        if (id.Length == 0) return NotFound();
        var row = (await db.QueryProcMultipleAsync("SP_V4_STAFF_RESET_ACCOUNT", new { UserId = id }, ct))[0].FirstOrDefault();
        if (row is null) return NotFound();

        var actor = CurrentUser;
        var accountId = row.Text("UserId");
        var roleId = int.TryParse(row.Text("RoleId"), out var r) ? r : 0;
        var active = StaffUserRules.Bool(row, "IsActive");
        var email = row.Text("Email")?.Trim() is { } e && StaffUserRules.IsEmail(e) ? e : null;

        // The send's checks, in the send's order (StaffPasswordResets.SendByAdminAsync).
        string? reason = null;
        if (string.Equals(accountId, actor.UserId, StringComparison.OrdinalIgnoreCase)) reason = "Please use Change Password for your own account.";
        else if (!active) reason = "This user is blocked. Unblock the account first.";
        else if (o.ExcludedRoleIds.Contains(roleId) && actor.RoleId != (int)UserRole.MasterAdmin) reason = "Only a MasterAdmin can send a reset link to this account.";
        else if (email is null) reason = "This user has no valid registered e-mail address. Update it first.";
        else if (await PasswordStore.For(db, services).IsManagedByMainAsync(accountId, ct))
            reason = "This account's password is managed on the main ZED portal. Send the link from there.";

        var name = row.Text("UserName");
        return new ResetTarget(accountId, string.IsNullOrWhiteSpace(name) ? accountId : name.Trim(), roleId, RoleName(roleId), active,
            email, reason is null, reason);
    }

    /// <summary>The role in words as the staff screens name it.</summary>
    public static string RoleName(int roleId) => (UserRole)roleId switch
    {
        UserRole.Admin => "Admin",
        UserRole.Agency => "Assessment agency",
        UserRole.DesktopAssessor => "Assessor",
        UserRole.SiteAssessor => "Site assessor",
        UserRole.StateCoordinator => "MSME DFO / NEFT Admin",
        UserRole.MasterAdmin => "Master Admin",
        UserRole.Ministry => "Ministry",
        UserRole.SuperAdmin => "Dashboard Admin",
        _ => "Staff account",
    };

    private static string Clean(string? typed)
    {
        var id = (typed ?? "").Trim();
        return id.Length is > 0 and <= 50 && !id.Any(char.IsControl) ? id : "";
    }
}
