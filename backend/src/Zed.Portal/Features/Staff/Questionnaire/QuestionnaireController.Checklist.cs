using System.Data.Common;
using System.Globalization;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Portal.Features.Msme;
using Zed.Portal.Features.Staff.Masters;
using Zed.Portal.Features.Staff.Users;

namespace Zed.Portal.Features.Staff.Questionnaire;

/// <summary>
/// V4 layout of a requirement (migration 0034): its purpose and benefits, and its points as Yes / No checkpoints, each
/// with the evidence the unit shows when the answer is Yes (mandatory or not, with an optional sample copy) and the
/// actions needed when it is No or Partial. Saved through the legacy procedures (SP_MASTER_INSERT_REQUIREMENT,
/// SP_MASTER_INSERT_EVIDENCES) plus the new columns; a requirement can now also be edited. The MSMEs' copies of the
/// questionnaire (made when they pay) are not changed.
/// </summary>
public sealed partial class QuestionnaireController
{
    public const int PurposeMax = 500;
    public const int ActionMax = 100;
    public const int MaxActions = 20;
    /// <summary>The video tutorial's address (dbo.Requirements.VideoUrl, migration 0056).</summary>
    public const int VideoUrlMax = 500;
    public const long MaxSampleBytes = 2 * 1024 * 1024;
    internal const string SamplesFolder = "Uploads/EvidenceSamples";

    public sealed record ChecklistEvidence(string? EvidenceName, bool Mandatory, string? SampleFile = null, string? HelpText = null, bool ValidationRequired = false);

    /// <param name="OptionCode">The checkpoint being edited (Options.OptionCode); null = a new checkpoint.</param>
    public sealed record ChecklistPoint(string? OptionCode, string? Text, List<ChecklistEvidence>? Evidences, List<string?>? Actions);

    /// <param name="GeneralEvidences">Evidences of the whole requirement (added before V4, no checkpoint): kept or removed.</param>
    /// <param name="VideoUrl">New (2026-11-07): the requirement's video tutorial, an http(s) address; empty = none.</param>
    public sealed record ChecklistRequest(string? Purpose, string? Benefits, List<ChecklistPoint>? Checkpoints, List<ChecklistEvidence>? GeneralEvidences = null,
        string? VideoUrl = null);

    internal const string RequirementExtrasSql =
        "SELECT RequirementCode, Purpose, Benefits FROM dbo.Requirements WHERE SectionType = @SectionType AND SectionCode = @SectionCode;";
    internal const string OptionExtrasSql =
        "SELECT RequirementCode, OptionCode, ActionsNeeded FROM dbo.Options WHERE SectionType = @SectionType AND SectionCode = @SectionCode;";
    internal const string EvidenceExtrasSql =
        "SELECT RequirementCode, EvidenceCode, OptionCode, SampleFile FROM dbo.Evidences WHERE SectionType = @SectionType AND SectionCode = @SectionCode;";

    public sealed record RequirementExtra(string? RequirementCode, string? Purpose, string? Benefits);
    public sealed record OptionExtra(string? RequirementCode, string? OptionCode, string? ActionsNeeded);
    public sealed record EvidenceExtra(string? RequirementCode, string? EvidenceCode, string? OptionCode, string? SampleFile);

    internal sealed record Extras(IReadOnlyList<RequirementExtra> Requirements, IReadOnlyList<OptionExtra> Options, IReadOnlyList<EvidenceExtra> Evidences)
    {
        /// <summary>The requirements' video tutorials (migration 0056); empty before it.</summary>
        public IReadOnlyList<RequirementVideo> Videos { get; init; } = [];
    }

    internal const string VideoSql = "SELECT RequirementCode, VideoUrl FROM dbo.Requirements WHERE SectionType = @SectionType AND SectionCode = @SectionCode;";
    internal const string VideoUpdateSql =
        "UPDATE dbo.Requirements SET VideoUrl = @VideoUrl WHERE SectionType = @SectionType AND SectionCode = @SectionCode AND RequirementCode = @RequirementCode;";

    public sealed record RequirementVideo(string? RequirementCode, string? VideoUrl);

