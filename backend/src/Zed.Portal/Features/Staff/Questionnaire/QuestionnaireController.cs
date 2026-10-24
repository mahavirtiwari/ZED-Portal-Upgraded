using System.Data;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.Masters;
using Zed.Portal.Features.Staff.Users;

namespace Zed.Portal.Features.Staff.Questionnaire;

/// <summary>
/// Requirements of a questionnaire parameter (the "Requirements" button of the Parameters page). Port of
/// QuestionaireController Requirements / GetRequirements (SP_MASTER_GET_REQUIREMENTS_BY_QUESTION_ID),
/// SaveRequirement (SP_MASTER_INSERT_REQUIREMENT), SaveEvidences (SP_MASTER_INSERT_EVIDENCES),
/// RemoveRequirement (SP_MASTER_REMOVE_REQUIREMENT) and RemoveOption (SP_MASTER_REMOVE_OPTION). Admin only,
/// as before (the old controller had <c>[AuthenticationFilter("|Admin|")]</c>).
/// <para>
/// Changes from the old page: the parameter (level + code) comes from the route and must exist; the
/// requirement and point ids must belong to that parameter (the remove procedures delete any id they are
/// given); only the last requirement and the last point after the first can be removed (the old page
/// only showed those buttons); texts are length-checked. Not ported (no reachable page uses them):
/// Questions / GetQuestions / SaveQuestion (the only link is commented out on the Parameters page) and
/// Upload (no reachable page has a file input for it; it built the folder from the request).
/// </para>
/// </summary>
[Route("api/staff/questionnaire/{sectionType}/{sectionCode}/requirements")]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
[StaffRoles(UserRole.Admin)]
public sealed class QuestionnaireController(ISqlExecutor db, ILogger<QuestionnaireController> log) : StaffApiController
{
    public const int MaxPoints = 50;
    public const int MaxBullets = 50;
    public const int MaxEvidences = 50;
    public const int PointMax = 1990;      // textarea maxlength of the old page (Options.OptionName is varchar(5000))
    public const int BulletMax = 2000;     // SubOptions.SubOptionName varchar(2000)
    public const int EvidenceMax = 2000;
    public const int HelpTextMax = 2000;   // MasterOption2.HelpText varchar(2000)

    public sealed record Bullet(long Id, string SubOptionCode, string Name);
    /// <summary>OptionImage: Options.OptionImage (a path under the site root the old page showed below the point), null when empty.</summary>
    public sealed record Point(long Id, string OptionCode, string Name, IReadOnlyList<Bullet> Bullets, string? OptionImage = null);
    public sealed record Evidence(string EvidenceCode, string EvidenceName, string? HelpText, bool ValidationRequired);
    public sealed record Requirement(long Id, string RequirementCode, IReadOnlyList<Point> Points,
        IReadOnlyList<Evidence> MandatoryEvidences, IReadOnlyList<Evidence> OptionalEvidences, bool CanRemove);
    public sealed record RequirementsResponse(string SectionType, string SectionCode, string SectionName, IReadOnlyList<Requirement> Requirements);

    [HttpGet]
    public async Task<ActionResult<RequirementsResponse>> Get(string sectionType, string sectionCode, CancellationToken ct)
    {
        var section = await SectionAsync(sectionType, sectionCode, ct);
        if (section is null) return NotFound();
        return new RequirementsResponse(section.Type, section.Code, section.Name, await LoadAsync(section, ct));
    }

    public sealed record PointRequest(string? Name, List<string?>? Bullets);
    public sealed record RequirementRequest(List<PointRequest>? Points);

