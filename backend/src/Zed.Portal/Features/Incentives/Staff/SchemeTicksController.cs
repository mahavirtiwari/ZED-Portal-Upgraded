using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Portal.Features.Incentives.Staff;

/// <summary>
/// The schemes an agency or assessor verifies (Users.SchemeVerification, 2026-11-20, approved): per active scheme the ticks
/// "Desktop verification" and "Onsite verification". 2026-11-20 (the product owner): only the incentive verification agencies verify
/// (a desktop agency "CODE:D", an onsite agency "CODE:O"); the Master Admin ticks them on "Incentive Verification Agencies" (these
/// agency endpoints remain, within the agency's kind; an assessment agency can no longer be ticked). An incentive agency sets its own
/// assessors', only for the schemes and kinds the agency itself is ticked for (the assessor's page). Under api/staff/users/… so the
/// sub-users' "users" / "assessors" screen permissions cover them.
/// </summary>
[PortalSystems(PortalSystem.Main)]
public sealed class SchemeTicksController(ISqlExecutor db, SchemeStore store, ILogger<SchemeTicksController> log) : StaffApiController
{
    internal const string SaveSql = "UPDATE dbo.Users SET SchemeVerification = @Value WHERE UserId = @UserId AND RoleId = @RoleId; " +
        // Phase 2: the assessor app signs in only assessors with SiteVerification (SP_APP_SA_CHECK_LOGIN); an onsite agency's
        // assessors inherit its cleared flags, so ticking one for onsite visits opens the app to it (migration 0106 does the same).
        "UPDATE dbo.Users SET SiteVerification = 1 WHERE UserId = @UserId AND RoleId = 3 AND @RoleId = 3 AND ISNULL(SiteVerification, 0) = 0 " +
        "AND @Value LIKE '%:O%' AND CreatedBy IN (SELECT UserId FROM dbo.Users WHERE RoleId = 2 AND AgencyKind = 'SchemeOnsite');";

    public sealed record SchemeTick(string Code, string Name, bool Desktop, bool Onsite, bool CanDesktop, bool CanOnsite);
    public sealed record TicksResponse(string UserId, string? UserName, IReadOnlyList<SchemeTick> Schemes, bool CanEdit);
    public sealed record TickInput(string? Code, bool Desktop, bool Onsite);
    public sealed record TicksRequest(IReadOnlyList<TickInput>? Ticks);

    [HttpGet("api/staff/users/agencies/{userId}/schemes")]
    [StaffRoles(UserRole.MasterAdmin)]
    public async Task<ActionResult<TicksResponse>> AgencyTicks(string userId, CancellationToken ct)
    {
        if (await UserAsync(userId, UserRole.Agency, ct) is not { } agency) return NotFound();
        return await ResponseAsync(agency, KindLimit(agency), true, ct);
    }

    [HttpPut("api/staff/users/agencies/{userId}/schemes")]
    [StaffRoles(UserRole.MasterAdmin)]
    public async Task<ActionResult<MessageResponse>> SaveAgencyTicks(string userId, TicksRequest req, CancellationToken ct)
    {
        if (await UserAsync(userId, UserRole.Agency, ct) is not { } agency) return NotFound();
        return await SaveAsync(agency, UserRole.Agency, KindLimit(agency), req, ct);
    }

    [HttpGet("api/staff/users/assessors/{userId}/schemes")]
    [StaffRoles(UserRole.Agency, UserRole.MasterAdmin)]
    public async Task<ActionResult<TicksResponse>> AssessorTicks(string userId, CancellationToken ct)
    {
        if (await UserAsync(userId, UserRole.DesktopAssessor, ct) is not { } assessor) return NotFound();
        var isAgency = IsRole(UserRole.Agency);
        if (isAgency && !SameUser(assessor.CreatedBy, UserId)) return NotFound();
        var agency = await SchemeCases.UserAsync(db, assessor.CreatedBy, ct);
        return await ResponseAsync(assessor, TicksLimit(agency), isAgency, ct);
    }

    [HttpPut("api/staff/users/assessors/{userId}/schemes")]
    [StaffRoles(UserRole.Agency)]
    public async Task<ActionResult<MessageResponse>> SaveAssessorTicks(string userId, TicksRequest req, CancellationToken ct)
    {
        if (await UserAsync(userId, UserRole.DesktopAssessor, ct) is not { } assessor || !SameUser(assessor.CreatedBy, UserId)) return NotFound();
        var agency = await SchemeCases.UserAsync(db, UserId, ct);
        return await SaveAsync(assessor, UserRole.DesktopAssessor, TicksLimit(agency), req, ct);
    }

