using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;

namespace Zed.Portal.Features.Msme;

/// <summary>
/// Read-only assessment pages of the signed-in MSME: "Basic Information &amp; Documents Upload"
/// (Views/Msme/BasicInfo.cshtml) and the Non-Conformance(s) pages (Views/Msme/NonConformances.cshtml
/// for Bronze, NonConformancesSa.cshtml for Silver/Gold).
/// <para>
/// The old views were copies of the desktop assessor's review page. Their scripts also wired up the
/// assessor and agency actions (Assessment/UpdateConfirmance, ValidateEvidence, ValidateProduct,
/// ValidateSiteExterior, SaveTimestamp, ExemptedFromAssessment, ConfirmFinalSubmit, FinalSubmit,
/// Monitoring/UpdateRemarks, UpdateOfiComments, UpdateMeetingComments, FinalSubmit) and only the Razor
/// role checks hid the buttons. None of that exists here: this API only reads, always for the ZED ID
/// in the sign-in cookie.
/// </para>
/// <para>
/// Procedures (each sends surveillance types to ZED_SURVEILLANCE itself):
/// SP_ASSESSMENT_DA_DETAILS (MsmeController.GetBasicInfo), SP_ASSESSMENT_DA_DETAILS_NC
/// (MsmeController.GetNonConformances) and, for Silver/Gold, SP_ASSESSMENT_SA_DETAILS
/// (Assessment/GetSaDetails, which the old Silver/Gold page called with the MSME's own ZED ID).
/// File columns are replaced by api/msme/assessment/.../files URLs (see MsmeEvidenceFilesController).
/// </para>
/// </summary>
[Route("api/msme/assessment")]
public sealed class MsmeAssessmentReportController(ISqlExecutor db) : MsmeApiController
{
    [HttpGet("{certification}/basic-info")]
    public async Task<ActionResult<AssessmentReport>> BasicInfo(string certification, CancellationToken ct)
    {
        if (!MsmeAssessment.TryCertification(certification, out var type))
            return this.Problem400("Invalid certification.");

        var sets = await MsmeAssessment.LoadDesktopAsync(db, ZedId, type, ct);
        if (sets[0].FirstOrDefault() is null) return NotAvailable();
        return MsmeAssessment.Desktop(sets, new AssessmentFileLinks(ZedId, type, MsmeAssessment.DesktopSource));
    }

    [HttpGet("{certification}/non-conformances")]
    public async Task<ActionResult<NonConformanceReport>> NonConformances(string certification, CancellationToken ct)
    {
        if (!MsmeAssessment.TryCertification(certification, out var type))
            return this.Problem400("Invalid certification.");

        var desktopSets = await MsmeAssessment.LoadDesktopAsync(db, ZedId, type, ct);
        if (desktopSets[0].FirstOrDefault() is not { } main) return NotAvailable();

        var desktop = MsmeAssessment.Desktop(desktopSets, new AssessmentFileLinks(ZedId, type, MsmeAssessment.DesktopSource));
        var photosBase = MsmeAssessment.PhotosBase(main);
        var ncCount = MsmeAssessment.NcCount(main);

        // One call per raised NC, like the old page (NC1 ... NC5 tabs).
        var rounds = new List<NonConformanceRound>();
        for (var n = 1; n <= ncCount; n++)
        {
            var ncSets = await MsmeAssessment.LoadRoundAsync(db, ZedId, RoleId, type, n, ct);
            rounds.Add(MsmeAssessment.Round(ncSets, n, photosBase, new AssessmentFileLinks(ZedId, type, MsmeAssessment.RoundSource(n))));
        }

        var variant = MsmeAssessment.Variant(type);
        List<Dictionary<string, object?>> saEvidence = [];
        if (variant == MsmeAssessment.SiteVariant)
        {
            var saSets = await MsmeAssessment.LoadSiteAsync(db, ZedId, RoleId, type, ct);
            saEvidence = MsmeAssessment.SiteEvidencePhotos(saSets, new AssessmentFileLinks(ZedId, type, MsmeAssessment.SiteSource));
        }

        return new NonConformanceReport(type, variant, ncCount, desktop, rounds, saEvidence);
    }

    private ObjectResult NotAvailable() =>
        Problem(title: "No assessment details are available for this certification yet.", statusCode: StatusCodes.Status404NotFound);
}

