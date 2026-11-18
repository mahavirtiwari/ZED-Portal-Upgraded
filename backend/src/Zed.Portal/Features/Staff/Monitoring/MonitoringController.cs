using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using static Zed.Portal.Features.Staff.SiteAssessment.AssessmentInputs;
using Zed.Portal.Features.Staff.Users;
using Zed.Portal.Features.CertLevels;
using Zed.Portal.Features.Staff.Tat;

namespace Zed.Portal.Features.Staff.Monitoring;

/// <summary>
/// Assessment monitoring. Port of MonitoringController.Index and the actions Views/Monitoring/Index.cshtml
/// calls: GetList (SP_MONITORING_GET_LIST), ExtendNcClosureDate (SP_EXTEND_NC_CLOSURE_DATE),
/// StepBackToAssessor (SP_MOVING_ONE_STEP_BACK_OF_NC) and SendBackToAgencyForReAllot
/// (SP_MONITORING_SEND_BACK_TO_AGENCY_FOR_REALLOCATION).
/// <para>
/// In the old controller only Index and GetList were limited to MasterAdmin/Agency; the three actions
/// that change or delete assessment data were open to any signed-in user (MSMEs included), for any ZED ID.
/// Here they are MasterAdmin only (the page showed their buttons to MasterAdmin only), and the unit must be
/// in the state in which the page offered the button.
/// </para>
/// <para>The review actions of the DA/SA details pages are in <see cref="MonitoringReviewController"/>.</para>
/// <para>
/// 2026-11-17 (approved redesign): the list's level is optional. Without one, the procedure is called once per level of the
/// portal (a Master Admin with a level scope: its levels), the rows joined and the counts added, as the header bell counts
/// them; the procedure itself cannot be asked without a level (its counts filter with <c>Certification = @CertificationType</c>).
/// </para>
/// <para>Per system (the list's status numbers are the same in all three procedures):</para>
/// <list type="bullet">
/// <item>Consultancy ("Consultancy Monitoring"): Silver/Gold only, tabs 2/3/5 (no NC or rejected tab), no NC closure
/// filter (its SP_MONITORING_GET_LIST has no @NcClosingDate); rows add the milestone (NcCount), technical experts and
/// BDS/HAP dates. Extend, step back and send back are not offered (no NC round; SP_MOVING_ONE_STEP_BACK_OF_NC and
/// SP_MONITORING_SEND_BACK_TO_AGENCY_FOR_REALLOCATION are missing there).</item>
/// <item>Surveillance ("Surveillance Monitoring"): rows add SurveillanceNo; send back to the agency (re-allot) is not
/// offered (its procedure is missing there); step back as on main; extend also on the rejected tab (its page showed
/// "Extend NC Final Closure Date" for <c>filter.status==4 || filter.status==7</c>).</item>
/// </list>
/// <para>
/// 2026-11-18 (approved monitoring design, the user's decisions "TAT and monitoring"): each row also gives its sub-section
/// (Desktop / Site assessment; the milestone on Consultancy), the date the page's date range means for the stage, where a site
/// assessment in progress is (parameters distributed, opening meeting, submitted through the app), whether its submission
/// through the app is pending past the level's man-days, and its TAT (Administration → TAT); the stage cards' counts per
/// sub-section and the delayed cases come with the list, scoped as the list (<see cref="MonitoringInsights"/>). The list can be
/// limited to a date range (from / to, yyyy-MM-dd) on that date; Quality check lists the most delayed first.
/// </para>
/// </summary>
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
[Route("api/staff/monitoring")]
[StaffRoles(UserRole.MasterAdmin, UserRole.Agency)]
public sealed class MonitoringController(ISqlExecutor db, PortalHost host, ILogger<MonitoringController> log) : StaffApiController
{
    /// <summary>Status tabs of the page (SP_MONITORING_GET_LIST @Status).</summary>
    public static readonly int[] Statuses = [2, 3, 4, 5, 7];

