using System.Data.Common;
using Zed.Core.Data;
using Zed.Core.Http;

namespace Zed.Portal.Features.Staff.Assessment;

/// <summary>
/// 2026-11-19 (the user, approved design): an assessment agency rejects a unit allotted to it (desktop allotment:
/// <see cref="DesktopAllotmentController"/>; site allotment: SiteAssessment.SiteAssessmentController) by picking a reason
/// the Admin lists (<see cref="RejectionReasons"/>) with optional remarks. After the legacy reject procedure has run, this
/// records the reason, the remarks and the agency on the unit's level row (MsmeCertifications.RejectionReasonId,
/// RejectionRemarks, RejectedAgencies; migration 0103) and, when the reason says so, re-allots the unit at once to another
/// agency by round robin: among the agencies the Master Admin could allot it to (<see cref="AllotmentAgencies"/>: active, the
/// unit's states and sectors, the level's verification, not disabled for the level, purchase order not used up, on Surveillance
/// never the certifying agency), never one that rejected the unit, after the agency of the last automatic re-allotment of the
/// level (AgencyAllotmentHistory, AllotType 'Reallot') in Users.Id order. The re-allotment is the Master Admin's allotment
/// (SP_ASSESSMENT_ALLOT_TO_AGENCY, the desktop skip, the allotment mail). With no such agency, or a "Master Admin allots"
/// reason, or any failure, the unit waits on the Master Admin's Allot list as before.
/// </summary>
public sealed class AgencyRejections(ISqlExecutor db, PortalHost host, IPortalSettings settings, IServiceProvider services, ILogger<AgencyRejections> log)
{
    public const string ReallotType = "Reallot";

    /// <param name="Reallotted">True when the unit went to <paramref name="Agency"/>.</param>
    public sealed record Outcome(bool Reallotted, string? Agency, string? AgencyName);

    internal const string RecordSql =
        "UPDATE dbo.MsmeCertifications SET RejectionReasonId = @ReasonId, RejectionRemarks = @Remarks, " +
        "RejectedAgencies = CASE WHEN ISNULL(RejectedAgencies, '') = '' THEN @Agency " +
        "WHEN ',' + RejectedAgencies + ',' LIKE '%,' + @Agency + ',%' THEN RejectedAgencies " +
        "ELSE LEFT(RejectedAgencies + ',' + @Agency, 2000) END " +
        "WHERE ZedId = @ZedId AND Certification = @Certification;";

    internal const string RejectedSql =
        "SELECT TOP 1 RejectedAgencies FROM dbo.MsmeCertifications WHERE ZedId = @ZedId AND Certification = @Certification ORDER BY Id DESC;";

    internal const string AgencyIdsSql = "SELECT UserId, Id FROM dbo.Users WHERE RoleId = 2 AND UserId IN @Ids;";

    internal const string LastSql =
        "SELECT TOP 1 AgencyId FROM dbo.AgencyAllotmentHistory WHERE AllotType = 'Reallot' AND CertificationType = @Certification ORDER BY Id DESC;";

    /// <summary>Main's SP_ASSESSMENT_ALLOT_TO_AGENCY writes a 'Manual' history row; Surveillance's writes none.</summary>
    internal const string MarkSql = """
        ;WITH h AS (SELECT TOP 1 * FROM dbo.AgencyAllotmentHistory WHERE ZedId = @ZedId AND CertificationType = @Certification
                    AND AgencyId = @Agency AND AllotType = 'Manual' AND CreatedDate >= DATEADD(MINUTE, -5, GETDATE()) ORDER BY Id DESC)
        UPDATE h SET AllotType = 'Reallot', Descrip = @Descrip;
        IF @@ROWCOUNT = 0
            INSERT INTO dbo.AgencyAllotmentHistory (AgencyId, ZedId, CertificationType, AllotType, Descrip, CreatedDate)
            VALUES (@Agency, @ZedId, @Certification, 'Reallot', @Descrip, GETDATE());
        """;

    private sealed class IdRow
    {
        public string? UserId { get; init; }
        public long Id { get; init; }
    }

    private sealed record TextRow(string? RejectedAgencies);

    private sealed record LastRow(string? AgencyId);

    public Task<IReadOnlyList<RejectionReason>> ReasonsAsync(CancellationToken ct) => RejectionReasons.LoadAsync(settings, ct);

