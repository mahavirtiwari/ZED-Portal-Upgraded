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
/// New in V4: the documents and videos the Admin gave to the signed-in staff user's account type (Admin → Documents/Videos,
/// <see cref="DocumentRoles"/>); the Admin sees them all. Before V4 the documents went to the MSMEs only.
/// </summary>
[Route("api/staff/documents")]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy)]
[StaffRoles(UserRole.Admin, UserRole.MasterAdmin, UserRole.Agency, UserRole.DesktopAssessor, UserRole.StateCoordinator, UserRole.Ministry,
    UserRole.SuperAdmin, UserRole.CitizenFeedback, UserRole.QC)]
public sealed class StaffRoleDocumentsController(
    ISqlExecutor db,
    IDocumentAccessStore access,
    IWebHostEnvironment env,
    IOptions<PortalOptions> portal) : StaffApiController
{
    private static readonly FileExtensionContentTypeProvider ContentTypes = new();

    public sealed record MyDocument(int Id, string DocumentName, string? Description, string? DownloadUrl, string? VideoUrl, DateTime? CreatedDate);

    [HttpGet]
    public async Task<IReadOnlyList<MyDocument>> List(CancellationToken ct) =>
        (await MineAsync(ct)).Select(d => new MyDocument(d.Id, d.DocumentName, d.Description, d.DownloadUrl, d.VideoUrl, d.CreatedDate)).ToList();

    /// <summary>A file of a document given to this account type (any other answers 404).</summary>
    [HttpGet("{id:int}/file")]
    public async Task<IActionResult> File(int id, CancellationToken ct)
    {
        if ((await MineAsync(ct)).All(d => d.Id != id)) return NotFound();
        var row = (await db.QueryProcMultipleAsync("SP_MASTER_GET_MY_DOCUMENTS", null, ct))[0].FirstOrDefault(r => r.Text("Id") == id.ToString());
        var relative = row is null ? null : StaffDocumentsController.DocumentPath(row.Text("DocumentPath"));
        var root = Path.GetFullPath(Path.Combine(env.ContentRootPath, portal.Value.StorageRoot));
        var full = relative is null ? null : MsmeFilePaths.Resolve(root, relative);
        if (full is null || !System.IO.File.Exists(full)) return NotFound();
        var fileName = Path.GetFileName(full);
        Response.Headers.XContentTypeOptions = "nosniff";
        var contentType = ContentTypes.TryGetContentType(fileName, out var t) ? t : "application/octet-stream";
        if (MsmeFilePaths.IsInline(relative!))
        {
            Response.Headers.ContentDisposition = new ContentDispositionHeaderValue("inline") { FileNameStar = fileName }.ToString();
            return PhysicalFile(full, contentType, enableRangeProcessing: true);
        }
        return PhysicalFile(full, contentType, fileName, enableRangeProcessing: true);
    }

    private async Task<IEnumerable<StaffDocumentsController.DocumentRow>> MineAsync(CancellationToken ct)
    {
        var all = await StaffDocumentsController.ListAsync(db, access, ct, "/api/staff/documents");
        if (IsRole(UserRole.Admin)) return all;
        var key = DocumentRoles.KeyOf(RoleId);
        return key is null ? [] : all.Where(d => d.Roles?.Contains(key, StringComparer.OrdinalIgnoreCase) == true);
    }
}
