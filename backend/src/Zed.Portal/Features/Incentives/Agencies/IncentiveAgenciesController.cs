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

namespace Zed.Portal.Features.Incentives.Agencies;

/// <summary>
/// 2026-11-20 (the product owner): the Master Admin's "Incentive Verification Agencies" (it was "Onsite Verification Agencies"): list,
/// add and edit the agencies that verify incentive scheme applications, never the normal assessments. The type is chosen at creation
/// and never changes: a <b>desktop verification</b> agency (<see cref="IncentiveAgencies.DesktopKind"/>, schemes ticked "CODE:D": every
/// scheme) or an <b>onsite verification</b> agency (<see cref="IncentiveAgencies.OnsiteKind"/>, "CODE:O": the Desktop + Onsite schemes),
/// so desktop and onsite are always different agencies. Each has several states and, per state, its districts (none = the whole state):
/// the round robin of its stage goes by the unit's plant state and district. Activate / deactivate; a set-password link. An agency is
/// created as every assessment agency (SP_INSERT_USER RoleId 2, the welcome mail with a set-password link), then marked with its kind,
/// its Desktop / Site / Financial / Bronze flags cleared and no organising partner (so no normal allotment ever picks it; migrations
/// 0106 / 0107 enforce it on each deploy). It creates its assessors and sub-users as other agencies.
/// The old address api/staff/scheme-onsite/agencies keeps working (a new agency there is an onsite one when no type is sent).
/// </summary>
[Route("api/staff/scheme-agencies")]
[Route(OldBase)]
[StaffRoles(UserRole.MasterAdmin)]
[PortalSystems(PortalSystem.Main)]
public sealed class IncentiveAgenciesController(
    ISqlExecutor db, PortalHost host, SchemeStore store, IEmailSender email, IHtmlTemplateRenderer templates, IOptions<PortalOptions> portal,
    ILogger<IncentiveAgenciesController> log) : StaffApiController
{
    public const int MaxStates = 40;
    public const int MaxDistrictsPerState = 200;
    /// <summary>The address of phase 2 ("Onsite Verification Agencies"), kept.</summary>
    public const string OldBase = "api/staff/scheme-onsite/agencies";

    /// <summary>The kinds as the API names them.</summary>
    public const string DesktopType = "Desktop";
    public const string OnsiteType = "Onsite";

    internal const string ListSql = """
        SELECT U.Id, U.UserId, U.UserName, U.SpocName, U.Email, U.MobileNo, U.IsActive, U.SchemeVerification, U.AgencyKind,
            (SELECT COUNT(*) FROM dbo.Users A WHERE A.RoleId = 3 AND A.CreatedBy = U.UserId) AS Assessors
        FROM dbo.Users U WHERE U.RoleId = 2 AND U.AgencyKind IN ('SchemeDesktop', 'SchemeOnsite') ORDER BY U.UserName;
        """;

    internal const string OneSql =
        "SELECT TOP 1 UserId, UserName, SpocName, Email, MobileNo, Address, Pincode, AgencyGstNumber, IsActive, SchemeVerification, ReasonForRejection, AgencyKind " +
        "FROM dbo.Users WHERE UserId = @UserId AND RoleId = 2 AND AgencyKind IN ('SchemeDesktop', 'SchemeOnsite');";

    internal const string StatesSql = "SELECT UserId, States, Districts FROM dbo.AgencyUserStates WHERE RoleId = 2 AND UserId IN @Ids ORDER BY States;";

    internal const string DistrictsSql =
        "SELECT LTRIM(RTRIM(DistrictCode)) AS Code, LTRIM(RTRIM(DistrictName)) AS Name FROM dbo.Districts " +
        "WHERE LTRIM(RTRIM(StateCode)) IN @StateCodes AND ISNULL(IsActive, 1) = 1 ORDER BY DistrictName;";

    /// <summary>After SP_INSERT_USER: the agency kind, the cleared assessment flags and the schemes.</summary>
    internal const string MarkSql =
        "UPDATE dbo.Users SET AgencyKind = @Kind, DesktopVerification = 0, SiteVerification = 0, FinancialVerification = 0, " +
        "AllowBronzeAssessments = 0, OrgPartnerId = NULL, OrgPartnerName = NULL, SchemeVerification = @Ticks WHERE UserId = @UserId AND RoleId = 2; " +
        // SP_INSERT_USER also copies the agency to ZED_SURVEILLANCE: an incentive agency never works there (incentive verification only).
        "IF OBJECT_ID('ZED_SURVEILLANCE.dbo.Users') IS NOT NULL UPDATE ZED_SURVEILLANCE.dbo.Users SET IsActive = 0 WHERE UserId = @UserId AND RoleId = 2;";

    internal const string UpdateSql =
        "UPDATE dbo.Users SET UserName = @UserName, SpocName = @SpocName, Email = @Email, MobileNo = @MobileNo, Address = @Address, Pincode = @PinCode, " +
        "AgencyGstNumber = @GstNumber, SchemeVerification = @Ticks, DesktopVerification = 0, SiteVerification = 0, FinancialVerification = 0, " +
        "AllowBronzeAssessments = 0, OrgPartnerId = NULL, OrgPartnerName = NULL " +
        "WHERE UserId = @UserId AND RoleId = 2 AND AgencyKind = @Kind;";

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
        public string? AgencyKind { get; init; }
        public int? Assessors { get; init; }

        /// <summary>The kind (IncentiveAgencies.DesktopKind / OnsiteKind); the queries read only these two.</summary>
        public string Kind => IncentiveAgencies.KindOf(AgencyKind) ?? IncentiveAgencies.OnsiteKind;
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

    /// <param name="Type"><see cref="DesktopType"/> or <see cref="OnsiteType"/>.</param>
    public sealed record ListItem(
        string UserId, string UserName, string? SpocName, string? Email, string? MobileNo, bool IsActive, IReadOnlyList<StateArea> States,
        IReadOnlyList<string> Schemes, int Assessors, string Type);

    /// <summary>GET api/staff/scheme-agencies — every incentive verification agency, both types (an operation admin limited to some agencies: those).</summary>
    [HttpGet]
    public async Task<IReadOnlyList<ListItem>> List(CancellationToken ct)
    {
        var scope = await HttpContext.LoginScopeAsync(ct);
        var rows = (await db.QuerySqlAsync<AgencyRow>(ListSql, null, ct)).Where(r => !string.IsNullOrWhiteSpace(r.UserId) && scope.AllowsAgency(r.UserId)).ToList();
        if (rows.Count == 0) return [];
        var areas = await AreasAsync(rows.Select(r => r.UserId!.Trim()).ToArray(), ct);
        return rows.Select(r => new ListItem(r.UserId!.Trim(), r.UserName?.Trim() ?? r.UserId!.Trim(), r.SpocName, r.Email, r.MobileNo, r.IsActive == true,
            areas.GetValueOrDefault(r.UserId!.Trim()) ?? [], Codes(r.SchemeVerification, r.Kind), r.Assessors ?? 0, TypeOf(r.Kind))).ToList();
    }

    /// <param name="Schemes">The schemes an onsite agency may serve (the Desktop + Onsite schemes).</param>
    /// <param name="DesktopSchemes">The schemes a desktop agency may serve (every scheme: each is verified at the desktop).</param>
    public sealed record Options(IReadOnlyList<string> States, IReadOnlyList<SchemeOption> Schemes, IReadOnlyList<SchemeOption> DesktopSchemes);

    /// <summary>GET …/options — the states (a Master Admin with a scope: its own) and the schemes of each type.</summary>
    [HttpGet("options")]
    public async Task<Options> GetOptions(CancellationToken ct) =>
        new(await StatesAsync(ct), await SchemesAsync(IncentiveAgencies.OnsiteKind, ct), await SchemesAsync(IncentiveAgencies.DesktopKind, ct));

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
        bool IsActive, string? ReasonForRejection, IReadOnlyList<StateArea> States, IReadOnlyList<string> Schemes, string Type);

    [HttpGet("{userId}")]
    public async Task<ActionResult<Details>> Get(string userId, CancellationToken ct)
    {
        if (await FindAsync(userId, ct) is not { } r) return NotFound();
        var id = r.UserId!.Trim();
        return new Details(id, r.UserName?.Trim() ?? id, r.SpocName, r.Email, r.MobileNo, r.Address, r.Pincode, r.AgencyGstNumber, r.IsActive == true,
            r.ReasonForRejection, (await AreasAsync([id], ct)).GetValueOrDefault(id) ?? [], Codes(r.SchemeVerification, r.Kind), TypeOf(r.Kind));
    }

    public sealed record AreaInput(string? State, List<string>? Districts);

    /// <param name="Type"><see cref="DesktopType"/> or <see cref="OnsiteType"/>: required for a new agency (on the old address: onsite when
    /// not sent); on an update it may be left out, and cannot change.</param>
    public sealed record AgencyRequest(
        string? UserName, string? SpocName, string? EmailId, string? MobileNo, string? Address, string? PinCode, string? GstNumber,
        List<AreaInput>? States, List<string>? Schemes, string? Type = null);

    public sealed record CreatedResponse(string Message, string? UserId);

    /// <summary>POST api/staff/scheme-agencies — creates a desktop or onsite verification agency (SP_INSERT_USER as the assessment agencies, then marked).</summary>
    [HttpPost]
    public async Task<ActionResult<CreatedResponse>> Create(AgencyRequest req, CancellationToken ct)
    {
        var kind = KindOfType(req.Type) ?? (string.IsNullOrWhiteSpace(req.Type) && OnOldAddress ? IncentiveAgencies.OnsiteKind : null);
        if (kind is null) return this.Problem400("Please select the type of agency: desktop verification or onsite verification.");
        var (v, error) = await ValidateAsync(req, kind, ct);
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
            log.LogError("SP_INSERT_USER did not return the id of the new incentive verification agency created by {Actor}", ActorId);
            return this.Problem400("The agency could not be created. Please try again.");
        }
        await db.ExecuteSqlAsync(MarkSql, new { Kind = Ansi(kind, 20), Ticks = v.Ticks, UserId = Ansi(newId, 50) }, ct);
        foreach (var a in v.Areas)
            await db.ExecuteSqlAsync(SetDistrictsSql, new { Districts = DistrictsText(a.Districts), UserId = Ansi(newId, 100), State = Ansi(a.State, 2000) }, ct);
        await passwords.SetAsync(newId!, password, ct);
        log.LogInformation("Incentive verification agency {NewUserId} ({Kind}) created by {Actor}", newId, kind, ActorId);

        var login = await StaffWelcomeLogin.ForAsync(HttpContext, newId!, (int)UserRole.Agency, password, UserId, ct);
        var sent = await Mail.SendWelcomeAsync<StaffAgencyRegisteredEmail>(v.EmailId,
            (kind == IncentiveAgencies.DesktopKind ? "Desktop" : "Onsite") + " Verification Agency Login Details for “MSME Sustainable (ZED) Certification” - " + newId, login.AddTo(new()
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

    /// <summary>PUT …/{userId} — its details, states and districts, and schemes (its type never changes).</summary>
    [HttpPut("{userId}")]
    public async Task<ActionResult<MessageResponse>> Update(string userId, AgencyRequest req, CancellationToken ct)
    {
        if (await FindAsync(userId, ct) is not { } existing) return NotFound();
        var id = existing.UserId!.Trim();
        var kind = existing.Kind;
        if (!string.IsNullOrWhiteSpace(req.Type) && KindOfType(req.Type) != kind) return this.Problem400("The type of an agency cannot be changed.");
        var (v, error) = await ValidateAsync(req, kind, ct, (await AreasAsync([id], ct)).GetValueOrDefault(id)?.Select(a => a.State));
        if (error is not null) return this.Problem400(error);
        // Every scheme's ticks are replaced by its kind's tick (an agency is one kind only).
        var codes = (await store.AllAsync(ct)).Select(s => s.Code).ToList();
        var tick = IncentiveAgencies.TickOf(kind);
        var ticks = SchemeTicks.Replace(existing.SchemeVerification, codes, v!.Schemes.Select(c => $"{c}:{tick}"));
        await db.ExecuteSqlAsync(UpdateSql, new
        {
            UserName = v.UserName, SpocName = v.SpocName, Email = v.EmailId, MobileNo = v.MobileNo, Address = v.Address, PinCode = v.PinCode,
            GstNumber = v.GstNumber, Ticks = ticks, UserId = Ansi(id, 50), Kind = Ansi(kind, 20),
        }, ct);
        await db.ExecuteSqlAsync(ClearStatesSql, new { UserId = Ansi(id, 100) }, ct);
        foreach (var a in v.Areas)
            await db.ExecuteSqlAsync(InsertStateSql, new { UserId = Ansi(id, 100), State = Ansi(a.State, 2000), Districts = DistrictsText(a.Districts) }, ct);
        log.LogInformation("Incentive verification agency {UserId} ({Kind}) updated by {Actor}", id, kind, ActorId);
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
    private async Task<(Values? Values, string? Error)> ValidateAsync(AgencyRequest req, string kind, CancellationToken ct, IEnumerable<string>? existingStates = null)
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

        var onsite = kind == IncentiveAgencies.OnsiteKind;
        var schemes = await SchemesAsync(kind, ct);
        var picked = new List<string>();
        foreach (var code in (req.Schemes ?? []).Where(c => !string.IsNullOrWhiteSpace(c)))
        {
            var s = schemes.FirstOrDefault(x => string.Equals(x.Code, code.Trim(), StringComparison.OrdinalIgnoreCase));
            if (s is null) return (null, onsite ? "Please select schemes verified at the desktop and onsite." : "Please select valid schemes.");
            if (!picked.Contains(s.Code)) picked.Add(s.Code);
        }
        if (picked.Count == 0)
            return (null, onsite ? "Please select at least one scheme the agency verifies onsite." : "Please select at least one scheme the agency verifies at the desktop.");
        var ticks = string.Join(',', picked.Select(c => $"{c.ToUpperInvariant()}:{IncentiveAgencies.TickOf(kind)}"));
        if (ticks.Length > SchemeTicks.MaxLength) return (null, "Too many schemes selected.");
        return (new Values(name!, spoc!, mail!, mobile, address!, pin, gst, areas, picked, ticks), null);
    }

    private static string? DistrictsText(IReadOnlyList<string> districts) => districts.Count == 0 ? null : string.Join(',', districts);

    /// <summary>
    /// The schemes an agency of the kind can serve (switched-off ones too, marked): an onsite agency those with the Desktop + Onsite
    /// flow, a desktop agency every scheme (each is verified at the desktop).
    /// </summary>
    private async Task<List<SchemeOption>> SchemesAsync(string kind, CancellationToken ct) =>
        (await store.AllAsync(ct)).Where(s => kind == IncentiveAgencies.DesktopKind || s.Verification.Flow == SchemeRules.DesktopOnsite)
            .Select(s => new SchemeOption(s.Code, s.Name, s.Active)).ToList();

    private bool OnOldAddress => HttpContext.Request.Path.StartsWithSegments("/" + OldBase, StringComparison.OrdinalIgnoreCase);

    /// <summary>The kind of an API type ("Desktop" / "Onsite"), or null.</summary>
    internal static string? KindOfType(string? type) => type?.Trim().ToLowerInvariant() switch
    {
        "desktop" => IncentiveAgencies.DesktopKind,
        "onsite" => IncentiveAgencies.OnsiteKind,
        _ => null,
    };

    private static string TypeOf(string kind) => kind == IncentiveAgencies.DesktopKind ? DesktopType : OnsiteType;

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
                .ToDictionary(g => g.Key, g => (IReadOnlyList<StateArea>)g.Select(r => new StateArea(r.States!.Trim(), IncentiveAgencies.Districts(r.Districts).ToList())).ToList(),
                    StringComparer.OrdinalIgnoreCase);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "States of incentive verification agencies not read");
            return new(StringComparer.OrdinalIgnoreCase);
        }
    }

    /// <summary>The scheme codes ticked for the agency's kind ("CODE:D" for a desktop agency, "CODE:O" for an onsite one).</summary>
    private static IReadOnlyList<string> Codes(string? ticks, string kind) =>
        SchemeTicks.Parse(ticks).Where(t => t.EndsWith(":" + IncentiveAgencies.TickOf(kind), StringComparison.OrdinalIgnoreCase)).Select(t => t[..t.LastIndexOf(':')]).Order().ToList();

    private async Task<AgencyRow?> FindAsync(string userId, CancellationToken ct)
    {
        if (!StaffUserRules.IsUserId(userId)) return null;
        var scope = await HttpContext.LoginScopeAsync(ct);
        var row = (await db.QuerySqlAsync<AgencyRow>(OneSql, new { UserId = Ansi(userId, 50) }, ct)).FirstOrDefault();
        return row is not null && scope.AllowsAgency(row.UserId) ? row : null;
    }

    /// <summary>The agency as the shared block / unblock actions take it (SP_GET_USER_DETAILS_BY_USER_ID), when it is an incentive agency.</summary>
    private async Task<ManagedUser?> ManagedAsync(string userId, CancellationToken ct) =>
        await FindAsync(userId, ct) is null ? null : await StaffUserRules.LoadAsync(db, userId, UserRole.Agency, ct);
}