    /// <summary>The 0034 columns of the parameter's rows, or null when the migration is not applied yet.</summary>
    internal async Task<Extras?> ExtrasAsync(Section section, CancellationToken ct)
    {
        var args = new { SectionType = section.Type, SectionCode = section.Code };
        try
        {
            return new Extras(await db.QuerySqlAsync<RequirementExtra>(RequirementExtrasSql, args, ct),
                await db.QuerySqlAsync<OptionExtra>(OptionExtrasSql, args, ct), await db.QuerySqlAsync<EvidenceExtra>(EvidenceExtrasSql, args, ct))
            {
                Videos = await VideosAsync(args, ct),
            };
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Requirement checkpoints not readable (is migration 0034 applied?)");
            return null;
        }
    }

    /// <summary>The video tutorials; none (and a warning) before migration 0056, so the rest of the page still works.</summary>
    private async Task<IReadOnlyList<RequirementVideo>> VideosAsync(object args, CancellationToken ct)
    {
        try
        {
            return await db.QuerySqlAsync<RequirementVideo>(VideoSql, args, ct);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Requirement videos not readable (is migration 0056 applied?)");
            return [];
        }
    }

    private static string Trim(string? v) => (v ?? "").Trim();

    internal static List<Requirement> WithExtras(List<Requirement> requirements, Extras extras) => requirements.Select(r =>
    {
        var code = Trim(r.RequirementCode);
        var req = extras.Requirements.FirstOrDefault(x => Trim(x.RequirementCode) == code);
        var video = extras.Videos.FirstOrDefault(x => Trim(x.RequirementCode) == code);
        Evidence With(Evidence e)
        {
            var x = extras.Evidences.FirstOrDefault(v => Trim(v.RequirementCode) == code && Trim(v.EvidenceCode) == Trim(e.EvidenceCode));
            return e with { OptionCode = Trim(x?.OptionCode) is { Length: > 0 } o ? o : null, SampleFile = Trim(x?.SampleFile) is { Length: > 0 } f ? f : null };
        }
        return r with
        {
            Purpose = Trim(req?.Purpose) is { Length: > 0 } p ? p : null,
            Benefits = Trim(req?.Benefits) is { Length: > 0 } b ? b : null,
            VideoUrl = Trim(video?.VideoUrl) is { Length: > 0 } v ? v : null,
            Points = r.Points.Select(p => p with
            {
                Actions = SplitActions(extras.Options.FirstOrDefault(o => Trim(o.RequirementCode) == code && Trim(o.OptionCode) == Trim(p.OptionCode))?.ActionsNeeded),
            }).ToList(),
            MandatoryEvidences = r.MandatoryEvidences.Select(With).ToList(),
            OptionalEvidences = r.OptionalEvidences.Select(With).ToList(),
        };
    }).ToList();

    private static List<string> SplitActions(string? stored) =>
        (stored ?? "").Split('\n', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).ToList();

    private const string NotReady = "Purpose, benefits and checkpoints cannot be saved yet. Please ask the administrator to apply database migration 0034.";

    /// <summary>POST …/requirements/checklist: a new requirement in the V4 layout (the procedure numbers it after the last).</summary>
    [HttpPost("checklist")]
    public async Task<ActionResult<MessageResponse>> AddChecklist(string sectionType, string sectionCode, ChecklistRequest req, CancellationToken ct)
    {
        var section = await SectionAsync(sectionType, sectionCode, ct);
        if (section is null) return NotFound();
        var (input, error) = ValidateChecklist(req);
        if (error is not null) return this.Problem400(error);
        if (await ExtrasAsync(section, ct) is null) return this.Problem400(NotReady);
        var code = await AddChecklistAsync(section, input!, ct);
        log.LogInformation("Requirement {Type}/{Code}.{Requirement} added ({Points} checkpoints) by {Actor}", section.Type, section.Code, code, input!.Points.Count, UserId);
        return new MessageResponse($"Requirement {section.Code}.{code} saved.");
    }