    /// <summary>Adds a requirement with its points and bullets; the procedure numbers it after the last one.</summary>
    [HttpPost]
    public async Task<ActionResult<MessageResponse>> Add(string sectionType, string sectionCode, RequirementRequest req, CancellationToken ct)
    {
        var section = await SectionAsync(sectionType, sectionCode, ct);
        if (section is null) return NotFound();
        var (points, error) = ValidatePoints(req.Points);
        if (error is not null) return this.Problem400(error);

        var p = new DynamicParameters();
        p.Add("SectionType", section.Type);
        p.Add("SectionCode", section.Code);
        p.Add("QuestionCode", null);
        // The old page sent the textarea's leftover text here, which "Add" had just cleared (so it was null).
        p.Add("RequirementName", null);
        p.Add("PointList", PointTable(points!).AsTableValuedParameter("MasterOption2"));
        var bullets = BulletTable(points!);
        if (bullets.Rows.Count > 0) p.Add("BulletList", bullets.AsTableValuedParameter("MasterSubOption"));
        await db.ExecuteProcAsync("SP_MASTER_INSERT_REQUIREMENT", p, ct);
        log.LogInformation("Requirement added to {Type}/{Code} ({Points} points) by {Actor}", section.Type, section.Code, points!.Count, UserId);
        return new MessageResponse("Requirement saved.");
    }

    public sealed record EvidenceRequest(string? EvidenceName, string? HelpText, bool ValidationRequired);
    public sealed record EvidencesRequest(List<EvidenceRequest>? MandatoryEvidences, List<EvidenceRequest>? OptionalEvidences);

    /// <summary>Replaces the mandatory and optional evidences of a requirement (the procedure deletes and re-inserts them).</summary>
    [HttpPut("{id:long}/evidences")]
    public async Task<ActionResult<MessageResponse>> SaveEvidences(string sectionType, string sectionCode, long id, EvidencesRequest req, CancellationToken ct)
    {
        var section = await SectionAsync(sectionType, sectionCode, ct);
        if (section is null) return NotFound();
        var requirement = (await LoadAsync(section, ct)).FirstOrDefault(r => r.Id == id);
        if (requirement is null) return NotFound();

        var (mandatory, mError) = ValidateEvidences(req.MandatoryEvidences);
        if (mError is not null) return this.Problem400(mError);
        var (optional, oError) = ValidateEvidences(req.OptionalEvidences);
        if (oError is not null) return this.Problem400(oError);
        if (mandatory!.Count + optional!.Count == 0) return this.Problem400("Please add at least one evidence.");

        // Codes as the old action numbered them: mandatory 1..n, then optional n+1..m.
        var p = new DynamicParameters();
        p.Add("SectionType", section.Type);
        p.Add("SectionCode", section.Code);
        p.Add("RequirementCode", requirement.RequirementCode);
        if (mandatory.Count > 0) p.Add("EvidenceList", EvidenceTable(mandatory, 1).AsTableValuedParameter("MasterOption2"));
        if (optional.Count > 0) p.Add("EvidenceListOpt", EvidenceTable(optional, mandatory.Count + 1).AsTableValuedParameter("MasterOption2"));
        await db.ExecuteProcAsync("SP_MASTER_INSERT_EVIDENCES", p, ct);
        log.LogInformation("Evidences of requirement {Id} ({Type}/{Code}) set to {Mandatory} mandatory, {Optional} optional by {Actor}",
            id, section.Type, section.Code, mandatory.Count, optional.Count, UserId);
        return new MessageResponse("Evidences saved.");
    }

    /// <summary>Removes the last requirement of the parameter (with its points, bullets and evidences).</summary>
    [HttpDelete("{id:long}")]
    public async Task<ActionResult<MessageResponse>> Remove(string sectionType, string sectionCode, long id, CancellationToken ct)
    {
        var section = await SectionAsync(sectionType, sectionCode, ct);
        if (section is null) return NotFound();
        var requirement = (await LoadAsync(section, ct)).FirstOrDefault(r => r.Id == id);
        if (requirement is null) return NotFound();
        if (!requirement.CanRemove) return this.Problem400("Only the last requirement can be removed.");
        await db.ExecuteProcAsync("SP_MASTER_REMOVE_REQUIREMENT", new { RequirementId = id.ToString(System.Globalization.CultureInfo.InvariantCulture) }, ct);
        log.LogInformation("Requirement {Id} ({Type}/{Code}.{Requirement}) removed by {Actor}", id, section.Type, section.Code, requirement.RequirementCode, UserId);
        return new MessageResponse("Requirement Removed.");
    }

