using System.Data.Common;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Incentives.Staff;
using Zed.Portal.Features.Staff.PasswordReset;
using Zed.Portal.Features.Staff.Users;
using Zed.Portal.Templates;
using static Zed.Portal.Features.Incentives.SchemeApplications;

namespace Zed.Portal.Features.Incentives.Onsite;

/// <summary>
/// 2026-11-20 (the user, phase 2): the Master Admin's "Onsite Verification Agencies": list, add and edit the agencies that verify
/// incentive scheme applications onsite (only Desktop + Onsite schemes; never the normal assessments), each with several states and,
/// per state, its districts (none = the whole state) and the schemes it serves ("CODE:O"); activate / deactivate; a set-password link.
/// An agency is created as every assessment agency (SP_INSERT_USER RoleId 2, the welcome mail with a set-password link), then marked
/// <see cref="OnsiteAgencyKind"/> with its Desktop / Site / Financial / Bronze flags cleared and no organising partner (so no normal
/// allotment ever picks it; migration 0106 enforces it on each deploy). It creates its assessors and sub-users as other agencies.
/// </summary>
[Route("api/staff/scheme-onsite/agencies")]
[StaffRoles(UserRole.MasterAdmin)]
[PortalSystems(PortalSystem.Main)]
public sealed class OnsiteAgenciesController(
    ISqlExecutor db, PortalHost host, SchemeStore store, IEmailSender email, IHtmlTemplateRenderer templates, IOptions<PortalOptions> portal,
    ILogger<OnsiteAgenciesController> log) : StaffApiController
{
    public const int MaxStates = 40;
    public const int MaxDistrictsPerState = 200;

    internal const string ListSql = """
        SELECT U.Id, U.UserId, U.UserName, U.SpocName, U.Email, U.MobileNo, U.IsActive, U.SchemeVerification,
            (SELECT COUNT(*) FROM dbo.Users A WHERE A.RoleId = 3 AND A.CreatedBy = U.UserId) AS Assessors
        FROM dbo.Users U WHERE U.RoleId = 2 AND U.AgencyKind = 'SchemeOnsite' ORDER BY U.UserName;
        """;

    internal const string OneSql =
        "SELECT TOP 1 UserId, UserName, SpocName, Email, MobileNo, Address, Pincode, AgencyGstNumber, IsActive, SchemeVerification, ReasonForRejection " +
        "FROM dbo.Users WHERE UserId = @UserId AND RoleId = 2 AND AgencyKind = 'SchemeOnsite';";

    internal const string StatesSql = "SELECT UserId, States, Districts FROM dbo.AgencyUserStates WHERE RoleId = 2 AND UserId IN @Ids ORDER BY States;";

    internal const string DistrictsSql =
        "SELECT LTRIM(RTRIM(DistrictCode)) AS Code, LTRIM(RTRIM(DistrictName)) AS Name FROM dbo.Districts " +
        "WHERE LTRIM(RTRIM(StateCode)) IN @StateCodes AND ISNULL(IsActive, 1) = 1 ORDER BY DistrictName;";

    /// <summary>After SP_INSERT_USER: the agency kind, the cleared assessment flags and the schemes.</summary>
    internal const string MarkSql =
        "UPDATE dbo.Users SET AgencyKind = 'SchemeOnsite', DesktopVerification = 0, SiteVerification = 0, FinancialVerification = 0, " +
        "AllowBronzeAssessments = 0, OrgPartnerId = NULL, OrgPartnerName = NULL, SchemeVerification = @Ticks WHERE UserId = @UserId AND RoleId = 2; " +
        // SP_INSERT_USER also copies the agency to ZED_SURVEILLANCE: an onsite agency never works there (incentive verification only).
        "IF OBJECT_ID('ZED_SURVEILLANCE.dbo.Users') IS NOT NULL UPDATE ZED_SURVEILLANCE.dbo.Users SET IsActive = 0 WHERE UserId = @UserId AND RoleId = 2;";

    internal const string UpdateSql =
        "UPDATE dbo.Users SET UserName = @UserName, SpocName = @SpocName, Email = @Email, MobileNo = @MobileNo, Address = @Address, Pincode = @PinCode, " +
        "AgencyGstNumber = @GstNumber, SchemeVerification = @Ticks, DesktopVerification = 0, SiteVerification = 0, FinancialVerification = 0, " +
        "AllowBronzeAssessments = 0, OrgPartnerId = NULL, OrgPartnerName = NULL " +
        "WHERE UserId = @UserId AND RoleId = 2 AND AgencyKind = 'SchemeOnsite';";

    internal const string ClearStatesSql = "DELETE FROM dbo.AgencyUserStates WHERE UserId = @UserId AND RoleId = 2;";

    internal const string InsertStateSql =
        "INSERT INTO dbo.AgencyUserStates (UserId, RoleId, States, IsActive, Districts) VALUES (@UserId, 2, @State, 1, @Districts);";

    internal const string SetDistrictsSql = "UPDATE dbo.AgencyUserStates SET Districts = @Districts WHERE UserId = @UserId AND RoleId = 2 AND States = @State;";

    private StaffUserMail Mail => new(email, templates, portal, HttpContext.RequestServices.GetRequiredService<EmailAddresses>(), log);

    public sealed class AgencyRow
    {
        public long Id { get; init; }
        public string? UserId { get; init; }
        public string? UserName { get; init; }
        public string? SpocName { get; init; }
        public string? Email { get; init; }
        public string? MobileNo { get; init; }
        public string? Address { get; init; }
        public string? Pincode { get; init; }
        public string? AgencyGstNumber { get; init; }
        public bool? IsActive { get; init; }
        public string? SchemeVerification { get; init; }
        public string? ReasonForRejection { get; init; }
        public int? Assessors { get; init; }
    }

    private sealed class StateRow
    {
        public string? UserId { get; init; }
        public string? States { get; init; }
        public string? Districts { get; init; }
    }

    public sealed record District(string Code, string Name);
    public sealed record StateArea(string State, IReadOnlyList<string> Districts);
    public sealed record SchemeOption(string Code, string Name, bool Active);

    public sealed record ListItem(
        string UserId, string UserName, string? SpocName, string? Email, string? MobileNo, bool IsActive, IReadOnlyList<StateArea> States,
        IReadOnlyList<string> Schemes, int Assessors);

    /// <summary>GET api/staff/scheme-onsite/agencies — every onsite agency (an operation admin limited to some agencies: those).</summary>
    [HttpGet]
    public async Task<IReadOnlyList<ListItem>> List(CancellationToken ct)
    {
        var scope = await HttpContext.LoginScopeAsync(ct);
        var rows = (await db.QuerySqlAsync<AgencyRow>(ListSql, null, ct)).Where(r => !string.IsNullOrWhiteSpace(r.UserId) && scope.AllowsAgency(r.UserId)).ToList();
        if (rows.Count == 0) return [];
        var areas = await AreasAsync(rows.Select(r => r.UserId!.Trim()).ToArray(), ct);
        return rows.Select(r => new ListItem(r.UserId!.Trim(), r.UserName?.Trim() ?? r.UserId!.Trim(), r.SpocName, r.Email, r.MobileNo, r.IsActive == true,
            areas.GetValueOrDefault(r.UserId!.Trim()) ?? [], OnsiteCodes(r.SchemeVerification), r.Assessors ?? 0)).ToList();
    }

    public sealed record Options(IReadOnlyList<string> States, IReadOnlyList<SchemeOption> Schemes);

    /// <summary>GET …/options — the states (a Master Admin with a scope: its own) and the Desktop + Onsite schemes.</summary>
    [HttpGet("options")]
    public async Task<Options> GetOptions(CancellationToken ct) => new(await StatesAsync(ct), await SchemesAsync(ct));

    /// <summary>GET …/districts?state= — the active districts of a state (LG Directory masters): LGD code and name.</summary>
    [HttpGet("districts")]
    public async Task<ActionResult<IReadOnlyList<District>>> Districts([FromQuery] string? state, CancellationToken ct)
    {
        var code = Code(state);
        if (code is null) return this.Problem400("Please select a valid state.");
        return (await DistrictsOfAsync(code, ct)).ToList();
    }

    public sealed record Details(
        string UserId, string UserName, string? SpocName, string? Email, string? MobileNo, string? Address, string? PinCode, string? GstNumber,
        bool IsActive, string? ReasonForRejection, IReadOnlyList<StateArea> States, IReadOnlyList<string> Schemes);

    [HttpGet("{userId}")]
    public async Task<ActionResult<Details>> Get(string userId, CancellationToken ct)
    {
        if (await FindAsync(userId, ct) is not { } r) return NotFound();
        var id = r.UserId!.Trim();
        return new Details(id, r.UserName?.Trim() ?? id, r.SpocName, r.Email, r.MobileNo, r.Address, r.Pincode, r.AgencyGstNumber, r.IsActive == true,
            r.ReasonForRejection, (await AreasAsync([id], ct)).GetValueOrDefault(id) ?? [], OnsiteCodes(r.SchemeVerification));
    }

    public sealed record AreaInput(string? State, List<string>? Districts);

    public sealed record AgencyRequest(
        string? UserName, string? SpocName, string? EmailId, string? MobileNo, string? Address, string? PinCode, string? GstNumber,
        List<AreaInput>? States, List<string>? Schemes);

    public sealed record CreatedResponse(string Message, string? UserId);

    /// <summary>POST api/staff/scheme-onsite/agencies — creates an onsite agency (SP_INSERT_USER as the assessment agencies, then marked).</summary>
    [HttpPost]
    public async Task<ActionResult<CreatedResponse>> Create(AgencyRequest req, CancellationToken ct)
    {
        var (v, error) = await ValidateAsync(req, ct);
        if (error is not null) return this.Problem400(error);

        var password = SecureRandom.Password();
        var passwords = PasswordStore.For(db, HttpContext.RequestServices);
        var result = await db.QueryProcMultipleAsync("SP_INSERT_USER", new
        {
            UserId = (string?)null,
            v!.UserName,
            v.SpocName,
            RoleId = (int)UserRole.Agency,
            Email = v.EmailId,
            v.MobileNo,
            CreatedBy = UserId,
            v.Address,
            v.PinCode,
            v.GstNumber,
            IdProofType = (string?)null,
            DesktopVerification = false,
            SiteVerification = false,
            FinancialVerification = false,
            IdProofNumber = (string?)null,
            Password = passwords.StoredValueFor(password),
            ReasonForRejection = (string?)null,
            AssessorType = (string?)null,
            CertificateNo = (string?)null,
            ProfessionalEmail = (string?)null,
            OrgPartnerId = (string?)null,
            PreferredStates = StaffUserRules.Csv(v.Areas.Select(a => a.State).ToList()),
            NicSectors = (string?)null,
            AreaOfknowledge = (string?)null,
        }, ct);
        var newId = result.Scalar(0);
        if (!StaffUserRules.IsUserId(newId))
        {
            var found = (await db.QueryProcMultipleAsync("SP_GET_USER_DETAILS_BY_NAME", new { v.UserName, v.MobileNo, EmailId = v.EmailId }, ct))[0].FirstOrDefault();
            newId = found?.Text("UserId");
        }
        if (!StaffUserRules.IsUserId(newId))
        {
            log.LogError("SP_INSERT_USER did not return the id of the new onsite agency created by {Actor}", ActorId);
            return this.Problem400("The agency could not be created. Please try again.");
        }
        await db.ExecuteSqlAsync(MarkSql, new { Ticks = v.Ticks, UserId = Ansi(newId, 50) }, ct);
        foreach (var a in v.Areas)
            await db.ExecuteSqlAsync(SetDistrictsSql, new { Districts = DistrictsText(a.Districts), UserId = Ansi(newId, 100), State = Ansi(a.State, 2000) }, ct);
        await passwords.SetAsync(newId!, password, ct);
        log.LogInformation("Onsite verification agency {NewUserId} created by {Actor}", newId, ActorId);

        var login = await StaffWelcomeLogin.ForAsync(HttpContext, newId!, (int)UserRole.Agency, password, UserId, ct);
        var sent = await Mail.SendWelcomeAsync<StaffAgencyRegisteredEmail>(v.EmailId,
            "Onsite Verification Agency Login Details for “MSME Sustainable (ZED) Certification” - " + newId, login.AddTo(new()
            {
                [nameof(StaffAgencyRegisteredEmail.UserName)] = v.UserName,
                [nameof(StaffAgencyRegisteredEmail.UserId)] = newId,
                [nameof(StaffAgencyRegisteredEmail.SpocName)] = v.SpocName,
                [nameof(StaffAgencyRegisteredEmail.MobileNo)] = v.MobileNo,
                [nameof(StaffAgencyRegisteredEmail.EmailId)] = v.EmailId,
                [nameof(StaffAgencyRegisteredEmail.DesktopVerification)] = false,
                [nameof(StaffAgencyRegisteredEmail.SiteVerification)] = false,
                [nameof(StaffAgencyRegisteredEmail.FinancialVerification)] = false,
                [nameof(StaffAgencyRegisteredEmail.LoginUrl)] = Mail.LoginUrl,
                [nameof(StaffAgencyRegisteredEmail.Consultancy)] = false,
            }), ct);
        return new CreatedResponse(sent
            ? $"Agency created successfully. The login details have been sent to {v.EmailId}."
            : "Agency created, but the e-mail with the login details could not be sent. Please contact the ZED support team.", newId);
    }

    /// <summary>PUT …/{userId} — its details, states and districts, and schemes.</summary>
    [HttpPut("{userId}")]
    public async Task<ActionResult<MessageResponse>> Update(string userId, AgencyRequest req, CancellationToken ct)
    {
        if (await FindAsync(userId, ct) is not { } existing) return NotFound();
        var id = existing.UserId!.Trim();
        var (v, error) = await ValidateAsync(req, ct, (await AreasAsync([id], ct)).GetValueOrDefault(id)?.Select(a => a.State));
        if (error is not null) return this.Problem400(error);
        // Only the Desktop + Onsite schemes' onsite ticks are replaced (others, e.g. of a scheme switched off, are kept).
        var codes = (await store.AllAsync(ct)).Select(s => s.Code).ToList();
        var ticks = SchemeTicks.Replace(existing.SchemeVerification, codes, v!.Schemes.Select(c => $"{c}:{SchemeTicks.Onsite}"));
        await db.ExecuteSqlAsync(UpdateSql, new
        {
            UserName = v.UserName, SpocName = v.SpocName, Email = v.EmailId, MobileNo = v.MobileNo, Address = v.Address, PinCode = v.PinCode,
            GstNumber = v.GstNumber, Ticks = ticks, UserId = Ansi(id, 50),
        }, ct);
        await db.ExecuteSqlAsync(ClearStatesSql, new { UserId = Ansi(id, 100) }, ct);
        foreach (var a in v.Areas)
            await db.ExecuteSqlAsync(InsertStateSql, new { UserId = Ansi(id, 100), State = Ansi(a.State, 2000), Districts = DistrictsText(a.Districts) }, ct);
        log.LogInformation("Onsite verification agency {UserId} updated by {Actor}", id, ActorId);
        return new MessageResponse("Agency updated successfully.");
    }

    public sealed record ReasonRequest(string? Reason);

    /// <summary>POST …/{userId}/deactivate — blocks the login (SP_BLOCK_UNBLOCK_USER, the reason recorded and mailed).</summary>
    [HttpPost("{userId}/deactivate")]
    public async Task<ActionResult<MessageResponse>> Deactivate(string userId, ReasonRequest req, CancellationToken ct)
    {
        if (await ManagedAsync(userId, ct) is not { } agency) return NotFound();
        if (StaffUserActions.ReasonError(req.Reason, block: true, out var reason) is { } error) return this.Problem400(error);
        return await StaffUserActions.BlockAsync(this, db, host, Mail, agency, reason!, UserId, log, ct);
    }

    [HttpPost("{userId}/activate")]
    public async Task<ActionResult<MessageResponse>> Activate(string userId, ReasonRequest req, CancellationToken ct)
    {
        if (await ManagedAsync(userId, ct) is not { } agency) return NotFound();
        if (StaffUserActions.ReasonError(req.Reason, block: false, out var reason) is { } error) return this.Problem400(error);
        return await StaffUserActions.UnblockAsync(this, db, host, Mail, agency, reason!, UserId, log, ct);
    }

    /// <summary>POST …/{userId}/password-reset — mails the agency a link to set a new password.</summary>
    [HttpPost("{userId}/password-reset")]
    public async Task<ActionResult<MessageResponse>> PasswordReset(string userId, [FromServices] StaffPasswordResets resets, CancellationToken ct)
    {
        if (await FindAsync(userId, ct) is not { } agency) return NotFound();
        return this.ToResponse(await resets.SendByAdminAsync(agency.UserId!.Trim(), CurrentUser, HttpContext.Connection.RemoteIpAddress?.ToString(), ct));
    }

    // ----- helpers -----

    private sealed record Values(
        string UserName, string SpocName, string EmailId, string MobileNo, string Address, string PinCode, string? GstNumber,
        List<StateArea> Areas, List<string> Schemes, string? Ticks);

    /// <param name="existingStates">On an update, the agency's states (kept valid even if no longer in the masters or the scope).</param>
    private async Task<(Values? Values, string? Error)> ValidateAsync(AgencyRequest req, CancellationToken ct, IEnumerable<string>? existingStates = null)
    {
        if (!StaffUserRules.TryText(req.UserName, 100, true, false, out var name)) return (null, "Please enter the agency name (up to 100 characters).");
        if (!StaffUserRules.TryText(req.SpocName, 100, true, false, out var spoc)) return (null, "Please enter the SPOC name (up to 100 characters).");
        var mail = req.EmailId?.Trim();
        if (!StaffUserRules.IsEmail(mail)) return (null, "Please enter a valid SPOC Email ID.");
        var mobile = req.MobileNo?.Trim();
        if (mobile is null || !StaffUserRules.MobilePattern().IsMatch(mobile)) return (null, "Please enter a valid 10 digit SPOC mobile number.");
        if (!StaffUserRules.TryText(req.Address, 2000, true, true, out var address)) return (null, "Please enter the registered address (up to 2000 characters).");
        var pin = req.PinCode?.Trim();
        if (pin is null || !StaffUserRules.PinCodePattern().IsMatch(pin)) return (null, "Please enter a valid 6 digit PinCode.");
        var gst = string.IsNullOrWhiteSpace(req.GstNumber) ? null : req.GstNumber.Trim().ToUpperInvariant();
        if (!StaffUserRules.IsGst(gst)) return (null, "Please enter a valid GSTIN.");

        var input = (req.States ?? []).Where(a => !string.IsNullOrWhiteSpace(a.State)).ToList();
        if (input.Count == 0) return (null, "Please select at least one state the agency serves.");
        if (input.Count > MaxStates) return (null, $"At most {MaxStates} states.");
        var allowed = (await StatesAsync(ct)).Concat(existingStates ?? []).ToList();
        var areas = new List<StateArea>();
        foreach (var a in input)
        {
            var state = allowed.FirstOrDefault(s => string.Equals(s, a.State!.Trim(), StringComparison.OrdinalIgnoreCase));
            if (state is null) return (null, $"Please select valid states ({a.State!.Trim()} is not one of them).");
            if (areas.Any(x => string.Equals(x.State, state, StringComparison.OrdinalIgnoreCase))) return (null, $"{state} is selected twice.");
            var chosen = (a.Districts ?? []).Where(d => !string.IsNullOrWhiteSpace(d)).Select(d => d.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            if (chosen.Count > MaxDistrictsPerState) return (null, $"{state}: at most {MaxDistrictsPerState} districts.");
            if (chosen.Count > 0)
            {
                var known = Code(state) is { } code ? (await DistrictsOfAsync(code, ct)).Select(d => d.Code).ToHashSet(StringComparer.OrdinalIgnoreCase) : [];
                if (chosen.FirstOrDefault(d => !known.Contains(d)) is { } bad) return (null, $"{state}: the district {bad} is not one of its districts.");
            }
            areas.Add(new StateArea(state, chosen));
        }

        var schemes = await SchemesAsync(ct);
        var picked = new List<string>();
        foreach (var code in (req.Schemes ?? []).Where(c => !string.IsNullOrWhiteSpace(c)))
        {
            var s = schemes.FirstOrDefault(x => string.Equals(x.Code, code.Trim(), StringComparison.OrdinalIgnoreCase));
            if (s is null) return (null, "Please select schemes verified at the desktop and onsite.");
            if (!picked.Contains(s.Code)) picked.Add(s.Code);
        }
        if (picked.Count == 0) return (null, "Please select at least one scheme the agency verifies onsite.");
        var ticks = string.Join(',', picked.Select(c => $"{c.ToUpperInvariant()}:{SchemeTicks.Onsite}"));
        if (ticks.Length > SchemeTicks.MaxLength) return (null, "Too many schemes selected.");
        return (new Values(name!, spoc!, mail!, mobile, address!, pin, gst, areas, picked, ticks), null);
    }

    private static string? DistrictsText(IReadOnlyList<string> districts) => districts.Count == 0 ? null : string.Join(',', districts);

    /// <summary>The schemes an onsite agency can serve: those with the Desktop + Onsite flow (switched-off ones too, marked).</summary>
    private async Task<List<SchemeOption>> SchemesAsync(CancellationToken ct) =>
        (await store.AllAsync(ct)).Where(s => s.Verification.Flow == SchemeRules.DesktopOnsite).Select(s => new SchemeOption(s.Code, s.Name, s.Active)).ToList();

    private async Task<List<string>> StatesAsync(CancellationToken ct)
    {
        var scope = await HttpContext.LoginScopeAsync(ct);
        return scope.StateCodes.Count == 0
            ? StaffUserRules.States.ToList()
            : StaffUserRules.States.Where(st => scope.StateNames.Contains(st, StringComparer.OrdinalIgnoreCase)).ToList();
    }

    /// <summary>The LGD code of a state name (or code) of the masters.</summary>
    private static string? Code(string? state)
    {
        if (string.IsNullOrWhiteSpace(state)) return null;
        var s = state.Trim();
        return Zed.Portal.Features.Staff.Masters.StateMaster.All.FirstOrDefault(x => string.Equals(x.Name, s, StringComparison.OrdinalIgnoreCase)
            || x.Code == Zed.Portal.Features.Staff.Masters.StateMaster.Code(s))?.Code;
    }

    private async Task<IReadOnlyList<District>> DistrictsOfAsync(string stateCode, CancellationToken ct)
    {
        var codes = new[] { stateCode, stateCode.PadLeft(2, '0') }.Distinct().ToArray();
        return (await db.QuerySqlAsync<District>(DistrictsSql, new { StateCodes = codes }, ct))
            .Where(d => !string.IsNullOrWhiteSpace(d.Code)).ToList();
    }

    private async Task<Dictionary<string, IReadOnlyList<StateArea>>> AreasAsync(string[] ids, CancellationToken ct)
    {
        try
        {
            return (await db.QuerySqlAsync<StateRow>(StatesSql, new { Ids = ids }, ct))
                .Where(r => !string.IsNullOrWhiteSpace(r.UserId) && !string.IsNullOrWhiteSpace(r.States))
                .GroupBy(r => r.UserId!.Trim(), StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => (IReadOnlyList<StateArea>)g.Select(r => new StateArea(r.States!.Trim(), OnsiteAgencies.Districts(r.Districts).ToList())).ToList(),
                    StringComparer.OrdinalIgnoreCase);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "States of onsite agencies not read");
            return new(StringComparer.OrdinalIgnoreCase);
        }
    }

    private static IReadOnlyList<string> OnsiteCodes(string? ticks) =>
        SchemeTicks.Parse(ticks).Where(t => t.EndsWith(":" + SchemeTicks.Onsite, StringComparison.OrdinalIgnoreCase)).Select(t => t[..t.LastIndexOf(':')]).Order().ToList();

    private async Task<AgencyRow?> FindAsync(string userId, CancellationToken ct)
    {
        if (!StaffUserRules.IsUserId(userId)) return null;
        var scope = await HttpContext.LoginScopeAsync(ct);
        var row = (await db.QuerySqlAsync<AgencyRow>(OneSql, new { UserId = Ansi(userId, 50) }, ct)).FirstOrDefault();
        return row is not null && scope.AllowsAgency(row.UserId) ? row : null;
    }

    /// <summary>The agency as the shared block / unblock actions take it (SP_GET_USER_DETAILS_BY_USER_ID), when it is an onsite agency.</summary>
    private async Task<ManagedUser?> ManagedAsync(string userId, CancellationToken ct) =>
        await FindAsync(userId, ct) is null ? null : await StaffUserRules.LoadAsync(db, userId, UserRole.Agency, ct);
}
