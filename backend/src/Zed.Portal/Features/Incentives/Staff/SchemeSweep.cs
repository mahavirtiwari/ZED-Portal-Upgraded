using System.Data.Common;
using System.Text.RegularExpressions;
using Zed.Core.Data;
using static Zed.Portal.Features.Incentives.SchemeApplications;

namespace Zed.Portal.Features.Incentives.Staff;

/// <summary>
/// The scheme applications' timed rules (2026-11-20, approved), run by <see cref="SchemeSweepService"/>:
/// <list type="bullet">
/// <item>a correction round not answered by its CorrectionDueOn is rejected ("Correction not received in time"; mail to the unit);</item>
/// <item>an application in progress (Submitted … Qc) whose claim certificate (SchemeCertNo of SchemeLevel in MsmeCertifications)
/// is now SUSPENDED or WITHDRAWN (<see cref="SchemeEligibility.HoldPhases"/>) goes OnHold with the reason; the Master Admin then
/// resumes or rejects it. An approved application (waiting for NEFT) is left to the MSME DFO.</item>
/// </list>
/// The other automatic rejection of the design — the last correction round answered and still not valid — is the assessor's
/// Reject on the verification page (no Send for correction is offered once the rounds are used up).
/// </summary>
public sealed partial class SchemeSweep(ISqlExecutor db, IServiceProvider services, ILogger<SchemeSweep> log)
{
    public const string LateReason = "Correction not received in time";

    internal const string OverdueSql =
        "SELECT " + Columns + " FROM dbo.FinancialAssistance WHERE SchemeCode IS NOT NULL AND SchemeStatus = 'Correction' " +
        "AND CorrectionDueOn < @Today AND ISNULL(VerificationStatus, 0) <> 6;";

    internal const string InProgressSql =
        "SELECT " + Columns + " FROM dbo.FinancialAssistance WHERE SchemeCode IS NOT NULL AND SchemeCertNo IS NOT NULL " +
        "AND SchemeStatus IN ('Submitted', 'WithAgency', 'WithAssessor', 'Verifying', 'Correction', 'Qc', " +
        "'OnsiteAllot', 'OnsiteWithAgency', 'OnsiteWithAssessor', 'OnsiteVisit') AND ISNULL(VerificationStatus, 0) <> 6;";

    /// <summary>
    /// Phase 2: applications waiting for an onsite agency that the round robin may try again (not the ones an onsite agency sent
    /// back to the Master Admin with a "Master Admin" reason).
    /// </summary>
    internal const string OnsiteWaitingSql =
        "SELECT Id FROM dbo.FinancialAssistance WHERE SchemeCode IS NOT NULL AND SchemeStatus = 'OnsiteAllot' AND OnsiteAgencyId IS NULL " +
        "AND ISNULL(OnsiteAllotmentType, '') <> 'MasterAdmin' AND ISNULL(VerificationStatus, 0) <> 6;";

    /// <summary>
    /// Phase 2: onsite decisions made in the assessor app not mailed yet (the mobile API has no scheme mail templates): a
    /// recommendation tells the onsite agency (its QC), a rejection tells the unit. Marked before mailing (at most one mail).
    /// </summary>
    internal const string OnsiteDecidedSql =
        "SELECT Id FROM dbo.FinancialAssistance WHERE SchemeCode IS NOT NULL AND VisitSubmittedOn IS NOT NULL " +
        "AND (OnsiteNotifiedOn IS NULL OR OnsiteNotifiedOn < VisitSubmittedOn) AND SchemeStatus IN ('Qc', 'Rejected');";

    internal const string OnsiteNotifiedSql = "UPDATE dbo.FinancialAssistance SET OnsiteNotifiedOn = GETDATE() WHERE Id = @Id;";

    private sealed class IdRow
    {
        public int Id { get; init; }
    }

