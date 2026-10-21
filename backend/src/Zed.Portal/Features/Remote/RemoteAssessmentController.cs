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

namespace Zed.Portal.Features.Remote;

/// <summary>
/// The site assessor's live remote (video) assessment of a unit: Views/Remote/Index.cshtml, reached from the
/// "ASSESS" link of the Remote/Onsite Assessment list for units allotted in "Remote Assessment" mode. Port of
/// RemoteController Index (Twilio token; SP_ASSESSMENT_DA_DETAILS + SP_ASSESSMENT_SA_DETAILS through
/// Assessment/GetDaDetails and GetSaDetails), UpdateStartAssessmentStatus (SP_ASSESSMENT_RA_UPDATE_JOIN_ROOM_STATUS),
/// UpdateBasicInfo (SP_ASSESSMENT_RA_UPDATE_BASIC_INFO), UpdateConfirmance (SP_ASSESSMENT_RA_UPDATE_REQUIREMENT),
/// ValidateProduct (SP_ASSESSMENT_RA_UPDATE_PRODUCT), ValidateSiteExterior (SP_ASSESSMENT_RA_UPDATE_SITE_EXTERIOR),
/// UpdateComments (SP_ASSESSMENT_RA_UPDATE_COMMENTS), AddParticipant (SP_ASSESSMENT_RA_ADD_PARTICIPANT),
/// SaveCapturedPhoto / GetUpdatedPhoto / DeletePhoto (SP_ASSESSMENT_RA_UPDATE_PHOTOS / _GET_UPDATED_PHOTOS /
/// _DELETE_PHOTOS), ConfirmFinalSubmit (SP_ASSESSMENT_RA_CONFIRM_FINAL_SUBMIT) and FinalSubmit (SP_ASSESSMENT_RA_FINAL_SUBMIT).
/// <para>
/// The old controller had no sign-in check at all: anyone could mint a video token for any unit's room,
/// change its assessment and final-submit it (which issues the certification number when no NC is raised).
/// Here: desktop assessors with the site verification sub-role only; the unit must be allotted in remote
/// mode and the caller must be its lead assessor (the co-assessor can view); changes and the video token
/// only while the remote assessment is open (status 9 or 13, when the old page let it in); every id must
/// belong to the unit; captured photos are decoded, type-checked and stored under server-chosen names;
/// photos are served through <see cref="File"/>; the final submit re-runs the procedure's checks and the
/// NC decision comes from the procedure, not the browser.
/// </para>
/// </summary>
[Route("api/staff/remote/{zedId}/{certification}")]
[StaffRoles(UserRole.DesktopAssessor)]
[SubRole(SubRoles.SiteVerification)]
public sealed class RemoteAssessmentController(
    ISqlExecutor db,
    IWebHostEnvironment env,
    IOptions<PortalOptions> portal,
    IConfiguration config,
    ILogger<RemoteAssessmentController> log) : StaffApiController
{
    public const string RemoteMode = "Remote Assessment";
    public static readonly string[] Levels = ["Silver", "Gold"];

    private static readonly FileExtensionContentTypeProvider ContentTypes = new();

    // ----- columns the page shows (the procedures return whole rows) -----

    private static readonly string[] MsmeFields =
    [
        "ZedId", "Certification", "EnterpriseName", "PUnitName", "UdyogAadharNo", "PlantAddress", "DaAllocationDate", "DaVerificationDate",
        "DesktopAssessorId", "DesktopAssessorName", "AssessmentDate", "CertificationStatus", "NcCount", "AssessorRemarks", "SaAssessorRemarks", "IsSaVerified",
        "AuditsConducted", "DomesticCustomers", "InternationalCustomers", "RawMaterialImported", "OutsourcedProcesses", "EnergySources",
        "ManufacturingCapacityUnits", "ManufacturingCapacityValue", "MonthlyUtilizationUnits", "MonthlyUtilizationValue",
        "SaAuditsConducted", "SaDomesticCustomers", "SaInternationalCustomers", "SaOutsourcedProcesses", "SaEnergySources",
        "SaManufacturingCapacityUnits", "SaManufacturingCapacityValue", "SaMonthlyUtilizationUnits", "SaMonthlyUtilizationValue",
    ];

    private static readonly string[] ProductFields = ["Id", "ProductName", "Exported", "IsVerified", "AssessorRemarks", "IsSaVerified", "SaAssessorRemarks"];
    private static readonly string[] RawMaterialFields = ["ModeOfAssessment", "RawMaterialName", "Percentage", "CountryName"];
    private static readonly string[] SectionFields = ["Id", "SectionCode", "SectionName", "iButton", "IsAssessmentExcempted", "OfiComments"];
    private static readonly string[] RequirementFields = ["Id", "SectionCode", "RequirementCode", "Conformance", "AssessorRemarks", "SaConformance", "SaAssessorRemarks"];
    private static readonly string[] OptionFields = ["SectionCode", "RequirementCode", "OptionCode", "OptionName"];
    private static readonly string[] SubOptionFields = ["SectionCode", "RequirementCode", "OptionCode", "SubOptionCode", "SubOptionName"];
    private static readonly string[] EvidenceFields = ["Id", "SectionCode", "RequirementCode", "EvidenceName", "IsVerified", "AssessorRemarks"];
    private static readonly string[] DaPhotoFields = ["Id", "PhotoType", "IsVerified", "AssessorRemarks"];

    /// <summary>Remote answers of the Basic Info tab (SP_ASSESSMENT_RA_UPDATE_BASIC_INFO columns the page offers; Yes/No ones marked).</summary>
    public static readonly IReadOnlyDictionary<string, bool> BasicInfoColumns = new Dictionary<string, bool>(StringComparer.Ordinal)
    {
        ["SaAuditsConducted"] = true,
        ["SaDomesticCustomers"] = false,
        ["SaInternationalCustomers"] = false,
        ["SaOutsourcedProcesses"] = false,
        ["SaEnergySources"] = false,
        ["SaManufacturingCapacityUnits"] = false,
        ["SaManufacturingCapacityValue"] = false,
        ["SaMonthlyUtilizationUnits"] = false,
        ["SaMonthlyUtilizationValue"] = false,
    };

    public sealed record RemotePhoto(long Id, string? Name, string? Url, bool Deletable);
    public sealed record Meeting(long Id, string? Comments, IReadOnlyList<Dictionary<string, object?>> Participants, IReadOnlyList<RemotePhoto> Photos);
    public sealed record Selfie(string? Url, string? RepresentativeName, string? Designation);
    public sealed record Permissions(bool IsLeadAssessor, bool CanAssess, bool VideoConfigured);

    public sealed record RemoteDetails(
        string ZedId,
        string Certification,
        Dictionary<string, object?> Msme,
        IReadOnlyList<Dictionary<string, object?>> Products,
        IReadOnlyList<Dictionary<string, object?>> RawMaterials,
        IReadOnlyList<Dictionary<string, object?>> Sections,
        IReadOnlyList<Dictionary<string, object?>> Requirements,
        IReadOnlyList<Dictionary<string, object?>> Options,
        IReadOnlyList<Dictionary<string, object?>> SubOptions,
        IReadOnlyList<Dictionary<string, object?>> Evidences,
        IReadOnlyList<Dictionary<string, object?>> DaPhotos,
        Dictionary<string, object?>? Location,
        IReadOnlyList<RemotePhoto> SiteExteriorPhotos,
        IReadOnlyList<RemotePhoto> SiteTourPhotos,
        Meeting? OpenMeeting,
        Meeting? CloseMeeting,
        IReadOnlyList<Selfie> Selfies,
        Permissions Permissions);

    // ======================================================================== read

    [HttpGet]
    public async Task<ActionResult<RemoteDetails>> Get(string zedId, string certification, CancellationToken ct)
    {
        var (level, record, error) = await ForViewer(zedId, certification, ct);
        if (error is not null) return error;
        var canAssess = CanAssess(record!);

        var args = new { UserId, RoleId = ((int)UserRole.DesktopAssessor).ToString(CultureInfo.InvariantCulture), ZedId = zedId, Certification = level };
        var da = await db.QueryProcMultipleAsync("SP_ASSESSMENT_DA_DETAILS", args, ct);
        if (da[0].FirstOrDefault() is not { } main || !AssessmentInput.IsId(main.Text("ZedId"))) return NotFound();
        var sa = await db.QueryProcMultipleAsync("SP_ASSESSMENT_SA_DETAILS", args, ct);

        var moved = main.Text("PhotosPath").Length > 0;
        RemotePhoto Photo(IDictionary<string, object?> p) => ToPhoto(p, zedId, level!, canAssess, p.Text("src") is { Length: > 0 } s ? s : p.Text("Photo"));
        List<RemotePhoto> Photos(IEnumerable<IDictionary<string, object?>> rows) => rows.Select(Photo).ToList();

        var productPhotos = sa[11];
        var products = da[1].Select(p =>
        {
            var d = Pick(p, ProductFields);
            var description = p.Text("ProductDescriptionPhoto");
            var kind = description.Contains(".pdf", StringComparison.OrdinalIgnoreCase) ? "pdf"
                : description.Contains(".jpg", StringComparison.OrdinalIgnoreCase) || description.Contains(".png", StringComparison.OrdinalIgnoreCase) ? "image" : null;
            d["PhotoUrl"] = DaFiles.AppUpload(zedId, level!, moved, "BasicInfo", p.Text("ProductPhoto"));
            d["DescriptionUrl"] = kind is null ? null : DaFiles.AppUpload(zedId, level!, moved, "BasicInfo", description);
            d["DescriptionKind"] = kind;
            d["RemotePhotos"] = Photos(productPhotos.Where(x => x.Text("ProductId") == p.Text("Id")));
            return d;
        }).ToList();

        var requirementPhotos = sa[7];
        var requirements = da[4].Select(r =>
        {
            var d = Pick(r, RequirementFields);
            var requirementId = r.Text("RequirementId");
            d["RemotePhotos"] = requirementId.Length == 0 ? [] : Photos(requirementPhotos.Where(x => x.Text("RequirementId") == requirementId));
            return d;
        }).ToList();

        var evidences = da[7].Select(e =>
        {
            var d = Pick(e, EvidenceFields);
            d["FileUrl"] = e.Text("SyncedDate").Length > 0 && e.Text("EvidenceId") is { Length: > 0 } eid
                ? DaFiles.AppUpload(zedId, level!, moved, "Evidences", eid + ".pdf")
                : null;
            return d;
        }).ToList();

        var daPhotos = da[8].Where(p => p.Text("PhotoType") is "Selfie" or "SiteExteriorPhotos").Select(p =>
        {
            var d = Pick(p, DaPhotoFields);
            d["Url"] = p.Text("PhotoId") is { Length: > 0 } photoId ? DaFiles.AppUpload(zedId, level!, moved, p.Text("PhotoType"), photoId + ".jpg") : null;
            return d;
        }).ToList();

        Meeting? MeetingOf(int meetingSet, int participantSet, int photoSet) =>
            sa[meetingSet].FirstOrDefault() is { } m && long.TryParse(m.Text("Id"), out var id)
                ? new Meeting(id, NullIfEmpty(m.Text("Comments")), Pick(sa[participantSet], ["Name", "Designation"]), Photos(sa[photoSet]))
                : null;

        var lat = da[9].FirstOrDefault();
        return new RemoteDetails(
            zedId, level!,
            Pick(main, MsmeFields),
            products,
            Pick(da[2], RawMaterialFields),
            Pick(da[3], SectionFields),
            requirements,
            Pick(da[5], OptionFields),
            Pick(da[6], SubOptionFields),
            evidences,
            daPhotos,
            lat is null ? null : Pick(lat, ["Latitude", "Longitude"]),
            Photos(sa[0]),
            Photos(sa[6]),
            MeetingOf(1, 2, 5),
            MeetingOf(3, 4, 8),
            sa[12].Select(s => new Selfie(RemoteFiles.Url(zedId, level!, s.Text("PhotoPath")), NullIfEmpty(s.Text("RepresentativeName")), NullIfEmpty(s.Text("Designation")))).ToList(),
            new Permissions(IsLead(record!), canAssess, TwilioVideoOptions.From(config).IsConfigured));
    }

    /// <summary>GET …/files/SaPhotos/{zedId}/{certification}/x.jpg — remote-assessment photos of the unit (addresses from <see cref="Get"/>).</summary>
    [HttpGet("files/{**path}")]
    public async Task<IActionResult> File(string zedId, string certification, string? path, CancellationToken ct)
    {
        // Malformed, foreign and missing files all answer 404 so file existence is not revealed.
        var level = Level(certification);
        var requested = RemoteFiles.Normalise(path);
        if (!AssessmentInput.IsId(zedId) || level is null || requested is null || !RemoteFiles.BelongsTo(requested, zedId, level))
            return NotFound();
        var (_, _, error) = await ForViewer(zedId, level, ct);
        if (error is not null) return NotFound();

        var root = StorageRoot;
        var fullPath = RemoteFiles.StorageCandidates(requested)
            .Select(c => MsmeFilePaths.Resolve(root, c))
            .FirstOrDefault(p => p is not null && System.IO.File.Exists(p));
        if (fullPath is null)
        {
            log.LogInformation("Remote assessment photo {Path} for {ZedId} is missing from storage", requested, zedId);
            return NotFound();
        }
        var fileName = Path.GetFileName(fullPath);
        var contentType = ContentTypes.TryGetContentType(fileName, out var t) ? t : "application/octet-stream";
        Response.Headers.XContentTypeOptions = "nosniff";
        Response.Headers.CacheControl = "private, no-store";
        Response.Headers.ContentDisposition = new ContentDispositionHeaderValue("inline") { FileNameStar = fileName }.ToString();
        return PhysicalFile(fullPath, contentType, enableRangeProcessing: true);
    }

    // ======================================================================== video

    public sealed record JoinResponse(string Token, string Room, string Identity, int ExpiresInSeconds);

    /// <summary>
    /// "Start Assessment": marks that the assessor joined the room (lets the MSME's RA app call in) and returns
    /// a Twilio Video token for the unit's room. Only the lead assessor of an open remote assessment gets one.
    /// </summary>
    [HttpPost("join")]
    public async Task<ActionResult<JoinResponse>> Join(string zedId, string certification, CancellationToken ct)
    {
        var (level, _, error) = await ForAssessor(zedId, certification, ct);
        if (error is not null) return error;
        var twilio = TwilioVideoOptions.From(config);
        if (!twilio.IsConfigured) return this.Problem400("Video calls are not configured on this server. Please contact the ZED team.");

        await db.ExecuteProcAsync("SP_ASSESSMENT_RA_UPDATE_JOIN_ROOM_STATUS", new { ZedId = zedId, CertificationType = level }, ct);
        var room = TwilioVideoToken.RoomName(zedId);
        var identity = zedId + " Remote Assessor";
        var token = TwilioVideoToken.Create(twilio, identity, room, DateTimeOffset.UtcNow);
        log.LogInformation("Assessor {UserId} joined the remote assessment room of {ZedId} {Certification}", UserId, zedId, level);
        return new JoinResponse(token, room, identity, Math.Clamp(twilio.TokenMinutes, 5, 240) * 60);
    }

    // ======================================================================== assessor actions

    public sealed record BasicInfoRequest(string? Column, string? Value);

    [HttpPost("basic-info")]
    public async Task<ActionResult<MessageResponse>> BasicInfo(string zedId, string certification, BasicInfoRequest req, CancellationToken ct)
    {
        var (level, record, error) = await ForAssessor(zedId, certification, ct);
        if (error is not null) return error;
        if (req.Column is null || !BasicInfoColumns.TryGetValue(req.Column, out var yesNo)) return this.Problem400("Invalid request.");
        var value = yesNo ? AssessmentInput.YesNo(req.Value) : AssessmentInput.Text(req.Value);
        if (value is null) return this.Problem400(yesNo ? "Please select Yes or No." : "Please enter a value.");
        if (value.Length > 2000) return this.Problem400("The value can be at most 2000 characters.");

        await db.ExecuteProcAsync("SP_ASSESSMENT_RA_UPDATE_BASIC_INFO", new
        {
            UserId, ZedId = zedId, CertificationType = level, ColumnName = req.Column,
            // The row id comes from the record, not from the browser.
            Id = record!.Id.ToString(CultureInfo.InvariantCulture), Response = value,
        }, ct);
        return new MessageResponse("Data Updated");
    }

    public sealed record ConformanceRequest(string? Conformance, string? Remarks);

    [HttpPost("requirements/{id:long}/conformance")]
    public async Task<ActionResult<MessageResponse>> Conformance(string zedId, string certification, long id, ConformanceRequest req, CancellationToken ct)
    {
        var (level, _, error) = await ForAssessor(zedId, certification, ct);
        if (error is not null) return error;
        var conformance = AssessmentInput.YesNo(req.Conformance);
        var remarks = AssessmentInput.Text(req.Remarks);
        if (conformance is null) return this.Problem400("Please select the conformance.");
        if (conformance == "No" && remarks is null) return this.Problem400("Please enter remarks.");
        if (remarks?.Length > 2000) return this.Problem400("Remarks must be at most 2000 characters.");
        // SP_ASSESSMENT_RA_UPDATE_REQUIREMENT updates by Id alone.
        if (await AssessmentRecords.ItemAsync(db, AssessmentRecords.RequirementSql, id, zedId, level!, ct) is null) return NotFound();

        await db.ExecuteProcAsync("SP_ASSESSMENT_RA_UPDATE_REQUIREMENT", new
        {
            Id = id.ToString(CultureInfo.InvariantCulture), ZedId = zedId, Conformance = conformance, CertificationType = level, AssessorRemark = remarks,
        }, ct);
        return new MessageResponse("Data Updated");
    }

    public sealed record ValidationRequest(string? IsVerified, string? Remarks);

    [HttpPost("products/{id:long}/validate")]
    public async Task<ActionResult<MessageResponse>> ValidateProduct(string zedId, string certification, long id, ValidationRequest req, CancellationToken ct)
    {
        var (level, _, error) = await ForAssessor(zedId, certification, ct);
        if (error is not null) return error;
        if (Validation(req, out var verified, out var remarks) is { } invalid) return this.Problem400(invalid);
        // SP_ASSESSMENT_RA_UPDATE_PRODUCT updates by Id alone.
        if (await AssessmentRecords.ItemAsync(db, AssessmentRecords.ProductSql, id, zedId, level!, ct) is null) return NotFound();

        await db.ExecuteProcAsync("SP_ASSESSMENT_RA_UPDATE_PRODUCT", new
        {
            Id = id.ToString(CultureInfo.InvariantCulture), ZedId = zedId, CertificationType = level, IsVerified = verified, AssessorRemarks = remarks,
        }, ct);
        return new MessageResponse("Data Updated");
    }

    [HttpPost("site-exterior/validate")]
    public async Task<ActionResult<MessageResponse>> ValidateSiteExterior(string zedId, string certification, ValidationRequest req, CancellationToken ct)
    {
        var (level, _, error) = await ForAssessor(zedId, certification, ct);
        if (error is not null) return error;
        if (Validation(req, out var verified, out var remarks) is { } invalid) return this.Problem400(invalid);
        await db.ExecuteProcAsync("SP_ASSESSMENT_RA_UPDATE_SITE_EXTERIOR", new
        {
            ZedId = zedId, CertificationType = level, IsSaVerified = verified, SaAssessorRemarks = remarks,
        }, ct);
        return new MessageResponse("Data Updated");
    }

    public sealed record CommentsRequest(string? Comments);

    /// <summary>OFI comments of a parameter (UpdateComments, TableName MsmeSections).</summary>
    [HttpPost("sections/{id:long}/ofi")]
    public async Task<ActionResult<MessageResponse>> OfiComments(string zedId, string certification, long id, CommentsRequest req, CancellationToken ct)
    {
        var (level, _, error) = await ForAssessor(zedId, certification, ct);
        if (error is not null) return error;
        if (Comments(req.Comments, out var comments) is { } invalid) return this.Problem400(invalid);
        if (await AssessmentRecords.ItemAsync(db, AssessmentRecords.SectionSql, id, zedId, level!, ct) is null) return NotFound();
        await db.ExecuteProcAsync("SP_ASSESSMENT_RA_UPDATE_COMMENTS", new
        {
            ZedId = zedId, Certification = level, Id = id.ToString(CultureInfo.InvariantCulture), Comments = comments, TableName = "MsmeSections",
        }, ct);
        return new MessageResponse("Data Updated");
    }

    /// <summary>Comments of the opening or closing meeting (UpdateComments, TableName Meetings).</summary>
    [HttpPost("meetings/{id:long}/comments")]
    public async Task<ActionResult<MessageResponse>> MeetingComments(string zedId, string certification, long id, CommentsRequest req, CancellationToken ct)
    {
        var (level, _, error) = await ForAssessor(zedId, certification, ct);
        if (error is not null) return error;
        if (Comments(req.Comments, out var comments) is { } invalid) return this.Problem400(invalid);
        if (await MeetingAsync(id, zedId, level!, ct) is null) return NotFound();
        await db.ExecuteProcAsync("SP_ASSESSMENT_RA_UPDATE_COMMENTS", new
        {
            ZedId = zedId, Certification = level, Id = id.ToString(CultureInfo.InvariantCulture), Comments = comments, TableName = "Meetings",
        }, ct);
        return new MessageResponse("Data Updated");
    }

    public sealed record ParticipantRequest(string? Name, string? Designation);

    [HttpPost("meetings/{id:long}/participants")]
    public async Task<ActionResult<MessageResponse>> AddParticipant(string zedId, string certification, long id, ParticipantRequest req, CancellationToken ct)
    {
        var (level, _, error) = await ForAssessor(zedId, certification, ct);
        if (error is not null) return error;
        var name = AssessmentInput.Text(req.Name);
        var designation = AssessmentInput.Text(req.Designation);
        if (name is null || designation is null) return this.Problem400("Please enter the participant's name and designation.");
        if (name.Length > 200 || designation.Length > 200) return this.Problem400("Name and designation can be at most 200 characters.");
        if (await MeetingAsync(id, zedId, level!, ct) is not { } meeting) return NotFound();

        await db.ExecuteProcAsync("SP_ASSESSMENT_RA_ADD_PARTICIPANT", new
        {
            ZedId = zedId, Certification = level, Name = name, Designation = designation, Type = meeting.MeetingType,
        }, ct);
        return new MessageResponse("Participant added.");
    }

    // ======================================================================== photos

    public sealed record PhotoRequest(string? Target, long? TargetId, string? Name, string? Image, long? FromPhotoId);
    public sealed record PhotosResponse(IReadOnlyList<RemotePhoto> Photos);

    private sealed record PhotoTarget(string TableName, string? Id, string? FixedName, string DefaultName, int Max, string? CountName);

    /// <summary>
    /// Saves a frame captured from the video (or, for a parameter, one of the site tour photos) against a
    /// part of the assessment, and returns that part's photos.
    /// </summary>
    [HttpPost("photos")]
    public async Task<ActionResult<PhotosResponse>> SavePhoto(string zedId, string certification, PhotoRequest req, CancellationToken ct)
    {
        var (level, record, error) = await ForAssessor(zedId, certification, ct);
        if (error is not null) return error;
        var (target, targetError) = await TargetAsync(req, zedId, level!, record!, ct);
        if (targetError is not null) return targetError;

        string? name;
        if (target!.FixedName is not null) name = target.FixedName;
        else
        {
            name = AssessmentInput.Text(req.Name) ?? target.DefaultName;
            if (name.Length > 50 || name.Any(char.IsControl)) return this.Problem400("The photo name can be at most 50 characters.");
        }

        var existing = await TargetPhotosAsync(target, zedId, level!, ct);
        if (existing.Count(p => target.CountName is null || p.Text("Name") == target.CountName) >= target.Max)
            return this.Problem400(target.Max == 1 ? "A photo has already been captured here. Remove it to capture another." : $"At most {target.Max} photos can be captured here.");

        string sitePath;
        string? savedFile = null;
        if (req.FromPhotoId is { } fromId)
        {
            // "From Site Tour": reuse a site tour photo of this unit (the old page sent its URL).
            if (target.TableName != "MsmeRequirements") return this.Problem400("Invalid request.");
            var tour = (await db.QueryProcMultipleAsync("SP_ASSESSMENT_RA_GET_UPDATED_PHOTOS", new
            {
                UserId, ZedId = zedId, CertificationType = level, TableName = "MsmeCertifications", Id = record!.Id.ToString(CultureInfo.InvariantCulture), Name = (string?)null,
            }, ct))[0].FirstOrDefault(p => p.Text("Id") == fromId.ToString(CultureInfo.InvariantCulture));
            if (tour is null || RemoteFiles.Relative(tour.Text("Photo"), zedId, level!) is not { } relative) return NotFound();
            sitePath = "/" + relative;
            name = AssessmentInput.Text(tour.Text("Name")) is { Length: <= 50 } tourName ? tourName : target.DefaultName;
        }
        else
        {
            var (bytes, extension, imageError) = RemoteFiles.DecodeImage(req.Image);
            if (imageError is not null) return this.Problem400(imageError);
            (savedFile, sitePath) = await RemoteFiles.SaveCaptureAsync(StorageRoot, zedId, level!, bytes!, extension!, ct);
        }

        try
        {
            await db.ExecuteProcAsync("SP_ASSESSMENT_RA_UPDATE_PHOTOS", new
            {
                UserId, ZedId = zedId, CertificationType = level, target.TableName, target.Id, Name = name, Url = sitePath,
            }, ct);
        }
        catch
        {
            if (savedFile is not null) TryDelete(savedFile);
            throw;
        }
        log.LogInformation("Assessor {UserId} saved a remote photo ({Table}) for {ZedId} {Certification}", UserId, target.TableName, zedId, level);
        var canAssess = CanAssess(record!);
        return new PhotosResponse((await TargetPhotosAsync(target, zedId, level!, ct))
            .Select(p => ToPhoto(p, zedId, level!, canAssess, p.Text("Photo"))).ToList());
    }

    /// <summary>Removes a photo the signed-in assessor captured on this screen (the old action deleted any SaPhotos id of the unit).</summary>
    [HttpDelete("photos/{id:long}")]
    public async Task<ActionResult<MessageResponse>> DeletePhoto(string zedId, string certification, long id, CancellationToken ct)
    {
        var (level, _, error) = await ForAssessor(zedId, certification, ct);
        if (error is not null) return error;
        var own = await db.QuerySqlAsync<IdRow>(
            "SELECT TOP 1 CAST(Id AS bigint) AS Id FROM SaPhotos WHERE Id = @Id AND ZedId = @ZedId AND Certification = @Certification AND AssessorId = @UserId",
            new { Id = id, ZedId = AssessmentInput.Ansi(zedId), Certification = AssessmentInput.Ansi(level), UserId = AssessmentInput.Ansi(UserId) }, ct);
        if (own.Count == 0) return NotFound();
        await db.ExecuteProcAsync("SP_ASSESSMENT_RA_DELETE_PHOTOS", new { ZedId = zedId, CertificationType = level, Id = id.ToString(CultureInfo.InvariantCulture) }, ct);
        log.LogInformation("Assessor {UserId} removed remote photo {Id} of {ZedId} {Certification}", UserId, id, zedId, level);
        return new MessageResponse("Photo removed.");
    }

    // ======================================================================== final submit

    public sealed record FinalSubmitCheck(bool Allowed, string? Message, bool RaisesNc);

    [HttpPost("final-submit/check")]
    public async Task<ActionResult<FinalSubmitCheck>> CheckFinalSubmit(string zedId, string certification, CancellationToken ct)
    {
        var (level, _, error) = await ForAssessor(zedId, certification, ct);
        if (error is not null) return error;
        return await Confirm(zedId, level!, ct);
    }

    public sealed record FinalSubmitRequest(string? Comments);

    [HttpPost("final-submit")]
    public async Task<ActionResult<MessageResponse>> FinalSubmit(string zedId, string certification, FinalSubmitRequest req, CancellationToken ct)
    {
        var (level, _, error) = await ForAssessor(zedId, certification, ct);
        if (error is not null) return error;
        var comments = AssessmentInput.Text(req.Comments);
        if (comments is null) return this.Problem400("Please enter comments.");
        if (comments.Length > 2000) return this.Problem400("Comments must be at most 2000 characters.");

        // The old FinalSubmit ran without these checks and took "NC raised" from the browser.
        var check = await Confirm(zedId, level!, ct);
        if (!check.Allowed) return this.Problem400(check.Message ?? "Please complete the assessment before final submit.");

        await db.ExecuteProcAsync("SP_ASSESSMENT_RA_FINAL_SUBMIT", new { ZedId = zedId, CertificationType = level, AssessorRemarks = comments }, ct);
        log.LogInformation("Assessor {UserId} final-submitted the remote assessment of {ZedId} {Certification} (NC raised: {Nc})", UserId, zedId, level, check.RaisesNc);
        if (check.RaisesNc)
            await DesktopAssessmentEmails.Create(HttpContext.RequestServices).SendAsync(DesktopAssessmentEmails.Kind.NcRaised, zedId, level!, comments, ct);
        return new MessageResponse("Assessment submitted.");
    }

    // ======================================================================== helpers

    /// <summary>Allotment columns of the MsmeCertifications row.</summary>
    public sealed class RemoteRecord
    {
        public long Id { get; init; }
        public string? ZedId { get; init; }
        public string? Certification { get; init; }
        public int? CertificationStatus { get; init; }
        public int? NcCount { get; init; }
        public string? SiteAssessorId { get; init; }
        public string? CoAssessorId { get; init; }
        public string? ModeOfAssessment { get; init; }
    }

    public const string RecordSql =
        "SELECT TOP 1 CAST(Id AS bigint) AS Id, ZedId, Certification, CertificationStatus, NcCount, SiteAssessorId, CoAssessorId, ModeOfAssessment " +
        "FROM MsmeCertifications WHERE ZedId = @ZedId AND Certification = @Certification";

    public const string MeetingSql =
        "SELECT TOP 1 CAST(Id AS bigint) AS Id, MeetingType FROM Meetings WHERE Id = @Id AND ZedId = @ZedId AND CertificationType = @Certification";

    private sealed class IdRow { public long Id { get; init; } }
    private sealed class MeetingRow { public long Id { get; init; } public string? MeetingType { get; init; } }

    private static string? Level(string? value) => Levels.FirstOrDefault(l => string.Equals(l, value?.Trim(), StringComparison.OrdinalIgnoreCase));

    private static bool Is(string? column, string userId) =>
        !string.IsNullOrWhiteSpace(column) && string.Equals(column.Trim(), userId, StringComparison.OrdinalIgnoreCase);

    private bool IsLead(RemoteRecord r) => Is(r.SiteAssessorId, UserId);

    /// <summary>The old page let the assessor in at status 9 (remote assessment in progress) or 13.</summary>
    public static bool IsOpen(RemoteRecord r) => r.CertificationStatus is 9 or 13;

    private bool CanAssess(RemoteRecord r) => IsLead(r) && IsOpen(r);

    /// <summary>404 unless the unit is allotted in remote mode with the caller as lead or co-assessor.</summary>
    private async Task<(string? Level, RemoteRecord? Record, ActionResult? Error)> ForViewer(string zedId, string certification, CancellationToken ct)
    {
        var level = Level(certification);
        if (!AssessmentInput.IsId(zedId) || level is null) return (null, null, this.Problem400("Invalid request."));
        var record = (await db.QuerySqlAsync<RemoteRecord>(RecordSql,
            new { ZedId = AssessmentInput.Ansi(zedId), Certification = AssessmentInput.Ansi(level) }, ct)).FirstOrDefault();
        if (record is null || !string.Equals(record.ModeOfAssessment?.Trim(), RemoteMode, StringComparison.OrdinalIgnoreCase) ||
            !(Is(record.SiteAssessorId, UserId) || Is(record.CoAssessorId, UserId)))
            return (level, null, NotFound());
        return (level, record, null);
    }

    /// <summary>As <see cref="ForViewer"/>, then 403 unless the caller is the lead assessor and the remote assessment is open.</summary>
    private async Task<(string? Level, RemoteRecord? Record, ActionResult? Error)> ForAssessor(string zedId, string certification, CancellationToken ct)
    {
        var (level, record, error) = await ForViewer(zedId, certification, ct);
        if (error is not null) return (level, record, error);
        if (!IsLead(record!)) return (level, record, Forbidden("Only the lead assessor can carry out the remote assessment."));
        if (!IsOpen(record!)) return (level, record, Forbidden("This remote assessment is not open."));
        return (level, record, null);
    }

    private ObjectResult Forbidden(string message) => Problem(title: message, statusCode: StatusCodes.Status403Forbidden);

    private async Task<MeetingRow?> MeetingAsync(long id, string zedId, string level, CancellationToken ct) =>
        (await db.QuerySqlAsync<MeetingRow>(MeetingSql,
            new { Id = id, ZedId = AssessmentInput.Ansi(zedId), Certification = AssessmentInput.Ansi(level) }, ct))
        .FirstOrDefault(m => m.MeetingType is "Open Meeting" or "Close Meeting");

    /// <summary>Maps the page's photo target to the procedure's TableName/Id/Name, after checking the id belongs to the unit.</summary>
    private async Task<(PhotoTarget? Target, ActionResult? Error)> TargetAsync(PhotoRequest req, string zedId, string level, RemoteRecord record, CancellationToken ct)
    {
        string Id(long v) => v.ToString(CultureInfo.InvariantCulture);
        switch (req.Target)
        {
            case "SiteExterior":
                return (new PhotoTarget("SiteExteriorPhotos", null, null, "Site Exterior Photo", 2, null), null);
            case "SiteTour":
                // The old page passed the certification row (TableName MsmeCertifications), which the procedure files as SiteTour.
                return (new PhotoTarget("MsmeCertifications", Id(record.Id), null, "Site Tour", 20, null), null);
            case "OpenMeeting" or "CloseMeeting":
                if (req.TargetId is not { } meetingId || await MeetingAsync(meetingId, zedId, level, ct) is not { } meeting ||
                    meeting.MeetingType != (req.Target == "OpenMeeting" ? "Open Meeting" : "Close Meeting"))
                    return (null, NotFound());
                // SP_ASSESSMENT_SA_DETAILS lists meeting photos by these exact names.
                var meetingName = req.Target == "OpenMeeting" ? "Opening Meeting Photo" : "Closing Meeting Photo";
                return (new PhotoTarget("Meetings", Id(meetingId), meetingName, meetingName, 1, null), null);
            case "ProductPhoto" or "ProductDescriptionPhoto":
                if (req.TargetId is not { } productId || await AssessmentRecords.ItemAsync(db, AssessmentRecords.ProductSql, productId, zedId, level, ct) is null)
                    return (null, NotFound());
                // The procedure picks the product column by these exact names.
                var productName = req.Target == "ProductPhoto" ? "Product Photo" : "Product Description Photo";
                return (new PhotoTarget("MsmeProducts", Id(productId), productName, productName, 1, productName), null);
            case "Requirement":
                if (req.TargetId is not { } requirementId || await AssessmentRecords.ItemAsync(db, AssessmentRecords.RequirementSql, requirementId, zedId, level, ct) is null)
                    return (null, NotFound());
                return (new PhotoTarget("MsmeRequirements", Id(requirementId), null, "Evidence Photo", 5, null), null);
            default:
                return (null, this.Problem400("Invalid request."));
        }
    }

    private async Task<IReadOnlyList<IDictionary<string, object?>>> TargetPhotosAsync(PhotoTarget target, string zedId, string level, CancellationToken ct) =>
        (await db.QueryProcMultipleAsync("SP_ASSESSMENT_RA_GET_UPDATED_PHOTOS", new
        {
            UserId, ZedId = zedId, CertificationType = level, target.TableName, target.Id, Name = target.CountName,
        }, ct))[0];

    private RemotePhoto ToPhoto(IDictionary<string, object?> p, string zedId, string level, bool canAssess, string? stored) =>
        new(long.TryParse(p.Text("Id"), out var id) ? id : 0,
            NullIfEmpty(p.Text("Name")),
            RemoteFiles.Url(zedId, level, stored),
            canAssess && Is(p.Text("AssessorId"), UserId));

    private async Task<FinalSubmitCheck> Confirm(string zedId, string level, CancellationToken ct)
    {
        var sets = await db.QueryProcMultipleAsync("SP_ASSESSMENT_RA_CONFIRM_FINAL_SUBMIT", new { ZedId = zedId, CertificationType = level }, ct);
        var row = sets[0].FirstOrDefault();
        var allowed = row is not null && row.Text("AllowFinalSubmit") == "1";
        var message = row?.Text("ErrorMessage") is { Length: > 0 } m ? m : null;
        // With NcCount >= 5 the procedure returns an extra "0" set before the real answer; the old action read the second set.
        return new FinalSubmitCheck(allowed, allowed ? null : message ?? "Please complete the assessment before final submit.",
            sets[1].FirstOrDefault()?.Text("RaisedForNc") == "1");
    }

    private static string? Validation(ValidationRequest req, out string? verified, out string? remarks)
    {
        verified = AssessmentInput.YesNo(req.IsVerified);
        remarks = AssessmentInput.Text(req.Remarks);
        if (verified is null) return "Please select Yes or No.";
        if (verified == "No" && remarks is null) return "Please enter remarks.";
        if (remarks?.Length > 1000) return "Remarks must be at most 1000 characters.";
        return null;
    }

    private static string? Comments(string? value, out string? comments)
    {
        comments = AssessmentInput.Text(value);
        if (comments is null) return "Please enter comments.";
        if (comments.Length > 2000) return "Comments must be at most 2000 characters.";
        return null;
    }

    private string StorageRoot => Path.GetFullPath(Path.Combine(env.ContentRootPath, portal.Value.StorageRoot));

    private void TryDelete(string path)
    {
        try { System.IO.File.Delete(path); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { log.LogWarning(ex, "Could not remove {Path}", path); }
    }

    private static string? NullIfEmpty(string? s) => string.IsNullOrWhiteSpace(s) ? null : s;

    private static object? Display(object? value) => value switch
    {
        null or DBNull => null,
        DateTime d => d.ToString("MMMM dd, yyyy hh:mm tt", CultureInfo.InvariantCulture),
        _ => value,
    };

    private static Dictionary<string, object?> Pick(IDictionary<string, object?> row, string[] fields) =>
        fields.ToDictionary(f => f, f => row.TryGetValue(f, out var v) ? Display(v) : null);

    private static List<Dictionary<string, object?>> Pick(IEnumerable<IDictionary<string, object?>> rows, string[] fields) =>
        rows.Select(r => Pick(r, fields)).ToList();
}