    /// <summary>Removes the last point of a requirement (not its first one).</summary>
    [HttpDelete("{id:long}/points/{pointId:long}")]
    public async Task<ActionResult<MessageResponse>> RemovePoint(string sectionType, string sectionCode, long id, long pointId, CancellationToken ct)
    {
        var section = await SectionAsync(sectionType, sectionCode, ct);
        if (section is null) return NotFound();
        var requirement = (await LoadAsync(section, ct)).FirstOrDefault(r => r.Id == id);
        var index = requirement?.Points.ToList().FindIndex(o => o.Id == pointId) ?? -1;
        if (requirement is null || index < 0) return NotFound();
        if (index == 0 || index != requirement.Points.Count - 1) return this.Problem400("Only the last point after the first can be removed.");
        await db.ExecuteProcAsync("SP_MASTER_REMOVE_OPTION", new { OptionId = pointId.ToString(System.Globalization.CultureInfo.InvariantCulture) }, ct);
        log.LogInformation("Point {PointId} of requirement {Id} ({Type}/{Code}) removed by {Actor}", pointId, id, section.Type, section.Code, UserId);
        return new MessageResponse("Option Removed.");
    }

    // ---- helpers ------------------------------------------------------------------------------

    private sealed record Section(string Type, string Code, string Name);

    /// <summary>The parameter, as stored (canonical level and code), or null when it does not exist.</summary>
    private async Task<Section?> SectionAsync(string sectionType, string sectionCode, CancellationToken ct)
    {
        var type = StaffMastersController.SectionTypes.FirstOrDefault(t => string.Equals(t, sectionType, StringComparison.OrdinalIgnoreCase));
        if (type is null || string.IsNullOrWhiteSpace(sectionCode) || sectionCode.Length > 50) return null;
        var row = (await db.QueryProcMultipleAsync("SP_MASTER_GET_SECTIONS", new { SectionType = type }, ct))[0]
            .FirstOrDefault(r => string.Equals(r.Text("SectionCode").Trim(), sectionCode.Trim(), StringComparison.OrdinalIgnoreCase));
        return row is null ? null : new Section(type, row.Text("SectionCode").Trim(), row.Text("SectionName"));
    }

    private static long Long(IDictionary<string, object?> r, string column) => long.TryParse(r.Text(column), out var v) ? v : 0;

    private static int Order(string code) => int.TryParse(code, out var n) ? n : int.MaxValue;

    private static bool Bit(IDictionary<string, object?> r, string column) => r.Text(column) is "1" or "True" or "true";

    private async Task<List<Requirement>> LoadAsync(Section section, CancellationToken ct)
    {
        var sets = await db.QueryProcMultipleAsync("SP_MASTER_GET_REQUIREMENTS_BY_QUESTION_ID",
            new { SectionType = section.Type, SectionCode = section.Code, QuestionCode = (string?)null }, ct);
        var requirements = sets[0].Where(r => Long(r, "Id") > 0).ToList();
        var lastCode = requirements.Select(r => r.Text("RequirementCode")).OrderBy(Order).LastOrDefault();

        Evidence ToEvidence(IDictionary<string, object?> e) =>
            new(e.Text("EvidenceCode"), e.Text("EvidenceName"), e.Text("HelpText") is { Length: > 0 } h ? h : null, Bit(e, "ValidationRequired"));

        return requirements.Select(r =>
        {
            var code = r.Text("RequirementCode");
            var points = sets[1].Where(o => o.Text("RequirementCode") == code)
                .Select(o => new Point(Long(o, "Id"), o.Text("OptionCode"), o.Text("OptionName"),
                    sets[2].Where(s => s.Text("RequirementCode") == code && s.Text("OptionCode") == o.Text("OptionCode"))
                        .Select(s => new Bullet(Long(s, "Id"), s.Text("SubOptionCode"), s.Text("SubOptionName"))).ToList(),
                    o.Text("OptionImage").Trim() is { Length: > 0 } image ? image : null))
                .ToList();
            return new Requirement(Long(r, "Id"), code, points,
                sets[3].Where(e => e.Text("RequirementCode") == code).Select(ToEvidence).ToList(),
                sets[4].Where(e => e.Text("RequirementCode") == code).Select(ToEvidence).ToList(),
                code == lastCode);
        }).ToList();
    }

    public sealed record PointInput(string Name, List<string> Bullets);