    /// <summary>PUT …/requirements/{id}/checklist: edits a requirement (its checkpoints are matched by OptionCode).</summary>
    [HttpPut("{id:long}/checklist")]
    public async Task<ActionResult<MessageResponse>> UpdateChecklist(string sectionType, string sectionCode, long id, ChecklistRequest req, CancellationToken ct)
    {
        var section = await SectionAsync(sectionType, sectionCode, ct);
        if (section is null) return NotFound();
        var requirement = (await LoadAsync(section, ct)).FirstOrDefault(r => r.Id == id);
        if (requirement is null) return NotFound();
        var (input, error) = ValidateChecklist(req);
        if (error is not null) return this.Problem400(error);
        if (input!.Points.FirstOrDefault(p => p.OptionCode is not null && requirement.Points.All(o => Trim(o.OptionCode) != p.OptionCode)) is { } unknown)
            return this.Problem400($"Checkpoint {unknown.OptionCode} is not a checkpoint of this requirement.");
        if (await ExtrasAsync(section, ct) is null) return this.Problem400(NotReady);
        await UpdateChecklistAsync(section, requirement, input, ct);
        log.LogInformation("Requirement {Id} ({Type}/{Code}.{Requirement}) edited ({Points} checkpoints) by {Actor}",
            id, section.Type, section.Code, requirement.RequirementCode, input.Points.Count, UserId);
        return new MessageResponse($"Requirement {section.Code}.{requirement.RequirementCode} updated.");
    }

    // ---- validation ----------------------------------------------------------------------------

    internal sealed record EvidenceIn(string Name, bool Mandatory, string? SampleFile, string? HelpText, bool ValidationRequired);
    internal sealed record PointIn(string? OptionCode, string Text, List<EvidenceIn> Evidences, List<string> Actions);
    internal sealed record ChecklistIn(string? Purpose, string? Benefits, List<PointIn> Points, List<EvidenceIn> General, string? VideoUrl = null);

    /// <summary>A video tutorial's address: http or https, absolute, no spaces; null when empty, false when not valid.</summary>
    internal static bool TryVideoUrl(string? value, out string? url)
    {
        url = null;
        var v = Trim(value);
        if (v.Length == 0) return true;
        if (v.Length > VideoUrlMax || v.Any(char.IsWhiteSpace)) return false;
        if (!Uri.TryCreate(v, UriKind.Absolute, out var uri) || (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp) || string.IsNullOrEmpty(uri.Host))
            return false;
        url = v;
        return true;
    }

    internal static (ChecklistIn? Input, string? Error) ValidateChecklist(ChecklistRequest req)
    {
        if (!StaffUserRules.TryText(req.Purpose, PurposeMax, false, true, out var purpose)) return (null, $"Purpose can be up to {PurposeMax} characters.");
        if (!StaffUserRules.TryText(req.Benefits, PurposeMax, false, true, out var benefits)) return (null, $"Benefits can be up to {PurposeMax} characters.");
        if (!TryVideoUrl(req.VideoUrl, out var video))
            return (null, $"The video link must be a web address starting with https:// (up to {VideoUrlMax} characters), e.g. a YouTube link.");
        var points = new List<PointIn>();
        foreach (var p in req.Checkpoints ?? [])
        {
            if (p is null) continue;
            var n = points.Count + 1;
            if (!StaffUserRules.TryText(p.Text, PointMax, true, true, out var text)) return (null, $"Checkpoint {n}: the checkpoint text is required (up to {PointMax} characters).");
            var (evidences, evError) = ValidateChecklistEvidences(p.Evidences, $"Checkpoint {n}");
            if (evError is not null) return (null, evError);
            var actions = new List<string>();
            foreach (var a in p.Actions ?? [])
            {
                if (!StaffUserRules.TryText(a, ActionMax, false, false, out var action)) return (null, $"Checkpoint {n}: each action needed can be up to {ActionMax} characters.");
                if (action is not null) actions.Add(action);
            }
            if (actions.Count > MaxActions) return (null, $"Checkpoint {n}: at most {MaxActions} actions.");
            var code = Trim(p.OptionCode) is { Length: > 0 } c ? c : null;
            if (code is not null && points.Any(x => x.OptionCode == code)) return (null, $"Checkpoint {code} is listed twice.");
            points.Add(new PointIn(code, text!, evidences!, actions));
        }
        if (points.Count == 0) return (null, "Please add at least one checkpoint.");
        if (points.Count > MaxPoints) return (null, $"A requirement can have at most {MaxPoints} checkpoints.");
        var (general, gError) = ValidateChecklistEvidences(req.GeneralEvidences, "Evidence of the whole requirement");
        if (gError is not null) return (null, gError);
        var all = points.SelectMany(p => p.Evidences).Concat(general!).ToList();
        if (all.Count(e => e.Mandatory) > MaxEvidences || all.Count(e => !e.Mandatory) > MaxEvidences) return (null, $"At most {MaxEvidences} evidences of each kind (mandatory, not mandatory).");
        return (new ChecklistIn(purpose, benefits, points, general!, video), null);
    }

