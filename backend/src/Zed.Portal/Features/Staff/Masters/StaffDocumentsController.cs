using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;
using Zed.Core.Content;
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
/// <para>
/// V4 (Documents/Videos, as the LEAN portal): a document has a description, can be a video link instead of a file, and
/// is given to the account types that may open it (columns of dbo.MyDocuments, migration 0023; <see cref="DocumentRoles"/>).
/// A document from before, without a row, goes to the MSMEs only. Staff open theirs on api/staff/documents.
/// </para>
/// </summary>
[Route("api/staff/masters")]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy)]
[StaffRoles(UserRole.Admin)]
public sealed class StaffDocumentsController(
    ISqlExecutor db,
    IWebHostEnvironment env,
    IOptions<PortalOptions> portal,
    IDocumentAccessStore access,
    PortalHost host,
    ILogger<StaffDocumentsController> log) : StaffApiController
{
    public const string DocumentsFolder = "Uploads/Documents";
    public const string BannerFolder = "Images/HomePage";
    public const string BannerSetting = "HomePageBanner";

    private static readonly FileExtensionContentTypeProvider ContentTypes = new();

    private string StorageRoot => Path.GetFullPath(Path.Combine(env.ContentRootPath, portal.Value.StorageRoot));

    /// <param name="Roles">The account types that may open it (<see cref="DocumentRoles"/>); the MSMEs only for a document from before V4.</param>
    public sealed record DocumentRow(int Id, string DocumentName, string? FileName, string? DownloadUrl,
        string? Description = null, string? VideoUrl = null, IReadOnlyList<string>? Roles = null, DateTime? CreatedDate = null);

    public sealed record DocumentsResponse(IReadOnlyList<DocumentRow> Documents, IReadOnlyList<DocumentRoles.RoleOption> Roles);

    /// <summary>The documents with their description, video and roles, and the account types of this system.</summary>
    [HttpGet("documents")]
    public async Task<DocumentsResponse> Documents(CancellationToken ct) =>
        new(await ListAsync(db, access, ct), DocumentRoles.For(host.System));

    /// <summary>The documents of SP_MASTER_GET_MY_DOCUMENTS with their V4 settings (also read by the staff's own list).</summary>
    internal static async Task<IReadOnlyList<DocumentRow>> ListAsync(ISqlExecutor db, IDocumentAccessStore access, CancellationToken ct, string urlBase = "/api/staff/masters/documents")
    {
        var settings = (await access.AllAsync(ct)).ToDictionary(a => a.DocumentId);
        var rows = (await db.QueryProcMultipleAsync("SP_MASTER_GET_MY_DOCUMENTS", null, ct))[0];
        return rows.Select(r =>
        {
            var id = int.TryParse(r.Text("Id"), out var i) ? i : 0;
            var path = DocumentPath(r.Text("DocumentPath"));
            var a = settings.GetValueOrDefault(id);
            var created = r.TryGetValue("CreatedDate", out var c) && c is DateTime d ? d : (DateTime?)null;
            return new DocumentRow(id, r.Text("DocumentName"), path is null ? null : Path.GetFileName(path),
                path is null ? null : $"{urlBase}/{id}/file", a?.Description, a?.VideoUrl, a?.RoleKeys ?? [DocumentRoles.Msme], created);
        }).Where(d => d.Id > 0).ToList();
    }

    public const int DescriptionMax = 300;

    /// <summary>
    /// Adds a document: a file (checked, stored as Uploads/Documents/Document_{time}_{random}.ext) or a video link, listed
    /// with SP_MASTER_INSERT_MY_DOCUMENT, then given to the roles ticked (<paramref name="roles"/>: comma-separated keys).
    /// </summary>
    [HttpPost("documents")]
    [RequestSizeLimit(MasterUploads.DocumentMaxBytes + 64 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = MasterUploads.DocumentMaxBytes + 64 * 1024)]
    public async Task<ActionResult<MessageResponse>> AddDocument([FromForm] string? documentName, [FromForm] string? description,
        [FromForm] string? videoUrl, [FromForm] string? roles, IFormFile? file, CancellationToken ct)
    {
        if (!Users.StaffUserRules.TryText(documentName, 200, required: true, multiline: false, out var name))
            return this.Problem400("Document Name required (up to 200 characters).");
        if (CheckSettings(description, roles, out var roleKeys) is { } settingsError) return this.Problem400(settingsError);
        var video = string.IsNullOrWhiteSpace(videoUrl) ? null : videoUrl.Trim();
        string? storedPath = null;
        if (video is not null)
        {
            if (file is not null) return this.Problem400("Add a file or a video link, not both.");
            if (VideoError(video) is { } videoError) return this.Problem400(videoError);
        }
        else
        {
            var (type, error) = await MasterUploads.CheckAsync(file, MasterUploads.DocumentTypes, MasterUploads.DocumentMaxBytes, ct);
            if (error is not null) return this.Problem400(error);
            var fileName = MasterUploads.NewFileName("Document", type!.Extension);
            await MasterUploads.SaveAsync(file!, StorageRoot, DocumentsFolder, fileName, ct);
            // Stored as the legacy upload did (Path.Combine on Windows); SP_MSME_GET_MY_DOCUMENTS prefixes the site URL.
            storedPath = DocumentsFolder.Replace('/', '\\') + "\\" + fileName;
        }
        await db.ExecuteProcAsync("SP_MASTER_INSERT_MY_DOCUMENT", new { DocumentName = name, DocumentPath = storedPath }, ct);

        // The procedure returns no Id: the newest document with this name and path is the new one.
        var id = (await db.QueryProcMultipleAsync("SP_MASTER_GET_MY_DOCUMENTS", null, ct))[0]
            .Where(r => r.Text("DocumentName") == name && (storedPath is null ? r.Text("DocumentPath").Length == 0 : r.Text("DocumentPath") == storedPath))
            .Select(r => long.TryParse(r.Text("Id"), out var i) ? i : 0).DefaultIfEmpty(0).Max();
        if (id <= 0)
        {
            log.LogError("Document {Name} was listed but could not be found again to save its roles", name);
            return this.Problem400("The document was saved, but its roles could not be: please open Edit and save them again.");
        }
        await access.SaveAsync(id, description, video, roleKeys!, UserId, ct);
        log.LogInformation("Document {Id} ({Kind}) added by {Actor} for {Roles}", id, video is null ? "file" : "video", UserId, string.Join(',', roleKeys!));
        return new MessageResponse("Document saved.");
    }

    public sealed record DocumentUpdate(string? DocumentName, string? Description, string? VideoUrl, IReadOnlyList<string>? Roles);

    /// <summary>Renames a document and changes its description, video link (videos only) and roles.</summary>
    [HttpPut("documents/{id:int}")]
    public async Task<ActionResult<MessageResponse>> UpdateDocument(int id, DocumentUpdate req, CancellationToken ct)
    {
        var row = await FindDocumentAsync(id, ct);
        if (row is null) return NotFound();
        if (!Users.StaffUserRules.TryText(req.DocumentName, 200, required: true, multiline: false, out var name))
            return this.Problem400("Document Name required (up to 200 characters).");
        if (CheckSettings(req.Description, string.Join(',', req.Roles ?? []), out var roleKeys) is { } settingsError) return this.Problem400(settingsError);
        var current = (await access.AllAsync(ct)).FirstOrDefault(a => a.DocumentId == id);
        var isVideo = row.Text("DocumentPath").Length == 0 && current?.VideoUrl is not null;
        string? video = null;
        if (isVideo)
        {
            video = req.VideoUrl?.Trim();
            if (VideoError(video) is { } videoError) return this.Problem400(videoError);
        }
        else if (!string.IsNullOrWhiteSpace(req.VideoUrl))
        {
            return this.Problem400("A file document has no video link.");
        }
        if (name != row.Text("DocumentName"))
            await db.ExecuteSqlAsync("UPDATE MyDocuments SET DocumentName = @DocumentName WHERE Id = @Id;", new { DocumentName = name, Id = id }, ct);
        await access.SaveAsync(id, req.Description, video, roleKeys!, UserId, ct);
        log.LogInformation("Document {Id} updated by {Actor} for {Roles}", id, UserId, string.Join(',', roleKeys!));
        return new MessageResponse("Document updated. The roles apply the next time each user opens the documents.");
    }

    /// <summary>Removes a document from the list (SP_MASTER_DELETE_MY_DOCUMENT) with its roles. As before, the stored file is kept.</summary>
    [HttpDelete("documents/{id:int}")]
    public async Task<ActionResult<MessageResponse>> DeleteDocument(int id, CancellationToken ct)
    {
        if (await FindDocumentAsync(id, ct) is null) return NotFound();
        await db.ExecuteProcAsync("SP_MASTER_DELETE_MY_DOCUMENT", new { Id = id.ToString() }, ct);
        try
        {
            await access.DeleteAsync(id, ct);
        }
        catch (Microsoft.Data.SqlClient.SqlException ex)
        {
            log.LogWarning(ex, "Roles of document {Id} not removed (is migration 0023 applied?)", id);
        }
        log.LogInformation("Guideline document {Id} removed by {Actor}", id, UserId);
        return new MessageResponse("Document deleted.");
    }

    /// <summary>Description up to 300 characters and at least one known role of this system.</summary>
    private string? CheckSettings(string? description, string? roles, out IReadOnlyList<string>? roleKeys)
    {
        roleKeys = null;
        if (description is { Length: > DescriptionMax }) return $"The description can be up to {DescriptionMax} characters.";
        if (description is not null && description.Any(c => char.IsControl(c) && c is not '\n' and not '\r')) return "The description contains invalid characters.";
        var known = DocumentRoles.For(host.System).Select(r => r.Key).ToList();
        var keys = DocumentRoles.Parse(roles);
        if (keys.Count == 0) return "Please tick at least one role that may open the document.";
        if (keys.FirstOrDefault(k => !known.Contains(k, StringComparer.OrdinalIgnoreCase)) is { } unknown) return $"\"{unknown}\" is not a role of this portal.";
        roleKeys = known.Where(k => keys.Contains(k, StringComparer.OrdinalIgnoreCase)).ToList();
        return null;
    }

    private static string? VideoError(string? url) =>
        string.IsNullOrWhiteSpace(url) ? "Please enter the video link." :
        url.Length > 1000 ? "The video link can be up to 1000 characters." :
        Uri.TryCreate(url, UriKind.Absolute, out var u) && u.Scheme == Uri.UriSchemeHttps && u.Host.Length > 0 ? null :
        "The video link must be a full https:// address (for example a YouTube link).";

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
    internal static string? DocumentPath(string value) =>
        MsmeFilePaths.FromLegacy(value) is { } p && MsmeFilePaths.IsPublicFolder(p) ? p : null;

    /// <summary>A stored banner FilePath (legacy full URL or relative) as a relative path under Images/HomePage, or null.</summary>
    public static string? BannerPath(string? value) =>
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
