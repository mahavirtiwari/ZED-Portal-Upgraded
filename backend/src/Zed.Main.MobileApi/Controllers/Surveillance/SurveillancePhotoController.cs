using System.Data;
using System.Data.Common;
using System.Text.Json;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Mobile;
using Zed.Main.MobileApi.Models;

namespace Zed.Main.MobileApi.Controllers;

/// <summary>
/// Msme/SubmitSurveillancePhoto (new in the old SurveillanceServices MsmeController; finding #108): the unit sends a
/// photo (selfie, site interior, site exterior or site tour) during its Silver/Gold surveillance meeting. Stored as
/// SaPhotos/{ZedId}/{level}/SiteTour/{photoId}.jpg and recorded by SP_APP_SYNC_SUVEILLANCE_PHOTOS (PhotoType SiteTour).
/// <para>
/// Added over the old code: the unit must have a site assessment allotted and open for photos
/// (MsmeCertifications: SiteAssessorId set, no SA certificate yet, status 9-13, the procedure's own window) before
/// anything is written; the level must be Silver or Gold; the file must be a JPEG or PNG image within
/// Mobile:MaxFileBytes; every path segment is a plain name; the request is device-bound to the ZED ID. The rest of
/// the surveillance Msme controller is not served (see docs/MOBILE-API.md).
/// </para>
/// <para>
/// The folder is the site assessor's own SiteTour folder (the procedures and the portal build the address from the
/// PhotoId, so the unit's photos cannot move), and the call has no password behind it: an existing file is never
/// replaced. The same bytes sent again (a retried sync) go on to the procedure; other bytes under a taken photoId are
/// refused, so the assessor's evidence cannot be swapped.
/// </para>
/// </summary>
[PortalSystems(PortalSystem.Surveillance)]
[Route("Msme/SubmitSurveillancePhoto")]
public sealed class SurveillancePhotoController(ISqlExecutor db, MobileStorage storage, ILogger<SurveillancePhotoController> log) : LegacyMobileController
{
    internal const string ClosedMessage = "Cannot Sync Now. Please check with Assessor as final submission done from their end.";
    private const string InvalidDetails = "Invalid Details.";
    private const string GenericError = "An error has occurred, please try again later.";
    internal const string ExistsMessage = "Photo already submitted.";

    internal const string SiteUnitSql =
        "SELECT Certification, DesktopAssessorId, SiteAssessorId, SaCertificateNo, CertificationStatus, NcCount, " +
        "Nc1Status, Nc2Status, Nc3Status, Nc4Status, Nc5Status FROM MsmeCertifications " +
        "WHERE ZedId = @ZedId AND Certification = @Certification AND SiteAssessorId IS NOT NULL AND SaCertificateNo IS NULL";

    /// <summary>2026-11-08: every site level of Administration → Certification Levels.</summary>
    private static IReadOnlySet<string> SiteLevels =>
        new HashSet<string>(LevelRegistry.Codes.Where(c => !LevelRegistry.IsDesktop(c)), StringComparer.OrdinalIgnoreCase);

