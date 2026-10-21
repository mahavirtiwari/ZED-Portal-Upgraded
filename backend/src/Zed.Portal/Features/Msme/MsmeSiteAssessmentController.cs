using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;

namespace Zed.Portal.Features.Msme;

/// <summary>
/// Read-only report of the signed-in MSME's site (onsite/remote) assessment, or of a handholding
/// milestone. Port of Views/Msme/SiteAssessmentInfo.cshtml, which called three actions:
/// <list type="bullet">
/// <item>Msme/GetDetails → SP_MSME_GET_DETAILS (unit summary on the left)</item>
/// <item>Assessment/GetDaDetails → SP_ASSESSMENT_DA_DETAILS (basic information, parameters, DA evidences)</item>
/// <item>Assessment/GetSaDetails → SP_ASSESSMENT_SA_DETAILS (site assessment photos, milestone data)</item>
/// </list>
/// The two Assessment actions had no authorisation and took the ZED ID from the request body, so
/// anyone could read any MSME's assessment. Here the ZED ID is always the signed-in MSME, passed as
/// UserId/ZedId with RoleId 5 (the procedures' own "ZedId=@ZedId AND RoleId=5" access rule).
/// The milestone types reach ZED_CONSULTANT inside the main procedures (SilverMilestone2 →
/// ZED_CONSULTANT.SP_ASSESSMENT_*_DETAILS ..., 'Silver', 2); surveillance photos come from
/// ZED_SURVEILLANCE inside the main SP_ASSESSMENT_SA_DETAILS for Silver/Gold.
/// </summary>
[Route("api/msme/site-assessment")]
public sealed class MsmeSiteAssessmentController(ISqlExecutor db) : MsmeApiController
{
    /// <summary>
    /// Types the page is opened with. The certification page links Silver/Gold and the milestones;
    /// its surveillance boxes linked the base level (<c>Certification.Replace("Surveillance", "")</c>),
    /// so the surveillance types are accepted and mapped the same way (SP_ASSESSMENT_SA_DETAILS has no
    /// surveillance branch of its own).
    /// </summary>
    internal static readonly IReadOnlyDictionary<string, string> CertificationTypes =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["Silver"] = "Silver", ["Gold"] = "Gold",
            ["SilverSurveillance"] = "Silver", ["GoldSurveillance"] = "Gold",
            ["SilverMilestone1"] = "SilverMilestone1", ["SilverMilestone2"] = "SilverMilestone2", ["SilverMilestone3"] = "SilverMilestone3",
            ["GoldMilestone1"] = "GoldMilestone1", ["GoldMilestone2"] = "GoldMilestone2", ["GoldMilestone3"] = "GoldMilestone3",
        };

    // ----- columns the page shows (the legacy actions sent every result set with SELECT * rows:
    // assessor and agency names and IDs, meeting participants, attendance, latitude/longitude, ...) -----

    private static readonly string[] MsmeFields =
    [
        "ZedId", "EnterpriseName", "EnterpriseType", "EnterpriseTypee", "RegistrationType",
        "PUnitName", "PAddress", "PDistrictName", "PStateName", "PPin",
        "Activity", "TwoDigitActivity", "FourDigitActivity", "FiveDigitActivity", "PledgeOn",
    ];

    private static readonly string[] BasicInfoFields = ["UdyogAadharNo"];

    /// <summary>"Basic Info" tab (DA and site assessment answers) and the remarks under the parameters.</summary>
    private static readonly string[] AssessmentFields =
    [
        "AuditsConducted", "DomesticCustomers", "SaDomesticCustomers", "InternationalCustomers", "SaInternationalCustomers",
        "RawMaterialImported", "SaRawMaterialImported", "OutsourcedProcesses", "SaOutsourcedProcesses",
        "EnergySources", "SaEnergySources", "AssessorRemarks",
    ];

    private static readonly string[] RawMaterialFields = ["RawMaterialName", "Percentage", "CountryName"];

    /// <summary>Milestone answers per requirement (MsmeRequirements in ZED_CONSULTANT).</summary>
    private static readonly string[] MilestoneRequirementFields =
    [
        "SaConformance", "BaselineRemarks", "EstimatedTimeInDays", "HActionPlanRemarks", "Intervention", "InterventionRemarks",
        "IsProposedActivityCompleted", "ProgressReviewRemarks", "IsProposedActivityCompleted2", "ProgressReviewRemarks2",
    ];

    /// <summary>ConsultancyBasicInformation, one row per milestone ("Basic Information" tab of a milestone).</summary>
    private static readonly string[] ConsultancyBasicInfoFields =
    [
        "NcCount",
        "NumOfAccedents", "NumOfNearMisses", "ManHoursLast", "LosttimeInjuryfreqRate",
        "NumOfDeliveries", "NumOfDeliveriesOntimeFull",
        "MeanTimeToRepair", "MeanTimeBetweenFailure",
        "ElectriUnit", "ElectriTotConsumpPer", "SolarUnit", "SolarTotConsumpPer", "WindUnit", "WindTotConsumpPer",
        "FossilUnit", "FossilTotConsumpPer", "GasUnit", "GasTotConsumpPer", "OthersUnit", "OthersTotConsumpPer",
        "TotalCost", "EnergyMgmtMeasuresTaken",
        "Cox", "Nox", "Sox", "SuspPertiMaterial", "TotSuspenSolid", "BioChemOxyDemand",
        "SolidWaste", "PlasticWaste", "Ewaste", "hazardWaste", "NoiseLevel", "EnviMgmtMeasuresTaken",
        "EmpEngagedInActivities", "NumOfSuggestions", "HrmMeasuresTaken",
        "Defects", "ReWork", "CustRejections", "NumOfCustComplaints", "NumOfComplaintsResolved", "CustSatisLevel", "CostOfPoorQuality",
        "Water", "Minarals", "Wood", "NrmOthers", "WaterRecycling", "Waterreuse", "RainWaterHarvest", "NumofTreesPlanted", "NrmMeasuresTaken",
        "TurnOver", "GrossProfit",
    ];

    // ----- response -----

    public sealed record Photo(string? Name, string? Src, string? CreatedDate, int? NcCount);

    public sealed record Product(
        string? ProductName, string? Exported,
        string? ProductPhoto, string? ProductDescriptionPhoto,
        // "pdf", "image" or null (the old page showed the description file only for .pdf and .jpg).
        string? ProductDescriptionKind, bool ProductDescriptionOpened,
        IReadOnlyList<Photo> Photos);

    public sealed record Option(string? OptionName, IReadOnlyList<string?> SubOptions);

    public sealed record Evidence(string? EvidenceName, string? Url);

    public sealed record Bullets(IReadOnlyList<string?> BaselineDiagnostic, IReadOnlyList<string?> HandholdingActionPlan, IReadOnlyList<string?> TechnologyIntervention);

    public sealed record Requirement(
        string? RequirementCode,
        Dictionary<string, object?> Milestone,
        IReadOnlyList<Option> Options,
        IReadOnlyList<Evidence> Evidences,
        IReadOnlyList<Photo> Photos,
        IReadOnlyList<Photo> SurveillancePhotos,
        Bullets? Bullets);

    public sealed record Section(
        string? SectionCode, string? SectionName, string? IButton, string? IsAssessmentExcempted, int? NcCount,
        IReadOnlyList<Requirement> Requirements);

    public sealed record MilestonePhotos(int? NcCount, IReadOnlyList<Photo> Photos);

    public sealed record SiteAssessmentResponse(
        string Certification, // type the procedures were called with, e.g. "Silver" or "GoldMilestone2"
        string Kind,          // "assessment" (Silver/Gold) or "milestone" (handholding support)
        Dictionary<string, object?> Msme,
        Dictionary<string, object?> BasicInfo,
        Dictionary<string, object?> Assessment,
        IReadOnlyList<Product> Products,
        IReadOnlyList<Dictionary<string, object?>> RawMaterials,
        IReadOnlyList<Photo> SiteTourPhotos,
        IReadOnlyList<Photo> SurveillancePhotos,
        IReadOnlyList<Section> Sections,
        IReadOnlyList<MilestonePhotos> SiteExteriorPhotos,
        IReadOnlyList<Dictionary<string, object?>> ConsultancyBasicInfo);

    [HttpGet("{certification}")]
    public async Task<ActionResult<SiteAssessmentResponse>> Get(string certification, CancellationToken ct)
    {
        if (!CertificationTypes.TryGetValue(certification ?? "", out var type))
            return this.Problem400("Invalid certification.");

        var zedId = ZedId;
        var args = new { UserId = zedId, RoleId, ZedId = zedId, Certification = type };
        var msmeTask = db.QueryProcMultipleAsync("SP_MSME_GET_DETAILS", new { ZedId = zedId, CertificationType = type }, ct);
        var daTask = db.QueryProcMultipleAsync("SP_ASSESSMENT_DA_DETAILS", args, ct);
        var saTask = db.QueryProcMultipleAsync("SP_ASSESSMENT_SA_DETAILS", args, ct);
        await Task.WhenAll(msmeTask, daTask, saTask);
        var (msme, da, sa) = (msmeTask.Result, daTask.Result, saTask.Result);

        // The procedures return nothing (ZED ID '000') until the MSME has this certification.
        if (da[0].FirstOrDefault() is not { } assessment)
            return Problem(title: "No site assessment details are available for this certification yet.", statusCode: StatusCodes.Status404NotFound);

        var milestone = type.Contains("Milestone", StringComparison.Ordinal);
        return milestone
            ? Milestone(type, zedId, msme, assessment, da, sa)
            : Assessment(type, zedId, msme, assessment, da, sa);
    }

    /// <summary>Silver/Gold: tabs Basic Info, Site Tour, Parameters.</summary>
    private static SiteAssessmentResponse Assessment(string type, string zedId, ResultSets msme, IDictionary<string, object?> assessment, ResultSets da, ResultSets sa)
    {
        // DA uploads moved to CertifiedPhotos once MsmeCertifications.PhotosPath is set (as the old page chose).
        var daStore = assessment.Text("PhotosPath").Length > 0 ? "CertifiedPhotos" : "Photos";
        string? DaFile(string folder, string file) =>
            file.Length == 0 ? null : SitePhotoPaths.ToApiUrl($"mobileapi/{daStore}/{zedId}/{type}/{folder}/{file}", zedId);

        var productPhotos = sa[11];
        IReadOnlyList<Photo> PhotosOfProduct(IDictionary<string, object?> p) =>
            Photos(productPhotos.Where(ph => Same(ph, "ProductId", p, "Id")), zedId);

        // DA products with their uploads, then the products added during the site assessment.
        var products = da[1].Select(p =>
            {
                var description = p.Text("ProductDescriptionPhoto");
                var kind = description.Contains(".pdf", StringComparison.Ordinal) ? "pdf"
                    : description.Contains(".jpg", StringComparison.Ordinal) ? "image" : null;
                return new Product(
                    Str(p, "ProductName"), Str(p, "Exported"),
                    DaFile("BasicInfo", p.Text("ProductPhoto")),
                    kind is null ? null : DaFile("BasicInfo", description),
                    kind, p.Text("ProductDescOpenedTime").Length > 0,
                    PhotosOfProduct(p));
            })
            .Concat(sa[9].Select(p => new Product(Str(p, "ProductName"), Str(p, "Exported"), null, null, null, false, PhotosOfProduct(p))))
            .ToList();

        var sections = Sections(da, req => new Requirement(
            Str(req, "RequirementCode"),
            new(),
            Options(da, req),
            da[7].Where(e => Same(e, "SectionCode", req, "SectionCode") && Same(e, "RequirementCode", req, "RequirementCode"))
                .Select(e => new Evidence(Str(e, "EvidenceName"), DaFile("Evidences", e.Text("EvidenceId") is { Length: > 0 } id ? id + ".pdf" : "")))
                .ToList(),
            Photos(sa[7].Where(ph => Same(ph, "RequirementId", req, "RequirementId")), zedId),
            Photos(sa[14].Where(ph => Same(ph, "RequirementId", req, "RequirementId")), zedId),
            null));

        return new SiteAssessmentResponse(
            type, "assessment",
            Pick(msme[0].FirstOrDefault(), MsmeFields),
            Pick(msme[1].FirstOrDefault(), BasicInfoFields),
            Pick(assessment, AssessmentFields),
            products,
            da[2].Select(r => Pick(r, RawMaterialFields)).ToList(),
            Photos(sa[6], zedId),
            Photos(sa[13], zedId),
            sections,
            [],
            []);
    }

    /// <summary>Handholding milestone: tabs Basic Information, Site Tour, Parameters.</summary>
    private static SiteAssessmentResponse Milestone(string type, string zedId, ResultSets msme, IDictionary<string, object?> assessment, ResultSets da, ResultSets sa)
    {
        var bullets = sa[18];
        IReadOnlyList<string?> BulletsOf(IDictionary<string, object?> req, string reqType) =>
            bullets.Where(b => b.Text("ReqType") == reqType && Same(b, "RequirementId", req, "Id"))
                .Select(b => Str(b, "BulletPoints")).ToList();

        var sections = Sections(da, req => new Requirement(
            Str(req, "RequirementCode"),
            Pick(req, MilestoneRequirementFields),
            Options(da, req),
            [],
            Photos(sa[7].Where(ph => Same(ph, "RequirementId", req, "RequirementId")), zedId),
            [],
            new Bullets(BulletsOf(req, "BaselineDiagnostic"), BulletsOf(req, "HandholdingActionPlan"), BulletsOf(req, "TechnologyIntervention"))));

        // Site exterior photos are listed per open meeting (one per milestone).
        var siteExterior = sa[1]
            .Select(m => new MilestonePhotos(Int(m, "NcCount"), Photos(sa[0].Where(ph => Same(ph, "NcCount", m, "NcCount")), zedId)))
            .ToList();

        return new SiteAssessmentResponse(
            type, "milestone",
            Pick(msme[0].FirstOrDefault(), MsmeFields),
            Pick(msme[1].FirstOrDefault(), BasicInfoFields),
            Pick(assessment, ["AssessorRemarks"]),
            [],
            [],
            Photos(sa[6], zedId),
            [],
            sections,
            siteExterior,
            sa[17].Select(r => Pick(r, ConsultancyBasicInfoFields)).ToList());
    }

    // ----- helpers -----

    /// <summary>Sections (DA set 3) with their requirements (set 4) in procedure order.</summary>
    private static List<Section> Sections(ResultSets da, Func<IDictionary<string, object?>, Requirement> requirement) =>
        da[3].Select(s => new Section(
                Str(s, "SectionCode"), Str(s, "SectionName"), Str(s, "iButton"), Str(s, "IsAssessmentExcempted"), Int(s, "NcCount"),
                da[4].Where(r => Same(r, "SectionCode", s, "SectionCode")).Select(requirement).ToList()))
            .ToList();

    /// <summary>Options (DA set 5) and sub-options (set 6) of a requirement.</summary>
    private static List<Option> Options(ResultSets da, IDictionary<string, object?> req) =>
        da[5].Where(o => Same(o, "SectionCode", req, "SectionCode") && Same(o, "RequirementCode", req, "RequirementCode"))
            .Select(o => new Option(
                Str(o, "OptionName"),
                da[6].Where(so => Same(so, "SectionCode", o, "SectionCode") && Same(so, "RequirementCode", o, "RequirementCode") && Same(so, "OptionCode", o, "OptionCode"))
                    .Select(so => Str(so, "SubOptionName")).ToList()))
            .ToList();

    /// <summary>Photo rows (name, src, CreatedDate, NcCount) with src turned into an authorised address.</summary>
    private static List<Photo> Photos(IEnumerable<IDictionary<string, object?>> rows, string zedId) =>
        rows.Select(r => new Photo(Str(r, "name"), SitePhotoPaths.ToApiUrl(r.Text("src"), zedId), Str(r, "CreatedDate"), Int(r, "NcCount"))).ToList();

    /// <summary>Exact match of two join columns (the old page's AngularJS filters).</summary>
    private static bool Same(IDictionary<string, object?> a, string columnA, IDictionary<string, object?> b, string columnB)
    {
        var x = a.Text(columnA);
        return x.Length > 0 && string.Equals(x, b.Text(columnB), StringComparison.Ordinal);
    }

    private static string? Str(IDictionary<string, object?> row, string column) =>
        row.TryGetValue(column, out var v) ? Display(v) : null;

    private static int? Int(IDictionary<string, object?> row, string column) =>
        int.TryParse(row.Text(column), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) ? n : null;

    /// <summary>Copies the listed columns (null when the procedure did not return them).</summary>
    private static Dictionary<string, object?> Pick(IDictionary<string, object?>? row, string[] fields) =>
        fields.ToDictionary(f => f, f => row is not null && row.TryGetValue(f, out var v) && v is not DBNull ? (v is DateTime ? Display(v) : v) : null);

    /// <summary>Text of a value; dates in the procedures' own display format.</summary>
    private static string? Display(object? value) => value switch
    {
        null or DBNull => null,
        DateTime d => d.ToString("MMMM dd, yyyy hh:mm tt", CultureInfo.InvariantCulture),
        IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
        _ => value.ToString(),
    };
}
