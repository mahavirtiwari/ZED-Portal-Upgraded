using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.Users;

namespace Zed.Portal.Features.Staff.Assessment;

/// <summary>
/// Allocation of assessments to agencies by the master admin. Port of the AssessmentController actions used by
/// Views/Assessment/Allot: GetList (SP_ASSESSMENT_ALLOT_LIST), GetCb (SP_ASSESSMENT_AGENCIES_TO_ALLOT) and AllotCb
/// (SP_ASSESSMENT_ALLOT_TO_AGENCY). The agency and assessor work lists are in <see cref="DesktopAllotmentController"/>.
/// <para>
/// The legacy POST actions had no authorisation and took the ZED ID and agency from the browser, so anyone could
/// allot any MSME to anyone. Here the record must be in the master admin's allot list and the agency in the list
/// the procedure offers for it.
/// </para>
/// <para>Per system (same procedures and parameters, different rows and mails):</para>
/// <list type="bullet">
/// <item>Main: records at status 2/3; Bronze goes to desktop-verification agencies, Silver/Gold to site-verification agencies.</item>
/// <item>Consultancy ("Allot Consultancy"): the paid milestone (status 6, NcCount = milestone) goes to a Consultant
/// Organisation with site verification; mail "Allocation of MSME for Handholding Support (Milestone n)".</item>
/// <item>Surveillance ("Allot Surveillance"): Bronze at status 1 goes to agencies allowed for Bronze surveillance
/// (AllowBronzeSurveillance, the procedure also matches their preferred state), Silver/Gold at status 8 to site-verification
/// agencies; rows add SurveillanceNo and AutoAllocationDate; mail subjects say Surveillance.</item>
/// </list>
/// </summary>
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
[Route("api/staff/assessment")]
public sealed class AssessmentAllotmentController(ISqlExecutor db, PortalHost host, ILogger<AssessmentAllotmentController> log) : StaffApiController
{
    public sealed record ListResponse(IReadOnlyList<Dictionary<string, object?>> Rows);

    /// <param name="SectorActivity">V4: Manufacturing, Services or Both (null: not set, no limit).</param>
    /// <param name="Assessments">2026-11-14: the levels and modes the assessor may do (<see cref="Users.AssessorScope"/>).</param>
    /// <param name="PoStopped">2026-11-18 (expenditure monitoring): the agency's (organisation's) purchase order for this level is used
    /// up, so it cannot be allotted this level (<paramref name="PoMessage"/> says why); <paramref name="PoLeft"/>: its PO cases left
    /// (null: no PO for the level, no limit).</param>
    public sealed record Person(string UserId, string UserName, string? SectorActivity = null, IReadOnlyList<Users.AssessorScope.Item>? Assessments = null,
        bool PoStopped = false, string? PoMessage = null, int? PoLeft = null);

    /// <summary>Allot screen (Assessment/Allot): records waiting for an agency or re-allotment.</summary>
    [HttpGet("allot")]
    [StaffRoles(UserRole.MasterAdmin)]
    public async Task<ActionResult<ListResponse>> AllotList(
        string? state, string? certification, string? size, string? gender, string? allotmentType, CancellationToken ct)
    {
        if (!AllotmentLists.Filters(state, certification, size, gender, out var f)) return this.Problem400("Invalid filter.");
        if (!AssessmentInput.Filter(allotmentType, ["ALLOT", "REALLOT"], out var type)) return this.Problem400("Invalid filter.");
        var sets = await AllotmentLists.List(db, UserId, RoleId, type, null, f, ct);
        string[] extra = host.System switch
        {
            PortalSystem.Consultancy => ["TimeDuration", "NcCount"],
            PortalSystem.Surveillance => ["TimeDuration", "SurveillanceNo", "AutoAllocationDate"],
            _ => ["TimeDuration", "UdyamStatus"],
        };
        // 2026-11-17 (approved redesign): the unit's district, state and size (the procedure's Msme columns) for the rows.
        string[] place = ["PDistrictName", "PStateName", "EnterpriseTypee"];
        // A Master Admin with a scope sees only its units and levels (migration 0057).
        var rows = AllotmentLists.Pick(await ScopeFilter.ApplyAsync(HttpContext, sets[0], ct), [.. AllotmentLists.ListFields, .. extra, .. place]);
        await AddPaidOnAsync(rows, ct);
        return new ListResponse(rows);
    }