    /// <summary>
    /// 2026-11-20 (the product owner): desktop and onsite are always different agencies, both added apart from the assessment
    /// agencies: a desktop verification agency is ticked for the desktop verification only, an onsite verification agency for the
    /// onsite verification only, and an assessment agency for none.
    /// </summary>
    private static Func<string, string, bool> KindLimit(SchemeCases.UserRow agency) =>
        agency.IsOnsiteAgency ? (_, kind) => kind == SchemeTicks.Onsite
        : agency.IsDesktopAgency ? (_, kind) => kind == SchemeTicks.Desktop
        : (_, _) => false;

    /// <summary>An assessor's ticks: within its agency's own, and only when the agency is an incentive verification agency.</summary>
    private static Func<string, string, bool> TicksLimit(SchemeCases.UserRow? agency) =>
        agency is { IsDesktopAgency: true } or { IsOnsiteAgency: true }
            ? (code, kind) => SchemeTicks.Has(agency.SchemeVerification, code, kind)
            : (_, _) => false;

    /// <param name="limit">The ticks an assessor's are limited to (its agency's), or the kinds an agency may have.</param>
    private async Task<TicksResponse> ResponseAsync(SchemeCases.UserRow user, Func<string, string, bool> limit, bool canEdit, CancellationToken ct)
    {
        var mine = SchemeTicks.Parse(user.SchemeVerification);
        var schemes = (await store.AllAsync(ct)).Where(s => s.Active || mine.Any(t => t.StartsWith(s.Code.ToUpperInvariant() + ":", StringComparison.Ordinal)))
            .Select(s => new SchemeTick(s.Code, s.Name,
                mine.Contains($"{s.Code.ToUpperInvariant()}:{SchemeTicks.Desktop}"), mine.Contains($"{s.Code.ToUpperInvariant()}:{SchemeTicks.Onsite}"),
                limit(s.Code, SchemeTicks.Desktop), limit(s.Code, SchemeTicks.Onsite)))
            .ToList();
        return new TicksResponse(user.UserId!.Trim(), user.UserName, schemes, canEdit);
    }

    private async Task<ActionResult<MessageResponse>> SaveAsync(SchemeCases.UserRow user, UserRole role, Func<string, string, bool> limit, TicksRequest req, CancellationToken ct)
    {
        if (req.Ticks is null || req.Ticks.Count > 200) return this.Problem400("Invalid ticks.");
        var schemes = await store.AllAsync(ct);
        var codes = schemes.Select(s => s.Code).ToList();
        var ticks = new List<string>();
        foreach (var t in req.Ticks)
        {
            var scheme = schemes.FirstOrDefault(s => string.Equals(s.Code, t.Code?.Trim(), StringComparison.OrdinalIgnoreCase));
            if (scheme is null) return this.Problem400("Unknown scheme.");
            if ((t.Desktop && !limit(scheme.Code, SchemeTicks.Desktop)) || (t.Onsite && !limit(scheme.Code, SchemeTicks.Onsite)))
                return this.Problem400(role == UserRole.Agency
                    ? $"{scheme.Name}: a desktop verification agency verifies at the desktop only, an onsite verification agency onsite only, and an assessment agency verifies no scheme."
                    : $"{scheme.Name}: your agency is not ticked for this verification.");
            if (t.Desktop) ticks.Add($"{scheme.Code}:{SchemeTicks.Desktop}");
            if (t.Onsite) ticks.Add($"{scheme.Code}:{SchemeTicks.Onsite}");
        }
        // Only the schemes sent are replaced (the others keep their ticks).
        var sent = req.Ticks.Select(t => t.Code!.Trim()).ToList();
        var value = SchemeTicks.Replace(user.SchemeVerification, sent, ticks);
        if (value?.Length > SchemeTicks.MaxLength) return this.Problem400("Too many schemes ticked.");
        await db.ExecuteSqlAsync(SaveSql, new { Value = value, UserId = SchemeApplications.Ansi(user.UserId!.Trim(), 50), RoleId = (int)role }, ct);
        log.LogInformation("Scheme verification of {UserId} set to '{Value}' by {Actor}", user.UserId, value, ActorId);
        return new MessageResponse("Scheme verification saved.");
    }

    private async Task<SchemeCases.UserRow?> UserAsync(string userId, UserRole role, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(userId) || userId.Length > 50) return null;
        var u = await SchemeCases.UserAsync(db, userId, ct);
        return u is not null && u.RoleId == (int)role ? u : null;
    }

    private static bool SameUser(string? a, string? b) =>
        !string.IsNullOrWhiteSpace(a) && string.Equals(a.Trim(), b?.Trim(), StringComparison.OrdinalIgnoreCase);
}
