using Dapper;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Mobile;
using Zed.Core.Security;
using Zed.Main.MobileApi.Models;
using Zed.Main.MobileApi.Templates;

namespace Zed.Main.MobileApi.Controllers;

/// <summary>
/// The self-assessment part of the app: questionnaire, basic information, ESG checklist, evidence
/// uploads, photos, final submit and the facilitator selfie.
/// </summary>
public sealed partial class MsmeController
{
    [HttpPost]
    [DeviceBound(MobileApps.Msme, "userName")]
    public async Task<IActionResult> GetParametersByType(string? userName, string? certificationType, string? version, CancellationToken ct)
    {
        if (VersionCheck(version) is { } update) return update;
        var sets = await db.QueryProcMultipleAsync("SP_APP_MSME_GET_QUESTIONS_BY_TYPE", new { ZedId = userName, CertificationType = certificationType }, ct);
        return LegacyJson(new ParametersResponse
        {
            status = "1",
            parameters = BuildParameters(sets, 0, withEvidences: true, withAssessorRemarks: false),
        });
    }

    /// <summary>
    /// SP_APP_MSME_INSERT_BASIC_INFO, which also creates the unit's MsmeCertifications row. Only
    /// while the level is paid and not yet final-submitted (status 1): the procedure deletes and
    /// re-inserts products and photos, which must not happen while the assessor reviews them.
    /// </summary>
    [HttpPost]
    [DeviceBound(MobileApps.Msme, "userName")]
    [MsmeEditAudit("App: basic information submitted")]
    public async Task<IActionResult> SubmitBasicInformation(BasicInformationRequest request, CancellationToken ct)
    {
        var info = request.basicInformation;
        if (info is null) return Fail(NoDataFound);

        var zedId = request.userName ?? "";
        var stage = await StageAsync(zedId, request.certificationType, ct);
        if (stage is not { BeforeFinalSubmit: true }) return StageRefused(nameof(SubmitBasicInformation), zedId, request.certificationType, stage);
        var cert = CertificationSegment(request.certificationType);

        var uploads = new Uploads(Storage);
        var productPhotos = PhotoTable();
        var descriptionPhotos = PhotoTable();
        var sitePhotos = PhotoTable();
        var selfie = PhotoTable();
        var products = Table("ProductName", "Exported", "ProductPhoto", "ProductDescriptionPhoto");
        var rawMaterials = Table("Name", "Percentage", "CountryName");

        if (info.assessorSelfie is not null) CollectPhotos(uploads, [info.assessorSelfie], zedId, cert, "Selfie", selfie);
        CollectPhotos(uploads, info.siteExteriorPhotos, zedId, cert, "SiteExteriorPhotos", sitePhotos);

        foreach (var p in info.productDetailsList ?? [])
        {
            if (p is null) continue;
            // Product photo files arrive separately (SubmitPhotos); only their rows are recorded here.
            if (p.productPhoto is { } pp)
                AddPhotoRow(productPhotos, pp.photoId, pp.name, pp.timeStamp, pp.latitude, pp.longitude, pp.isPdf ? "pdf" : "jpg");
            else p.productPhoto = new PhotoInformation();
            if (p.productDescriptionPhoto is { } dp)
                AddPhotoRow(descriptionPhotos, dp.photoId, dp.name, dp.timeStamp, dp.latitude, dp.longitude, dp.isPdf ? "pdf" : "jpg");
            else p.productDescriptionPhoto = new PhotoInformation();

            products.Rows.Add(p.productName, p.exported,
                p.productPhoto.photoId + (p.productPhoto.isPdf ? ".pdf" : ".jpg"),
                p.productDescriptionPhoto.photoId + (p.productDescriptionPhoto.isPdf ? ".pdf" : ".jpg"));
        }
        foreach (var m in info.rawMaterialsList ?? [])
            if (m is not null) rawMaterials.Rows.Add(m.rawMaterialName, m.rawMaterialPercentage, m.countryName);

        await uploads.SaveAsync(ct);

        var args = new DynamicParameters();
        args.Add("RefId", NewRefId());
        args.Add("ZedId", zedId);
        args.Add("CertificationType", cert);
        args.Add("AuditsConducted", info.auditsConducted);
        args.Add("DomesticCustomers", info.domesticCustomers);
        args.Add("InternationalCustomers", info.internationalCustomers);
        args.Add("RawMaterialImported", info.rawMaterialImported);
        args.Add("OutsourcedProcesses", info.outsourcedProcesses);
        args.Add("EnergySources", string.Join(",", info.energySources ?? []));
        args.Add("ManufacturingCapacityUnits", info.monthlyManufacturingCapacityUnits);
        args.Add("ManufacturingCapacityValue", info.monthlyManufacturingCapacityValue);
        args.Add("MonthlyUtilizationUnits", info.monthlyUtilizationUnits);
        args.Add("MonthlyUtilizationValue", info.monthlyUtilizationValue);
        AddTable(args, "ProductPhotos", productPhotos, "DynamicPhotoList2");
        AddTable(args, "ProductDescriptionPhotos", descriptionPhotos, "DynamicPhotoList2");
        AddTable(args, "SiteExteriorPhotos", sitePhotos, "DynamicPhotoList2");
        AddTable(args, "Selfie", selfie, "DynamicPhotoList2");
        AddTable(args, "ProductList", products, "ProductDetails2");
        AddTable(args, "RawMaterialList", rawMaterials, "RawMaterial");

        var error = await TryExecuteAsync("SP_APP_MSME_INSERT_BASIC_INFO", args, ct);
        return LegacyJson(error is null ? new ServiceResponse { status = "1" } : ServiceResponse.Fail(error));
    }

