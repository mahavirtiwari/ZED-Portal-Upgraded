using System.Data.Common;
using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.Assessment;
using Zed.Portal.Features.Staff.Users;

namespace Zed.Portal.Features.Staff.Attention;

/// <summary>
/// 2026-11-17 (approved staff redesign): the work waiting for the signed-in login, for the header's bell and the dashboard's
/// "Needs your attention" row. Each item counts the rows of a work list exactly as its own page does: the same procedure with
/// the same parameters (SP_ASSESSMENT_ALLOT_LIST, SP_MONITORING_GET_LIST), or a count on the same table with the same filter
/// (the quality observations on dbo.AssessorComments), and the same scope (<see cref="ScopeFilter"/> where the page applies it).
/// <list type="bullet">
/// <item>Master Admin: units awaiting allotment and rejected ones to re-allot (Allot), NC closures overdue (Monitoring, NC tab;
/// not on Consultancy, which has no NC round), quality observations open.</item>
/// <item>Agency / consultant organisation: assessments awaiting an assessor (desktop and site allotment; Consultancy: the CO
/// allotment), assessments awaiting its review (Monitoring, quality check tab), NC replies awaiting review (Monitoring, NC tab;
/// not on Consultancy), quality observations to answer.</item>
/// <item>Assessor / consultant: desktop assessments to accept and to assess, NC replies to review, site assessments due today
/// or overdue and to review (Consultancy: milestones to review).</item>
/// </list>
/// An item is listed only when the login can open its page (role, sub-role, portal and, for a sub-user, the screens it was
/// given), even when its count is 0. Other roles get no items. Kept 30 seconds per login, so the bell can ask on every page
/// (<c>?fresh=true</c> counts again).
/// </summary>
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
[Route("api/staff/attention")]
public sealed class AttentionController(ISqlExecutor db, PortalHost host, IMemoryCache cache, ILogger<AttentionController> log) : StaffApiController
{
    private static readonly TimeSpan Keep = TimeSpan.FromSeconds(30);

    /// <param name="Key">Stable name of the work (e.g. "allot", "nc-overdue").</param>
    /// <param name="Link">The Angular page that lists it.</param>
    /// <param name="Query">Query parameters for the page (e.g. the tab), or null.</param>
    /// <param name="Tone">"warn" (waiting on you), "bad" (late), "info".</param>
    /// <param name="Icon">A hint for the tile's icon: people, clock, chat, refresh, check, calendar.</param>
    public sealed record Item(string Key, string Label, int Count, string Link, IReadOnlyDictionary<string, string>? Query, string Tone, string Icon);

    public sealed record AttentionResponse(int Total, IReadOnlyList<Item> Items);

    /// <summary>The open quality observations (the Master Admin's list, filtered by its scope).</summary>
    public const string QualityOpenSql =
        "SELECT ZedId, Certification FROM dbo.AssessorComments WHERE AssessmentType = 'QualityObs' AND QoStatus = 'Open';";

    /// <summary>The open quality observations about one agency (its list: QoAgencyId = the agency).</summary>
    public const string QualityOpenForAgencySql =
        "SELECT COUNT(*) FROM dbo.AssessorComments WHERE AssessmentType = 'QualityObs' AND QoStatus = 'Open' AND QoAgencyId = @UserId;";

    private sealed record UnitRow(string? ZedId, string? Certification);

    private const string Allot = "/staff/assessment/allot";
    private const string Monitoring = "/staff/monitoring";
    private const string Quality = "/staff/quality-observations";

    private bool Consultancy => host.System == PortalSystem.Consultancy;

