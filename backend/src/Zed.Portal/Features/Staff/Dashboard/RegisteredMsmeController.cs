using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Templates;

namespace Zed.Portal.Features.Staff.Dashboard;

/// <summary>
/// Registered MSMEs list. Port of DashboardController.RegisteredMsme / GetRegisteredMsme
/// (SP_DASHBOARD_REGISTERED_MSME, paged in the procedure), Dashboard/Resend and Msme/DisablePlant
/// (SP_MSME_DISABLE_PLANT) as used by Views/Dashboard/RegisteredMsme.cshtml.
/// </summary>
[Route("api/staff/dashboard/registered-msme")]
[StaffRoles(UserRole.SuperAdmin, UserRole.Ministry, UserRole.CitizenFeedback, UserRole.QC)]
public sealed class RegisteredMsmeController(
    ISqlExecutor db, IEmailSender email, IHtmlTemplateRenderer templates, IOptions<PortalOptions> portal,
    ILogger<RegisteredMsmeController> log) : StaffApiController
{
    /// <summary>Columns the table shows to every role (CertificationStatus drives the Assessment Details links).</summary>
    public static readonly string[] Columns =
    [
        "RowNumber", "ZedId", "Certification", "CertificationPhase", "PUnitName", "RegisteredDate", "AssessmentStatus",
        "FirstSurveDueDate", "UnitAddress", "PStateName", "CertificationStatus",
    ];

    /// <summary>"Assessment Agency / Udyam Number" column, shown only to SuperAdmin (and MasterAdmin, who cannot open the page).</summary>
    public static readonly string[] AdminColumns = ["CertificationBodyUserId", "UserName", "UdyogAadharNo"];

    public static readonly string[] SearchFields = ["Zed Id", "Udyam Number", "Unit Name"];
    public static readonly int[] PageSizes = [10, 20, 50, 100, 200, 1000];

    public sealed record ListResponse(List<Dictionary<string, object?>> Rows, int TotalCounts, int PageNo, int PageSize);

    [HttpGet]
    public async Task<ActionResult<ListResponse>> List(
        string? state, string? certification, string? size, string? gender, string? searchBy, string? search,
        int pageNo = 1, int pageSize = 10, CancellationToken ct = default)
    {
        var invalid = false;
        var stateCode = DashboardFilters.Pick(state, DashboardFilters.States.Keys, ref invalid);
        var cert = DashboardFilters.Pick(certification, DashboardFilters.Certifications, ref invalid);
        var sizeValue = DashboardFilters.Pick(size, DashboardFilters.Sizes, ref invalid);
        var genderValue = DashboardFilters.Pick(gender, DashboardFilters.Genders, ref invalid);
        var field = DashboardFilters.Pick(searchBy, SearchFields, ref invalid) ?? "Zed Id";
        search = string.IsNullOrWhiteSpace(search) ? null : search.Trim();
        if (invalid || search?.Length > 50 || pageNo < 1 || !PageSizes.Contains(pageSize))
            return this.Problem400("Invalid filter.");

        // The procedure applies a Ministry user's state only when no state is chosen, so a state-bound
        // Ministry user could pick another state on the old page. Here the user's own state always applies.
        if (IsRole(UserRole.Ministry) && !string.IsNullOrWhiteSpace(CurrentUser.StateCode))
            stateCode = CurrentUser.StateCode.Trim();

        var sets = await db.QueryProcMultipleAsync("SP_DASHBOARD_REGISTERED_MSME", new
        {
            ZedId = search, Status = field, State = stateCode, UserId, CertificationType = cert, RoleId = RoleId.ToString(),
            Gender = genderValue, MsmeSize = sizeValue, PageNo = pageNo, PageSize = pageSize,
        }, ct);

        var columns = IsRole(UserRole.SuperAdmin, UserRole.MasterAdmin) ? [.. Columns, .. AdminColumns] : Columns;
        var total = sets[1].FirstOrDefault();
        return new ListResponse(DashboardFilters.Pick(sets[0], columns), DashboardFilters.Int(total, "TotalCounts"), pageNo, pageSize);
    }

    /// <summary>
    /// "Resend Details". The legacy action (no authentication at all) e-mailed the MSME's stored password
    /// (SP_RESEND_REGISTRATION_DETAILS returns Users.Password). Here the MSME receives a password-reset link
    /// instead, the same mail as "Forgot password" on the MSME login page.
    /// </summary>
    [HttpPost("{zedId}/resend")]
    [StaffRoles(UserRole.SuperAdmin)]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<ActionResult<MessageResponse>> Resend(string zedId, CancellationToken ct)
    {
        if (!DashboardFilters.IsZedId(zedId)) return this.Problem400("Invalid ZED ID.");

        var row = (await db.QueryProcMultipleAsync("SP_RESEND_REGISTRATION_DETAILS", new { ZedId = zedId }, ct))[0].FirstOrDefault();
        var to = row?.Text("Email");
        if (row is null || string.IsNullOrEmpty(to)) return this.Problem400("Resend Registration details failed.");

        var code = SecureRandom.Token();
        await db.ExecuteProcAsync("SP_MSME_PWD_UPDATE_TOKEN", new { UserId = row.Text("UserId"), PwdCode = code }, ct);
        var html = await templates.RenderAsync<ResetPasswordEmail>(new Dictionary<string, object?>
        {
            [nameof(ResetPasswordEmail.EnterpriseName)] = row.Text("UnitName"),
            [nameof(ResetPasswordEmail.ZedId)] = row.Text("UserId"),
            [nameof(ResetPasswordEmail.ResetUrl)] = $"{portal.Value.PublicBaseUrl.TrimEnd('/')}/msme/reset-password?code={Uri.EscapeDataString(code)}",
            [nameof(ResetPasswordEmail.PublicBaseUrl)] = portal.Value.PublicBaseUrl,
        });
        await email.SendAsync(new EmailMessage(to, "Registration Details for “MSME Sustainable (ZED) Certification” Scheme – " + row.Text("UserId"), html), ct);
        log.LogInformation("{UserId} re-sent registration details (reset link) to {ZedId}", UserId, zedId);
        return new MessageResponse("Registration details sent to the registered Email ID.");
    }

    public sealed record DisableRequest(string? DisableRemarks);

    /// <summary>
    /// "IN-ACTIVE MSME". The procedure moves the unit to the *DeletedRecords tables and deactivates the login;
    /// it only does so for RoleId 10. The legacy Msme/DisablePlant had no authentication filter.
    /// </summary>
    [HttpPost("{zedId}/disable")]
    [StaffRoles(UserRole.SuperAdmin)]
    public async Task<ActionResult<MessageResponse>> Disable(string zedId, DisableRequest req, CancellationToken ct)
    {
        if (!DashboardFilters.IsZedId(zedId)) return this.Problem400("Invalid ZED ID.");
        var remarks = req.DisableRemarks?.Trim();
        if (string.IsNullOrEmpty(remarks)) return this.Problem400("Please enter the reason for deactivation.");
        if (remarks.Length > 2000) return this.Problem400("The reason must be at most 2000 characters.");

        await db.ExecuteProcAsync("SP_MSME_DISABLE_PLANT", new { ZedId = zedId, UserId, RoleId = RoleId.ToString(), DisableRemarks = remarks }, ct);
        log.LogWarning("{UserId} deactivated MSME {ZedId}", UserId, zedId);
        return new MessageResponse("MSME deactivated.");
    }
}
