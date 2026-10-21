using System.Data;
using System.Globalization;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Portal.Features.Msme;

namespace Zed.Portal.Features.ExternalApi;

/// <summary>
/// Certification lookups that other systems call at the old MsmeController addresses (Msme/…):
/// by Udyam + certificate number, by ZED ID + e-mail, several at once, the certified-units list and the
/// Andhra Pradesh state list. Static tokens (ApiClientTokens, ClientId NULL) or tokens from GenerateToken,
/// exactly where the old action used them. Certificates are read from <see cref="PortalOptions.StorageRoot"/>
/// instead of being downloaded from the public site.
/// </summary>
[ExternalApiErrors(ExternalApiErrorsAttribute.Plain500)]
public sealed class CertificationLookupController(
    ISqlExecutor db,
    IWebHostEnvironment env,
    IOptions<PortalOptions> portal,
    ILogger<CertificationLookupController> log) : ExternalApiController
{
    private ApiClients Clients => new(db, Options);

    private static ContentResult InvalidToken => LegacyJson(ApiServiceResponse.Status("401", "Invalid Token."));
    private static ContentResult NotFoundBody => LegacyJson(ApiServiceResponse.Status("404", "Invalid Details."));
    private static ContentResult BadRequestBody => LegacyJson(ApiServiceResponse.Status("400", "Bad Request"));

    /// <summary>Msme/DownloadCertificate (any verb): the latest certificate PDF, or HTTP 401/404/500 as before.</summary>
    [Route("/Msme/DownloadCertificate")]
    public async Task<IActionResult> DownloadCertificate(string? token, string? udyamNumber, string? certificationNumber, CancellationToken ct)
    {
        if (await Clients.StaticAsync(token, StaticTokenScope.WithoutClientId, ct) is not { } caller) return StatusCode(StatusCodes.Status401Unauthorized);
        if (!SafeInput.AllOk(50, udyamNumber, certificationNumber)) return StatusCode(StatusCodes.Status400BadRequest);

        var ds = await UnitByUdyamAsync(udyamNumber, certificationNumber, ct);
        log.LogInformation("Msme/DownloadCertificate by {Client}: {Udyam} {Found}", caller.Client, udyamNumber, ds[0].Count > 0);
        if (ds[0].Count == 0) return StatusCode(StatusCodes.Status404NotFound);

        // The old action fetched {site}/certifications/{DA|SA}/{ZedId}/{Level}.pdf and answered 500 when that failed.
        var file = CertificateFile(ds, "Certifications");
        if (file is null) return StatusCode(StatusCodes.Status500InternalServerError);
        return PhysicalFile(file, "application/pdf", (certificationNumber ?? "certificate") + ".pdf");
    }

    /// <summary>Msme/GetZedDetails (any verb): unit, plant, activity and levels by ZED ID and pledge e-mail.</summary>
    [Route("/Msme/GetZedDetails")]
    public async Task<IActionResult> GetZedDetails(string? token, string? email, string? zedid, CancellationToken ct)
    {
        if (await Clients.StaticAsync(token, StaticTokenScope.WithoutClientId, ct) is not { } caller) return InvalidToken;
        if (!SafeInput.Ok(zedid, 50) || !SafeInput.Ok(email, 500)) return BadRequestBody;

        var ds = await db.QueryProcMultipleAsync("SP_API_GET_CERTIFIED_UNIT_DETAILS", new { ZedId = zedid, Email = email }, ct);
        log.LogInformation("Msme/GetZedDetails by {Client}: {ZedId} {Found}", caller.Client, zedid, ds[0].Count > 0);
        if (ds[0].Count == 0) return NotFoundBody;

        var unit = ds[0][0];
        var basic = ds[1].FirstOrDefault() ?? new Dictionary<string, object?>();
        var levels = ds[2].FirstOrDefault() ?? new Dictionary<string, object?>();
        return LegacyJson(new ApiServiceResponse
        {
            StatusCode = "200",
            BasicDetails = Basic(unit, basic),
            PlantDetails = Plant(unit),
            ActivityDetails = Activity(unit),
            CertificationDetails = new CertificationDetailsApi
            {
                RegisteredDate = levels.Text("RegisteredDate"),
                BronzeCertified = levels.Text("BronzeCertified"),
                SilverCertified = levels.Text("SilverCertified"),
                GoldCertified = levels.Text("GoldCertified"),
            },
        });
    }

    /// <summary>Msme/GetZedDetailsByUdyam (any verb): as GetZedDetails by Udyam + certificate number, with the certificate as base64.</summary>
    [Route("/Msme/GetZedDetailsByUdyam")]
    public async Task<IActionResult> GetZedDetailsByUdyam(string? token, string? udyamNumber, string? certificationNumber, CancellationToken ct)
    {
        if (await Clients.StaticAsync(token, StaticTokenScope.WithoutClientId, ct) is not { } caller) return InvalidToken;
        if (!SafeInput.AllOk(50, udyamNumber, certificationNumber)) return BadRequestBody;

        var ds = await UnitByUdyamAsync(udyamNumber, certificationNumber, ct);
        log.LogInformation("Msme/GetZedDetailsByUdyam by {Client}: {Udyam} {Found}", caller.Client, udyamNumber, ds[0].Count > 0);
        if (ds[0].Count == 0) return NotFoundBody;

        var unit = ds[0][0];
        var basic = ds[1].FirstOrDefault() ?? new Dictionary<string, object?>();
        var levels = ds[2].FirstOrDefault() ?? new Dictionary<string, object?>();
        var response = new ApiServiceResponse
        {
            StatusCode = "200",
            BasicDetails = Basic(unit, basic),
            PlantDetails = Plant(unit),
            ActivityDetails = Activity(unit),
            CertificationDetails = new CertificationDetailsApi
            {
                RegisteredDate = levels.Text("RegisteredDate"),
                ExpiryDate = levels.Text("ExpiryDate"),
                BronzeCertified = levels.Text("BronzeCertified"),
                SilverCertified = levels.Text("SilverCertified"),
                GoldCertified = levels.Text("GoldCertified"),
            },
        };
        // Old: ~/Certificates/{DA|SA}/{ZedId}/{Level}.pdf on the web server's disk; missing file = no Certificate.
        if (CertificateFile(ds, "Certificates") is { } file)
            response.CertificationDetails.Certificate = Convert.ToBase64String(await System.IO.File.ReadAllBytesAsync(file, ct));
        return LegacyJson(response);
    }

    /// <summary>Msme/GetDetailsByUdyam (any verb, static token): plant and certification summary.</summary>
    [Route("/Msme/GetDetailsByUdyam")]
    public async Task<IActionResult> GetDetailsByUdyam(string? token, string? udyamNumber, string? certificationNumber, CancellationToken ct)
    {
        if (await Clients.StaticAsync(token, StaticTokenScope.WithoutClientId, ct) is not { } caller) return InvalidToken;
        return await Details3Async("Msme/GetDetailsByUdyam", caller, udyamNumber, certificationNumber, ct);
    }

    /// <summary>Msme/GetDetailsByCertification (POST, token from Token/GenerateToken): as GetDetailsByUdyam.</summary>
    [HttpPost("/Msme/GetDetailsByCertification")]
    public async Task<IActionResult> GetDetailsByCertification(string? token, string? udyamNumber, string? certificationNumber, CancellationToken ct)
    {
        if (await Clients.DynamicAsync(token, ct) is not { } caller) return InvalidToken;
        return await Details3Async("Msme/GetDetailsByCertification", caller, udyamNumber, certificationNumber, ct);
    }

    /// <summary>Msme/GetDetailsByCertifications (POST): several Udyam + certificate pairs at once.</summary>
    [HttpPost("/Msme/GetDetailsByCertifications")]
    public async Task<IActionResult> GetDetailsByCertifications(string? token, List<UdyamCertificationNumber>? udyamNumbers, CancellationToken ct)
    {
        if (await Clients.DynamicAsync(token, ct) is not { } caller)
            return LegacyJson(new ApiServiceResponseMultiCert { StatusCode = "401", StatusMessage = "Invalid Token." });
        var pairs = udyamNumbers ?? [];
        if (pairs.Count > 1000 || pairs.Any(p => !SafeInput.AllOk(100, p.UdyamNumber, p.CertificationNumber)))
            return LegacyJson(new ApiServiceResponseMultiCert { StatusCode = "400", StatusMessage = "Bad Request" });

        var args = new DynamicParameters();
        args.Add("Token", token);
        if (pairs.Count > 0)
        {
            var table = new DataTable();
            table.Columns.Add("UdyamNumber", typeof(string));
            table.Columns.Add("CertificationNumber", typeof(string));
            foreach (var p in pairs) table.Rows.Add(p.UdyamNumber, p.CertificationNumber);
            args.Add("ParametersTable", table.AsTableValuedParameter("UdyamAndCertificates"));
        }

        var ds = await db.QueryProcMultipleAsync("SP_API_GET_CERTIFIED_UNIT_DETAILS_BY_MULTIPLE_UDYAMS", args, ct);
        log.LogInformation("Msme/GetDetailsByCertifications by {Client}: {Count} pairs, {Found} found", caller.Client, pairs.Count, ds[1].Count);
        if (ds[0].Count == 0) return LegacyJson(new ApiServiceResponseMultiCert { StatusCode = "401", StatusMessage = "Invalid Token." });
        if (ds[1].Count == 0) return LegacyJson(new ApiServiceResponseMultiCert { StatusCode = "404", StatusMessage = "Invalid Details." });

        return LegacyJson(new ApiServiceResponseMultiCert
        {
            StatusCode = "200",
            certifications = ds[1].Select(r => new MultiCertificationDetailsApi
            {
                UnitName = r.Text("PUnitName"), StateName = r.Text("PStateName"), DistrictName = r.Text("PDistrictName"),
                UdyamNo = r.Text("UdyamNo"), CertificateNo = r.Text("CertificateNo"), CertificationType = r.Text("CertificationType"),
                CertificationStatusDate = r.Text("CertificationStatusDate"), Expired = r.Text("Expired"),
            }).ToList(),
        });
    }

    /// <summary>Msme/GetCertifiedUnits (any verb, static token): public list of certified units, filtered and paged.</summary>
    [Route("/Msme/GetCertifiedUnits")]
    public async Task<IActionResult> GetCertifiedUnits(string? token, string? state, string? msmeSize, string? sector, string? certification,
        string? pageNo, string? pageSize, CancellationToken ct)
    {
        if (await Clients.StaticAsync(token, StaticTokenScope.WithoutClientId, ct) is not { } caller)
            return LegacyJson(new ApiCertifiedUnitsServiceResponse { StatusCode = "401", StatusMessage = "Invalid Token." });
        if (!SafeInput.AllOk(100, state, msmeSize, sector, certification) || !Number(pageNo, out var no) || !Number(pageSize, out var size))
            return LegacyJson(new ApiCertifiedUnitsServiceResponse { StatusCode = "400", StatusMessage = "Bad Request" });

        var ds = await db.QueryProcMultipleAsync("SP_API_GET_LIST_OF_CERTIFIED_MSME", new
        {
            State = Blank(state), MsmeSize = Blank(msmeSize), Sector = Blank(sector), CertificationType = Blank(certification),
            PageNo = no, NoOfRecords = size,
        }, ct);
        log.LogInformation("Msme/GetCertifiedUnits by {Client}: page {Page}, {Count} rows", caller.Client, no, ds[0].Count);
        if (ds[0].Count == 0) return LegacyJson(new ApiCertifiedUnitsServiceResponse { StatusCode = "404", StatusMessage = "Invalid Details." });

        var paging = ds[1].FirstOrDefault() ?? new Dictionary<string, object?>();
        return LegacyJson(new ApiCertifiedUnitsServiceResponse
        {
            StatusCode = "200",
            PageNo = Int(paging.Text("PageNo")),
            PageSize = Int(paging.Text("NoOfRecords")),
            TotalRecords = Int(paging.Text("TotalCounts")),
            Data = ds[0].Select(r => new CertifiedUnitDetails
            {
                Sno = r.Text("Sno"), EnterpriseName = r.Text("EnterpriseName"), TwoDigitActivity = r.Text("TwoDigitActivity"),
                UnitAddress = r.Text("UnitAddress"), StateName = r.Text("StateName"), EnterpriseTypee = r.Text("EnterpriseTypee"),
                Certification = r.Text("Certification"),
            }).ToList(),
        });

        // MVC passed the text to the procedure; empty meant "not given" (the procedure's defaults).
        static bool Number(string? s, out int? value)
        {
            value = null;
            if (string.IsNullOrWhiteSpace(s)) return true;
            if (!int.TryParse(s, NumberStyles.None, CultureInfo.InvariantCulture, out var n) || n < 1) return false;
            value = n;
            return true;
        }
    }

    /// <summary>
    /// Msme/GetStateCertificationsByPage (POST, token from GenerateToken): Andhra Pradesh's certification and
    /// handholding applications with fees and state subsidy (SP_API_GET_STATE_CERTIFIED_UNIT_DETAILS).
    /// </summary>
    [HttpPost("/Msme/GetStateCertificationsByPage")]
    public async Task<IActionResult> GetStateCertificationsByPage(string? token, string? applicationType, int? pageNo, int? pageSize, CancellationToken ct)
    {
        if (await Clients.DynamicAsync(token, ct) is not { } caller) return InvalidToken;
        if (!SafeInput.Ok(applicationType, 50) || pageNo is < 1 || pageSize is < 1) return BadRequestBody;

        var ds = await db.QueryProcMultipleAsync("SP_API_GET_STATE_CERTIFIED_UNIT_DETAILS", new
        {
            DynamicToken = token, ApplicationType = applicationType, PageNo = pageNo, PageSize = pageSize,
        }, ct);
        if (ds[0].Count == 0) return InvalidToken;
        var status = ds[1].FirstOrDefault();
        if (status is null) return LegacyJson(ApiServiceResponse.Status("500"));
        if (status.Text("StatusCode") != "200") return LegacyJson(ApiServiceResponse.Status(status.Text("StatusCode"), status.Text("StatusMessage")));

        var paging = ds[3].FirstOrDefault() ?? new Dictionary<string, object?>();
        log.LogInformation("Msme/GetStateCertificationsByPage by {Client}: {Type} page {Page}, {Count} rows", caller.Client, applicationType, pageNo, ds[2].Count);
        return LegacyJson(new StateCertificationsResponse
        {
            StatusCode = "200",
            PageNo = pageNo ?? Int(paging.Text("PageNo")),
            PageSize = pageSize ?? Int(paging.Text("PageSize")),
            TotalCount = Int(paging.Text("TotalCount")),
            certifications = ds[2].Select(r => new ApCertificationDetails
            {
                RefId = r.Text("RefId"), EnterpriseName = r.Text("EnterpriseName"), UdyamNumber = r.Text("UdyamNumber"),
                PlantId = r.Text("PlantId"), Applicationtype = r.Text("Applicationtype"), ApplicationPaymentDate = r.Text("ApplicationPaymentDate"),
                CertificateNumber = r.Text("CertificateNumber"), CertificationType = r.Text("CertificationType"),
                CertifiedDate = r.Text("CertifiedDate"), CertificateExpiryDate = r.Text("CertificateExpiryDate"), MileStone = r.Text("MileStone"),
                State = r.Text("State"), District = r.Text("District"), PlantAddress = r.Text("PlantAddress"),
                ApplicationStatus = r.Text("ApplicationStatus"),
                // The old code multiplied the fee by the page number (so page 2 showed double fees).
                ApplicationFee = Math.Round(Dec(r, "ApplicationFee"), 2),
                JoiningReward = r.Text("JoiningReward"),
                CentralGovernmentSubsidyPercentage = Math.Round(Dec(r, "CentralGovernmentSubsidyPercentage"), 2),
                AndhraPradeshGovernmentSubsidyPercentage = Math.Round(Dec(r, "AndhraPradeshGovernmentSubsidyPercentage"), 2),
                AndhraPradeshGovernmentSubsidyAmount = Math.Round(Dec(r, "AndhraPradeshGovernmentSubsidyAmount"), 2),
            }).ToList(),
        });
    }

    // ----- shared -----

    private async Task<IActionResult> Details3Async(string api, ApiCaller caller, string? udyamNumber, string? certificationNumber, CancellationToken ct)
    {
        if (!SafeInput.AllOk(50, udyamNumber, certificationNumber)) return BadRequestBody;
        var ds = await UnitByUdyamAsync(udyamNumber, certificationNumber, ct);
        log.LogInformation("{Api} by {Client}: {Udyam} {Found}", api, caller.Client, udyamNumber, ds[0].Count > 0);
        if (ds[0].Count == 0) return NotFoundBody;
        var (plant, certification) = CertificationLookups.Details3(ds);
        return LegacyJson(new ApiServiceResponse3 { StatusCode = "200", PlantDetails = plant, CertificationDetails = certification });
    }

    private Task<ResultSets> UnitByUdyamAsync(string? udyamNumber, string? certificationNumber, CancellationToken ct) =>
        db.QueryProcMultipleAsync("SP_API_GET_CERTIFIED_UNIT_DETAILS_BY_UDYAM",
            new { UdyamNumber = udyamNumber, CertificationNumber = certificationNumber }, ct);

    /// <summary>{root}/{DA|SA}/{ZedId}/{Bronze|Silver|Gold}.pdf for the highest level, under the storage root; null if missing.</summary>
    private string? CertificateFile(ResultSets ds, string root)
    {
        var zedId = ds[1].FirstOrDefault()?.Text("ZedId") ?? "";
        var levels = ds[2].FirstOrDefault();
        if (!CertificationLookups.IsZedId(zedId) || levels is null) return null;
        var relative = levels.Text("GoldCertified") == "Yes" ? $"{root}/SA/{zedId}/Gold.pdf"
            : levels.Text("SilverCertified") == "Yes" ? $"{root}/SA/{zedId}/Silver.pdf"
            : levels.Text("BronzeCertified") == "Yes" ? $"{root}/DA/{zedId}/Bronze.pdf"
            : null;
        return relative is null ? null : CertificationLookups.FindStoredFile(env, portal.Value, relative);
    }

    private static BasicDetailsApi Basic(IDictionary<string, object?> unit, IDictionary<string, object?> b) => new()
    {
        ApplicationId = b.Text("ApplicationId"), UdyogAadharNo = b.Text("UdyogAadharNo"), OwnerName = b.Text("OwnerName"),
        EnterpriseName = b.Text("EnterpriseName"), OrganisationType = b.Text("OrganisationTypeName"), SocialCategory = b.Text("SocialCategoryName"),
        Gender = b.Text("Gender"), PH = b.Text("PH"), PanNo = b.Text("PanNo"), Address = b.Text("Address"), state_name = b.Text("StateName"),
        DISTRICT_NAME = b.Text("DistrictName"), LG_DT_Code = b.Text("LgDistrictCode"), PINCode = b.Text("PinCode"),
        MobileNo = b.Text("MobileNo"), EmailId = b.Text("EmailId"), MajorActivity = b.Text("MajorActivityName"),
        EnterpriseType = b.Text("EnterpriseTypee"), IncorporationDate = unit.Text("IncorporationDate"),
        WhetherProdCommenced = unit.Text("WhetherProdCommenced"), CommmenceDate = b.Text("CommmenceDate"), TotalEmp = b.Text("TotalEmp"),
        Dic_Name = b.Text("DicName"), AppliedDate = b.Text("AppliedDate"),
    };

    private static PlantDetailsApi Plant(IDictionary<string, object?> u) => new()
    {
        ApplicationId = u.Text("ApplicationId"), UnitIdNo = u.Text("PUnitIdNo"), UnitName = u.Text("PUnitName"), UAM_No = u.Text("UamNumber"),
        PlantIdNo = u.Text("PlantIdNo"), PPin = u.Text("PPin"), PAddress = u.Text("PAddress"), state_name = u.Text("PStateName"),
        DISTRICT_NAME = u.Text("PDistrictName"), LG_DT_Code = u.Text("PLgDistrictCode"),
    };

    private static ActivityDetailsApi Activity(IDictionary<string, object?> u) => new()
    {
        ApplicationId = u.Text("ApplicationId"), Activity = u.Text("Activity"), Two_DigitActivity = u.Text("TwoDigitActivity"),
        Four_DigitActivity = u.Text("FourDigitActivity"), Five_DigitActivity = u.Text("FiveDigitActivity"),
    };

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s;

    private static int Int(string s) => int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) ? n : 0;

    private static decimal Dec(IDictionary<string, object?> r, string column) =>
        decimal.TryParse(r.Text(column), NumberStyles.Number, CultureInfo.InvariantCulture, out var d) ? d : 0m;
}

