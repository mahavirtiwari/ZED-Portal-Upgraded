using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Templates;

namespace Zed.Portal.Features.Staff.Users;

/// <summary>
/// Assessors. Port of UserController Assessors (agency's own list), AssessorList / GeAssessorList
/// (MasterAdmin, all agencies), Assessor (form/view), GeProfessionalDetailsByCertNo, CreateUser
/// (RoleId 3), Block, UnBlock and ResetMobileNo.
/// <para>
/// An agency only sees and manages the assessors it created (Users.CreatedBy = the signed-in agency).
/// Legacy holes closed: GeAssessorList and GeProfessionalDetailsByCertNo needed no sign-in, and
/// GeAssessorList returned whole Users rows including passwords; Assessor?id= showed any user (by
/// sequential Users.Id) to any agency; CreateUser trusted the name, e-mail and mobile that the page
/// filled in from the professional lookup — they are now taken from the lookup on the server.
/// </para>
/// <para>
/// Also served by the Consultancy host: the CO's "Consultants/Experts" are consultants (RoleId 3, from the professional
/// lookup, certificate numbers starting with CO) or technical experts (RoleId 33, typed in); see <see cref="ConsultancyUsers"/>.
/// </para>
/// </summary>
[Route("api/staff/users/assessors")]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy)]
public sealed class StaffAssessorsController(
    ISqlExecutor db,
    PortalHost host,
    IEmailSender email,
    IHtmlTemplateRenderer templates,
    IOptions<PortalOptions> portal,
    IOptions<EmailOptions> emailOptions,
    ILogger<StaffAssessorsController> log) : StaffApiController
{
    private StaffUserMail Mail => new(email, templates, portal, emailOptions, log);
    private const string Assessor = "3";

    private static readonly string[] AllColumns =
    [
        "RowNumber", "Id", "UserId", "UserName", "MobileNo", "Email", "Address", "IdStatus", "IsActive", "AssessorType",
        "AgencyUserId", "AgencyUserName",
    ];

    private static readonly string[] OwnColumns =
    [
        "Id", "UserId", "UserName", "Address", "MobileNo", "Email", "IdStatus", "IsActive", "AssessorType", "IsCertAttached",
    ];

    private static readonly HashSet<string> VerificationTypes = new(StringComparer.Ordinal) { "DA", "SA", "FA" };

    /// <summary>All assessors, optionally of one agency and verification type (SP_GET_ASSESSORS). MasterAdmin only.</summary>
    [HttpGet]
    [StaffRoles(UserRole.MasterAdmin)]
    public async Task<ActionResult<IReadOnlyList<Dictionary<string, object?>>>> All(string? agencyId, string? type, CancellationToken ct)
    {
        if (!string.IsNullOrEmpty(agencyId) && !StaffUserRules.IsUserId(agencyId)) return this.Problem400("Invalid agency.");
        if (!string.IsNullOrEmpty(type) && !VerificationTypes.Contains(type)) return this.Problem400("Invalid assessor type.");
        var sets = await db.QueryProcMultipleAsync("SP_GET_ASSESSORS", new { UserId, AssessorType = type ?? "", CertificationBodyUserId = agencyId ?? "" }, ct);
        return sets[0].Select(r =>
        {
            var row = StaffUserRules.Pick(r, AllColumns);
            row["IsActive"] = StaffUserRules.Bool(r, "IsActive");
            return row;
        }).ToList();
    }

    /// <summary>The signed-in agency's assessors (SP_GET_USERS_BY_ROLE RoleId 3, CreatedBy = the agency).</summary>
    [HttpGet("mine")]
    [StaffRoles(UserRole.Agency)]
    public async Task<IReadOnlyList<Dictionary<string, object?>>> Mine(CancellationToken ct)
    {
        var sets = await db.QueryProcMultipleAsync("SP_GET_USERS_BY_ROLE", new { UserId, RoleId = Assessor }, ct);
        return sets[0].Select(r =>
        {
            var row = StaffUserRules.Pick(r, OwnColumns);
            row["IsActive"] = StaffUserRules.Bool(r, "IsActive");
            if (host.IsConsultancy())
            {
                // SP_GET_USERS_BY_ROLE returns consultants and technical experts together (UserType column).
                row["RoleId"] = r.Text("RoleId");
                row["UserType"] = r.Text("UserType");
            }
            row["IsCertAttached"] = int.TryParse(r.Text("IsCertAttached"), out var n) ? n : 0;
            row["IdProofNumber"] = StaffUserRules.MaskIdProof(r.Text("IdProofNumber"));
            row["PhotoPath"] = StaffUserRules.PhotoUrl(r.Text("PhotoPath"));
            return row;
        }).ToList();
    }

    public sealed record Sector(string SectorCode, string SectorName);
    public sealed record AssessorOptions(IReadOnlyList<string> States, IReadOnlyList<Sector> Sectors, IReadOnlyList<string> AreasOfKnowledge);

    [HttpGet("options")]
    [StaffRoles(UserRole.Agency, UserRole.MasterAdmin)]
    public async Task<AssessorOptions> Options(CancellationToken ct)
    {
        var (sectors, areas) = await LoadOptionsAsync(ct);
        return new AssessorOptions(StaffUserRules.States, sectors, areas);
    }

    public sealed record AssessorDetails(
        string UserId, string UserName, string? EmailId, string? MobileNo, string? Address, string? PinCode, string? AssessorType,
        string? CertificateNo, string? IdProofType, string? IdProofNumberMasked, IReadOnlyList<string> States,
        IReadOnlyList<string> NicSectors, IReadOnlyList<string> AreasOfKnowledge, string? ReasonForRejection, bool IsActive,
        string? AgencyUserId, bool CanEdit, string? UserType = null);

    /// <summary>One assessor (SP_GET_USER_DETAILS_BY_USER_ID). An agency only gets its own; the MasterAdmin any (read-only).</summary>
    [HttpGet("{userId}")]
    [StaffRoles(UserRole.Agency, UserRole.MasterAdmin)]
    public async Task<ActionResult<AssessorDetails>> Get(string userId, CancellationToken ct)
    {
        var a = await FindAsync(userId, ct);
        if (a is null) return NotFound();
        var r = a.Row;
        string? T(string c) => r.Text(c) is { Length: > 0 } v ? v : null;
        return new AssessorDetails(a.UserId, r.Text("UserName"), T("Email"), T("MobileNo"), T("Address"), T("Pincode"),
            host.IsConsultancy() ? null : T("AssessorType"),
            T("CertificateNo"), T("IdProofType"), StaffUserRules.MaskIdProof(T("IdProofNumber")), a.States, a.NicSectors, a.AreasOfKnowledge,
            T("ReasonForRejection"), a.IsActive, T("CreatedBy"), CanEdit: IsRole(UserRole.Agency),
            UserType: host.IsConsultancy() ? (r.Text("RoleId") == "33" ? ConsultancyUsers.TechnicalExpert : ConsultancyUsers.Consultant) : null);
    }

    public sealed record LookupRequest(string? AssessorType, string? CertificateNo, string? Email);

    /// <summary>
    /// Certified professional for a certificate number and registered e-mail (legacy GeProfessionalDetailsByCertNo).
    /// Rate-limited: it reads the professionals registry of the training portal.
    /// </summary>
    [HttpPost("lookup")]
    [StaffRoles(UserRole.Agency)]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<ActionResult<StaffUserRules.Professional>> Lookup(LookupRequest req, CancellationToken ct)
    {
        var (type, cert, mail, error) = LookupInput(req.AssessorType, req.CertificateNo, req.Email);
        if (error is not null) return this.Problem400(error);
        var (found, message) = await StaffUserRules.LookupProfessionalAsync(db, CurrentUser, LookupType(type!), cert!, mail!, ct);
        return found is null ? this.Problem400(message!) : found;
    }

    public sealed record CreateRequest(
        string? AssessorType, string? CertificateNo, string? ProfessionalEmail, string? Address, string? PinCode,
        string? IdProofType, string? IdProofNumber, List<string>? States, List<string>? NicSectors, List<string>? AreasOfKnowledge,
        string? UserName = null, string? EmailId = null, string? MobileNo = null);

    /// <summary>
    /// Creates an assessor under the signed-in agency (SP_INSERT_USER RoleId 3, CreatedBy = the agency; the
    /// procedure copies the agency's verification types). Agencies can only create assessors. Name, e-mail and
    /// mobile come from the professional lookup; the generated password is e-mailed, never returned.
    /// </summary>
    [HttpPost]
    [StaffRoles(UserRole.Agency)]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<ActionResult<StaffAgenciesController.CreatedUserResponse>> Create(CreateRequest req, CancellationToken ct)
    {
        if (host.IsConsultancy() && req.AssessorType == ConsultancyUsers.TechnicalExpert) return await CreateTechnicalExpertAsync(req, ct);
        var (type, cert, mail, error) = LookupInput(req.AssessorType, req.CertificateNo, req.ProfessionalEmail);
        if (error is not null) return this.Problem400(error);
        var (sectors, areas) = await LoadOptionsAsync(ct);
        var (values, valuesError) = ValidateCommon(req.Address, req.PinCode, req.IdProofType, req.IdProofNumber, null,
            req.States, req.NicSectors, req.AreasOfKnowledge, sectors, areas, existing: null);
        if (valuesError is not null) return this.Problem400(valuesError);

        var (professional, message) = await StaffUserRules.LookupProfessionalAsync(db, CurrentUser, LookupType(type!), cert!, mail!, ct);
        if (professional is null) return this.Problem400(message!);

        var password = SecureRandom.Password();
        var parameters = host.IsConsultancy()
            ? ConsultancyParameters(values!, null, ConsultancyUsers.ConsultantRole, professional.Name, professional.Email, professional.MobileNo, password, cert, mail)
            : Parameters(values!, null, professional.Name, professional.Email, professional.MobileNo, password, type, cert, mail);
        return await InsertAsync(parameters, professional.Name, professional.Email, professional.MobileNo, password,
            type == StaffUserRules.AssessorTypeBronze, type!, ct);
    }

    /// <summary>
    /// Consultancy: a technical expert (RoleId 33) is not a certified professional, so the CO types the name, e-mail and
    /// mobile number (as on the old form).
    /// </summary>
    private async Task<ActionResult<StaffAgenciesController.CreatedUserResponse>> CreateTechnicalExpertAsync(CreateRequest req, CancellationToken ct)
    {
        if (!StaffUserRules.TryText(req.UserName, 100, true, false, out var name)) return this.Problem400("Please enter the name (up to 100 characters).");
        var mail = req.EmailId?.Trim();
        if (!StaffUserRules.IsEmail(mail)) return this.Problem400("Please enter a valid Email ID.");
        var mobile = req.MobileNo?.Trim();
        if (mobile is null || !StaffUserRules.MobilePattern().IsMatch(mobile)) return this.Problem400("Please enter a valid 10 digit mobile number.");
        var (sectors, areas) = await LoadOptionsAsync(ct);
        var (values, valuesError) = ValidateCommon(req.Address, req.PinCode, req.IdProofType, req.IdProofNumber, null,
            req.States, req.NicSectors, req.AreasOfKnowledge, sectors, areas, existing: null);
        if (valuesError is not null) return this.Problem400(valuesError);

        var password = SecureRandom.Password();
        return await InsertAsync(ConsultancyParameters(values!, null, ConsultancyUsers.TechnicalExpertRole, name!, mail!, mobile, password, null, null),
            name!, mail!, mobile, password, bronze: false, ConsultancyUsers.TechnicalExpert, ct);
    }

    /// <summary>SP_INSERT_USER, then the new id (selected first by main's procedure, looked up by name otherwise) and the welcome mail.</summary>
    private async Task<ActionResult<StaffAgenciesController.CreatedUserResponse>> InsertAsync(
        object parameters, string name, string email, string mobile, string password, bool bronze, string type, CancellationToken ct)
    {
        var result = await db.QueryProcMultipleAsync("SP_INSERT_USER", parameters, ct);
        var newId = result.Scalar(0);
        if (!StaffUserRules.IsUserId(newId))
        {
            // ZED_CONSULTANT's SP_INSERT_USER does not select the new consultant id.
            var found = (await db.QueryProcMultipleAsync("SP_GET_USER_DETAILS_BY_NAME",
                new { UserName = name, MobileNo = mobile, EmailId = email }, ct))[0].FirstOrDefault();
            newId = found?.Text("UserId");
        }
        if (!StaffUserRules.IsUserId(newId))
        {
            log.LogError("SP_INSERT_USER did not return the id of the new assessor created by {Actor}", UserId);
            return this.Problem400("The assessor could not be created. Please try again.");
        }
        log.LogInformation("Assessor {NewUserId} ({Type}) created by agency {Actor}", newId, type, UserId);

        var subject = host.IsConsultancy()
            ? "Consultant/Expert Login Details under “MSME Sustainable (ZED) Certification” - " + newId
            : (bronze ? "Bronze Assessor" : "Assessor") + " Login Details for “MSME Sustainable (ZED) Certification” - " + newId;
        var sent = await Mail.SendAsync<StaffAssessorRegisteredEmail>(email, subject, new()
            {
                [nameof(StaffAssessorRegisteredEmail.UserId)] = newId,
                [nameof(StaffAssessorRegisteredEmail.Password)] = password,
                [nameof(StaffAssessorRegisteredEmail.AgencyName)] = CurrentUser.UserName,
                [nameof(StaffAssessorRegisteredEmail.IsBronzeAssessor)] = bronze,
                [nameof(StaffAssessorRegisteredEmail.LoginUrl)] = Mail.LoginUrl,
                [nameof(StaffAssessorRegisteredEmail.Consultancy)] = host.IsConsultancy(),
            }, ct);
        return new StaffAgenciesController.CreatedUserResponse(sent
            ? $"User created successfully. The login details have been sent to {email}."
            : "User created, but the e-mail with the login details could not be sent. Please contact the ZED support team.", newId);
    }

    public sealed record UpdateRequest(
        string? Address, string? PinCode, string? IdProofType, string? IdProofNumber, List<string>? States, List<string>? NicSectors,
        List<string>? AreasOfKnowledge, string? ReasonForRejection);

    /// <summary>
    /// Updates one of the agency's assessors (SP_UPDATE_USER RoleId 3). Name, e-mail and mobile stay as they are
    /// (read-only on the old form too); an empty ID proof number keeps the stored one.
    /// </summary>
    [HttpPut("{userId}")]
    [StaffRoles(UserRole.Agency)]
    public async Task<ActionResult<MessageResponse>> Update(string userId, UpdateRequest req, CancellationToken ct)
    {
        var a = await FindAsync(userId, ct);
        if (a is null) return NotFound();
        var (sectors, areas) = await LoadOptionsAsync(ct);
        var (values, error) = ValidateCommon(req.Address, req.PinCode, req.IdProofType, req.IdProofNumber, req.ReasonForRejection,
            req.States, req.NicSectors, req.AreasOfKnowledge, sectors, areas, existing: a);
        if (error is not null) return this.Problem400(error);

        var r = a.Row;
        await db.ExecuteProcAsync("SP_UPDATE_USER", host.IsConsultancy()
            ? ConsultancyParameters(values!, a.UserId, int.Parse(r.Text("RoleId")), r.Text("UserName"), r.Text("Email"), r.Text("MobileNo"), null, null, null)
            : Parameters(values!, a.UserId, r.Text("UserName"), r.Text("Email"), r.Text("MobileNo"), null, null, null, null), ct);
        log.LogInformation("Assessor {UserId} updated by {Actor}", a.UserId, UserId);
        return new MessageResponse("User updated successfully.");
    }

    public sealed record ReasonRequest(string? Reason);

    [HttpPost("{userId}/block")]
    [StaffRoles(UserRole.Agency, UserRole.MasterAdmin)]
    public async Task<ActionResult<MessageResponse>> Block(string userId, ReasonRequest req, CancellationToken ct)
    {
        var a = await FindAsync(userId, ct);
        if (a is null) return NotFound();
        if (!StaffUserRules.TryText(req.Reason, 2000, required: true, multiline: true, out var reason))
            return this.Problem400("Please enter the reason for blocking (up to 2000 characters).");
        return await StaffUserActions.BlockAsync(this, db, host, Mail, a, reason!, UserId, log, ct);
    }

    /// <summary>
    /// Unblocks an assessor, unless its certificate is now attached to another active Bronze Assessor
    /// (the old page hid the button in that case; this is now also checked on the server).
    /// </summary>
    [HttpPost("{userId}/unblock")]
    [StaffRoles(UserRole.Agency, UserRole.MasterAdmin)]
    public async Task<ActionResult<MessageResponse>> Unblock(string userId, CancellationToken ct)
    {
        var a = await FindAsync(userId, ct);
        if (a is null) return NotFound();
        var cert = a.Row.Text("CertificateNo");
        // Bronze Assessors (one active account per certificate) exist on Main only.
        if (cert.Length > 0 && !host.IsConsultancy())
        {
            var attached = await db.QuerySqlAsync<int>(
                "SELECT COUNT(*) FROM Users WHERE RoleId = 3 AND AssessorType = 'BronzeAssessor' AND IsActive = 1 AND CertificateNo = @CertificateNo AND UserId <> @UserId",
                new { CertificateNo = cert, a.UserId }, ct);
            if (attached.FirstOrDefault() > 0)
                return this.Problem400("This certificate is attached to another active Bronze Assessor, so the user cannot be unblocked.");
        }
        return await StaffUserActions.UnblockAsync(this, db, host, Mail, a, UserId, log, ct);
    }

    public sealed record MobileRequest(string? MobileNo);

    [HttpPost("{userId}/mobile")]
    [StaffRoles(UserRole.Agency, UserRole.MasterAdmin)]
    public async Task<ActionResult<MessageResponse>> ResetMobile(string userId, MobileRequest req, CancellationToken ct)
    {
        var a = await FindAsync(userId, ct);
        if (a is null) return NotFound();
        var role = host.IsConsultancy() && a.Row.Text("RoleId") == "33" ? (UserRole)ConsultancyUsers.TechnicalExpertRole : UserRole.DesktopAssessor;
        return await StaffUserActions.ResetMobileAsync(this, db, a, role, req.MobileNo, UserId, log, ct);
    }

    private async Task<ManagedUser?> FindAsync(string userId, CancellationToken ct)
    {
        var a = host.IsConsultancy()
            ? await StaffUserRules.LoadAnyAsync(db, userId, ConsultancyUsers.AssessorRoles, ct)
            : await StaffUserRules.LoadAsync(db, userId, UserRole.DesktopAssessor, ct);
        return a is not null && StaffUserRules.CanManage(CurrentUser, a, UserRole.DesktopAssessor) ? a : null;
    }

    private async Task<(List<Sector> Sectors, List<string> Areas)> LoadOptionsAsync(CancellationToken ct)
    {
        var sectors = (await db.QueryProcMultipleAsync("SP_MASTER_GET_SECTORS", null, ct))[0]
            .Select(r => new Sector(r.Text("SectorCode"), r.Text("SectorName"))).Where(s => s.SectorCode.Length > 0).ToList();
        var areas = (await db.QueryProcMultipleAsync("SP_MASTER_GET_AREA_OF_KNOWLEDGE", null, ct))[0]
            .Select(r => r.Text("AreaOfknowledge")).Where(s => s.Length > 0).Distinct().ToList();
        return (sectors, areas);
    }

    /// <summary>@AssessorType of the professional lookup: Main's assessor type, or "3" (consultant) on Consultancy.</summary>
    private string LookupType(string type) => host.IsConsultancy() ? ConsultancyUsers.LookupAssessorType : type;

    private (string? Type, string? Cert, string? Email, string? Error) LookupInput(string? type, string? cert, string? email)
    {
        if (host.IsConsultancy()) type ??= ConsultancyUsers.Consultant;
        if (type is null || !(host.IsConsultancy() ? type == ConsultancyUsers.Consultant : StaffUserRules.AssessorTypes.Contains(type)))
            return (null, null, null, "Assessor Type required.");
        var c = cert?.Trim();
        if (c is null || !StaffUserRules.CertificateNoPattern().IsMatch(c)) return (null, null, null, "Please enter a valid Certificate Number.");
        var e = email?.Trim();
        if (!StaffUserRules.IsEmail(e)) return (null, null, null, "Please enter the registered Email Id.");
        return (type, c, e, null);
    }

    private sealed record AssessorValues(
        string Address, string PinCode, string IdProofType, string IdProofNumber, string? ReasonForRejection,
        List<string> States, List<string> NicSectors, List<string> Areas);

    private static (AssessorValues? Values, string? Error) ValidateCommon(
        string? address, string? pinCode, string? idProofType, string? idProofNumber, string? reasonForRejection,
        List<string>? states, List<string>? nicSectors, List<string>? areasOfKnowledge, List<Sector> sectors, List<string> areas,
        ManagedUser? existing)
    {
        // On update, values already stored on the assessor stay allowed even if the lists changed since.
        if (!StaffUserRules.TryText(address, 2000, true, true, out var addr)) return (null, "Please enter the assessor address (up to 2000 characters).");
        var pin = pinCode?.Trim();
        if (pin is null || !StaffUserRules.PinCodePattern().IsMatch(pin)) return (null, "Please enter a valid 6 digit PinCode.");
        var number = idProofNumber?.Trim().ToUpperInvariant();
        if (string.IsNullOrEmpty(number) && existing is not null && existing.Row.Text("IdProofType") == idProofType &&
            existing.Row.Text("IdProofNumber").Length > 0)
            number = existing.Row.Text("IdProofNumber");
        if (StaffUserRules.IdProofError(idProofType, number) is { } idError) return (null, idError);
        var st = StaffUserRules.OnlyAllowed(states, StaffUserRules.States.Concat(existing?.States ?? []));
        if (st is null) return (null, "Please select valid states.");
        var nic = StaffUserRules.OnlyAllowed(nicSectors, sectors.Select(s => s.SectorCode).Concat(existing?.NicSectors ?? []));
        if (nic is null) return (null, "Please select valid NIC sectors.");
        var ak = StaffUserRules.OnlyAllowed(areasOfKnowledge, areas.Concat(existing?.AreasOfKnowledge ?? []));
        if (ak is null) return (null, "Please select valid areas of knowledge and expertise.");
        if (!StaffUserRules.TryText(reasonForRejection, 2000, false, true, out var reason)) return (null, "The reason for block can be up to 2000 characters.");
        return (new AssessorValues(addr!, pin, idProofType!, number!, reason, st, nic, ak), null);
    }

    /// <summary>ZED_CONSULTANT's SP_INSERT_USER / SP_UPDATE_USER for a consultant (3) or technical expert (33).</summary>
    private object ConsultancyParameters(AssessorValues v, string? existingUserId, int roleId, string name, string emailId, string mobile,
        string? password, string? certificateNo, string? professionalEmail) =>
        ConsultancyUsers.Parameters(existingUserId, name, password, roleId, emailId, mobile, UserId, null, v.Address, v.PinCode,
            v.States, v.NicSectors, v.Areas, v.IdProofType, v.IdProofNumber, null, false, false, false, v.ReasonForRejection,
            null, [], certificateNo, professionalEmail);

    /// <summary>Parameters of SP_INSERT_USER / SP_UPDATE_USER for RoleId 3 (as UserHelper.AddAssessors).</summary>
    private object Parameters(AssessorValues v, string? existingUserId, string name, string emailId, string mobile, string? password,
        string? assessorType, string? certificateNo, string? professionalEmail) => new
    {
        UserId = existingUserId,
        UserName = name,
        SpocName = (string?)null,
        RoleId = (int)UserRole.DesktopAssessor,
        Email = emailId,
        MobileNo = mobile,
        CreatedBy = UserId,
        v.Address,
        v.PinCode,
        GstNumber = (string?)null,
        v.IdProofType,
        DesktopVerification = false,
        SiteVerification = false,
        FinancialVerification = false,
        v.IdProofNumber,
        Password = password,
        v.ReasonForRejection,
        AssessorType = assessorType,
        CertificateNo = certificateNo,
        ProfessionalEmail = professionalEmail,
        OrgPartnerId = (string?)null,
        PreferredStates = StaffUserRules.Csv(v.States),
        NicSectors = StaffUserRules.Csv(v.NicSectors),
        AreaOfknowledge = StaffUserRules.Csv(v.Areas),
    };
}
