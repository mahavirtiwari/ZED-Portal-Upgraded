using System.Net.Mail;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Msme;
using Zed.Portal.Templates;

namespace Zed.Portal.Features.ExternalApi;

/// <summary>
/// The Udyami Bharat integration (old MsmeController, "UdyamiApi" request folders, tables
/// UdyamiAPIRequests / UdyamiAPIRequestFailures): register a plant with its Udyam data and get the pledge
/// certificate back, list a Udyam number's ZED units and certificates, fetch one certificate. Static client
/// token (any ApiClientTokens row); the procedures record each call.
/// <para>
/// Changed: the request bodies (owner, PAN, mobile, e-mail) are no longer written to App_Data\Json\API;
/// the generated password comes from a cryptographic RNG (old: 4 characters from System.Random);
/// certificates are read from the storage root instead of being downloaded from the public site; error
/// answers no longer carry exception text or the file URL.
/// </para>
/// </summary>
[ExternalApiErrors(ExternalApiErrorsAttribute.Plain500)]
public sealed class UdyamiApiController(
    ISqlExecutor db,
    PledgeCertificateService certificates,
    IEmailSender email,
    IHtmlTemplateRenderer templates,
    IOptions<EmailOptions> emailOptions,
    IOptions<PortalOptions> portal,
    IWebHostEnvironment env,
    ILogger<UdyamiApiController> log) : ExternalApiController
{
    private ApiClients Clients => new(db, Options);

    /// <summary>Msme/RegisterPlant (POST): SP_API_MSME_INSERT_UDYAM_DETAILS, pledge certificate PDF, registration mail.</summary>
    [HttpPost("/Msme/RegisterPlant")]
    public async Task<IActionResult> RegisterPlant(MsmeRegisterApiModel msme, CancellationToken ct)
    {
        // The old action read the token from the body only (msme.Token); a "token" field is the same value.
        if (await Clients.StaticAsync(msme.Token, StaticTokenScope.Any, ct) is not { } caller)
        {
            log.LogWarning("Msme/RegisterPlant refused from {Ip}: invalid token", ClientIp);
            return LegacyJson(new ApiRegisterServiceResponse { StatusCode = "401", StatusMessage = "Invalid Token." });
        }

        var b = msme.UdyamDetails ?? new UdyamBasicDetails();
        var p = msme.PlantDetails ?? new UdyamPlantDetails();
        var a = msme.ActivityDetails ?? new UdyamActivityDetails();
        if (!ValidRegistration(msme, b, p, a))
        {
            log.LogWarning("Msme/RegisterPlant from {Client}: refused input for request {RequestId}", caller.Client, Short(msme.RequestId));
            return LegacyJson(new ApiRegisterServiceResponse { StatusCode = "400", StatusMessage = "Bad Request" });
        }

        var ds = await db.QueryProcMultipleAsync("SP_API_MSME_INSERT_UDYAM_DETAILS", new
        {
            IpAddress = ClientIp,
            ClientRequestId = msme.RequestId,
            ClientReqTimeStamp = msme.ReqTimeStamp,
            Token = msme.Token,
            StateId = b.State_Id, StateName = b.state_name, DistrictId = b.District_Id, DistrictName = b.DISTRICT_NAME,
            b.OwnerName, b.EnterpriseName, b.OrganisationType, b.OrganisationTypeName, b.EnterpriseType, b.EnterpriseTypee,
            MobileNo = msme.UserMobileNo, EmailId = msme.UserEmail, b.ApplicationId, PledgeEmailId = msme.UserEmail,
            p.PFlat, p.PBuilding, p.PRoad, p.PArea, p.PCity, p.PAddress, p.PPin,
            PStateId = p.state_id, PStateName = p.state_name, PLgDistrictCode = p.LG_DT_Code, PDistrictName = p.DISTRICT_NAME,
            PPlantDetailId = p.PlantDetail_Id, p.PlantIdNo, p.UnitName, p.UnitIdNo,
            a.Activity, TwoDigitActivity = a.Two_DigitActivity, FourDigitActivity = a.Four_DigitActivity,
            FiveDigitActivity = a.Five_DigitActivity, ActivityDetailId = a.ActivityDetail_Id,
            b.UdyogAadharNo, b.SocialCategory, b.SocialCategoryName, b.Gender, b.PH, b.PanNo, b.Address,
            b.MajorActivity, b.MajorActivityName, b.CommmenceDate, LgDistrictCode = b.LG_DT_Code, Pincode = b.PINCode,
            b.PreviousEMType, b.PreviousEMNumber, b.TotalEmp, b.InvestmentCost, DicName = b.Dic_Name, b.AppliedDate,
            Password = SecureRandom.Password(),
            p.ZedCertified,
            UamNumber = p.UAM_No,
            b.IncorporationDate, b.WhetherProdCommenced,
        }, ct);

        var status = ds[0].FirstOrDefault();
        if (status is null) return LegacyJson(new ApiRegisterServiceResponse { StatusCode = "500" });
        var res = new ApiRegisterServiceResponse { StatusCode = status.Text("Status"), StatusMessage = status.Text("ErrorMessage") };
        if (res.StatusCode != "200")
        {
            log.LogInformation("Msme/RegisterPlant by {Client}: {Udyam} plant {Plant} → {Status}", caller.Client, b.UdyogAadharNo, p.PlantIdNo, res.StatusCode);
            return LegacyJson(res);
        }

        res.RequestId = status.Text("RequestId");
        res.UdyogAadharNo = status.Text("UdyogAadharNo");
        res.PlantId = status.Text("PlantId");
        res.RefId = status.Text("RefId");

        // Set 1 is SP_MSME_INSERT_UDYAM_DETAILS' row; without it (its CATCH branch) nothing was registered.
        var row = ds[1].FirstOrDefault();
        var zedId = row?.Text("ZedId") ?? "";
        if (row is null || zedId.Length == 0)
        {
            log.LogError("Msme/RegisterPlant by {Client}: {Udyam} plant {Plant} returned no ZED ID", caller.Client, b.UdyogAadharNo, p.PlantIdNo);
            res.StatusCode = "500";
            res.StatusMessage = "Registrtion failed. Try again after some time.";
            return LegacyJson(res);
        }

        res.ZedId = zedId;
        res.FileType = "Pledge";
        res.FileExtension = ".pdf";
        log.LogInformation("Msme/RegisterPlant by {Client}: {Udyam} plant {Plant} registered as {ZedId}", caller.Client, b.UdyogAadharNo, p.PlantIdNo, zedId);

        var unitName = p.UnitName ?? "";
        var pledge = new PledgeCertificateData(zedId, string.IsNullOrEmpty(unitName) ? b.EnterpriseName ?? "" : unitName,
            row.Text("CertificateNo"), row.Text("DateOfPledge"), row.Text("Address"), b.UdyogAadharNo ?? "", row.Text("QrCodeNo"));
        byte[] pdf;
        try
        {
            pdf = certificates.Render(pledge);
            await certificates.SaveAsync(pledge, pdf, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // The unit is registered; the caller still gets its ZED ID (old: an HTTP 500 with the exception text).
            log.LogError(ex, "Pledge certificate failed for {ZedId} (Udyami RegisterPlant)", zedId);
            return LegacyJson(res);
        }
        res.Base64File = Convert.ToBase64String(pdf);

        try
        {
            var html = await templates.RenderAsync<PledgeCertificateEmail>(new Dictionary<string, object?>
            {
                [nameof(PledgeCertificateEmail.UnitName)] = unitName,
                [nameof(PledgeCertificateEmail.ZedId)] = zedId,
                // The generated first password, as in the web registration mail (the MSME needs it to sign in).
                [nameof(PledgeCertificateEmail.Password)] = row.Text("Password"),
                [nameof(PledgeCertificateEmail.PublicBaseUrl)] = portal.Value.PublicBaseUrl,
            });
            var cc = emailOptions.Value.RegistrationCc is { Length: > 0 } c ? new[] { c } : null;
            await email.SendAsync(new EmailMessage(msme.UserEmail!,
                "Registration Details and Pledge Certificate for “MSME Sustainable (ZED) Certification” Scheme - " + zedId,
                html, EmailProfiles.Registration, cc, [new EmailAttachment("Pledge.pdf", pdf)]), ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "Registration mail failed for {ZedId} (Udyami RegisterPlant)", zedId);
        }
        return LegacyJson(res);
    }

    /// <summary>Msme/GetCertificatesByUdyam (POST): the Udyam number's ZED units with their latest certificate id.</summary>
    [HttpPost("/Msme/GetCertificatesByUdyam")]
    public async Task<IActionResult> GetCertificatesByUdyam(string? Udyamid, string? RequestId, string? Token, CancellationToken ct)
    {
        if (await Clients.StaticAsync(Token, StaticTokenScope.Any, ct) is not { } caller)
            return LegacyJson(new ApiGetCertificatesByUdyamResponse { StatusCode = "401", StatusMessage = "Invalid Token.", Certificates = [] });
        if (!SafeInput.Ok(Udyamid, 50) || !SafeInput.Ok(RequestId, 100))
            return LegacyJson(new ApiGetCertificatesByUdyamResponse { StatusCode = "400", StatusMessage = "Bad Request", Certificates = [] });

        var ds = await db.QueryProcMultipleAsync("SP_API_MSME_GET_CERTIFICATIONS_BY_UDYAM_NO", new
        {
            IpAddress = ClientIp, ClientRequestId = RequestId, Token, UdyogAadharNo = Udyamid,
        }, ct);
        var status = ds[0].FirstOrDefault();
        if (status is null) return LegacyJson(new ApiGetCertificatesByUdyamResponse { StatusCode = "500", Certificates = [] });

        var res = new ApiGetCertificatesByUdyamResponse { StatusCode = status.Text("Status"), StatusMessage = status.Text("ErrorMessage"), Certificates = [] };
        if (res.StatusCode == "200")
        {
            res.Certificates = ds[1].Select(r => new ApiGetCertificateList
            {
                ZED = r.Text("ZedId"), Udyamid = r.Text("UdyogAadharNo"), PlantID = r.Text("PlantId"), Applieddate = r.Text("Date"),
                Applicationstatus = r.Text("Applicationstatus"),
                file = [new ApiFileInfo { Filetype = r.Text("Certification"), FileID = r.Text("RefId"), FileName = r.Text("FileName") }],
            }).ToList();
        }
        log.LogInformation("Msme/GetCertificatesByUdyam by {Client}: {Udyam} → {Status}, {Count} units", caller.Client, Udyamid, res.StatusCode, res.Certificates.Count);
        return LegacyJson(res);
    }

    /// <summary>Msme/GetCertificateDetails (any verb): one certificate (pledge or latest level) as base64.</summary>
    [Route("/Msme/GetCertificateDetails")]
    public async Task<IActionResult> GetCertificateDetails(string? Udyamid, string? ZEDID, string? FileID, string? RequestId, string? Token, CancellationToken ct)
    {
        if (await Clients.StaticAsync(Token, StaticTokenScope.Any, ct) is not { } caller)
            return LegacyJson(new Api3GetCertificateDetailsByUdyamResponse { StatusCode = "401", StatusMessage = "Invalid Token." });
        if (!SafeInput.AllOk(50, Udyamid, ZEDID) || !SafeInput.AllOk(100, FileID, RequestId))
            return LegacyJson(new Api3GetCertificateDetailsByUdyamResponse { StatusCode = "400", StatusMessage = "Bad Request" });

        var ds = await db.QueryProcMultipleAsync("SP_API_MSME_GET_CERTIFICATIONS_BY_UDYAM_NO_AND_ZEDID", new
        {
            IpAddress = ClientIp, ClientRequestId = RequestId, Token, UdyogAadharNo = Udyamid, ZedId = ZEDID, FileId = FileID,
        }, ct);
        var status = ds[0].FirstOrDefault();
        if (status is null) return LegacyJson(new Api3GetCertificateDetailsByUdyamResponse { StatusCode = "500" });

        var res = new Api3GetCertificateDetailsByUdyamResponse { StatusCode = status.Text("Status"), StatusMessage = status.Text("ErrorMessage") };
        if (res.StatusCode == "200")
        {
            foreach (var row in ds[1])
            {
                res.ZED = row.Text("ZedId");
                res.Udyamid = row.Text("UdyogAadharNo");
                res.PlantID = row.Text("PlantId");
                var cert = new ApiFileInfo2
                {
                    Filetype = row.Text("Certification"),
                    Fileextension = row.Text("FileExtension"),
                    Filename = row.Text("FileName"),
                };
                var column = cert.Filetype switch { "Bronze" => "BronzePath", "Silver" => "SilverPath", "Gold" => "GoldPath", _ => "PledgePath" };
                var path = row.Text(column);
                // The procedure builds the path from the ZED ID it was given; only that unit's own file is read.
                var file = CertificationLookups.IsZedId(res.ZED) && MsmeFilePaths.FromLegacy(path) is { } relative && MsmeFilePaths.BelongsTo(relative, res.ZED)
                    ? CertificationLookups.FindStoredFile(env, portal.Value, relative)
                    : null;
                if (file is null)
                {
                    log.LogWarning("Msme/GetCertificateDetails by {Client}: {Path} for {ZedId} not found in storage", caller.Client, path, res.ZED);
                    return LegacyJson(new ApiRegisterServiceResponse { StatusCode = "500", StatusMessage = "Certificate file not found." });
                }
                cert.File = Convert.ToBase64String(await System.IO.File.ReadAllBytesAsync(file, ct));
                res.file = [cert];
            }
        }
        log.LogInformation("Msme/GetCertificateDetails by {Client}: {ZedId} {FileId} → {Status}", caller.Client, ZEDID, FileID, res.StatusCode);
        return LegacyJson(res);
    }

    private static bool ValidRegistration(MsmeRegisterApiModel m, UdyamBasicDetails b, UdyamPlantDetails p, UdyamActivityDetails a)
    {
        // Lengths of the procedure parameters, and dbo.fn_IsSafeInput's rules for every text value.
        var limits = new (string? Value, int Max)[]
        {
            (m.RequestId, 500), (m.ReqTimeStamp, 500), (m.UserMobileNo, 50), (m.UserEmail, 200),
            (b.State_Id, 50), (b.state_name, 100), (b.District_Id, 50), (b.DISTRICT_NAME, 100), (b.OwnerName, 200),
            (b.EnterpriseName, 250), (b.OrganisationType, 50), (b.OrganisationTypeName, 50), (b.EnterpriseType, 50),
            (b.EnterpriseTypee, 50), (b.ApplicationId, 50), (b.UdyogAadharNo, 50), (b.SocialCategory, 50),
            (b.SocialCategoryName, 50), (b.Gender, 50), (b.PH, 50), (b.PanNo, 50), (b.Address, 4000), (b.MajorActivity, 50),
            (b.MajorActivityName, 50), (b.CommmenceDate, 50), (b.LG_DT_Code, 50), (b.PINCode, 50), (b.PreviousEMType, 50),
            (b.PreviousEMNumber, 50), (b.TotalEmp, 50), (b.InvestmentCost, 50), (b.Dic_Name, 50), (b.AppliedDate, 50),
            (b.IncorporationDate, 50), (b.WhetherProdCommenced, 50),
            (p.PFlat, 200), (p.PBuilding, 200), (p.PRoad, 200), (p.PArea, 200), (p.PCity, 200), (p.PAddress, 2000), (p.PPin, 50),
            (p.state_id, 50), (p.state_name, 100), (p.LG_DT_Code, 50), (p.DISTRICT_NAME, 100), (p.PlantDetail_Id, 50),
            (p.PlantIdNo, 50), (p.UnitName, 500), (p.UnitIdNo, 50), (p.UAM_No, 50),
            (a.Activity, 100), (a.Two_DigitActivity, 2000), (a.Four_DigitActivity, 2000), (a.Five_DigitActivity, 2000), (a.ActivityDetail_Id, 50),
        };
        if (limits.Any(l => !SafeInput.Ok(l.Value, l.Max))) return false;
        // The procedure refuses an empty e-mail itself; anything given must be one address (it receives the password).
        return string.IsNullOrWhiteSpace(m.UserEmail) || MailAddress.TryCreate(m.UserEmail.Trim(), out var address) && address.Address == m.UserEmail.Trim();
    }

    private static string? Short(string? value) => TokenController.Shorten(value);
}
