using System.Globalization;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Mobile;
using Zed.Core.Security;
using Zed.Main.MobileApi.Models;

namespace Zed.Main.MobileApi.Controllers;

/// <summary>
/// Responses to non-conformances (NC): the NC details, and the requirement, product and site
/// exterior answers. The writes are accepted only while the unit's current NC is open
/// (SP_APP_MSME_STATUS: NcCount &gt; 0 and that NC's status 1 = raised, not yet submitted).
/// </summary>
public sealed partial class MsmeController
{
    [HttpPost]
    [DeviceBound(MobileApps.Msme, "userName")]
    public async Task<IActionResult> GetNcDetailsByType(string? userName, string? certificationType, string? version, string? ncCount, CancellationToken ct)
    {
        if (VersionCheck(version) is { } update) return update;
        var sets = await db.QueryProcMultipleAsync("SP_APP_MSME_GET_NC_DETAILS_BY_TYPE",
            new { ZedId = userName, NcCount = ncCount, CertificationType = certificationType }, ct);

        var res = new NcResponse { status = "1", siteExteriorPhotos = [], products = [], parameters = [] };
        foreach (var row in sets[0])
        {
            res.assessorRemarksSite = row.Text("AssessorRemarks");
            res.siteExteriorPhotos.Add(row.Text("PhotoPath"));
        }
        foreach (var row in sets[1])
        {
            res.products.Add(new ProductDetails
            {
                productId = row.Int("Id"),
                exported = row.Text("Exported"),
                productName = row.Text("ProductName"),
                productPhotoPath = row.Text("ProductPhotoPath"),
                productDescriptionPhotoPath = row.Text("ProductDescriptionPhotoPath"),
                assessorRemarks = row.Text("AssessorRemarks"),
            });
        }
        if (sets[2].Count > 0) res.parameters = BuildParameters(sets, 2, withEvidences: false, withAssessorRemarks: true);
        return LegacyJson(res);
    }

