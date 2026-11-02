using Microsoft.AspNetCore.Mvc;
using Zed.Main.MobileApi.Models;

namespace Zed.Main.MobileApi.Controllers;

/// <summary>
/// Replies to the desktop assessor's own non-conformances (raised in the surveillance DA review): NC details and
/// the requirement, product and site exterior answers (SurveillanceControllerBase). Writes only while the unit's current
/// NC is open (SurveillanceUnit.NcOpen: NC 1 to 5, that round's status 1, status 4 or 14).
/// </summary>
public sealed partial class SurveillanceController
{
    [HttpPost]
    public async Task<IActionResult> GetNcDetailsByType(string? userName, string? certificationType, string? version, string? ncCount, CancellationToken ct)
    {
        if (VersionCheck(version) is { } update) return update;
        var (_, refused) = await UnitAsync(nameof(GetNcDetailsByType), userName, certificationType, Need.Read, ct);
        if (refused is not null) return refused;
        return await NcDetailsAsync(userName, certificationType, ncCount, ct);
    }

    /// <summary>
    /// One evidence photo for an NC requirement. The evidence PDF is named after the requirement's evidence in the
    /// current NC (SP_APP_MSME_GET_EVIDENCE_ID), which also proves the requirement belongs to this unit's open NC.
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> SubmitNcRequirement(NcRequirementSubmitRequest request, IFormFile? file_data, CancellationToken ct)
    {
        var zedId = request.userName?.Trim() ?? "";
        var (_, refused) = await UnitAsync(nameof(SubmitNcRequirement), zedId, request.certificationType, Need.NcOpen, ct);
        if (refused is not null) return refused;
        return await SaveNcRequirementAsync(nameof(SubmitNcRequirement), zedId, request, file_data, ct);
    }

    /// <summary>New product photos for an NC (productDetailsNc = ProductDetails JSON; files = the photo files for BasicInfo).</summary>
    [HttpPost]
    public async Task<IActionResult> SubmitNcProduct(NcProductSubmitRequest request, List<IFormFile>? files, CancellationToken ct)
    {
        request.productDetailsNcObj = ParseEmbedded<ProductDetails>(request.productDetailsNc);
        var product = request.productDetailsNcObj;
        if (product is null) return Fail(NoDataFound);
        if (files is not { Count: > 0 }) return Fail(NoPhotosFound);

        var zedId = request.userName?.Trim() ?? "";
        var (_, refused) = await UnitAsync(nameof(SubmitNcProduct), zedId, request.certificationType, Need.NcOpen, ct);
        if (refused is not null) return refused;
        return await SaveNcProductAsync(zedId, request, product, files, ct);
    }

    /// <summary>New site exterior photos for an NC (SP_APP_MSME_INSERT_SITE_EXTERIOR).</summary>
    [HttpPost]
    public async Task<IActionResult> SubmitSiteExteriorInfo(NcSiteSubmitRequest request, CancellationToken ct)
    {
        var zedId = request.userName?.Trim() ?? "";
        var (_, refused) = await UnitAsync(nameof(SubmitSiteExteriorInfo), zedId, request.certificationType, Need.NcOpen, ct);
        if (refused is not null) return refused;
        return await SaveNcSiteExteriorAsync(zedId, request, ct);
    }
}
