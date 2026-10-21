using Dapper;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Mobile;
using Zed.Main.MobileApi.Models;
using Zed.Main.MobileApi.Templates;

namespace Zed.Main.MobileApi.Controllers;

/// <summary>
/// What the desktop assessor enters for the unit: questionnaire, basic information, ESG checklist, evidences,
/// photos, "financial assistance availed" and the final submit. The unit is the request's userName (the old
/// code used it as the ZED ID everywhere).
/// </summary>
public sealed partial class SurveillanceController
{
    [HttpPost]
    public async Task<IActionResult> GetParametersByType(string? zedId, string? userName, string? certificationType, string? version, CancellationToken ct)
    {
        if (VersionCheck(version) is { } update) return update;
        if (!string.IsNullOrEmpty(userName)) zedId = userName;
        var (_, refused) = await UnitAsync(nameof(GetParametersByType), zedId, certificationType, Need.Read, ct);
        if (refused is not null) return refused;

        var sets = await db.QueryProcMultipleAsync("SP_APP_SURVEILLANCE_GET_QUESTIONS_BY_TYPE",
            new { ZedId = zedId, CertificationType = certificationType }, ct);
        return LegacyJson(new ParametersResponse
        {
            status = "1",
            parameters = BuildParameters(sets, 0, withEvidences: true, withAssessorRemarks: false),
        });
    }

    /// <summary>SP_APP_SURVEILLANCE_INSERT_BASIC_INFO (deletes and re-inserts products and photos): only before final submit.</summary>
    [HttpPost]
    public async Task<IActionResult> SubmitBasicInformation(BasicInformationRequest request, CancellationToken ct)
    {
        var info = request.basicInformation;
        if (info is null) return Fail(NoDataFound);

        var zedId = request.userName?.Trim() ?? "";
        var (_, refused) = await UnitAsync(nameof(SubmitBasicInformation), zedId, request.certificationType, Need.BeforeFinalSubmit, ct);
        if (refused is not null) return refused;
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
        return Answer(await TryExecuteAsync("SP_APP_SURVEILLANCE_INSERT_BASIC_INFO", args, ct));
    }

    /// <summary>SP_APP_SURVEILLANCE_INSERT_ESG_CHECKLIST (answers Status / ErrorMessage itself): only before final submit.</summary>
    [HttpPost]
    public async Task<IActionResult> SubmitEsgChecklist(EsgChecklistRequest request, CancellationToken ct)
    {
        if (request.esgChecklist is null || request.socialOhsChecklist is null) return Fail(NoDataFound);
        var (_, refused) = await UnitAsync(nameof(SubmitEsgChecklist), request.userName, request.certificationType, Need.BeforeFinalSubmit, ct);
        if (refused is not null) return refused;

        static System.Data.DataTable Checklist(IEnumerable<EsgChecklist?> items)
        {
            var t = Table("Code", "Question", "Answer", "ifYesQuestion", "ifYesAnswer", "ifNoQuestion", "ifNoAnswer");
            foreach (var c in items)
                if (c is not null)
                    t.Rows.Add(c.code.ToString(System.Globalization.CultureInfo.InvariantCulture), c.question, c.answer,
                        c.ifYesQuestion, c.ifYesAnswer, c.ifNoQuestion, c.ifNoAnswer);
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
            sets = await db.QueryProcMultipleAsync("SP_APP_SURVEILLANCE_INSERT_ESG_CHECKLIST", args, ct);
        }
        catch (System.Data.Common.DbException ex)
        {
            log.LogWarning(ex, "SP_APP_SURVEILLANCE_INSERT_ESG_CHECKLIST failed for {ZedId}", request.userName);
            return Fail(GenericError);
        }
        var row = sets.FirstRow(0);
        if (row.Count == 0) return Fail(GenericError);
        return LegacyJson(new ServiceResponse { status = row.Text("Status"), errorMessage = row.Text("ErrorMessage") });
    }

    /// <summary>The ESG checklist form (old App_Data/EnvironmentalChecklist.json, not in the surveillance source), any verb as before.</summary>
    [AcceptVerbs("GET", "POST")]
    public async Task<IActionResult> GetEsgChecklist(CancellationToken ct)
    {
        var path = Path.Combine(Storage.Root, "App_Data", "EnvironmentalChecklist.json");
        var json = System.IO.File.Exists(path) ? await System.IO.File.ReadAllTextAsync(path, ct) : EsgChecklistJson.Text;
        return LegacyContent(json, "application/json");
    }