    /// <summary>SP_APP_MSME_INSERT_ESG_CHECKLIST; the procedure itself refuses a level the unit has no row for ("Invalid Details.").</summary>
    [HttpPost]
    [DeviceBound(MobileApps.Msme, "userName")]
    [MsmeEditAudit("App: ESG checklist submitted")]
    public async Task<IActionResult> SubmitEsgChecklist(EsgChecklistRequest request, CancellationToken ct)
    {
        if (request.esgChecklist is null || request.socialOhsChecklist is null) return Fail(NoDataFound);

        static System.Data.DataTable Checklist(IEnumerable<EsgChecklist?> items)
        {
            var t = Table("Code", "Question", "Answer", "ifYesQuestion", "ifYesAnswer", "ifNoQuestion", "ifNoAnswer");
            foreach (var c in items)
                if (c is not null)
                    t.Rows.Add(c.code.ToString(System.Globalization.CultureInfo.InvariantCulture), c.question, c.answer,
                        c.ifYesQuestion ?? "", c.ifYesAnswer ?? "", c.ifNoQuestion ?? "", c.ifNoAnswer ?? "");
            return t;
        }

        var args = new DynamicParameters();
        args.Add("RefId", NewRefId());
        args.Add("ZedId", request.userName);
        args.Add("CertificationType", request.certificationType);
        AddTable(args, "EsgChecklist", Checklist(request.esgChecklist), "DynamicEsgCheckList");
        AddTable(args, "SocialOhsChecklist", Checklist(request.socialOhsChecklist), "DynamicEsgCheckList");

        ResultSets sets;
        try
        {
            sets = await db.QueryProcMultipleAsync("SP_APP_MSME_INSERT_ESG_CHECKLIST", args, ct);
        }
        catch (System.Data.Common.DbException ex)
        {
            log.LogWarning(ex, "SP_APP_MSME_INSERT_ESG_CHECKLIST failed for {ZedId}", request.userName);
            return Fail(GenericError);
        }
        var row = sets.FirstRow(0);
        if (row.Count == 0) return Fail(GenericError);
        return LegacyJson(new ServiceResponse { status = row.Text("Status"), errorMessage = row.Text("ErrorMessage") });
    }

    /// <summary>The ESG checklist form the app renders (old App_Data/EnvironmentalChecklist.json), any verb as before.</summary>
    [AcceptVerbs("GET", "POST")]
    public async Task<IActionResult> GetEsgChecklist(CancellationToken ct)
    {
        var path = Path.Combine(Storage.Root, "App_Data", "EnvironmentalChecklist.json");
        var json = System.IO.File.Exists(path) ? await System.IO.File.ReadAllTextAsync(path, ct) : EsgChecklistJson.Text;
        return LegacyContent(json, "application/json");
    }