    public static (List<PointInput>? Points, string? Error) ValidatePoints(List<PointRequest>? points)
    {
        var result = new List<PointInput>();
        foreach (var point in points ?? [])
        {
            if (point is null) continue;
            if (!StaffUserRules.TryText(point.Name, PointMax, true, true, out var name))
                return (null, $"Each point must have text (up to {PointMax} characters).");
            var bullets = new List<string>();
            foreach (var b in point.Bullets ?? [])
            {
                if (!StaffUserRules.TryText(b, BulletMax, false, false, out var bullet))
                    return (null, $"Bullet points can be up to {BulletMax} characters.");
                if (bullet is not null) bullets.Add(bullet);
            }
            if (bullets.Count > MaxBullets) return (null, $"A point can have at most {MaxBullets} bullets.");
            result.Add(new PointInput(name!, bullets));
        }
        if (result.Count == 0) return (null, "Please add at least one point to the requirement.");
        if (result.Count > MaxPoints) return (null, $"A requirement can have at most {MaxPoints} points.");
        return (result, null);
    }

    public sealed record EvidenceInput(string Name, string? HelpText, bool ValidationRequired);

    public static (List<EvidenceInput>? Evidences, string? Error) ValidateEvidences(List<EvidenceRequest>? evidences)
    {
        var result = new List<EvidenceInput>();
        foreach (var e in evidences ?? [])
        {
            if (e is null) continue;
            if (!StaffUserRules.TryText(e.EvidenceName, EvidenceMax, true, false, out var name))
                return (null, $"Each evidence must have a name (up to {EvidenceMax} characters).");
            if (!StaffUserRules.TryText(e.HelpText, HelpTextMax, false, true, out var help))
                return (null, $"The help text (iButton) can be up to {HelpTextMax} characters.");
            result.Add(new EvidenceInput(name!, help, e.ValidationRequired));
        }
        if (result.Count > MaxEvidences) return (null, $"At most {MaxEvidences} evidences of each kind.");
        return (result, null);
    }

    /// <summary>MasterOption2 rows (OptionCode 1..n, text, image, help text) for the points.</summary>
    public static DataTable PointTable(IReadOnlyList<PointInput> points)
    {
        var t = MasterOption2();
        for (var i = 0; i < points.Count; i++) t.Rows.Add((i + 1).ToString(System.Globalization.CultureInfo.InvariantCulture), points[i].Name, "", null);
        return t;
    }

    /// <summary>MasterSubOption rows (OptionCode, SubOptionCode 1..n per point, text, image).</summary>
    public static DataTable BulletTable(IReadOnlyList<PointInput> points)
    {
        var t = new DataTable();
        t.Columns.Add("OptionCode", typeof(string));
        t.Columns.Add("SubOptionCode", typeof(string));
        t.Columns.Add("SubOptionText", typeof(string));
        t.Columns.Add("SubOptionImage", typeof(string));
        for (var i = 0; i < points.Count; i++)
            for (var j = 0; j < points[i].Bullets.Count; j++)
                t.Rows.Add((i + 1).ToString(System.Globalization.CultureInfo.InvariantCulture), (j + 1).ToString(System.Globalization.CultureInfo.InvariantCulture), points[i].Bullets[j], "");
        return t;
    }

    /// <summary>MasterOption2 rows for evidences: OptionImage carries ValidationRequired ("1"/"0"), as in the old action.</summary>
    public static DataTable EvidenceTable(IReadOnlyList<EvidenceInput> evidences, int firstCode)
    {
        var t = MasterOption2();
        for (var i = 0; i < evidences.Count; i++)
            t.Rows.Add((firstCode + i).ToString(System.Globalization.CultureInfo.InvariantCulture), evidences[i].Name,
                evidences[i].ValidationRequired ? "1" : "0", (object?)evidences[i].HelpText ?? DBNull.Value);
        return t;
    }

    private static DataTable MasterOption2()
    {
        var t = new DataTable();
        t.Columns.Add("OptionCode", typeof(string));
        t.Columns.Add("OptionText", typeof(string));
        t.Columns.Add("OptionImage", typeof(string));
        t.Columns.Add("HelpText", typeof(string));
        return t;
    }
}