    /// <summary>Consultancy tabs: not started, in progress, quality check.</summary>
    private static readonly int[] ConsultancyStatuses = [2, 3, 5];

    private static readonly string[] ConsultancyLevels = [.. Zed.Core.Data.LevelRegistry.Handholding];

    private bool Consultancy => host.System == PortalSystem.Consultancy;

    private const int NonConformance = 4;

    private const int Rejected = 7;

    private static readonly string[] Fields =
    [
        "RowNumber", "ZedId", "Certification", "PUnitName", "UnitAddress",
        "AgencyName", "CertificationBodyUserId", "ModeOfAssessment",
        "DesktopAssessorName", "DesktopAssessorId", "SiteAssessorName", "SiteAssessorId", "CoAssessorName", "CoAssessorId",
        "SameUdyamAddress", "DocVerifiAllot", "SaAssessmentDate", "CertificationStatus", "NcStatus", "NcCount",
    ];

    private static readonly string[] ConsultancyFields =
    [
        "RowNumber", "ZedId", "Certification", "PUnitName", "UnitAddress", "AgencyName", "CertificationBodyUserId",
        "SiteAssessorName", "SiteAssessorId", "CoAssessorName", "CoAssessorId", "TechExpertName", "TechExpert",
        "DocVerifiAllot", "SaAssessmentDate", "BdsFromDate", "HapFromDate", "CertificationStatus", "NcStatus", "NcCount",
    ];

    private static readonly string[] SurveillanceFields =
    [
        "RowNumber", "ZedId", "Certification", "SurveillanceNo", "PUnitName", "UnitAddress",
        "AgencyName", "CertificationBodyUserId", "ModeOfAssessment",
        "DesktopAssessorName", "DesktopAssessorId", "SiteAssessorName", "SiteAssessorId", "CoAssessorName", "CoAssessorId",
        "DocVerifiAllot", "SaAssessmentDate", "CertificationStatus", "NcStatus", "NcCount",
    ];

    /// <summary>Shown to MasterAdmin only (the page hid the column from agencies).</summary>
    private static readonly string[] MasterAdminFields = ["NcFinalClosureDt"];

    private static readonly string[] CountFields = ["NotStarted", "InProgress", "Qc", "Nc", "Rj"];

    /// <summary>2026-11-18: the unit's contact (shown in full) and what <see cref="MonitoringInsights.Enrich"/> adds.</summary>
    private static readonly string[] InsightFields =
    [
        "UnitSpocName", "UnitSpocMobileNo", "UnitSpocEmailId",
        "Track", "StageDate", "Step", "SubmissionPending", "TatDue", "TatLateHours", "TatBucket", "TatLabel", "TatRule",
    ];

    /// <param name="Stages">2026-11-18: each stage's cases per sub-section and how many are delayed (null when not readable).</param>
    /// <param name="ManDays">The man-days per level the "submission pending" chip uses (none on Consultancy).</param>
    public sealed record ListResponse(
        IReadOnlyList<Dictionary<string, object?>> Units, Dictionary<string, object?> Counts, bool CanManage,
        IReadOnlyList<MonitoringInsights.StageCount>? Stages = null, IReadOnlyDictionary<string, int>? ManDays = null);

    public sealed record UnitRequest(string? ZedId, string? Certification);

    public sealed record ExtendRequest(string? ZedId, string? Certification, int NoOfDays);