    /// <summary>
    /// Old base64-only evidence upload (still routable, so kept): saves the photos and the
    /// evidence PDF ({evidenceId}.pdf, the first photo if it is a PDF, otherwise all photos).
    /// </summary>
    [HttpPost]
    [DeviceBound(MobileApps.Msme, "userName")]
    [MsmeEditAudit("App: evidence marked not used")]
    public async Task<IActionResult> SubmitEvidenceNotUsed(EvidenceRequest request, CancellationToken ct)
    {
        var zedId = request.userName ?? "";
        var stage = await StageAsync(zedId, request.certificationType, ct);
        if (stage is not ({ BeforeFinalSubmit: true } or { NcOpen: true }))
            return StageRefused(nameof(SubmitEvidenceNotUsed), zedId, request.certificationType, stage);
        var cert = CertificationSegment(request.certificationType);
        var photos = request.photos?.Where(p => p is not null).ToList() ?? [];
        if (photos.Count == 0) return Fail(NoPhotosFound);

        var uploads = new Uploads(Storage);
        var table = PhotoTable();
        CollectPhotos(uploads, photos, zedId, cert, "Evidences", table);
        var pdfName = MobileStorage.FileName((request.evidenceId ?? "").Replace(".", "_"), ".pdf");
        string[] folderSegments = ["Photos", zedId, cert, "Evidences"];
        if (photos[0].isPdf && !string.IsNullOrEmpty(photos[0].photo))
            uploads.AddBase64(photos[0].photo!, pdfName, folderSegments);
        await uploads.SaveAsync(ct);

        if (!photos[0].isPdf)
        {
            List<byte[]> images;
            try
            {
                images = photos.Select(p => Convert.FromBase64String(p.photo ?? "")).ToList();
            }
            catch (FormatException)
            {
                return Fail(InvalidData);
            }
            if (!await WritePdfAsync(Storage.Folder(folderSegments), images, pdfName, ct)) return Fail(InvalidData);
        }

        return await SaveEvidenceAsync(request, table, ct);
    }

    /// <summary>
    /// Evidence upload, one photo per call (photo = PhotoInformation JSON, file in file_data or as
    /// base64). A PDF becomes the evidence PDF directly; on the last image the evidence PDF is
    /// rebuilt from all images of the evidence (SP_APP_MSME_GET_EVIDENCE_PHOTOS).
    /// </summary>
    [HttpPost]
    [DeviceBound(MobileApps.Msme, "userName")]
    public async Task<IActionResult> SubmitEvidenceV2(EvidenceRequest request, IFormFile? file_data, CancellationToken ct)
    {
        var zedId = request.userName ?? "";
        var stage = await StageAsync(zedId, request.certificationType, ct);
        if (stage is not ({ BeforeFinalSubmit: true } or { NcOpen: true }))
            return StageRefused(nameof(SubmitEvidenceV2), zedId, request.certificationType, stage);
        var cert = CertificationSegment(request.certificationType);
        request.photoObj = ParseEmbedded<PhotoInformation>(request.photo);
        if (request.photoObj is null) return Fail(InvalidData);

        var photos = request.photos?.Where(p => p is not null).ToList() ?? [];
        photos.Add(request.photoObj);

        var uploads = new Uploads(Storage);
        var table = PhotoTable();
        var stored = CollectPhotos(uploads, photos, zedId, cert, "Evidences", table, file_data);
        var pdfName = MobileStorage.FileName((request.evidenceId ?? "").Replace(".", "_"), ".pdf");
        string[] folderSegments = ["Photos", zedId, cert, "Evidences"];
        if (request.photoObj.isPdf)
        {
            if (file_data is { Length: > 0 })
            {
                MobileStorage.Extension(file_data.FileName, MobileStorage.DocumentExtensions);
                uploads.AddFile(file_data, pdfName, folderSegments);
            }
            else if (!string.IsNullOrEmpty(request.photoObj.photo))
                uploads.AddBase64(request.photoObj.photo, pdfName, folderSegments);
        }
        await uploads.SaveAsync(ct);

        if (!request.photoObj.isPdf && request.isLast)
        {
            var names = new List<string>();
            if (!request.isFirst)
            {
                var earlier = await db.QueryProcMultipleAsync("SP_APP_MSME_GET_EVIDENCE_PHOTOS",
                    new { EvidenceId = request.evidenceId, ZedId = zedId, CertificationType = cert }, ct);
                names.AddRange(earlier[0].Select(r => r.Text("PhotoPath")));
            }
            names.Add(stored[^1]);
            if (!await WriteEvidencePdfAsync(Storage.Folder(folderSegments), names, pdfName, ct)) return Fail(EvidenceNotSynced);
        }

        return await SaveEvidenceAsync(request, table, ct);
    }