public sealed record AssessmentReport(
    string Certification,
    // Answers of the unit (customers, energy sources, capacity, ...) and NcCount.
    Dictionary<string, object?> Assessment,
    List<Dictionary<string, object?>> Products,
    List<Dictionary<string, object?>> RawMaterials,
    List<Dictionary<string, object?>> Sections,
    List<Dictionary<string, object?>> Requirements,
    List<Dictionary<string, object?>> Options,
    List<Dictionary<string, object?>> SubOptions,
    List<Dictionary<string, object?>> Evidences,
    List<Dictionary<string, object?>> Photos,
    List<Dictionary<string, object?>> EsgCheckList);

public sealed record NonConformanceRound(
    int Number,
    List<Dictionary<string, object?>> Products,
    List<Dictionary<string, object?>> Sections,
    List<Dictionary<string, object?>> Requirements,
    List<Dictionary<string, object?>> Options,
    List<Dictionary<string, object?>> SubOptions,
    List<Dictionary<string, object?>> Evidences,
    List<Dictionary<string, object?>> Photos,
    // Silver/Gold only: product photos the MSME uploaded in reply (SaPhotos).
    List<Dictionary<string, object?>> ProductPhotos);

public sealed record NonConformanceReport(
    string Certification,
    // "da" (Bronze page) or "sa" (Silver/Gold page).
    string Variant,
    int NcCount,
    AssessmentReport Assessment,
    List<NonConformanceRound> Rounds,
    // Silver/Gold only: evidence photos of the site assessment, shown as the NC1 starting point.
    List<Dictionary<string, object?>> SaEvidencePhotos);

/// <summary>
/// Builds api URLs for the files a procedure row names and remembers them, so that the file
/// endpoint can serve exactly the files the same procedure lists for the signed-in ZED ID.
/// </summary>
public sealed class AssessmentFileLinks(string zedId, string certification, string source)
{
    public string Certification => certification;

    /// <summary>Top folders of the mobile app's upload areas (relative to the storage root).</summary>
    private static readonly string[] Roots = ["mobileapi/", "surveillancemobileapi/"];

    public HashSet<string> Paths { get; } = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// The api URL for a legacy file URL (as the old page built it, or as the procedure stored it),
    /// or null when it is not an image/PDF of this ZED ID inside the mobile app folders.
    /// </summary>
    public string? Url(string? legacyUrl)
    {
        var path = Servable(legacyUrl, zedId);
        if (path is null) return null;
        Paths.Add(path);
        return $"/api/msme/assessment/{Uri.EscapeDataString(certification)}/files/{source}/" +
               string.Join('/', path.Split('/').Select(Uri.EscapeDataString));
    }

    public static string? Servable(string? legacyUrl, string zedId)
    {
        var path = MsmeFilePaths.FromLegacy(legacyUrl);
        if (path is null || !MsmeFilePaths.IsInline(path)) return null;
        if (!Roots.Any(r => path.StartsWith(r, StringComparison.OrdinalIgnoreCase))) return null;
        return MsmeFilePaths.BelongsTo(path, zedId) ? path : null;
    }
}

/// <summary>Procedure calls and the columns of their rows that the two pages show.</summary>
public static class MsmeAssessment
{
    public const string DesktopProcedure = "SP_ASSESSMENT_DA_DETAILS";
    public const string RoundProcedure = "SP_ASSESSMENT_DA_DETAILS_NC";
    public const string SiteProcedure = "SP_ASSESSMENT_SA_DETAILS";

    public const string DesktopSource = "da";
    public const string SiteSource = "sa";
    public const string DesktopVariant = "da";
    public const string SiteVariant = "sa";
    public const int MaxRounds = 5;

    /// <summary>
    /// Types the old pages were opened with. CertificationDetails linked Bronze/Silver/Gold (and their
    /// surveillance, which the procedures route to ZED_SURVEILLANCE). Handholding milestones used the
    /// site assessment page instead and are not accepted here.
    /// </summary>
    private static readonly string[] Types =
        ["Bronze", "Silver", "Gold", "BronzeSurveillance", "SilverSurveillance", "GoldSurveillance"];

