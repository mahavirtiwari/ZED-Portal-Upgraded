using System.Data.Common;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.Schemes;
using Zed.Portal.Features.Staff.Users;
using static Zed.Portal.Features.Incentives.SchemeApplications;

namespace Zed.Portal.Features.Incentives.Staff;

/// <summary>
/// 2026-11-24 (the product owner: "please create similar dashboard for the incentives"): the incentives dashboard, the Incentives
/// Master Admin's home (Users/IncentivesAdmins), laid out as the Master Admin's dashboard: headline figures, one card per scheme
/// (its applications by stage), the Financial Assistance card, the applications per month and per state. Within the login's scope
/// (states, levels, category) as Scheme Applications and Financial Assistance; filtered by scheme, state and submitted from / to.
/// </summary>
/// 2026-11-26 (the user, signed in as an incentive verification agency: "Dashboard is still same as main certification assessment
/// agency dashboard"): an incentive verification agency (and its sub-users) has it too, with the applications allotted to it only
/// (a desktop agency: the desktop allotment; an onsite agency: the onsite one), no Financial Assistance and no agency counts.
[Route(IncentivesAdmins.DashboardApi)]
[StaffRoles(UserRole.MasterAdmin, UserRole.Agency)]
[PortalSystems(PortalSystem.Main)]
public sealed class IncentivesDashboardController(ISqlExecutor db, SchemeStore store, ILogger<IncentivesDashboardController> log) : StaffApiController
{
    /// <summary>The applications with the desktop verification (allotment, assessor, corrections), the onsite stage, the final QC.</summary>
    public static readonly IReadOnlySet<string> DesktopStatuses = new HashSet<string> { Submitted, WithAgency, WithAssessor, Verifying, Correction };
    public static readonly IReadOnlySet<string> OnsiteStatuses = new HashSet<string> { OnsiteAllot, OnsiteWithAgency, OnsiteWithAssessor, OnsiteVisit };

    /// <summary>The Financial Assistance (Bronze / Silver / Gold) rows, not the scheme ones (same table).</summary>
    internal const string FaSql =
        "SELECT F.ZedId, F.CertificationType, F.VerificationStatus, F.CertificationBodyUserId, F.CreatedDate, M.PStateName " +
        "FROM dbo.FinancialAssistance F OUTER APPLY (SELECT TOP 1 X.PStateName FROM dbo.Msme X WHERE X.ZedId = F.ZedId) M " +
        "WHERE F.SchemeCode IS NULL AND F.CertificationType IN ('Bronze', 'Silver', 'Gold');";

    internal const string AgenciesSql =
        "SELECT UserId, AgencyKind FROM dbo.Users WHERE RoleId = 2 AND IsActive = 1 AND AgencyKind IN ('SchemeDesktop', 'SchemeOnsite');";

    public sealed class FaRow
    {
        public string? ZedId { get; init; }
        public string? CertificationType { get; init; }
        public int? VerificationStatus { get; init; }
        public string? CertificationBodyUserId { get; init; }
        public DateTime? CreatedDate { get; init; }
        public string? PStateName { get; init; }
    }

    public sealed class AgencyRow
    {
        public string? UserId { get; init; }
        public string? AgencyKind { get; init; }
    }

    public sealed record Headline(int Applications, int InVerification, int Approved, int Paid, int Rejected, int OnHold,
        decimal ClaimAmount, decimal ApprovedAmount, decimal PaidAmount, int DesktopAgencies, int OnsiteAgencies);

    /// <param name="Desktop">Allotment, the desktop assessor and corrections (<see cref="DesktopStatuses"/>).</param>
    /// <param name="Approved">Approved, not yet paid.</param>
    public sealed record SchemeCard(string Code, string Name, int Total, int Desktop, int Onsite, int Qc, int Approved, int Paid, int Rejected, int OnHold,
        decimal ClaimAmount, decimal ApprovedAmount);

    /// <param name="ToAllot">New, no agency yet.</param>
    /// <param name="InVerification">New with an agency, with the assessor, the agency's QC.</param>
    public sealed record FaCard(int Total, int ToAllot, int InVerification, int Approved, int Reimbursed, int Rejected);

    public sealed record MonthPoint(string Month, int Submitted, int Approved, int Rejected);

    public sealed record StateRow(string State, int Total, int InVerification, int Approved, int Paid, int Rejected);

    public sealed record Option(string Code, string Name);

    /// <param name="Agency">2026-11-26: "Desktop" / "Onsite" for an incentive verification agency (its own applications), null for the
    /// Master Admins.</param>
    public sealed record DashboardResponse(DateTime GeneratedAt, Headline Headline, IReadOnlyList<SchemeCard> Schemes, FaCard Fa,
        IReadOnlyList<MonthPoint> Months, IReadOnlyList<StateRow> States, IReadOnlyList<Option> SchemeOptions, IReadOnlyList<string> StateOptions,
        string? Agency = null);