    internal const string HeldCertificatesSql =
        "SELECT ZedId, Certification, CAST(CASE WHEN CertificationStatus = 16 THEN SaCertificateNo ELSE DaCertificateNo END AS varchar(100)) AS CertNo, " +
        "CertificationPhase AS Phase FROM dbo.MsmeCertifications WHERE ZedId IN @ZedIds AND CertificationPhase IN ('SUSPENDED', 'WITHDRAWN');";

    public sealed class CertRow
    {
        public string? ZedId { get; init; }
        public string? Certification { get; init; }
        public string? CertNo { get; init; }
        public string? Phase { get; init; }
    }

    /// <param name="OnsiteAllotted">Phase 2: applications the onsite round robin allotted on this run.</param>
    public sealed record Result(int Rejected, int Held, int OnsiteAllotted = 0);

    public async Task<Result> RunAsync(CancellationToken ct)
    {
        var rejected = 0;
        var held = 0;
        try
        {
            var overdue = await db.QuerySqlAsync<Row>(OverdueSql, new { Today = DateTime.Today }, ct);
            foreach (var r in overdue)
            {
                using (await SchemeCaseLock.EnterAsync(ct))
                {
                    var c = await SchemeCases.LoadAsync(db, r.Id, ct);
                    if (c is null || c.Status != Correction || c.CorrectionDueOn is not { } due || due >= DateTime.Today) continue;
                    c.Status = Rejected;
                    c.ReasonForRejection = LateReason;
                    c.DecidedOn = DateTime.Now;
                    if (!await SchemeCases.SaveAsync(db, c, ct)) continue;
                    rejected++;
                    await SchemeCases.HistoryAsync(db, log, c, $"Scheme application rejected automatically: {LateReason} (due {due:dd-MMM-yyyy})", ct);
                    await SchemeServices.Get<SchemeNotifier>(services).RejectedAsync(c, LateReason, ct);
                }
            }
        }
        catch (DbException ex)
        {
            log.LogError(ex, "Scheme sweep: overdue corrections not processed");
        }

        try
        {
            var open = await db.QuerySqlAsync<Row>(InProgressSql, null, ct);
            var byLevel = open.Where(r => LevelRegistry.Canonical(r.SchemeLevel) is not null && !string.IsNullOrWhiteSpace(r.ZedId)).ToList();
            var certs = new List<CertRow>();
            foreach (var chunk in byLevel.Select(r => r.ZedId!.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).Chunk(500))
                certs.AddRange(await db.QuerySqlAsync<CertRow>(HeldCertificatesSql, new { ZedIds = chunk }, ct));
            foreach (var r in byLevel)
            {
                var cert = certs.FirstOrDefault(x => string.Equals(x.ZedId?.Trim(), r.ZedId!.Trim(), StringComparison.OrdinalIgnoreCase)
                    && string.Equals(LevelRegistry.Canonical(x.Certification), LevelRegistry.Canonical(r.SchemeLevel), StringComparison.OrdinalIgnoreCase)
                    && string.Equals(x.CertNo?.Trim(), r.SchemeCertNo?.Trim(), StringComparison.OrdinalIgnoreCase)
                    && SchemeEligibility.HoldPhases.Contains(x.Phase?.Trim() ?? ""));
                if (cert is null) continue;
                using (await SchemeCaseLock.EnterAsync(ct))
                {
                    var c = await SchemeCases.LoadAsync(db, r.Id, ct);
                    if (c is null || c.Status is not (Submitted or WithAgency or WithAssessor or Verifying or Correction or Qc
                        or OnsiteAllot or OnsiteWithAgency or OnsiteWithAssessor or OnsiteVisit)) continue;
                    var previous = c.Status;
                    c.HoldReason = HoldText(cert.Phase!.Trim().ToUpperInvariant(), cert.CertNo!.Trim(), previous);
                    c.Status = OnHold;
                    if (!await SchemeCases.SaveAsync(db, c, ct)) continue;
                    held++;
                    await SchemeCases.HistoryAsync(db, log, c, $"Scheme application on hold: {c.HoldReason}", ct);
                }
            }
        }
        catch (DbException ex)
        {
            log.LogError(ex, "Scheme sweep: certificates of applications in progress not checked");
        }

        // Phase 2: the onsite round robin tries again the applications still waiting for an onsite agency (as the agencies change).
        var onsiteAllotted = 0;
        try
        {
            var waiting = await db.QuerySqlAsync<IdRow>(OnsiteWaitingSql, null, ct);
            var onsite = SchemeServices.Get<Onsite.OnsiteAllotment>(services);
            foreach (var w in waiting)
                if (await onsite.AutoAllotAsync(w.Id, ct) is not null) onsiteAllotted++;
        }
        catch (DbException ex)
        {
            log.LogError(ex, "Scheme sweep: the onsite allotments not retried");
        }

        try
        {
            var decided = await db.QuerySqlAsync<IdRow>(OnsiteDecidedSql, null, ct);
            var notifier = decided.Count > 0 ? SchemeServices.Get<SchemeNotifier>(services) : null;
            foreach (var d in decided)
            {
                var c = await SchemeCases.LoadAsync(db, d.Id, ct);
                await db.ExecuteSqlAsync(OnsiteNotifiedSql, new { d.Id }, ct);
                if (c is null) continue;
                if (c.Status == Qc)
                    await notifier!.NoticeAsync(c, c.OnsiteAgency, "Onsite verification submitted",
                        "The onsite assessor has submitted the onsite verification with a recommendation. Please do the QC.", ct);
                else if (c.Status == Rejected)
                    await notifier!.RejectedAsync(c, c.ReasonForRejection ?? "", ct);
            }
        }
        catch (DbException ex)
        {
            log.LogError(ex, "Scheme sweep: the onsite decisions not mailed");
        }

        if (rejected > 0 || held > 0 || onsiteAllotted > 0)
            log.LogInformation("Scheme sweep: {Rejected} rejected (correction late), {Held} put on hold, {Onsite} allotted for onsite verification", rejected, held, onsiteAllotted);
        else log.LogDebug("Scheme sweep: nothing to do");
        return new Result(rejected, held, onsiteAllotted);
    }

