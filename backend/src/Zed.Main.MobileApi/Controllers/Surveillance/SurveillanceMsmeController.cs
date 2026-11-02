using Dapper;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Mobile;
using Zed.Main.MobileApi.Models;

namespace Zed.Main.MobileApi.Controllers;

/// <summary>
/// The unit's own replies to the NC of a Bronze surveillance (old SurveillanceServices MsmeController, the calls of the
/// MSME app's "Surveillance Assessment" option at surveillance status 3): <c>Msme/GetMsmeStatus</c>,
/// <c>GetNcDetailsByType</c>, <c>SubmitNcRequirement</c>, <c>SubmitNcProduct</c>, <c>SubmitSiteExteriorInfo</c> and
/// <c>FinalSubmit</c> (the NC close: <c>Nc{n}Status = 2</c>, for the desktop assessor's review), on ZED_SURVEILLANCE with
/// the request and response formats of the main deployment's MsmeController. Served by the Surveillance deployment
/// only; nothing else of the MSME app is (<see cref="SurveillancePhotoController"/> keeps its one address).
/// <para>
/// The MSME signs in on Main, so every call must carry the MSME app's token issued by Main for this ZED ID
/// (<see cref="AppTokens.IssuedByRefusalAsync"/>; always enforced): both mobile hosts need the same
/// <c>Mobile:AppTokenKey</c>, and the session stamp is read from main's database (<c>ConnectionStrings:Main</c>, read
/// only). The device binding is not checked: the MSME's devices are recorded in main's database at login, and the
/// token already proves that sign-in. Writes are accepted only while the unit's current surveillance NC is open
/// (<see cref="SurveillanceUnit.NcOpen"/>: status 4 or 14, NC 1 to 5, that round's status 1).
/// </para>
/// </summary>
[PortalSystems(PortalSystem.Surveillance)]
[Route("Msme/[action]")]
public sealed class SurveillanceMsmeController(
    ISqlExecutor db,
    IOptions<MobileOptions> options,
    AppTokens tokens,
    IConfiguration config,
    ILogger<SurveillanceMsmeController> log) : SurveillanceControllerBase
{
    private const string UpdateAppMessage = "Download new app from store.";

    private protected override ISqlExecutor Db => db;
    private protected override ILogger Log => log;
    private protected override string LogArea => "Msme";

    /// <summary>Legacy checkMsmeVersion: status "2" tells the app to update.</summary>
    private ContentResult? VersionCheck(string? version) =>
        options.Value.CheckMsmeVersion && !string.Equals(options.Value.MsmeVersion, version, StringComparison.Ordinal)
            ? LegacyJson(new ServiceResponse { status = "2", errorMessage = UpdateAppMessage })
            : null;

    /// <summary>
    /// SP_APP_MSME_STATUS of ZED_SURVEILLANCE: the button states of the surveillance round (the app keeps them apart from
    /// main's, as msmeSurveillanceStatus); its NC statuses decide which NC the app opens.
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> GetMsmeStatus(string? userName, string? version, CancellationToken ct)
    {
        var zedId = userName?.Trim();
        if (string.IsNullOrEmpty(zedId)) return LegacyJson(new MsmeStatus { status = "0", errorMessage = "Invalid ZED ID." });
        if (await TokenRefusalAsync(zedId, ct) is { } expired) return expired;

        var row = (await db.QueryProcMultipleAsync("SP_APP_MSME_STATUS", new { ZedId = zedId }, ct)).FirstRow(0);
        // The procedure always returns a row; its columns are NULL for a unit that is not in this database.
        if (row.Count == 0 || !row.TryGetValue("BronzeStatus", out var bronze) || bronze is null or DBNull)
            return LegacyJson(new MsmeStatus { status = "0", errorMessage = "Invalid ZED ID." });
        var status = MsmeController.StatusFrom(row);
        status.status = "1";
        return LegacyJson(status);
    }

    [HttpPost]
    public async Task<IActionResult> GetNcDetailsByType(string? userName, string? certificationType, string? version, string? ncCount, CancellationToken ct)
    {
        if (VersionCheck(version) is { } update) return update;
        var (unit, refused) = await UnitAsync(nameof(GetNcDetailsByType), userName, certificationType, ncOpen: false, ct);
        if (refused is not null) return refused;
        return await NcDetailsAsync(userName!.Trim(), unit!.Certification?.Trim(), ncCount, ct);
    }

    /// <summary>One evidence photo for a requirement of the open NC (one request per photo, isFirst / isLast).</summary>
    [HttpPost]
    public async Task<IActionResult> SubmitNcRequirement(NcRequirementSubmitRequest request, IFormFile? file_data, CancellationToken ct)
    {
        var zedId = request.userName?.Trim() ?? "";
        var (_, refused) = await UnitAsync(nameof(SubmitNcRequirement), zedId, request.certificationType, ncOpen: true, ct);
        if (refused is not null) return refused;
        return await SaveNcRequirementAsync(nameof(SubmitNcRequirement), zedId, request, file_data, ct);
    }

    /// <summary>New product photos for the open NC (productDetailsNc = ProductDetails JSON; files = the photo files).</summary>
    [HttpPost]
    public async Task<IActionResult> SubmitNcProduct(NcProductSubmitRequest request, List<IFormFile>? files, CancellationToken ct)
    {
        request.productDetailsNcObj = ParseEmbedded<ProductDetails>(request.productDetailsNc);
        var product = request.productDetailsNcObj;
        if (product is null) return Fail(NoDataFound);
        if (files is not { Count: > 0 }) return Fail(NoPhotosFound);

        var zedId = request.userName?.Trim() ?? "";
        var (_, refused) = await UnitAsync(nameof(SubmitNcProduct), zedId, request.certificationType, ncOpen: true, ct);
        if (refused is not null) return refused;
        return await SaveNcProductAsync(zedId, request, product, files, ct);
    }

    /// <summary>New site exterior photos for the open NC (SP_APP_MSME_INSERT_SITE_EXTERIOR).</summary>
    [HttpPost]
    public async Task<IActionResult> SubmitSiteExteriorInfo(NcSiteSubmitRequest request, CancellationToken ct)
    {
        var zedId = request.userName?.Trim() ?? "";
        var (_, refused) = await UnitAsync(nameof(SubmitSiteExteriorInfo), zedId, request.certificationType, ncOpen: true, ct);
        if (refused is not null) return refused;
        return await SaveNcSiteExteriorAsync(zedId, request, ct);
    }

    /// <summary>
    /// The NC close (old SaveFinalSubmit of the surveillance MsmeController): the photo check of
    /// SP_ASSESSMENT_CHECK_NC_PHOTO_AVAILABILITY, then SP_APP_MSME_FINAL_SUBMIT, which at NcCount &gt; 0 sets the current
    /// round's Nc{n}Status to 2 (the status stays 4: the desktop assessor reviews the reply on the web), and the NC reply
    /// mail. Only while that NC is open; the surveillance answers of the assessor's final submit are not asked here.
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> FinalSubmit(BaseServiceRequest request, CancellationToken ct)
    {
        var zedId = request.userName?.Trim() ?? "";
        var (unit, refused) = await UnitAsync(nameof(FinalSubmit), zedId, request.certificationType, ncOpen: true, ct);
        if (refused is not null) return refused;

        var certification = unit!.Certification!.Trim();
        var args = new { CertificationType = certification, ZedId = zedId };
        if (await PhotosNotSyncedAsync(args, ct) is { } missing) return Fail(missing);
        var error = await TryExecuteAsync("SP_APP_MSME_FINAL_SUBMIT", args, ct);
        if (error is not null) return Fail(error);
        log.LogInformation("Surveillance NC {NcCount} closed from the MSME app for {ZedId} {Certification}", unit.NcCount, zedId, certification);

        await SendSubmissionMailAsync(zedId, certification, ct);
        return LegacyJson(new ServiceResponse { status = "1" });
    }

    // ------------------------------------------------------------------ Per-call checks

    /// <summary>
    /// The checks behind every call but GetMsmeStatus: the MSME app's token for this ZED ID (<see cref="TokenRefusalAsync"/>),
    /// the unit's surveillance row for the level, and for <paramref name="ncOpen"/> its current NC open. Returns the
    /// row, or the refusal to answer with ("Invalid Details.", or the token refusal).
    /// </summary>
    private async Task<(SurveillanceUnit? Unit, IActionResult? Refused)> UnitAsync(string action, string? zedId, string? certification, bool ncOpen,
        CancellationToken ct)
    {
        zedId = zedId?.Trim();
        if (string.IsNullOrEmpty(zedId)) return (null, Refuse(action, zedId, certification, "no ZED ID", InvalidDetails));
        if (await TokenRefusalAsync(zedId, ct) is { } expired) return (null, expired);

        var rows = await db.QuerySqlAsync<SurveillanceUnit>(SurveillanceController.UnitSql,
            new { ZedId = new DbString { Value = zedId, IsAnsi = true, Length = 50 } }, ct);
        var unit = rows.FirstOrDefault(r => !string.IsNullOrWhiteSpace(certification) &&
                                            string.Equals(r.Certification?.Trim(), certification.Trim(), StringComparison.OrdinalIgnoreCase));
        if (unit is null) return (null, Refuse(action, zedId, certification, "no surveillance of this level", InvalidDetails));
        if (ncOpen && !unit.NcOpen)
            return (null, Refuse(action, zedId, certification, $"stage {unit.CertificationStatus}/NC {unit.NcCount}:{unit.CurrentNcStatus}", InvalidDetails));
        return (unit, null);
    }

    /// <summary>The MSME app's token, issued by Main for this unit; null when it is valid, else the refusal (the app signs out).</summary>
    private Task<IActionResult?> TokenRefusalAsync(string zedId, CancellationToken ct) =>
        tokens.IssuedByRefusalAsync(HttpContext, PortalSystem.Main, MainDatabase(), MobileApps.Msme, user: null, unit: zedId, ct);

    /// <summary>
    /// Main's database for the token's session stamp: a keyed "Main" executor, else <c>ConnectionStrings:Main</c> with
    /// read intent (only the SELECT of SessionStamps runs there; the same connection the assessors' login uses), else null.
    /// </summary>
    private ISqlExecutor? MainDatabase()
    {
        if (HttpContext.RequestServices.GetKeyedService<ISqlExecutor>(ZedDatabases.Main) is { } keyed) return keyed;
        if (config.GetConnectionString(ZedDatabases.Main) is not { Length: > 0 } cs) return null;
        return new SqlExecutor(new SqlConnectionStringBuilder(cs) { ApplicationIntent = ApplicationIntent.ReadOnly }.ConnectionString);
    }
}
