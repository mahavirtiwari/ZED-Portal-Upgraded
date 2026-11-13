using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.CertLevels;
using Zed.Portal.Features.Staff.Users;

namespace Zed.Portal.Features.Staff.Masters;

/// <summary>
/// Admin master data: NIC sectors (SectorController), categories (CategoryController), technologies
/// (TechnologyController) and the questionnaire parameters (QuestionaireController Index / GetSections /
/// SaveSection / UpdateSection). Admin only, as the menu.
/// <para>
/// Legacy holes closed: CategoryController and TechnologyController's data actions (GetCategories, Save,
/// Update, GetTechnologies, ActiveOrDeActive) had no sign-in check, so anyone could change them. The
/// parameter description (iButton) was rendered as raw HTML on the old page; the new page shows it as text.
/// </para>
/// <para>
/// Also served by the Consultancy and Surveillance hosts (sectors and questionnaire parameters; their procedures are
/// the same in ZED_CONSULTANT and ZED_SURVEILLANCE); categories and technologies are Main only (their procedures are
/// not in those databases). The old surveillance site had these screens with the menu entries commented out.
/// </para>
/// </summary>
[Route("api/staff/masters")]
[StaffRoles(UserRole.Admin)]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed partial class StaffMastersController(ISqlExecutor db, ILogger<StaffMastersController> log) : StaffApiController
{
    public sealed record CodeName(int Id, string Code, string Name);
    public sealed record CodeNameRequest(string? Code, string? Name);
    public sealed record NameRequest(string? Name);

    /// <summary>A sector with its type, Manufacturing or Services (dbo.Sectors.SectorType, migration 0025); null = not set.</summary>
    public sealed record Sector(int Id, string Code, string Name, string? Activity);
    public sealed record SectorRequest(string? Code, string? Name, string? Activity);
    public sealed record SectorUpdateRequest(string? Name, string? Activity);

    public static readonly string[] SectorActivities = ["Manufacturing", "Services"];

    // ---- Sectors ------------------------------------------------------------------------------

    /// <summary>NIC sectors (SP_MASTER_GET_SECTORS). Legacy GetSectors also allowed the SuperAdmin, for no page of its menu.</summary>
    [HttpGet("sectors")]
    public async Task<IReadOnlyList<Sector>> Sectors(CancellationToken ct) =>
        (await db.QueryProcMultipleAsync("SP_MASTER_GET_SECTORS", null, ct))[0]
            .Select(r => new Sector(Id(r), r.Text("SectorCode"), r.Text("SectorName"), Activity(r.Text("SectorType"))))
            .Where(s => s.Id > 0).ToList();

    [HttpPost("sectors")]
    public async Task<ActionResult<MessageResponse>> AddSector(SectorRequest req, CancellationToken ct)
    {
        var (code, name, error) = ValidateCodeName(new CodeNameRequest(req.Code, req.Name), "Sector");
        if (error is not null) return this.Problem400(error);
        if (Activity(req.Activity) is not { } activity) return this.Problem400("Please select whether the sector is Manufacturing or Services.");
        if ((await LoadSectorsAsync(ct)).Any(s => string.Equals(s.Code, code, StringComparison.OrdinalIgnoreCase)))
            return this.Problem400("A sector with this code already exists.");
        await db.ExecuteProcAsync("SP_MASTER_INSERT_SECTOR", new { SectorCode = code, SectorName = name }, ct);
        // The legacy procedure is left as it is; the type goes into the new column of the row it added.
        await db.ExecuteSqlAsync("UPDATE dbo.Sectors SET SectorType = @SectorType WHERE SectorCode = @SectorCode;",
            new { SectorType = activity, SectorCode = code }, ct);
        log.LogInformation("Sector {Code} ({Activity}) added by {Actor}", code, activity, UserId);
        return new MessageResponse("Sector saved.");
    }

    [HttpPut("sectors/{id:int}")]
    public async Task<ActionResult<MessageResponse>> UpdateSector(int id, SectorUpdateRequest req, CancellationToken ct)
    {
        var sector = (await LoadSectorsAsync(ct)).FirstOrDefault(s => s.Id == id);
        if (sector is null) return NotFound();
        if (!StaffUserRules.TryText(req.Name, 200, true, false, out var name)) return this.Problem400("Sector Name required (up to 200 characters).");
        if (Activity(req.Activity) is not { } activity) return this.Problem400("Please select whether the sector is Manufacturing or Services.");
        await db.ExecuteProcAsync("SP_MASTER_UPDATE_SECTOR", new { Id = id.ToString(), SectorCode = sector.Code, SectorName = name }, ct);
        await db.ExecuteSqlAsync("UPDATE dbo.Sectors SET SectorType = @SectorType WHERE Id = @Id;", new { SectorType = activity, Id = id }, ct);
        log.LogInformation("Sector {Id} updated ({Activity}) by {Actor}", id, activity, UserId);
        return new MessageResponse("Sector data updated.");
    }

    /// <summary>"Manufacturing" or "Services" (any case), as stored; null for anything else.</summary>
    private static string? Activity(string? value) =>
        SectorActivities.FirstOrDefault(a => string.Equals(a, value?.Trim(), StringComparison.OrdinalIgnoreCase));

    // ---- Categories ---------------------------------------------------------------------------

    [HttpGet("categories")]
    [SystemOnly(PortalSystem.Main)]
    public async Task<IReadOnlyList<CodeName>> Categories(CancellationToken ct) => await LoadCategoriesAsync(ct);

    [HttpPost("categories")]
    [SystemOnly(PortalSystem.Main)]
    public async Task<ActionResult<MessageResponse>> AddCategory(CodeNameRequest req, CancellationToken ct)
    {
        var (code, name, error) = ValidateCodeName(req, "Category");
        if (error is not null) return this.Problem400(error);
        if ((await LoadCategoriesAsync(ct)).Any(s => string.Equals(s.Code, code, StringComparison.OrdinalIgnoreCase)))
            return this.Problem400("A category with this code already exists.");
        await db.ExecuteProcAsync("SP_MASTER_INSERT_CATEGORY", new { CategoryCode = code, CategoryName = name }, ct);
        log.LogInformation("Category {Code} added by {Actor}", code, UserId);
        return new MessageResponse("Category saved.");
    }

    [HttpPut("categories/{id:int}")]
    [SystemOnly(PortalSystem.Main)]
    public async Task<ActionResult<MessageResponse>> UpdateCategory(int id, NameRequest req, CancellationToken ct)
    {
        var category = (await LoadCategoriesAsync(ct)).FirstOrDefault(s => s.Id == id);
        if (category is null) return NotFound();
        if (!StaffUserRules.TryText(req.Name, 200, true, false, out var name)) return this.Problem400("Category Name required (up to 200 characters).");
        await db.ExecuteProcAsync("SP_MASTER_UPDATE_CATEGORY", new { Id = id.ToString(), CategoryCode = category.Code, CategoryName = name }, ct);
        log.LogInformation("Category {Id} renamed by {Actor}", id, UserId);
        return new MessageResponse("Category data updated.");
    }

    // ---- Technologies -------------------------------------------------------------------------

    public sealed record Technology(int Id, string TechnologyCode, string TechnologyName, string? Description,
        IReadOnlyList<string> Sectors, IReadOnlyList<string> Categories, bool IsActive);

    /// <summary>Technologies (SP_MASTER_GET_TECHNOLOGIES). Sectors/Categories are stored as comma lists of "code-name" labels.</summary>
    [HttpGet("technologies")]
    [SystemOnly(PortalSystem.Main)]
    public async Task<IReadOnlyList<Technology>> Technologies(CancellationToken ct) => await LoadTechnologiesAsync(ct);

    public sealed record TechnologyOptions(IReadOnlyList<string> Sectors, IReadOnlyList<string> Categories);

    /// <summary>Labels offered by Technology/Create: "{SectorCode}-{SectorName}" and "{CategoryCode} -{CategoryName}" (as stored).</summary>
    [HttpGet("technologies/options")]
    [SystemOnly(PortalSystem.Main)]
    public async Task<TechnologyOptions> TechnologyOptionsGet(CancellationToken ct) =>
        new((await LoadSectorsAsync(ct)).Select(SectorLabel).ToList(), (await LoadCategoriesAsync(ct)).Select(CategoryLabel).ToList());

    public sealed record TechnologyRequest(string? TechnologyCode, string? TechnologyName, string? Description, List<string>? Sectors, List<string>? Categories);

    [HttpPost("technologies")]
    [SystemOnly(PortalSystem.Main)]
    public async Task<ActionResult<MessageResponse>> AddTechnology(TechnologyRequest req, CancellationToken ct)
    {
        var (values, error) = await ValidateTechnologyAsync(req, null, ct);
        if (error is not null) return this.Problem400(error);
        if ((await LoadTechnologiesAsync(ct)).Any(t => string.Equals(t.TechnologyCode, values!.Code, StringComparison.OrdinalIgnoreCase)))
            return this.Problem400("A technology with this code already exists.");
        await db.ExecuteProcAsync("SP_MASTER_INSERT_TECHNOLOGY", new
        {
            TechnologyCode = values!.Code, TechnologyName = values.Name, values.Description,
            Sectors = StaffUserRules.Csv(values.Sectors), Categories = StaffUserRules.Csv(values.Categories),
        }, ct);
        log.LogInformation("Technology {Code} added by {Actor}", values.Code, UserId);
        return new MessageResponse("Technology saved.");
    }

    [HttpPut("technologies/{id:int}")]
    [SystemOnly(PortalSystem.Main)]
    public async Task<ActionResult<MessageResponse>> UpdateTechnology(int id, TechnologyRequest req, CancellationToken ct)
    {
        var all = await LoadTechnologiesAsync(ct);
        var current = all.FirstOrDefault(t => t.Id == id);
        if (current is null) return NotFound();
        var (values, error) = await ValidateTechnologyAsync(req, current, ct);
        if (error is not null) return this.Problem400(error);
        if (all.Any(t => t.Id != id && string.Equals(t.TechnologyCode, values!.Code, StringComparison.OrdinalIgnoreCase)))
            return this.Problem400("A technology with this code already exists.");
        await db.ExecuteProcAsync("SP_MASTER_UPDATE_TECHNOLOGY", new
        {
            Id = id.ToString(), TechnologyCode = values!.Code, TechnologyName = values.Name, values.Description,
            Sectors = StaffUserRules.Csv(values.Sectors), Categories = StaffUserRules.Csv(values.Categories),
        }, ct);
        log.LogInformation("Technology {Id} updated by {Actor}", id, UserId);
        return new MessageResponse("Technology data updated.");
    }

    public sealed record ActiveRequest(bool IsActive);

    /// <summary>Activates or deactivates a technology (SP_MASTER_ACTIVE__DEACTIVE_TECHNOLOGIES).</summary>
    [HttpPost("technologies/{id:int}/active")]
    [SystemOnly(PortalSystem.Main)]
    public async Task<ActionResult<MessageResponse>> SetTechnologyActive(int id, ActiveRequest req, CancellationToken ct)
    {
        if ((await LoadTechnologiesAsync(ct)).All(t => t.Id != id)) return NotFound();
        var row = (await db.QueryProcMultipleAsync("SP_MASTER_ACTIVE__DEACTIVE_TECHNOLOGIES", new { Id = id.ToString(), req.IsActive }, ct))[0].FirstOrDefault();
        if (row?.Text("StatusCode") != "200") return this.Problem400("The technology could not be updated. Please try again.");
        log.LogInformation("Technology {Id} {State} by {Actor}", id, req.IsActive ? "activated" : "deactivated", UserId);
        return new MessageResponse(req.IsActive ? "Technology activated successfully." : "Technology deactivated successfully.");
    }

    // ---- Questionnaire parameters (Sections) ---------------------------------------------------

    // ZED_CONSULTANT has no questionnaire tables (Sections, Requirements, ...: database/README.md), so the parameters are
    // not served on Consultancy; its live Questionaire pages failed the same way.
    // The levels are those of Administration → Certification Levels (Bronze, Silver, Gold, ZED-X, ...; migration 0028).

    /// <param name="NicSectors">The NIC 2-digit sectors the parameter applies to (V4, Sections.NicSectors); empty = all sectors.</param>
    /// <param name="InSurveillance">Assessed again in surveillance (legacy Sections.SurveMandatories = 'Yes'): the surveillance
    /// payment copies only these parameters of the unit's certification (ZED_SURVEILLANCE SP_MSME_PAYMENT_GATEWAY_DETAILS).</param>
    /// <param name="InConsultancy">Used in consultancy / handholding (V4 one Admin, Sections.InConsultancy, migration 0035; NULL or
    /// 'Yes' = used): the others are taken out of a unit's handholding questionnaire after its milestone payment.</param>
    public sealed record Parameter(int Id, string SectionType, string SectionCode, string SectionName, string? Description, IReadOnlyList<string>? NicSectors = null,
        bool InSurveillance = false, bool InConsultancy = true);

    public sealed record LevelOption(string Code, string Name, bool IsEnabled);

    /// <summary>The certification levels whose questionnaires the Admin manages (disabled ones included: ZED-X is prepared before it opens).</summary>
    [HttpGet("parameter-levels")]
    [SystemOnly(PortalSystem.Main, PortalSystem.Surveillance)]
    public async Task<IReadOnlyList<LevelOption>> ParameterLevels(CancellationToken ct) =>
        (await CertificationLevels.AllAsync(db, log, ct)).Select(l => new LevelOption(l.Code, l.Name, l.IsEnabled)).ToList();

    /// <summary>Parameters of a certification level (first set of SP_MASTER_GET_SECTIONS).</summary>
    [HttpGet("parameters/{sectionType}")]
    [SystemOnly(PortalSystem.Main, PortalSystem.Surveillance)]
    public async Task<ActionResult<IReadOnlyList<Parameter>>> Parameters(string sectionType, CancellationToken ct)
    {
        var type = await SectionTypeAsync(sectionType, ct);
        if (type is null) return NotFound();
        return (await LoadParametersAsync(type, ct)).ToList();
    }

    /// <param name="InSurveillance">Null: unchanged (a new parameter is not assessed in surveillance).</param>
    /// <param name="InConsultancy">Null: unchanged (a new parameter is used in consultancy).</param>
    public sealed record ParameterRequest(string? SectionCode, string? SectionName, string? Description, List<string>? NicSectors = null, bool? InSurveillance = null,
        bool? InConsultancy = null);

    [HttpPost("parameters/{sectionType}")]
    [SystemOnly(PortalSystem.Main, PortalSystem.Surveillance)]
    public async Task<ActionResult<MessageResponse>> AddParameter(string sectionType, ParameterRequest req, CancellationToken ct)
    {
        var type = await SectionTypeAsync(sectionType, ct);
        if (type is null) return NotFound();
        if (!StaffUserRules.TryText(req.SectionCode, 50, true, false, out var code)) return this.Problem400("Parameter Code required (up to 50 characters).");
        if (ParameterCode(code) is not { } number) return this.Problem400(ParameterCodeRule);
        code = number;
        if (!StaffUserRules.TryText(req.SectionName, 200, true, false, out var name)) return this.Problem400("Parameter Name required (up to 200 characters).");
        if (!StaffUserRules.TryText(req.Description, 1990, false, true, out var description)) return this.Problem400("The description can be up to 1990 characters.");
        // Trimmed (2026-11-08): SQL compares "1" and "1 " as the same code, and a duplicate breaks SP_ASSESSMENT_DA_DETAILS.
        if ((await LoadParametersAsync(type, ct)).Any(p => string.Equals(p.SectionCode?.Trim(), code?.Trim(), StringComparison.OrdinalIgnoreCase)))
            return this.Problem400("A parameter with this code already exists.");
        var (sectors, sectorsError) = await NicSectorsAsync(req.NicSectors, ct);
        if (sectorsError is not null) return this.Problem400(sectorsError);
        await db.ExecuteProcAsync("SP_MASTER_INSERT_SECTION",
            new { SectionType = type, SectionCode = code, SectionName = name, SectionImage = (string?)null, iButton = description }, ct);
        var saved = await SaveNicSectorsAsync(NicSectorsByCodeSql, new { SectionType = type, SectionCode = code, NicSectors = sectors }, ct);
        if (req.InSurveillance is { } surveillance && KeepsSurveillanceFlag)
            await db.ExecuteSqlAsync(SurveillanceByCodeSql, new { SectionType = type, SectionCode = code, SurveMandatories = surveillance ? "Yes" : null }, ct);
        var consultancySaved = req.InConsultancy is not false || !KeepsSurveillanceFlag
            || await SaveConsultancyAsync(ConsultancyByCodeSql, new { SectionType = type, SectionCode = code, InConsultancy = "No" }, ct);
        log.LogInformation("Parameter {Type}/{Code} added by {Actor}", type, code, UserId);
        return new MessageResponse("Parameter saved." + (saved ? "" : NicSectorsNotSaved) + (consultancySaved ? "" : ConsultancyNotSaved));
    }

    public sealed record ParameterUpdateRequest(string? SectionName, string? Description, List<string>? NicSectors = null, bool? InSurveillance = null,
        bool? InConsultancy = null);

    [HttpPut("parameters/{sectionType}/{id:int}")]
    [SystemOnly(PortalSystem.Main, PortalSystem.Surveillance)]
    public async Task<ActionResult<MessageResponse>> UpdateParameter(string sectionType, int id, ParameterUpdateRequest req, CancellationToken ct)
    {
        var type = await SectionTypeAsync(sectionType, ct);
        if (type is null) return NotFound();
        var current = (await LoadParametersAsync(type, ct)).FirstOrDefault(p => p.Id == id);
        if (current is null) return NotFound();
        if (!StaffUserRules.TryText(req.SectionName, 200, true, false, out var name)) return this.Problem400("Parameter Name required (up to 200 characters).");
        if (!StaffUserRules.TryText(req.Description, 1990, false, true, out var description)) return this.Problem400("The description can be up to 1990 characters.");
        var (sectors, sectorsError) = await NicSectorsAsync(req.NicSectors, ct);
        if (sectorsError is not null) return this.Problem400(sectorsError);
        await db.ExecuteProcAsync("SP_MASTER_UPDATE_SECTION", new
        {
            Id = id.ToString(), SectionType = type, current.SectionCode, SectionName = name, SectionImage = (string?)null, iButton = description,
        }, ct);
        var saved = await SaveNicSectorsAsync(NicSectorsByIdSql, new { Id = id, NicSectors = sectors }, ct);
        if (req.InSurveillance is { } surveillance && surveillance != current.InSurveillance && KeepsSurveillanceFlag)
        {
            await db.ExecuteSqlAsync(SurveillanceByIdSql, new { Id = id, SurveMandatories = surveillance ? "Yes" : null }, ct);
            log.LogWarning("Parameter {Id} ({Type}) {State} surveillance by {Actor}", id, type, surveillance ? "added to" : "removed from", UserId);
        }
        var consultancySaved = true;
        if (req.InConsultancy is { } consultancy && consultancy != current.InConsultancy && KeepsSurveillanceFlag)
        {
            consultancySaved = await SaveConsultancyAsync(ConsultancyByIdSql, new { Id = id, InConsultancy = consultancy ? "Yes" : "No" }, ct);
            log.LogWarning("Parameter {Id} ({Type}) {State} consultancy by {Actor}", id, type, consultancy ? "added to" : "removed from", UserId);
        }
        log.LogInformation("Parameter {Id} updated by {Actor}", id, UserId);
        return new MessageResponse("Parameter data updated." + (saved ? "" : NicSectorsNotSaved) + (consultancySaved ? "" : ConsultancyNotSaved));
    }

    /// <summary>
    /// 2026-11-13: a parameter's code is a number (1, 2 …). The legacy procedures the apps, assessments and reports run sort
    /// by CAST(SectionCode AS int) in about 90 places, so a code such as "P1" breaks them (the ZED MSME app's
    /// GetParametersByType answered HTTP 500). Stored without leading zeros; existing codes are not changed.
    /// </summary>
    internal const string ParameterCodeRule = "The parameter code must be a number, e.g. 1.";

    internal static string? ParameterCode(string? text) =>
        text?.Trim() is { Length: > 0 and <= 9 } t && t.All(char.IsAsciiDigit) ? int.Parse(t, System.Globalization.CultureInfo.InvariantCulture).ToString(System.Globalization.CultureInfo.InvariantCulture) : null;

    internal const string NicSectorsByCodeSql = "UPDATE dbo.Sections SET NicSectors = @NicSectors WHERE SectionType = @SectionType AND SectionCode = @SectionCode;";
    internal const string NicSectorsByIdSql = "UPDATE dbo.Sections SET NicSectors = @NicSectors WHERE Id = @Id;";
    internal const string SurveillanceByCodeSql = "UPDATE dbo.Sections SET SurveMandatories = @SurveMandatories WHERE SectionType = @SectionType AND SectionCode = @SectionCode;";
    internal const string SurveillanceByIdSql = "UPDATE dbo.Sections SET SurveMandatories = @SurveMandatories WHERE Id = @Id;";
    internal const string ConsultancyByCodeSql = "UPDATE dbo.Sections SET InConsultancy = @InConsultancy WHERE SectionType = @SectionType AND SectionCode = @SectionCode;";
    internal const string ConsultancyByIdSql = "UPDATE dbo.Sections SET InConsultancy = @InConsultancy WHERE Id = @Id;";
    private const string ConsultancyNotSaved = " Whether it is used in consultancy could not be saved: please ask the administrator to apply database migration 0035.";

    /// <summary>Sections.InConsultancy (migration 0035, main database only, as the surveillance flag).</summary>
    private async Task<bool> SaveConsultancyAsync(string sql, object args, CancellationToken ct)
    {
        try
        {
            await db.ExecuteSqlAsync(sql, args, ct);
            return true;
        }
        catch (System.Data.Common.DbException ex)
        {
            log.LogError(ex, "Consultancy flag of a parameter not saved (is migration 0035 applied?)");
            return false;
        }
    }
    /// <summary>
    /// Sections.SurveMandatories ("assessed again in surveillance") is a column of the Main database only: the surveillance
    /// payment copies those parameters of the unit's Main certification. ZED_SURVEILLANCE.dbo.Sections has no such column,
    /// so on the Surveillance host the flag is not saved (it failed with SQL error 207 before).
    /// </summary>
    private bool KeepsSurveillanceFlag => HttpContext.RequestServices.GetRequiredService<PortalHost>().System == PortalSystem.Main;

    private const string NicSectorsNotSaved = " Its NIC sectors could not be saved: please ask the administrator to apply database migration 0028.";

    /// <summary>The chosen NIC sectors as stored (comma-separated codes, null = all sectors), or what is wrong with them.</summary>
    private async Task<(string? Stored, string? Error)> NicSectorsAsync(List<string>? chosen, CancellationToken ct)
    {
        var codes = (chosen ?? []).Select(c => c?.Trim() ?? "").Where(c => c.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (codes.Count == 0) return (null, null);
        var known = (await LoadSectorsAsync(ct)).Select(s => s.Code.Trim()).ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (codes.FirstOrDefault(c => !known.Contains(c)) is { } unknown) return (null, $"NIC sector {unknown} is not in the Sectors master.");
        var stored = string.Join(",", codes.OrderBy(c => c, StringComparer.Ordinal));
        return stored.Length > 2000 ? (null, "Too many NIC sectors chosen.") : (stored, null);
    }

    private async Task<bool> SaveNicSectorsAsync(string sql, object args, CancellationToken ct)
    {
        try
        {
            await db.ExecuteSqlAsync(sql, args, ct);
            return true;
        }
        catch (System.Data.Common.DbException ex)
        {
            log.LogError(ex, "NIC sectors of a parameter not saved (is migration 0028 applied?)");
            return false;
        }
    }

    // ---- helpers ------------------------------------------------------------------------------

    /// <summary>The stored code of a certification level (any case), or null.</summary>
    internal async Task<string?> SectionTypeAsync(string value, CancellationToken ct) =>
        (await CertificationLevels.FindAsync(db, value, log, ct))?.Code;

    private static string SectorLabel(CodeName s) => s.Code + "-" + s.Name;
    private static string CategoryLabel(CodeName c) => c.Code + " -" + c.Name;

    private static int Id(IDictionary<string, object?> r) => int.TryParse(r.Text("Id"), out var i) ? i : 0;

    private async Task<List<CodeName>> LoadSectorsAsync(CancellationToken ct) =>
        (await db.QueryProcMultipleAsync("SP_MASTER_GET_SECTORS", null, ct))[0]
            .Select(r => new CodeName(Id(r), r.Text("SectorCode"), r.Text("SectorName"))).Where(s => s.Id > 0).ToList();

    private async Task<List<CodeName>> LoadCategoriesAsync(CancellationToken ct) =>
        (await db.QueryProcMultipleAsync("SP_MASTER_GET_CATEGORIES", null, ct))[0]
            .Select(r => new CodeName(Id(r), r.Text("CategoryCode"), r.Text("CategoryName"))).Where(s => s.Id > 0).ToList();

    private static List<string> SplitList(string value) =>
        value.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).ToList();

    private async Task<List<Technology>> LoadTechnologiesAsync(CancellationToken ct) =>
        (await db.QueryProcMultipleAsync("SP_MASTER_GET_TECHNOLOGIES", null, ct))[0]
            .Select(r => new Technology(Id(r), r.Text("TechnologyCode"), r.Text("TechnologyName"),
                r.Text("Description") is { Length: > 0 } d ? d : null, SplitList(r.Text("Sectors")), SplitList(r.Text("Categories")),
                StaffUserRules.Bool(r, "IsActive")))
            .Where(t => t.Id > 0).ToList();

    private async Task<IEnumerable<Parameter>> LoadParametersAsync(string type, CancellationToken ct) =>
        (await db.QueryProcMultipleAsync("SP_MASTER_GET_SECTIONS", new { SectionType = type }, ct))[0]
            .Select(r => new Parameter(Id(r), r.Text("SectionType"), r.Text("SectionCode"), r.Text("SectionName"),
                r.Text("iButton") is { Length: > 0 } d ? d : null, SplitList(r.Text("NicSectors")),
                string.Equals(r.Text("SurveMandatories").Trim(), "Yes", StringComparison.OrdinalIgnoreCase),
                !string.Equals(r.Text("InConsultancy").Trim(), "No", StringComparison.OrdinalIgnoreCase)))
            .Where(p => p.Id > 0);

    private static (string? Code, string? Name, string? Error) ValidateCodeName(CodeNameRequest req, string label)
    {
        if (!StaffUserRules.TryText(req.Code, 50, true, false, out var code)) return (null, null, $"{label} Code required (up to 50 characters).");
        if (code!.Contains(',')) return (null, null, $"{label} Code cannot contain a comma.");
        if (!StaffUserRules.TryText(req.Name, 200, true, false, out var name)) return (null, null, $"{label} Name required (up to 200 characters).");
        return (code, name, null);
    }

    private sealed record TechnologyValues(string Code, string Name, string? Description, List<string> Sectors, List<string> Categories);

    /// <summary>Sectors/categories must be current labels, or ones the technology already has (a sector renamed since keeps its old label).</summary>
    private async Task<(TechnologyValues? Values, string? Error)> ValidateTechnologyAsync(TechnologyRequest req, Technology? current, CancellationToken ct)
    {
        if (!StaffUserRules.TryText(req.TechnologyCode, 200, true, false, out var code)) return (null, "Technology Code required (up to 200 characters).");
        if (!StaffUserRules.TryText(req.TechnologyName, 200, true, false, out var name)) return (null, "Technology Name required (up to 200 characters).");
        if (!StaffUserRules.TryText(req.Description, 2000, false, true, out var description)) return (null, "The description can be up to 2000 characters.");
        var sectors = StaffUserRules.OnlyAllowed(req.Sectors, (await LoadSectorsAsync(ct)).Select(SectorLabel).Concat(current?.Sectors ?? []));
        if (sectors is null) return (null, "Please select valid NIC sectors.");
        var categories = StaffUserRules.OnlyAllowed(req.Categories, (await LoadCategoriesAsync(ct)).Select(CategoryLabel).Concat(current?.Categories ?? []));
        if (categories is null) return (null, "Please select valid categories.");
        if (string.Join(",", sectors).Length > 2000 || string.Join(",", categories).Length > 2000) return (null, "Too many sectors or categories selected.");
        return (new TechnologyValues(code!, name!, description, sectors, categories), null);
    }
}