    [HttpPost]
    [DeviceBound(MobileApps.Msme, "userName")]
    public async Task<IActionResult> Submit(SubmitSurveillancePhotoRequest request, IFormFile? file_data, CancellationToken ct)
    {
        if (file_data is not { Length: > 0 }) return Fail("Invalid File Data.");

        // As before, the last of the four fields that is present wins, with its default name.
        PhotoInformation? photo = null;
        foreach (var (json, defaultName) in new[]
                 {
                     (request.selfie, "Selfie"), (request.interior, "Site Interior Photo"),
                     (request.exterior, "Site Exterior Photo"), (request.sitetour, "SiteTour"),
                 })
        {
            if (json is null) continue;
            photo = Parse(json);
            if (photo is not null && string.IsNullOrEmpty(photo.name)) photo.name = defaultName;
        }
        if (photo is null || string.IsNullOrEmpty(photo.photoId)) return Fail("Invalid Photo Information.");

        var zedId = request.userName?.Trim();
        var level = request.certificationType?.Trim();
        if (string.IsNullOrEmpty(zedId) || level is null || !SiteLevels.Contains(level))
            return Refuse(zedId, level, "not a Silver/Gold unit", InvalidDetails);

        var unit = (await db.QuerySqlAsync<SurveillanceUnit>(SiteUnitSql, new
        {
            ZedId = new DbString { Value = zedId, IsAnsi = true, Length = 50 },
            Certification = new DbString { Value = level, IsAnsi = true, Length = 50 },
        }, ct)).FirstOrDefault();
        if (unit is null) return Refuse(zedId, level, "no site assessment allotted", InvalidDetails);
        if (unit.CertificationStatus is not (>= 9 and <= 13)) return Refuse(zedId, level, $"status {unit.CertificationStatus}", ClosedMessage);

        if (!await IsImageAsync(file_data, ct)) return Refuse(zedId, level, "file is not a JPEG or PNG image", "Invalid File Data.");

        var folder = storage.Folder("SaPhotos", zedId, level, "SiteTour");
        var fileName = MobileStorage.FileName(photo.photoId, ".jpg");
        var target = storage.Target(folder, fileName);
        if (System.IO.File.Exists(target))
        {
            if (!await SameContentAsync(target, file_data, ct))
                return Refuse(zedId, level, $"photo {photo.photoId} already exists", ExistsMessage);
        }
        else
        {
            try
            {
                await storage.SaveAsync(file_data, folder, fileName, ct, overwrite: false);
            }
            catch (IOException) when (System.IO.File.Exists(target))
            {
                return Refuse(zedId, level, $"photo {photo.photoId} written meanwhile", ExistsMessage);
            }
        }

        var photos = new DataTable();
        foreach (var c in new[] { "PhotoId", "Name", "TimeStamp", "Latitude", "Longitude", "PhotoType" }) photos.Columns.Add(c, typeof(string));
        photos.Rows.Add(photo.photoId, string.IsNullOrEmpty(photo.comment) ? photo.name : photo.comment, photo.timeStamp, photo.latitude, photo.longitude, "");

        var args = new DynamicParameters();
        args.Add("ZedId", zedId);
        args.Add("AssessorId", zedId); // as before: the unit itself
        args.Add("CertificationType", level);
        args.Add("PhotoType", "SiteTour");
        args.Add("PhotoList", photos.AsTableValuedParameter("DynamicPhotoList2"));
        try
        {
            var row = (await db.QueryProcMultipleAsync("SP_APP_SYNC_SUVEILLANCE_PHOTOS", args, ct)).FirstRow(0);
            if (row.Count == 0) return Fail(GenericError);
            log.LogInformation("Surveillance photo {PhotoId} for {ZedId} {Level}: {Status}", photo.photoId, zedId, level, row.Text("StatusCode"));
            return LegacyJson(new ServiceResponse { status = row.Text("StatusCode"), errorMessage = row.Text("Message") });
        }
        catch (DbException ex)
        {
            log.LogError(ex, "SP_APP_SYNC_SUVEILLANCE_PHOTOS failed for {ZedId}", zedId);
            return Fail(GenericError);
        }
    }

    private ContentResult Refuse(string? zedId, string? level, string reason, string message)
    {
        log.LogWarning("Msme/SubmitSurveillancePhoto refused for {ZedId} {Level}: {Reason}", zedId, level, reason);
        return Fail(message);
    }

    private static PhotoInformation? Parse(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<PhotoInformation>(json, Zed.Core.Mobile.LegacyJson.Read);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>JPEG (FF D8 FF) or PNG signature; the old code saved any bytes as .jpg in a public folder.</summary>
    internal static async Task<bool> IsImageAsync(IFormFile file, CancellationToken ct)
    {
        var head = await MobileStorage.HeadAsync(file, ct);
        return MobileStorage.IsImage(head);
    }

    /// <summary>Whether the stored file holds exactly the uploaded bytes (both are at most Mobile:MaxFileBytes).</summary>
    private static async Task<bool> SameContentAsync(string path, IFormFile file, CancellationToken ct)
    {
        if (new FileInfo(path).Length != file.Length) return false;
        var stored = await System.IO.File.ReadAllBytesAsync(path, ct);
        using var uploaded = new MemoryStream();
        await file.CopyToAsync(uploaded, ct);
        return stored.AsSpan().SequenceEqual(uploaded.GetBuffer().AsSpan(0, (int)uploaded.Length));
    }
}