    /// <summary>After the legacy reject procedure: records the rejection and re-allots when the reason says so.</summary>
    public async Task<Outcome> AfterRejectAsync(string zedId, string level, string agency, RejectionReason reason, string? remarks, CancellationToken ct)
    {
        var rejected = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { agency.Trim() };
        try
        {
            await db.ExecuteSqlAsync(RecordSql, new
            {
                ReasonId = AssessmentInput.Ansi(reason.Id, 40), Remarks = remarks, Agency = AssessmentInput.Ansi(agency.Trim(), 100),
                ZedId = AssessmentInput.Ansi(zedId, 50), Certification = AssessmentInput.Ansi(level, 50),
            }, ct);
            var saved = (await db.QuerySqlAsync<TextRow>(RejectedSql, new { ZedId = AssessmentInput.Ansi(zedId, 50), Certification = AssessmentInput.Ansi(level, 50) }, ct))
                .FirstOrDefault()?.RejectedAgencies ?? "";
            foreach (var a in saved.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)) rejected.Add(a);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Rejection of {ZedId} {Level} by {Agency}: reason not recorded (is migration 0103 applied?)", zedId, level, agency);
        }
        if (!reason.AutoReallot) return new Outcome(false, null, null);

        try
        {
            return await ReallotAsync(zedId, level, rejected, reason, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "Automatic re-allotment of {ZedId} {Level} failed; it waits for the Master Admin", zedId, level);
            return new Outcome(false, null, null);
        }
    }

    private async Task<Outcome> ReallotAsync(string zedId, string level, HashSet<string> rejected, RejectionReason reason, CancellationToken ct)
    {
        var offered = (await AllotmentAgencies.ForAsync(db, host, zedId, level, log, ct))
            .Where(p => !p.PoStopped && !rejected.Contains(p.UserId.Trim()))
            .GroupBy(p => p.UserId.Trim(), StringComparer.OrdinalIgnoreCase).Select(g => g.First()).ToList();
        if (offered.Count == 0)
        {
            log.LogWarning("{ZedId} {Level}: no other agency for the automatic re-allotment; it waits for the Master Admin", zedId, level);
            return new Outcome(false, null, null);
        }
        var ordered = (await db.QuerySqlAsync<IdRow>(AgencyIdsSql, new { Ids = offered.Select(p => p.UserId.Trim()).ToArray() }, ct))
            .Where(r => r.UserId is not null).OrderBy(r => r.Id).ToList();
        if (ordered.Count == 0) return new Outcome(false, null, null);

        long? lastId = null;
        var last = (await db.QuerySqlAsync<LastRow>(LastSql, new { Certification = AssessmentInput.Ansi(level, 50) }, ct)).FirstOrDefault()?.AgencyId?.Trim();
        if (!string.IsNullOrEmpty(last))
            lastId = (await db.QuerySqlAsync<IdRow>(AgencyIdsSql, new { Ids = new[] { last } }, ct)).FirstOrDefault()?.Id;
        var next = (ordered.FirstOrDefault(r => lastId is null || r.Id > lastId) ?? ordered[0]).UserId!.Trim();
        var name = offered.First(p => string.Equals(p.UserId.Trim(), next, StringComparison.OrdinalIgnoreCase)).UserName;

        await db.ExecuteProcAsync("SP_ASSESSMENT_ALLOT_TO_AGENCY", new { ZedId = zedId, Certification = level, CertificationBodyUserId = next }, ct);
        log.LogInformation("{ZedId} {Level} re-allotted automatically to {Agency} after a rejection ({Reason})", zedId, level, next, reason.Id);
        try
        {
            await db.ExecuteSqlAsync(MarkSql, new
            {
                ZedId = AssessmentInput.Ansi(zedId, 50), Certification = AssessmentInput.Ansi(level, 50), Agency = AssessmentInput.Ansi(next, 50),
                Descrip = AssessmentInput.Ansi(RejectionReasons.LegacyText(reason, null, 2000), 2000),
            }, ct);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "{ZedId} {Level}: the re-allotment's history row not written", zedId, level);
        }
        try
        {
            // As the Master Admin's allotment: Remote only / Onsite only levels go straight to the agency's SA allotment (main).
            if (host.System == PortalSystem.Main) await DesktopSkip.TryAsync(db, zedId, level, log, ct);
            await DesktopAssessmentEmails.Create(services).SendAsync(DesktopAssessmentEmails.Kind.AllottedToAgency, zedId, level, null, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "After re-allotting {ZedId} {Level}: the desktop skip or the mail failed", zedId, level);
        }
        return new Outcome(true, next, name);
    }

    /// <summary>The agency's answer after its rejection.</summary>
    public static string Message(Outcome o) => o.Reallotted
        ? "Unit rejected. It has been allotted to another agency."
        : "Unit rejected. It goes back to the ZED team for allotment.";
}