    [HttpGet]
    public async Task<ActionResult<ListResponse>> List(
        [FromQuery] string? certification, [FromQuery] int? status, [FromQuery] string? ncClosingDate,
        [FromQuery] string? from, [FromQuery] string? to, CancellationToken ct)
    {
        if (IsRole(UserRole.Agency) && !CurrentUser.HasSubRole(SubRoles.SiteVerification) && !CurrentUser.HasSubRole(SubRoles.DesktopVerification))
            return Forbid();

        // 2026-11-17 (approved redesign): the level is optional; without one, every level of the portal (see below).
        var allLevels = string.IsNullOrWhiteSpace(certification);
        var level = allLevels ? null : Level(certification, Consultancy ? ConsultancyLevels : Levels);
        if ((!allLevels && level is null) || (status is not null && !(Consultancy ? ConsultancyStatuses : Statuses).Contains(status.Value)))
            return this.Problem400("Please select valid data.");

        string? ncDate = null;
        if (!string.IsNullOrWhiteSpace(ncClosingDate))
        {
            if (Consultancy || status != NonConformance || IsoDate(ncClosingDate) is not { } d)
                return this.Problem400("Please select a valid NC closure date.");
            ncDate = d.ToString("MM/dd/yyyy", System.Globalization.CultureInfo.InvariantCulture); // CONVERT(..., 101)
        }

        // 2026-11-18: the date range on the stage's date (allotted / assessment / submitted / NC raised / rejected on).
        DateOnly? fromDate = null, toDate = null;
        if (!string.IsNullOrWhiteSpace(from) && (fromDate = IsoDate(from)) is null) return this.Problem400("Please select a valid from date.");
        if (!string.IsNullOrWhiteSpace(to) && (toDate = IsoDate(to)) is null) return this.Problem400("Please select a valid to date.");
        if (fromDate > toDate) return this.Problem400("The from date must be on or before the to date.");

        // One level: the procedure's rows and counts. All levels: the procedure once per level (its counts filter on the level
        // with "=", so a NULL level would count nothing), rows joined and counts added, as the header bell counts them.
        var (rows, counts) = allLevels ? await AllLevelsAsync(status, ncDate, ct) : await OneLevelAsync(level!, status, ncDate, ct);
        var master = IsRole(UserRole.MasterAdmin);
        var fields = host.System switch
        {
            PortalSystem.Consultancy => ConsultancyFields,
            PortalSystem.Surveillance => SurveillanceFields,
            _ => Fields,
        };
        var scoped = await ScopeFilter.ApplyAsync(HttpContext, rows, ct);

        // 2026-11-18: sub-sections, stage dates, app steps, man-days and TAT from the portal's records, scoped as the list.
        var scopeLevels = allLevels ? await PortalLevelsAsync(ct) : [level!];
        var facts = await MonitoringInsights.FactsAsync(db, host.System, scopeLevels, IsRole(UserRole.Agency) ? UserId : null, log, ct);
        var rules = await TatStore.RulesAsync(db, log, ct);
        var manDays = await LevelManDays.ForMonitoringAsync(db, host.System, log, ct);
        var now = DateTime.Now;
        var cases = facts is null ? [] : (await ScopeFilter.ApplyAsync(HttpContext, facts, f => f.ZedId, f => f.Certification, ct))
            .Select(f => (Fact: (MonitoringInsights.Fact?)f, Insight: (MonitoringInsights.Insight?)MonitoringInsights.Of(host.System, f, rules, manDays, now))).ToList();
        var byId = cases.Where(c => c.Fact!.Id > 0).GroupBy(c => c.Fact!.Id).ToDictionary(g => g.Key, g => g.First());
        var byKey = cases.GroupBy(c => MonitoringInsights.Key(c.Fact!.ZedId, c.Fact!.Certification)).ToDictionary(g => g.Key, g => g.First());
        foreach (var row in scoped)
        {
            var match = Int(row, "Id") is var id && id > 0 && byId.TryGetValue(id, out var m1) ? m1
                : byKey.TryGetValue(MonitoringInsights.Key(row.Text("RejectedZedId") is { Length: > 0 } rz ? rz : row.Text("ZedId"), row.Text("Certification")), out var m2) ? m2
                : default;
            var stage = status ?? match.Insight?.Stage ?? 0;
            MonitoringInsights.Enrich(host.System, row, stage, match.Fact, match.Insight);
        }
        var units = Pick(scoped.Where(r => MonitoringInsights.InRange(r["StageDate"], fromDate, toDate)),
            (master ? fields.Concat(MasterAdminFields) : fields).Concat(InsightFields));
        if (status == 5) units = MonitoringInsights.MostDelayedFirst(units);
        return new ListResponse(
            units,
            counts,
            master,
            facts is null ? null : MonitoringInsights.Stages(host.System, cases.Select(c => c.Insight), Consultancy ? ConsultancyStatuses : Statuses),
            manDays);
    }

