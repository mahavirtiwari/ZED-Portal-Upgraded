using Dapper;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Mobile;
using Zed.Portal.Features.Documents;
using Zed.Portal.Features.Staff.Assessment;
using Zed.Portal.Features.Staff.PasswordReset;

namespace Zed.Portal.Features.AssessorApp;

/// <summary>
/// V4, for the redesigned site assessor app (SA app 2.0) on the Main and Surveillance portals; the app's other calls go to the
/// mobile host (SAController). Like the MSME app's documents (<c>MsmeAppFilesController</c>), the app has no web sign-in:
/// <list type="bullet">
/// <item><c>GET /SA/AppReport?zedId=…&amp;certificationType=…</c>: the site assessment report PDF, with the app's sign-in token
/// (<see cref="AppTokens.Header"/>, app SA, required whatever the SA token mode; the portal needs the mobile host's
/// <c>Mobile:AppTokenKey</c>), to the record's lead or co-assessor only, under the rules of the staff download (a certified
/// or a rejected record, <c>CertificationDownloads</c>).</item>
/// <item><c>POST /SA/AppForgotPassword {assessorId | email}</c>: the staff "Forgot password?" for site assessors, the same link
/// and mail as the web (<see cref="StaffPasswordResets"/>), without the web's captcha, which the app cannot show. The answer is
/// the same for every input and comes before the look-up; 10 calls a minute per address and 3 links an hour per account.</item>
/// </list>
/// </summary>
[PortalSystems(PortalSystem.Main, PortalSystem.Surveillance)]
public sealed class AssessorAppController(
    ISqlExecutor db,
    IAssessmentDocuments documents,
    AppTokens tokens,
    StaffPasswordResets resets,
    IBackgroundWork background,
    ILogger<AssessorAppController> log) : LegacyMobileController
{
    /// <summary>Users.RoleId of assessors (the site assessor app signs in RoleId 3 only).</summary>
    public const int AssessorRole = 3;

    public const string ForgotPasswordAnswer =
        "If the Assessor ID or e-mail address belongs to an active assessor account, a link to set a new password has been sent to its registered e-mail address.";

    public const string ForgotPasswordInput = "Please enter your Assessor ID or registered e-mail address.";

    /// <summary>The active assessors with this registered e-mail address (several accounts may share one).</summary>
    public const string AssessorsByEmailSql =
        "SELECT TOP (5) UserId FROM dbo.Users WHERE Email = @Email AND RoleId = 3 AND IsActive = 1;";

    [HttpGet("/SA/AppReport")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<IActionResult> AppReport(string? zedId, string? certificationType, CancellationToken ct)
    {
        var token = Request.Headers[AppTokens.Header].ToString();
        if (tokens.Read(token) is not { } t || await tokens.CheckAsync(token, MobileApps.SiteAssessor, t.User, null, ct) != AppTokenCheck.Valid)
            return Unauthorized();

        // Site levels only: Bronze has no site assessor.
        if (!AssessmentInput.IsId(zedId) || DocumentLevels.Level(certificationType) is not { } level || DocumentLevels.IsDesktop(level)) return NotFound();
        var record = await AssessmentRecords.CertificationAsync(db, zedId!, level, ct);
        if (record is null || !(Is(record.SiteAssessorId, t.User) || Is(record.CoAssessorId, t.User)))
        {
            log.LogWarning("SA app report of {ZedId} {Level} refused to {UserId}: not the record's assessor", zedId, level, t.User);
            return NotFound();
        }
        return await CertificationDownloads.ReportAsync(this, documents, record, zedId!, level, ct);
    }

    public sealed class ForgotPasswordRequest
    {
        public string? assessorId { get; set; }
        public string? email { get; set; }
    }

    [HttpPost("/SA/AppForgotPassword")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public IActionResult AppForgotPassword(ForgotPasswordRequest request)
    {
        if (!resets.Options.Enabled) return Fail("Password reset is not available on this portal. Please contact the ZED team.");
        var assessorId = request.assessorId?.Trim();
        var email = request.email?.Trim();
        if (string.IsNullOrEmpty(assessorId) && string.IsNullOrEmpty(email)) return Fail(ForgotPasswordInput);
        if (assessorId is { Length: > 50 } || email is { Length: > 100 }) return Fail(ForgotPasswordInput);

        var ip = ClientIp;
        background.Enqueue("SA app password reset request", (sp, stop) => RequestAsync(sp, assessorId, email, ip, stop));
        return LegacyJson(ServiceResponse.Ok(ForgotPasswordAnswer));
    }

    /// <summary>The assessor named, or each active assessor with that e-mail address, through the web's self-service request.</summary>
    private static async Task RequestAsync(IServiceProvider sp, string? assessorId, string? email, string? ip, CancellationToken ct)
    {
        var resets = sp.GetRequiredService<StaffPasswordResets>();
        if (!string.IsNullOrEmpty(assessorId))
        {
            await resets.RequestAsync(assessorId, ip, ct, onlyRoleId: AssessorRole);
            return;
        }
        var ids = await sp.GetRequiredService<ISqlExecutor>().QuerySqlAsync<string>(AssessorsByEmailSql,
            new { Email = new DbString { Value = email, IsAnsi = true, Length = 100 } }, ct);
        if (ids.Count == 0)
            sp.GetRequiredService<ILoggerFactory>().CreateLogger(StaffPasswordResets.AuditCategory)
                .LogInformation("SA app password reset request from {Ip}: no active assessor with the e-mail address given", ip);
        foreach (var id in ids.Where(i => !string.IsNullOrWhiteSpace(i)).Distinct(StringComparer.OrdinalIgnoreCase))
            await resets.RequestAsync(id, ip, ct, onlyRoleId: AssessorRole);
    }

    private static bool Is(string? column, string userId) =>
        !string.IsNullOrWhiteSpace(column) && string.Equals(column.Trim(), userId.Trim(), StringComparison.OrdinalIgnoreCase);
}