    /// <summary>
    /// 2026-11-17 (approved redesign, "Waiting" column): PaidOn, when the level's payment was recorded (the newest MsmePaymentInfo
    /// row of the unit and level in the portal's database; Consultancy: of the row's milestone). Left null when there is none or
    /// the table cannot be read: the page then shows no waiting time rather than a guessed one.
    /// </summary>
    private async Task AddPaidOnAsync(List<Dictionary<string, object?>> rows, CancellationToken ct)
    {
        var ids = rows.Select(r => r.Text("ZedId").Trim()).Where(AssessmentInput.IsId).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        foreach (var r in rows) r["PaidOn"] = null;
        if (ids.Count == 0) return;
        var paid = new Dictionary<string, DateTime>(StringComparer.OrdinalIgnoreCase);
        try
        {
            // In chunks: SQL Server takes at most 2,100 parameters.
            foreach (var chunk in ids.Chunk(1000))
                foreach (var p in await db.QuerySqlAsync<PaidRow>(PaidOnSql(host.System == PortalSystem.Consultancy), new { ZedIds = chunk }, ct))
                    if (p.PaidOn is { } d) paid[PaidKey(p.ZedId, p.Certification, p.Milestone)] = d;
        }
        catch (System.Data.Common.DbException ex)
        {
            log.LogWarning(ex, "Payment dates of the allot list could not be read");
            return;
        }
        var consultancy = host.System == PortalSystem.Consultancy;
        foreach (var r in rows)
            if (paid.TryGetValue(PaidKey(r.Text("ZedId"), r.Text("Certification"), consultancy ? r.Text("NcCount") : null), out var d)) r["PaidOn"] = d;
    }

    private static string PaidKey(string? zedId, string? level, string? milestone) =>
        $"{zedId?.Trim()}|{level?.Trim()}|{(string.IsNullOrWhiteSpace(milestone) ? "" : milestone.Trim())}";

    /// <summary>The newest payment of each unit and level (Consultancy: and milestone, MileStoneNum).</summary>
    internal static string PaidOnSql(bool consultancy) => consultancy
        ? "SELECT ZedId, Certification, CAST(MileStoneNum AS varchar(10)) AS Milestone, MAX(CreatedDate) AS PaidOn FROM dbo.MsmePaymentInfo " +
          "WHERE ZedId IN @ZedIds GROUP BY ZedId, Certification, MileStoneNum;"
        : "SELECT ZedId, Certification, CAST(NULL AS varchar(10)) AS Milestone, MAX(CreatedDate) AS PaidOn FROM dbo.MsmePaymentInfo " +
          "WHERE ZedId IN @ZedIds GROUP BY ZedId, Certification;";

    public sealed record PaidRow(string? ZedId, string? Certification, string? Milestone, DateTime? PaidOn);

    /// <summary>Agencies that may be given this record (GetCb), filtered as the old pop-up did.</summary>
    [HttpGet("allot/agencies")]
    [StaffRoles(UserRole.MasterAdmin)]
    public async Task<ActionResult<IReadOnlyList<Person>>> Agencies(string? zedId, string? certification, CancellationToken ct)
    {
        var level = AssessmentInput.Level(certification);
        if (!AssessmentInput.IsId(zedId) || level is null) return this.Problem400("Invalid request.");
        return (await AgenciesFor(zedId!, level, ct)).ToList();
    }

    public sealed record AllotToAgencyRequest(string? ZedId, string? Certification, string? AgencyUserId);

    [HttpPost("allot")]
    [StaffRoles(UserRole.MasterAdmin)]
    public async Task<ActionResult<MessageResponse>> AllotToAgency(AllotToAgencyRequest req, CancellationToken ct)
    {
        var refused = await AllotOneAsync(req.ZedId, req.Certification, req.AgencyUserId, ct);
        return refused is null ? new MessageResponse(AllottedMessage) : this.Problem400(refused);
    }

    private string AllottedMessage => host.System == PortalSystem.Consultancy ? "Consultancy allotted." : "Assessment allotted.";

    /// <summary>Most units one bulk allotment takes (the page selects from one page of at most 100 rows).</summary>
    public const int BulkLimit = 100;

    public sealed record BulkUnit(string? ZedId, string? Certification);

    public sealed record BulkAllotRequest(IReadOnlyList<BulkUnit>? Units, string? AgencyUserId);

    /// <param name="Allotted">True when the unit went to the agency; else <paramref name="Message"/> says why not.</param>
    public sealed record BulkResult(string ZedId, string Certification, bool Allotted, string Message);

    public sealed record BulkAllotResponse(int Allotted, int Refused, IReadOnlyList<BulkResult> Results);