    /// <summary>Old base64-only evidence upload (still routable): the photos and the evidence PDF ({evidenceId}.pdf).</summary>
    [HttpPost]
    public async Task<IActionResult> SubmitEvidenceNotUsed(EvidenceRequest request, CancellationToken ct)
    {
        var zedId = request.userName?.Trim() ?? "";
        var (_, refused) = await UnitAsync(nameof(SubmitEvidenceNotUsed), zedId, request.certificationType, Need.BeforeFinalSubmitOrNcOpen, ct);
        if (refused is not null) return refused;
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
        return await SaveEvidenceAsync(request, zedId, table, ct);
    }

    /// <summary>
    /// Evidence upload, one photo per call (photo = PhotoInformation JSON, file in file_data or as base64). A PDF
    /// becomes the evidence PDF; on the last image the PDF is rebuilt from all images (SP_APP_MSME_GET_EVIDENCE_PHOTOS).
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> SubmitEvidenceV2(EvidenceRequest request, IFormFile? file_data, CancellationToken ct)
    {
        var zedId = request.userName?.Trim() ?? "";
        var (_, refused) = await UnitAsync(nameof(SubmitEvidenceV2), zedId, request.certificationType, Need.BeforeFinalSubmitOrNcOpen, ct);
        if (refused is not null) return refused;
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
                if (earlier.Count > 0) names.AddRange(earlier[0].Select(r => r.Text("PhotoPath")));
            }
            names.Add(stored[^1]);
            if (!await WriteEvidencePdfAsync(Storage.Folder(folderSegments), names, pdfName, ct)) return Fail(EvidenceNotSynced);
        }
        return await SaveEvidenceAsync(request, zedId, table, ct);
    }

    private async Task<IActionResult> SaveEvidenceAsync(EvidenceRequest request, string zedId, System.Data.DataTable photos, CancellationToken ct)
    {
        var args = new DynamicParameters();
        args.Add("EvidenceId", request.evidenceId);
        args.Add("ZedId", zedId);
        args.Add("IsFirst", request.isFirst);
        args.Add("IsLast", request.isLast);
        args.Add("RefId", NewRefId());
        args.Add("CertificationType", request.certificationType);
        AddTable(args, "PhotoList", photos, "DynamicPhotoList2");
        return Answer(await TryExecuteAsync("SP_APP_MSME_INSERT_EVIDENCE", args, ct));
    }

    /// <summary>Product and other basic-information photos (Photos/{userName}/{cert}/BasicInfo). Files only, no database call, as before.</summary>
    [HttpPost]
    public async Task<IActionResult> SubmitPhotos(SubmitPhotosRequestFile request, List<IFormFile>? files, CancellationToken ct)
    {
        if (request.photos is null && files is not { Count: > 0 }) return Fail(NoPhotosFound);
        var zedId = request.userName?.Trim() ?? "";
        var (_, refused) = await UnitAsync(nameof(SubmitPhotos), zedId, request.certificationType, Need.BeforeFinalSubmitOrNcOpen, ct);
        if (refused is not null) return refused;
        var cert = CertificationSegment(request.certificationType);

        var uploads = new Uploads(Storage);
        CollectPhotoFiles(uploads, request.photos, files, "Photos", zedId, cert, "BasicInfo");
        await uploads.SaveAsync(ct);
        return LegacyJson(new ServiceResponse { status = "1" });
    }

    /// <summary>
    /// Left over from the Ganga town app (SP_INSERT_GANGA_TOWN_VIDEO_DETAILS exists in no ZED database, so it always
    /// failed after writing the file). Answers the old failure shape without storing anything, as on Main.
    /// </summary>
    [HttpPost]
    public IActionResult SubmitVideo(IFormFile? video_data, VideoSubmitRequest request)
    {
        if (request.videoId is null) return Fail("No video found.");
        if (string.IsNullOrEmpty(request.ulbCode)) return Fail(InvalidData);
        log.LogWarning("Surveillance/SubmitVideo called by {User}; nothing stored", request.username);
        return Fail(GenericError);
    }

    /// <summary>
    /// SP_APP_CHECK_DATA_SYNC_FINAL_SUBMIT (here AllowFinalSubmit = 1 means "refused", with the reason), the photo
    /// check of SP_ASSESSMENT_CHECK_NC_PHOTO_AVAILABILITY, SP_APP_MSME_FINAL_SUBMIT with the two surveillance answers,
    /// and the confirmation mail. Accepted before the first final submit, or while the current NC is open (the
    /// procedure turns the call into the NC reply then; its own check lets any unit with an NC through).
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> FinalSubmit(SurveillanceFinalSubmitRequest request, CancellationToken ct)
    {
        var (_, refused) = await UnitAsync(nameof(FinalSubmit), request.userName, request.certificationType, Need.BeforeFinalSubmitOrNcOpen, ct);
        if (refused is not null) return refused;

        var check = new { CertificationType = request.certificationType, ZedId = request.userName };
        var allow = (await db.QueryProcMultipleAsync("SP_APP_CHECK_DATA_SYNC_FINAL_SUBMIT", check, ct)).FirstRow(0);
        if (allow.Count == 0) return Fail(InvalidDetails);
        if (allow.Bool("AllowFinalSubmit")) return Fail(allow.Text("ErrorMessage"));

        var photos = await db.QueryProcMultipleAsync("SP_ASSESSMENT_CHECK_NC_PHOTO_AVAILABILITY", check, ct);
        // Only the first non-empty list is checked, as before.
        foreach (var (index, message) in new[] { (0, "Site Exterior Photos not synced."), (1, "Product Photos not synced."), (2, "Evidence Photos not synced.") })
        {
            if (index >= photos.Count || photos[index].Count == 0) continue;
            if (photos[index].Any(r => !LegacyPhotoExists(r.Values.FirstOrDefault()?.ToString())))
                return Fail(message);
            break;
        }

        var error = await TryExecuteAsync("SP_APP_MSME_FINAL_SUBMIT", new
        {
            SuitableForSilverUpgrade = request.suitableForSilverUpgrade,
            HandholdingSupport = request.handholdingSupport,
            CertificationType = request.certificationType,
            ZedId = request.userName,
        }, ct);
        if (error is not null) return Fail(error);
        log.LogInformation("Surveillance app final submit for {ZedId} {Certification}", request.userName, request.certificationType);

        await SendSubmissionMailAsync(request.userName ?? "", request.certificationType ?? "", ct);
        return LegacyJson(new ServiceResponse { status = "1" });
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
        // Only these columns are read: the procedure also returns passwords.
        var parameters = new Dictionary<string, object?>
        {
            [nameof(MsmeSubmissionEmail.EnterpriseName)] = row.Text("EnterpriseName"),
            [nameof(MsmeSubmissionEmail.ZedId)] = zedId,
            [nameof(MsmeSubmissionEmail.Certification)] = certification,
            [nameof(MsmeSubmissionEmail.NcCount)] = row.Int("NcCount"),
        };
        if (row.Text("NcCount") is "0" or "")
            await SendMailAsync<MsmeSubmissionEmail>(row.Text("EmailId"), "ZED Basic information and Document Upload Confirmation – " + zedId, parameters, null, ct, copyOffice: true);
        else
            await SendMailAsync<MsmeSubmissionEmail>(row.Text("EmailId"),
                "Submission of response to Non-conformance(s) raised under “MSME Sustainable (ZED) Certification” Scheme  - " + zedId,
                parameters, [row.Text("AssessorEmailId"), row.Text("AgencyEmailId")], ct, copyOffice: true);
    }

    /// <summary>SP_APP_SUBMIT_FINANCIAL_ASSISTANCE_AVAILED (AvailedFinancialSupport, replaced on every call): only before final submit.</summary>
    [HttpPost]
    public async Task<IActionResult> SubmitFinancialAssistanceDetails(FinancialAssistanceAvailedRequest request, CancellationToken ct)
    {
        var (_, refused) = await UnitAsync(nameof(SubmitFinancialAssistanceDetails), request.userName, request.certificationType, Need.BeforeFinalSubmit, ct);
        if (refused is not null) return refused;
        return Answer(await TryExecuteAsync("SP_APP_SUBMIT_FINANCIAL_ASSISTANCE_AVAILED", new
        {
            CertificationType = request.certificationType,
            ZedId = request.userName,
            FinancialAssistanceAvailed = request.financialAssistanceAvailed,
            AnyDocuments = request.anyDocuments,
            DocumentTypes = request.documentTypes,
        }, ct));
    }
}
