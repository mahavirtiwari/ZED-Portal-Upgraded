using System.Globalization;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Mobile;
using Zed.Core.Security;
using Zed.Main.MobileApi.Models;
using Zed.Main.MobileApi.Models.Assessor;

namespace Zed.Main.MobileApi.Controllers;

/// <summary>
/// 2026-11-21: Bronze surveillance in ZED SA (the ZED Surveillance app, com.qci.zed.bronzesurveillance, is retired; its
/// server calls stay for the installed copies). On the Surveillance deployment only:
/// <list type="bullet">
/// <item><see cref="BronzeSurveillance"/>: the signed-in assessor's Bronze surveillance cases, by the ZED Surveillance app's
/// login rule (<see cref="BronzeSurveillanceData.CasesSql"/>).</item>
/// <item><see cref="BronzeSurveillanceSession"/>: one of them opened with ZED SA's sign-in (its app token, device-bound)
/// instead of the password: the same answer, phone registration and "SURV" app token as Surveillance/Login
/// (<see cref="SurveillanceLogin"/>), so the unit's Surveillance/* calls are made and checked exactly as before.</item>
/// </list>
/// A desktop assessor of Bronze surveillance who is not a site assessor (no SiteVerification, which SP_APP_SA_CHECK_LOGIN
/// asks for) signs in to ZED SA on this deployment by the ZED Surveillance app's own user check (RoleId 3, active, the
/// password) when at least one such case is allotted to it (<see cref="BronzeSurveillanceUserAsync"/>).
/// </summary>
public sealed partial class SAController
{
    /// <summary>Answer on any other deployment (the calls are served on the Surveillance host only).</summary>
    internal const string BronzeOnSurveillanceOnly = "Bronze surveillance is served by the surveillance host only.";

    /// <summary>The ZED Surveillance app's refusal for a unit not allotted to the assessor (SurveillanceController.NotAllocated).</summary>
    internal const string BronzeNotAllocated = SurveillanceController.NotAllocated;

    // ------------------------------------------------------------------ Reads

    /// <summary>The assessor's Bronze surveillance cases (desktop assessor, status 1), with what the case list shows.</summary>
    [HttpPost]
    [DeviceBound(MobileApps.SiteAssessor, "saId", TokenRequired = true)]
    public Task<IActionResult> BronzeSurveillance(SaRequest request, CancellationToken ct) => Guarded(nameof(BronzeSurveillance), async () =>
    {
        if (portal.System != PortalSystem.Surveillance) return Fail(BronzeOnSurveillanceOnly);
        if (await BronzeAssessorRefusalAsync(nameof(BronzeSurveillance), request.saId, ct) is { } refused) return refused;
        return LegacyJson(new SaBronzeCasesResponse { status = "1", cases = await BronzeCasesAsync(request.saId!.Trim(), ct) });
    });

    // ------------------------------------------------------------------ Per-unit session

