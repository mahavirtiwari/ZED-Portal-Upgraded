using System.Data.Common;
using Zed.Core.Data;
using Zed.Portal.Features.Incentives.Agencies;
using Zed.Portal.Features.Incentives.Staff;
using static Zed.Portal.Features.Incentives.SchemeApplications;

namespace Zed.Portal.Features.Incentives.Onsite;

/// <summary>
/// 2026-11-20 (the user, phase 2): the onsite round robin of the Desktop + Onsite flow. After the desktop assessor's Recommend the
/// application is <see cref="OnsiteAllot"/>; it goes to an onsite agency: active (RoleId 2, <see cref="OnsiteAgencyKind"/>),
/// ticked "Onsite verification" for the scheme (Users.SchemeVerification "{CODE}:O"), with an AgencyUserStates row for the unit's
/// plant state (Msme.PStateName) whose Districts list the unit's plant district (Msme.PLgDistrictCode / PDistrictName; NULL or empty
/// = the whole state), and that has not rejected the application (FinancialAssistance.OnsiteRejectedAgencies). The rotation takes
/// them in Users.Id order after the agency of the scheme's last onsite round-robin allotment (dbo.AgencyAllotmentHistory, AllotType
/// <see cref="HistoryType"/>, CertificationType = the scheme code). With none, the application stays <see cref="OnsiteAllot"/> for the
/// Master Admin (and <see cref="SchemeSweep"/> tries again). Callers hold <see cref="SchemeCaseLock"/> for the *Locked methods.
/// Normal assessments never come here.
/// </summary>
public sealed class OnsiteAllotment(ISqlExecutor db, SchemeStore store, IServiceProvider services, ILogger<OnsiteAllotment> log)
{
    public const string RoundRobin = "RoundRobin";
    public const string Manual = "Manual";
    /// <summary>OnsiteAllotmentType while the application waits for the Master Admin (an agency rejected it with a "Master Admin" reason): the sweep leaves it.</summary>
    public const string WaitsForMasterAdmin = "MasterAdmin";
    /// <summary>AgencyAllotmentHistory.AllotType of an onsite allotment.</summary>
    public const string HistoryType = "SchemeOnsite";

    internal const string CandidatesSql =
        "SELECT Id, UserId, UserName, SchemeVerification, CreatedBy FROM dbo.Users WHERE RoleId = 2 AND IsActive = 1 AND AgencyKind = 'SchemeOnsite' AND SchemeVerification IS NOT NULL;";

    internal const string UnitPlaceSql = IncentiveAgencies.UnitPlaceSql;

    internal const string StatesSql = IncentiveAgencies.StatesSql;

    internal const string LastSql =
        "SELECT TOP 1 AgencyId FROM dbo.AgencyAllotmentHistory WHERE AllotType = 'SchemeOnsite' AND CertificationType = @SchemeCode ORDER BY Id DESC;";

    internal const string HistorySql =
        "INSERT INTO dbo.AgencyAllotmentHistory (AgencyId, ZedId, CertificationType, AllotType, Descrip, CreatedDate) VALUES (@AgencyId, @ZedId, @SchemeCode, 'SchemeOnsite', @Descrip, GETDATE());";

    private sealed class LastRow
    {
        public string? AgencyId { get; init; }
    }

    /// <summary>The onsite agencies the application may go to (serving the scheme, the unit's state and district), in Users.Id order.</summary>
    public async Task<IReadOnlyList<SchemeAllotment.AgencyOption>> EligibleAsync(string zedId, string schemeCode, IReadOnlySet<string> rejected, CancellationToken ct) =>
        (await EligibleRowsAsync(zedId, schemeCode, ct))
            .Select(r => new SchemeAllotment.AgencyOption(r.UserId!.Trim(), r.UserName?.Trim() ?? r.UserId!.Trim(), rejected.Contains(r.UserId!.Trim())))
            .ToList();

    private async Task<List<SchemeAllotment.CandidateRow>> EligibleRowsAsync(string zedId, string schemeCode, CancellationToken ct) =>
        await IncentiveAgencies.CoveringAsync(db, await db.QuerySqlAsync<SchemeAllotment.CandidateRow>(CandidatesSql, null, ct), SchemeTicks.Onsite,
            zedId, schemeCode, ct);