    private async Task<IActionResult> SaveEvidenceAsync(EvidenceRequest request, System.Data.DataTable photos, CancellationToken ct)
    {
        var args = new DynamicParameters();
        args.Add("EvidenceId", request.evidenceId);
        args.Add("ZedId", request.userName);
        args.Add("IsFirst", request.isFirst);
        args.Add("IsLast", request.isLast);
        args.Add("RefId", NewRefId());
        args.Add("CertificationType", request.certificationType);
        AddTable(args, "PhotoList", photos, "DynamicPhotoList2");
        var error = await TryExecuteAsync("SP_APP_MSME_INSERT_EVIDENCE", args, ct);
        return LegacyJson(error is null ? new ServiceResponse { status = "1" } : ServiceResponse.Fail(error));
    }

    /// <summary>
    /// Product and other basic-information photos (Photos/{userName}/{cert}/BasicInfo). Files only,
    /// no database call, as before. Allowed before final submit and while an NC is open.
    /// </summary>
    [HttpPost]
    [DeviceBound(MobileApps.Msme, "userName")]
    [MsmeEditAudit("App: photos submitted")]
    public async Task<IActionResult> SubmitPhotos(SubmitPhotosRequestFile request, List<IFormFile>? files, CancellationToken ct)
    {
        if (request.photos is null && files is not { Count: > 0 }) return Fail(NoPhotosFound);
        var zedId = request.userName ?? "";
        var stage = await StageAsync(zedId, request.certificationType, ct);
        if (stage is not ({ BeforeFinalSubmit: true } or { NcOpen: true }))
            return StageRefused(nameof(SubmitPhotos), zedId, request.certificationType, stage);
        var cert = CertificationSegment(request.certificationType);

        var uploads = new Uploads(Storage);
        CollectPhotoFiles(uploads, request.photos, files, "Photos", zedId, cert, "BasicInfo");
        await uploads.SaveAsync(ct);
        return LegacyJson(new ServiceResponse { status = "1" });
    }

    /// <summary>
    /// The photos of SubmitPhotos / SubmitFinancialPhotos: base64 as {photoId}.jpg/.pdf, a photo's
    /// file_data as {photoId}{extension}, and the files list under their own (plain) names.
    /// </summary>
    private static void CollectPhotoFiles(Uploads uploads, List<PhotoInformationFile>? photos, List<IFormFile>? files, params string[] folder)
    {
        foreach (var photo in photos ?? [])
        {
            if (photo is null) continue;
            if (!string.IsNullOrEmpty(photo.photo))
                uploads.AddBase64(photo.photo, MobileStorage.FileName(photo.photoId, photo.isPdf ? ".pdf" : ".jpg"), folder);
            else if (photo.file_data is { Length: > 0 } f)
                uploads.AddFile(f, MobileStorage.FileName(photo.photoId, MobileStorage.Extension(f.FileName, MobileStorage.DocumentExtensions)), folder);
        }
        foreach (var f in files ?? [])
            if (f is { Length: > 0 }) uploads.AddFile(f, MobileStorage.UploadedName(f, MobileStorage.DocumentExtensions), folder);
    }

