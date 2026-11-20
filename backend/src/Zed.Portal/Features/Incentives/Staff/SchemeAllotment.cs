using System.Data.Common;
using Zed.Core.Data;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.Users;

namespace Zed.Portal.Features.Incentives.Staff;

/// <summary>
/// Scheme applications go to a desktop agency by round robin (2026-11-20, approved: "verification like the assessment"): when the
/// unit submits (the scheme's Verification.AutoAllot), and again when the allotted agency rejects it with an "Auto" reason
/// (Admin → Rejection Reasons). Eligible agencies: active agencies (RoleId 2) ticked "Desktop verification" for the scheme
/// (Users.SchemeVerification contains "{CODE}:D"), serving the unit's plant state (AgencyUserStates; none = every state) and NIC
/// sector (UserNicSectors; none = every sector) as SP_ASSESSMENT_AGENCIES_TO_ALLOT, whose sector type fits the unit
/// (<see cref="UserSectorActivity.Serves"/>), and that have not returned the application (FinancialAssistance.RejectedAgencies).
/// The rotation takes them in Users.Id order after the agency of the scheme's last round-robin allotment (AllotmentType
/// 'RoundRobin' rows with the scheme's code, by AllotmentDate). With none, the application stays Submitted on the Master Admin's
/// list. Callers hold <see cref="SchemeCaseLock"/> for the *Locked methods.
/// </summary>
public sealed class SchemeAllotment(ISqlExecutor db, SchemeStore store, IServiceProvider services, ILogger<SchemeAllotment> log)
{
    public const string RoundRobin = "RoundRobin";
    public const string Manual = "Manual";

    internal const string CandidatesSql =
        "SELECT Id, UserId, UserName, SchemeVerification, CreatedBy FROM dbo.Users WHERE RoleId = @RoleId AND IsActive = 1 AND SchemeVerification IS NOT NULL " +
        // Phase 2: an onsite verification agency (migration 0106) never takes the desktop verification.
        "AND ISNULL(AgencyKind, '') <> 'SchemeOnsite';";

    internal const string UnitPlaceSql = "SELECT TOP 1 PStateName, TwoDigitActivity FROM dbo.Msme WHERE ZedId = @ZedId;";

    internal const string StatesSql = "SELECT UserId, States FROM dbo.AgencyUserStates WHERE RoleId = 2 AND UserId IN @Ids;";

    internal const string SectorsSql = "SELECT UserId, NicSectorCode FROM dbo.UserNicSectors WHERE RoleId = 2 AND UserId IN @Ids;";

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

    private sealed class PlaceRow
    {
        public string? PStateName { get; init; }
        public string? TwoDigitActivity { get; init; }
    }

    private sealed class StateRow
    {
        public string? UserId { get; init; }
        public string? States { get; init; }
    }

    private sealed class SectorRow
    {
        public string? UserId { get; init; }
        public string? NicSectorCode { get; init; }
    }

    private sealed class IdRow
    {
        public long Id { get; init; }
    }

    /// <param name="RejectedBefore">The agency returned this application before (the round robin skips it; the Master Admin may still choose it).</param>
    public sealed record AgencyOption(string UserId, string UserName, bool RejectedBefore);

    /// <summary>The agencies the application may go to (ticked for the scheme, the unit's state, sector and kind), in Users.Id order.</summary>
    public async Task<IReadOnlyList<AgencyOption>> EligibleAsync(string zedId, string schemeCode, IReadOnlySet<string> rejected, CancellationToken ct)
    {
        var ticked = (await db.QuerySqlAsync<CandidateRow>(CandidatesSql, new { RoleId = (int)UserRole.Agency }, ct))
            .Where(r => !string.IsNullOrWhiteSpace(r.UserId) && SchemeTicks.Has(r.SchemeVerification, schemeCode, SchemeTicks.Desktop))
            .GroupBy(r => r.UserId!.Trim(), StringComparer.OrdinalIgnoreCase).Select(g => g.First())
            .OrderBy(r => r.Id).ToList();
        if (ticked.Count == 0) return [];

        var ids = ticked.Select(r => r.UserId!.Trim()).ToArray();
        var place = (await db.QuerySqlAsync<PlaceRow>(UnitPlaceSql, new { ZedId = SchemeApplications.Ansi(zedId, 50) }, ct)).FirstOrDefault();
        var state = place?.PStateName?.Trim() ?? "";
        var sector = place?.TwoDigitActivity?.Trim() is { Length: >= 2 } t ? t[..2] : "";
        var states = (await db.QuerySqlAsync<StateRow>(StatesSql, new { Ids = ids }, ct))
            .Where(r => r.UserId is not null).ToLookup(r => r.UserId!.Trim(), r => r.States?.Trim() ?? "", StringComparer.OrdinalIgnoreCase);
        var sectors = (await db.QuerySqlAsync<SectorRow>(SectorsSql, new { Ids = ids }, ct))
            .Where(r => r.UserId is not null).ToLookup(r => r.UserId!.Trim(), r => r.NicSectorCode?.Trim() ?? "", StringComparer.OrdinalIgnoreCase);
        var category = await UserSectorActivity.UnitCategoryAsync(db, zedId, log, ct);
        var activities = await UserSectorActivity.ByRoleAsync(db, (int)UserRole.Agency, log, ct);

        return ticked.Where(r =>
            {
                var id = r.UserId!.Trim();
                var s = states[id].ToList();
                var n = sectors[id].ToList();
                return (s.Count == 0 || s.Contains(state, StringComparer.OrdinalIgnoreCase))
                    && (n.Count == 0 || n.Contains(sector, StringComparer.OrdinalIgnoreCase))
                    && UserSectorActivity.Serves(activities.GetValueOrDefault(id), category);
            })
            .Select(r => new AgencyOption(r.UserId!.Trim(), r.UserName?.Trim() ?? r.UserId!.Trim(), rejected.Contains(r.UserId!.Trim())))
            .ToList();
    }

    /// <summary>The next agency of the rotation for the application (never one in <paramref name="skip"/>), or null.</summary>
    internal async Task<AgencyOption?> NextAsync(SchemeCase c, IReadOnlySet<string> skip, CancellationToken ct)
    {
        var eligible = (await EligibleAsync(c.ZedId, c.Code, skip, ct)).Where(a => !a.RejectedBefore).ToList();
        if (eligible.Count == 0) return null;
        var ids = (await db.QuerySqlAsync<CandidateRow>(CandidatesSql, new { RoleId = (int)UserRole.Agency }, ct))
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
        using (await SchemeCaseLock.EnterAsync(ct))
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