    /// <summary>The hold reason; it ends with the status to resume to ("(was Verifying)").</summary>
    public static string HoldText(string phase, string certNo, string previous) => $"Certificate {certNo} {phase} (was {previous})";

    /// <summary>The status an OnHold application resumes to (from <see cref="HoldText"/>), Submitted when not known.</summary>
    public static string ResumeStatus(string? holdReason) =>
        WasPattern().Match(holdReason ?? "") is { Success: true } m && m.Groups[1].Value is Submitted or WithAgency or WithAssessor or Verifying or Correction or Qc
            or OnsiteAllot or OnsiteWithAgency or OnsiteWithAssessor or OnsiteVisit
            ? m.Groups[1].Value : Submitted;

    [GeneratedRegex(@"\(was (\w+)\)\s*$")]
    private static partial Regex WasPattern();
}

/// <summary>
/// On the main portal: runs <see cref="SchemeSweep"/> three minutes after start, then every 15 minutes (Schemes:SweepMinutes;
/// 0 = off). Registered main-only in PortalSetup.
/// </summary>
public sealed class SchemeSweepService(IServiceScopeFactory scopes, IConfiguration config, ILogger<SchemeSweepService> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var minutes = config.GetValue("Schemes:SweepMinutes", 15);
        if (minutes <= 0) return;
        try
        {
            await Task.Delay(TimeSpan.FromMinutes(Math.Min(minutes, 3)), stoppingToken);
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    using var scope = scopes.CreateScope();
                    await SchemeServices.Get<SchemeSweep>(scope.ServiceProvider).RunAsync(stoppingToken);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    log.LogError(ex, "Scheme sweep failed");
                }
                await Task.Delay(TimeSpan.FromMinutes(minutes), stoppingToken);
            }
        }
        catch (OperationCanceledException) { /* stopping */ }
    }
}
