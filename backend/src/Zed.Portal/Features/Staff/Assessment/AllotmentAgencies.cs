using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Person = Zed.Portal.Features.Staff.Assessment.AssessmentAllotmentController.Person;

namespace Zed.Portal.Features.Staff.Assessment;

/// <summary>
/// The agencies a unit's level may be allotted to: the Master Admin's Allot pop-up (<see cref="AssessmentAllotmentController"/>)
/// and the automatic re-allotment after an agency's rejection (<see cref="AgencyRejections"/>, 2026-11-19) offer the same ones:
/// SP_ASSESSMENT_AGENCIES_TO_ALLOT (active, the unit's states and NIC sectors), the level's verification, the unit's kind
/// (Manufacturing / Services), not disabled for the level (main), on Surveillance never the certifying agency, with each
/// agency's purchase order state (a used-up PO stops its allotment).
/// </summary>
internal static class AllotmentAgencies
{
    /// <summary>The agencies of main's records of this level of the unit: the agency that certified it (2026-11-19).</summary>
    internal const string CertifyingAgenciesSql =
        "SELECT DISTINCT LTRIM(RTRIM(CertificationBodyUserId)) AS UserId FROM ZEDCS_V2_LIVE.dbo.MsmeCertifications " +
        "WHERE ZedId = @ZedId AND Certification = @Certification AND LTRIM(RTRIM(ISNULL(CertificationBodyUserId, ''))) <> '';";

    private sealed record AgencyIdRow(string? UserId);

    private static async Task<HashSet<string>> CertifyingAgenciesAsync(ISqlExecutor db, string zedId, string level, CancellationToken ct) =>
        (await db.QuerySqlAsync<AgencyIdRow>(CertifyingAgenciesSql, new { ZedId = zedId, Certification = level }, ct))
            .Select(r => r.UserId?.Trim() ?? "").Where(u => u.Length > 0).ToHashSet(StringComparer.OrdinalIgnoreCase);

    public static async Task<IReadOnlyList<Person>> ForAsync(ISqlExecutor db, PortalHost host, string zedId, string level, ILogger log, CancellationToken ct)
    {
        var rows = (await db.QueryProcMultipleAsync("SP_ASSESSMENT_AGENCIES_TO_ALLOT", new { ZedId = zedId }, ct))[0];
        // Bronze surveillance goes only to agencies allowed for it (the old Allot page filtered on AllowBronzeSurveillance).
        // 2026-11-08: a V4 level assessed at the desktop only goes to desktop-verification agencies, as Bronze.
        var column = level == "Bronze" ? (host.System == PortalSystem.Surveillance ? "AllowBronzeSurveillance" : "DesktopVerification")
            : LevelRegistry.IsDesktop(level) ? "DesktopVerification" : "SiteVerification";
        // V4: only agencies that assess the unit's kind (Manufacturing / Services; not set = no limit).
        var category = await Users.UserSectorActivity.UnitCategoryAsync(db, zedId, log, ct);
        var activities = await Users.UserSectorActivity.ByRoleAsync(db, (int)UserRole.Agency, log, ct);
        // V4 (2026-11-08): not the agencies the Master Admin disabled this level for (Silver, Gold, ZED-X; Bronze is in the procedure).
        var disabled = host.System == PortalSystem.Main ? await Users.AgencyLevels.DisabledAsync(db, level, log, ct)
            : new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        // 2026-11-19 (the user): a surveillance round never goes to the agency that did the unit's certification assessment
        // (the automatic allotment leaves it out too: ZED_SURVEILLANCE SP_V4_SURVEILLANCE_NEXT_AGENCY, migration 0102).
        if (host.System == PortalSystem.Surveillance)
            disabled.UnionWith(await CertifyingAgenciesAsync(db, zedId, level, ct));
        // 2026-11-18 (expenditure monitoring): each agency's PO for the level; a used-up PO stops its allotment (main, Consultancy).
        var po = (await Expenditure.PoLimits.StatusAsync(db, host, null, level, log, ct))
            .ToDictionary(s => s.PartyId, StringComparer.OrdinalIgnoreCase);
        var levelName = LevelRegistry.NameOf(level);
        return rows.Where(r => AllotmentLists.Flag(r, column) && !disabled.Contains(r.Text("UserId").Trim()))
            .Select(r =>
            {
                var id = r.Text("UserId");
                var s = po.GetValueOrDefault(id.Trim());
                return new Person(id, r.Text("UserName"), activities.GetValueOrDefault(id), PoStopped: s?.Stopped == true,
                    PoMessage: s?.Stopped == true ? Expenditure.PoLimits.StoppedMessage(s, r.Text("UserName"), levelName) : null,
                    PoLeft: s?.HasPo == true ? s.Left : null);
            })
            .Where(p => Users.UserSectorActivity.Serves(p.SectorActivity, category))
            .ToList();
    }

    /// <summary>
    /// The allotment itself, once the agency is known to be allowed: SP_ASSESSMENT_ALLOT_TO_AGENCY (its MsmeHistory line), on main
    /// the desktop skip of Remote only / Onsite only levels (migration 0074), and the allotment mail. Shared by the Master Admin's
    /// Allot (<see cref="AssessmentAllotmentController"/>) and the handholding milestone 1 allotment after the payment
    /// (Payments.Consultancy.HandholdingAutoAllotment, 2026-11-21), so both leave the same statuses, history and mail. A failure of
    /// the procedure throws (nothing was allotted); a later step that fails is logged, the unit stays allotted.
    /// </summary>
    internal static async Task AllotAsync(ISqlExecutor db, PortalHost host, DesktopAssessmentEmails emails, string zedId, string level, string agencyUserId,
        ILogger log, CancellationToken ct)
    {
        await db.ExecuteProcAsync("SP_ASSESSMENT_ALLOT_TO_AGENCY",
            new { ZedId = zedId, Certification = level, CertificationBodyUserId = agencyUserId }, ct);
        try
        {
            // 2026-11-14: Remote only / Onsite only levels go straight to the agency's SA allotment (migration 0074).
            if (host.System == PortalSystem.Main) await DesktopSkip.TryAsync(db, zedId, level, log, ct);
            await emails.SendAsync(DesktopAssessmentEmails.Kind.AllottedToAgency, zedId, level, null, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // The unit is allotted: a later step that fails is logged, not reported as a refusal.
            log.LogError(ex, "After allotting {ZedId} {Certification}: the desktop skip or the mail failed", zedId, level);
        }
    }
}