    public static bool TryCertification(string? value, out string type)
    {
        type = Types.FirstOrDefault(t => string.Equals(t, value, StringComparison.OrdinalIgnoreCase)) ?? "";
        return type.Length > 0;
    }

    /// <summary>Bronze used NonConformances.cshtml, Silver and Gold NonConformancesSa.cshtml.</summary>
    public static string Variant(string type) => type.StartsWith("Bronze", StringComparison.Ordinal) ? DesktopVariant : SiteVariant;

    public static string RoundSource(int n) => "nc" + n.ToString(CultureInfo.InvariantCulture);

    // ----- procedure calls (parameters as the legacy actions sent them, ZED ID from the cookie) -----

    /// <summary>MsmeController.GetBasicInfo: ZedId and Certification only (the procedure then treats the caller as the MSME).</summary>
    public static Task<ResultSets> LoadDesktopAsync(ISqlExecutor db, string zedId, string type, CancellationToken ct) =>
        db.QueryProcMultipleAsync(DesktopProcedure, new { ZedId = zedId, Certification = type }, ct);

    /// <summary>MsmeController.GetNonConformances: the MSME as UserId with RoleId 5 (only that round's own evidences).</summary>
    public static Task<ResultSets> LoadRoundAsync(ISqlExecutor db, string zedId, string roleId, string type, int n, CancellationToken ct) =>
        db.QueryProcMultipleAsync(RoundProcedure, new { ZedId = zedId, Certification = type, NcCount = n, UserId = zedId, RoleId = roleId }, ct);

    /// <summary>Assessment/GetSaDetails as the Silver/Gold NC page called it (its own ZED ID, UserId and RoleId).</summary>
    public static Task<ResultSets> LoadSiteAsync(ISqlExecutor db, string zedId, string roleId, string type, CancellationToken ct) =>
        db.QueryProcMultipleAsync(SiteProcedure, new { ZedId = zedId, Certification = type, UserId = zedId, RoleId = roleId }, ct);

    // ----- shaping -----

    private static readonly string[] AssessmentFields =
    [
        "Certification", "NcCount", "AuditsConducted", "DomesticCustomers", "InternationalCustomers",
        "RawMaterialImported", "OutsourcedProcesses", "EnergySources",
        "ManufacturingCapacityValue", "ManufacturingCapacityUnits", "MonthlyUtilizationValue", "MonthlyUtilizationUnits",
    ];
    private static readonly string[] ProductFields = ["Id", "ProductName", "Exported"];
    private static readonly string[] RawMaterialFields = ["RawMaterialName", "Percentage", "CountryName"];
    private static readonly string[] SectionFields = ["SectionCode", "SectionName", "iButton"];
    private static readonly string[] RequirementFields = ["SectionCode", "RequirementCode"];
    private static readonly string[] OptionFields = ["SectionCode", "RequirementCode", "OptionCode", "OptionName"];
    private static readonly string[] SubOptionFields = ["SectionCode", "RequirementCode", "OptionCode", "SubOptionName"];
    private static readonly string[] EvidenceFields = ["SectionCode", "RequirementCode", "EvidenceName", "GeneratedTime"];
    private static readonly string[] PhotoFields = ["PhotoType", "ProductId", "PhotoExtension", "TimeStamp", "CreatedDate", "UpdatedDate", "AssessorRemarks"];
    private static readonly string[] EsgFields = ["Code", "Question", "Answer", "IfYesQuestion", "IfYesAnswer", "IfNoQuestion", "IfNoAnswer", "CheckListType"];

    private static readonly string[] RoundProductFields =
        ["Id", "ProductName", "ProductParentId", "PreviousAssessorRemarks", "PreviousAssessorUpdatedDate", "MsmeRemarks", "MsmeUpdatedDate"];
    private static readonly string[] RoundRequirementFields =
        ["SectionCode", "RequirementCode", "PreviousAssessorRemarks", "PreviousAssessorUpdatedDate", "MsmeComments", "MsmeUpdatedDate"];
    private static readonly string[] RoundPhotoFields = [.. PhotoFields, "MsmeRemarks"];
    private static readonly string[] RoundProductPhotoFields = ["ProductId", "ProductParentId", "TimeStamp", "CreatedDate"];
    private static readonly string[] SiteEvidenceFields = ["Name", "SectionCode", "RequirementCode", "GeneratedTime"];