    /// <summary>
    /// Opens one Bronze surveillance case for ZED SA: checks that the ZED SA sign-in (token required, device-bound by the
    /// attribute) belongs to an active assessor (RoleId 3) who is the unit's desktop assessor at status 1, by
    /// SP_APP_SURVEILLANCE_CHECK_LOGIN itself (called with a password nothing matches, so its set 0 stays empty and only its
    /// unit sets 1 to 4 are used), then answers what Surveillance/Login answers for that unit and issues the "SURV" token for
    /// the assessor and the unit after the one-phone rule of app SURV. No password is asked: the ZED SA sign-in on this host
    /// checked it.
    /// </summary>
    [HttpPost]
    [DeviceBound(MobileApps.SiteAssessor, "saId", TokenRequired = true)]
    public Task<IActionResult> BronzeSurveillanceSession(SaBronzeSessionRequest request, CancellationToken ct) => Guarded(nameof(BronzeSurveillanceSession), async () =>
    {
        if (portal.System != PortalSystem.Surveillance) return Fail(BronzeOnSurveillanceOnly);
        if (await BronzeAssessorRefusalAsync(nameof(BronzeSurveillanceSession), request.saId, ct) is { } refused) return refused;
        var saId = request.saId!.Trim();
        var zedId = request.zedId?.Trim();
        if (string.IsNullOrEmpty(zedId)) return LegacyJson(new MsmeLoginResponse { status = "0", errorMessage = BronzeNotAllocated + request.zedId });

        var sets = await db.QueryProcMultipleAsync("SP_APP_SURVEILLANCE_CHECK_LOGIN",
            new { AssessorId = saId, ZedId = zedId, Password = PasswordStore.RefusedValue }, ct);
        // The ZED Surveillance app's login rule (set 4: DesktopAssessorId = the assessor, status 1; set 1: the Msme row),
        // and Bronze, the only level the app had steps for.
        MsmeLoginResponse response;
        if (SurveillanceLogin.Allotted(sets) && sets[4].Any(r => Same(r.Text("Certification"), "Bronze")))
            response = SurveillanceLogin.Answer(sets);
        else if (sets.Count >= 4 && sets[1].Count > 0 &&
                 (await db.QuerySqlAsync<BronzeSurveillanceData.CaseRow>(BronzeSurveillanceData.UnitCaseSql, new { UserId = Ansi(saId), ZedId = Ansi(zedId) }, ct))
                 .FirstOrDefault(r => r.NcRound is >= 1 and <= 5) is { } nc)
        {
            // 2026-11-21 (the owner): a unit whose NC round is open (the server already accepts its replies) opens too. The
            // procedure's button states are fixed (status 1, no NC), so the unit's own NC round is put in: the basic information
            // read-only (status 2), its NC rounds with the open one at 1, so the app offers "Non-conformances".
            response = SurveillanceLogin.Answer(sets, BronzeSurveillanceData.NcStatus(sets.FirstRow(3), nc));
        }
        else
        {
            log.LogWarning("Refused SA/BronzeSurveillanceSession: {ZedId} is not a Bronze surveillance case of {SaId}", zedId, saId);
            return LegacyJson(new MsmeLoginResponse { status = "0", errorMessage = BronzeNotAllocated + zedId });
        }

        if (await SurveillanceLogin.StartAsync(HttpContext, devices, mobile.Value, tokens, saId, zedId, request.deviceInfo, request.version,
                response, log, ct) is { } phone)
            return LegacyJson(new MsmeLoginResponse { status = "0", errorMessage = phone });
        log.LogInformation("ZED SA Bronze surveillance session for {UserId} on {ZedId}", saId, zedId);
        return LegacyJson(response);
    });

    // ------------------------------------------------------------------ Helpers

    /// <summary>The cases of <paramref name="saId"/> (<see cref="BronzeSurveillanceData.CasesSql"/>).</summary>
    private async Task<List<SaBronzeCase>> BronzeCasesAsync(string saId, CancellationToken ct) =>
        (await db.QuerySqlAsync<BronzeSurveillanceData.CaseRow>(BronzeSurveillanceData.CasesSql, new { UserId = Ansi(saId) }, ct))
        .Select(BronzeSurveillanceData.Case).ToList();

    /// <summary>
    /// The sign-in of a Bronze surveillance desktop assessor without site verification (Surveillance deployment, no ZED ID):
    /// set 0 of SP_APP_SURVEILLANCE_CHECK_LOGIN (Users: RoleId 3, active, the password), the user check of Surveillance/Login,
    /// when at least one Bronze surveillance case is allotted to it, which the old login also asked for. Null otherwise. The
    /// caller makes the password and role checks on the row as for any sign-in.
    /// </summary>
    private async Task<IDictionary<string, object?>?> BronzeSurveillanceUserAsync(string assessorId, string procedurePassword, CancellationToken ct)
    {
        if (portal.System != PortalSystem.Surveillance) return null;
        var sets = await db.QueryProcMultipleAsync("SP_APP_SURVEILLANCE_CHECK_LOGIN",
            new { AssessorId = assessorId, ZedId = (string?)null, Password = procedurePassword }, ct);
        var user = sets.Count > 0 ? sets[0].FirstOrDefault() : null;
        if (user is null) return null;
        var key = user.Text("UserId") is { Length: > 0 } id ? id : assessorId;
        return (await BronzeCasesAsync(key, ct)).Count > 0 ? user : null;
    }

