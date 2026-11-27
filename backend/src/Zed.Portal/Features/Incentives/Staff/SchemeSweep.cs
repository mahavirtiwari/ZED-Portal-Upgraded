using System.Data.Common;
using System.Text.RegularExpressions;
using Zed.Core.Data;
using static Zed.Portal.Features.Incentives.SchemeApplications;

namespace Zed.Portal.Features.Incentives.Staff;

/// <summary>
/// The scheme applications' timed rules (2026-11-20, approved), run by <see cref="SchemeSweepService"/>:
/// <list type="bullet">
/// <item>a correction round not answered by its CorrectionDueOn is rejected ("Correction not received in time"; mail to the unit);</item>
/// <item>an application in progress (Submitted … Qc) or approved but not paid yet (Approved, VerificationStatus 4: so NEFT cannot
/// pay it) whose claim certificate (SchemeCertNo of SchemeLevel in MsmeCertifications) is now SUSPENDED or WITHDRAWN
/// (<see cref="SchemeEligibility.HoldPhases"/>) goes OnHold with the reason; the Master Admin then resumes (back to where it was,
/// Approved included) or rejects it. 2026-11-20 (the product owner): an application of a scheme activated by Registration or
/// Handholding (SchemeLevel not a certification level) is held when the unit's highest certificate becomes SUSPENDED or WITHDRAWN.</item>
/// </list>
/// The other automatic rejection of the design — the last correction round answered and still not valid — happens when the assessor
/// chooses Correction with no round left (<see cref="SchemeAssessorController.LastRoundReason"/>).
/// </summary>
public sealed partial class SchemeSweep(ISqlExecutor db, IServiceProvider services, ILogger<SchemeSweep> log)
{
    public const string LateReason = "Correction not received in time";

    internal const string OverdueSql =
        "SELECT " + Columns + " FROM dbo.FinancialAssistance WHERE SchemeCode IS NOT NULL AND SchemeStatus = 'Correction' " +
        "AND CorrectionDueOn < @Today AND ISNULL(VerificationStatus, 0) <> 6;";

    /// <summary>Applications that a suspension or withdrawal holds: in progress, or approved and not paid (VerificationStatus 4, not 6).</summary>
    internal const string InProgressSql =
        "SELECT " + Columns + " FROM dbo.FinancialAssistance WHERE SchemeCode IS NOT NULL " +
        "AND SchemeStatus IN ('Submitted', 'WithAgency', 'WithAssessor', 'Verifying', 'Correction', 'Qc', " +
        "'OnsiteAllot', 'OnsiteWithAgency', 'OnsiteWithAssessor', 'OnsiteVisit', 'Approved') AND ISNULL(VerificationStatus, 0) <> 6;";

    /// <summary>The statuses an application is held from (and resumes to).</summary>
    public static readonly IReadOnlySet<string> Holdable = new HashSet<string>
        { Submitted, WithAgency, WithAssessor, Verifying, Correction, Qc, OnsiteAllot, OnsiteWithAgency, OnsiteWithAssessor, OnsiteVisit, Approved };

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

    /// <summary>
    /// Registration / Handholding schemes: every issued certificate of the units (as SchemeEligibility.CertifiedSql), to find each
    /// unit's highest one.
    /// </summary>
    internal const string UnitCertificatesSql =
        "SELECT ZedId, Certification, CAST(CASE WHEN CertificationStatus = 16 THEN SaCertificateNo ELSE DaCertificateNo END AS varchar(100)) AS CertNo, " +
        "CertificationPhase AS Phase, CertificationStatusDate AS CertifiedOn FROM dbo.MsmeCertifications WHERE ZedId IN @ZedIds " +
        "AND ((CertificationStatus = 6 AND DaCertificateNo IS NOT NULL) OR (CertificationStatus = 16 AND SaCertificateNo IS NOT NULL));";

    public sealed class CertRow
    {
        public string? ZedId { get; init; }
        public string? Certification { get; init; }
        public string? CertNo { get; init; }
        public string? Phase { get; init; }
        public DateTime? CertifiedOn { get; init; }
    }