    /// <summary>
    /// Left over from the Ganga town app: saved Videos/{ulbCode}/{ghatId}/{videoId}.mp4 and called
    /// SP_INSERT_GANGA_TOWN_VIDEO_DETAILS, which does not exist in any ZED database, so it always
    /// failed after writing the file. It now answers with the old failure shape without storing anything.
    /// </summary>
    [HttpPost]
    [DeviceBound(MobileApps.Msme, "username")]
    public IActionResult SubmitVideo(IFormFile? video_data, VideoSubmitRequest request)
    {
        if (request.videoId is null) return Fail("No video found.");
        if (string.IsNullOrEmpty(request.ulbCode)) return Fail(InvalidData);
        log.LogWarning("Msme/SubmitVideo called by {User}; SP_INSERT_GANGA_TOWN_VIDEO_DETAILS does not exist, nothing stored", request.username);
        return Fail(GenericError);
    }

    /// <summary>
    /// SP_APP_CHECK_DATA_SYNC_FINAL_SUBMIT (the procedure's own stage check), the photo check of
    /// SP_ASSESSMENT_CHECK_NC_PHOTO_AVAILABILITY, SP_APP_MSME_FINAL_SUBMIT and a confirmation mail.
    /// </summary>
    [HttpPost]
    [DeviceBound(MobileApps.Msme, "userName")]
    [MsmeEditAudit("App: final submit")]
    public async Task<IActionResult> FinalSubmit(BaseServiceRequest request, CancellationToken ct)
    {
        var args = new { CertificationType = request.certificationType, ZedId = request.userName };

        var allow = (await db.QueryProcMultipleAsync("SP_APP_CHECK_DATA_SYNC_FINAL_SUBMIT", args, ct)).FirstRow(0);
        if (allow.Count == 0) return Fail(InvalidDetails);
        if (allow.Text("AllowFinalSubmit") == "0") return Fail(allow.Text("ErrorMessage"));

        var photos = await db.QueryProcMultipleAsync("SP_ASSESSMENT_CHECK_NC_PHOTO_AVAILABILITY", args, ct);
        // Only the first non-empty list is checked, as before.
        foreach (var (index, message) in new[] { (0, "Site Exterior Photos not synced."), (1, "Product Photos not synced."), (2, "Evidence Photos not synced.") })
        {
            if (photos[index].Count == 0) continue;
            if (photos[index].Any(r => !LegacyPhotoExists(r.Values.FirstOrDefault()?.ToString())))
                return Fail(message);
            break;
        }

        var error = await TryExecuteAsync("SP_APP_MSME_FINAL_SUBMIT", args, ct);
        if (error is not null) return Fail(error);
        log.LogInformation("App final submit for {ZedId} {Certification}", request.userName, request.certificationType);

        await SendSubmissionMailAsync(request.userName ?? "", request.certificationType ?? "", ct);
        return LegacyJson(new ServiceResponse { status = "1" });
    }

    /// <summary>
    /// SP_ASSESSMENT_CHECK_NC_PHOTO_AVAILABILITY returns the old server's absolute paths
    /// (E:\Publish\...\Photos/{ZedId}/...). The part from "Photos/" on is looked up under the storage
    /// root; anything that does not map to a plain path there counts as missing.
    /// </summary>
    private bool LegacyPhotoExists(string? legacyPath)
    {
        if (string.IsNullOrWhiteSpace(legacyPath)) return false;
        var normalized = legacyPath.Replace('\\', '/');
        var at = normalized.StartsWith("Photos/", StringComparison.OrdinalIgnoreCase) ? 0
            : normalized.IndexOf("/Photos/", StringComparison.OrdinalIgnoreCase) is var i and >= 0 ? i + 1 : -1;
        if (at < 0) return false;
        try
        {
            var segments = normalized[at..].Split('/', StringSplitOptions.RemoveEmptyEntries).Select(MobileStorage.Segment).ToArray();
            var full = Path.GetFullPath(Path.Combine([Storage.Root, .. segments]));
            var root = Storage.Root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            return full.StartsWith(root, StringComparison.OrdinalIgnoreCase) && System.IO.File.Exists(full);
        }
        catch (UnsafePathException)
        {
            return false;
        }
    }

