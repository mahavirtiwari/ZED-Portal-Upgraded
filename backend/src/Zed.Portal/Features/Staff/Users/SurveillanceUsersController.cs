using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.Dashboard;
using Zed.Portal.Features.Staff.PasswordReset;
using Zed.Portal.Templates;

namespace Zed.Portal.Features.Staff.Users;

/// <summary>
/// Surveillance agencies and assessors (ZEDCS_SURVEILLANCE User/AssessmentAgencies "Bronze Surveillance Agencies",
/// CertificationBodies, User/Assessors, Block / UnBlock). Accounts are mastered in main: main's SP_INSERT_USER /
/// SP_UPDATE_USER / SP_BLOCK_UNBLOCK_USER also write ZED_SURVEILLANCE.Users, so nothing is created or renamed here
/// (ZED_SURVEILLANCE's own SP_INSERT_USER is not called).
/// <para>
/// What is managed here, in this database only:
/// <list type="bullet">
/// <item>Bronze surveillance: Users.AllowBronzeSurveillance (+ ReasonForRejectionForBS when disabled) of an agency, with its
/// preferred state (Users.TuPreferredState, LGD code matched against Msme.StateId) and districts (AgencyUserDistricts),
/// which SP_MSME_AUTO_ALLOT_AGENCY_ROUND_ROBIN uses to allot Bronze surveillance; and the flag of an assessor, which the
/// agency's assessor choice (SP_GET_USERS_BY_ROLE) requires. No legacy screen set these (they were set in the database).</item>
/// <item>Block / unblock: the legacy inline UPDATE (ZED_SURVEILLANCE has no SP_BLOCK_UNBLOCK_USER), limited to the role.</item>
/// </list>
/// Lists use explicit columns (the legacy procedures SELECT * on Users, password included). The MasterAdmin sees every
/// agency (SP_GET_USERS_BY_ROLE lists only agencies already allowed for Bronze surveillance, so none could be enabled);
/// an agency sees and manages only the assessors it created.
/// </para>
/// </summary>
[Route("api/staff/surveillance-users")]
[StaffRoles(UserRole.MasterAdmin, UserRole.Agency)]
[PortalSystems(PortalSystem.Surveillance)]
public sealed class SurveillanceUsersController(
    ISqlExecutor db,
    IEmailSender email,
    IHtmlTemplateRenderer templates,
    IOptions<PortalOptions> portal,
    ILogger<SurveillanceUsersController> log) : StaffApiController
{
    private StaffUserMail Mail => new(email, templates, portal, HttpContext.RequestServices.GetRequiredService<EmailAddresses>(), log);

    public sealed class AgencyRow
    {
        public string? UserId { get; init; }
        public string? UserName { get; init; }
        public string? SpocName { get; init; }
        public string? Email { get; init; }
        public string? MobileNo { get; init; }
        public bool? IsActive { get; init; }
        public string? ReasonForRejection { get; init; }
        public bool? DesktopVerification { get; init; }
        public bool? SiteVerification { get; init; }
        public bool? AllowBronzeSurveillance { get; init; }
        public string? ReasonForRejectionForBS { get; init; }
        public string? TuPreferredState { get; init; }
        public int NoOfUsers { get; init; }
    }

    public const string AgenciesSql =
        "SELECT U.UserId, U.UserName, U.SpocName, U.Email, U.MobileNo, U.IsActive, U.ReasonForRejection, U.DesktopVerification, " +
        "U.SiteVerification, U.AllowBronzeSurveillance, U.ReasonForRejectionForBS, U.TuPreferredState, " +
        "(SELECT COUNT(*) FROM Users A WHERE A.CreatedBy = U.UserId AND A.RoleId = 3) AS NoOfUsers " +
        "FROM Users U WHERE U.RoleId = 2 ORDER BY U.UserId";

    public sealed record StateOption(string Code, string Name);

    /// <summary>States offered for the Bronze surveillance preference (LGD codes).</summary>
    [HttpGet("states")]
    [StaffRoles(UserRole.MasterAdmin)]
    public IReadOnlyList<StateOption> States() => ConsultancyUsers.TuStates.Select(s => new StateOption(s.Key, s.Value)).ToList();

    [HttpGet("districts")]
    [StaffRoles(UserRole.MasterAdmin)]
    public async Task<ActionResult<List<ConsultancyUsers.District>>> Districts(string? state, CancellationToken ct)
    {
        if (state is null || !DashboardFilters.States.ContainsKey(state)) return this.Problem400("Please select a valid state.");
        return await ConsultancyUsers.DistrictsAsync(db, state, ct);
    }

    [HttpGet("agencies")]
    [StaffRoles(UserRole.MasterAdmin)]
    public async Task<IReadOnlyList<AgencyRow>> Agencies(CancellationToken ct) => await db.QuerySqlAsync<AgencyRow>(AgenciesSql, null, ct);

    public sealed record AgencyDetails(AgencyRow Agency, IReadOnlyList<string> Districts);

    [HttpGet("agencies/{userId}")]
    [StaffRoles(UserRole.MasterAdmin)]
    public async Task<ActionResult<AgencyDetails>> Agency(string userId, CancellationToken ct)
    {
        if (!StaffUserRules.IsUserId(userId)) return NotFound();
        var row = (await db.QuerySqlAsync<AgencyRow>(AgenciesSql.Replace("WHERE U.RoleId = 2", "WHERE U.RoleId = 2 AND U.UserId = @UserId"),
            new { UserId = userId }, ct)).FirstOrDefault();
        if (row is null) return NotFound();
        return new AgencyDetails(row, await DistrictsOfAsync(userId, ct));
    }

    public sealed record BronzeSurveillanceRequest(bool Allow, string? Reason, string? PreferredState, List<string>? Districts);

    /// <summary>Enables or disables Bronze surveillance for an agency and sets the state and districts it is allotted from.</summary>
    [HttpPut("agencies/{userId}/bronze-surveillance")]
    [StaffRoles(UserRole.MasterAdmin)]
    public async Task<ActionResult<MessageResponse>> AgencyBronzeSurveillance(string userId, BronzeSurveillanceRequest req, CancellationToken ct)
    {
        var agency = await FindAsync(userId, UserRole.Agency, ct);
        if (agency is null) return NotFound();
        string? reason = null;
        if (!req.Allow && !StaffUserRules.TryText(req.Reason, 2000, required: true, multiline: true, out reason))
            return this.Problem400("Please enter the reason for disabling Bronze surveillance (up to 2000 characters).");
        var state = string.IsNullOrWhiteSpace(req.PreferredState) ? null : req.PreferredState.Trim();
        if (state is not null && !DashboardFilters.States.ContainsKey(state)) return this.Problem400("Please select a valid preferred state.");
        if (req.Allow && state is null) return this.Problem400("Please select the preferred state for Bronze surveillance.");
        List<string> districts = [];
        if (state is not null)
        {
            var picked = StaffUserRules.OnlyAllowed(req.Districts, (await ConsultancyUsers.DistrictsAsync(db, state, ct)).Select(d => d.DistrictCode));
            if (picked is null) return this.Problem400("Please select valid districts of the preferred state.");
            districts = picked;
        }
        else if (req.Districts?.Any(d => !string.IsNullOrWhiteSpace(d)) == true)
        {
            return this.Problem400("Please select the preferred state for the districts.");
        }

        await db.ExecuteSqlAsync(
            "SET XACT_ABORT ON; BEGIN TRAN; " +
            "UPDATE Users SET AllowBronzeSurveillance = @Allow, ReasonForRejectionForBS = @Reason, TuPreferredState = @State WHERE UserId = @UserId AND RoleId = 2; " +
            "DELETE FROM AgencyUserDistricts WHERE UserId = @UserId; " +
            "INSERT INTO AgencyUserDistricts (UserId, RoleId, Districts, IsActive) SELECT @UserId, 2, value, 1 FROM STRING_SPLIT(@Districts, ',') WHERE value <> ''; " +
            "COMMIT;",
            new { Allow = req.Allow, Reason = req.Allow ? null : reason, State = state, UserId = agency.UserId, Districts = string.Join(",", districts) }, ct);
        log.LogInformation("Bronze surveillance {State} for agency {UserId} (state {PreferredState}, {Districts} districts) by {Actor}",
            req.Allow ? "enabled" : "disabled", agency.UserId, state, districts.Count, UserId);
        return new MessageResponse(req.Allow ? "Bronze surveillance enabled." : "Bronze surveillance disabled.");
    }

    public sealed class AssessorRow
    {
        public string? UserId { get; init; }
        public string? UserName { get; init; }
        public string? Email { get; init; }
        public string? MobileNo { get; init; }
        public bool? IsActive { get; init; }
        public string? ReasonForRejection { get; init; }
        public bool? DesktopVerification { get; init; }
        public bool? SiteVerification { get; init; }
        public bool? AllowBronzeSurveillance { get; init; }
        public string? AgencyUserId { get; init; }
        public string? AgencyUserName { get; init; }
    }

    /// <summary>Assessors: all of them for the MasterAdmin (optionally of one agency), the agency's own for an agency.</summary>
    [HttpGet("assessors")]
    public async Task<ActionResult<IReadOnlyList<AssessorRow>>> Assessors(string? agencyId, CancellationToken ct)
    {
        if (!string.IsNullOrEmpty(agencyId) && !StaffUserRules.IsUserId(agencyId)) return this.Problem400("Invalid agency.");
        var agency = IsRole(UserRole.Agency) ? UserId : string.IsNullOrEmpty(agencyId) ? null : agencyId;
        return Ok(await db.QuerySqlAsync<AssessorRow>(
            "SELECT A.UserId, A.UserName, A.Email, A.MobileNo, A.IsActive, A.ReasonForRejection, A.DesktopVerification, A.SiteVerification, " +
            "A.AllowBronzeSurveillance, A.CreatedBy AS AgencyUserId, G.UserName AS AgencyUserName " +
            "FROM Users A LEFT JOIN Users G ON G.UserId = A.CreatedBy AND G.RoleId = 2 " +
            "WHERE A.RoleId = 3 AND (@AgencyId IS NULL OR A.CreatedBy = @AgencyId) ORDER BY A.CreatedBy, A.UserId",
            new { AgencyId = agency }, ct));
    }

    public sealed record AssessorBronzeRequest(bool Allow);

    /// <summary>Allows an assessor to be assigned Bronze surveillance units (MasterAdmin, or the agency that created it).</summary>
    [HttpPut("assessors/{userId}/bronze-surveillance")]
    public async Task<ActionResult<MessageResponse>> AssessorBronzeSurveillance(string userId, AssessorBronzeRequest req, CancellationToken ct)
    {
        var assessor = await FindAsync(userId, UserRole.DesktopAssessor, ct);
        if (assessor is null) return NotFound();
        await db.ExecuteSqlAsync("UPDATE Users SET AllowBronzeSurveillance = @Allow WHERE UserId = @UserId AND RoleId = 3",
            new { Allow = req.Allow, UserId = assessor.UserId }, ct);
        log.LogInformation("Bronze surveillance {State} for assessor {UserId} by {Actor}", req.Allow ? "allowed" : "disallowed", assessor.UserId, UserId);
        return new MessageResponse(req.Allow ? "The assessor can now be assigned Bronze surveillance." : "The assessor can no longer be assigned Bronze surveillance.");
    }

    public sealed record ReasonRequest(string? Reason);

    [HttpPost("agencies/{userId}/block")]
    [StaffRoles(UserRole.MasterAdmin)]
    public Task<ActionResult<MessageResponse>> BlockAgency(string userId, ReasonRequest req, CancellationToken ct) => BlockAsync(userId, UserRole.Agency, req, ct);

    [HttpPost("agencies/{userId}/unblock")]
    [StaffRoles(UserRole.MasterAdmin)]
    public Task<ActionResult<MessageResponse>> UnblockAgency(string userId, CancellationToken ct) => UnblockAsync(userId, UserRole.Agency, ct);

    [HttpPost("assessors/{userId}/block")]
    public Task<ActionResult<MessageResponse>> BlockAssessor(string userId, ReasonRequest req, CancellationToken ct) => BlockAsync(userId, UserRole.DesktopAssessor, req, ct);

    [HttpPost("assessors/{userId}/unblock")]
    public Task<ActionResult<MessageResponse>> UnblockAssessor(string userId, CancellationToken ct) => UnblockAsync(userId, UserRole.DesktopAssessor, ct);

    [HttpPost("agencies/{userId}/password-reset")]
    [StaffRoles(UserRole.MasterAdmin)]
    public Task<ActionResult<MessageResponse>> AgencyPasswordReset(string userId, [FromServices] StaffPasswordResets resets, CancellationToken ct) =>
        PasswordResetAsync(userId, UserRole.Agency, resets, ct);

    [HttpPost("assessors/{userId}/password-reset")]
    public Task<ActionResult<MessageResponse>> AssessorPasswordReset(string userId, [FromServices] StaffPasswordResets resets, CancellationToken ct) =>
        PasswordResetAsync(userId, UserRole.DesktopAssessor, resets, ct);

    /// <summary>
    /// E-mails a link to set a new password. Accounts whose password main holds (after the switch to Migrate, #111) are
    /// refused with a pointer to the main portal.
    /// </summary>
    private async Task<ActionResult<MessageResponse>> PasswordResetAsync(string userId, UserRole role, StaffPasswordResets resets, CancellationToken ct)
    {
        var user = await FindAsync(userId, role, ct);
        if (user is null) return NotFound();
        return this.ToResponse(await resets.SendByAdminAsync(user.UserId, CurrentUser, HttpContext.Connection.RemoteIpAddress?.ToString(), ct));
    }

    private async Task<ActionResult<MessageResponse>> BlockAsync(string userId, UserRole role, ReasonRequest req, CancellationToken ct)
    {
        var user = await FindAsync(userId, role, ct);
        if (user is null) return NotFound();
        if (!StaffUserRules.TryText(req.Reason, 2000, required: true, multiline: true, out var reason))
            return this.Problem400("Please enter the reason for blocking (up to 2000 characters).");
        return await StaffUserActions.BlockAsync(this, db, new PortalHost(PortalSystem.Surveillance), Mail, user, reason!, UserId, log, ct);
    }

    private async Task<ActionResult<MessageResponse>> UnblockAsync(string userId, UserRole role, CancellationToken ct)
    {
        var user = await FindAsync(userId, role, ct);
        if (user is null) return NotFound();
        return await StaffUserActions.UnblockAsync(this, db, new PortalHost(PortalSystem.Surveillance), Mail, user, UserId, log, ct);
    }

    private async Task<ManagedUser?> FindAsync(string userId, UserRole role, CancellationToken ct)
    {
        var user = await StaffUserRules.LoadAsync(db, userId, role, ct);
        return user is not null && StaffUserRules.CanManage(CurrentUser, user, role) ? user : null;
    }

    private async Task<List<string>> DistrictsOfAsync(string userId, CancellationToken ct) =>
        (await db.QuerySqlAsync<string>("SELECT Districts FROM AgencyUserDistricts WHERE UserId = @UserId AND IsActive = 1 ORDER BY Districts",
            new { UserId = userId }, ct)).Where(d => !string.IsNullOrEmpty(d)).ToList();
}
