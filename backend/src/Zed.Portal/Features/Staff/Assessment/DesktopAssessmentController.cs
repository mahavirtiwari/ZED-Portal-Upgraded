using System.Data;
using System.Globalization;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Msme;

namespace Zed.Portal.Features.Staff.Assessment;

/// <summary>
/// The desktop-assessment review page (Views/Assessment/DaDetails.cshtml). Port of AssessmentController
/// GetDaDetails (SP_ASSESSMENT_DA_DETAILS), GetDaDetailsByNc (SP_ASSESSMENT_DA_DETAILS_NC),
/// UpdateConfirmance (SP_ASSESSMENT_DA_UPDATE_REQUIREMENT), ValidateEvidence (SP_ASSESSMENT_DA_UPDATE_EVIDENCES),
/// ValidateProduct (SP_ASSESSMENT_DA_UPDATE_PRODUCT), ValidateSiteExterior (SP_ASSESSMENT_DA_UPDATE_SITE_EXTERIOR),
/// ExemptedFromAssessment (SP_ASSESSMENT_DA_UPDATE_PARAMETER), SaveTimestamp (SP_ASSESSMENT_DA_UPDATE_TIMESTAMP),
/// ConfirmFinalSubmit (SP_ASSESSMENT_DA_CONFIRM_FINAL_SUBMIT) and FinalSubmit (SP_ASSESSMENT_DA_FINAL_SUBMIT).
/// <para>
/// The legacy actions had no authorisation; the update procedures change rows by the Id the browser
/// sends and never check who calls them, so anyone could change conformance or final-submit any
/// assessment. Here:
/// </para>
/// <list type="bullet">
/// <item>reading is limited to the roles of the old page, and the procedures get UserId/RoleId from the
/// sign-in cookie (they hide records not allotted to an agency or assessor);</item>
/// <item>every change is made only by the desktop assessor the record is allotted to (and who accepted
/// it), only while the desktop verification is open (see <see cref="CertificationRecord.IsOpenForDesktopAssessment"/>),
/// and every requirement/evidence/product/section id must belong to that ZED ID, certification and current NC round;</item>
/// <item>"NC raised" is decided by the procedure on the server, not taken from the browser;</item>
/// <item>files are served through <see cref="File"/> after the same visibility check.</item>
/// </list>
/// The agency and master-admin review actions of the page (edit remarks, final submit, reject, send back:
/// the old MonitoringController) are in <see cref="Monitoring.MonitoringReviewController"/>; <see cref="Permissions.Review"/>
/// tells the page which of them apply (<see cref="Monitoring.ReviewRules"/>).
/// </summary>
[Route("api/staff/assessment/da/{zedId}/{certification}")]
[StaffRoles(UserRole.MasterAdmin, UserRole.Agency, UserRole.DesktopAssessor, UserRole.SuperAdmin, UserRole.Ministry, UserRole.CitizenFeedback, UserRole.QC)]
public sealed class DesktopAssessmentController(
    ISqlExecutor db,
    IWebHostEnvironment env,
    IOptions<PortalOptions> portal,
    ILogger<DesktopAssessmentController> log) : StaffApiController
{
    private static readonly FileExtensionContentTypeProvider ContentTypes = new();

    // ----- columns the page shows (the procedures select whole rows: passwords are not among them, but
    // assessor/agency ids, photo paths, latitude/longitude of every photo, ...) -----

    private static readonly string[] MsmeFields =
    [
        "ZedId", "Certification", "PUnitName", "UdyogAadharNo", "PlantAddress", "BasicInfoStatus", "DocVerifiAllot",
        "Nc1Raised", "Nc1Submitted", "Nc2Raised", "Nc2Submitted", "Nc3Raised", "Nc3Submitted", "Nc4Raised", "Nc4Submitted",
        "Nc5Raised", "Nc5Submitted", "CompletedOn",
        "AuditsConducted", "DomesticCustomers", "InternationalCustomers", "RawMaterialImported", "OutsourcedProcesses", "EnergySources",
        "ManufacturingCapacityValue", "ManufacturingCapacityUnits", "MonthlyUtilizationValue", "MonthlyUtilizationUnits",
        "CertificationStatus", "NcCount", "SecNcCount", "NcStatus", "Nc1Status", "Nc2Status", "Nc3Status", "Nc4Status", "Nc5Status",
        "AssessorRemarks", "SendBackStatus", "SendBackRemarks", "IsAutoReject",
    ];

    /// <summary>Agency and assessor names; the old page hid them from QC users.</summary>
    private static readonly string[] StaffNameFields = ["CertificationBodyUserId", "AgencyName", "DesktopAssessorId", "DesktopAssessorName"];

    private static readonly string[] ProductFields =
        ["Id", "ProductName", "Exported", "IsVerified", "AssessorRemarks", "NcCount", "MsmeRemarks", "ProductParentId"];
    private static readonly string[] RawMaterialFields = ["ModeOfAssessment", "RawMaterialName", "Percentage", "CountryName"];
    private static readonly string[] SectionFields = ["Id", "SectionCode", "SectionName", "iButton", "ValidationRequired", "IsAssessmentExcempted"];
    private static readonly string[] RequirementFields = ["Id", "SectionCode", "RequirementCode", "Conformance", "AssessorRemarks", "OpenedFlag", "MsmeComments"];
    private static readonly string[] OptionFields = ["SectionCode", "RequirementCode", "OptionCode", "OptionName"];
    private static readonly string[] SubOptionFields = ["SectionCode", "RequirementCode", "OptionCode", "SubOptionCode", "SubOptionName"];
    private static readonly string[] EvidenceFields =
    [
        "Id", "SectionCode", "RequirementCode", "EvidenceCode", "EvidenceName", "ValidationRequired", "IsVerified", "SourceOfValidation",
        "AssessorRemarks", "SyncedDate", "NcCount", "Conformance", "RequirementRemarks", "RequirementMsmeRemarks",
    ];
    private static readonly string[] PhotoFields = ["Id", "PhotoId", "PhotoType", "IsVerified", "AssessorRemarks", "MsmeRemarks", "NcCount", "DocumentOpenedTime"];
    private static readonly string[] EsgFields = ["Code", "Question", "Answer", "IfYesQuestion", "IfYesAnswer", "IfNoQuestion", "IfNoAnswer", "CheckListType"];

    public sealed record NcRound(
        int NcCount,
        IReadOnlyList<Dictionary<string, object?>> Products,
        IReadOnlyList<Dictionary<string, object?>> OldProducts,
        IReadOnlyList<Dictionary<string, object?>> Sections,
        IReadOnlyList<Dictionary<string, object?>> Requirements,
        IReadOnlyList<Dictionary<string, object?>> Options,
        IReadOnlyList<Dictionary<string, object?>> SubOptions,
        IReadOnlyList<Dictionary<string, object?>> Evidences,
        IReadOnlyList<Dictionary<string, object?>> Photos,
        string? AssessorRemarks);

    public sealed record Permissions(
        bool CanAssess,              // the signed-in user is the accepted desktop assessor and the verification is open
        bool CanFinalSubmit,
        bool CanWithdrawExemption,   // master admin: exemption Yes -> No of a Silver/Gold record at status 5, 6 or 8
        Monitoring.ReviewActions Review); // agency / master-admin review actions open to the user now

    public sealed record DaDetailsResponse(
        string ZedId,
        string Certification,
        string Role,
        Dictionary<string, object?> Msme,
        IReadOnlyList<Dictionary<string, object?>> Products,
        IReadOnlyList<Dictionary<string, object?>> RawMaterials,
        IReadOnlyList<Dictionary<string, object?>> Sections,
        IReadOnlyList<Dictionary<string, object?>> Requirements,
        IReadOnlyList<Dictionary<string, object?>> Options,
        IReadOnlyList<Dictionary<string, object?>> SubOptions,
        IReadOnlyList<Dictionary<string, object?>> Evidences,
        IReadOnlyList<Dictionary<string, object?>> Photos,
        Dictionary<string, object?>? Location,
        IReadOnlyList<Dictionary<string, object?>> EsgCheckList,
        IReadOnlyList<NcRound> NcRounds,
        Permissions Permissions);

    // ======================================================================== read

    [HttpGet]
    public async Task<ActionResult<DaDetailsResponse>> Get(string zedId, string certification, CancellationToken ct)
    {
        var level = AssessmentInput.Level(certification);
        if (!AssessmentInput.IsId(zedId) || level is null) return this.Problem400("Invalid request.");

        var user = CurrentUser;
        var args = new { UserId, RoleId = RoleText, ZedId = zedId, Certification = level };
        var da = await db.QueryProcMultipleAsync("SP_ASSESSMENT_DA_DETAILS", args, ct);
        // The procedure answers with an empty record (ZED ID '000') when the user may not see it.
        if (da[0].FirstOrDefault() is not { } main || !AssessmentInput.IsId(main.Text("ZedId")))
            return NotFound();

        var record = await AssessmentRecords.CertificationAsync(db, zedId, level, ct);
        if (record is null || !record.CanView(user)) return NotFound();

        var moved = main.Text("PhotosPath").Length > 0;
        var msme = Pick(main, MsmeFields);
        if (user.RoleId != (int)UserRole.QC)
        {
            foreach (var f in StaffNameFields) msme[f] = Value(main, f);
            msme["AgencyName"] ??= Value(main, "UserName");
        }

        var bronze = level == "Bronze";
        var evidences = Evidences(da[7], zedId, level, moved);
        var screenshots = da[bronze ? 10 : 21];
        foreach (var e in evidences) e["Screenshots"] = Screenshots(screenshots, e, zedId, level);

        // NC rounds exist only for Bronze desktop verification (Silver/Gold NCs are raised at the site assessment).
        var ncCount = Math.Clamp(record.Nc, 0, 5);
        var rounds = bronze && ncCount > 0
            ? await Task.WhenAll(Enumerable.Range(1, ncCount).Select(n => Round(zedId, level, n, moved, ct)))
            : [];

        var status = record.Status;
        var permissions = new Permissions(
            record.CanAssess(user),
            record.CanFinalSubmit(user),
            IsRole(UserRole.MasterAdmin) && !bronze && status is 5 or 6 or 8,
            Monitoring.ReviewRules.For(user, record, Monitoring.ReviewStage.Desktop));

        return new DaDetailsResponse(
            zedId, level, user.RoleName, msme,
            Products(da[1], zedId, level, moved),
            Pick(da[2], RawMaterialFields),
            Pick(da[3], SectionFields),
            Pick(da[4], RequirementFields),
            Pick(da[5], OptionFields),
            Pick(da[6], SubOptionFields),
            evidences,
            Photos(da[8], zedId, level, moved),
            da[9].FirstOrDefault() is { } ll ? Pick(ll, ["Latitude", "Longitude"]) : null,
            Pick(da[bronze ? 11 : 22], EsgFields),
            rounds,
            permissions);
    }

    private async Task<NcRound> Round(string zedId, string level, int n, bool moved, CancellationToken ct)
    {
        var nc = await db.QueryProcMultipleAsync("SP_ASSESSMENT_DA_DETAILS_NC",
            new { UserId, RoleId = RoleText, ZedId = zedId, Certification = level, NcCount = n }, ct);
        return new NcRound(
            n,
            Products(nc[0], zedId, level, moved),
            Products(nc[8], zedId, level, moved),
            Pick(nc[1], SectionFields),
            Pick(nc[2], RequirementFields),
            Pick(nc[3], OptionFields),
            Pick(nc[4], SubOptionFields),
            Evidences(nc[5], zedId, level, moved),
            Photos(nc[6], zedId, level, moved),
            nc[7].FirstOrDefault()?.Text("AssessorRemarksNc") is { Length: > 0 } r ? r : null);
    }

    /// <summary>
    /// GET api/staff/assessment/da/{zedId}/{certification}/files/mobileapi/Photos/{zedId}/{certification}/Evidences/123.pdf —
    /// photos, evidence PDFs and uploaded screenshots of a record the user may see (addresses as returned by <see cref="Get"/>).
    /// </summary>
    [HttpGet("files/{**path}")]
    public async Task<IActionResult> File(string zedId, string certification, string? path, CancellationToken ct)
    {
        // Malformed, foreign and missing files all answer 404 so file existence is not revealed.
        var level = AssessmentInput.Level(certification);
        var requested = DaFiles.Normalise(path);
        if (!AssessmentInput.IsId(zedId) || level is null || requested is null || !DaFiles.BelongsTo(requested, zedId, level))
            return NotFound();

        var record = await AssessmentRecords.CertificationAsync(db, zedId, level, ct);
        if (record is null || !record.CanView(CurrentUser)) return NotFound();

        var root = StorageRoot;
        var fullPath = DaFiles.StorageCandidates(requested, zedId)
            .Select(c => MsmeFilePaths.Resolve(root, c))
            .FirstOrDefault(p => p is not null && System.IO.File.Exists(p));
        if (fullPath is null)
        {
            log.LogInformation("Assessment file {Path} for {ZedId} is missing from storage", requested, zedId);
            return NotFound();
        }

        var fileName = Path.GetFileName(fullPath);
        var contentType = ContentTypes.TryGetContentType(fileName, out var t) ? t : "application/octet-stream";
        Response.Headers.XContentTypeOptions = "nosniff";
        Response.Headers.CacheControl = "private, no-store";
        Response.Headers.ContentDisposition = new ContentDispositionHeaderValue("inline") { FileNameStar = fileName }.ToString();
        return PhysicalFile(fullPath, contentType, enableRangeProcessing: true);
    }

    // ======================================================================== desktop assessor actions

    public sealed record ConformanceRequest(string? Conformance, string? Remarks);

    /// <summary>Conformance of a requirement (UpdateConfirmance).</summary>
    [HttpPost("requirements/{id:long}/conformance")]
    [StaffRoles(UserRole.DesktopAssessor)]
    [SubRole(SubRoles.DesktopVerification)]
    public async Task<ActionResult<MessageResponse>> Conformance(string zedId, string certification, long id, ConformanceRequest req, CancellationToken ct)
    {
        var (level, record, error) = await ForAssessor(zedId, certification, ct);
        if (error is not null) return error;
        var conformance = AssessmentInput.YesNo(req.Conformance);
        var remarks = AssessmentInput.Text(req.Remarks);
        if (conformance is null) return this.Problem400("Please select the conformance.");
        if (conformance == "No" && remarks is null) return this.Problem400("Please enter remarks.");
        if (remarks?.Length > 2000) return this.Problem400("Remarks must be at most 2000 characters.");
        if (!await InCurrentRound(AssessmentRecords.RequirementSql, id, zedId, level!, record!, ct)) return NotFound();

        // As before only Id/Conformance/remark are passed: with the ZED ID the procedure would also reset
        // the certification status, which the old action never did.
        await db.ExecuteProcAsync("SP_ASSESSMENT_DA_UPDATE_REQUIREMENT",
            new { Id = id.ToString(CultureInfo.InvariantCulture), Conformance = conformance, AssessorRemark = remarks }, ct);
        return new MessageResponse("Data Updated");
    }

    public sealed record ValidationRequest(string? IsVerified, string? Remarks);

    [HttpPost("products/{id:long}/validate")]
    [StaffRoles(UserRole.DesktopAssessor)]
    [SubRole(SubRoles.DesktopVerification)]
    public async Task<ActionResult<MessageResponse>> ValidateProduct(string zedId, string certification, long id, ValidationRequest req, CancellationToken ct)
    {
        var (level, record, error) = await ForAssessor(zedId, certification, ct);
        if (error is not null) return error;
        if (Validation(req, out var verified, out var remarks) is { } message) return this.Problem400(message);
        if (!await InCurrentRound(AssessmentRecords.ProductSql, id, zedId, level!, record!, ct)) return NotFound();

        await db.ExecuteProcAsync("SP_ASSESSMENT_DA_UPDATE_PRODUCT", new
        {
            Id = id.ToString(CultureInfo.InvariantCulture), ZedId = zedId, CertificationType = level, IsVerified = verified, AssessorRemarks = remarks,
        }, ct);
        return new MessageResponse("Data Updated");
    }

    [HttpPost("site-exterior/validate")]
    [StaffRoles(UserRole.DesktopAssessor)]
    [SubRole(SubRoles.DesktopVerification)]
    public async Task<ActionResult<MessageResponse>> ValidateSiteExterior(string zedId, string certification, ValidationRequest req, CancellationToken ct)
    {
        var (level, _, error) = await ForAssessor(zedId, certification, ct);
        if (error is not null) return error;
        if (Validation(req, out var verified, out var remarks) is { } message) return this.Problem400(message);

        // The procedure updates the site exterior photos of this ZED ID, certification and current NC round.
        await db.ExecuteProcAsync("SP_ASSESSMENT_DA_UPDATE_SITE_EXTERIOR",
            new { ZedId = zedId, CertificationType = level, IsVerified = verified, AssessorRemarks = remarks }, ct);
        return new MessageResponse("Data Updated");
    }

    public sealed class EvidenceForm
    {
        public string? IsVerified { get; set; }
        public string? SourceOfValidation { get; set; }
        public string? Remarks { get; set; }
        public List<IFormFile>? Files { get; set; }
    }

    /// <summary>Validation of an evidence with optional screenshots (ValidateEvidence, multipart form).</summary>
    [HttpPost("evidences/{id:long}/validate")]
    [StaffRoles(UserRole.DesktopAssessor)]
    [SubRole(SubRoles.DesktopVerification)]
    [Consumes("multipart/form-data")]
    [RequestSizeLimit(EvidenceUploads.MaxRequestBytes)]
    [RequestFormLimits(MultipartBodyLengthLimit = EvidenceUploads.MaxRequestBytes)]
    public async Task<ActionResult<MessageResponse>> ValidateEvidence(string zedId, string certification, long id, [FromForm] EvidenceForm form, CancellationToken ct)
    {
        var (level, record, error) = await ForAssessor(zedId, certification, ct);
        if (error is not null) return error;

        var verified = AssessmentInput.YesNo(form.IsVerified);
        var source = verified == "Yes" ? AssessmentInput.Text(form.SourceOfValidation) : null;
        var remarks = AssessmentInput.Text(form.Remarks);
        var files = form.Files ?? [];
        if (verified is null) return this.Problem400("Please select whether the evidence is verified.");
        if (verified == "Yes" && source is null) return this.Problem400("Please enter the source of validation.");
        if (source?.Length > 200) return this.Problem400("Source of validation must be at most 200 characters.");
        if (verified == "No" && remarks is null) return this.Problem400("Please enter remarks.");
        if (remarks?.Length > 1000) return this.Problem400("Remarks must be at most 1000 characters.");
        if (verified == "Yes" && files.Count == 0) return this.Problem400("Please upload valid pdf document.");
        if (verified == "No" && files.Count > 0) return this.Problem400("Screenshots are uploaded only for verified evidences.");

        // Section/requirement/evidence codes come from the database row, never from the browser.
        var evidence = await AssessmentRecords.ItemAsync(db, AssessmentRecords.EvidenceSql, id, zedId, level!, ct);
        if (evidence is null || (evidence.NcCount ?? 0) != record!.Nc) return NotFound();
        if (evidence.ValidationRequired != true) return this.Problem400("This evidence does not need validation.");
        if (!EvidenceUploads.IsCode(evidence.SectionCode) || !EvidenceUploads.IsCode(evidence.RequirementCode) || !EvidenceUploads.IsCode(evidence.EvidenceCode))
        {
            log.LogWarning("Evidence {Id} of {ZedId} has codes that cannot form a folder name", id, zedId);
            return this.Problem400("This evidence cannot be validated here.");
        }

        var (checkedFiles, fileError) = await EvidenceUploads.CheckAsync(files, ct);
        if (fileError is not null) return this.Problem400(fileError);

        var folder = DaFiles.ScreenshotFolder(zedId, level!, evidence.SectionCode!, evidence.RequirementCode!, evidence.EvidenceCode!);
        var saved = await EvidenceUploads.SaveAsync(StorageRoot, folder, checkedFiles, ct);
        try
        {
            var p = new DynamicParameters();
            p.Add("Id", id.ToString(CultureInfo.InvariantCulture));
            p.Add("ZedId", zedId);
            p.Add("CertificationType", level);
            p.Add("IsVerified", verified);
            p.Add("SourceOfValidation", source);
            p.Add("Remark", remarks);
            if (saved.Count > 0)
            {
                var table = new DataTable();
                table.Columns.Add("FileName", typeof(string));
                foreach (var (name, _) in saved) table.Rows.Add(name);
                p.Add("Screenshots", table.AsTableValuedParameter("FileDetails"));
            }
            await db.ExecuteProcAsync("SP_ASSESSMENT_DA_UPDATE_EVIDENCES", p, ct);
        }
        catch
        {
            EvidenceUploads.Delete(saved);
            throw;
        }
        log.LogInformation("Assessor {UserId} validated evidence {Id} of {ZedId} {Certification} ({Files} files)", UserId, id, zedId, level, saved.Count);
        return new MessageResponse("Data Updated");
    }

    public sealed record ExemptionRequest(string? IsAssessmentExcempted);

    /// <summary>
    /// "Exempted from Remote/Site Assessment" of a section (ExemptedFromAssessment): the desktop assessor
    /// before the first final submit, or the master admin withdrawing an exemption (Yes → No) of a
    /// Silver/Gold record at status 5, 6 or 8, as on the old page.
    /// </summary>
    [HttpPost("sections/{id:long}/exemption")]
    [StaffRoles(UserRole.DesktopAssessor, UserRole.MasterAdmin)]
    [SubRole(SubRoles.DesktopVerification)]
    public async Task<ActionResult<MessageResponse>> Exemption(string zedId, string certification, long id, ExemptionRequest req, CancellationToken ct)
    {
        var level = AssessmentInput.Level(certification);
        if (!AssessmentInput.IsId(zedId) || level is null) return this.Problem400("Invalid request.");
        var value = AssessmentInput.YesNo(req.IsAssessmentExcempted);
        if (value is null) return this.Problem400("Please select Yes or No.");

        var record = await AssessmentRecords.CertificationAsync(db, zedId, level, ct);
        var user = CurrentUser;
        if (record is null || !record.CanView(user)) return NotFound();
        var section = await AssessmentRecords.ItemAsync(db, AssessmentRecords.SectionSql, id, zedId, level, ct);
        if (section is null || (section.NcCount ?? 0) != 0) return NotFound();

        var allowed = IsRole(UserRole.MasterAdmin)
            ? level != "Bronze" && record.Status is 5 or 6 or 8 && value == "No" && section.IsAssessmentExcempted == "Yes"
            : record.CanAssess(user) && record.Status <= 3;
        if (!allowed) return Forbidden("The exemption of this parameter cannot be changed now.");

        await db.ExecuteProcAsync("SP_ASSESSMENT_DA_UPDATE_PARAMETER",
            new { Id = id.ToString(CultureInfo.InvariantCulture), IsAssessmentExcempted = value }, ct);
        log.LogInformation("{UserId} set exemption of section {Id} of {ZedId} {Certification} to {Value}", UserId, id, zedId, level, value);
        return new MessageResponse(value == "Yes"
            ? "Parameter exempted from Remote/Site Assessment"
            : "Parameter not exempted from Remote/Site Assessment");
    }

    public sealed record OpenedRequest(string? Type, long Id);

    /// <summary>
    /// Records that the assessor opened a document or photo (SaveTimestamp); the procedure then marks the
    /// requirement as ready to validate once all its documents were opened.
    /// </summary>
    [HttpPost("opened")]
    [StaffRoles(UserRole.DesktopAssessor)]
    [SubRole(SubRoles.DesktopVerification)]
    public async Task<ActionResult<MessageResponse>> Opened(string zedId, string certification, OpenedRequest req, CancellationToken ct)
    {
        var (level, _, error) = await ForAssessor(zedId, certification, ct);
        if (error is not null) return error;
        var (sql, photoType) = req.Type switch
        {
            "Evidence" => (AssessmentRecords.EvidenceSql, (string?)null),
            "SiteExteriorPhoto" => (AssessmentRecords.SiteExteriorPhotoSql, "SiteExteriorPhoto"),
            "ProductPhoto" => (AssessmentRecords.ProductSql, "ProductPhoto"),
            "ProductDescriptionPhoto" => (AssessmentRecords.ProductSql, "ProductDescriptionPhoto"),
            _ => (null, null),
        };
        if (sql is null) return this.Problem400("Invalid request.");
        if (await AssessmentRecords.ItemAsync(db, sql, req.Id, zedId, level!, ct) is null) return NotFound();

        await db.ExecuteProcAsync("SP_ASSESSMENT_DA_UPDATE_TIMESTAMP", new
        {
            UserId, RoleId = RoleText, ZedId = zedId, Id = req.Id.ToString(CultureInfo.InvariantCulture), PhotoType = photoType,
        }, ct);
        return new MessageResponse("Saved");
    }

    public sealed record FinalSubmitCheck(bool Allowed, string? Message, bool RaisesNc);

    /// <summary>Checks before the final-submit pop-up (ConfirmFinalSubmit).</summary>
    [HttpPost("final-submit/check")]
    [StaffRoles(UserRole.DesktopAssessor)]
    [SubRole(SubRoles.DesktopVerification)]
    public async Task<ActionResult<FinalSubmitCheck>> CheckFinalSubmit(string zedId, string certification, CancellationToken ct)
    {
        var (level, record, error) = await ForAssessor(zedId, certification, ct);
        if (error is not null) return error;
        if (!record!.CanFinalSubmit(CurrentUser)) return Forbidden("This assessment cannot be submitted now.");
        return await Confirm(zedId, level!, ct);
    }

    public sealed record FinalSubmitRequest(string? Remarks);

    [HttpPost("final-submit")]
    [StaffRoles(UserRole.DesktopAssessor)]
    [SubRole(SubRoles.DesktopVerification)]
    public async Task<ActionResult<MessageResponse>> FinalSubmit(string zedId, string certification, FinalSubmitRequest req, CancellationToken ct)
    {
        var (level, record, error) = await ForAssessor(zedId, certification, ct);
        if (error is not null) return error;
        var remarks = AssessmentInput.Text(req.Remarks);
        if (remarks is null) return this.Problem400("Please enter assessor final remarks.");
        if (remarks.Length > 2000) return this.Problem400("Remarks must be at most 2000 characters.");
        if (!record!.CanFinalSubmit(CurrentUser)) return Forbidden("This assessment cannot be submitted now.");

        // The old page sent "isNcRaised" from the browser; the procedure's own answer is used instead.
        var check = await Confirm(zedId, level!, ct);
        if (!check.Allowed) return this.Problem400(check.Message ?? "Please complete the assessment before final submit.");

        await db.ExecuteProcAsync("SP_ASSESSMENT_DA_FINAL_SUBMIT", new { ZedId = zedId, CertificationType = level, AssessorRemarks = remarks }, ct);
        log.LogInformation("Assessor {UserId} final-submitted {ZedId} {Certification} (NC raised: {Nc})", UserId, zedId, level, check.RaisesNc);
        if (check.RaisesNc)
            await DesktopAssessmentEmails.Create(HttpContext.RequestServices)
                .SendAsync(DesktopAssessmentEmails.Kind.NcRaised, zedId, level!, null, ct);
        return new MessageResponse("Assessment submitted.");
    }

    // ======================================================================== helpers

    private string RoleText => RoleId.ToString(CultureInfo.InvariantCulture);

    private string StorageRoot => Path.GetFullPath(Path.Combine(env.ContentRootPath, portal.Value.StorageRoot));

    private ObjectResult Forbidden(string message) => Problem(title: message, statusCode: StatusCodes.Status403Forbidden);

    /// <summary>
    /// The record for a desktop-assessor change: 404 when the user may not see it, 403 when it is not the
    /// user's accepted desktop assessment or the verification is closed.
    /// </summary>
    private async Task<(string? Level, CertificationRecord? Record, ActionResult? Error)> ForAssessor(string zedId, string certification, CancellationToken ct)
    {
        var level = AssessmentInput.Level(certification);
        if (!AssessmentInput.IsId(zedId) || level is null) return (null, null, this.Problem400("Invalid request."));
        var record = await AssessmentRecords.CertificationAsync(db, zedId, level, ct);
        var user = CurrentUser;
        if (record is null || !record.CanView(user)) return (level, null, NotFound());
        if (!record.CanAssess(user)) return (level, record, Forbidden("This assessment is not open for your desktop verification."));
        return (level, record, null);
    }

    /// <summary>The row exists for this ZED ID and certification, in the current NC round.</summary>
    private async Task<bool> InCurrentRound(string sql, long id, string zedId, string level, CertificationRecord record, CancellationToken ct) =>
        await AssessmentRecords.ItemAsync(db, sql, id, zedId, level, ct) is { } item && (item.NcCount ?? 0) == record.Nc;

    private async Task<FinalSubmitCheck> Confirm(string zedId, string level, CancellationToken ct)
    {
        var sets = await db.QueryProcMultipleAsync("SP_ASSESSMENT_DA_CONFIRM_FINAL_SUBMIT", new { ZedId = zedId, CertificationType = level }, ct);
        var row = sets[0].FirstOrDefault();
        var allowed = row is not null && row.Text("AllowFinalSubmit") == "1";
        var message = row?.Text("ErrorMessage") is { Length: > 0 } m ? m : null;
        return new FinalSubmitCheck(allowed, allowed ? null : message ?? "Please complete the assessment before final submit.", sets[1].FirstOrDefault()?.Text("RaisedForNc") == "1");
    }

    private static string? Validation(ValidationRequest req, out string? verified, out string? remarks)
    {
        verified = AssessmentInput.YesNo(req.IsVerified);
        remarks = AssessmentInput.Text(req.Remarks);
        if (verified is null) return "Please select the conformance.";
        if (verified == "No" && remarks is null) return "Please enter remarks.";
        if (remarks?.Length > 1000) return "Remarks must be at most 1000 characters.";
        return null;
    }

    private static List<Dictionary<string, object?>> Products(IEnumerable<IDictionary<string, object?>> rows, string zedId, string level, bool moved) =>
        rows.Select(p =>
        {
            var d = Pick(p, ProductFields);
            var description = p.Text("ProductDescriptionPhoto");
            var kind = description.Contains(".pdf", StringComparison.OrdinalIgnoreCase) ? "pdf"
                : description.Contains(".jpg", StringComparison.OrdinalIgnoreCase) || description.Contains(".jpeg", StringComparison.OrdinalIgnoreCase) ||
                  description.Contains(".png", StringComparison.OrdinalIgnoreCase) ? "image" : null;
            d["PhotoUrl"] = DaFiles.AppUpload(zedId, level, moved, "BasicInfo", p.Text("ProductPhoto"));
            d["DescriptionUrl"] = kind is null ? null : DaFiles.AppUpload(zedId, level, moved, "BasicInfo", description);
            d["DescriptionKind"] = kind;
            d["ProductOpened"] = p.Text("ProductOpenedTime").Length > 0;
            d["DescriptionOpened"] = p.Text("ProductDescOpenedTime").Length > 0;
            return d;
        }).ToList();

    private static List<Dictionary<string, object?>> Evidences(IEnumerable<IDictionary<string, object?>> rows, string zedId, string level, bool moved) =>
        rows.Select(e =>
        {
            var d = Pick(e, EvidenceFields);
            d["Opened"] = e.Text("DocumentOpenedTime").Length > 0;
            d["FileUrl"] = e.Text("SyncedDate").Length > 0 && e.Text("EvidenceId") is { Length: > 0 } eid
                ? DaFiles.AppUpload(zedId, level, moved, "Evidences", eid + ".pdf")
                : null;
            return d;
        }).ToList();

    private static List<string> Screenshots(IEnumerable<IDictionary<string, object?>> rows, Dictionary<string, object?> evidence, string zedId, string level)
    {
        var id = Convert.ToString(evidence["Id"], CultureInfo.InvariantCulture);
        string Code(string column) => Convert.ToString(evidence[column], CultureInfo.InvariantCulture) ?? "";
        var (s, r, e) = (Code("SectionCode"), Code("RequirementCode"), Code("EvidenceCode"));
        if (string.IsNullOrEmpty(id) || !EvidenceUploads.IsCode(s) || !EvidenceUploads.IsCode(r) || !EvidenceUploads.IsCode(e)) return [];
        return rows.Where(x => x.Text("RefEvidenceId") == id && x.Text("FileName").Length > 0 && !x.Text("FileName").Contains('/'))
            .Select(x => DaFiles.Url(zedId, level, DaFiles.ScreenshotFolder(zedId, level, s, r, e) + "/" + x.Text("FileName").Trim()))
            .OfType<string>()
            .ToList();
    }

    private static List<Dictionary<string, object?>> Photos(IEnumerable<IDictionary<string, object?>> rows, string zedId, string level, bool moved) =>
        rows.Select(p =>
        {
            var d = Pick(p, PhotoFields);
            var type = p.Text("PhotoType");
            d["Url"] = type is "Selfie" or "SiteExteriorPhotos" && p.Text("PhotoId") is { Length: > 0 } photoId
                ? DaFiles.AppUpload(zedId, level, moved, type, photoId + ".jpg")
                : null;
            return d;
        }).ToList();

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
        _ => value,
    };
}