    /// <summary>
    /// One evidence photo for an NC requirement (photo = PhotoInformation JSON, file in file_data or
    /// base64). The evidence PDF is named after the requirement's evidence in the current NC
    /// (SP_APP_MSME_GET_EVIDENCE_ID), which also proves the requirement belongs to this unit's open NC.
    /// </summary>
    [HttpPost]
    [DeviceBound(MobileApps.Msme, "userName")]
    [MsmeEditAudit("App: NC requirement submitted")]
    public async Task<IActionResult> SubmitNcRequirement(NcRequirementSubmitRequest request, IFormFile? file_data, CancellationToken ct)
    {
        var zedId = request.userName ?? "";
        var stage = await StageAsync(zedId, request.certificationType, ct);
        if (stage is not { NcOpen: true }) return StageRefused(nameof(SubmitNcRequirement), zedId, request.certificationType, stage);
        var cert = CertificationSegment(request.certificationType);
        request.photoObj = ParseEmbedded<PhotoInformation>(request.photo);
        if (request.photoObj is null || !int.TryParse(request.requirementId, NumberStyles.Integer, CultureInfo.InvariantCulture, out var requirementId))
            return Fail(InvalidData);

        var evidence = (await db.QueryProcMultipleAsync("SP_APP_MSME_GET_EVIDENCE_ID",
            new { CertificationType = cert, ZedId = zedId, RequirementId = requirementId }, ct)).FirstRow(0);
        if (evidence.Text("EvidenceId") is not { Length: > 0 } evidenceId)
            return StageRefused(nameof(SubmitNcRequirement), zedId, cert, stage);

        var uploads = new Uploads(Storage);
        var table = PhotoTable();
        var stored = CollectPhotos(uploads, [request.photoObj], zedId, cert, "Evidences", table, file_data);
        var pdfName = MobileStorage.FileName(evidenceId, ".pdf");
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
                var earlier = await db.QueryProcMultipleAsync("SP_APP_MSME_GET_REQUIREMENT_PHOTOS",
                    new { RequirementId = request.requirementId, ZedId = zedId, CertificationType = cert }, ct);
                names.AddRange(earlier[0].Select(r => r.Text("PhotoPath")));
            }
            names.Add(stored[^1]);
            if (!await WriteEvidencePdfAsync(Storage.Folder(folderSegments), names, pdfName, ct)) return Fail(EvidenceNotSynced);
        }

        var args = new DynamicParameters();
        args.Add("CertificationType", cert);
        args.Add("ZedId", zedId);
        args.Add("Id", request.requirementId);
        args.Add("IsFirst", request.isFirst);
        args.Add("IsLast", request.isLast);
        args.Add("Code", request.requirementCode);
        args.Add("MsmeRemarks", request.msmeRemarks);
        AddTable(args, "PhotoList", table, "DynamicPhotoList2");
        var error = await TryExecuteAsync("SP_APP_MSME_INSERT_REQUIREMENT", args, ct);
        return LegacyJson(error is null ? new ServiceResponse { status = "1" } : ServiceResponse.Fail(error));
    }

    /// <summary>
    /// New product photos for an NC (productDetailsNc = ProductDetails JSON; files = the photo files
    /// for Photos/{userName}/{cert}/BasicInfo). The procedure updates the product only where
    /// ZedId and product id match.
    /// </summary>
    [HttpPost]
    [DeviceBound(MobileApps.Msme, "userName")]
    [MsmeEditAudit("App: NC product submitted")]
    public async Task<IActionResult> SubmitNcProduct(NcProductSubmitRequest request, List<IFormFile>? files, CancellationToken ct)
    {
        request.productDetailsNcObj = ParseEmbedded<ProductDetails>(request.productDetailsNc);
        var product = request.productDetailsNcObj;
        if (product is null) return Fail(NoDataFound);
        if (files is not { Count: > 0 }) return Fail(NoPhotosFound);

        var zedId = request.userName ?? "";
        var stage = await StageAsync(zedId, request.certificationType, ct);
        if (stage is not { NcOpen: true }) return StageRefused(nameof(SubmitNcProduct), zedId, request.certificationType, stage);
        var cert = CertificationSegment(request.certificationType);

        var uploads = new Uploads(Storage);
        var productPhotos = PhotoTable();
        var descriptionPhotos = PhotoTable();
        if (product.productPhoto is { } pp)
        {
            if (!string.IsNullOrEmpty(pp.photo)) CollectPhotos(uploads, [pp], zedId, cert, "BasicInfo", productPhotos);
        }
        else product.productPhoto = new PhotoInformation();
        if (product.productDescriptionPhoto is { } dp)
        {
            if (!string.IsNullOrEmpty(dp.photo)) CollectPhotos(uploads, [dp], zedId, cert, "BasicInfo", descriptionPhotos);
        }
        else product.productDescriptionPhoto = new PhotoInformation();
        foreach (var f in files)
            if (f is { Length: > 0 }) uploads.AddFile(f, MobileStorage.UploadedName(f, MobileStorage.DocumentExtensions), "Photos", zedId, cert, "BasicInfo");
        await uploads.SaveAsync(ct);

        var args = new DynamicParameters();
        args.Add("RefId", NewRefId());
        args.Add("ZedId", zedId);
        args.Add("CertificationType", cert);
        args.Add("ProductId", product.productId.ToString(CultureInfo.InvariantCulture));
        args.Add("MsmeRemarks", product.msmeRemarks);
        args.Add("ProductPhoto", product.productPhoto.photoId + (product.productPhoto.isPdf ? ".pdf" : ".jpg"));
        args.Add("ProductDescriptionPhoto", product.productDescriptionPhoto.photoId + (product.productDescriptionPhoto.isPdf ? ".pdf" : ".jpg"));
        AddTable(args, "ProductPhotos", productPhotos, "DynamicPhotoList2");
        AddTable(args, "ProductDescriptionPhotos", descriptionPhotos, "DynamicPhotoList2");
        var error = await TryExecuteAsync("SP_APP_MSME_INSERT_PRODUCT_INFO", args, ct);
        return LegacyJson(error is null ? new ServiceResponse { status = "1" } : ServiceResponse.Fail(error));
    }

    /// <summary>New site exterior photos for an NC (SP_APP_MSME_INSERT_SITE_EXTERIOR).</summary>
    [HttpPost]
    [DeviceBound(MobileApps.Msme, "userName")]
    [MsmeEditAudit("App: site exterior information submitted")]
    public async Task<IActionResult> SubmitSiteExteriorInfo(NcSiteSubmitRequest request, CancellationToken ct)
    {
        var zedId = request.userName ?? "";
        var stage = await StageAsync(zedId, request.certificationType, ct);
        if (stage is not { NcOpen: true }) return StageRefused(nameof(SubmitSiteExteriorInfo), zedId, request.certificationType, stage);
        var cert = CertificationSegment(request.certificationType);

        var uploads = new Uploads(Storage);
        var photos = PhotoTable();
        CollectPhotos(uploads, request.photos, zedId, cert, "SiteExteriorPhotos", photos);
        await uploads.SaveAsync(ct);

        var args = new DynamicParameters();
        args.Add("RefId", NewRefId());
        args.Add("ZedId", zedId);
        args.Add("CertificationType", cert);
        args.Add("MsmeRemarks", request.msmeRemarks);
        AddTable(args, "SiteExteriorPhotos", photos, "DynamicPhotoList2");
        var error = await TryExecuteAsync("SP_APP_MSME_INSERT_SITE_EXTERIOR", args, ct);
        return LegacyJson(error is null ? new ServiceResponse { status = "1" } : ServiceResponse.Fail(error));
    }
}