    /// <param name="fresh">True after the page changed something (an allotment, a reply): counted again now.</param>
    [HttpGet]
    public async Task<ActionResult<AttentionResponse>> Get([FromQuery] bool fresh, CancellationToken ct)
    {
        var user = CurrentUser;
        var key = $"staff-attention:{host.System}:{user.UserId}:{user.RoleId}:{user.ActingUserId}";
        if (!fresh && cache.TryGetValue(key, out AttentionResponse? kept) && kept is not null) return kept;

        var items = new List<Item>();
        switch ((UserRole)RoleId)
        {
            case UserRole.MasterAdmin: await MasterAdminAsync(items, ct); break;
            case UserRole.Agency: await AgencyAsync(items, ct); break;
            case UserRole.DesktopAssessor: await AssessorAsync(items, ct); break;
        }
        var result = new AttentionResponse(items.Sum(i => i.Count), items);
        cache.Set(key, result, Keep);
        return result;
    }

    // ------------------------------------------------------------------ roles

    private async Task MasterAdminAsync(List<Item> items, CancellationToken ct)
    {
        // 2026-11-24: an Incentives Master Admin (and its Operation Admins) has the incentive screens' work only.
        if (Users.IncentivesAdmins.Is(CurrentUser))
        {
            await IncentivesAsync(items, ct);
            // 2026-11-26: it has the Quality Observations screen too (the user: "Observation is missing").
            await QualityOpenAsync(items, ct);
            return;
        }
        if (Opens(Allot))
        {
            // The Allot page's list (all rows, both ALLOT and RE-ALLOT), within the login's scope.
            var rows = await Try("allot", async () => await ScopeFilter.ApplyAsync(HttpContext,
                (await AllotmentLists.List(db, UserId, RoleId, null, null, AllotmentLists.Filter.None, ct))[0], ct));
            if (rows is not null)
            {
                items.Add(new Item("allot", "Units awaiting allotment", rows.Count(r => Empty(r, "CertificationBodyUserId")),
                    Allot, Query("type", "ALLOT"), "warn", "people"));
                // RE-ALLOT rows the agency rejected or left for 72 hours (the page's red rows).
                items.Add(new Item("reallot", "Rejected, to re-allot",
                    rows.Count(r => !Empty(r, "CertificationBodyUserId") && (!Empty(r, "ReasonForRejection") || !Empty(r, "TimeDuration"))),
                    Allot, Query("type", "REALLOT"), "warn", "refresh"));
            }
        }
        if (!Consultancy && Opens(Monitoring))
        {
            var now = DateTime.Now;
            var nc = await MonitoringRowsAsync("nc-overdue", 4, scoped: true, ct);
            if (nc is not null)
                items.Add(new Item("nc-overdue", "NC closures overdue", nc.Count(r => ClosureDate(r) is { } d && d < now),
                    Monitoring, Query("status", "4"), "bad", "clock"));
        }
        await QualityOpenAsync(items, ct);
    }

    /// <summary>The ZED team's quality observations still open (the Master Admins' Quality Observations screen).</summary>
    private async Task QualityOpenAsync(List<Item> items, CancellationToken ct)
    {
        if (!Opens(Quality)) return;
        var open = await Try("quality-open", async () => await ScopeFilter.ApplyAsync(HttpContext,
            await db.QuerySqlAsync<UnitRow>(QualityOpenSql, null, ct), r => r.ZedId, r => r.Certification, ct));
        if (open is not null)
            items.Add(new Item("quality-open", "Quality observations open", open.Count, Quality, Query("status", "Open"), "info", "chat"));
    }

    private const string SchemeApplications = "/staff/schemes-verify/applications";
    private const string FinancialAssistance = "/staff/financial-assistance";

