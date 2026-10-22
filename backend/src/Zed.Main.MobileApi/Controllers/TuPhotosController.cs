using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Data.SqlClient;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Mobile;

namespace Zed.Main.MobileApi.Controllers;

/// <summary>
/// The consultant app's technology upgradation (TU) documents: <c>GET {mobileapi}/photos/{zedId}/TechnologyUpgradation/{photoId}</c>
/// (app source ZEDConsultant, TechnologyUpgradationViewModel.getPhoto). On the old services site this was the IIS static
/// file under Photos/, open to anyone who knew the name (the MSME's purchase documents, invoices and cancelled cheque).
/// Here the file is served only when it is a document of the unit's TU application (ZED_CONSULTANT's
/// SP_FINANCIAL_ASSISTANCE_GET_DETAILS) while the application is with its allotted DFO, or just decided by them, and that
/// DFO signed in to the consultant app for the unit within <c>Consultancy:TuApp:LoginHours</c> (dbo.V4AppSessions,
/// migration 0010), as the portal's TuAppController checks. Main deployment only: the files are the MSME app's uploads.
/// </summary>
[PortalSystems(PortalSystem.Main)]
public sealed partial class TuPhotosController(
    MobileStorage storage,
    IConfiguration config,
    IServiceProvider services,
    ILogger<TuPhotosController> log) : LegacyMobileController
{
    public const string ConsultancyKey = "Consultancy";
    private static readonly FileExtensionContentTypeProvider ContentTypes = new();

    [HttpGet("/photos/{zedId}/TechnologyUpgradation/{photoId}")]
    public async Task<IActionResult> Document(string zedId, string photoId, CancellationToken ct)
    {
        if (!ZedIdPattern().IsMatch(zedId) || !FileNamePattern().IsMatch(photoId) || photoId.Contains("..", StringComparison.Ordinal) ||
            !MobileStorage.DocumentExtensions.Contains(Path.GetExtension(photoId)))
            return NotFound();
        var db = Consultancy();
        if (db is null) return NotFound();

        ResultSets sets;
        try
        {
            sets = await db.QueryProcMultipleAsync("SP_FINANCIAL_ASSISTANCE_GET_DETAILS", new { ZedId = zedId }, ct);
        }
        catch (SqlException ex)
        {
            log.LogError(ex, "TU document {PhotoId} of {ZedId}: the consultancy database could not be read", photoId, zedId);
            return NotFound();
        }

        // Sets 0-2 are the Bronze / Silver / Gold applications, 3-5 their documents (as the portal reads them).
        var hours = config.GetValue("Consultancy:TuApp:LoginHours", 12);
        for (var level = 0; level < 3 && level + 3 < sets.Count; level++)
        {
            var app = sets[level].FirstOrDefault();
            if (app is null || app.Text("VerificationStatus") is not ("2" or "3") || app.Text("FinancialAssessorId") is not { Length: > 0 } dfo) continue;
            if (!sets[level + 3].Any(p => string.Equals(p.Text("PhotoId"), photoId, StringComparison.OrdinalIgnoreCase))) continue;
            if (hours > 0 && await AppSessions.LatestAsync(db, log, AppSessions.Consultant, dfo, zedId, hours, null, ct) is null)
            {
                log.LogWarning("TU document {PhotoId} of {ZedId} refused: DFO {Dfo} has not signed in to the app for the unit recently", photoId, zedId, dfo);
                return NotFound();
            }
            foreach (var folder in new[] { "Photos", "CertifiedPhotos" })
            {
                var path = Path.GetFullPath(Path.Combine(storage.Root, folder, zedId, "TechnologyUpgradation", photoId));
                if (!path.StartsWith(storage.Root, StringComparison.OrdinalIgnoreCase) || !System.IO.File.Exists(path)) continue;
                if (!ContentTypes.TryGetContentType(path, out var type)) type = "application/octet-stream";
                return PhysicalFile(path, type);
            }
            log.LogInformation("TU document {PhotoId} of {ZedId} is missing from storage", photoId, zedId);
            return NotFound();
        }
        log.LogWarning("TU document {PhotoId} of {ZedId} refused: not a document of an application with its DFO", photoId, zedId);
        return NotFound();
    }

    /// <summary>ZED_CONSULTANT: the keyed executor when one is registered (tests), else a read-only connection from ConnectionStrings:Consultancy.</summary>
    private ISqlExecutor? Consultancy()
    {
        if (services.GetKeyedService<ISqlExecutor>(ConsultancyKey) is { } keyed) return keyed;
        if (config.GetConnectionString("Consultancy") is not { Length: > 0 } cs) return null;
        var builder = new SqlConnectionStringBuilder(cs) { ApplicationIntent = ApplicationIntent.ReadOnly };
        return new SqlExecutor(builder.ConnectionString);
    }

    [GeneratedRegex("^ZED[A-Za-z]*[0-9]+$")] private static partial Regex ZedIdPattern();
    [GeneratedRegex("^[A-Za-z0-9 _.-]{1,150}$")] private static partial Regex FileNamePattern();
}