    /// <summary>The next onsite agency of the rotation for the application (never one that rejected it), or null.</summary>
    internal async Task<SchemeAllotment.AgencyOption?> NextAsync(SchemeCase c, CancellationToken ct)
    {
        var skip = c.OnsiteRejected;
        var eligible = (await EligibleRowsAsync(c.ZedId, c.Code, ct)).Where(r => !skip.Contains(r.UserId!.Trim())).ToList();
        if (eligible.Count == 0) return null;
        long? lastId = null;
        try
        {
            var last = (await db.QuerySqlAsync<LastRow>(LastSql, new { SchemeCode = Ansi(c.Code, 50) }, ct)).FirstOrDefault()?.AgencyId?.Trim();
            if (!string.IsNullOrEmpty(last))
            {
                var all = await db.QuerySqlAsync<SchemeAllotment.CandidateRow>(CandidatesSql, null, ct);
                lastId = all.FirstOrDefault(r => string.Equals(r.UserId?.Trim(), last, StringComparison.OrdinalIgnoreCase))?.Id;
            }
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Scheme {Code}: the last onsite allotment not read; starting from the first onsite agency", c.Code);
        }
        var next = eligible.FirstOrDefault(r => lastId is null || r.Id > lastId) ?? eligible[0];
        return new SchemeAllotment.AgencyOption(next.UserId!.Trim(), next.UserName?.Trim() ?? next.UserId!.Trim(), false);
    }

    /// <summary>Round robin for an <see cref="OnsiteAllot"/> application (no onsite agency); returns the agency or null.</summary>
    public async Task<string?> AutoAllotAsync(int id, CancellationToken ct)
    {
        await using (await SchemeCaseLock.EnterAsync(db, ct))
        {
            var c = await SchemeCases.LoadAsync(db, id, ct);
            if (c is null || c.Status != OnsiteAllot || c.OnsiteAgency is not null) return null;
            return await AllotLockedAsync(c, ct);
        }
    }

    /// <summary>
    /// Round robin for a case the caller loaded (<see cref="OnsiteAllot"/>, no onsite agency); saves it. With the scheme's AutoAllot
    /// off, it waits for the Master Admin. Caller holds <see cref="SchemeCaseLock"/>.
    /// </summary>
    internal async Task<string?> AllotLockedAsync(SchemeCase c, CancellationToken ct)
    {
        try
        {
            if (c.Status != OnsiteAllot || c.OnsiteAgency is not null) return null;
            if ((await store.FindAsync(c.Code, ct))?.Verification.AutoAllot == false) return null;
            var next = await NextAsync(c, ct);
            if (next is null)
            {
                log.LogWarning("Scheme application {Id} ({Code}): no onsite agency for the unit's state and district; it waits for the Master Admin", c.Id, c.Code);
                return null;
            }
            if (!await SaveAllotmentAsync(c, next.UserId, RoundRobin, ct)) return null;
            await SchemeCases.HistoryAsync(db, log, c, $"Scheme application allotted for onsite verification to agency {next.UserId} by round robin", ct);
            return next.UserId;
        }
        catch (DbException ex)
        {
            log.LogError(ex, "Scheme application {Id}: onsite round robin failed; it waits for the Master Admin", c.Id);
            return null;
        }
    }

    /// <summary>Saves the onsite agency (round robin or the Master Admin), writes the allotment history and mails the agency.</summary>
    internal async Task<bool> SaveAllotmentAsync(SchemeCase c, string agency, string type, CancellationToken ct)
    {
        c.OnsiteAgency = agency;
        c.OnsiteAssessor = null;
        c.OnsiteAllotmentType = type;
        c.OnsiteAllotmentDate = DateTime.Now;
        c.Status = OnsiteWithAgency;
        if (!await SchemeCases.SaveAsync(db, c, ct)) return false;
        try
        {
            await db.ExecuteSqlAsync(HistorySql, new
            {
                AgencyId = Ansi(agency, 50), ZedId = Ansi(c.ZedId, 50), SchemeCode = Ansi(c.Code, 50),
                Descrip = Ansi($"Scheme application {c.Id}: onsite verification ({type})", 2000),
            }, ct);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Scheme application {Id}: the onsite allotment history row not written", c.Id);
        }
        await SchemeServices.Get<SchemeNotifier>(services).OnsiteAllottedToAgencyAsync(c, ct);
        return true;
    }
}
