using System.Net;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.Assessment;
using Zed.Portal.Features.Staff.Users;

namespace Zed.Portal.Features.Staff.Quality;

/// <summary>
/// 2026-11-16 (approved): the Master Admin's and its operation admins' quality observations on an assessment (desktop,
/// remote / onsite, NC rounds, after certification, handholding milestones), the assessment agency's replies, close and
/// reopen, with the full time history (<see cref="QualityObservations"/>), and the dashboard that ranks the agencies and
/// assessors. An operation admin needs the "Quality observations" screen and stays within its states and agencies
/// (<see cref="ScopeAccessFilter"/>, <see cref="ScopeFilter"/>). The assessor sees the observations about its own work,
/// read-only; the MSME never sees them. Open major / critical ones hold the agency's final submit until it replies.
/// </summary>
[Route("api/staff/quality-observations")]
[StaffRoles(UserRole.MasterAdmin, UserRole.Agency, UserRole.DesktopAssessor)]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed class QualityObservationsController(
    ISqlExecutor db,
    PortalHost host,
    IEmailSender email,
    IPortalSettings settings,
    ILogger<QualityObservationsController> log) : StaffApiController
{
    public sealed record UnitView(bool CanRaise, bool CanRespond, bool CanClose, IReadOnlyList<QualityObservations.Observation> Items)
    {
        /// <summary>2026-11-17: the Admin's reasons in use on this portal, each with its severity (Admin → Observation reasons).</summary>
        public IReadOnlyList<ReasonOption> Reasons { get; init; } = [];
    }

    public sealed record ReasonOption(string Id, string Text, string Severity);

    /// <param name="Category">The reason's key (or its wording); the severity is the reason's (2026-11-17, the user).</param>
    public sealed record RaiseRequest(string? RefType, string? RefId, string? RefLabel, string? Category, string? About, string? Text);

    public sealed record TextRequest(string? Text);

    public sealed record ListView(IReadOnlyList<QualityObservations.Observation> Items, bool CanClose);

    public sealed record DashboardView(
        IReadOnlyList<QualityObservations.Standing> Agencies, IReadOnlyList<QualityObservations.Standing> Assessors,
        int Total, int Open, int Responded, int Closed, double? AvgReplyHours, double? AvgCloseHours,
        IReadOnlyList<CategoryCount> Categories);

    public sealed record CategoryCount(string Category, int Total, int Major);

    private bool IsMaster => RoleId == (int)UserRole.MasterAdmin;
    private bool Milestones => host.System == PortalSystem.Consultancy;
    private string By => CurrentUser.IsSubUser ? CurrentUser.ActingUserId! : UserId;
    private string ByName => (CurrentUser.IsSubUser ? CurrentUser.ActingUserName : CurrentUser.UserName) ?? By;

    // ------------------------------------------------------------------ one unit

    [HttpGet("{zedId}/{certification}")]
    public async Task<ActionResult<UnitView>> Unit(string zedId, string certification, CancellationToken ct)
    {
        var (level, record, error) = await RecordAsync(zedId, certification, ct);
        if (error is not null) return error;
        var rows = await db.QuerySqlAsync<QualityObservations.Row>(QualityObservations.UnitSql, Args(zedId, level!), ct);
        var items = QualityObservations.Build(rows, await NamesAsync(rows, ct));
        // An assessor sees what is about its own work.
        if (RoleId == (int)UserRole.DesktopAssessor)
            items = items.Where(o => o.About != "Agency" && string.Equals(o.AboutUserId, UserId, StringComparison.OrdinalIgnoreCase)).ToList();
        var agency = RoleId == (int)UserRole.Agency && Same(record!.CertificationBodyUserId, UserId);
        var reasons = IsMaster
            ? (await ObservationReasons.LoadAsync(settings, Milestones, ct)).Where(r => r.Active).Select(r => new ReasonOption(r.Id, r.Text, r.Severity)).ToList()
            : [];
        return new UnitView(IsMaster, agency, IsMaster, items) { Reasons = reasons };
    }

    [HttpPost("{zedId}/{certification}")]
    [StaffRoles(UserRole.MasterAdmin)]
    public async Task<ActionResult<MessageResponse>> Raise(string zedId, string certification, RaiseRequest req, CancellationToken ct)
    {
        var (level, record, error) = await RecordAsync(zedId, certification, ct);
        if (error is not null) return error;
        var text = AssessmentInput.Text(req.Text);
        if (text is null) return this.Problem400("Please write the observation.");
        if (text.Length > QualityObservations.MaxText) return this.Problem400($"The observation can be up to {QualityObservations.MaxText} characters.");
        if (ObservationReasons.Find(await ObservationReasons.LoadAsync(settings, Milestones, ct), req.Category) is not { } reason)
            return this.Problem400("Please choose the reason.");
        var (category, severity) = (reason.Text, reason.Severity);
        if (Pick(req.About, QualityObservations.Abouts) is not { } about) return this.Problem400("Please choose whom the observation is about.");
        var refType = Pick(req.RefType ?? "Overall", QualityObservations.RefTypes);
        if (refType is null) return this.Problem400("Invalid item.");
        var aboutUser = QualityObservations.AboutUserOf(record!, about);
        var (agencyWord, assessorWord) = Milestones ? ("consultant organisation", "consultant") : ("agency", "assessor");
        if (string.IsNullOrWhiteSpace(aboutUser))
            return this.Problem400(about == "Agency" ? $"No {agencyWord} is allotted yet." : $"No such {assessorWord} is allotted to this {(Milestones ? "milestone" : "assessment")}.");
        var agencyId = record!.CertificationBodyUserId?.Trim();
        if (string.IsNullOrWhiteSpace(agencyId)) return this.Problem400($"No {agencyWord} is allotted yet.");

        var id = (await db.QuerySqlAsync<long>(QualityObservations.InsertSql, new
        {
            ZedId = AssessmentInput.Ansi(zedId), Certification = AssessmentInput.Ansi(level!), Text = AssessmentInput.Ansi(text, 5000),
            Type = QualityObservations.ObservationType, Status = QualityObservations.Open, ParentId = (int?)null, Round = record.Nc,
            Stage = QualityObservations.StageOf(record, Milestones), RefType = refType, RefId = Short(req.RefId, 100),
            RefLabel = Short(req.RefLabel, 300), Category = category, Severity = severity, About = about, AboutUserId = aboutUser, AgencyId = agencyId,
            By, ByName = Short(ByName, 150),
        }, ct)).First();
        await StepAsync(id, zedId, level!, QualityObservations.Raised, null, ct);
        await HistoryAsync(zedId, level!, $"Quality observation ({severity}, {category}) raised by {ByName}", ct);
        log.LogInformation("{By} raised quality observation {Id} ({Severity}) on {ZedId} {Level}", By, id, severity, zedId, level);

        var mailed = await MailAgencyAsync(agencyId, zedId, level!, severity, category, req.RefLabel, text, ct);
        return new MessageResponse(mailed ? $"Observation raised. The {(Milestones ? "consultant organisation" : "agency")} has been mailed." : "Observation raised.");
    }

    [HttpPost("items/{id:long}/respond")]
    [StaffRoles(UserRole.Agency)]
    public async Task<ActionResult<MessageResponse>> Respond(long id, TextRequest req, CancellationToken ct)
    {
        var (row, error) = await ObservationAsync(id, ct);
        if (error is not null) return error;
        if (!Same(row!.QoAgencyId, UserId)) return NotFound();
        // 2026-11-27 (permissions review): an agency sub-user with its own states replies only on its units, as Close / Reopen check.
        if (!await ScopeFilter.AllowsAsync(HttpContext, row.ZedId, row.Certification, ct)) return NotFound();
        if (row.QoStatus == QualityObservations.Closed) return this.Problem400("This observation is closed.");
        var text = AssessmentInput.Text(req.Text);
        if (text is null) return this.Problem400("Please write your reply.");
        if (text.Length > QualityObservations.MaxText) return this.Problem400($"The reply can be up to {QualityObservations.MaxText} characters.");
        await db.ExecuteSqlAsync(QualityObservations.StatusSql, new { Id = id, Status = QualityObservations.Responded }, ct);
        await StepAsync(id, row.ZedId!, row.Certification!, QualityObservations.Responded, text, ct);
        await HistoryAsync(row.ZedId!, row.Certification!, $"{(Milestones ? "Consultant organisation" : "Agency")} replied to a quality observation ({ByName})", ct);
        return new MessageResponse("Reply sent.");
    }

    [HttpPost("items/{id:long}/close")]
    [StaffRoles(UserRole.MasterAdmin)]
    public Task<ActionResult<MessageResponse>> Close(long id, TextRequest req, CancellationToken ct) =>
        ChangeAsync(id, req, QualityObservations.Closed, QualityObservations.Closed, noteRequired: false, "Observation closed.", ct);

    [HttpPost("items/{id:long}/reopen")]
    [StaffRoles(UserRole.MasterAdmin)]
    public Task<ActionResult<MessageResponse>> Reopen(long id, TextRequest req, CancellationToken ct) =>
        ChangeAsync(id, req, QualityObservations.Open, QualityObservations.Reopened, noteRequired: true, "Observation reopened.", ct);

    private async Task<ActionResult<MessageResponse>> ChangeAsync(long id, TextRequest req, string status, string step, bool noteRequired, string done,
        CancellationToken ct)
    {
        var (row, error) = await ObservationAsync(id, ct);
        if (error is not null) return error;
        if (!await ScopeFilter.AllowsAsync(HttpContext, row!.ZedId, row.Certification, ct)) return NotFound();
        if ((status == QualityObservations.Closed) == (row.QoStatus == QualityObservations.Closed))
            return this.Problem400(status == QualityObservations.Closed ? "This observation is already closed." : "Only a closed observation can be reopened.");
        var note = AssessmentInput.Text(req.Text);
        if (noteRequired && note is null) return this.Problem400("Please write why it is reopened.");
        if (note?.Length > QualityObservations.MaxText) return this.Problem400($"The note can be up to {QualityObservations.MaxText} characters.");
        await db.ExecuteSqlAsync(QualityObservations.StatusSql, new { Id = id, Status = status }, ct);
        await StepAsync(id, row.ZedId!, row.Certification!, step, note, ct);
        await HistoryAsync(row.ZedId!, row.Certification!, $"Quality observation {step.ToLowerInvariant()} by {ByName}", ct);
        return new MessageResponse(done);
    }

    // ------------------------------------------------------------------ lists and dashboard

    /// <summary>
    /// The Master Admin's (within its scope), an agency's own, or an assessor's observations; status = Open / Responded / Closed.
    /// 2026-11-18 (the user): the period (days, or from / to as yyyy-MM-dd on the date raised) and the certification level.
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<ListView>> List(string? status, int? days, string? from, string? to, string? level, CancellationToken ct)
    {
        if (status is not null && Pick(status, [QualityObservations.Open, QualityObservations.Responded, QualityObservations.Closed]) is null)
            return this.Problem400("Invalid status.");
        if (Period(days, from, to, level, out var period) is { } bad) return bad;
        var items = await VisibleAsync(period, ct);
        if (status is not null) items = items.Where(o => string.Equals(o.Status, status, StringComparison.OrdinalIgnoreCase)).ToList();
        return new ListView(items, IsMaster);
    }

    [HttpGet("dashboard")]
    [StaffRoles(UserRole.MasterAdmin)]
    public async Task<ActionResult<DashboardView>> Dashboard(int? days, string? from, string? to, string? level, CancellationToken ct)
    {
        if (Period(days, from, to, level, out var period) is { } bad) return bad;
        var items = await VisibleAsync(period, ct);
        var replies = items.Where(o => o.ReplyHours is not null).Select(o => o.ReplyHours!.Value).ToList();
        var closes = items.Where(o => o.CloseHours is not null).Select(o => o.CloseHours!.Value).ToList();
        return new DashboardView(
            QualityObservations.Rank(items, "Agency"), QualityObservations.Rank(items, "Assessor"),
            items.Count, items.Count(o => o.Status == QualityObservations.Open), items.Count(o => o.Status == QualityObservations.Responded),
            items.Count(o => o.Status == QualityObservations.Closed),
            replies.Count > 0 ? Math.Round(replies.Average(), 1) : null, closes.Count > 0 ? Math.Round(closes.Average(), 1) : null,
            items.GroupBy(o => o.Category ?? "Other").Select(g => new CategoryCount(g.Key, g.Count(), g.Count(o => o.Severity is "Major" or "Critical")))
                .OrderByDescending(c => c.Total).ToList());
    }

    /// <summary>The lists' and the dashboard's filter: raised on or after From, before Before (the day after "To"), of one level.</summary>
    public sealed record ObservationPeriod(DateTime From, DateTime? Before, string? Level);

    /// <summary>
    /// The period (a preset of days, or the custom From / To dates, each yyyy-MM-dd or dd-MM-yyyy, To not before From, neither
    /// after today) and the certification level (Administration → Certification Levels); null when valid, else the 400.
    /// </summary>
    private ActionResult? Period(int? days, string? from, string? to, string? level, out ObservationPeriod period)
    {
        period = null!;
        if (!TryDate(from, out var start) || !TryDate(to, out var end)) return this.Problem400("Please enter valid dates (dd-mm-yyyy).");
        var today = DateOnly.FromDateTime(DateTime.UtcNow.AddMinutes(330));   // India time
        if (start > today || end > today) return this.Problem400("The dates cannot be after today.");
        if (start is not null && end is not null && end < start) return this.Problem400("The To date cannot be before the From date.");
        string? code = null;
        if (!string.IsNullOrWhiteSpace(level) && (code = AssessmentInput.Level(level)) is null) return this.Problem400("Invalid certification level.");
        period = new ObservationPeriod(
            start?.ToDateTime(TimeOnly.MinValue) ?? DateTime.Today.AddDays(-Math.Clamp(days ?? 3650, 1, 3650)),
            end?.AddDays(1).ToDateTime(TimeOnly.MinValue), code);
        return null;
    }

    private static readonly string[] DateFormats = ["yyyy-MM-dd", "dd-MM-yyyy"];

    private static bool TryDate(string? value, out DateOnly? date)
    {
        date = null;
        if (string.IsNullOrWhiteSpace(value)) return true;
        if (!DateOnly.TryParseExact(value.Trim(), DateFormats, System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.None, out var d) || d.Year < 2000) return false;
        date = d;
        return true;
    }

    private async Task<List<QualityObservations.Observation>> VisibleAsync(ObservationPeriod period, CancellationToken ct)
    {
        IReadOnlyList<QualityObservations.Row> rows;
        try
        {
            rows = await db.QuerySqlAsync<QualityObservations.Row>(QualityObservations.AllSql,
                new { period.From, period.Before, Certification = AssessmentInput.Ansi(period.Level) }, ct);
        }
        catch (System.Data.Common.DbException ex)
        {
            log.LogWarning(ex, "Quality observations not readable (is migration 0088 applied?)");
            return [];
        }
        var items = QualityObservations.Build(rows, await NamesAsync(rows, ct));
        if (RoleId == (int)UserRole.Agency) return items.Where(o => Same(o.AgencyId, UserId)).ToList();
        if (RoleId == (int)UserRole.DesktopAssessor)
            return items.Where(o => o.About != "Agency" && Same(o.AboutUserId, UserId)).ToList();
        return await ScopeFilter.ApplyAsync(HttpContext, items, o => o.ZedId, o => o.Certification, ct);
    }

    // ------------------------------------------------------------------ helpers

    private async Task<(string? Level, CertificationRecord? Record, ActionResult? Error)> RecordAsync(string zedId, string certification, CancellationToken ct)
    {
        if (!AssessmentInput.IsId(zedId) || AssessmentInput.Level(certification) is not { } level) return (null, null, this.Problem400("Invalid request."));
        var record = await AssessmentRecords.CertificationAsync(db, zedId, level, ct);
        if (record is null || !record.CanView(CurrentUser)) return (level, null, NotFound());
        return (level, record, null);
    }

    private async Task<(QualityObservations.Row? Row, ActionResult? Error)> ObservationAsync(long id, CancellationToken ct)
    {
        var row = (await db.QuerySqlAsync<QualityObservations.Row>(QualityObservations.OneSql, new { Id = id }, ct)).FirstOrDefault();
        return row is null || string.IsNullOrWhiteSpace(row.ZedId) ? (null, NotFound()) : (row, null);
    }

    private Task StepAsync(long parentId, string zedId, string level, string step, string? text, CancellationToken ct) =>
        db.QuerySqlAsync<long>(QualityObservations.InsertSql, new
        {
            ZedId = AssessmentInput.Ansi(zedId), Certification = AssessmentInput.Ansi(level), Text = AssessmentInput.Ansi(text, 5000),
            Type = QualityObservations.EventType, Status = step, ParentId = (int?)parentId, Round = (int?)null, Stage = (string?)null,
            RefType = (string?)null, RefId = (string?)null, RefLabel = (string?)null, Category = (string?)null, Severity = (string?)null,
            About = (string?)null, AboutUserId = (string?)null, AgencyId = (string?)null, By, ByName = Short(ByName, 150),
        }, ct);

    private async Task HistoryAsync(string zedId, string level, string text, CancellationToken ct)
    {
        try
        {
            await db.ExecuteSqlAsync(QualityObservations.HistorySql,
                new { ZedId = AssessmentInput.Ansi(zedId), Certification = AssessmentInput.Ansi(level), Descrip = AssessmentInput.Ansi(text, 2000) }, ct);
        }
        catch (System.Data.Common.DbException ex)
        {
            log.LogWarning(ex, "History line of {ZedId} {Level} not written", zedId, level);
        }
    }

    private async Task<IReadOnlyDictionary<string, string>> NamesAsync(IReadOnlyList<QualityObservations.Row> rows, CancellationToken ct)
    {
        var ids = rows.SelectMany(r => new[] { r.QoAboutUserId, r.QoAgencyId }).Where(i => !string.IsNullOrWhiteSpace(i)).Select(i => i!.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        if (ids.Length == 0) return new Dictionary<string, string>();
        var users = await db.QuerySqlAsync<QualityObservations.UserRow>(QualityObservations.NamesSql, new { Ids = ids }, ct);
        return users.Where(u => !string.IsNullOrWhiteSpace(u.UserId) && !string.IsNullOrWhiteSpace(u.UserName))
            .GroupBy(u => u.UserId!.Trim(), StringComparer.OrdinalIgnoreCase).ToDictionary(g => g.Key, g => g.First().UserName!.Trim(), StringComparer.OrdinalIgnoreCase);
    }

    private async Task<bool> MailAgencyAsync(string agencyId, string zedId, string level, string severity, string category, string? about, string text, CancellationToken ct)
    {
        try
        {
            var agency = (await db.QuerySqlAsync<QualityObservations.UserRow>(QualityObservations.NamesSql, new { Ids = new[] { agencyId } }, ct)).FirstOrDefault();
            if (agency?.Email?.Trim() is not { Length: > 0 } to) return false;
            var what = Milestones ? "handholding (current milestone)" : host.System == PortalSystem.Surveillance ? "surveillance" : "assessment";
            var html =
                $"<p>Dear {WebUtility.HtmlEncode(agency.UserName ?? "Agency")},</p>" +
                $"<p>The ZED team has raised a <b>{WebUtility.HtmlEncode(severity)}</b> quality observation ({WebUtility.HtmlEncode(category)}) on the " +
                $"{WebUtility.HtmlEncode(level)} {what} of <b>{WebUtility.HtmlEncode(zedId)}</b>" +
                (string.IsNullOrWhiteSpace(about) ? "" : $", about {WebUtility.HtmlEncode(about)}") + ":</p>" +
                $"<blockquote>{WebUtility.HtmlEncode(text).Replace("\n", "<br>", StringComparison.Ordinal)}</blockquote>" +
                (QualityObservations.Blocking.Contains(severity)
                    ? $"<p>Please reply on the portal (Quality observations). The final submit of this {(Milestones ? "milestone" : what)} waits for your reply.</p>"
                    : "<p>Please reply on the portal (Quality observations).</p>") +
                "<p>Regards,<br>ZED Team</p>";
            await email.SendAsync(new EmailMessage(to, $"ZED quality observation ({severity}) - {zedId} {level}", html, EmailProfiles.Certification), ct);
            return true;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Quality observation mail to {Agency} failed", agencyId);
            return false;
        }
    }

    private static object Args(string zedId, string level) => new { ZedId = AssessmentInput.Ansi(zedId), Certification = AssessmentInput.Ansi(level) };

    private static string? Pick(string? value, IEnumerable<string> allowed) =>
        allowed.FirstOrDefault(a => string.Equals(a, value?.Trim(), StringComparison.OrdinalIgnoreCase));

    private static string? Short(string? value, int max) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim().Length <= max ? value.Trim() : value.Trim()[..max];

    private static bool Same(string? a, string? b) => string.Equals(a?.Trim(), b?.Trim(), StringComparison.OrdinalIgnoreCase);
}
