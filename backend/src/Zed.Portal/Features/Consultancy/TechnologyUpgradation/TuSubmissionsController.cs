using System.Data.Common;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.Schemes;
using Zed.Portal.Templates;

namespace Zed.Portal.Features.Consultancy.TechnologyUpgradation;

/// <summary>
/// Technology upgradation (TU) applications on the consultancy portal (Frontend/FinancialAssistance/Submissions.cshtml,
/// "Technology Upgradation"): the master admin allots an application to a Consultant Organisation (CO), the CO
/// accepts it with one of its MSME-DFO officers (DFO; desktop assessors with FinancialVerification), re-allots the
/// DFO, or rejects the allotment. Port of the consultancy FinancialAssistanceController.GetList / AllotCb /
/// AcceptUnitForVerification / RejectUnitForVerification and AssessmentController.GetCb / GetAssessors, on the
/// same helpers as main's <see cref="FinancialAssistanceController"/> but with the TU tabs
/// (TechUpgradeStatus 2, 5, 6, 8, 9) and the consultancy mails.
/// <para>
/// The legacy controller had no class filter (finding #88): anyone could allot, accept or reject any application.
/// Here each action is limited to its role (the CO and the DFO need FinancialVerification, as in the menu), the
/// application's state is checked first inside <see cref="SchemeLocks"/>, and the CO or DFO chosen must be one the
/// procedures offer for it.
/// </para>
/// </summary>
[Route("api/staff/consultancy/tu")]
[StaffRoles(UserRole.MasterAdmin, UserRole.Agency, UserRole.DesktopAssessor)]
[PortalSystems(PortalSystem.Consultancy)]
public sealed class TuSubmissionsController(
    ISqlExecutor db,
    IEmailSender email,
    IHtmlTemplateRenderer templates,
    IOptions<PortalOptions> portal,
    IOptions<EmailOptions> emailOptions,
    ILogger<TuSubmissionsController> log) : StaffApiController
{
    /// <summary>Columns of SP_FINANCIAL_ASSISTANCE_GET_LIST (ZED_CONSULTANT) shown on the list.</summary>
    public static readonly string[] ListColumns =
    [
        "Id", "ZedId", "PUnitName", "UnitAddress", "CertificationType", "LastestCertification", "UamNumber",
        "CertificationBodyUserId", "CertificationBodyName", "FinancialAssessorId", "FaAssessorName", "FinAssessorName",
        "ReasonForRejection", "ReasonForRejectionAgency", "VerificationDate", "TechUpgradeStatus",
    ];

    public sealed record SubmissionsResponse(IReadOnlyList<Dictionary<string, object?>> Rows, Dictionary<string, object?>? Counts);

    /// <summary>GET api/staff/consultancy/tu/submissions?status=2|5|6|8|9 — the signed-in user's applications of one tab.</summary>
    [HttpGet("submissions")]
    public async Task<ActionResult<SubmissionsResponse>> Submissions([FromQuery] int status, CancellationToken ct)
    {
        if (NeedsFinancialVerification()) return Forbid();
        if (!TuStatus.Tabs.Contains(status)) return this.Problem400("Invalid status.");
        // The procedure scopes by the user's role: master admin all, CO CertificationBodyUserId, DFO FinancialAssessorId.
        var sets = await db.QueryProcMultipleAsync("SP_FINANCIAL_ASSISTANCE_GET_LIST",
            new { UserId, Status = status, CertificationType = (string?)null, ZedId = (string?)null }, ct);
        var rows = sets[0].Select(r => SchemeRows.Pick(r, ListColumns)).ToList();
        var counts = sets[1].FirstOrDefault() is { } c ? SchemeRows.Pick(c, ["New", "InProgress", "Qc", "Approved", "Rejected"]) : null;
        return new SubmissionsResponse(rows, counts);
    }

    public sealed record Option(string UserId, string UserName);

    /// <summary>
    /// GET api/staff/consultancy/tu/agencies?zedId= — COs the unit can be allotted to: SP_ASSESSMENT_AGENCIES_TO_ALLOT,
    /// whose FinancialVerification column is 1 here when the CO's TuPreferredState is the unit's state (as the legacy filter).
    /// </summary>
    [HttpGet("agencies")]
    [StaffRoles(UserRole.MasterAdmin)]
    public async Task<ActionResult<IReadOnlyList<Option>>> Agencies([FromQuery] string? zedId, CancellationToken ct)
    {
        if (!SchemeRows.IsZedId(zedId)) return this.Problem400("Invalid ZED ID.");
        return (await AgencyOptions(zedId!, ct)).ToList();
    }

    public sealed record AllotRequest(string? ZedId, string? Certification, string? AgencyUserId);

    /// <summary>POST api/staff/consultancy/tu/allot — SP_FINANCIAL_ASSISTANCE_ALLOT_TO_AGENCY (allot or re-allot while VerificationStatus is 1).</summary>
    [HttpPost("allot")]
    [StaffRoles(UserRole.MasterAdmin)]
    public async Task<ActionResult<MessageResponse>> Allot(AllotRequest req, CancellationToken ct)
    {
        if (!SchemeRows.IsZedId(req.ZedId) || FaApplications.Canonical(req.Certification) is not { } cert)
            return this.Problem400("Invalid application.");
        var zedId = req.ZedId!;

        using (await SchemeLocks.EnterAsync(ct))
        {
            var app = await TuApplications.FindAsync(db, zedId, cert, ct);
            if (app is null) return NotFound();
            if (app.Status != FaStatus.New || app.Tu == TuStatus.Rejected)
                return this.Problem400("This application can no longer be allotted.");
            if (!string.IsNullOrWhiteSpace(app.AgencyUserId) && !string.IsNullOrWhiteSpace(app.AssessorUserId) && !app.RejectedByAgency)
                return this.Problem400("This application has already been accepted by the Consultant Organisation.");

            var agency = (await AgencyOptions(zedId, ct)).FirstOrDefault(a => SchemeRows.Same(a.UserId, req.AgencyUserId));
            if (agency is null) return this.Problem400("Please select assessment agency.");

            if (await Exec("SP_FINANCIAL_ASSISTANCE_ALLOT_TO_AGENCY",
                    new { ZedId = zedId, Certification = cert, CertificationBodyUserId = agency.UserId }, zedId, ct) is { } failed)
                return failed;
            log.LogInformation("TU application {ZedId}/{Certification} allotted to CO {Agency} by {UserId}", zedId, cert, agency.UserId, UserId);

            var mailer = Mailer();
            var d = await mailer.DetailsAsync(zedId, cert, ct);
            await mailer.SendAsync<ConsultancyTuAllotAgencyEmail>(d?.Text("AgencyEmailId"),
                $"Allocation of Application for Verification: Technology Upgradation – {zedId}",
                new()
                {
                    [nameof(ConsultancyTuAllotAgencyEmail.ZedId)] = zedId,
                    [nameof(ConsultancyTuAllotAgencyEmail.UnitName)] = UnitName(d),
                    [nameof(ConsultancyTuAllotAgencyEmail.Address)] = d?.Text("Address") ?? "",
                }, ct);
        }
        return new MessageResponse("Application allotted.");
    }

    /// <summary>GET api/staff/consultancy/tu/assessors — the CO's own active DFOs (SP_ASSESSMENT_ASSESSORS_TO_ALLOT: FinancialVerification, CreatedBy).</summary>
    [HttpGet("assessors")]
    [StaffRoles(UserRole.Agency)]
    public async Task<ActionResult<IReadOnlyList<Option>>> Assessors(CancellationToken ct)
    {
        if (NeedsFinancialVerification()) return Forbid();
        return (await AssessorOptions(ct)).ToList();
    }

    public sealed record AcceptRequest(string? ZedId, string? Certification, string? AssessorUserId);

    /// <summary>
    /// POST api/staff/consultancy/tu/accept — the allotted CO accepts and allots a DFO (status 1 → 2, TechUpgradeStatus 4),
    /// or re-allots the DFO before the opening meeting (status 2, TechUpgradeStatus 4 or 5, as the legacy RE-ALLOT button).
    /// Mails the DFO and the MSME.
    /// </summary>
    [HttpPost("accept")]
    [StaffRoles(UserRole.Agency)]
    public async Task<ActionResult<MessageResponse>> Accept(AcceptRequest req, CancellationToken ct)
    {
        if (NeedsFinancialVerification()) return Forbid();
        if (!SchemeRows.IsZedId(req.ZedId) || FaApplications.Canonical(req.Certification) is not { } cert)
            return this.Problem400("Invalid application.");
        var zedId = req.ZedId!;

        using (await SchemeLocks.EnterAsync(ct))
        {
            var app = await TuApplications.FindAsync(db, zedId, cert, ct);
            if (app is null || !SchemeRows.Same(app.AgencyUserId, UserId)) return NotFound();
            var first = app.Status == FaStatus.New && string.IsNullOrWhiteSpace(app.AssessorUserId) && !app.RejectedByAgency && app.Tu != TuStatus.Rejected;
            var reallot = app.Status == FaStatus.InProgress && !string.IsNullOrWhiteSpace(app.AssessorUserId) && app.Tu is TuStatus.DfoAllotted or TuStatus.Verifying;
            if (!first && !reallot) return this.Problem400("This application has already been processed.");

            var assessor = (await AssessorOptions(ct)).FirstOrDefault(a => SchemeRows.Same(a.UserId, req.AssessorUserId));
            if (assessor is null) return this.Problem400("Please select valid data.");
            if (reallot && SchemeRows.Same(assessor.UserId, app.AssessorUserId)) return this.Problem400("This MSME-DFO officer is already allotted.");

            if (await Exec("SP_FINANCIAL_ASSESSMENT_ACCEPT_UNIT_FOR_VERIFICATION",
                    new { ZedId = zedId, Certification = cert, FinancialAssessorId = assessor.UserId }, zedId, ct) is { } failed)
                return failed;
            log.LogInformation("TU application {ZedId}/{Certification} {Action} by CO {UserId}; DFO {Dfo}", zedId, cert,
                reallot ? "re-allotted" : "accepted", UserId, assessor.UserId);

            var mailer = Mailer();
            var d = await mailer.DetailsAsync(zedId, cert, ct);
            var category = d?.Text("CategoryOfCertificate") is { Length: > 0 } c ? " " + c : "";
            await mailer.SendAsync<ConsultancyTuAllotDfoEmail>(d?.Text("AssessorEmailId"),
                $"Allocation of Onsite Verification: Financial Support for Zero Effect Solution{category} – {zedId}",
                new()
                {
                    [nameof(ConsultancyTuAllotDfoEmail.ZedId)] = zedId,
                    [nameof(ConsultancyTuAllotDfoEmail.UnitName)] = UnitName(d),
                    [nameof(ConsultancyTuAllotDfoEmail.Address)] = d?.Text("Address") ?? "",
                    [nameof(ConsultancyTuAllotDfoEmail.AssessorUserId)] = assessor.UserId,
                }, ct);
            await mailer.SendAsync<ConsultancyTuAllotDfoMsmeEmail>(d?.Text("EmailId"),
                $"Allocation of Onsite Verification for Financial Support for Zero Effect Solution under “MSME Sustainable (ZED) Certification” Scheme – {zedId}",
                new()
                {
                    [nameof(ConsultancyTuAllotDfoMsmeEmail.ZedId)] = zedId,
                    [nameof(ConsultancyTuAllotDfoMsmeEmail.AgencyName)] = d?.Text("AgencyName") ?? "",
                    [nameof(ConsultancyTuAllotDfoMsmeEmail.SpocName)] = d?.Text("SpocName") ?? "",
                    [nameof(ConsultancyTuAllotDfoMsmeEmail.AgencyEmail)] = d?.Text("AgencyEmailId") ?? "",
                    [nameof(ConsultancyTuAllotDfoMsmeEmail.AgencyMobileNo)] = d?.Text("AgencyMobileNo") ?? "",
                }, ct);
        }
        return new MessageResponse("Application accepted.");
    }

    public sealed record RejectRequest(string? ZedId, string? Certification, string? Reason);

    /// <summary>POST api/staff/consultancy/tu/reject — the allotted CO returns the allotment (the master admin re-allots); mails the ZED team.</summary>
    [HttpPost("reject")]
    [StaffRoles(UserRole.Agency)]
    public async Task<ActionResult<MessageResponse>> Reject(RejectRequest req, CancellationToken ct)
    {
        if (NeedsFinancialVerification()) return Forbid();
        if (!SchemeRows.IsZedId(req.ZedId) || FaApplications.Canonical(req.Certification) is not { } cert)
            return this.Problem400("Invalid application.");
        if (SchemeRows.CleanText(req.Reason, 2000) is not { } reason)
            return this.Problem400("Please enter the reason for rejection (up to 2000 characters).");
        var zedId = req.ZedId!;

        using (await SchemeLocks.EnterAsync(ct))
        {
            var app = await TuApplications.FindAsync(db, zedId, cert, ct);
            if (app is null || !SchemeRows.Same(app.AgencyUserId, UserId)) return NotFound();
            if (app.Status != FaStatus.New || !string.IsNullOrWhiteSpace(app.AssessorUserId) || app.RejectedByAgency)
                return this.Problem400("This application has already been processed.");
            if (await Exec("SP_FINANCIAL_ASSESSMENT_REJECT_UNIT_FOR_VERIFICATION",
                    new { ZedId = zedId, Certification = cert, ReasonForRejection = reason }, zedId, ct) is { } failed)
                return failed;
            await SchemeRows.AuditAsync(db, log, zedId, cert, $"Technology upgradation allotment rejected by CO {UserId}: {reason}", ct);

            var mailer = Mailer();
            var d = await mailer.DetailsAsync(zedId, cert, ct);
            await mailer.SendAsync<ConsultancyTuAgencyRejectedEmail>(await HttpContext.RequestServices.GetRequiredService<EmailAddresses>().GetAsync(EmailAddresses.SchemeRejectionInbox, ct) ?? EmailAddresses.LegacyTeamInbox,
                $"Rejection of Application for Verification: Technology Upgradation – {zedId}",
                new()
                {
                    [nameof(ConsultancyTuAgencyRejectedEmail.ZedId)] = zedId,
                    [nameof(ConsultancyTuAgencyRejectedEmail.UnitName)] = UnitName(d),
                    [nameof(ConsultancyTuAgencyRejectedEmail.AgencyName)] = d?.Text("AgencyName") ?? "",
                    [nameof(ConsultancyTuAgencyRejectedEmail.AgencyUserId)] = UserId,
                    [nameof(ConsultancyTuAgencyRejectedEmail.Reason)] = reason,
                }, ct);
        }
        return new MessageResponse("Application rejected.");
    }

    /// <summary>The CO and the DFO work on TU only with the FinancialVerification sub-role (menu rule); the master admin always.</summary>
    private bool NeedsFinancialVerification() =>
        RoleId != (int)UserRole.MasterAdmin && !CurrentUser.HasSubRole(SubRoles.FinancialVerification);

    private static string UnitName(IDictionary<string, object?>? d) =>
        d?.Text("PUnitName") is { Length: > 0 } p ? p : d?.Text("EnterpriseName") ?? "";

    private async Task<IEnumerable<Option>> AgencyOptions(string zedId, CancellationToken ct) =>
        (await db.QueryProcMultipleAsync("SP_ASSESSMENT_AGENCIES_TO_ALLOT", new { ZedId = zedId }, ct))[0]
        .Where(r => r.Text("FinancialVerification") is "1" or "True" or "true")
        .Select(r => new Option(r.Text("UserId"), r.Text("UserName")))
        .Where(o => o.UserId.Length > 0);

    private async Task<IEnumerable<Option>> AssessorOptions(CancellationToken ct) =>
        (await db.QueryProcMultipleAsync("SP_ASSESSMENT_ASSESSORS_TO_ALLOT", new { RoleId = RoleId.ToString(), UserId }, ct))[0]
        .Select(r => new Option(r.Text("UserId"), r.Text("UserName")))
        .Where(o => o.UserId.Length > 0);

    private async Task<ActionResult?> Exec(string procedure, object args, string zedId, CancellationToken ct)
    {
        try
        {
            await db.ExecuteProcAsync(procedure, args, ct);
            return null;
        }
        catch (DbException ex)
        {
            log.LogError(ex, "{Procedure} failed for {ZedId}", procedure, zedId);
            return this.Problem400("The application could not be updated. Please try again.");
        }
    }

    private SchemeMailer Mailer() => new(db, email, templates, portal, emailOptions, log);
}