    /// <summary>The signed-in incentive verification agency's kind ("Desktop" / "Onsite"); null for a Master Admin, "" for another agency.</summary>
    private string? AgencyKind()
    {
        if (!IsRole(UserRole.Agency)) return null;
        var subRoles = CurrentUser.SubRoles ?? [];
        return subRoles.Contains(Agencies.IncentiveAgencies.OnsiteSubRole) ? "Onsite"
            : subRoles.Contains(Agencies.IncentiveAgencies.DesktopSubRole) ? "Desktop" : "";
    }

    /// <summary>GET api/staff/incentives-dashboard?scheme=&amp;state=&amp;from=&amp;to=</summary>
    [HttpGet]
    public async Task<ActionResult<DashboardResponse>> Get([FromQuery] string? scheme, [FromQuery] string? state, [FromQuery] DateOnly? from,
        [FromQuery] DateOnly? to, CancellationToken ct)
    {
        if (SchemeReview.Filter(scheme, null, state, from, to, out var problem) is not { } filter) return this.Problem400(problem!);
        var kind = AgencyKind();
        // An assessment agency has the certification dashboard (this one is the incentive agencies' and the Master Admins').
        if (kind == "") return StatusCode(StatusCodes.Status403Forbidden);
        var all = await SchemeRowsAsync(ct);
        var mine = kind is null ? all.Rows : all.Rows.Where(r => string.Equals(kind == "Onsite" ? r.OnsiteAgency?.Trim() : r.Agency?.Trim(), UserId, StringComparison.OrdinalIgnoreCase)).ToList();
        all = all with { Rows = mine };
        var rows = all.Rows.Where(filter.MatchesBase).ToList();
        // The Financial Assistance (Bronze / Silver / Gold) is verified by assessment agencies: not on an incentive agency's dashboard.
        var fa = (kind is not null ? [] : await FaRowsAsync(ct)).Where(r => (filter.State is null || string.Equals(r.PStateName?.Trim(), filter.State, StringComparison.OrdinalIgnoreCase))
            && (filter.From is null || (r.CreatedDate is { } c && DateOnly.FromDateTime(c) >= filter.From))
            && (filter.To is null || (r.CreatedDate is { } d && DateOnly.FromDateTime(d) <= filter.To))).ToList();
        var agencies = kind is null ? await AgenciesAsync(ct) : [];

        var headline = new Headline(rows.Count, rows.Count(r => InVerification(r.Status)), rows.Count(r => r.Status == Approved), rows.Count(r => r.Status == Paid),
            rows.Count(r => r.Status == Rejected), rows.Count(r => r.Status == OnHold), rows.Sum(r => r.ClaimAmount ?? 0),
            rows.Where(r => r.Status is Approved or Paid).Sum(r => r.ApprovedAmount ?? 0), rows.Where(r => r.Status == Paid).Sum(r => r.ApprovedAmount ?? 0),
            agencies.Count(a => Agencies.IncentiveAgencies.IsDesktop(a.AgencyKind)), agencies.Count(a => Agencies.IncentiveAgencies.IsOnsite(a.AgencyKind)));

        // Every scheme the Admin defined (with none yet: 0), then a code no longer defined that still has applications.
        var cards = all.Schemes.Where(s => filter.Scheme is null || string.Equals(s.Code, filter.Scheme, StringComparison.OrdinalIgnoreCase))
            .Select(s => Card(s.Code, s.Name, rows.Where(r => string.Equals(r.SchemeCode, s.Code, StringComparison.OrdinalIgnoreCase)).ToList()))
            .ToList();

        var today = DateTime.Today;
        var first = new DateTime(today.Year, today.Month, 1).AddMonths(-11);
        var months = Enumerable.Range(0, 12).Select(i => first.AddMonths(i)).Select(m => new MonthPoint(m.ToString("yyyy-MM"),
            rows.Count(r => r.SubmittedOn is { } s && s.Year == m.Year && s.Month == m.Month),
            rows.Count(r => r.Status is Approved or Paid && r.DecidedOn is { } d && d.Year == m.Year && d.Month == m.Month),
            rows.Count(r => r.Status == Rejected && r.DecidedOn is { } d && d.Year == m.Year && d.Month == m.Month))).ToList();

        var states = rows.GroupBy(r => string.IsNullOrWhiteSpace(r.State) ? "-" : r.State!, StringComparer.OrdinalIgnoreCase)
            .Select(g => new StateRow(g.Key, g.Count(), g.Count(r => InVerification(r.Status)), g.Count(r => r.Status == Approved), g.Count(r => r.Status == Paid),
                g.Count(r => r.Status == Rejected)))
            .OrderByDescending(s => s.Total).ThenBy(s => s.State, StringComparer.Ordinal).ToList();

        var faCard = new FaCard(fa.Count, fa.Count(r => r.VerificationStatus == FaStatus.New && string.IsNullOrWhiteSpace(r.CertificationBodyUserId)),
            fa.Count(r => (r.VerificationStatus == FaStatus.New && !string.IsNullOrWhiteSpace(r.CertificationBodyUserId)) || r.VerificationStatus is FaStatus.InProgress or FaStatus.Qc),
            fa.Count(r => r.VerificationStatus == FaStatus.Approved), fa.Count(r => r.VerificationStatus == FaStatus.Reimbursed),
            fa.Count(r => r.VerificationStatus == FaStatus.Rejected));

        var stateOptions = all.Rows.Select(r => r.State).Concat(fa.Select(r => r.PStateName?.Trim())).Where(s => !string.IsNullOrWhiteSpace(s)).Select(s => s!)
            .Distinct(StringComparer.OrdinalIgnoreCase).Order(StringComparer.Ordinal).ToList();
        return new DashboardResponse(DateTime.Now, headline, cards, faCard, months, states,
            all.Schemes.Select(s => new Option(s.Code, s.Name)).ToList(), stateOptions, kind);
    }