    /// <summary>
    /// 2026-11-24 (Incentives Master Admin): scheme applications awaiting allotment, onsite allotments left to it, applications on
    /// hold, Financial Assistance awaiting an agency (Incentives/Staff/IncentivesDashboardController.AttentionAsync).
    /// </summary>
    private async Task IncentivesAsync(List<Item> items, CancellationToken ct)
    {
        var store = HttpContext.RequestServices.GetRequiredService<Incentives.SchemeStore>();
        var c = await Try("incentives", async () => await Incentives.Staff.IncentivesDashboardController.AttentionAsync(HttpContext, db, store, ct));
        if (c is null) return;
        if (Opens(SchemeApplications))
        {
            items.Add(new Item("scheme-allot", "Scheme applications awaiting allotment", c.SchemeToAllot, SchemeApplications, Query("status", "Submitted"), "warn", "people"));
            items.Add(new Item("scheme-onsite-allot", "Onsite verifications to allot", c.OnsiteToAllot, SchemeApplications, Query("status", "OnsiteAllot"), "warn", "people"));
            items.Add(new Item("scheme-hold", "Scheme applications on hold", c.OnHold, SchemeApplications, Query("status", "OnHold"), "info", "clock"));
        }
        if (Opens(FinancialAssistance))
            items.Add(new Item("fa-allot", "Financial Assistance awaiting an agency", c.FaToAllot, FinancialAssistance, null, "warn", "people"));
    }

    private async Task AgencyAsync(List<Item> items, CancellationToken ct)
    {
        // 2026-11-26 (the user, incentive verification agency: its home showed the certification work): an incentive agency's own
        // work only: applications allotted to it to accept (naming a verification officer) and its QC due.
        if (CurrentUser.HasSubRole(Incentives.Agencies.IncentiveAgencies.DesktopSubRole) || CurrentUser.HasSubRole(Incentives.Agencies.IncentiveAgencies.OnsiteSubRole))
        {
            await IncentiveAgencyAsync(items, CurrentUser.HasSubRole(Incentives.Agencies.IncentiveAgencies.OnsiteSubRole), ct);
            return;
        }
        var desktop = CurrentUser.HasSubRole(SubRoles.DesktopVerification);
        var site = CurrentUser.HasSubRole(SubRoles.SiteVerification);
        const string daAllotment = "/staff/assessment/da-allotment";
        const string saAllotment = "/staff/sa-allotment";
        const string coAllotment = "/staff/site-assessment/co-allotment";

        if (!Consultancy && desktop && Opens(daAllotment))
        {
            // DA Allotment: "Allotment pending", and those the assessor rejected (to allot again).
            var rows = await Try("da-allot", async () => (await AllotmentLists.List(db, UserId, RoleId, "DA", null, AllotmentLists.Filter.None, ct))[0]);
            if (rows is not null)
                items.Add(new Item("da-allot", "Desktop assessments awaiting an assessor",
                    rows.Count(r => Empty(r, "DesktopAssessorId") || !Empty(r, "DesktopReasonForRejection")), daAllotment, null, "warn", "people"));
        }
        if (site && Opens(Consultancy ? coAllotment : saAllotment))
        {
            // SA Allotment / CO allotment: "Waiting for allotment" (no assessor, not rejected), as the pages count it.
            var rows = await Try("sa-allot", async () => (await db.QueryProcMultipleAsync("SP_ASSESSMENT_ALLOT_LIST", new
            {
                UserId,
                RoleId = ((int)UserRole.Agency).ToString(CultureInfo.InvariantCulture),
                AllotmentType = "SA",
                ZedId = (string?)null,
                CertificationType = (string?)null,
            }, ct))[0]);
            if (rows is not null)
                items.Add(new Item("sa-allot", Consultancy ? "Milestones awaiting a consultant" : "Site assessments awaiting an assessor",
                    rows.Count(r => Empty(r, "SiteAssessorId") && Empty(r, "ReasonForRejection")),
                    Consultancy ? coAllotment : saAllotment, null, "warn", "people"));
        }
        // Monitoring: the quality check tab is the agency's review; on the NC tab, the units' replies (NcStatus 2).
        if ((desktop || site) && Opens(Monitoring))
        {
            var review = await MonitoringRowsAsync("review", 5, scoped: true, ct);
            if (review is not null)
                items.Add(new Item("review", Consultancy ? "Milestones awaiting your review" : "Assessments awaiting your review", review.Count,
                    Monitoring, Query("status", "5"), "warn", "check"));
            if (!Consultancy)
            {
                var nc = await MonitoringRowsAsync("nc-replies", 4, scoped: true, ct);
                if (nc is not null)
                    items.Add(new Item("nc-replies", "NC replies awaiting review", nc.Count(r => Int(r, "NcStatus") == 2),
                        Monitoring, Query("status", "4"), "info", "chat"));
            }
        }
        if (Opens(Quality))
        {
            var open = await Try("quality-agency", async () =>
                (await db.QuerySqlAsync<int>(QualityOpenForAgencySql, new { UserId = AssessmentInput.Ansi(UserId) }, ct)).FirstOrDefault());
            if (open is not null)
                items.Add(new Item("quality-agency", "Quality observations to answer", open.Value, Quality, Query("status", "Open"), "bad", "chat"));
        }
    }

