using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Templates;

namespace Zed.Portal.Features.Staff.Users;

/// <summary>
/// Assessment agencies (certification bodies), managed by the MasterAdmin. Port of UserController
/// AssessmentAgencies / BronzeAssessmentAgencies / CertificationBodies / CreateUser (RoleId 2) /
/// Block / UnBlock / BlockOrUnblockBronzeAssessment / ResetMobileNo.
/// <para>
/// Legacy holes closed here: CreateUser and ResetMobileNo had no sign-in check (anyone could create an
/// agency or overwrite any user — role included — through the hidden UserId/RoleId fields); Block and
/// UnBlock only required a sign-in, used GET and accepted any user id; ResetMobileNo also set the
/// password to the mobile number. The role created here is fixed by the route and the acting user
/// comes from the sign-in cookie.
/// </para>
/// </summary>
[Route("api/staff/users/agencies")]
[StaffRoles(UserRole.MasterAdmin)]
public sealed class StaffAgenciesController(
    ISqlExecutor db,
    IEmailSender email,
    IHtmlTemplateRenderer templates,
    IOptions<PortalOptions> portal,
    IOptions<EmailOptions> emailOptions,
    ILogger<StaffAgenciesController> log) : StaffApiController
{
    private StaffUserMail Mail => new(email, templates, portal, emailOptions, log);

    private static readonly string[] ListColumns =
    [
        "Id", "UserId", "UserName", "Address", "Pincode", "SpocName", "MobileNo", "Email", "IsActive", "IdStatus",
        "DesktopVerfi", "SiteVerifi", "FinanceVerfi", "NoOfUsers", "NoOfBronzeAssessors", "AllowBronzeAssessments",
    ];

    /// <summary>
    /// Agencies created by the signed-in MasterAdmin (SP_GET_USERS_BY_ROLE RoleId 2), for both the
    /// Assessment Agencies and the Bronze Assessment Agencies pages.
    /// </summary>
    [HttpGet]
    public async Task<IReadOnlyList<Dictionary<string, object?>>> List(CancellationToken ct)
    {
        var sets = await db.QueryProcMultipleAsync("SP_GET_USERS_BY_ROLE", new { UserId, RoleId = ((int)UserRole.Agency).ToString() }, ct);
        return sets[0].Select(r =>
        {
            var row = StaffUserRules.Pick(r, ListColumns);
            row["IsActive"] = StaffUserRules.Bool(r, "IsActive");
            row["AllowBronzeAssessments"] = StaffUserRules.Bool(r, "AllowBronzeAssessments");
            return row;
        }).ToList();
    }

    public sealed record OrgPartner(string UserId, string Name);
    public sealed record Sector(string SectorCode, string SectorName);
    public sealed record AgencyOptions(IReadOnlyList<string> States, IReadOnlyList<Sector> Sectors, IReadOnlyList<OrgPartner> OrgPartners);

    /// <summary>Choices of the agency form (SP_MASTER_GET_SECTORS: sectors and organising partners not yet linked to an agency).</summary>
    [HttpGet("options")]
    public async Task<AgencyOptions> Options(CancellationToken ct)
    {
        var sets = await db.QueryProcMultipleAsync("SP_MASTER_GET_SECTORS", null, ct);
        return new AgencyOptions(StaffUserRules.States, Sectors(sets), Partners(sets[1]));
    }

    public sealed record AgencyDetails(
        string UserId, string UserName, string? SpocName, string? EmailId, string? MobileNo, string? Address, string? PinCode,
        string? GstNumber, IReadOnlyList<string> States, IReadOnlyList<string> NicSectors, string? OrgPartnerId, string? OrgPartnerName,
        bool DesktopVerification, bool SiteVerification, bool FinancialVerification, string? ReasonForRejection, bool IsActive);

    /// <summary>One agency for the edit form (SP_GET_USER_DETAILS_BY_USER_ID; legacy CertificationBodies?id=).</summary>
    [HttpGet("{userId}")]
    public async Task<ActionResult<AgencyDetails>> Get(string userId, CancellationToken ct)
    {
        var agency = await FindAsync(userId, ct);
        if (agency is null) return NotFound();
        var r = agency.Row;
        string? T(string c) => r.Text(c) is { Length: > 0 } v ? v : null;
        return new AgencyDetails(agency.UserId, r.Text("UserName"), T("SpocName"), T("Email"), T("MobileNo"), T("Address"), T("Pincode"),
            T("AgencyGstNumber"), agency.States, agency.NicSectors, T("OrgPartnerId"), T("OrgPartnerName"),
            StaffUserRules.Bool(r, "DesktopVerification"), StaffUserRules.Bool(r, "SiteVerification"), StaffUserRules.Bool(r, "FinancialVerification"),
            T("ReasonForRejection"), agency.IsActive);
    }

    public sealed record AgencyRequest(
        string? UserName, string? SpocName, string? EmailId, string? MobileNo, string? Address, string? PinCode, string? GstNumber,
        List<string>? States, List<string>? NicSectors, string? OrgPartnerId,
        bool DesktopVerification, bool SiteVerification, bool FinancialVerification, string? ReasonForRejection);

    public sealed record CreatedUserResponse(string Message, string? UserId);

    /// <summary>
    /// Creates an agency (SP_INSERT_USER, RoleId 2) with a generated password, which is e-mailed to the
    /// SPOC and never returned.
    /// </summary>
    [HttpPost]
    public async Task<ActionResult<CreatedUserResponse>> Create(AgencyRequest req, CancellationToken ct)
    {
        var sets = await db.QueryProcMultipleAsync("SP_MASTER_GET_SECTORS", null, ct);
        var (values, error) = Validate(req, Sectors(sets), Partners(sets[1]).Select(p => p.UserId), existing: null);
        if (error is not null) return this.Problem400(error);

        var password = SecureRandom.Password();
        var result = await db.QueryProcMultipleAsync("SP_INSERT_USER", Parameters(values!, null, password), ct);
        var newId = result.Scalar(0);
        if (!StaffUserRules.IsUserId(newId))
        {
            // SP_INSERT_USER selects the new id first; fall back to the lookup the legacy mail used.
            var found = (await db.QueryProcMultipleAsync("SP_GET_USER_DETAILS_BY_NAME",
                new { values!.UserName, values.MobileNo, EmailId = values.EmailId }, ct))[0].FirstOrDefault();
            newId = found?.Text("UserId");
        }
        if (!StaffUserRules.IsUserId(newId))
        {
            log.LogError("SP_INSERT_USER did not return the id of the new agency created by {Actor}", UserId);
            return this.Problem400("The agency could not be created. Please try again.");
        }
        log.LogInformation("Agency {NewUserId} created by {Actor}", newId, UserId);

        var sent = await Mail.SendAsync<StaffAgencyRegisteredEmail>(values!.EmailId,
            "Assessment Agency Login Details for “MSME Sustainable (ZED) Certification” - " + newId, new()
            {
                [nameof(StaffAgencyRegisteredEmail.UserName)] = values.UserName,
                [nameof(StaffAgencyRegisteredEmail.UserId)] = newId,
                [nameof(StaffAgencyRegisteredEmail.Password)] = password,
                [nameof(StaffAgencyRegisteredEmail.SpocName)] = values.SpocName,
                [nameof(StaffAgencyRegisteredEmail.MobileNo)] = values.MobileNo,
                [nameof(StaffAgencyRegisteredEmail.EmailId)] = values.EmailId,
                [nameof(StaffAgencyRegisteredEmail.DesktopVerification)] = values.DesktopVerification,
                [nameof(StaffAgencyRegisteredEmail.SiteVerification)] = values.SiteVerification,
                [nameof(StaffAgencyRegisteredEmail.FinancialVerification)] = values.FinancialVerification,
                [nameof(StaffAgencyRegisteredEmail.LoginUrl)] = Mail.LoginUrl,
            }, ct);
        return new CreatedUserResponse(sent
            ? $"User created successfully. The login details have been sent to {values.EmailId}."
            : "User created, but the e-mail with the login details could not be sent. Please contact the ZED support team.", newId);
    }

    /// <summary>Updates an agency (SP_UPDATE_USER, RoleId 2). The procedure also copies the verification types to its assessors.</summary>
    [HttpPut("{userId}")]
    public async Task<ActionResult<MessageResponse>> Update(string userId, AgencyRequest req, CancellationToken ct)
    {
        var agency = await FindAsync(userId, ct);
        if (agency is null) return NotFound();

        var sets = await db.QueryProcMultipleAsync("SP_MASTER_GET_SECTORS", null, ct);
        // As on the old form, the organising partner can be kept or cleared, not moved to another one.
        var current = agency.Row.Text("OrgPartnerId");
        var (values, error) = Validate(req, Sectors(sets), current.Length > 0 ? [current] : [], existing: agency);
        if (error is not null) return this.Problem400(error);

        await db.ExecuteProcAsync("SP_UPDATE_USER", Parameters(values!, agency.UserId, null), ct);
        log.LogInformation("Agency {UserId} updated by {Actor}", agency.UserId, UserId);
        return new MessageResponse("User updated successfully.");
    }

    public sealed record ReasonRequest(string? Reason);

    /// <summary>Blocks an agency (SP_BLOCK_UNBLOCK_USER, which also blocks it in ZED_SURVEILLANCE).</summary>
    [HttpPost("{userId}/block")]
    public async Task<ActionResult<MessageResponse>> Block(string userId, ReasonRequest req, CancellationToken ct)
    {
        var agency = await FindAsync(userId, ct);
        if (agency is null) return NotFound();
        if (!StaffUserRules.TryText(req.Reason, 2000, required: true, multiline: true, out var reason))
            return this.Problem400("Please enter the reason for blocking (up to 2000 characters).");
        return await StaffUserActions.BlockAsync(this, db, agency, reason!, UserId, log, ct);
    }

    [HttpPost("{userId}/unblock")]
    public async Task<ActionResult<MessageResponse>> Unblock(string userId, CancellationToken ct)
    {
        var agency = await FindAsync(userId, ct);
        if (agency is null) return NotFound();
        return await StaffUserActions.UnblockAsync(this, db, Mail, agency, UserId, log, ct);
    }

    public sealed record BronzeRequest(bool Allow, string? Reason);

    /// <summary>Enables or disables Bronze assessments for an agency (SP_BLOCK_UNBLOCK_BRONZE_AGENCY) and informs it by e-mail.</summary>
    [HttpPost("{userId}/bronze-assessments")]
    public async Task<ActionResult<MessageResponse>> BronzeAssessments(string userId, BronzeRequest req, CancellationToken ct)
    {
        var agency = await FindAsync(userId, ct);
        if (agency is null) return NotFound();
        string? reason = null;
        if (!req.Allow && !StaffUserRules.TryText(req.Reason, 2000, required: true, multiline: true, out reason))
            return this.Problem400("Please enter the reason for disabling Bronze assessments (up to 2000 characters).");

        var sets = await db.QueryProcMultipleAsync("SP_BLOCK_UNBLOCK_BRONZE_AGENCY",
            new { AllowBronzeAssessments = req.Allow, UserId = agency.UserId, ReasonForBlock = reason ?? "" }, ct);
        var status = sets[0].FirstOrDefault();
        if (status?.Text("StatusCode") != "200")
            return this.Problem400("The Bronze assessment setting could not be changed. Please try again.");
        log.LogInformation("Bronze assessments {State} for agency {UserId} by {Actor}", req.Allow ? "enabled" : "disabled", agency.UserId, UserId);

        var r = agency.Row;
        if (StaffUserRules.IsEmail(r.Text("Email")))
            await Mail.SendAsync<StaffBronzeAssessmentEmail>(r.Text("Email"),
                "“MSME Sustainable (ZED) Certification” - Allocation of Bronze Assessment " + (req.Allow ? "Enabled: " : "Disabled: ") + agency.UserId, new()
                {
                    [nameof(StaffBronzeAssessmentEmail.Allowed)] = req.Allow,
                    [nameof(StaffBronzeAssessmentEmail.UserName)] = r.Text("UserName"),
                    [nameof(StaffBronzeAssessmentEmail.UserId)] = agency.UserId,
                    [nameof(StaffBronzeAssessmentEmail.Reason)] = reason,
                    [nameof(StaffBronzeAssessmentEmail.SpocName)] = r.Text("SpocName"),
                    [nameof(StaffBronzeAssessmentEmail.MobileNo)] = r.Text("MobileNo"),
                    [nameof(StaffBronzeAssessmentEmail.EmailId)] = r.Text("Email"),
                    [nameof(StaffBronzeAssessmentEmail.LoginUrl)] = Mail.LoginUrl,
                }, ct);
        return new MessageResponse(req.Allow ? "Bronze assessments enabled successfully." : "Bronze assessments disabled successfully.");
    }

    public sealed record MobileRequest(string? MobileNo);

    /// <summary>Changes the SPOC mobile number (legacy ResetMobileNo, which had no UI and no authorisation).</summary>
    [HttpPost("{userId}/mobile")]
    public async Task<ActionResult<MessageResponse>> ResetMobile(string userId, MobileRequest req, CancellationToken ct)
    {
        var agency = await FindAsync(userId, ct);
        if (agency is null) return NotFound();
        return await StaffUserActions.ResetMobileAsync(this, db, agency, UserRole.Agency, req.MobileNo, UserId, log, ct);
    }

    private async Task<ManagedUser?> FindAsync(string userId, CancellationToken ct)
    {
        var agency = await StaffUserRules.LoadAsync(db, userId, UserRole.Agency, ct);
        return agency is not null && StaffUserRules.CanManage(CurrentUser, agency, UserRole.Agency) ? agency : null;
    }

    private static List<Sector> Sectors(ResultSets sets) =>
        sets[0].Select(r => new Sector(r.Text("SectorCode"), r.Text("SectorName"))).Where(s => s.SectorCode.Length > 0).ToList();

    private static List<OrgPartner> Partners(IReadOnlyList<IDictionary<string, object?>> set) =>
        set.Select(r => new OrgPartner(r.Text("UserId"), r.Text("FirstName"))).Where(p => p.UserId.Length > 0).ToList();

    private sealed record AgencyValues(
        string UserName, string SpocName, string EmailId, string MobileNo, string Address, string PinCode, string? GstNumber,
        List<string> States, List<string> NicSectors, string? OrgPartnerId, bool DesktopVerification, bool SiteVerification,
        bool FinancialVerification, string? ReasonForRejection);

    /// <summary>States and sectors must be in the current lists or already be on the agency being updated.</summary>
    private static (AgencyValues? Values, string? Error) Validate(AgencyRequest req, List<Sector> sectors, IEnumerable<string> partners, ManagedUser? existing)
    {
        var isUpdate = existing is not null;
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
        var states = StaffUserRules.OnlyAllowed(req.States, StaffUserRules.States.Concat(existing?.States ?? []));
        if (states is null) return (null, "Please select valid states.");
        var nic = StaffUserRules.OnlyAllowed(req.NicSectors, sectors.Select(s => s.SectorCode).Concat(existing?.NicSectors ?? []));
        if (nic is null) return (null, "Please select valid NIC sectors.");
        string? partner = null;
        if (!string.IsNullOrWhiteSpace(req.OrgPartnerId))
        {
            partner = partners.FirstOrDefault(p => string.Equals(p, req.OrgPartnerId.Trim(), StringComparison.OrdinalIgnoreCase));
            if (partner is null) return (null, "Please select a valid organising partner.");
        }
        if (!req.DesktopVerification && !req.SiteVerification && !req.FinancialVerification)
            return (null, "Please select atleast one verification.");
        string? reason = null;
        if (isUpdate && !StaffUserRules.TryText(req.ReasonForRejection, 2000, false, true, out reason))
            return (null, "The reason for block can be up to 2000 characters.");
        return (new AgencyValues(name!, spoc!, mail!, mobile, address!, pin, gst, states, nic, partner,
            req.DesktopVerification, req.SiteVerification, req.FinancialVerification, reason), null);
    }

    /// <summary>Parameters of SP_INSERT_USER / SP_UPDATE_USER as UserHelper.AddAssessors sent them; the role is always 2.</summary>
    private object Parameters(AgencyValues v, string? existingUserId, string? password) => new
    {
        UserId = existingUserId,
        v.UserName,
        v.SpocName,
        RoleId = (int)UserRole.Agency,
        Email = v.EmailId,
        v.MobileNo,
        CreatedBy = UserId,
        v.Address,
        v.PinCode,
        v.GstNumber,
        IdProofType = (string?)null,
        v.DesktopVerification,
        v.SiteVerification,
        v.FinancialVerification,
        IdProofNumber = (string?)null,
        Password = password,
        v.ReasonForRejection,
        AssessorType = (string?)null,
        CertificateNo = (string?)null,
        ProfessionalEmail = (string?)null,
        v.OrgPartnerId,
        PreferredStates = StaffUserRules.Csv(v.States),
        NicSectors = StaffUserRules.Csv(v.NicSectors),
        AreaOfknowledge = (string?)null,
    };
}