    private static (List<EvidenceIn>? Evidences, string? Error) ValidateChecklistEvidences(List<ChecklistEvidence>? evidences, string where)
    {
        var result = new List<EvidenceIn>();
        foreach (var e in evidences ?? [])
        {
            if (e is null) continue;
            if (!StaffUserRules.TryText(e.EvidenceName, EvidenceMax, false, false, out var name)) return (null, $"{where}: each evidence can be up to {EvidenceMax} characters.");
            if (name is null) continue;
            if (!StaffUserRules.TryText(e.HelpText, HelpTextMax, false, true, out var help)) return (null, $"{where}: the help text can be up to {HelpTextMax} characters.");
            var sample = Trim(e.SampleFile) is { Length: > 0 } s ? s : null;
            if (sample is not null && !IsSampleName(sample)) return (null, $"{where}: the sample copy of \"{name}\" is not valid. Please upload it again.");
            result.Add(new EvidenceIn(name, e.Mandatory, sample, help, e.ValidationRequired));
        }
        return (result, null);
    }

    /// <summary>A sample copy's name as <see cref="UploadSample"/> makes it (no folders, a known extension).</summary>
    internal static bool IsSampleName(string name) =>
        name.Length <= 100 && name.StartsWith("sample_", StringComparison.Ordinal) && name.All(c => char.IsAsciiLetterOrDigit(c) || c is '_' or '.')
        && SampleTypes.Any(t => name.EndsWith(t.Extension, StringComparison.Ordinal));

    // ---- saving --------------------------------------------------------------------------------

    internal const string PurposeSql =
        "UPDATE dbo.Requirements SET Purpose = @Purpose, Benefits = @Benefits WHERE SectionType = @SectionType AND SectionCode = @SectionCode AND RequirementCode = @RequirementCode;";
    internal const string ActionsSql =
        "UPDATE dbo.Options SET ActionsNeeded = @ActionsNeeded WHERE SectionType = @SectionType AND SectionCode = @SectionCode AND RequirementCode = @RequirementCode AND OptionCode = @OptionCode;";
    internal const string PointTextSql =
        "UPDATE dbo.Options SET OptionName = @OptionName, ActionsNeeded = @ActionsNeeded WHERE SectionType = @SectionType AND SectionCode = @SectionCode AND RequirementCode = @RequirementCode AND OptionCode = @OptionCode;";
    internal const string AddPointSql =
        "INSERT INTO dbo.Options (SectionType, SectionCode, QuestionCode, RequirementCode, OptionCode, OptionName, OptionImage, ActionsNeeded) " +
        "VALUES (@SectionType, @SectionCode, NULL, @RequirementCode, @OptionCode, @OptionName, '', @ActionsNeeded);";
    internal const string RemovePointSql =
        "DELETE FROM dbo.SubOptions WHERE SectionType = @SectionType AND SectionCode = @SectionCode AND RequirementCode = @RequirementCode AND OptionCode = @OptionCode; " +
        "DELETE FROM dbo.Options WHERE SectionType = @SectionType AND SectionCode = @SectionCode AND RequirementCode = @RequirementCode AND OptionCode = @OptionCode;";
    internal const string EvidenceExtraSql =
        "UPDATE dbo.Evidences SET OptionCode = @OptionCode, SampleFile = @SampleFile WHERE SectionType = @SectionType AND SectionCode = @SectionCode " +
        "AND RequirementCode = @RequirementCode AND EvidenceCode = @EvidenceCode;";
    internal const string ClearEvidencesSql =
        "DELETE FROM dbo.Evidences WHERE SectionType = @SectionType AND SectionCode = @SectionCode AND RequirementCode = @RequirementCode;";

    private static string? JoinActions(List<string> actions) => actions.Count == 0 ? null : string.Join("\n", actions);

