using System.Data.Common;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Templates;
using Zed.Portal.Features.Staff.Users;

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
        // How the agency got it: 'RoundRobin' or 'Manual' (migration 0062).
        "AllotmentType",
    ];

    public sealed record SubmissionsResponse(
        IReadOnlyList<Dictionary<string, object?>> Rows, Dictionary<string, object?>? Counts)
    {
        /// <summary>Master admin: the agencies of the Agency filter (2026-11-08).</summary>
        public IReadOnlyList<Option>? Agencies { get; init; }
    }

    /// <summary>The filters above the list (2026-11-08, as on Assessment Monitoring).</summary>
    public sealed record SubmissionFilter(string? Level, string? Agency, DateOnly? From, DateOnly? To)
    {
        public bool Any => Level is not null || Agency is not null || From is not null || To is not null;

        public bool Matches(IDictionary<string, object?> r)
        {
            if (Level is not null && !string.Equals(r.Text("CertificationType").Trim(), Level, StringComparison.OrdinalIgnoreCase)) return false;
            if (Agency is not null && !string.Equals(r.Text("CertificationBodyUserId").Trim(), Agency, StringComparison.OrdinalIgnoreCase)) return false;
            if (From is null && To is null) return true;
            var on = RegisteredOn(r.TryGetValue("RegisteredDate", out var v) ? v : null);
            return on is not null && (From is null || on >= From) && (To is null || on <= To);
        }

        private static DateOnly? RegisteredOn(object? value) => value switch
        {
            DateTime d => DateOnly.FromDateTime(d),
            DateTimeOffset d => DateOnly.FromDateTime(d.Date),
            string s when DateTime.TryParse(s, System.Globalization.CultureInfo.GetCultureInfo("en-IN"), System.Globalization.DateTimeStyles.None, out var d) => DateOnly.FromDateTime(d),
            _ => null,
        };
    }

    private static readonly (int Status, string Key)[] CountKeys =
        [(FaStatus.New, "New"), (FaStatus.InProgress, "InProgress"), (FaStatus.Qc, "Qc"), (FaStatus.Approved, "Approved"), (FaStatus.Rejected, "Rejected")];

    internal const string FaAgenciesSql =
        "SELECT UserId, UserName FROM dbo.Users WHERE RoleId = 2 AND FinancialVerification = 1 ORDER BY UserName;";

    /// <summary>
    /// GET api/staff/schemes/fa/submissions?status=1..6 — SP_FINANCIAL_ASSISTANCE_GET_LIST for the signed-in user. Optional filters
    /// (2026-11-08): level (Bronze, Silver, Gold, ZEDX), agency (its user id), from / to (registered on, yyyy-MM-dd); with a filter
    /// the tab counts are those of the filtered lists.
    /// </summary>
    [HttpGet("submissions")]
    public async Task<ActionResult<SubmissionsResponse>> Submissions([FromQuery] int status, [FromQuery] string? level, [FromQuery] string? agency,
        [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct)
    {
        if (status is < FaStatus.New or > FaStatus.Reimbursed) return this.Problem400("Invalid status.");
        var lv = string.IsNullOrWhiteSpace(level) ? null : FaApplications.Canonical(level);
        if (!string.IsNullOrWhiteSpace(level) && lv is null) return this.Problem400("Invalid certification level.");
        if (agency is not null && agency.Trim().Length is 0 or > 50) agency = null;
        if (from is not null && to is not null && from > to) return this.Problem400("The 'from' date is after the 'to' date.");
        var filter = new SubmissionFilter(lv, agency?.Trim(), from, to);

        // The procedure scopes by the user: master admin all, agency CertificationBodyUserId, assessor FinancialAssessorId.
        var sets = await db.QueryProcMultipleAsync("SP_FINANCIAL_ASSISTANCE_GET_LIST",
            new { UserId, Status = status, CertificationType = (string?)null, ZedId = (string?)null }, ct);
        var rows = (await ScopeFilter.ApplyAsync(HttpContext, sets[0], ct)).Where(filter.Matches).Select(r => SchemeRows.Pick(r, ListColumns)).ToList();
        var counts = sets[1].FirstOrDefault() is { } c ? SchemeRows.Pick(c, ["New", "InProgress", "Qc", "Approved", "Rejected"]) : null;
        if (filter.Any)
        {
            // The counts of the filtered lists, one list at a time.
            counts = [];
            foreach (var (s, key) in CountKeys)
            {
                var list = s == status ? null : (await db.QueryProcMultipleAsync("SP_FINANCIAL_ASSISTANCE_GET_LIST",
                    new { UserId, Status = s, CertificationType = (string?)null, ZedId = (string?)null }, ct))[0];
                counts[key] = list is null ? rows.Count : (await ScopeFilter.ApplyAsync(HttpContext, list, ct)).Count(filter.Matches);
            }
        }
        IReadOnlyList<Option>? agencies = null;
        if (RoleId == (int)UserRole.MasterAdmin)
        {
            try
            {
                agencies = (await db.QuerySqlAsync<Option>(FaAgenciesSql, null, ct)).ToList();
            }
            catch (System.Data.Common.DbException ex)
            {
                log.LogWarning(ex, "Agencies of the FA filter not read");
            }
        }
        return new SubmissionsResponse(rows, counts) { Agencies = agencies };
    }

    public sealed record Option(string UserId, string UserName);

    /// <summary>GET api/staff/schemes/fa/agencies?zedId= — agencies with FinancialVerification the unit can be allotted to.</summary>
    [HttpGet("agencies")]
    [StaffRoles(UserRole.MasterAdmin)]
    public async Task<ActionResult<IReadOnlyList<Option>>> Agencies([FromQuery] string? zedId, [FromQuery] string? certification, CancellationToken ct)
    {
        if (!SchemeRows.IsZedId(zedId)) return this.Problem400("Invalid ZED ID.");
        return (await AgencyOptions(zedId!, FaApplications.Canonical(certification), ct)).ToList();
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

            var agency = (await AgencyOptions(zedId, cert, ct)).FirstOrDefault(a => SchemeRows.Same(a.UserId, req.AgencyUserId));
            if (agency is null) return this.Problem400("Please select assessment agency.");

            if (await Exec("SP_FINANCIAL_ASSISTANCE_ALLOT_TO_AGENCY",
                    new { ZedId = zedId, Certification = cert, CertificationBodyUserId = agency.UserId }, zedId, ct) is { } failed)
                return failed;
            await SchemeRows.AuditAsync(db, log, zedId, cert, $"Financial assistance allotted to agency {agency.UserId} by {UserId}", ct);
            await HttpContext.RequestServices.GetRequiredService<FaAutoAllotment>().MarkAsync(zedId, cert, agency.UserId, FaAutoAllotment.Manual, ct);

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

    /// <summary>POST api/staff/schemes/fa/reject — the allotted agency returns the allotment (the next agency of the round robin gets it).</summary>
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
            // 2026-11-08: it goes to the next agency of the round robin (not again to this one); none left = the Master Admin's list.
            var auto = HttpContext.RequestServices.GetRequiredService<FaAutoAllotment>();
            await auto.RecordRejectionAsync(zedId, cert, UserId, ct);

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
            await auto.AllotAsync(zedId, cert, ct);
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

    /// <summary>With the level (2026-11-08): not the agencies the Master Admin disabled for it (Agency level allocation).</summary>
    private async Task<IEnumerable<Option>> AgencyOptions(string zedId, string? certification, CancellationToken ct)
    {
        var disabled = certification is null ? [] : await AgencyLevels.DisabledAsync(db, certification, log, ct);
        return (await db.QueryProcMultipleAsync("SP_ASSESSMENT_AGENCIES_TO_ALLOT", new { ZedId = zedId }, ct))[0]
        .Where(r => IsTrue(r, "FinancialVerification") && !disabled.Contains(r.Text("UserId").Trim()))
        .Select(r => new Option(r.Text("UserId"), r.Text("UserName")))
        .Where(o => o.UserId.Length > 0);
    }

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
