using System.Data.Common;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Portal.Features.Staff.Users;
using Zed.Portal.Templates;

namespace Zed.Portal.Features.Staff.Schemes;

/// <summary>
/// Financial assistance applications go to an agency by round robin (2026-11-08, at the Master Admin's request; before, the
/// Master Admin allotted each one by hand): when the MSME submits, and again when the allotted agency rejects it. The rotation
/// takes the eligible agencies (those SP_ASSESSMENT_AGENCIES_TO_ALLOT offers with Financial verification, whose sector type fits
/// the unit, not disabled for the level under Agency level allocation, and that have not rejected this application) in
/// Users.Id order, after the agency of the last round-robin allotment. Kept in migration 0062's columns of the legacy table:
/// FinancialAssistance.AllotmentType ('RoundRobin' / 'Manual'), AllotmentDate and RejectedAgencies. With no eligible agency the
/// application waits on the Master Admin's FA Allotment list, as before; the Master Admin can still allot or re-allot by hand.
/// Callers hold <see cref="SchemeLocks"/>.
/// </summary>
public sealed class FaAutoAllotment(
    ISqlExecutor db,
    IEmailSender email,
    IHtmlTemplateRenderer templates,
    IOptions<PortalOptions> portal,
    IOptions<EmailOptions> emailOptions,
    ILogger<FaAutoAllotment> log)
{
    public const string RoundRobin = "RoundRobin";
    public const string Manual = "Manual";

    internal const string LastSql =
        "SELECT TOP (1) CertificationBodyUserId FROM dbo.FinancialAssistance WHERE AllotmentType = 'RoundRobin' " +
        "AND CertificationBodyUserId IS NOT NULL ORDER BY AllotmentDate DESC, Id DESC;";

    internal const string RejectedSql =
        "SELECT TOP (1) RejectedAgencies FROM dbo.FinancialAssistance WHERE ZedId = @ZedId AND CertificationType = @Certification " +
        "AND VerificationStatus = 1 ORDER BY Id DESC;";

    internal const string AgencyIdsSql = "SELECT UserId, Id FROM dbo.Users WHERE RoleId = 2 AND IsActive = 1 AND UserId IN @Ids;";

    internal const string MarkSql =
        "UPDATE dbo.FinancialAssistance SET AllotmentType = @AllotmentType, AllotmentDate = GETDATE() " +
        "WHERE ZedId = @ZedId AND CertificationType = @Certification AND VerificationStatus = 1 AND CertificationBodyUserId = @Agency;";

    internal const string RecordRejectionSql =
        "UPDATE dbo.FinancialAssistance SET RejectedAgencies = CASE WHEN RejectedAgencies IS NULL OR RejectedAgencies = '' THEN @Agency " +
        "ELSE RejectedAgencies + ',' + @Agency END WHERE ZedId = @ZedId AND CertificationType = @Certification AND VerificationStatus = 1;";

    /// <summary>New applications without an agency, or returned by their agency (for the sweep).</summary>
    internal const string WaitingSql =
        "SELECT ZedId, CertificationType FROM dbo.FinancialAssistance WHERE VerificationStatus = 1 AND ISNULL(FinancialAssessorId, '') = '' " +
        "AND (ISNULL(CertificationBodyUserId, '') = '' OR ISNULL(ReasonForRejection, '') <> '');";

    private sealed class AgencyIdRow
    {
        public string? UserId { get; init; }
        public long Id { get; init; }
    }

    private sealed class TextRow
    {
        public string? CertificationBodyUserId { get; init; }
        public string? RejectedAgencies { get; init; }
    }

    public sealed class WaitingRow
    {
        public string? ZedId { get; init; }
        public string? CertificationType { get; init; }
    }

    /// <summary>Allots the application to the next eligible agency; returns its user id, or null when none could be chosen.</summary>
    public async Task<string?> AllotAsync(string zedId, string certification, CancellationToken ct)
    {
        try
        {
            var app = await FaApplications.FindAsync(db, zedId, certification, ct);
            if (app is null || app.Status != FaStatus.New || !string.IsNullOrWhiteSpace(app.AssessorUserId)) return null;
            if (!string.IsNullOrWhiteSpace(app.AgencyUserId) && !app.RejectedByAgency) return null;

            var next = await NextAgencyAsync(zedId, certification, app.AgencyUserId, ct);
            if (next is null)
            {
                log.LogWarning("FA {ZedId}/{Certification}: no eligible agency for the round robin; it waits for the Master Admin", zedId, certification);
                return null;
            }
            await db.ExecuteProcAsync("SP_FINANCIAL_ASSISTANCE_ALLOT_TO_AGENCY", new { ZedId = zedId, Certification = certification, CertificationBodyUserId = next }, ct);
            await MarkAsync(zedId, certification, next, RoundRobin, ct);
            await SchemeRows.AuditAsync(db, log, zedId, certification, $"Financial assistance allotted to agency {next} by round robin", ct);
            await MailAgencyAsync(db, email, templates, portal, emailOptions, log, zedId, certification, ct);
            return next;
        }
        catch (DbException ex)
        {
            log.LogError(ex, "FA {ZedId}/{Certification}: round-robin allotment failed; it waits for the Master Admin", zedId, certification);
            return null;
        }
    }

    /// <summary>The agency returned the application: it is not offered it again.</summary>
    public async Task RecordRejectionAsync(string zedId, string certification, string agency, CancellationToken ct)
    {
        try
        {
            await db.ExecuteSqlAsync(RecordRejectionSql, new { ZedId = zedId, Certification = certification, Agency = agency }, ct);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "FA {ZedId}/{Certification}: the rejection by {Agency} not recorded (is migration 0062 applied?)", zedId, certification, agency);
        }
    }

    /// <summary>How the current agency got it ('RoundRobin' or 'Manual'); nothing before migration 0062.</summary>
    public async Task MarkAsync(string zedId, string certification, string agency, string type, CancellationToken ct)
    {
        try
        {
            await db.ExecuteSqlAsync(MarkSql, new { AllotmentType = type, ZedId = zedId, Certification = certification, Agency = agency }, ct);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "FA {ZedId}/{Certification}: allotment type not saved (is migration 0062 applied?)", zedId, certification);
        }
    }

    /// <summary>Allots every waiting application (the first run after the update, and a safety net).</summary>
    public async Task<int> SweepAsync(CancellationToken ct)
    {
        IReadOnlyList<WaitingRow> waiting;
        try
        {
            waiting = await db.QuerySqlAsync<WaitingRow>(WaitingSql, null, ct);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "FA round robin: waiting applications not read");
            return 0;
        }
        var done = 0;
        foreach (var w in waiting)
        {
            if (string.IsNullOrWhiteSpace(w.ZedId) || FaApplications.Canonical(w.CertificationType) is not { } cert) continue;
            using (await SchemeLocks.EnterAsync(ct))
                if (await AllotAsync(w.ZedId.Trim(), cert, ct) is not null) done++;
        }
        if (done > 0) log.LogInformation("FA round robin: {Count} waiting application(s) allotted", done);
        return done;
    }

    private async Task<string?> NextAgencyAsync(string zedId, string certification, string? current, CancellationToken ct)
    {
        var offered = (await db.QueryProcMultipleAsync("SP_ASSESSMENT_AGENCIES_TO_ALLOT", new { ZedId = zedId }, ct))[0]
            .Where(r => r.Text("FinancialVerification") is "1" or "True" or "true")
            .Select(r => r.Text("UserId").Trim()).Where(u => u.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (offered.Count == 0) return null;

        // The unit's kind, the level switches and the agencies that returned it.
        var category = await UserSectorActivity.UnitCategoryAsync(db, zedId, log, ct);
        var activities = await UserSectorActivity.ByRoleAsync(db, (int)Zed.Core.Security.UserRole.Agency, log, ct);
        var disabled = await AgencyLevels.DisabledAsync(db, certification, log, ct);
        var rejected = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            foreach (var a in ((await db.QuerySqlAsync<TextRow>(RejectedSql, new { ZedId = zedId, Certification = certification }, ct)).FirstOrDefault()?.RejectedAgencies ?? "")
                         .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
                rejected.Add(a);
        }
        catch (DbException) { /* before migration 0062 */ }
        if (!string.IsNullOrWhiteSpace(current)) rejected.Add(current.Trim());

        var eligible = offered.Where(u => !disabled.Contains(u) && !rejected.Contains(u) && UserSectorActivity.Serves(activities.GetValueOrDefault(u), category)).ToList();
        if (eligible.Count == 0) return null;
        var ordered = (await db.QuerySqlAsync<AgencyIdRow>(AgencyIdsSql, new { Ids = eligible.ToArray() }, ct))
            .Where(r => r.UserId is not null).OrderBy(r => r.Id).ToList();
        if (ordered.Count == 0) return null;

        string? last = null;
        try
        {
            last = (await db.QuerySqlAsync<TextRow>(LastSql, null, ct)).FirstOrDefault()?.CertificationBodyUserId?.Trim();
        }
        catch (DbException) { /* before migration 0062: start from the first */ }
        long? lastId = null;
        if (last is not null)
            lastId = (await db.QuerySqlAsync<AgencyIdRow>("SELECT UserId, Id FROM dbo.Users WHERE UserId = @UserId AND RoleId = 2;", new { UserId = last }, ct))
                .FirstOrDefault()?.Id;
        return (ordered.FirstOrDefault(r => lastId is null || r.Id > lastId) ?? ordered[0]).UserId!.Trim();
    }

    /// <summary>The allotment mail to the agency (as for a manual allotment).</summary>
    internal static async Task MailAgencyAsync(ISqlExecutor db, IEmailSender email, IHtmlTemplateRenderer templates, IOptions<PortalOptions> portal,
        IOptions<EmailOptions> emailOptions, ILogger log, string zedId, string certification, CancellationToken ct)
    {
        var mailer = new SchemeMailer(db, email, templates, portal, emailOptions, log);
        var d = await mailer.DetailsAsync(zedId, certification, ct);
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
}

/// <summary>
/// On the main portal: allots the waiting financial assistance applications (those submitted from the MSME app, which the mobile API
/// leaves to this check; the first run after the update; any whose allotment failed) two minutes after start, then every five minutes
/// (Schemes:FaAutoAllotSweepMinutes; 0 = off).
/// </summary>
public sealed class FaAutoAllotmentSweep(IServiceScopeFactory scopes, IConfiguration config, ILogger<FaAutoAllotmentSweep> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var minutes = config.GetValue("Schemes:FaAutoAllotSweepMinutes", 5);
        if (minutes <= 0) return;
        try
        {
            await Task.Delay(TimeSpan.FromMinutes(Math.Min(minutes, 2)), stoppingToken);
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    using var scope = scopes.CreateScope();
                    await scope.ServiceProvider.GetRequiredService<FaAutoAllotment>().SweepAsync(stoppingToken);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    log.LogError(ex, "FA round-robin sweep failed");
                }
                await Task.Delay(TimeSpan.FromMinutes(minutes), stoppingToken);
            }
        }
        catch (OperationCanceledException) { /* stopping */ }
    }
}