    /// <summary>Adds the requirement (SP_MASTER_INSERT_REQUIREMENT numbers it and its checkpoints 1..n) and returns its code.</summary>
    internal async Task<string> AddChecklistAsync(Section section, ChecklistIn input, CancellationToken ct)
    {
        var before = (await LoadAsync(section, ct)).Select(r => Trim(r.RequirementCode)).ToHashSet();
        var p = new DynamicParameters();
        p.Add("SectionType", section.Type);
        p.Add("SectionCode", section.Code);
        p.Add("QuestionCode", null);
        p.Add("RequirementName", null);
        p.Add("PointList", PointTable(input.Points.Select(x => new PointInput(x.Text, [])).ToList()).AsTableValuedParameter("MasterOption2"));
        await db.ExecuteProcAsync("SP_MASTER_INSERT_REQUIREMENT", p, ct);
        var code = (await LoadAsync(section, ct)).Select(r => Trim(r.RequirementCode)).Where(c => !before.Contains(c)).OrderBy(Order).LastOrDefault()
                   ?? (before.Select(Order).Where(n => n < int.MaxValue).DefaultIfEmpty(0).Max() + 1).ToString(CultureInfo.InvariantCulture);
        var points = input.Points.Select((x, i) => x with { OptionCode = (i + 1).ToString(CultureInfo.InvariantCulture) }).ToList();
        await SaveExtrasAsync(section, code, input with { Points = points }, ct);
        return code;
    }

    internal async Task UpdateChecklistAsync(Section section, Requirement requirement, ChecklistIn input, CancellationToken ct)
    {
        var code = Trim(requirement.RequirementCode);
        var existing = requirement.Points.Select(o => Trim(o.OptionCode)).ToList();
        var kept = input.Points.Where(x => x.OptionCode is not null).Select(x => x.OptionCode!).ToHashSet();
        var next = existing.Select(Order).Where(n => n < int.MaxValue).DefaultIfEmpty(0).Max();
        var points = new List<PointIn>();
        foreach (var x in input.Points)
        {
            if (x.OptionCode is not null)
            {
                await db.ExecuteSqlAsync(PointTextSql, new
                {
                    SectionType = section.Type, SectionCode = section.Code, RequirementCode = code, x.OptionCode, OptionName = x.Text, ActionsNeeded = JoinActions(x.Actions),
                }, ct);
                points.Add(x);
            }
            else
            {
                var optionCode = (++next).ToString(CultureInfo.InvariantCulture);
                await db.ExecuteSqlAsync(AddPointSql, new
                {
                    SectionType = section.Type, SectionCode = section.Code, RequirementCode = code, OptionCode = optionCode, OptionName = x.Text, ActionsNeeded = JoinActions(x.Actions),
                }, ct);
                points.Add(x with { OptionCode = optionCode });
            }
        }
        foreach (var removed in existing.Where(c => !kept.Contains(c)))
            await db.ExecuteSqlAsync(RemovePointSql, new { SectionType = section.Type, SectionCode = section.Code, RequirementCode = code, OptionCode = removed }, ct);
        await SaveExtrasAsync(section, code, input with { Points = points }, ct);
    }

    /// <summary>
    /// Purpose / benefits, the checkpoints' actions, and every evidence of the requirement: replaced through
    /// SP_MASTER_INSERT_EVIDENCES (mandatory 1..n, then the others, as the old page numbered them), then each one's
    /// checkpoint and sample copy.
    /// </summary>
    private async Task SaveExtrasAsync(Section section, string code, ChecklistIn input, CancellationToken ct)
    {
        await db.ExecuteSqlAsync(PurposeSql, new { input.Purpose, input.Benefits, SectionType = section.Type, SectionCode = section.Code, RequirementCode = code }, ct);
        await SaveVideoAsync(section, code, input.VideoUrl, ct);
        foreach (var x in input.Points)
            await db.ExecuteSqlAsync(ActionsSql, new { ActionsNeeded = JoinActions(x.Actions), SectionType = section.Type, SectionCode = section.Code, RequirementCode = code, x.OptionCode }, ct);

        var all = input.Points.SelectMany(x => x.Evidences.Select(e => (Point: x.OptionCode, Evidence: e)))
            .Concat(input.General.Select(e => (Point: (string?)null, Evidence: e))).ToList();
        var mandatory = all.Where(e => e.Evidence.Mandatory).ToList();
        var optional = all.Where(e => !e.Evidence.Mandatory).ToList();
        if (all.Count == 0)
        {
            await db.ExecuteSqlAsync(ClearEvidencesSql, new { SectionType = section.Type, SectionCode = section.Code, RequirementCode = code }, ct);
            return;
        }
        var p = new DynamicParameters();
        p.Add("SectionType", section.Type);
        p.Add("SectionCode", section.Code);
        p.Add("RequirementCode", code);
        static List<EvidenceInput> Inputs(IEnumerable<(string? Point, EvidenceIn Evidence)> list) =>
            list.Select(e => new EvidenceInput(e.Evidence.Name, e.Evidence.HelpText, e.Evidence.ValidationRequired)).ToList();
        if (mandatory.Count > 0) p.Add("EvidenceList", EvidenceTable(Inputs(mandatory), 1).AsTableValuedParameter("MasterOption2"));
        if (optional.Count > 0) p.Add("EvidenceListOpt", EvidenceTable(Inputs(optional), mandatory.Count + 1).AsTableValuedParameter("MasterOption2"));
        await db.ExecuteProcAsync("SP_MASTER_INSERT_EVIDENCES", p, ct);
        var numbered = mandatory.Concat(optional).ToList();
        for (var i = 0; i < numbered.Count; i++)
        {
            var (point, evidence) = numbered[i];
            if (point is null && evidence.SampleFile is null) continue;
            await db.ExecuteSqlAsync(EvidenceExtraSql, new
            {
                OptionCode = point, evidence.SampleFile, SectionType = section.Type, SectionCode = section.Code, RequirementCode = code,
                EvidenceCode = (i + 1).ToString(CultureInfo.InvariantCulture),
            }, ct);
        }
    }