    private async Task IncentiveAgencyAsync(List<Item> items, bool onsite, CancellationToken ct)
    {
        var allotment = onsite ? "/staff/scheme-onsite/allotment" : "/staff/schemes-verify/allotment";
        var qc = onsite ? "/staff/scheme-onsite/qc" : "/staff/schemes-verify/qc";
        var store = HttpContext.RequestServices.GetRequiredService<Incentives.SchemeStore>();
        var rows = await Try("incentive-agency", async () => (await Incentives.Staff.SchemeReview.ListAsync(db, store,
            onsite ? Incentives.Staff.SchemeReview.ListOnsiteAgencySql : Incentives.Staff.SchemeReview.ListAgencySql, UserId,
            new Incentives.Staff.SchemeReview.ListFilter(null, null, null, null, null), ct)).Rows);
        if (rows is null) return;
        var toAccept = onsite ? Incentives.SchemeApplications.OnsiteWithAgency : Incentives.SchemeApplications.WithAgency;
        if (Opens(allotment))
            items.Add(new Item("scheme-accept", "Applications to accept", rows.Count(r => r.Status == toAccept), allotment, null, "warn", "people"));
        if (Opens(qc))
            items.Add(new Item("scheme-qc", "Applications awaiting your QC", rows.Count(r => r.Status == Incentives.SchemeApplications.Qc), qc, null, "info", "check"));
    }