    /// <summary>
    /// 2026-11-17 (approved redesign, bulk allotment): several units to one agency in one request. Each unit goes through the
    /// single allotment's own checks, procedure, desktop skip and mail (<see cref="AllotOneAsync"/>), one after the other; a
    /// unit that is refused does not stop the others, and the answer says, per unit, allotted or why not.
    /// </summary>
    [HttpPost("allot/bulk")]
    [StaffRoles(UserRole.MasterAdmin)]
    public async Task<ActionResult<BulkAllotResponse>> AllotBulk(BulkAllotRequest req, CancellationToken ct)
    {
        var units = req.Units ?? [];
        if (units.Count == 0) return this.Problem400("Please select the units to allot.");
        if (units.Count > BulkLimit) return this.Problem400($"Please select at most {BulkLimit} units at a time.");
        if (!AssessmentInput.IsId(req.AgencyUserId)) return this.Problem400("Please select valid data.");

        var results = new List<BulkResult>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var u in units)
        {
            var zedId = u?.ZedId?.Trim() ?? "";
            var level = AssessmentInput.Level(u?.Certification) ?? u?.Certification?.Trim() ?? "";
            if (!seen.Add(zedId + "|" + level))
            {
                results.Add(new BulkResult(zedId, level, false, "Listed twice; allotted once."));
                continue;
            }
            string? refused;
            try
            {
                refused = await AllotOneAsync(zedId, u?.Certification, req.AgencyUserId, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogError(ex, "Bulk allotment of {ZedId} {Certification} failed", zedId, level);
                refused = "Could not be allotted. Please try again.";
            }
            results.Add(new BulkResult(zedId, level, refused is null, refused ?? AllottedMessage));
        }
        var allotted = results.Count(r => r.Allotted);
        return new BulkAllotResponse(allotted, results.Count - allotted, results);
    }

    /// <summary>
    /// One allotment: the record must be in the master admin's allot list and the agency among those offered for it. Null when
    /// allotted, else the reason it was refused (nothing changed then).
    /// </summary>
    private async Task<string?> AllotOneAsync(string? zedId, string? certification, string? agencyUserId, CancellationToken ct)
    {
        var level = AssessmentInput.Level(certification);
        if (!AssessmentInput.IsId(zedId) || level is null) return "Invalid request.";
        if (!AssessmentInput.IsId(agencyUserId)) return "Please select valid data.";

        var listed = (await AllotmentLists.List(db, UserId, RoleId, null, zedId, AllotmentLists.Filter.None with { Certification = level }, ct))[0]
            .Any(r => AllotmentLists.Same(r, "ZedId", zedId!) && AllotmentLists.Same(r, "Certification", level));
        if (!listed) return "This assessment can no longer be allotted.";

        var agency = (await AgenciesFor(zedId!, level, ct)).FirstOrDefault(a => string.Equals(a.UserId, agencyUserId, StringComparison.OrdinalIgnoreCase));
        if (agency is null) return "Please select valid data.";
        // 2026-11-18 (expenditure monitoring): no allotment beyond the agency's purchase order for the level.
        if (agency.PoStopped) return agency.PoMessage;

        await db.ExecuteProcAsync("SP_ASSESSMENT_ALLOT_TO_AGENCY",
            new { ZedId = zedId, Certification = level, CertificationBodyUserId = agency.UserId }, ct);
        log.LogInformation("{UserId} allotted {ZedId} {Certification} to agency {Agency}", UserId, zedId, level, agency.UserId);
        try
        {
            // 2026-11-14: Remote only / Onsite only levels go straight to the agency's SA allotment (migration 0074).
            if (host.System == PortalSystem.Main) await DesktopSkip.TryAsync(db, zedId!, level, log, ct);
            await DesktopAssessmentEmails.Create(HttpContext.RequestServices)
                .SendAsync(DesktopAssessmentEmails.Kind.AllottedToAgency, zedId!, level, null, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // The unit is allotted: a later step that fails is logged, not reported as a refusal.
            log.LogError(ex, "After allotting {ZedId} {Certification}: the desktop skip or the mail failed", zedId, level);
        }
        return null;
    }

    private async Task<IEnumerable<Person>> AgenciesFor(string zedId, string level, CancellationToken ct)
    {
        var rows = (await db.QueryProcMultipleAsync("SP_ASSESSMENT_AGENCIES_TO_ALLOT", new { ZedId = zedId }, ct))[0];
        // Bronze surveillance goes only to agencies allowed for it (the old Allot page filtered on AllowBronzeSurveillance).
        // 2026-11-08: a V4 level assessed at the desktop only goes to desktop-verification agencies, as Bronze.
        var column = level == "Bronze" ? (host.System == PortalSystem.Surveillance ? "AllowBronzeSurveillance" : "DesktopVerification")
            : Zed.Core.Data.LevelRegistry.IsDesktop(level) ? "DesktopVerification" : "SiteVerification";
        // V4: only agencies that assess the unit's kind (Manufacturing / Services; not set = no limit).
        var category = await Users.UserSectorActivity.UnitCategoryAsync(db, zedId, log, ct);
        var activities = await Users.UserSectorActivity.ByRoleAsync(db, (int)UserRole.Agency, log, ct);
        // V4 (2026-11-08): not the agencies the Master Admin disabled this level for (Silver, Gold, ZED-X; Bronze is in the procedure).
        var disabled = host.System == PortalSystem.Main ? await Users.AgencyLevels.DisabledAsync(db, level, log, ct) : [];
        // 2026-11-18 (expenditure monitoring): each agency's PO for the level; a used-up PO stops its allotment (main, Consultancy).
        var po = (await Expenditure.PoLimits.StatusAsync(db, host, null, level, log, ct))
            .ToDictionary(s => s.PartyId, StringComparer.OrdinalIgnoreCase);
        var levelName = Zed.Core.Data.LevelRegistry.NameOf(level);
        return rows.Where(r => AllotmentLists.Flag(r, column) && !disabled.Contains(r.Text("UserId").Trim()))
            .Select(r =>
            {
                var id = r.Text("UserId");
                var s = po.GetValueOrDefault(id.Trim());
                return new Person(id, r.Text("UserName"), activities.GetValueOrDefault(id), PoStopped: s?.Stopped == true,
                    PoMessage: s?.Stopped == true ? Expenditure.PoLimits.StoppedMessage(s, r.Text("UserName"), levelName) : null,
                    PoLeft: s?.HasPo == true ? s.Left : null);
            })
            .Where(p => Users.UserSectorActivity.Serves(p.SectorActivity, category));
    }
}

/// <summary>SP_ASSESSMENT_ALLOT_LIST and the helpers the allotment controllers share.</summary>
internal static class AllotmentLists
{
    /// <summary>Columns the list screens show (the procedure selects whole Msme/Users rows).</summary>
    public static readonly string[] ListFields =
    [
        "RowNumber", "ZedId", "Certification", "PUnitName", "UnitAddress", "UnitSpocName", "UnitSpocMobileNo", "UnitSpocEmailId",
        "AgencyName", "CertificationBodyUserId", "ReasonForRejection", "DesktopReasonForRejection", "DesktopAssessorId",
        "DesktopAccepted", "CertificationStatus", "NcStatus", "ModeOfAssessment",
    ];