    private static bool InVerification(string status) => DesktopStatuses.Contains(status) || OnsiteStatuses.Contains(status) || status == Qc;

    private static SchemeCard Card(string code, string name, List<SchemeReview.ListItem> rows) =>
        new(code, name, rows.Count, rows.Count(r => DesktopStatuses.Contains(r.Status)), rows.Count(r => OnsiteStatuses.Contains(r.Status)),
            rows.Count(r => r.Status == Qc), rows.Count(r => r.Status == Approved), rows.Count(r => r.Status == Paid), rows.Count(r => r.Status == Rejected),
            rows.Count(r => r.Status == OnHold), rows.Sum(r => r.ClaimAmount ?? 0), rows.Where(r => r.Status is Approved or Paid).Sum(r => r.ApprovedAmount ?? 0));

    private sealed record SchemeData(IReadOnlyList<SchemeReview.ListItem> Rows, IReadOnlyList<SchemeReview.Option> Schemes);

    /// <summary>Every submitted scheme application in the login's scope, and the schemes (as Scheme Applications lists them).</summary>
    private async Task<SchemeData> SchemeRowsAsync(CancellationToken ct)
    {
        var list = await SchemeReview.ListAsync(db, store, SchemeReview.ListAllSql, null, new SchemeReview.ListFilter(null, null, null, null, null), ct,
            rows => ScopeFilter.ApplyAsync(HttpContext, rows, r => r.ZedId, r => r.Level, ct));
        return new SchemeData(list.Rows, list.Schemes);
    }

    private async Task<List<FaRow>> FaRowsAsync(CancellationToken ct)
    {
        try
        {
            return await ScopeFilter.ApplyAsync(HttpContext, await db.QuerySqlAsync<FaRow>(FaSql, null, ct), r => r.ZedId, r => r.CertificationType, ct);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Incentives dashboard: Financial Assistance not counted (is migration 0105 applied?)");
            return [];
        }
    }

    private async Task<List<AgencyRow>> AgenciesAsync(CancellationToken ct)
    {
        try
        {
            var scope = await HttpContext.LoginScopeAsync(ct);
            return (await db.QuerySqlAsync<AgencyRow>(AgenciesSql, null, ct)).Where(a => scope.AllowsAgency(a.UserId)).ToList();
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Incentives dashboard: verification agencies not counted (is migration 0106 applied?)");
            return [];
        }
    }

    // ----- "Needs your attention" (AttentionController, for an Incentives Master Admin) -----

    public sealed record AttentionCounts(int SchemeToAllot, int OnsiteToAllot, int OnHold, int FaToAllot);

    /// <summary>The work waiting on the Incentives Master Admin, in its scope: the bell and the dashboard's attention row.</summary>
    public static async Task<AttentionCounts> AttentionAsync(HttpContext http, ISqlExecutor db, SchemeStore store, CancellationToken ct)
    {
        var list = await SchemeReview.ListAsync(db, store, SchemeReview.ListAllSql, null, new SchemeReview.ListFilter(null, null, null, null, null), ct,
            rows => ScopeFilter.ApplyAsync(http, rows, r => r.ZedId, r => r.Level, ct));
        var fa = await ScopeFilter.ApplyAsync(http, await db.QuerySqlAsync<FaRow>(FaSql, null, ct), r => r.ZedId, r => r.CertificationType, ct);
        return new AttentionCounts(
            list.Rows.Count(r => r.Status == Submitted),
            list.Rows.Count(r => r.Status == OnsiteAllot && string.Equals(r.OnsiteAllotmentType, Onsite.OnsiteAllotment.WaitsForMasterAdmin, StringComparison.OrdinalIgnoreCase)),
            list.Rows.Count(r => r.Status == OnHold),
            fa.Count(r => r.VerificationStatus == FaStatus.New && string.IsNullOrWhiteSpace(r.CertificationBodyUserId)));
    }
}
