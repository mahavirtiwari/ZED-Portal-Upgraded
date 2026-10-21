using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;
using Zed.Core.Data;
using Zed.Core.Http;

namespace Zed.Portal.Features.Msme;

/// <summary>
/// Photos and evidence PDFs shown on the MSME's basic information and NC pages.
/// <para>
/// The old pages linked them as public files of the mobile app at guessable addresses
/// (<c>https://loginzed.msme.gov.in/mobileapi/Photos/{ZedId}/{Certification}/Evidences/{EvidenceId}.pdf</c>,
/// <c>.../SaPhotos/...</c>, <c>/surveillancemobileapi/...</c>). Here a file is served only when the
/// procedure named by <c>source</c> (da = SP_ASSESSMENT_DA_DETAILS, nc1..nc5 = SP_ASSESSMENT_DA_DETAILS_NC,
/// sa = SP_ASSESSMENT_SA_DETAILS), run for the ZED ID in the sign-in cookie and the certification,
/// lists it; the path must also be in the mobile app folders and name that ZED ID.
/// </para>
/// <para>
/// Storage: the path keeps its legacy layout (<c>mobileapi/Photos/…</c>) and is resolved under
/// <c>Portal:AssessmentStorageRoot</c> when set (the folder that contains the mobileapi and
/// surveillancemobileapi applications), otherwise under <see cref="PortalOptions.StorageRoot"/>.
/// </para>
/// </summary>
[Route("api/msme/assessment")]
public sealed class MsmeEvidenceFilesController(
    ISqlExecutor db,
    IWebHostEnvironment env,
    IOptions<PortalOptions> portal,
    IConfiguration config,
    ILogger<MsmeEvidenceFilesController> log) : MsmeApiController
{
    public const string StorageRootSetting = "Portal:AssessmentStorageRoot";

    private static readonly FileExtensionContentTypeProvider ContentTypes = new();

    /// <summary>GET api/msme/assessment/Bronze/files/da/mobileapi/Photos/ZEDMSME000001/Bronze/Selfie/1.jpg (URLs as the report endpoints return them).</summary>
    [HttpGet("{certification}/files/{source}/{**path}")]
    public async Task<IActionResult> Get(string certification, string source, string? path, CancellationToken ct)
    {
        // Unknown, foreign and malformed requests all answer 404 so that file existence is not revealed.
        if (!MsmeAssessment.TryCertification(certification, out var type)) return NotFound();
        var requested = MsmeFilePaths.Normalise(path);
        if (requested is null || AssessmentFileLinks.Servable(requested, ZedId) is null) return NotFound();

        var listed = await MsmeAssessment.ListFilesAsync(db, ZedId, RoleId, type, source ?? "", ct);
        if (listed is null || !listed.Contains(requested)) return NotFound();

        var configured = config[StorageRootSetting];
        var root = Path.GetFullPath(Path.Combine(env.ContentRootPath,
            string.IsNullOrWhiteSpace(configured) ? portal.Value.StorageRoot : configured));
        var fullPath = MsmeFilePaths.Resolve(root, requested);
        if (fullPath is null || !System.IO.File.Exists(fullPath))
        {
            log.LogInformation("Listed assessment file {Path} for {ZedId} is missing from storage", requested, ZedId);
            return NotFound();
        }

        var fileName = Path.GetFileName(fullPath);
        var contentType = ContentTypes.TryGetContentType(fileName, out var t) ? t : "application/octet-stream";
        Response.Headers.XContentTypeOptions = "nosniff";
        // Only PDFs and images are listed; they open in the browser (image preview, PDF in a new tab).
        Response.Headers.ContentDisposition = new ContentDispositionHeaderValue("inline") { FileNameStar = fileName }.ToString();
        return PhysicalFile(fullPath, contentType, enableRangeProcessing: true);
    }
}