    public sealed record Filter(string? State, string? Certification, string? Size, string? Gender)
    {
        public static readonly Filter None = new(null, null, null, null);
    }

    public static bool Filters(string? state, string? certification, string? size, string? gender, out Filter filter)
    {
        filter = Filter.None;
        if (!AssessmentInput.State(state, out var s)) return false;
        if (!AssessmentInput.Filter(certification, AssessmentInput.Levels, out var c)) return false;
        if (!AssessmentInput.Filter(size, AssessmentInput.Sizes, out var z)) return false;
        if (!AssessmentInput.Filter(gender, AssessmentInput.Genders, out var g)) return false;
        filter = new Filter(s, c, z, g);
        return true;
    }

    /// <summary>
    /// SP_ASSESSMENT_ALLOT_LIST for the signed-in user (the procedure branches on RoleId and filters by UserId).
    /// The parameters exist in all three databases (Consultancy adds @Milestone, used only by the lists not ported).
    /// </summary>
    public static Task<ResultSets> List(ISqlExecutor db, string userId, int roleId, string? allotmentType, string? zedId, Filter f, CancellationToken ct) =>
        db.QueryProcMultipleAsync("SP_ASSESSMENT_ALLOT_LIST", new
        {
            UserId = userId,
            RoleId = roleId.ToString(System.Globalization.CultureInfo.InvariantCulture),
            AllotmentType = allotmentType,
            ZedId = zedId,
            CertificationType = f.Certification,
            State = f.State,
            MsmeSize = f.Size,
            Gender = f.Gender,
        }, ct);

    public static bool Same(IDictionary<string, object?> row, string column, string value) =>
        string.Equals(row.Text(column).Trim(), value, StringComparison.OrdinalIgnoreCase);

    public static bool Flag(IDictionary<string, object?> row, string column) =>
        row.TryGetValue(column, out var v) && v switch
        {
            bool b => b,
            null or DBNull => false,
            _ => v.ToString() is "1" or "True" or "true",
        };

    public static List<AssessmentAllotmentController.Person> People(IEnumerable<IDictionary<string, object?>> rows) =>
        rows.Select(r => new AssessmentAllotmentController.Person(r.Text("UserId"), r.Text("UserName"))).Where(p => p.UserId.Length > 0).ToList();

    public static List<Dictionary<string, object?>> Pick(IEnumerable<IDictionary<string, object?>> rows, string[] fields) =>
        rows.Select(r => fields.ToDictionary(f => f, f => r.TryGetValue(f, out var v) && v is not DBNull ? v : null)).ToList();
}