    /// <summary>The portal's levels (a Master Admin with a level scope: its levels).</summary>
    private async Task<IReadOnlyList<string>> PortalLevelsAsync(CancellationToken ct)
    {
        var scope = await HttpContext.LoginScopeAsync(ct);
        return (Consultancy ? ConsultancyLevels : Levels).Where(l => !scope.IsLimited || scope.AllowsLevel(l)).ToList();
    }

    private async Task<(List<IDictionary<string, object?>> Rows, Dictionary<string, object?> Counts)> OneLevelAsync(
        string level, int? status, string? ncDate, CancellationToken ct)
    {
        var sets = await ListAsync(level, status, null, ncDate, ct);
        return ([.. sets[0]], Pick(sets[1].Take(1), CountFields).FirstOrDefault() ?? CountFields.ToDictionary(f => f, _ => (object?)0));
    }

    /// <summary>Every level of the portal (a Master Admin with a level scope: only its levels), rows joined, counts added.</summary>
    private async Task<(List<IDictionary<string, object?>> Rows, Dictionary<string, object?> Counts)> AllLevelsAsync(
        int? status, string? ncDate, CancellationToken ct)
    {
        var scope = await HttpContext.LoginScopeAsync(ct);
        var rows = new List<IDictionary<string, object?>>();
        var counts = CountFields.ToDictionary(f => f, _ => (object?)0);
        foreach (var level in (Consultancy ? ConsultancyLevels : Levels).Where(l => !scope.IsLimited || scope.AllowsLevel(l)))
        {
            var (r, c) = await OneLevelAsync(level, status, ncDate, ct);
            rows.AddRange(r);
            foreach (var f in CountFields) counts[f] = Convert.ToInt32(counts[f], System.Globalization.CultureInfo.InvariantCulture) + Count(c, f);
        }
        return (rows, counts);
    }