    /// <summary>
    /// The checks of the Bronze reads behind the token: the Users row must still be an active assessor (RoleId 3; the ZED
    /// Surveillance app's own condition), else the app is signed out. Null when the call may go on.
    /// </summary>
    private async Task<IActionResult?> BronzeAssessorRefusalAsync(string action, string? saId, CancellationToken ct)
    {
        var user = string.IsNullOrWhiteSpace(saId) ? null
            : (await db.QuerySqlAsync<SaAppData.UserRow>(SaAppData.AssessorSql, new { UserId = Ansi(saId.Trim()) }, ct)).FirstOrDefault();
        if (user is { RoleId: 3, IsActive: true }) return null;
        log.LogWarning("Refused SA/{Action}: {SaId} is not an active assessor", action, saId);
        return Fail(AppTokens.ExpiredMessage);
    }

    /// <summary>
    /// The dashboard reads (<see cref="AssessorRefusalAsync"/>) on the Surveillance deployment also let in an active assessor
    /// without site verification who has a Bronze surveillance case (the one <see cref="BronzeSurveillanceUserAsync"/> signed in).
    /// </summary>
    private async Task<bool> IsBronzeSurveillanceAssessorAsync(SaAppData.UserRow? user, CancellationToken ct) =>
        portal.System == PortalSystem.Surveillance && user is { RoleId: 3, IsActive: true, UserId: { Length: > 0 } id }
        && (await BronzeCasesAsync(id.Trim(), ct)).Count > 0;
}

/// <summary>The query and mapping of ZED SA's Bronze surveillance cases (ZED_SURVEILLANCE; legacy tables and columns only).</summary>
public static class BronzeSurveillanceData
{
    /// <summary>
    /// The ZED Surveillance app's login rule for a unit (SP_APP_SURVEILLANCE_CHECK_LOGIN set 4: MsmeCertifications with
    /// DesktopAssessorId = the assessor and CertificationStatus = 1; set 1: the unit's Msme row, without which the login was
    /// refused) for every unit at once, Bronze only (the only level the app had steps for).
    /// </summary>
    public const string CasesSql = "SELECT TOP (200)" + Select + "\n" + Where + "\nORDER BY C.ZedId;";

    /// <summary>One unit of <see cref="CasesSql"/> (the session exchange's check of a unit in its NC round).</summary>
    public const string UnitCaseSql = "SELECT TOP (1)" + Select + "\n" + Where + " AND C.ZedId = @ZedId;";

    private const string Select = """
         C.ZedId, C.Certification, C.CertificationStatus, ISNULL(C.CertificationStatusDate, C.CreatedDate) AS StatusDate,
               ISNULL(B.EnterpriseName, M.EnterpriseName) AS EnterpriseName, M.PUnitName AS UnitName, M.PAddress AS Address,
               M.PDistrictName AS District, M.PStateName AS State, M.PPin AS Pincode,
               C.NcCount, C.Nc1Status, C.Nc2Status, C.Nc3Status, C.Nc4Status, C.Nc5Status,
               CASE WHEN C.CertificationStatus IN (4, 14) AND C.NcCount BETWEEN 1 AND 5 THEN C.NcCount END AS NcRound
        FROM dbo.MsmeCertifications C
        CROSS APPLY (SELECT TOP (1) EnterpriseName, PUnitName, PAddress, PDistrictName, PStateName, PPin FROM dbo.Msme WHERE ZedId = C.ZedId) M
        OUTER APPLY (SELECT TOP (1) EnterpriseName FROM dbo.MsmeBasicInformation WHERE ZedId = C.ZedId) B
        """;