    private async Task AssessorAsync(List<Item> items, CancellationToken ct)
    {
        var desktop = CurrentUser.HasSubRole(SubRoles.DesktopVerification);
        var site = CurrentUser.HasSubRole(SubRoles.SiteVerification);
        if (!Consultancy)
        {
            const string daVerification = "/staff/assessment/da-verification";
            if (desktop)
            {
                // Desktop Verification: "To accept" and "To assess" (accepted, not rejected), as the page counts them.
                var rows = await Try("da", async () => (await AllotmentLists.List(db, UserId, RoleId, null, null, AllotmentLists.Filter.None, ct))[0]);
                if (rows is not null)
                {
                    var open = rows.Where(r => Empty(r, "DesktopReasonForRejection")).ToList();
                    items.Add(new Item("da-accept", "Desktop assessments to accept", open.Count(r => !AllotmentLists.Flag(r, "DesktopAccepted")),
                        daVerification, null, "warn", "people"));
                    items.Add(new Item("da-assess", "Desktop assessments to assess", open.Count(r => AllotmentLists.Flag(r, "DesktopAccepted")),
                        daVerification, null, "warn", "check"));
                }
            }
            // Non-Conformances: the rounds the unit answered (NcStatus 2 at DA status 4 / SA status 14).
            var nc = await Try("nc-review", async () => (await AllotmentLists.List(db, UserId, RoleId, "NC", null, AllotmentLists.Filter.None, ct))[0]);
            if (nc is not null)
                items.Add(new Item("nc-review", "NC replies to review",
                    nc.Count(r => Int(r, "NcStatus") == 2 && Int(r, "CertificationStatus") is 4 or 14),
                    "/staff/assessment/non-conformances", null, "warn", "chat"));
            if (site)
            {
                const string remote = "/staff/remote-assessments";
                var rows = await Try("site", async () => (await db.QueryProcMultipleAsync("SP_ASSESSMENT_ALLOT_LIST",
                    new { UserId, RoleId = ((int)UserRole.DesktopAssessor).ToString(CultureInfo.InvariantCulture), AllotmentType = "RA" }, ct))[0]);
                if (rows is not null)
                {
                    var today = DateTime.Today;
                    items.Add(new Item("site-due", "Site assessments due today or overdue",
                        rows.Count(r => !ToReview(r) && DateOf(r.TryGetValue("AssessmentDate", out var d) ? d : null) is { } at && at.Date <= today),
                        remote, null, "bad", "calendar"));
                    items.Add(new Item("site-review", "Site assessments to review", rows.Count(ToReview), remote, null, "warn", "check"));
                }
            }
        }
        else if (site)
        {
            // Consultancy: the consultant's milestones (lead or co-consultant) waiting for its review (status 13 / 14).
            var count = 0;
            string? first = null;
            for (var milestone = 1; milestone <= 3; milestone++)
            {
                var n = await Try("milestone-review", async () => await MilestoneToReviewAsync(milestone, ct));
                if (n is null) return;
                count += n.Value;
                if (n > 0) first ??= "/staff/site-assessment/milestones/" + milestone.ToString(CultureInfo.InvariantCulture);
            }
            items.Add(new Item("milestone-review", "Milestones to review", count, first ?? "/staff/site-assessment/milestones/1", null, "warn", "check"));
        }
    }

    // ------------------------------------------------------------------ sources

    /// <summary>
    /// SP_MONITORING_GET_LIST on one tab for every level of the portal (the page asks one level at a time), as
    /// MonitoringController calls it (ZED_CONSULTANT's version has no @NcClosingDate); within the login's scope.
    /// </summary>
    private async Task<List<IDictionary<string, object?>>?> MonitoringRowsAsync(string what, int status, bool scoped, CancellationToken ct) =>
        await Try(what, async () =>
        {
            var scope = await HttpContext.LoginScopeAsync(ct);
            IEnumerable<string> levels = Consultancy ? LevelRegistry.Handholding : SiteAssessment.AssessmentInputs.Levels;
            var rows = new List<IDictionary<string, object?>>();
            foreach (var level in levels.Where(l => !scope.IsLimited || scope.AllowsLevel(l)))
            {
                var sets = Consultancy
                    ? await db.QueryProcMultipleAsync("SP_MONITORING_GET_LIST", new
                    {
                        UserId, RoleId = RoleId.ToString(CultureInfo.InvariantCulture), Status = (int?)status, CertificationType = level, ZedId = (string?)null,
                    }, ct)
                    : await db.QueryProcMultipleAsync("SP_MONITORING_GET_LIST", new
                    {
                        UserId, RoleId = RoleId.ToString(CultureInfo.InvariantCulture), Status = (int?)status, CertificationType = level, ZedId = (string?)null,
                        NcClosingDate = (string?)null,
                    }, ct);
                rows.AddRange(sets[0]);
            }
            return scoped ? await ScopeFilter.ApplyAsync(HttpContext, rows, ct) : rows;
        });