    /// <summary>The video tutorial (migration 0056). Before it, a link given is refused rather than lost; none is fine.</summary>
    private async Task SaveVideoAsync(Section section, string code, string? videoUrl, CancellationToken ct)
    {
        try
        {
            await db.ExecuteSqlAsync(VideoUpdateSql, new { VideoUrl = videoUrl, SectionType = section.Type, SectionCode = section.Code, RequirementCode = code }, ct);
        }
        catch (DbException ex) when (videoUrl is null)
        {
            log.LogWarning(ex, "Requirement video not saved (is migration 0056 applied?)");
        }
    }

    // ---- sample copies -------------------------------------------------------------------------

    internal static readonly MasterUploads.FileType[] SampleTypes =
        [.. MasterUploads.DocumentTypes.Where(t => t.Extension is ".pdf" or ".jpg" or ".png" or ".docx" or ".xlsx")];

    private string StorageRoot => Path.GetFullPath(Path.Combine(env.ContentRootPath, portal.Value.StorageRoot));

    public sealed record SampleUploaded(string FileName, string Message);

    /// <summary>POST …/requirements/samples (multipart "file"): stores a sample copy; the requirement's Save links it to its evidence.</summary>
    [HttpPost("samples")]
    [RequestSizeLimit(MaxSampleBytes + 64 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = MaxSampleBytes + 64 * 1024)]
    public async Task<ActionResult<SampleUploaded>> UploadSample(string sectionType, string sectionCode, IFormFile? file, CancellationToken ct)
    {
        if (await SectionAsync(sectionType, sectionCode, ct) is null) return NotFound();
        var (type, error) = await MasterUploads.CheckAsync(file, SampleTypes, MaxSampleBytes, ct);
        if (error is not null) return this.Problem400(error);
        var name = MasterUploads.NewFileName("sample", type!.Extension);
        await MasterUploads.SaveAsync(file!, StorageRoot, SamplesFolder, name, ct);
        log.LogInformation("Evidence sample {File} uploaded for {Type}/{Code} by {Actor}", name, sectionType, sectionCode, UserId);
        return new SampleUploaded(name, "Sample copy uploaded. Save the requirement to keep it.");
    }

    /// <summary>GET …/requirements/samples/{fileName}: a sample copy (download).</summary>
    [HttpGet("samples/{fileName}")]
    public async Task<IActionResult> Sample(string sectionType, string sectionCode, string fileName, CancellationToken ct)
    {
        if (await SectionAsync(sectionType, sectionCode, ct) is null || !IsSampleName(fileName)) return NotFound();
        var path = MsmeFilePaths.Resolve(StorageRoot, $"{SamplesFolder}/{fileName}");
        if (path is null || !System.IO.File.Exists(path)) return NotFound();
        var type = SampleTypes.First(t => fileName.EndsWith(t.Extension, StringComparison.Ordinal));
        Response.Headers.XContentTypeOptions = "nosniff";
        return PhysicalFile(path, type.ContentTypes[0], fileName);
    }
}