    /// <summary>
    /// SP_ASSESSMENT_DA_DETAILS: 0 assessment, 1 products, 2 raw materials, 3 sections, 4 requirements,
    /// 5 options, 6 sub-options, 7 evidences, 8 photos. The ESG checklist set moves with the
    /// certification and database (the old page read Table11 or Table22), so it is found by its columns.
    /// </summary>
    public static AssessmentReport Desktop(ResultSets sets, AssessmentFileLinks links)
    {
        var main = sets[0].FirstOrDefault();
        var photosBase = PhotosBase(main);

        var products = sets[1].Select(r =>
        {
            var row = Pick(r, ProductFields);
            var description = r.Text("ProductDescriptionPhoto");
            row["PhotoUrl"] = links.Url(File(photosBase, r, "BasicInfo", r.Text("ProductPhoto")));
            // The old page showed the label photo as a PDF link or an image depending on its name.
            row["DescriptionType"] = description.Contains(".pdf", StringComparison.OrdinalIgnoreCase) ? "pdf"
                : description.Contains(".jpg", StringComparison.OrdinalIgnoreCase) ? "image" : null;
            row["DescriptionUrl"] = row["DescriptionType"] is null ? null : links.Url(File(photosBase, r, "BasicInfo", description));
            return row;
        }).ToList();

        return new AssessmentReport(
            links.Certification,
            Pick(main, AssessmentFields),
            products,
            Rows(sets[2], RawMaterialFields),
            Rows(sets[3], SectionFields),
            Rows(sets[4], RequirementFields),
            Rows(sets[5], OptionFields),
            Rows(sets[6], SubOptionFields),
            Evidences(sets[7], photosBase, links),
            Photos(sets[8], PhotoFields, photosBase, links),
            Rows(FindSet(sets, 10, "CheckListType", "Question"), EsgFields));
    }

    /// <summary>
    /// SP_ASSESSMENT_DA_DETAILS_NC: 0 products, 1 sections, 2 requirements, 3 options, 4 sub-options,
    /// 5 evidences, 6 site exterior photos, 7 assessor remarks (not shown), 8 earlier products,
    /// 9 (Silver/Gold) product photos. File addresses use the assessment's PhotosBasePath like the old page.
    /// </summary>
    public static NonConformanceRound Round(ResultSets sets, int number, string photosBase, AssessmentFileLinks links) =>
        new(number,
            Rows(sets[0], RoundProductFields),
            Rows(sets[1], SectionFields),
            Rows(sets[2], RoundRequirementFields),
            Rows(sets[3], OptionFields),
            Rows(sets[4], SubOptionFields),
            Evidences(sets[5], photosBase, links),
            Photos(sets[6], RoundPhotoFields, photosBase, links),
            sets[9].Select(r =>
            {
                var row = Pick(r, RoundProductPhotoFields);
                row["IsPdf"] = r.Text("Photo").Contains("pdf", StringComparison.OrdinalIgnoreCase);
                row["FileUrl"] = links.Url(r.Text("Photo"));
                return row;
            }).ToList());

    /// <summary>SP_ASSESSMENT_SA_DETAILS set 7: evidence photos linked to requirements (Photo holds the full address).</summary>
    public static List<Dictionary<string, object?>> SiteEvidencePhotos(ResultSets sets, AssessmentFileLinks links) =>
        sets[7].Select(r =>
        {
            var row = Pick(r, SiteEvidenceFields);
            row["IsPdf"] = r.Text("Photo").Contains("pdf", StringComparison.OrdinalIgnoreCase);
            row["FileUrl"] = links.Url(r.Text("Photo"));
            return row;
        }).ToList();