    /// <summary>The consultant's milestone list (the RA branch with @Milestone, kept to its own units as the page does), status 13 / 14.</summary>
    private async Task<int> MilestoneToReviewAsync(int milestone, CancellationToken ct)
    {
        var sets = await db.QueryProcMultipleAsync("SP_ASSESSMENT_ALLOT_LIST",
            new { UserId, RoleId = ((int)UserRole.DesktopAssessor).ToString(CultureInfo.InvariantCulture), AllotmentType = "RA", Milestone = milestone }, ct);
        var members = await db.QuerySqlAsync<SiteAssessment.ConsultancyAllotmentController.MembershipRow>(
            SiteAssessment.ConsultancyAllotmentController.MilestoneMembershipSql, new
            {
                Milestone = milestone,
                UserId = AssessmentInput.Ansi(UserId),
                CoPattern = AssessmentInput.Ansi("%" + UserId + "%", 60),
            }, ct);
        var mine = members
            .Where(m => string.Equals(m.SiteAssessorId?.Trim(), UserId, StringComparison.OrdinalIgnoreCase)
                        || (m.CoAssessorId ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                            .Contains(UserId, StringComparer.OrdinalIgnoreCase))
            .Select(m => Unit(m.ZedId, m.Certification))
            .ToHashSet();
        return sets[0].Count(r => mine.Contains(Unit(r.Text("ZedId"), r.Text("Certification"))) && ToReview(r));
    }

    // ------------------------------------------------------------------ helpers

    /// <summary>A sub-user (2026-11-24: and an Incentives Master Admin) lists only the pages it was given; the owner every page of its role.</summary>
    private bool Opens(string route) =>
        (!CurrentUser.IsSubUser && !Users.IncentivesAdmins.Is(CurrentUser)) || (CurrentUser.PermissionRoutes ?? []).Contains(route, StringComparer.OrdinalIgnoreCase);

    /// <summary>One source; a database that cannot answer it (a procedure or table missing on this portal) drops the item.</summary>
    private async Task<T?> Try<T>(string what, Func<Task<T>> read) where T : class
    {
        try
        {
            return await read();
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Attention item {Item} not read on {System}", what, host.System);
            return null;
        }
    }

    private async Task<int?> Try(string what, Func<Task<int>> read)
    {
        try
        {
            return await read();
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Attention item {Item} not read on {System}", what, host.System);
            return null;
        }
    }

    private static IReadOnlyDictionary<string, string> Query(string name, string value) => new Dictionary<string, string> { [name] = value };

    private static bool Empty(IDictionary<string, object?> row, string column) => row.Text(column).Trim().Length == 0;

    private static int Int(IDictionary<string, object?> row, string column) =>
        int.TryParse(row.Text(column).Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) ? n : 0;

    /// <summary>Meetings done (13) or NC answered (14): the assessor's review, as the remote and milestone pages show it.</summary>
    private static bool ToReview(IDictionary<string, object?> row) => Int(row, "CertificationStatus") is 13 or 14;

    private static string Unit(string? zedId, string? level) => (zedId ?? "").Trim().ToUpperInvariant() + "|" + (level ?? "").Trim().ToUpperInvariant();

    /// <summary>The NC final closure date: the procedure's datetime (NcFinalClosureDtOrg), else its text ("October 30, 2026").</summary>
    private static DateTime? ClosureDate(IDictionary<string, object?> row) =>
        DateOf(row.TryGetValue("NcFinalClosureDtOrg", out var org) ? org : null)
        ?? DateOf(row.TryGetValue("NcFinalClosureDt", out var text) ? text : null);

    private static readonly string[] DateFormats = ["MMMM d, yyyy", "MMMM dd, yyyy", "yyyy-MM-dd", "yyyy-MM-ddTHH:mm:ss", "dd-MM-yyyy", "dd/MM/yyyy"];

    internal static DateTime? DateOf(object? value) => value switch
    {
        DateTime d => d,
        DateTimeOffset o => o.LocalDateTime,
        string s when DateTime.TryParseExact(s.Trim(), DateFormats, CultureInfo.InvariantCulture, DateTimeStyles.AllowWhiteSpaces, out var d) => d,
        string s when DateTime.TryParse(s.Trim(), CultureInfo.InvariantCulture, DateTimeStyles.AllowWhiteSpaces, out var d) => d,
        _ => null,
    };
}