    /// <summary>
    /// The unit's highest certificate that is current or held (expired, pending and rejected ones do not count), by the levels' order
    /// then the latest; null when it has none.
    /// </summary>
    public static CertRow? HighestCertificate(IEnumerable<CertRow> certificates) =>
        certificates
            .Where(c => LevelRegistry.Canonical(c.Certification) is not null && !string.IsNullOrWhiteSpace(c.CertNo)
                && (!SchemeEligibility.InactivePhases.Contains(c.Phase?.Trim() ?? "") || SchemeEligibility.HoldPhases.Contains(c.Phase?.Trim() ?? "")))
            .OrderByDescending(c => SchemeEligibility.Rank(c.Certification)).ThenByDescending(c => c.CertifiedOn)
            .FirstOrDefault();

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
                await using (await SchemeCaseLock.EnterAsync(db, ct))
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
            var byLevel = open.Where(r => LevelRegistry.Canonical(r.SchemeLevel) is not null && !string.IsNullOrWhiteSpace(r.ZedId)
                && !string.IsNullOrWhiteSpace(r.SchemeCertNo)).ToList();
            // Registration / Handholding schemes (SchemeLevel is not a certification level): the unit's highest certificate decides.
            var byUnit = open.Where(r => LevelRegistry.Canonical(r.SchemeLevel) is null && !string.IsNullOrWhiteSpace(r.ZedId)).ToList();
            var certs = new List<CertRow>();
            foreach (var chunk in byLevel.Select(r => r.ZedId!.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).Chunk(500))
                certs.AddRange(await db.QuerySqlAsync<CertRow>(HeldCertificatesSql, new { ZedIds = chunk }, ct));
            var all = new List<CertRow>();
            foreach (var chunk in byUnit.Select(r => r.ZedId!.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).Chunk(500))
                all.AddRange(await db.QuerySqlAsync<CertRow>(UnitCertificatesSql, new { ZedIds = chunk }, ct));

            var toHold = new List<(Row Row, CertRow Cert)>();
            foreach (var r in byLevel)
            {
                var cert = certs.FirstOrDefault(x => string.Equals(x.ZedId?.Trim(), r.ZedId!.Trim(), StringComparison.OrdinalIgnoreCase)
                    && string.Equals(LevelRegistry.Canonical(x.Certification), LevelRegistry.Canonical(r.SchemeLevel), StringComparison.OrdinalIgnoreCase)
                    && string.Equals(x.CertNo?.Trim(), r.SchemeCertNo?.Trim(), StringComparison.OrdinalIgnoreCase)
                    && SchemeEligibility.HoldPhases.Contains(x.Phase?.Trim() ?? ""));
                if (cert is not null) toHold.Add((r, cert));
            }
            foreach (var r in byUnit)
            {
                var top = HighestCertificate(all.Where(x => string.Equals(x.ZedId?.Trim(), r.ZedId!.Trim(), StringComparison.OrdinalIgnoreCase)));
                if (top is not null && SchemeEligibility.HoldPhases.Contains(top.Phase?.Trim() ?? "")) toHold.Add((r, top));
            }

            foreach (var (r, cert) in toHold)
            {
                await using (await SchemeCaseLock.EnterAsync(db, ct))
                {
                    var c = await SchemeCases.LoadAsync(db, r.Id, ct);
                    // An approved application is held only while not paid (the save also refuses VerificationStatus 6).
                    if (c is null || !Holdable.Contains(c.Status) || c.Row.VerificationStatus == 6) continue;
                    if (ResumedFor(c.HoldReason, cert.Phase!.Trim().ToUpperInvariant(), cert.CertNo!.Trim())) continue;
                    var previous = c.Status;
                    c.HoldReason = HoldText(cert.Phase!.Trim().ToUpperInvariant(), cert.CertNo!.Trim(), previous);
                    c.Status = OnHold;
                    if (!await SchemeCases.SaveAsync(db, c, ct)) continue;
                    held++;
                    await SchemeCases.HistoryAsync(db, log, c, $"Scheme application on hold: {c.HoldReason}", ct);
                    await SchemeServices.Get<SchemeNotifier>(services).OnHoldAsync(c, ct);
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
                    await notifier!.OnsiteSubmittedAsync(c, ct);
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

    /// <summary>
    /// 2026-11-20 (the user: "Hold; Master Admin decides"): a resume keeps "Resumed: {hold text}" in HoldReason, so the sweep does not
    /// hold the application again for the same certificate in the same phase (a later, different phase holds it again).
    /// </summary>
    public const string ResumedPrefix = "Resumed: ";

    public static bool ResumedFor(string? holdReason, string phase, string certNo) =>
        holdReason?.StartsWith($"{ResumedPrefix}Certificate {certNo} {phase} ", StringComparison.OrdinalIgnoreCase) == true;

    /// <summary>The status an OnHold application resumes to (from <see cref="HoldText"/>), Submitted when not known.</summary>
    public static string ResumeStatus(string? holdReason) =>
        WasPattern().Match(holdReason ?? "") is { Success: true } m && Holdable.Contains(m.Groups[1].Value) ? m.Groups[1].Value : Submitted;

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
