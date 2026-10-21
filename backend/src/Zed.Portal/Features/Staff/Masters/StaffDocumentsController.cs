using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Msme;

namespace Zed.Portal.Features.Staff.Masters;

/// <summary>
/// Admin uploads: guideline documents (port of MyDocumentsController) and the home page banner
/// (HomeController.PageSettings / Upload / SaveHomepageImage). Files are stored in the legacy
/// folders under <see cref="PortalOptions.StorageRoot"/> — <c>Uploads/Documents/</c> (MSMEs download
/// them through api/msme/files) and <c>Images/HomePage/</c>.
/// <para>
/// Legacy holes closed: Home/Upload and Home/SaveHomepageImage had no sign-in check (anyone could
/// replace the login banner, with any file or any URL); the save actions stored the path posted by
/// the browser. Upload and save are now one request and the path is chosen by the server.
/// </para>
/// </summary>
[Route("api/staff/masters")]
[StaffRoles(UserRole.Admin)]
public sealed class StaffDocumentsController(
    ISqlExecutor db,
    IWebHostEnvironment env,
    IOptions<PortalOptions> portal,
    ILogger<StaffDocumentsController> log) : StaffApiController
{
    public const string DocumentsFolder = "Uploads/Documents";
    public const string BannerFolder = "Images/HomePage";
    public const string BannerSetting = "HomePageBanner";

    private static readonly FileExtensionContentTypeProvider ContentTypes = new();

    private string StorageRoot => Path.GetFullPath(Path.Combine(env.ContentRootPath, portal.Value.StorageRoot));

    public sealed record DocumentRow(int Id, string DocumentName, string? FileName, string? DownloadUrl);

    /// <summary>Guideline documents (SP_MASTER_GET_MY_DOCUMENTS).</summary>
    [HttpGet("documents")]
    public async Task<IReadOnlyList<DocumentRow>> Documents(CancellationToken ct)
    {
        var rows = (await db.QueryProcMultipleAsync("SP_MASTER_GET_MY_DOCUMENTS", null, ct))[0];
        return rows.Select(r =>
        {
            var id = int.TryParse(r.Text("Id"), out var i) ? i : 0;
            var path = DocumentPath(r.Text("DocumentPath"));
            return new DocumentRow(id, r.Text("DocumentName"), path is null ? null : Path.GetFileName(path),
                path is null ? null : $"/api/staff/masters/documents/{id}/file");
        }).Where(d => d.Id > 0).ToList();
    }

    /// <summary>Adds a guideline document: the file is checked, stored as Uploads/Documents/Document_{time}_{random}.ext and listed (SP_MASTER_INSERT_MY_DOCUMENT).</summary>
    [HttpPost("documents")]
    [RequestSizeLimit(MasterUploads.DocumentMaxBytes + 64 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = MasterUploads.DocumentMaxBytes + 64 * 1024)]
    public async Task<ActionResult<MessageResponse>> AddDocument([FromForm] string? documentName, IFormFile? file, CancellationToken ct)
    {
        if (!Users.StaffUserRules.TryText(documentName, 200, required: true, multiline: false, out var name))
            return this.Problem400("Document Name required (up to 200 characters).");
        var (type, error) = await MasterUploads.CheckAsync(file, MasterUploads.DocumentTypes, MasterUploads.DocumentMaxBytes, ct);
        if (error is not null) return this.Problem400(error);

        var fileName = MasterUploads.NewFileName("Document", type!.Extension);
        await MasterUploads.SaveAsync(file!, StorageRoot, DocumentsFolder, fileName, ct);
        // Stored as the legacy upload did (Path.Combine on Windows); SP_MSME_GET_MY_DOCUMENTS prefixes the site URL.
        await db.ExecuteProcAsync("SP_MASTER_INSERT_MY_DOCUMENT",
            new { DocumentName = name, DocumentPath = DocumentsFolder.Replace('/', '\\') + "\\" + fileName }, ct);
        log.LogInformation("Guideline document {FileName} added by {Actor}", fileName, UserId);
        return new MessageResponse("Document saved.");
    }

    /// <summary>Removes a document from the list (SP_MASTER_DELETE_MY_DOCUMENT). As before, the stored file is kept.</summary>
    [HttpDelete("documents/{id:int}")]
    public async Task<ActionResult<MessageResponse>> DeleteDocument(int id, CancellationToken ct)
    {
        if (await FindDocumentAsync(id, ct) is null) return NotFound();
        await db.ExecuteProcAsync("SP_MASTER_DELETE_MY_DOCUMENT", new { Id = id.ToString() }, ct);
        log.LogInformation("Guideline document {Id} removed by {Actor}", id, UserId);
        return new MessageResponse("Document deleted.");
    }

    /// <summary>Downloads a listed document (the old page linked to the public file).</summary>
    [HttpGet("documents/{id:int}/file")]
    public async Task<IActionResult> DocumentFile(int id, CancellationToken ct)
    {
        var row = await FindDocumentAsync(id, ct);
        var path = row is null ? null : DocumentPath(row.Text("DocumentPath"));
        return path is null ? NotFound() : Serve(path, inline: MsmeFilePaths.IsInline(path));
    }

    public sealed record PageSettingsResponse(bool HasBanner, string? FileName, string? UpdatedOn, string? ImageUrl);

    /// <summary>Current home page banner (SP_MASTER_GET_HOME_PAGE_SETTINGS 'HomePageBanner').</summary>
    [HttpGet("page-settings")]
    public async Task<PageSettingsResponse> PageSettings(CancellationToken ct)
    {
        var row = await CurrentBannerAsync(ct);
        var path = BannerPath(row?.Text("FilePath"));
        var stored = path is not null && System.IO.File.Exists(MsmeFilePaths.Resolve(StorageRoot, path) ?? "");
        var updated = row?.TryGetValue("CreatedDate", out var d) == true && d is DateTime dt ? dt.ToString("dd-MM-yyyy HH:mm") : null;
        return new PageSettingsResponse(stored, path is null ? null : Path.GetFileName(path), updated,
            stored ? "/api/staff/masters/page-settings/banner?v=" + Uri.EscapeDataString(Path.GetFileNameWithoutExtension(path!)) : null);
    }

    [HttpGet("page-settings/banner")]
    public async Task<IActionResult> Banner(CancellationToken ct)
    {
        var path = BannerPath((await CurrentBannerAsync(ct))?.Text("FilePath"));
        return path is null ? NotFound() : Serve(path, inline: true);
    }

    /// <summary>Replaces the banner: the PNG is stored as Images/HomePage/Banner_{time}_{random}.png and recorded (SP_MASTER_INSERT_HOME_PAGE_SETTINGS).</summary>
    [HttpPost("page-settings/banner")]
    [RequestSizeLimit(MasterUploads.BannerMaxBytes + 64 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = MasterUploads.BannerMaxBytes + 64 * 1024)]
    public async Task<ActionResult<MessageResponse>> SaveBanner(IFormFile? file, CancellationToken ct)
    {
        var (type, error) = await MasterUploads.CheckAsync(file, MasterUploads.BannerTypes, MasterUploads.BannerMaxBytes, ct);
        if (error is not null) return this.Problem400(error);

        var fileName = MasterUploads.NewFileName("Banner", type!.Extension);
        await MasterUploads.SaveAsync(file!, StorageRoot, BannerFolder, fileName, ct);
        // The procedure prefixes https://loginzed.msme.gov.in/ and turns '\' into '/'.
        await db.ExecuteProcAsync("SP_MASTER_INSERT_HOME_PAGE_SETTINGS",
            new { FileName = BannerSetting, FilePath = BannerFolder.Replace('/', '\\') + "\\" + fileName }, ct);
        log.LogInformation("Home page banner {FileName} saved by {Actor}", fileName, UserId);
        return new MessageResponse("Document saved.");
    }

    private async Task<IDictionary<string, object?>?> FindDocumentAsync(int id, CancellationToken ct) =>
        (await db.QueryProcMultipleAsync("SP_MASTER_GET_MY_DOCUMENTS", null, ct))[0].FirstOrDefault(r => r.Text("Id") == id.ToString());

    private async Task<IDictionary<string, object?>?> CurrentBannerAsync(CancellationToken ct) =>
        (await db.QueryProcMultipleAsync("SP_MASTER_GET_HOME_PAGE_SETTINGS", new { FileName = BannerSetting }, ct))[0].FirstOrDefault();

    /// <summary>A stored DocumentPath as a relative path, only when it lies in a guideline folder.</summary>
    private static string? DocumentPath(string value) =>
        MsmeFilePaths.FromLegacy(value) is { } p && MsmeFilePaths.IsPublicFolder(p) ? p : null;

    private static string? BannerPath(string? value) =>
        MsmeFilePaths.FromLegacy(value) is { } p && p.StartsWith(BannerFolder + "/", StringComparison.OrdinalIgnoreCase) &&
        MsmeFilePaths.IsInline(p) ? p : null;

    private IActionResult Serve(string relative, bool inline)
    {
        var full = MsmeFilePaths.Resolve(StorageRoot, relative);
        if (full is null || !System.IO.File.Exists(full)) return NotFound();
        var fileName = Path.GetFileName(full);
        var contentType = ContentTypes.TryGetContentType(fileName, out var t) ? t : "application/octet-stream";
        Response.Headers.XContentTypeOptions = "nosniff";
        if (inline)
        {
            Response.Headers.ContentDisposition = new ContentDispositionHeaderValue("inline") { FileNameStar = fileName }.ToString();
            return PhysicalFile(full, contentType, enableRangeProcessing: true);
        }
        return PhysicalFile(full, contentType, fileName, enableRangeProcessing: true);
    }
}
