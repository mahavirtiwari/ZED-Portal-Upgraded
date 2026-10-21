using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Msme;
using Zed.Portal.Features.Staff.Assessment;
using Zed.Portal.Features.Staff.Monitoring;

namespace Zed.Portal.Features.Staff.SiteReview;

/// <summary>
/// The staff review page of a Silver/Gold site (onsite/remote) assessment (Views/Assessment/SaDetails.cshtml)
/// and the site assessor's "SA Verification" list (Views/Assessment/SiteVerification.cshtml). Port of
/// AssessmentController.SaDetails/SiteVerification and the reads the page made: GetDaDetails
/// (SP_ASSESSMENT_DA_DETAILS), GetSaDetails (SP_ASSESSMENT_SA_DETAILS), GetDaDetailsByNc
/// (SP_ASSESSMENT_DA_DETAILS_NC) and GetList with allotment type SA (SP_ASSESSMENT_ALLOT_LIST).
/// <para>
/// The old reads had no sign-in and took the ZED ID from the request (SECURITY-FINDINGS #33), and the page
/// loaded photos from public addresses (#34). Here: the roles of the old page; the procedures get UserId/RoleId
/// from the cookie (they hide records not allotted to an agency or assessor, and SP_ASSESSMENT_SA_DETAILS shows
/// QC and the desktop-only assessor no site data, as before); the record must also pass
/// <see cref="CertificationRecord.CanView"/>; only the shown columns are returned; files are served by
/// <see cref="File"/> after the same check.
/// </para>
/// The agency and master-admin actions of the page are in <see cref="MonitoringReviewController"/> (and the
/// exemption change in <see cref="DesktopAssessmentController"/>). The site assessor's own actions on this page
/// (validate, conformance, remarks, final submit: RemoteController) are not part of this port; the page links to
/// the current portal for them.
/// </summary>
[Route("api/staff/site-review")]
public sealed class SiteReviewController(
    ISqlExecutor db,
    IWebHostEnvironment env,
    IOptions<PortalOptions> portal,
    ILogger<SiteReviewController> log) : StaffApiController
{
    private static readonly FileExtensionContentTypeProvider ContentTypes = new();

    /// <summary>Levels with a site assessment.</summary>
    private static readonly string[] SiteLevels = ["Silver", "Gold"];

    private static readonly string[] MsmeFields =
    [
        "ZedId", "Certification", "PUnitName", "UdyogAadharNo", "PlantAddress", "BasicInfoStatus", "DocVerifiAllot",
        "DesktopVerificationCompleted", "ModeOfAssessment", "AssessmentDate", "CompletedOn",
        "Nc1Raised", "Nc1Submitted", "Nc2Raised", "Nc2Submitted", "Nc3Raised", "Nc3Submitted", "Nc4Raised", "Nc4Submitted",
        "Nc5Raised", "Nc5Submitted",
        "CertificationStatus", "NcCount", "NcStatus", "Nc1Status", "Nc2Status", "Nc3Status", "Nc4Status", "Nc5Status",
        "IsAutoReject", "SendBackStatus", "SendBackRemarks", "SaAssessorRemarks", "IsSaVerified",
        "AuditsConducted", "DomesticCustomers", "SaDomesticCustomers", "InternationalCustomers", "SaInternationalCustomers",
        "RawMaterialImported", "SaRawMaterialImported", "OutsourcedProcesses", "SaOutsourcedProcesses", "EnergySources", "SaEnergySources",
        "ManufacturingCapacityValue", "ManufacturingCapacityUnits", "SaManufacturingCapacityValue", "SaManufacturingCapacityUnits",
        "MonthlyUtilizationValue", "MonthlyUtilizationUnits", "SaMonthlyUtilizationValue", "SaMonthlyUtilizationUnits",
    ];

    /// <summary>Agency and assessor names; the old page hid them from QC users.</summary>
    private static readonly string[] StaffNameFields =
    [
        "CertificationBodyUserId", "AgencyName", "DesktopAssessorId", "DesktopAssessorName",
        "SiteAssessorId", "SiteAssessorName", "CoAssessorId", "CoAssessorName",
    ];

    private static readonly string[] RawMaterialFields = ["ModeOfAssessment", "RawMaterialName", "Percentage", "CountryName"];
    private static readonly string[] SectionFields = ["Id", "SectionCode", "SectionName", "iButton", "IsAssessmentExcempted", "OfiComments"];
    private static readonly string[] SectionAssessorFields = ["AllotedAssessorId", "AllotedAssessorName", "AssessorRank"];
    private static readonly string[] RequirementFields =
        ["Id", "SectionCode", "RequirementCode", "RequirementId", "Conformance", "AssessorRemarks", "UpdatedDate", "SaConformance", "SaAssessorRemarks", "SaUpdatedDate"];
    private static readonly string[] NcRequirementFields = ["Id", "SectionCode", "RequirementCode", "SaConformance", "SaAssessorRemarks", "MsmeComments"];
    private static readonly string[] OptionFields = ["SectionCode", "RequirementCode", "OptionCode", "OptionName"];
    private static readonly string[] SubOptionFields = ["SectionCode", "RequirementCode", "OptionCode", "SubOptionCode", "SubOptionName"];
    private static readonly string[] EvidenceFields = ["Id", "SectionCode", "RequirementCode", "EvidenceName", "NcCount", "SyncedDate"];
    private static readonly string[] AttendanceFields = ["ConsultantId", "RowNumber", "TimeStamps", "LoginTime", "LogoutTime", "NoOfHours", "NoOfMinutes"];
    private static readonly string[] SiteVerificationFields =
        ["ZedId", "Certification", "CertificationBodyUserId", "EnterpriseName", "UnitAddress", "StateName", "DesktopReasonForRejection"];

    public sealed record Photo(long? Id, string? Name, string? Url, string? CreatedDate, string? IsVerified, string? AssessorRemarks);

    public sealed record Meeting(long? Id, string? Comments, IReadOnlyList<Photo> Photos, IReadOnlyList<Dictionary<string, object?>> Participants);

    public sealed record Product(
        long? Id, string Source, string? ProductName, string? Exported,
        string? PhotoUrl, string? DescriptionUrl, string? DescriptionKind,
        string? IsVerified, string? AssessorRemarks, string? IsSaVerified, string? SaAssessorRemarks,
        IReadOnlyList<Photo> Photos);

    public sealed record EvidencePhoto(string? SectionCode, string? RequirementCode, string? RequirementId, string? Name, string? Url, string? CreatedDate);

    public sealed record NcProduct(
        long? Id, string? ProductName, string? Exported, int NcCount, string? ProductParentId,
        string? PhotoUrl, string? DescriptionUrl, string? DescriptionKind, string? IsSaVerified, string? SaAssessorRemarks, string? MsmeRemarks);

    public sealed record NcRound(
        int NcCount,
        IReadOnlyList<NcProduct> Products,
        IReadOnlyList<NcProduct> OldProducts,
        IReadOnlyList<Dictionary<string, object?>> Sections,
        IReadOnlyList<Dictionary<string, object?>> Requirements,
        IReadOnlyList<Dictionary<string, object?>> Options,
        IReadOnlyList<Dictionary<string, object?>> SubOptions,
        IReadOnlyList<Dictionary<string, object?>> Evidences,
        IReadOnlyList<Photo> Photos,
        long? CommentsId,
        string? AssessorComments);

    public sealed record Permissions(
        ReviewActions Review,
        bool CanWithdrawExemption,     // master admin: exemption Yes -> No while the site assessment is scheduled (status 8)
        bool AssessorOnCurrentPortal); // the user is the site/co-assessor and the site assessment is open: done on the current portal

    public sealed record SaDetailsResponse(
        string ZedId,
        string Certification,
        string Role,
        Dictionary<string, object?> Msme,
        Dictionary<string, object?>? Location,
        IReadOnlyList<Photo> DaSelfies,
        IReadOnlyList<Photo> DaSiteExterior,
        IReadOnlyList<Photo> SaSelfies,
        IReadOnlyList<Photo> SaSiteExterior,
        IReadOnlyList<Product> Products,
        IReadOnlyList<Dictionary<string, object?>> RawMaterials,
        IReadOnlyList<Dictionary<string, object?>> Sections,
        IReadOnlyList<Dictionary<string, object?>> Requirements,
        IReadOnlyList<Dictionary<string, object?>> Options,
        IReadOnlyList<Dictionary<string, object?>> SubOptions,
        IReadOnlyList<Dictionary<string, object?>> Evidences,
        IReadOnlyList<EvidencePhoto> EvidencePhotos,
        IReadOnlyList<Photo> SiteTour,
        Meeting? OpenMeeting,
        Meeting? CloseMeeting,
        IReadOnlyList<Dictionary<string, object?>> Attendance,
        IReadOnlyList<Dictionary<string, object?>> Consultants,
        IReadOnlyList<NcRound> NcRounds,
        Permissions Permissions);

    public sealed record ListResponse(IReadOnlyList<Dictionary<string, object?>> Rows);

    // ======================================================================== SA Verification list

    /// <summary>The site assessor's units in NC (14) or quality check (15) (SP_ASSESSMENT_ALLOT_LIST, type SA).</summary>
    [HttpGet("site-verification")]
    [StaffRoles(UserRole.DesktopAssessor)]
    public async Task<ActionResult<ListResponse>> SiteVerification(CancellationToken ct)
    {
        var sets = await db.QueryProcMultipleAsync("SP_ASSESSMENT_ALLOT_LIST",
            new { UserId, RoleId = RoleText, AllotmentType = "SA" }, ct);
        return new ListResponse(Pick(sets[0], SiteVerificationFields));
    }

    // ======================================================================== review page

    [HttpGet("{zedId}/{certification}")]
    [StaffRoles(UserRole.MasterAdmin, UserRole.Agency, UserRole.DesktopAssessor, UserRole.SuperAdmin, UserRole.Ministry, UserRole.CitizenFeedback, UserRole.QC)]
    public async Task<ActionResult<SaDetailsResponse>> Get(string zedId, string certification, CancellationToken ct)
    {
        var level = SiteLevel(certification);
        if (!AssessmentInput.IsId(zedId) || level is null) return this.Problem400("Invalid request.");

        var user = CurrentUser;
        var record = await AssessmentRecords.CertificationAsync(db, zedId, level, ct);
        if (record is null || !record.CanView(user)) return NotFound();

        var args = new { UserId, RoleId = RoleText, ZedId = zedId, Certification = level };
        var daTask = db.QueryProcMultipleAsync("SP_ASSESSMENT_DA_DETAILS", args, ct);
        var saTask = db.QueryProcMultipleAsync("SP_ASSESSMENT_SA_DETAILS", args, ct);
        await Task.WhenAll(daTask, saTask);
        var (da, sa) = (daTask.Result, saTask.Result);
        // The procedures answer with an empty record (ZED ID '000') when the user may not see it.
        if (da[0].FirstOrDefault() is not { } main || !string.Equals(main.Text("ZedId").Trim(), zedId, StringComparison.OrdinalIgnoreCase)) return NotFound();

        var moved = main.Text("PhotosPath").Length > 0;
        var qc = user.RoleId == (int)UserRole.QC;
        var msme = Pick(main, MsmeFields);
        if (!qc)
        {
            foreach (var f in StaffNameFields) msme[f] = Value(main, f);
            msme["AgencyName"] ??= Value(main, "UserName");
        }

        // DA photos (MsmePhotos): selfie and site exterior uploaded by the MSME app.
        var daPhotos = da[8].Select(p =>
        {
            var type = p.Text("PhotoType");
            var url = type is "Selfie" or "SiteExteriorPhotos" && p.Text("PhotoId") is { Length: > 0 } id
                ? SiteReviewFiles.AppUpload(zedId, level, moved, type, id + ".jpg") : null;
            return (Type: type, Photo: new Photo(Long(p, "Id"), Str(p, "Name"), url, Str(p, "CreatedDate"), Str(p, "IsVerified"), Str(p, "AssessorRemarks")));
        }).ToList();

        var productPhotos = sa[11];
        IReadOnlyList<Photo> PhotosOf(IDictionary<string, object?> product) =>
            Photos(productPhotos.Where(ph => SameText(ph, "ProductId", product, "Id")), zedId, level);
        var products = da[1].Select(p =>
            {
                var description = p.Text("ProductDescriptionPhoto");
                var kind = Kind(description);
                return new Product(Long(p, "Id"), "da", Str(p, "ProductName"), Str(p, "Exported"),
                    SiteReviewFiles.AppUpload(zedId, level, moved, "BasicInfo", p.Text("ProductPhoto")),
                    kind is null ? null : SiteReviewFiles.AppUpload(zedId, level, moved, "BasicInfo", description), kind,
                    Str(p, "IsVerified"), Str(p, "AssessorRemarks"), Str(p, "IsSaVerified"), Str(p, "SaAssessorRemarks"), PhotosOf(p));
            })
            // Products added during the site assessment (SaProducts): no DA files; their remarks could not be edited.
            .Concat(sa[9].Select(p => new Product(Long(p, "Id"), "sa", Str(p, "ProductName"), Str(p, "Exported"), null, null, null,
                Str(p, "IsVerified"), Str(p, "AssessorRemarks"), Str(p, "IsSaVerified"), Str(p, "SaAssessorRemarks"), PhotosOf(p))))
            .ToList();

        var evidencePhotos = sa[7];
        var requirements = da[4].Select(r =>
        {
            var d = Pick(r, RequirementFields);
            d["Photos"] = Photos(evidencePhotos.Where(p => SameText(p, "RequirementId", r, "RequirementId")), zedId, level);
            return d;
        }).ToList();

        var sections = da[3].Select(s =>
        {
            var d = Pick(s, SectionFields);
            if (!qc) foreach (var f in SectionAssessorFields) d[f] = Value(s, f);
            return d;
        }).ToList();

        var evidences = da[7].Select(e =>
        {
            var d = Pick(e, EvidenceFields);
            d["FileUrl"] = e.Text("EvidenceId") is { Length: > 0 } eid ? SiteReviewFiles.AppUpload(zedId, level, moved, "Evidences", eid + ".pdf") : null;
            return d;
        }).ToList();

        // Selfies of the assessors: onsite rows carry PhotoPath ({store}/{ZedId}/{Cert}/{AssessorId}.jpg), remote ones MsmeSelfies.PhotoPath.
        var saSelfies = sa[12].Select(s => new Photo(Long(s, "Id"), "Assessor Selfie",
            SiteReviewFiles.Url(zedId, level, s.Text("PhotoPath")) ?? SiteReviewFiles.Url(zedId, level, s.Text("src")), Str(s, "CreatedDate"), null, null)).ToList();

        var ncCount = Math.Clamp(record.Nc, 0, 5);
        var rounds = ncCount > 0 ? await Task.WhenAll(Enumerable.Range(1, ncCount).Select(n => Round(zedId, level, n, moved, ct))) : [];

        var permissions = new Permissions(
            ReviewRules.For(user, record, ReviewStage.Site),
            user.RoleId == (int)UserRole.MasterAdmin && record.Status == 8,
            user.RoleId == (int)UserRole.DesktopAssessor && record.Status is 13 or 14 &&
            (Is(record.SiteAssessorId, user.UserId) || Is(record.CoAssessorId, user.UserId)));

        return new SaDetailsResponse(
            zedId, level, user.RoleName, msme,
            da[9].FirstOrDefault() is { } ll ? Pick(ll, ["Latitude", "Longitude", "SaLatitude", "SaLongitude"]) : null,
            daPhotos.Where(p => p.Type == "Selfie").Select(p => p.Photo).ToList(),
            daPhotos.Where(p => p.Type == "SiteExteriorPhotos").Select(p => p.Photo).ToList(),
            saSelfies,
            Photos(sa[0], zedId, level),
            products,
            Pick(da[2], RawMaterialFields),
            sections,
            requirements,
            Pick(da[5], OptionFields),
            Pick(da[6], SubOptionFields),
            evidences,
            evidencePhotos.Select(p => new EvidencePhoto(Str(p, "SectionCode"), Str(p, "RequirementCode"), Str(p, "RequirementId"), Str(p, "name"),
                SiteReviewFiles.Url(zedId, level, p.Text("Photo")) ?? SiteReviewFiles.Url(zedId, level, p.Text("src")), Str(p, "CreatedDate"))).ToList(),
            Photos(sa[6], zedId, level),
            MeetingOf(sa[1], sa[2], sa[5], zedId, level),
            MeetingOf(sa[3], sa[4], sa[8], zedId, level),
            Attendance(da[23], zedId, level),
            Pick(da[24], ["ConsultantId", "AssessorType"]),
            rounds,
            permissions);
    }

    private async Task<NcRound> Round(string zedId, string level, int n, bool moved, CancellationToken ct)
    {
        var nc = await db.QueryProcMultipleAsync("SP_ASSESSMENT_DA_DETAILS_NC",
            new { UserId, RoleId = RoleText, ZedId = zedId, Certification = level, NcCount = n }, ct);
        var comments = nc[7].FirstOrDefault();
        return new NcRound(
            n,
            NcProducts(nc[0], zedId, level),
            NcProducts(nc[8], zedId, level),
            Pick(nc[1], SectionFields),
            Pick(nc[2], NcRequirementFields),
            Pick(nc[3], OptionFields),
            Pick(nc[4], SubOptionFields),
            nc[5].Select(e =>
            {
                var d = Pick(e, EvidenceFields);
                d["FileUrl"] = e.Text("SyncedDate").Length > 0 && e.Text("EvidenceId") is { Length: > 0 } eid
                    ? SiteReviewFiles.AppUpload(zedId, level, moved, "Evidences", eid + ".pdf") : null;
                return d;
            }).ToList(),
            // The old page showed the NC round's site exterior photos from the MSME app's folder.
            nc[6].Where(p => p.Text("PhotoType") == "SiteExteriorPhotos").Select(p => new Photo(Long(p, "Id"), Str(p, "Name"),
                p.Text("PhotoId") is { Length: > 0 } id ? SiteReviewFiles.AppUpload(zedId, level, false, "SiteExteriorPhotos", id + ".jpg") : null,
                Str(p, "CreatedDate"), Str(p, "IsVerified"), Str(p, "AssessorRemarks"))).ToList(),
            comments is null ? null : Long(comments, "Id"),
            comments?.Text("SaAssessorRemarks") is { Length: > 0 } c ? c : null);
    }

    // ======================================================================== files

    /// <summary>GET api/staff/site-review/{zedId}/{certification}/files/mobileapi/SaPhotos/{zedId}/Silver/SiteTour/1.jpg</summary>
    [HttpGet("{zedId}/{certification}/files/{**path}")]
    [StaffRoles(UserRole.MasterAdmin, UserRole.Agency, UserRole.DesktopAssessor, UserRole.SuperAdmin, UserRole.Ministry, UserRole.CitizenFeedback, UserRole.QC)]
    public async Task<IActionResult> File(string zedId, string certification, string? path, CancellationToken ct)
    {
        // Malformed, foreign and missing files all answer 404 so file existence is not revealed.
        var level = SiteLevel(certification);
        var requested = SiteReviewFiles.Normalise(path);
        if (!AssessmentInput.IsId(zedId) || level is null || requested is null || !SiteReviewFiles.BelongsTo(requested, zedId))
            return NotFound();

        var record = await AssessmentRecords.CertificationAsync(db, zedId, level, ct);
        if (record is null || !record.CanView(CurrentUser)) return NotFound();

        var root = Path.GetFullPath(Path.Combine(env.ContentRootPath, portal.Value.StorageRoot));
        var fullPath = SiteReviewFiles.StorageCandidates(requested, zedId)
            .Select(c => MsmeFilePaths.Resolve(root, c))
            .FirstOrDefault(p => p is not null && System.IO.File.Exists(p));
        if (fullPath is null)
        {
            log.LogInformation("Site review file {Path} for {ZedId} is missing from storage", requested, zedId);
            return NotFound();
        }

        var fileName = Path.GetFileName(fullPath);
        var contentType = ContentTypes.TryGetContentType(fileName, out var t) ? t : "application/octet-stream";
        Response.Headers.XContentTypeOptions = "nosniff";
        Response.Headers.CacheControl = "private, no-store";
        Response.Headers.ContentDisposition = new ContentDispositionHeaderValue("inline") { FileNameStar = fileName }.ToString();
        return PhysicalFile(fullPath, contentType, enableRangeProcessing: true);
    }

    // ======================================================================== helpers

    private string RoleText => RoleId.ToString(CultureInfo.InvariantCulture);

    private static string? SiteLevel(string? value) =>
        SiteLevels.FirstOrDefault(l => string.Equals(l, value?.Trim(), StringComparison.OrdinalIgnoreCase));

    private static bool Is(string? column, string userId) =>
        !string.IsNullOrEmpty(column) && string.Equals(column.Trim(), userId, StringComparison.OrdinalIgnoreCase);

    private static string? Kind(string file) =>
        file.Contains(".pdf", StringComparison.OrdinalIgnoreCase) ? "pdf"
        : file.Contains(".jpg", StringComparison.OrdinalIgnoreCase) || file.Contains(".jpeg", StringComparison.OrdinalIgnoreCase) ||
          file.Contains(".png", StringComparison.OrdinalIgnoreCase) ? "image" : null;

    private static Meeting? MeetingOf(IReadOnlyList<IDictionary<string, object?>> meetings, IEnumerable<IDictionary<string, object?>> participants,
        IEnumerable<IDictionary<string, object?>> photos, string zedId, string level) =>
        meetings.FirstOrDefault() is not { } m ? null
            : new Meeting(Long(m, "Id"), Str(m, "Comments"), Photos(photos, zedId, level), Pick(participants, ["Name", "Designation"]));

    private static List<Dictionary<string, object?>> Attendance(IEnumerable<IDictionary<string, object?>> rows, string zedId, string level) =>
        rows.Select(a =>
        {
            var d = Pick(a, AttendanceFields);
            d["LoginPhotoUrl"] = a.Text("LoginPhotoId1").Length > 0 ? SiteReviewFiles.Url(zedId, level, a.Text("LoginPhotoId")) : null;
            d["LogoutPhotoUrl"] = a.Text("LogoutPhotoId1").Length > 0 ? SiteReviewFiles.Url(zedId, level, a.Text("LogoutPhotoId")) : null;
            return d;
        }).ToList();

    private static List<NcProduct> NcProducts(IEnumerable<IDictionary<string, object?>> rows, string zedId, string level) =>
        rows.Select(p =>
        {
            var description = p.Text("SaProductDescriptionPhoto");
            var kind = Kind(description);
            return new NcProduct(Long(p, "Id"), Str(p, "ProductName"), Str(p, "Exported"), (int)(Long(p, "NcCount") ?? 0), Str(p, "ProductParentId"),
                SiteReviewFiles.Url(zedId, level, p.Text("SaProductPhoto")),
                kind is null ? null : SiteReviewFiles.Url(zedId, level, description), kind,
                Str(p, "IsSaVerified"), Str(p, "SaAssessorRemarks"), Str(p, "MsmeRemarks"));
        }).ToList();

    /// <summary>Photo rows of SP_ASSESSMENT_SA_DETAILS (name, src, CreatedDate) with src turned into an authorised address.</summary>
    private static List<Photo> Photos(IEnumerable<IDictionary<string, object?>> rows, string zedId, string level) =>
        rows.Select(r => new Photo(Long(r, "Id"), Str(r, "name"),
            SiteReviewFiles.Url(zedId, level, r.Text("src")) ?? SiteReviewFiles.Url(zedId, level, r.Text("Photo")),
            Str(r, "CreatedDate"), Str(r, "IsVerified"), Str(r, "AssessorRemarks"))).ToList();

    private static bool SameText(IDictionary<string, object?> a, string columnA, IDictionary<string, object?> b, string columnB)
    {
        var x = a.Text(columnA).Trim();
        return x.Length > 0 && string.Equals(x, b.Text(columnB).Trim(), StringComparison.Ordinal);
    }

    private static long? Long(IDictionary<string, object?> row, string column) =>
        long.TryParse(row.Text(column), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) ? n : null;

    private static string? Str(IDictionary<string, object?> row, string column) =>
        row.TryGetValue(column, out var v) ? Display(v)?.ToString() : null;

    private static object? Value(IDictionary<string, object?> row, string column) =>
        row.TryGetValue(column, out var v) ? Display(v) : null;

    private static Dictionary<string, object?> Pick(IDictionary<string, object?> row, string[] fields) =>
        fields.ToDictionary(f => f, f => Value(row, f));

    private static List<Dictionary<string, object?>> Pick(IEnumerable<IDictionary<string, object?>> rows, string[] fields) =>
        rows.Select(r => Pick(r, fields)).ToList();

    private static object? Display(object? value) => value switch
    {
        null or DBNull => null,
        DateTime d => d.ToString("MMMM dd, yyyy hh:mm tt", CultureInfo.InvariantCulture),
        TimeSpan t => t.ToString(@"hh\:mm\:ss", CultureInfo.InvariantCulture),
        _ => value,
    };
}
