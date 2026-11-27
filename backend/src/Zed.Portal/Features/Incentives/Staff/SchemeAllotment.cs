using System.Data.Common;
using Zed.Core.Data;
using Zed.Portal.Features.Incentives.Agencies;

namespace Zed.Portal.Features.Incentives.Staff;

/// <summary>
/// Scheme applications go to a desktop verification agency by round robin (2026-11-20, approved: "verification like the assessment"):
/// when the unit submits (the scheme's Verification.AutoAllot), and again when the allotted agency rejects it with an "Auto" reason
/// (Admin → Rejection Reasons) while AutoAllot is on. 2026-11-20 (the product owner): desktop and onsite are done by separate agencies
/// added by the Master Admin with their states and districts, and the allocation is by state and district; the normal assessment
/// agencies are no longer used. Eligible agencies: active desktop verification agencies (RoleId 2, Users.AgencyKind
/// <see cref="IncentiveAgencies.DesktopKind"/>, migration 0107) ticked "Desktop verification" for the scheme (Users.SchemeVerification
/// "{CODE}:D") with an AgencyUserStates row for the unit's plant state whose Districts list the unit's plant district (NULL / empty =
/// the whole state; <see cref="IncentiveAgencies.CoversDistrict"/>), no NIC-sector rule, and that have not returned the application
/// (FinancialAssistance.RejectedAgencies). The rotation takes them in Users.Id order after the agency of the scheme's last round-robin
/// allotment (AllotmentType 'RoundRobin' rows with the scheme's code, by AllotmentDate). With none, the application stays Submitted on
/// the Master Admin's list (the manual allot list has the same eligibility). Callers hold <see cref="SchemeCaseLock"/> for the *Locked methods.
/// </summary>
public sealed class SchemeAllotment(ISqlExecutor db, SchemeStore store, IServiceProvider services, ILogger<SchemeAllotment> log)
{
    public const string RoundRobin = "RoundRobin";
    public const string Manual = "Manual";

    /// <summary>The desktop verification agencies (never an assessment agency nor an onsite agency).</summary>
    internal const string CandidatesSql =
        "SELECT Id, UserId, UserName, SchemeVerification, CreatedBy FROM dbo.Users WHERE RoleId = 2 AND IsActive = 1 AND AgencyKind = 'SchemeDesktop' " +
        "AND SchemeVerification IS NOT NULL;";

    internal const string LastSql =
        "SELECT TOP (1) U.Id FROM dbo.FinancialAssistance F JOIN dbo.Users U ON U.UserId = F.CertificationBodyUserId AND U.RoleId = 2 " +
        "WHERE F.SchemeCode = @SchemeCode AND F.AllotmentType = 'RoundRobin' ORDER BY F.AllotmentDate DESC, F.Id DESC;";

    public sealed class CandidateRow
    {
        public long Id { get; init; }
        public string? UserId { get; init; }
        public string? UserName { get; init; }
        public string? SchemeVerification { get; init; }
        public string? CreatedBy { get; init; }
    }

    private sealed class IdRow
    {
        public long Id { get; init; }
    }

    /// <param name="RejectedBefore">The agency returned this application before (the round robin skips it; the Master Admin may still choose it).</param>
    public sealed record AgencyOption(string UserId, string UserName, bool RejectedBefore);

    /// <summary>The desktop agencies the application may go to (ticked for the scheme, the unit's state and district), in Users.Id order.</summary>
    public async Task<IReadOnlyList<AgencyOption>> EligibleAsync(string zedId, string schemeCode, IReadOnlySet<string> rejected, CancellationToken ct)
    {
        var candidates = await db.QuerySqlAsync<CandidateRow>(CandidatesSql, null, ct);
        return (await IncentiveAgencies.CoveringAsync(db, candidates, SchemeTicks.Desktop, zedId, schemeCode, ct))
            .Select(r => new AgencyOption(r.UserId!.Trim(), r.UserName?.Trim() ?? r.UserId!.Trim(), rejected.Contains(r.UserId!.Trim())))
            .ToList();
    }

    /// <summary>The next agency of the rotation for the application (never one in <paramref name="skip"/>), or null.</summary>
    internal async Task<AgencyOption?> NextAsync(SchemeCase c, IReadOnlySet<string> skip, CancellationToken ct)
    {
        var eligible = (await EligibleAsync(c.ZedId, c.Code, skip, ct)).Where(a => !a.RejectedBefore).ToList();
        if (eligible.Count == 0) return null;
        var ids = (await db.QuerySqlAsync<CandidateRow>(CandidatesSql, null, ct))
            .Where(r => r.UserId is not null).GroupBy(r => r.UserId!.Trim(), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First().Id, StringComparer.OrdinalIgnoreCase);
        long? lastId = null;
        try
        {
            lastId = (await db.QuerySqlAsync<IdRow>(LastSql, new { SchemeCode = SchemeApplications.Ansi(c.Code, 40) }, ct)).FirstOrDefault()?.Id;
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Scheme {Code}: the last round-robin allotment not read; starting from the first agency", c.Code);
        }
        return eligible.FirstOrDefault(a => lastId is null || ids.GetValueOrDefault(a.UserId) > lastId) ?? eligible[0];
    }

    /// <summary>
    /// Allots a Submitted application without an agency by round robin (the scheme's AutoAllot is the caller's check); returns the
    /// agency, or null when none is eligible (it stays on the Master Admin's list).
    /// </summary>
    public async Task<string?> AutoAllotAsync(int id, CancellationToken ct)
    {
        await using (await SchemeCaseLock.EnterAsync(db, ct))
        {
            var c = await SchemeCases.LoadAsync(db, id, ct);
            if (c is null || c.Status != SchemeApplications.Submitted || c.Agency is not null) return null;
            return await AllotLockedAsync(c, ct);
        }
    }

    /// <summary>Round robin for a case the caller loaded (Submitted, no agency); saves it. Caller holds <see cref="SchemeCaseLock"/>.</summary>
    internal async Task<string?> AllotLockedAsync(SchemeCase c, CancellationToken ct)
    {
        try
        {
            var next = await NextAsync(c, c.Rejected, ct);
            if (next is null)
            {
                log.LogWarning("Scheme application {Id} ({Code}): no eligible agency for the round robin; it waits for the Master Admin", c.Id, c.Code);
                return null;
            }
            c.Agency = next.UserId;
            c.Assessor = null;
            c.AssessorAcceptedOn = null;
            c.AllotmentType = RoundRobin;
            c.AllotmentDate = DateTime.Now;
            c.Status = SchemeApplications.WithAgency;
            if (!await SchemeCases.SaveAsync(db, c, ct)) return null;
            await SchemeCases.HistoryAsync(db, log, c, $"Scheme application allotted to agency {next.UserId} by round robin", ct);
            await SchemeServices.Get<SchemeNotifier>(services).AllottedToAgencyAsync(c, ct);
            return next.UserId;
        }
        catch (DbException ex)
        {
            log.LogError(ex, "Scheme application {Id}: round-robin allotment failed; it waits for the Master Admin", c.Id);
            return null;
        }
    }

    /// <summary>Whether the scheme allots automatically (unknown scheme: yes, as the default definition).</summary>
    public async Task<bool> AutoAllotOnAsync(string code, CancellationToken ct) => (await store.FindAsync(code, ct))?.Verification.AutoAllot ?? true;
}
