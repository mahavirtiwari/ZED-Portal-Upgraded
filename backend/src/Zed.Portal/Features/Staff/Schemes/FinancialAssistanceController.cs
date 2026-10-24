using System.Data.Common;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Templates;

namespace Zed.Portal.Features.Staff.Schemes;

/// <summary>
/// Financial assistance submissions and allotment (Views/FinancialAssistance/Submissions.cshtml):
/// the master admin allots an application to an agency, the agency accepts it (choosing one of its
/// financial assessors) or rejects it. Port of FinancialAssistanceController.GetList / AllotCb /
/// AcceptUnitForVerification / RejectUnitForVerification and AssessmentController.GetCb / GetAssessors.
/// <para>
/// The MVC controller only required a sign-in (<c>[AuthenticationFilter()]</c>) for these actions, so any
/// user, an MSME included, could allot, accept or reject any application. Here each action is limited to
/// the role that performs it, the FinancialVerification sub-role is required (as in the menu), the
/// application's current state is checked first, and the agency or assessor chosen must be one the
/// procedures offer for it.
/// </para>
/// </summary>
[Route("api/staff/schemes/fa")]
[StaffRoles(UserRole.MasterAdmin, UserRole.Agency, UserRole.DesktopAssessor)]
[SubRole(SubRoles.FinancialVerification)]
public sealed class FinancialAssistanceController(
    ISqlExecutor db,
    IEmailSender email,
    IHtmlTemplateRenderer templates,
    IOptions<PortalOptions> portal,
    IOptions<EmailOptions> emailOptions,
    ILogger<FinancialAssistanceController> log) : StaffApiController
{
    public static readonly string[] ListColumns =
    [
        "Id", "ZedId", "EnterpriseName", "UnitAddress", "CertificationType", "RegisteredDate", "UamNumber",
        "CertificationBodyUserId", "CertificationBodyName", "FinancialAssessorId", "FaAssessorName", "FinAssessorName",
        "ReasonForRejection", "VerificationDate", "CategoryOfCertificate", "NameOfCertficate", "CertificationAgency",
    ];

    public sealed record SubmissionsResponse(
        IReadOnlyList<Dictionary<string, object?>> Rows, Dictionary<string, object?>? Counts);

    /// <summary>GET api/staff/schemes/fa/submissions?status=1..6 — SP_FINANCIAL_ASSISTANCE_GET_LIST for the signed-in user.</summary>
    [HttpGet("submissions")]
    public async Task<ActionResult<SubmissionsResponse>> Submissions([FromQuery] int status, CancellationToken ct)
    {
        if (status is < FaStatus.New or > FaStatus.Reimbursed) return this.Problem400("Invalid status.");
        // The procedure scopes by the user: master admin all, agency CertificationBodyUserId, assessor FinancialAssessorId.
        var sets = await db.QueryProcMultipleAsync("SP_FINANCIAL_ASSISTANCE_GET_LIST",
            new { UserId, Status = status, CertificationType = (string?)null, ZedId = (string?)null }, ct);
        var rows = sets[0].Select(r => SchemeRows.Pick(r, ListColumns)).ToList();
        var counts = sets[1].FirstOrDefault() is { } c ? SchemeRows.Pick(c, ["New", "InProgress", "Qc", "Approved", "Rejected"]) : null;
        return new SubmissionsResponse(rows, counts);
    }

    public sealed record Option(string UserId, string UserName);

    /// <summary>GET api/staff/schemes/fa/agencies?zedId= — agencies with FinancialVerification the unit can be allotted to.</summary>
    [HttpGet("agencies")]
    [StaffRoles(UserRole.MasterAdmin)]
    public async Task<ActionResult<IReadOnlyList<Option>>> Agencies([FromQuery] string? zedId, CancellationToken ct)
    {
        if (!SchemeRows.IsZedId(zedId)) return this.Problem400("Invalid ZED ID.");
        return (await AgencyOptions(zedId!, ct)).ToList();
    }

    public sealed record AllotRequest(string? ZedId, string? Certification, string? AgencyUserId);

    /// <summary>POST api/staff/schemes/fa/allot — SP_FINANCIAL_ASSISTANCE_ALLOT_TO_AGENCY (allot or re-allot a new application).</summary>
    [HttpPost("allot")]
    [StaffRoles(UserRole.MasterAdmin)]
    public async Task<ActionResult<MessageResponse>> Allot(AllotRequest req, CancellationToken ct)
    {
        if (!SchemeRows.IsZedId(req.ZedId) || FaApplications.Canonical(req.Certification) is not { } cert)
            return this.Problem400("Invalid application.");
        var zedId = req.ZedId!;

        using (await SchemeLocks.EnterAsync(ct))
        {
            var app = await FaApplications.FindAsync(db, zedId, cert, ct);
            if (app is null) return NotFound();
            if (app.Status != FaStatus.New) return this.Problem400("This application can no longer be allotted.");

            var agency = (await AgencyOptions(zedId, ct)).FirstOrDefault(a => SchemeRows.Same(a.UserId, req.AgencyUserId));
            if (agency is null) return this.Problem400("Please select assessment agency.");

            if (await Exec("SP_FINANCIAL_ASSISTANCE_ALLOT_TO_AGENCY",
                    new { ZedId = zedId, Certification = cert, CertificationBodyUserId = agency.UserId }, zedId, ct) is { } failed)
                return failed;
            await SchemeRows.AuditAsync(db, log, zedId, cert, $"Financial assistance allotted to agency {agency.UserId} by {UserId}", ct);

            var mailer = Mailer();
            var d = await mailer.DetailsAsync(zedId, cert, ct);
            await mailer.SendAsync<StaffSchemeFaAllotAgencyEmail>(d?.Text("AgencyEmailId"),
                $"Allocation of Application for Verification: Financial Assistance on {d?.Text("CategoryOfCertificate")} – {zedId}",
                new()
                {
                    [nameof(StaffSchemeFaAllotAgencyEmail.ZedId)] = zedId,
                    [nameof(StaffSchemeFaAllotAgencyEmail.UnitName)] = d?.Text("EnterpriseName") ?? "",
                    [nameof(StaffSchemeFaAllotAgencyEmail.Address)] = d?.Text("Address") ?? "",
                    [nameof(StaffSchemeFaAllotAgencyEmail.CategoryOfCertificate)] = d?.Text("CategoryOfCertificate") ?? "",
                }, ct);
        }
        return new MessageResponse("Application allotted.");
    }

    /// <summary>GET api/staff/schemes/fa/assessors — the agency's own active financial assessors (SP_ASSESSMENT_ASSESSORS_TO_ALLOT).</summary>
    [HttpGet("assessors")]
    [StaffRoles(UserRole.Agency)]
    public async Task<ActionResult<IReadOnlyList<Option>>> Assessors(CancellationToken ct) => (await AssessorOptions(ct)).ToList();

    public sealed record AcceptRequest(string? ZedId, string? Certification, string? AssessorUserId);

    /// <summary>POST api/staff/schemes/fa/accept — the allotted agency accepts and assigns an assessor (status 1 → 2).</summary>
    [HttpPost("accept")]
    [StaffRoles(UserRole.Agency)]
    public async Task<ActionResult<MessageResponse>> Accept(AcceptRequest req, CancellationToken ct)
    {
        if (!SchemeRows.IsZedId(req.ZedId) || FaApplications.Canonical(req.Certification) is not { } cert)
            return this.Problem400("Invalid application.");
        var zedId = req.ZedId!;

        using (await SchemeLocks.EnterAsync(ct))
        {
            if (await PendingForThisAgency(zedId, cert, ct) is { } refused) return refused;
            var assessor = (await AssessorOptions(ct)).FirstOrDefault(a => SchemeRows.Same(a.UserId, req.AssessorUserId));
            if (assessor is null) return this.Problem400("Please select valid data.");

            if (await Exec("SP_FINANCIAL_ASSESSMENT_ACCEPT_UNIT_FOR_VERIFICATION",
                    new { ZedId = zedId, Certification = cert, FinancialAssessorId = assessor.UserId }, zedId, ct) is { } failed)
                return failed;
            await SchemeRows.AuditAsync(db, log, zedId, cert, $"Financial assistance accepted by agency {UserId}; assessor {assessor.UserId}", ct);

            var mailer = Mailer();
            var d = await mailer.DetailsAsync(zedId, cert, ct);
            await mailer.SendAsync<StaffSchemeFaAllotAssessorEmail>(d?.Text("AssessorEmailId"),
                $"Allocation of Application for Verification: Financial Assistance on {d?.Text("CategoryOfCertificate")} – {zedId}",
                new()
                {
                    [nameof(StaffSchemeFaAllotAssessorEmail.ZedId)] = zedId,
                    [nameof(StaffSchemeFaAllotAssessorEmail.UnitName)] = d?.Text("EnterpriseName") ?? "",
                    [nameof(StaffSchemeFaAllotAssessorEmail.Address)] = d?.Text("Address") ?? "",
                    [nameof(StaffSchemeFaAllotAssessorEmail.CategoryOfCertificate)] = d?.Text("CategoryOfCertificate") ?? "",
                    [nameof(StaffSchemeFaAllotAssessorEmail.AssessorUserId)] = assessor.UserId,
                }, ct);
        }
        return new MessageResponse("Application accepted.");
    }

    public sealed record RejectRequest(string? ZedId, string? Certification, string? Reason);

    /// <summary>POST api/staff/schemes/fa/reject — the allotted agency returns the allotment (the master admin re-allots).</summary>
    [HttpPost("reject")]
    [StaffRoles(UserRole.Agency)]
    public async Task<ActionResult<MessageResponse>> Reject(RejectRequest req, CancellationToken ct)
    {
        if (!SchemeRows.IsZedId(req.ZedId) || FaApplications.Canonical(req.Certification) is not { } cert)
            return this.Problem400("Invalid application.");
        // SP_FINANCIAL_ASSESSMENT_REJECT_UNIT_FOR_VERIFICATION takes varchar(100); longer text was cut silently.
        if (SchemeRows.CleanText(req.Reason, 100) is not { } reason)
            return this.Problem400("Please enter the reason for rejection (up to 100 characters).");
        var zedId = req.ZedId!;

        using (await SchemeLocks.EnterAsync(ct))
        {
            if (await PendingForThisAgency(zedId, cert, ct) is { } refused) return refused;
            if (await Exec("SP_FINANCIAL_ASSESSMENT_REJECT_UNIT_FOR_VERIFICATION",
                    new { ZedId = zedId, Certification = cert, ReasonForRejection = reason }, zedId, ct) is { } failed)
                return failed;
            await SchemeRows.AuditAsync(db, log, zedId, cert, $"Financial assistance allotment rejected by agency {UserId}: {reason}", ct);

            var mailer = Mailer();
            var d = await mailer.DetailsAsync(zedId, cert, ct);
            await mailer.SendAsync<StaffSchemeFaAgencyRejectedEmail>(await HttpContext.RequestServices.GetRequiredService<EmailAddresses>().GetAsync(EmailAddresses.SchemeRejectionInbox, ct) ?? EmailAddresses.LegacyTeamInbox,
                $"Rejection of Application for Verification: Financial Assistance on {d?.Text("CategoryOfCertificate")} – {zedId}",
                new()
                {
                    [nameof(StaffSchemeFaAgencyRejectedEmail.ZedId)] = zedId,
                    [nameof(StaffSchemeFaAgencyRejectedEmail.UnitName)] = d?.Text("EnterpriseName") ?? "",
                    [nameof(StaffSchemeFaAgencyRejectedEmail.AgencyName)] = d?.Text("AgencyName") ?? "",
                    [nameof(StaffSchemeFaAgencyRejectedEmail.AgencyUserId)] = UserId,
                    [nameof(StaffSchemeFaAgencyRejectedEmail.Reason)] = reason,
                }, ct);
        }
        return new MessageResponse("Application rejected.");
    }

    /// <summary>A new application allotted to the signed-in agency that it has not accepted or rejected yet.</summary>
    private async Task<ActionResult?> PendingForThisAgency(string zedId, string cert, CancellationToken ct)
    {
        var app = await FaApplications.FindAsync(db, zedId, cert, ct);
        if (app is null || !SchemeRows.Same(app.AgencyUserId, UserId)) return NotFound();
        if (app.Status != FaStatus.New || !string.IsNullOrWhiteSpace(app.AssessorUserId) || app.RejectedByAgency)
            return this.Problem400("This application has already been processed.");
        return null;
    }

    private async Task<IEnumerable<Option>> AgencyOptions(string zedId, CancellationToken ct) =>
        (await db.QueryProcMultipleAsync("SP_ASSESSMENT_AGENCIES_TO_ALLOT", new { ZedId = zedId }, ct))[0]
        .Where(r => IsTrue(r, "FinancialVerification"))
        .Select(r => new Option(r.Text("UserId"), r.Text("UserName")))
        .Where(o => o.UserId.Length > 0);

    private async Task<IEnumerable<Option>> AssessorOptions(CancellationToken ct) =>
        (await db.QueryProcMultipleAsync("SP_ASSESSMENT_ASSESSORS_TO_ALLOT", new { UserId, RoleId = RoleId.ToString() }, ct))[0]
        .Select(r => new Option(r.Text("UserId"), r.Text("UserName")))
        .Where(o => o.UserId.Length > 0);

    private static bool IsTrue(IDictionary<string, object?> row, string column) =>
        row.Text(column) is "1" or "True" or "true";

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
