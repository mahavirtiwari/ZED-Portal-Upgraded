using Dapper;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Mobile;
using Zed.Portal.Features.Consultancy.Milestones;
using Zed.Portal.Features.Documents;
using Zed.Portal.Features.Staff.Assessment;
using Zed.Portal.Features.Staff.PasswordReset;

namespace Zed.Portal.Features.Consultancy.ConsultantApp;

/// <summary>
/// V4, for the redesigned consultant app on the Consultancy portal, as <c>AssessorAppController</c> is for the site assessor app
/// on Main and Surveillance; the app's other calls go to the Consultancy mobile host (ConsultancySAController). The app has
/// no web sign-in:
/// <list type="bullet">
/// <item><c>GET /SA/AppReport?zedId=…&amp;certificationType=…&amp;milestone=n</c>: the handholding milestone report PDF, with the
/// app's sign-in token (<see cref="AppTokens.Header"/>, app SA, required whatever the SA token mode; the portal needs the mobile
/// host's <c>Mobile:AppTokenKey</c>), to the milestone's lead or co-consultant only, under the rules of the MSME's download
/// (<see cref="MilestoneDownloads"/>: Silver / Gold; the current milestone once completed, accepted or rejected, an earlier
/// one from the file stored when it was completed).</item>
/// <item><c>POST /SA/AppForgotPassword {assessorId | email}</c>: the staff "Forgot password?" of this portal for the app's
/// accounts (RoleId 3), the same link and mail as the web (<see cref="StaffPasswordResets"/>), without the web's captcha. The
/// answer is the same for every input and comes before the look-up; 10 calls a minute per address and 3 links an hour per
/// account.</item>
/// </list>
/// </summary>
[PortalSystems(PortalSystem.Consultancy)]
public sealed class ConsultantAppController(
    ISqlExecutor db,
    AppTokens tokens,
    StaffPasswordResets resets,
    IBackgroundWork background,
    IWebHostEnvironment env,
    IOptions<PortalOptions> portal,
    ILogger<DocumentRenderer> documentLog,
    ILogger<ConsultantAppController> log) : LegacyMobileController
{
    /// <summary>Users.RoleId of consultants (the consultant app signs in RoleId 3 only; DFOs are RoleId 3 too).</summary>
    public const int ConsultantRole = 3;

    public const string ForgotPasswordAnswer =
        "If the Consultant ID or e-mail address belongs to an active consultant account, a link to set a new password has been sent to its registered e-mail address.";

    public const string ForgotPasswordInput = "Please enter your Consultant ID or registered e-mail address.";

    /// <summary>The active consultants with this registered e-mail address (several accounts may share one).</summary>
    public const string ConsultantsByEmailSql =
        "SELECT TOP (5) UserId FROM dbo.Users WHERE Email = @Email AND RoleId = 3 AND IsActive = 1;";

    /// <summary>Whether the user is the lead (MsmeCertifications.SiteAssessorId) or a co-consultant (AllotedCoAssessors) of the milestone.</summary>
    public const string MilestoneTeamSql = """
        SELECT COUNT(*) FROM (
          SELECT Id FROM dbo.MsmeCertifications
           WHERE ZedId = @ZedId AND Certification = @Certification AND NcCount = @NcCount AND SiteAssessorId = @UserId
          UNION ALL
          SELECT Id FROM dbo.AllotedCoAssessors
           WHERE ZedId = @ZedId AND Certification = @Certification AND NcCount = @NcCount AND CoAssessorId = @UserId) X;
        """;

    [HttpGet("/SA/AppReport")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<IActionResult> AppReport(string? zedId, string? certificationType, int? milestone, CancellationToken ct)
    {
        var token = Request.Headers[AppTokens.Header].ToString();
        if (tokens.Read(token) is not { } t || await tokens.CheckAsync(token, MobileApps.SiteAssessor, t.User, null, ct) != AppTokenCheck.Valid)
            return Unauthorized();

        // Handholding is towards Silver or Gold, in milestones 1 to 3.
        if (!AssessmentInput.IsId(zedId) || DocumentLevels.Level(certificationType) is not ("Silver" or "Gold") || milestone is < 1 or > DocumentLevels.Milestones)
            return NotFound();
        var level = DocumentLevels.Level(certificationType)!;
        // The unit's current milestone (the highest), whose report is drawn; an earlier one is served from storage.
        var record = (await db.QuerySqlAsync<CertificationRecord>(MilestoneContext.RecordSql, new { ZedId = Ansi(zedId), Certification = Ansi(level) }, ct))
            .FirstOrDefault();
        var number = milestone ?? record?.Nc ?? 0;
        var allotted = record is not null && (await db.QuerySqlAsync<int>(MilestoneTeamSql, new
        {
            ZedId = Ansi(zedId), Certification = Ansi(level), NcCount = number, UserId = Ansi(t.User),
        }, ct)).FirstOrDefault() > 0;
        if (!allotted)
        {
            log.LogWarning("Consultant app report of {ZedId} {Level} milestone {Milestone} refused to {UserId}: not on the milestone", zedId, level, number, t.User);
            return NotFound();
        }
        return await MilestoneDownloads.ReportAsync(this, new DocumentRenderer(env, portal, documentLog), db, record, zedId!, level, number, preview: false, ct);
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
        var consultantId = request.assessorId?.Trim();
        var email = request.email?.Trim();
        if (string.IsNullOrEmpty(consultantId) && string.IsNullOrEmpty(email)) return Fail(ForgotPasswordInput);
        if (consultantId is { Length: > 50 } || email is { Length: > 100 }) return Fail(ForgotPasswordInput);

        var ip = ClientIp;
        background.Enqueue("Consultant app password reset request", (sp, stop) => RequestAsync(sp, consultantId, email, ip, stop));
        return LegacyJson(ServiceResponse.Ok(ForgotPasswordAnswer));
    }

    /// <summary>The consultant named, or each active consultant with that e-mail address, through the web's self-service request.</summary>
    private static async Task RequestAsync(IServiceProvider sp, string? consultantId, string? email, string? ip, CancellationToken ct)
    {
        var resets = sp.GetRequiredService<StaffPasswordResets>();
        if (!string.IsNullOrEmpty(consultantId))
        {
            await resets.RequestAsync(consultantId, ip, ct, onlyRoleId: ConsultantRole);
            return;
        }
        var ids = await sp.GetRequiredService<ISqlExecutor>().QuerySqlAsync<string>(ConsultantsByEmailSql,
            new { Email = new DbString { Value = email, IsAnsi = true, Length = 100 } }, ct);
        if (ids.Count == 0)
            sp.GetRequiredService<ILoggerFactory>().CreateLogger(StaffPasswordResets.AuditCategory)
                .LogInformation("Consultant app password reset request from {Ip}: no active consultant with the e-mail address given", ip);
        foreach (var id in ids.Where(i => !string.IsNullOrWhiteSpace(i)).Distinct(StringComparer.OrdinalIgnoreCase))
            await resets.RequestAsync(id, ip, ct, onlyRoleId: ConsultantRole);
    }

    private static DbString Ansi(string? value) => new() { Value = value, IsAnsi = true, Length = 50 };
}
