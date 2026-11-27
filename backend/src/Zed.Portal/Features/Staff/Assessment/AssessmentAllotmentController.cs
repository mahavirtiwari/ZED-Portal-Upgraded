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
            // 2026-11-26: DesktopSkipped, a unit without a desktop step waiting at its agency (SiteRejections).
            _ => ["TimeDuration", "UdyamStatus", DesktopSkip.Field],
        };
        // 2026-11-17 (approved redesign): the unit's district, state and size (the procedure's Msme columns) for the rows.
        string[] place = ["PDistrictName", "PStateName", "EnterpriseTypee"];
        // 2026-11-18: main adds the units an agency rejected at the site allotment (SiteRejections), to re-allot.
        IEnumerable<IDictionary<string, object?>> listed = host.System == PortalSystem.Main ? sets[0].Where(Allottable) : sets[0];
        if (host.System == PortalSystem.Main)
            listed = listed.Concat(await SiteRejections.ListAsync(db, null, type, f, log, ct));
        // A Master Admin with a scope sees only its units and levels (migration 0057).
        var rows = AllotmentLists.Pick(await ScopeFilter.ApplyAsync(HttpContext, listed, ct), [.. AllotmentLists.ListFields, .. extra, .. place]);
        await AddPaidOnAsync(rows, ct);
        if (host.System != PortalSystem.Consultancy) await AddRemarksAsync(rows, ct);
        else await AddCoAllotTypeAsync(rows, ct);
        return new ListResponse(rows);
    }

    /// <summary>
    /// 2026-11-21 (the product owner's milestone 1 rule): how each milestone row got its Consultant Organisation, or why it waits:
    /// MsmeCertifications.CoAllotType (migration 0111) of the row's milestone: Chosen (by the unit at payment), RoundRobin,
    /// NoEligible (no organisation could be allotted), Manual (the Master Admin's Allot).
    /// </summary>
    internal const string CoAllotTypeSql =
        "SELECT ZedId, Certification, CAST(NcCount AS varchar(10)) AS Milestone, CoAllotType FROM dbo.MsmeCertifications " +
        "WHERE ZedId IN @ZedIds AND CoAllotType IS NOT NULL AND IdDisabled IS NULL;";

    public sealed class CoAllotRow
    {
        public string? ZedId { get; init; }
        public string? Certification { get; init; }
        public string? Milestone { get; init; }
        public string? CoAllotType { get; init; }
    }

    /// <summary>CoAllotType on the rows (null when none, or before migration 0111).</summary>
    private async Task AddCoAllotTypeAsync(List<Dictionary<string, object?>> rows, CancellationToken ct)
    {
        foreach (var r in rows) r["CoAllotType"] = null;
        var ids = rows.Select(r => r.Text("ZedId").Trim()).Where(AssessmentInput.IsId).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (ids.Count == 0) return;
        var types = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            foreach (var chunk in ids.Chunk(1000))
                foreach (var m in await db.QuerySqlAsync<CoAllotRow>(CoAllotTypeSql, new { ZedIds = chunk }, ct))
                    if (!string.IsNullOrWhiteSpace(m.CoAllotType)) types[PaidKey(m.ZedId, m.Certification, m.Milestone)] = m.CoAllotType.Trim();
        }
        catch (System.Data.Common.DbException ex)
        {
            log.LogWarning(ex, "How the milestones were allotted could not be read (is migration 0111 applied?)");
            return;
        }
        foreach (var r in rows)
            if (types.TryGetValue(PaidKey(r.Text("ZedId"), r.Text("Certification"), r.Text("NcCount")), out var t)) r["CoAllotType"] = t;
    }

    /// <summary>2026-11-19: the agency's remarks with its rejection reason (MsmeCertifications.RejectionRemarks, migration 0103).</summary>
    internal const string RemarksSql =
        "SELECT ZedId, Certification, RejectionRemarks FROM dbo.MsmeCertifications " +
        "WHERE ZedId IN @ZedIds AND ISNULL(ReasonForRejection, '') <> '' AND ISNULL(RejectionRemarks, '') <> '';";

    public sealed record RemarksRow(string? ZedId, string? Certification, string? RejectionRemarks);

    /// <summary>RejectionRemarks on the rows an agency rejected (null on the others, or before migration 0103).</summary>
    private async Task AddRemarksAsync(List<Dictionary<string, object?>> rows, CancellationToken ct)
    {
        foreach (var r in rows) r["RejectionRemarks"] = null;
        var ids = rows.Where(r => r.Text("ReasonForRejection").Length > 0).Select(r => r.Text("ZedId").Trim())
            .Where(AssessmentInput.IsId).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (ids.Count == 0) return;
        var remarks = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            foreach (var chunk in ids.Chunk(1000))
                foreach (var m in await db.QuerySqlAsync<RemarksRow>(RemarksSql, new { ZedIds = chunk }, ct))
                    if (!string.IsNullOrWhiteSpace(m.RejectionRemarks)) remarks[$"{m.ZedId?.Trim()}|{m.Certification?.Trim()}"] = m.RejectionRemarks.Trim();
        }
        catch (System.Data.Common.DbException ex)
        {
            log.LogWarning(ex, "Rejection remarks of the allot list could not be read (is migration 0103 applied?)");
            return;
        }
        foreach (var r in rows)
            if (r.Text("ReasonForRejection").Length > 0 && remarks.TryGetValue($"{r.Text("ZedId").Trim()}|{r.Text("Certification").Trim()}", out var m))
                r["RejectionRemarks"] = m;
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
    /// 2026-11-27 (the owner, workflow review: "only stuck cases"): main's allot list row the Master Admin may act on. A unit without an
    /// agency, always; one with an agency only when it is stuck: rejected by the agency or its desktop assessor, or flagged by the
    /// procedure (TimeDuration 'Reallot': no desktop assessor accepted it within 72 hours). A desktop assessment in progress and on time
    /// is no longer listed nor re-allotted (re-allotting sent it back to 2 and removed its assessor). The units waiting at their agency
    /// after the desktop stage come from SiteRejections, as before.
    /// </summary>
    internal static bool Allottable(IDictionary<string, object?> r) =>
        string.IsNullOrWhiteSpace(r.Text("CertificationBodyUserId"))
        || string.Equals(r.Text("TimeDuration"), "Reallot", StringComparison.OrdinalIgnoreCase)
        || !string.IsNullOrWhiteSpace(r.Text("ReasonForRejection"))
        || !string.IsNullOrWhiteSpace(r.Text("DesktopReasonForRejection"));

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
            .Any(r => AllotmentLists.Same(r, "ZedId", zedId!) && AllotmentLists.Same(r, "Certification", level) && (host.System != PortalSystem.Main || Allottable(r)));
        // 2026-11-18: or (main) rejected by its agency at the site allotment (SiteRejections).
        if (!listed && host.System == PortalSystem.Main)
            listed = (await SiteRejections.ListAsync(db, zedId, null, AllotmentLists.Filter.None with { Certification = level }, log, ct))
                .Any(r => AllotmentLists.Same(r, "ZedId", zedId!) && AllotmentLists.Same(r, "Certification", level));
        if (!listed) return "This assessment can no longer be allotted.";

        var agency = (await AgenciesFor(zedId!, level, ct)).FirstOrDefault(a => string.Equals(a.UserId, agencyUserId, StringComparison.OrdinalIgnoreCase));
        if (agency is null) return "Please select valid data.";
        // 2026-11-18 (expenditure monitoring): no allotment beyond the agency's purchase order for the level.
        if (agency.PoStopped) return agency.PoMessage;

        await AllotmentAgencies.AllotAsync(db, host, DesktopAssessmentEmails.Create(HttpContext.RequestServices), zedId!, level, agency.UserId, log, ct);
        log.LogInformation("{UserId} allotted {ZedId} {Certification} to agency {Agency}", UserId, zedId, level, agency.UserId);
        // 2026-11-21: a handholding milestone allotted automatically (or waiting for want of an organisation) is now the Master Admin's.
        if (host.System == PortalSystem.Consultancy) await MarkManualAsync(zedId!, level, ct);
        return null;
    }

    /// <summary>The milestone row that the procedure has just allotted (its latest NcCount), when it had a CoAllotType (migration 0111).</summary>
    internal const string ManualSql =
        "UPDATE dbo.MsmeCertifications SET CoAllotType = 'Manual' WHERE ZedId = @ZedId AND Certification = @Certification AND CoAllotType IS NOT NULL " +
        "AND NcCount = (SELECT ISNULL(MAX(NcCount), 0) FROM dbo.MsmeCertifications WHERE ZedId = @ZedId AND Certification = @Certification);";

    private async Task MarkManualAsync(string zedId, string level, CancellationToken ct)
    {
        try
        {
            await db.ExecuteSqlAsync(ManualSql, new { ZedId = AssessmentInput.Ansi(zedId), Certification = AssessmentInput.Ansi(level) }, ct);
        }
        catch (System.Data.Common.DbException ex)
        {
            log.LogWarning(ex, "{ZedId} {Certification}: the manual allotment was not marked (is migration 0111 applied?)", zedId, level);
        }
    }

    private Task<IReadOnlyList<Person>> AgenciesFor(string zedId, string level, CancellationToken ct) =>
        AllotmentAgencies.ForAsync(db, host, zedId, level, log, ct);
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