public static class CertificationLookups
{
    /// <summary>PlantDetails/CertificationDetails of SP_API_GET_CERTIFIED_UNIT_DETAILS_BY_UDYAM (sets 0 and 2).</summary>
    public static (PlantDetailsApi3 Plant, CertificationDetailsApi3 Certification) Details3(ResultSets ds)
    {
        var unit = ds[0][0];
        var levels = ds[2].FirstOrDefault() ?? new Dictionary<string, object?>();
        return (
            new PlantDetailsApi3
            {
                UnitName = unit.Text("PUnitName"), PPin = unit.Text("PPin"), PAddress = unit.Text("PAddress"),
                state_name = unit.Text("PStateName"), DISTRICT_NAME = unit.Text("PDistrictName"), LG_DT_Code = unit.Text("PLgDistrictCode"),
            },
            new CertificationDetailsApi3
            {
                CertificationDate = unit.Text("CertificationStatusDate"), ExpiryDate = levels.Text("ExpiryDate"),
                BronzeCertified = levels.Text("BronzeCertified"), SilverCertified = levels.Text("SilverCertified"),
                GoldCertified = levels.Text("GoldCertified"), CertificationFee = levels.Text("CertificationFee"),
                SubsidyAmount = levels.Text("SubsidyAmount"), AmountPaid = levels.Text("AmountPaid"),
            });
    }

    /// <summary>ZEDMSME followed by digits: the only ZED ID shape used to build file paths.</summary>
    public static bool IsZedId(string? value) =>
        value is { Length: > 7 and <= 30 } && value.StartsWith("ZEDMSME", StringComparison.OrdinalIgnoreCase) && value[7..].All(char.IsAsciiDigit);

    /// <summary>A stored file by its legacy relative path (Certificates ⇄ Certifications tried), or null.</summary>
    public static string? FindStoredFile(IWebHostEnvironment env, PortalOptions portal, string legacyPath)
    {
        if (MsmeFilePaths.FromLegacy(legacyPath) is not { } relative) return null;
        var root = Path.GetFullPath(Path.Combine(env.ContentRootPath, portal.StorageRoot));
        return MsmeFilePaths.StorageCandidates(relative)
            .Select(c => MsmeFilePaths.Resolve(root, c))
            .FirstOrDefault(p => p is not null && System.IO.File.Exists(p));
    }
}