    /// <summary>
    /// The files one source lists for the ZED ID (what the page can link to), or null for an unknown source.
    /// </summary>
    public static async Task<HashSet<string>?> ListFilesAsync(ISqlExecutor db, string zedId, string roleId, string type, string source, CancellationToken ct)
    {
        var links = new AssessmentFileLinks(zedId, type, source);
        if (source == DesktopSource)
        {
            Desktop(await LoadDesktopAsync(db, zedId, type, ct), links);
            return links.Paths;
        }
        if (source == SiteSource)
        {
            if (Variant(type) != SiteVariant) return null;
            SiteEvidencePhotos(await LoadSiteAsync(db, zedId, roleId, type, ct), links);
            return links.Paths;
        }
        if (source.Length == 3 && source.StartsWith("nc", StringComparison.Ordinal) &&
            int.TryParse(source.AsSpan(2), NumberStyles.None, CultureInfo.InvariantCulture, out var n) && n is >= 1 and <= MaxRounds)
        {
            var main = (await LoadDesktopAsync(db, zedId, type, ct))[0].FirstOrDefault();
            if (main is null || n > NcCount(main)) return [];
            Round(await LoadRoundAsync(db, zedId, roleId, type, n, ct), n, PhotosBase(main), links);
            return links.Paths;
        }
        return null;
    }

    /// <summary>MsmeCertifications.NcCount, limited to the five rounds the page has tabs for.</summary>
    public static int NcCount(IDictionary<string, object?>? main) =>
        int.TryParse(main?.Text("NcCount"), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) ? Math.Clamp(n, 0, MaxRounds) : 0;

    /// <summary>
    /// "https://…/mobileapi/Photos/" or ".../CertifiedPhotos/" (surveillance: /surveillancemobileapi/),
    /// chosen by the procedure from MsmeCertifications.PhotosPath.
    /// </summary>
    public static string PhotosBase(IDictionary<string, object?>? main) => main?.Text("PhotosBasePath") ?? "";

    private static List<Dictionary<string, object?>> Evidences(IReadOnlyList<IDictionary<string, object?>> rows, string photosBase, AssessmentFileLinks links) =>
        rows.Select(r =>
        {
            var row = Pick(r, EvidenceFields);
            row["FileUrl"] = links.Url(File(photosBase, r, "Evidences", r.Text("EvidenceId") + ".pdf"));
            return row;
        }).ToList();

    /// <summary>Selfie and site exterior photos are {PhotoId}.jpg in their folder; product photos BasicInfo/{PhotoId}.{PhotoExtension}.</summary>
    private static List<Dictionary<string, object?>> Photos(IReadOnlyList<IDictionary<string, object?>> rows, string[] fields, string photosBase, AssessmentFileLinks links) =>
        rows.Select(r =>
        {
            var row = Pick(r, fields);
            var type = r.Text("PhotoType");
            row["FileUrl"] = type switch
            {
                "Selfie" or "SiteExteriorPhotos" => links.Url(File(photosBase, r, type, r.Text("PhotoId") + ".jpg")),
                "ProductPhotos" or "ProductDescriptionPhotos" => links.Url(File(photosBase, r, "BasicInfo", r.Text("PhotoId") + "." + r.Text("PhotoExtension"))),
                _ => null,
            };
            return row;
        }).ToList();

    /// <summary>
    /// {PhotosBasePath}{ZedId}/{Certification}/{folder}/{name}, as the old page concatenated it. Each part
    /// from a row must be one plain segment (no separators or dot segments, which a URL parser would resolve).
    /// </summary>
    private static string? File(string photosBase, IDictionary<string, object?> row, string folder, string name)
    {
        string[] parts = [row.Text("ZedId"), row.Text("Certification"), name];
        if (photosBase.Length == 0 || parts.Any(p => p.Length == 0 || p.Contains("..", StringComparison.Ordinal) ||
                p.IndexOfAny(['/', '\\', '?', '#', '%']) >= 0))
            return null;
        return $"{photosBase}{parts[0]}/{parts[1]}/{folder}/{name}";
    }

    private static IReadOnlyList<IDictionary<string, object?>> FindSet(ResultSets sets, int from, params string[] columns)
    {
        for (var i = from; i < sets.Count; i++)
            if (sets[i].FirstOrDefault() is { } first && columns.All(first.ContainsKey))
                return sets[i];
        return [];
    }

    private static List<Dictionary<string, object?>> Rows(IReadOnlyList<IDictionary<string, object?>> rows, string[] fields) =>
        rows.Select(r => Pick(r, fields)).ToList();

    /// <summary>Copies the listed columns (null when the procedure did not return them).</summary>
    private static Dictionary<string, object?> Pick(IDictionary<string, object?>? row, string[] fields) =>
        fields.ToDictionary(f => f, f => row is not null && row.TryGetValue(f, out var v) && v is not DBNull ? v : null);
}
