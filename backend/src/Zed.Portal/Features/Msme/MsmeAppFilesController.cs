using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;
using Zed.Core.Content;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Mobile;

namespace Zed.Portal.Features.Msme;

/// <summary>
/// V4, for the ZED MSME app 2.0 (React Native): the documents of its My Documents and the pledge certificate,
/// <c>GET /Msme/AppDocument?path=…</c> with the app's sign-in token (<see cref="AppTokens.Header"/>).
/// <para>
/// GetMyDocuments answers the old site's addresses (<c>…/Certificates/{ZedId}/Pledge.pdf</c>, <c>…/Uploads/Documents/…</c>),
/// which V4 no longer serves as public files (<see cref="MsmeFilesController"/> serves them to the signed-in web user).
/// The app has no web sign-in, so here the ZED ID is the token's unit, and the token must be valid whatever the MSME
/// app's token mode (the store app never calls this). Otherwise the same rules as the web: only a path that
/// SP_MSME_GET_MY_DOCUMENTS lists for that ZED ID, the pledge certificate drawn now (<c>path=pledge</c> or its old path).
/// </para>
/// </summary>
public sealed class MsmeAppFilesController(
    ISqlExecutor db,
    IWebHostEnvironment env,
    IOptions<PortalOptions> portal,
    IDocumentAccessStore access,
    PledgeCertificateService pledges,
    AppTokens tokens,
    ILogger<MsmeAppFilesController> log) : LegacyMobileController
{
    public const string PledgePath = "pledge";
    private static readonly FileExtensionContentTypeProvider ContentTypes = new();

    [HttpGet("/Msme/AppDocument")]
    public async Task<IActionResult> AppDocument(string? path, CancellationToken ct)
    {
        // 2026-11-14: a refused token says why, so the app signs out and a new sign-in works (MsmeAppToken).
        var (unit, check) = await MsmeAppToken.UnitAsync(Request, tokens, ct);
        if (unit is not { } zedId) return MsmeAppToken.Refused(this, check);

        var requested = string.Equals(path?.Trim(), PledgePath, StringComparison.OrdinalIgnoreCase) ? null : MsmeFilePaths.FromLegacy(path);
        if (requested is null && !string.Equals(path?.Trim(), PledgePath, StringComparison.OrdinalIgnoreCase)) return NotFound();

        if (requested is null || MsmeFilePaths.IsPledge(requested, zedId))
            return await pledges.LoadAsync(db, zedId, ct) is { } d ? PledgePdf.Result(this, pledges, d, inline: true) : NotFound();

        var documents = await MsmeMyDocuments.LoadAsync(db, zedId, ct);
        await MsmeMyDocuments.AddV4LevelsAsync(db, documents, zedId, ct);
        var sets = MsmeGuidelines.ForMsme(documents, await access.AllAsync(ct));
        var entry = MsmeMyDocuments.Files(sets, zedId).FirstOrDefault(f => string.Equals(f.RelativePath, requested, StringComparison.OrdinalIgnoreCase));
        if (entry is null) return NotFound();

        var fullPath = MsmeFilePaths.Find(MsmeFilePaths.Root(env, portal.Value), entry.RelativePath);
        if (fullPath is null)
        {
            log.LogInformation("Listed document {Path} for {ZedId} (app) is missing from storage", entry.RelativePath, zedId);
            return NotFound();
        }
        var fileName = Path.GetFileName(fullPath);
        Response.Headers.XContentTypeOptions = "nosniff";
        Response.Headers.ContentDisposition = new ContentDispositionHeaderValue("inline") { FileNameStar = fileName }.ToString();
        return PhysicalFile(fullPath, ContentTypes.TryGetContentType(fileName, out var type) ? type : "application/octet-stream");
    }
}
