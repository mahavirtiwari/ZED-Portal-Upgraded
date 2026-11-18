using System.Data.Common;
using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Tat;

/// <summary>
/// Administration → TAT (Turnaround Time), 2026-11-18 (the user's decisions "TAT and monitoring"): every status of the portal's
/// module (Assessment on main, Handholding on Consultancy, Surveillance) with the days a case may stay in it, per certification
/// level (blank = no TAT), and the relations "from → to in N days" the Admin names (per level or for every level, active or
/// not). Each portal keeps its own in its database (migration 0101); the Admin edits the Consultancy and Surveillance portals'
/// from the main portal through the portal switch. "Add suggested relations" adds the examples of <see cref="TatCatalog.Suggestions"/>
/// that are not there yet (never added on their own). The monitoring pages read them through <see cref="TatEvaluator"/>.
/// </summary>
[Route("api/staff/settings/tat")]
[StaffRoles(UserRole.Admin)]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed class TatController(ISqlExecutor db, PortalHost host, ILogger<TatController> log) : StaffApiController
{
    public sealed record LevelView(string Code, string Name);

    /// <param name="SystemText">The status's text in the portal's status master (dbo.CertificationStatuses), when it has one.</param>
    public sealed record StatusView(string Code, string Name, string? Track, bool Final, string? SystemText);

    public sealed record PointView(string Code, string Name, string Kind, string? Track);

    public sealed record RelationView(int Id, string Name, string? Certification, string FromStatus, string ToStatus, int Days, bool IsActive, int SortOrder);

    public sealed record SuggestionView(string Name, string FromStatus, string ToStatus, int Days, bool Added);

    public sealed record TatResponse(
        string Module,
        IReadOnlyList<LevelView> Levels,
        IReadOnlyList<StatusView> Statuses,
        IReadOnlyList<PointView> Points,
        Dictionary<string, Dictionary<string, int>> Days,
        IReadOnlyList<RelationView> Relations,
        IReadOnlyList<SuggestionView> Suggestions);

    public sealed record StatusDaysItem(string? Status, int? Days);

    public sealed record StatusDaysRequest(IReadOnlyList<StatusDaysItem>? Days);

    public sealed record RelationRequest(string? Name, string? Certification, string? FromStatus, string? ToStatus, int? Days, bool? IsActive);

    public sealed record SuggestedResponse(string Message, int Added);

    [HttpGet]
    public async Task<TatResponse> Get(CancellationToken ct)
    {
        var system = host.System;
        var texts = await SystemTextsAsync(ct);
        var days = new Dictionary<string, Dictionary<string, int>>(StringComparer.OrdinalIgnoreCase);
        foreach (var r in await TatStore.StatusDaysAsync(db, log, ct))
        {
            if (TatStore.Level(system, r.Certification) is not { } level || TatCatalog.Find(system, r.StatusCode) is not { IsStatus: true } p) continue;
            (days.TryGetValue(level, out var map) ? map : days[level] = new(StringComparer.OrdinalIgnoreCase))[p.Code] = r.Days;
        }
        var relations = await TatStore.RelationsAsync(db, log, ct);
        var catalog = TatCatalog.For(system);
        return new TatResponse(
            TatCatalog.ModuleOf(system),
            TatStore.Levels(system).Select(c => new LevelView(c, LevelRegistry.NameOf(c))).ToList(),
            catalog.Where(p => p.IsStatus).OrderBy(p => p.Order).Select(p => new StatusView(p.Code, p.Name, p.Track, p.Final, texts.GetValueOrDefault(p.Code))).ToList(),
            catalog.OrderBy(p => p.Order).Select(p => new PointView(p.Code, p.Name, p.Kind, p.Track)).ToList(),
            days,
            relations.Select(View).ToList(),
            TatCatalog.Suggestions(system).Select(s => new SuggestionView(s.Name, s.From, s.To, s.Days, IsAdded(s, relations))).ToList());
    }

    /// <summary>One level's days per status (the statuses sent; blank = no TAT).</summary>
    [HttpPut("days/{level}")]
    public async Task<ActionResult<MessageResponse>> SaveDays(string level, StatusDaysRequest req, CancellationToken ct)
    {
        if (TatStore.Level(host.System, level) is not { } code) return this.Problem400("Please choose a valid level.");
        var items = req.Days ?? [];
        if (items.Count == 0) return this.Problem400("Please enter the days of at least one status.");
        foreach (var i in items)
            if (TatStore.StatusDaysProblem(host.System, i.Status, i.Days) is { } problem) return this.Problem400(problem);
        if (items.GroupBy(i => i.Status!.Trim(), StringComparer.OrdinalIgnoreCase).Any(g => g.Count() > 1))
            return this.Problem400("Each status can be given once.");

        var list = items.Select(i => (TatCatalog.Find(host.System, i.Status)!.Code, i.Days)).ToList();
        if (!await TatStore.SaveStatusDaysAsync(db, code, list, ActorId, log, ct)) return this.Problem400(TatStore.NotSaved);
        log.LogInformation("TAT days of {Level} ({System}) saved by {UserId}: {Set} set, {Blank} blank", code, host.System, ActorId,
            list.Count(i => i.Days is not null), list.Count(i => i.Days is null));
        return new MessageResponse($"Days allowed for {LevelRegistry.NameOf(code)} saved.");
    }

    [HttpPost("relations")]
    public async Task<ActionResult<MessageResponse>> AddRelation(RelationRequest req, CancellationToken ct)
    {
        var relations = await TatStore.RelationsAsync(db, log, ct);
        if (relations.Count >= TatStore.MaxRelations) return this.Problem400($"At most {TatStore.MaxRelations} relations can be kept.");
        if (Problem(req, relations) is { } problem) return this.Problem400(problem);
        var (name, level, from, to) = Normalised(req);
        if (!await TatStore.SaveRelationAsync(db, null, name, level, from, to, req.Days!.Value, req.IsActive ?? true, ActorId, log, ct))
            return this.Problem400(TatStore.NotSaved);
        log.LogInformation("TAT relation {Name} ({System}) added by {UserId}", name, host.System, ActorId);
        return new MessageResponse($"Relation \"{name}\" added.");
    }

    [HttpPut("relations/{id:int}")]
    public async Task<ActionResult<MessageResponse>> UpdateRelation(int id, RelationRequest req, CancellationToken ct)
    {
        var relations = await TatStore.RelationsAsync(db, log, ct);
        if (relations.All(r => r.Id != id)) return NotFound();
        if (Problem(req, relations.Where(r => r.Id != id)) is { } problem) return this.Problem400(problem);
        var (name, level, from, to) = Normalised(req);
        if (!await TatStore.SaveRelationAsync(db, id, name, level, from, to, req.Days!.Value, req.IsActive ?? true, ActorId, log, ct))
            return this.Problem400(TatStore.NotSaved);
        log.LogInformation("TAT relation {Id} {Name} ({System}) changed by {UserId}", id, name, host.System, ActorId);
        return new MessageResponse($"Relation \"{name}\" saved.");
    }

    [HttpDelete("relations/{id:int}")]
    public async Task<ActionResult<MessageResponse>> DeleteRelation(int id, CancellationToken ct)
    {
        var relation = (await TatStore.RelationsAsync(db, log, ct)).FirstOrDefault(r => r.Id == id);
        if (relation is null) return NotFound();
        if (!await TatStore.DeleteRelationAsync(db, id, log, ct)) return this.Problem400(TatStore.NotSaved);
        log.LogInformation("TAT relation {Id} {Name} ({System}) deleted by {UserId}", id, relation.Name, host.System, ActorId);
        return new MessageResponse($"Relation \"{relation.Name}\" deleted.");
    }

    /// <summary>Adds the suggested relations that are not there yet (for every level, active).</summary>
    [HttpPost("relations/suggested")]
    public async Task<ActionResult<SuggestedResponse>> AddSuggested(CancellationToken ct)
    {
        var relations = await TatStore.RelationsAsync(db, log, ct);
        var missing = TatCatalog.Suggestions(host.System).Where(s => !IsAdded(s, relations)).ToList();
        if (missing.Count == 0) return new SuggestedResponse("The suggested relations are already there.", 0);
        if (relations.Count + missing.Count > TatStore.MaxRelations) return this.Problem400($"At most {TatStore.MaxRelations} relations can be kept.");
        foreach (var s in missing)
            if (!await TatStore.SaveRelationAsync(db, null, s.Name, null, s.From, s.To, s.Days, true, ActorId, log, ct))
                return this.Problem400(TatStore.NotSaved);
        log.LogInformation("{Count} suggested TAT relations ({System}) added by {UserId}", missing.Count, host.System, ActorId);
        return new SuggestedResponse(missing.Count == 1 ? "1 suggested relation added." : $"{missing.Count} suggested relations added.", missing.Count);
    }

    private string? Problem(RelationRequest req, IEnumerable<TatRelation> others) =>
        TatStore.RelationProblem(host.System, req.Name, req.Certification, req.FromStatus, req.ToStatus, req.Days, others);

    private (string Name, string? Level, string From, string To) Normalised(RelationRequest req) => (
        req.Name!.Trim(),
        string.IsNullOrWhiteSpace(req.Certification) ? null : TatStore.Level(host.System, req.Certification),
        TatCatalog.Find(host.System, req.FromStatus)!.Code,
        TatCatalog.Find(host.System, req.ToStatus)!.Code);

    private static bool IsAdded(TatCatalog.Suggestion s, IEnumerable<TatRelation> relations) =>
        relations.Any(r => r.Certification is null && string.Equals(r.Name, s.Name, StringComparison.OrdinalIgnoreCase));

    private static RelationView View(TatRelation r) => new(r.Id, r.Name, r.Certification, r.FromStatus, r.ToStatus, r.Days, r.IsActive, r.SortOrder);

    private sealed class StatusMasterRow
    {
        public int? SNo { get; init; }
        public string? Status { get; init; }
        public string? Descrip { get; init; }
        public string? MonitoringGetList { get; init; }
    }

    internal const string StatusMasterSql = "SELECT * FROM dbo.CertificationStatuses;";

    /// <summary>
    /// The texts of the portal's status master by status number. The legacy procedures read it two ways (the number in
    /// Descrip, or in Status with the text in Descrip); the number is whichever of the two is numeric, the text
    /// MonitoringGetList (main, surveillance) or the other one. Upper-case texts are shown in title case.
    /// </summary>
    private async Task<Dictionary<string, string>> SystemTextsAsync(CancellationToken ct)
    {
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        IReadOnlyList<StatusMasterRow> rows;
        try { rows = await db.QuerySqlAsync<StatusMasterRow>(StatusMasterSql, null, ct); }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Status master not readable");
            return map;
        }
        foreach (var r in rows)
        {
            static bool Number(string? v) => int.TryParse(v?.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out _);
            var code = Number(r.Descrip) ? r.Descrip!.Trim() : Number(r.Status) ? r.Status!.Trim() : null;
            var text = !string.IsNullOrWhiteSpace(r.MonitoringGetList) ? r.MonitoringGetList : Number(r.Descrip) ? r.Status : r.Descrip;
            if (code is null || string.IsNullOrWhiteSpace(text) || Number(text)) continue;
            map.TryAdd(code, TitleCase(text.Trim()));
        }
        return map;
    }

    internal static string TitleCase(string text) =>
        text.Any(char.IsLower) ? text : CultureInfo.InvariantCulture.TextInfo.ToTitleCase(text.ToLowerInvariant());
}