    private async Task SendSubmissionMailAsync(string zedId, string certification, CancellationToken ct)
    {
        IDictionary<string, object?> row;
        try
        {
            row = (await db.QueryProcMultipleAsync("SP_EMAIL_GET_DETAILS", new { ZedId = zedId, Certification = certification }, ct)).FirstRow(0);
        }
        catch (System.Data.Common.DbException ex)
        {
            log.LogWarning(ex, "No mail details for {ZedId} {Certification}", zedId, certification);
            return;
        }
        if (row.Count == 0) return;
        // Only these columns are read: the procedure also returns assessor and MSME passwords.
        var ncCount = row.Int("NcCount");
        var parameters = new Dictionary<string, object?>
        {
            [nameof(MsmeSubmissionEmail.EnterpriseName)] = row.Text("EnterpriseName"),
            [nameof(MsmeSubmissionEmail.ZedId)] = zedId,
            [nameof(MsmeSubmissionEmail.Certification)] = certification,
            [nameof(MsmeSubmissionEmail.NcCount)] = ncCount,
        };
        if (row.Text("NcCount") is "0" or "")
            await SendMailAsync<MsmeSubmissionEmail>(row.Text("EmailId"), "ZED Basic information and Document Upload Confirmation – " + zedId, parameters, null, ct, copyOffice: true);
        else
            await SendMailAsync<MsmeSubmissionEmail>(row.Text("EmailId"),
                "Submission of response to Non-conformance(s) raised under “MSME Sustainable (ZED) Certification” Scheme  - " + zedId,
                parameters, [row.Text("AssessorEmailId"), row.Text("AgencyEmailId")], ct, copyOffice: true);
    }

    /// <summary>
    /// SP_INSERT_FACILITATOR_DETAILS with the facilitator's selfie (FacilitatorSelfies/{userName}/{cert}/{photoId}.jpg).
    /// Only for a level the unit has paid for.
    /// </summary>
    [HttpPost]
    [DeviceBound(MobileApps.Msme, "userName")]
    [MsmeEditAudit("App: facilitator details submitted")]
    public async Task<IActionResult> SubmitFacilitatorDetails(FacilitatorDetails request, IFormFile? files, CancellationToken ct)
    {
        var zedId = request.userName ?? "";
        var stage = await StageAsync(zedId, request.certificationType, ct);
        if (stage is not { Paid: true }) return StageRefused(nameof(SubmitFacilitatorDetails), zedId, request.certificationType, stage);

        if (files is not { Length: > 0 })
            request.selfieMetadataObj = new PhotoInformation();
        else
        {
            var cert = CertificationSegment(request.certificationType);
            request.selfieMetadataObj = ParseEmbedded<PhotoInformation>(request.selfieMetadata);
            if (request.selfieMetadataObj is null) return Fail(InvalidData);
            var uploads = new Uploads(Storage);
            uploads.AddFile(files, MobileStorage.FileName(request.selfieMetadataObj.photoId, MobileStorage.Extension(files.FileName, MobileStorage.ImageExtensions)),
                "FacilitatorSelfies", zedId, cert);
            await uploads.SaveAsync(ct);
        }

        var selfie = request.selfieMetadataObj;
        ResultSets sets;
        try
        {
            sets = await db.QueryProcMultipleAsync("SP_INSERT_FACILITATOR_DETAILS", new
            {
                ZedId = zedId,
                Certification = request.certificationType,
                EmailId = request.email,
                MobileNo = request.phoneNumber,
                PhotoId = selfie.photoId,
                Latitude = selfie.latitude,
                Longitude = selfie.longitude,
                TimeStamp = selfie.timeStamp,
                ReferenceId = NewRefId(),
            }, ct);
        }
        catch (System.Data.Common.DbException ex)
        {
            log.LogWarning(ex, "SP_INSERT_FACILITATOR_DETAILS failed for {ZedId}", zedId);
            return Fail(GenericError);
        }
        var row = sets.FirstRow(0);
        if (row.Count == 0) return Fail(GenericError);
        return LegacyJson(new ServiceResponse { status = row.Text("Status"), errorMessage = row.Text("Message") });
    }
}