    private static int Count(Dictionary<string, object?> counts, string field) =>
        counts.TryGetValue(field, out var v) && v is not null && int.TryParse(Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture), out var n) ? n : 0;

    /// <summary>Moves the NC final closure date of a unit in non-conformance (surveillance: or rejected) by 1 to 30 days.</summary>
    [HttpPost("extend-nc-closure")]
    [StaffRoles(UserRole.MasterAdmin)]
    public async Task<ActionResult<MessageResponse>> ExtendNcClosure(ExtendRequest req, CancellationToken ct)
    {
        if (Consultancy) return NotFound();
        if (req.NoOfDays is < 1 or > 30)
            return this.Problem400("Please select the number of days (1 to 30).");
        int[] tabs = host.System == PortalSystem.Surveillance ? [NonConformance, Rejected] : [NonConformance];
        var (unit, problem) = await FindAsync(req.ZedId, req.Certification, tabs, ct);
        if (unit is null) return problem!;

        await db.ExecuteProcAsync("SP_EXTEND_NC_CLOSURE_DATE", new
        {
            ZedId = unit.Text("ZedId"),
            CertificationType = unit.Text("Certification"),
            req.NoOfDays,
            UserId,
            RoleId,
        }, ct);
        return new MessageResponse("NC final closure date extended.");
    }

    /// <summary>Removes the current NC round and returns the unit to the assessor (NC n → NC n-1).</summary>
    [HttpPost("step-back-nc")]
    [StaffRoles(UserRole.MasterAdmin)]
    public async Task<ActionResult<MessageResponse>> StepBackNc(UnitRequest req, CancellationToken ct)
    {
        if (Consultancy) return NotFound(); // SP_MOVING_ONE_STEP_BACK_OF_NC is missing in ZED_CONSULTANT
        var (unit, problem) = await FindAsync(req.ZedId, req.Certification, [NonConformance], ct);
        if (unit is null) return problem!;
        if (Int(unit, "NcCount") < 1)
            return this.Problem400("There is no non-conformance round to step back from.");

        try
        {
            await db.ExecuteProcAsync("SP_MOVING_ONE_STEP_BACK_OF_NC", new
            {
                ZedId = unit.Text("ZedId"),
                UserId,
                RoleId = RoleId.ToString(),
                CertificationType = unit.Text("Certification"),
            }, ct);
        }
        catch (Microsoft.Data.SqlClient.SqlException ex)
        {
            // The procedure forces an error when the unit is not in NC; never show its text.
            log.LogWarning(ex, "NC step back refused for {ZedId}", unit.Text("ZedId"));
            return this.Problem400("Invalid Details.");
        }
        return new MessageResponse("Stepped back to the previous NC.");
    }

    /// <summary>Resets a scheduled/started site assessment so the agency can allot it again (not for Bronze).</summary>
    [HttpPost("send-back-to-agency")]
    [StaffRoles(UserRole.MasterAdmin)]
    public async Task<ActionResult<MessageResponse>> SendBackToAgency(UnitRequest req, CancellationToken ct)
    {
        // SP_MONITORING_SEND_BACK_TO_AGENCY_FOR_REALLOCATION exists only in the main database.
        if (host.System != PortalSystem.Main) return NotFound();
        if (Level(req.Certification, SiteLevels) is null)
            return this.Problem400("Please select valid data.");
        // The page offered this on "Scheduled but not started" (status 8) and "In progress" (status 9).
        var (unit, problem) = await FindAsync(req.ZedId, req.Certification, [2, 3], ct,
            r => Int(r, "CertificationStatus") is 8 or 9);
        if (unit is null) return problem!;

        var result = (await db.QueryProcMultipleAsync("SP_MONITORING_SEND_BACK_TO_AGENCY_FOR_REALLOCATION", new
        {
            ZedId = unit.Text("ZedId"),
            UserId,
            RoleId = RoleId.ToString(),
            CertificationType = unit.Text("Certification"),
        }, ct))[0].FirstOrDefault();

        if (result is not null && result.Text("Status") == "0")
            return this.Problem400("Invalid Details.");
        return new MessageResponse("Sent back to the agency for re-allocation.");
    }

    /// <summary>SP_MONITORING_GET_LIST; ZED_CONSULTANT's version has no @NcClosingDate.</summary>
    private Task<ResultSets> ListAsync(string level, int? status, string? zedId, string? ncDate, CancellationToken ct) =>
        Consultancy
            ? db.QueryProcMultipleAsync("SP_MONITORING_GET_LIST", new
            {
                UserId,
                RoleId = RoleId.ToString(),
                Status = status,
                CertificationType = level,
                ZedId = zedId,
            }, ct)
            : db.QueryProcMultipleAsync("SP_MONITORING_GET_LIST", new
            {
                UserId,
                RoleId = RoleId.ToString(),
                Status = status,
                CertificationType = level,
                ZedId = zedId,
                NcClosingDate = ncDate,
            }, ct);

    /// <summary>The unit as the monitoring list shows it on one of the given status tabs, or the error to return.</summary>
    private async Task<(IDictionary<string, object?>? Unit, ActionResult? Problem)> FindAsync(
        string? zedId, string? certification, int[] statuses, CancellationToken ct,
        Func<IDictionary<string, object?>, bool>? condition = null)
    {
        zedId = zedId?.Trim();
        var level = Level(certification, Levels);
        if (!IsId(zedId) || level is null)
            return (null, this.Problem400("Please select valid data."));

        foreach (var status in statuses)
        {
            var row = (await ListAsync(level, status, zedId, null, ct))[0]
                .FirstOrDefault(r => Same(r, "ZedId", zedId!) && Same(r, "Certification", level) && (condition?.Invoke(r) ?? true));
            if (row is not null) return (row, null);
        }
        return (null, this.Problem400("This action is not available for the unit in its current status."));
    }
}