    /// <summary>
    /// Status 1 (with the desktop assessor before the final submit, the old login's rule) or, 2026-11-21 (the owner), an open NC
    /// round as the Surveillance/* writes accept it (SurveillanceUnit.NcOpen: NC 1 to 5, that round's status 1, status 4 or 14).
    /// </summary>
    private const string Where = """
        WHERE C.DesktopAssessorId = @UserId AND C.Certification = 'Bronze'
          AND (C.CertificationStatus = 1 OR (C.CertificationStatus IN (4, 14) AND C.NcCount BETWEEN 1 AND 5
               AND CASE C.NcCount WHEN 1 THEN C.Nc1Status WHEN 2 THEN C.Nc2Status WHEN 3 THEN C.Nc3Status
                                  WHEN 4 THEN C.Nc4Status WHEN 5 THEN C.Nc5Status END = 1))
        """;

    /// <summary>
    /// The button states of a unit in its NC round: the procedure's row with Bronze's status and NC rounds from the unit's
    /// record (status 2: basic information read-only; each round's status, the open one 1; a short text per round).
    /// </summary>
    public static Dictionary<string, object?> NcStatus(IDictionary<string, object?>? procedureRow, CaseRow unit)
    {
        var st = new Dictionary<string, object?>(procedureRow ?? new Dictionary<string, object?>(), StringComparer.OrdinalIgnoreCase)
        {
            ["BronzeStatus"] = 2,
            ["BronzeStatusOfNc"] = unit.NcCount ?? 0,
        };
        int?[] rounds = [unit.Nc1Status, unit.Nc2Status, unit.Nc3Status, unit.Nc4Status, unit.Nc5Status];
        for (var n = 1; n <= 5; n++)
        {
            var s = n <= (unit.NcCount ?? 0) ? rounds[n - 1] ?? 0 : 0;
            st[$"BronzeStatusOfNc{n}"] = s;
            st[$"Nc{n}StatusTextBronze"] = s == 1 ? "Raised: please reply" : s == 0 ? "" : "Replied";
        }
        return st;
    }

    public sealed class CaseRow
    {
        public string? ZedId { get; init; }
        public string? Certification { get; init; }
        public int? CertificationStatus { get; init; }
        public DateTime? StatusDate { get; init; }
        public string? EnterpriseName { get; init; }
        public string? UnitName { get; init; }
        public string? Address { get; init; }
        public string? District { get; init; }
        public string? State { get; init; }
        public string? Pincode { get; init; }
        public int? NcCount { get; init; }
        public int? Nc1Status { get; init; }
        public int? Nc2Status { get; init; }
        public int? Nc3Status { get; init; }
        public int? Nc4Status { get; init; }
        public int? Nc5Status { get; init; }
        /// <summary>The open NC round (status 4 or 14), else null.</summary>
        public int? NcRound { get; init; }
    }

    private static string? Clean(string? v) => string.IsNullOrWhiteSpace(v) ? null : v.Trim();

    public static SaBronzeCase Case(CaseRow r) => new()
    {
        zedId = Clean(r.ZedId),
        certificationType = Clean(r.Certification),
        enterpriseName = Clean(r.EnterpriseName),
        unitName = Clean(r.UnitName),
        address = Clean(r.Address),
        district = Clean(r.District),
        state = Clean(r.State),
        pincode = Clean(r.Pincode),
        status = r.CertificationStatus ?? 0,
        statusDate = r.StatusDate?.ToString("yyyy-MM-dd'T'HH:mm:ss", CultureInfo.InvariantCulture),
        ncRound = r.NcRound,
    };
}
