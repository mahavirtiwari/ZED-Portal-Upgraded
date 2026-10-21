using System.ComponentModel.DataAnnotations;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Templates;

namespace Zed.Portal.Features.Msme;

/// <summary>
/// New MSME registration (Udyam). Port of MsmeController.Register / ValidateUam /
/// ValidatePlantAndActivity / SendPledgeEmailOtp / VerifyPledgeEmailOtp / FinalSubmit.
/// Each step is checked on the server, in order.
/// </summary>
[ApiController]
[Route("api/msme/registration")]
[AllowAnonymous]
public sealed partial class MsmeRegistrationController(
    ISqlExecutor db,
    ICaptchaVerifier captcha,
    IUdyamClient udyam,
    RegistrationSessionStore sessions,
    PledgeCertificateService certificates,
    IEmailSender email,
    IHtmlTemplateRenderer templates,
    IOptions<EmailOptions> emailOptions,
    IOptions<PortalOptions> portal,
    ILogger<MsmeRegistrationController> log) : ControllerBase
{
    private const int MaxOtpSends = 5, MaxOtpFailures = 5;
    private static readonly TimeSpan OtpLifetime = TimeSpan.FromMinutes(10);

    [GeneratedRegex(@"^UDYAM-[A-Z]{2}-\d{2}-\d{7}$")] private static partial Regex UdyamPattern();
    [GeneratedRegex(@"^\d{10}$")] private static partial Regex MobilePattern();

    private string? ClientIp => HttpContext.Connection.RemoteIpAddress?.ToString();

    public sealed record LookupRequest(string RegistrationNo, string MobileNo, string? CaptchaToken);

    public sealed record LookupResponse(
        string RegistrationId,
        Dictionary<string, string> BasicDetails,
        List<Dictionary<string, string>> Plants,
        List<Dictionary<string, string>> Activities);

    /// <summary>Step 1: validate the Udyam number and mobile with the Ministry's Udyam service.</summary>
    [HttpPost("lookup")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<ActionResult<LookupResponse>> Lookup(LookupRequest req, CancellationToken ct)
    {
        var regNo = (req.RegistrationNo ?? "").Trim().ToUpperInvariant();
        var mobile = (req.MobileNo ?? "").Trim();
        if (!UdyamPattern().IsMatch(regNo)) return this.Problem400("Please enter a valid Udyam Registration Number.");
        if (!MobilePattern().IsMatch(mobile)) return this.Problem400("Please enter a valid 10 digit mobile number.");
        if (!await captcha.VerifyAsync(req.CaptchaToken, ClientIp, ct)) return this.Problem400("Invalid Captcha.");

        UdyamLookup lookup;
        try
        {
            lookup = await udyam.GetUdyamAsync(regNo, mobile, ct);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or System.Xml.XmlException or InvalidOperationException)
        {
            log.LogWarning(ex, "Udyam lookup failed for {RegNo}", regNo);
            return Problem(title: "Unexpected error occured. Please try after some time.", statusCode: StatusCodes.Status502BadGateway);
        }

        if (lookup.BasicDetails.Count == 0)
            return this.Problem400("It seems that the Registration Number provided is either not approved/verified OR does not exist in the UDYAM Database.");
        if (lookup.BasicDetails.GetValueOrDefault("UdyogAadharNo") == "NO")
            return this.Problem400("It seems that the Registration Number does not exist in the UDYAM Database.");
        if (lookup.Plants.Count == 0)
            return this.Problem400("It seems that the Plant Details are missing in your Udyam file, Please update the same on the Udyam portal and then try again here.");
        if (lookup.Activities.Count == 0)
            return this.Problem400("It seems that the Activity Details are missing in your Udyam file, Please update the same on the Udyam portal and then try again here.");

        var session = new RegistrationSession { RegistrationNo = regNo, MobileNo = mobile, Lookup = lookup };
        await sessions.SaveAsync(session, ct);
        return new LookupResponse(session.Id, lookup.BasicDetails, lookup.Plants, lookup.Activities);
    }

    public sealed record SelectPlantRequest(int PlantIndex, int ActivityIndex);

    /// <summary>Step 2: the chosen plant must not be registered already and its activity must be eligible.</summary>
    [HttpPost("{id}/plant")]
    public async Task<ActionResult<MessageResponse>> SelectPlant(string id, SelectPlantRequest req, CancellationToken ct)
    {
        if (await sessions.GetAsync(id, ct) is not { } s) return SessionExpired();
        s.PlantIndex = req.PlantIndex;
        s.ActivityIndex = req.ActivityIndex;
        if (s.Plant is null || s.Activity is null) return this.Problem400("Please select one Plant location and its activity.");

        if (await CheckEligibility(s, email: null, ct) is { } error) return this.Problem400(error);
        await sessions.SaveAsync(s, ct);
        return new MessageResponse("OK");
    }

    public sealed record SendOtpRequest([EmailAddress] string Email, string ConfirmEmail);

    /// <summary>Step 3a: e-mail an OTP to the pledge e-mail address.</summary>
    [HttpPost("{id}/email-otp")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<ActionResult<MessageResponse>> SendOtp(string id, SendOtpRequest req, CancellationToken ct)
    {
        if (await sessions.GetAsync(id, ct) is not { } s) return SessionExpired();
        if (s.Plant is null || s.Activity is null) return this.Problem400("Please select one Plant location and its activity first.");

        var address = (req.Email ?? "").Trim();
        if (address.Length > 100 || !new EmailAddressAttribute().IsValid(address)) return this.Problem400("Please enter the valid Email ID.");
        if (!string.Equals(address, req.ConfirmEmail?.Trim(), StringComparison.OrdinalIgnoreCase)) return this.Problem400("Email ID not matching.");
        if (s.OtpSends >= MaxOtpSends) return this.Problem400("Too many OTP requests. Please start the registration again.");
        if (await CheckEligibility(s, address, ct) is { } error) return this.Problem400(error);

        var otp = SecureRandom.Otp();
        s.Email = address;
        s.EmailVerified = false;
        s.OtpHash = RegistrationSession.HashOtp(s.Id, otp);
        s.OtpIssuedUtc = DateTimeOffset.UtcNow;
        s.OtpSends++;
        s.OtpFailures = 0;

        // Kept for the audit trail the legacy code wrote (OTP.MobileNo holds the e-mail for pledge OTPs).
        await db.ExecuteSqlAsync(
            "INSERT INTO OTP (OtpType, MobileNo, OTP, CreatedDate) VALUES ('Pledge', @Email, @Otp, GETDATE())",
            new { Email = new Dapper.DbString { Value = address, IsAnsi = true, Length = 50 }, Otp = new Dapper.DbString { Value = otp, IsAnsi = true, Length = 50 } }, ct);

        var html = await templates.RenderAsync<RegistrationOtpEmail>(new Dictionary<string, object?>
        {
            [nameof(RegistrationOtpEmail.Otp)] = otp,
            [nameof(RegistrationOtpEmail.PublicBaseUrl)] = portal.Value.PublicBaseUrl,
        });
        try
        {
            await email.SendAsync(new EmailMessage(address, "OTP for registration on ZED", html, EmailProfiles.Otp), ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "Registration OTP mail to {Email} failed", address);
            return Problem(title: "We could not send the OTP email right now. Please try again after some time.",
                statusCode: StatusCodes.Status502BadGateway);
        }
        await sessions.SaveAsync(s, ct);
        return new MessageResponse("OTP sent to " + address);
    }

    public sealed record VerifyOtpRequest(string Otp);

    /// <summary>Step 3b: verify the OTP. Five wrong attempts invalidate it.</summary>
    [HttpPost("{id}/email-otp/verify")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<ActionResult<MessageResponse>> VerifyOtp(string id, VerifyOtpRequest req, CancellationToken ct)
    {
        if (await sessions.GetAsync(id, ct) is not { } s) return SessionExpired();
        if (s.OtpHash is null || s.OtpIssuedUtc is null || DateTimeOffset.UtcNow - s.OtpIssuedUtc > OtpLifetime)
            return this.Problem400("The OTP has expired. Please request a new one.");
        if (s.OtpFailures >= MaxOtpFailures)
            return this.Problem400("Too many wrong attempts. Please request a new OTP.");

        var given = RegistrationSession.HashOtp(s.Id, (req.Otp ?? "").Trim());
        if (!CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(given), Encoding.ASCII.GetBytes(s.OtpHash)))
        {
            s.OtpFailures++;
            await sessions.SaveAsync(s, ct);
            return this.Problem400("Invalid OTP.");
        }

        s.EmailVerified = true;
        s.OtpHash = null;
        await sessions.SaveAsync(s, ct);
        return new MessageResponse("Email verified.");
    }

    public sealed record SubmitRequest(bool AcceptedDeclaration, bool TookPledge);

    public sealed record SubmitResponse(string ZedId, string UnitName, bool EmailSent);

    /// <summary>Step 4: summary confirmed and pledge taken. Creates the MSME, the pledge certificate and the login.</summary>
    [HttpPost("{id}/submit")]
    public async Task<ActionResult<SubmitResponse>> Submit(string id, SubmitRequest req, CancellationToken ct)
    {
        if (await sessions.GetAsync(id, ct) is not { } s) return SessionExpired();
        if (!req.AcceptedDeclaration || !req.TookPledge) return this.Problem400("Please accept the declaration and take the pledge.");
        if (s.Plant is not { } plant || s.Activity is not { } activity) return this.Problem400("Please select one Plant location and its activity.");
        if (!s.EmailVerified || s.Email is null) return this.Problem400("Please verify your Email ID.");
        if (await CheckEligibility(s, s.Email, ct) is { } error) return this.Problem400(error);

        var b = s.Lookup.BasicDetails;
        // Missing or empty Udyam fields go to the procedure as NULL, as the legacy code did; an empty
        // string would fail on the numeric columns (TotalEmp, InvestmentCost, ...).
        static string? Value(Dictionary<string, string> row, string k) => row.GetValueOrDefault(k) is { Length: > 0 } v ? v : null;
        string? B(string k) => Value(b, k);
        string? P(string k) => Value(plant, k);
        string? A(string k) => Value(activity, k);

        var result = await db.QueryProcMultipleAsync("SP_MSME_INSERT_UDYAM_DETAILS", new
        {
            IpAddress = ClientIp,
            // The legacy page never set RegistrationFrom, so web registrations were stored as "App".
            RegistrationFrom = "App",
            StateId = B("State_Id"), StateName = B("state_name"), DistrictId = B("District_Id"), DistrictName = B("DISTRICT_NAME"),
            OwnerName = B("OwnerName"), EnterpriseName = B("EnterpriseName"),
            OrganisationType = B("OrganisationType"), OrganisationTypeName = B("OrganisationTypeName"),
            EnterpriseType = B("EnterpriseType"), EnterpriseTypee = B("EnterpriseTypee"),
            // The legacy page replaced the Udyam mobile with the one the user typed (they must match anyway).
            MobileNo = s.MobileNo, EmailId = B("EmailId"), ApplicationId = B("ApplicationId"),
            PledgeEmailId = s.Email,
            PFlat = P("PFlat"), PBuilding = P("PBuilding"), PRoad = P("PRoad"), PArea = P("PArea"), PCity = P("PCity"),
            PAddress = P("PAddress"), PPin = P("PPin"), PStateId = P("state_id"), PStateName = P("state_name"),
            PLgDistrictCode = P("LG_DT_Code"), PDistrictName = P("DISTRICT_NAME"), PPlantDetailId = P("PlantDetail_Id"),
            PlantIdNo = P("PlantIdNo"), UnitName = P("UnitName"), UnitIdNo = P("UnitIdNo"),
            Activity = A("Activity"), TwoDigitActivity = A("Two_DigitActivity"), FourDigitActivity = A("Four_DigitActivity"),
            FiveDigitActivity = A("Five_DigitActivity"), ActivityDetailId = A("ActivityDetail_Id"),
            UdyogAadharNo = B("UdyogAadharNo"), SocialCategory = B("SocialCategory"), SocialCategoryName = B("SocialCategoryName"),
            Gender = B("Gender"), PH = B("PH"), PanNo = B("PanNo"), Address = B("Address"),
            MajorActivity = B("MajorActivity"), MajorActivityName = B("MajorActivityName"), CommmenceDate = B("CommmenceDate"),
            LgDistrictCode = B("LG_DT_Code"), Pincode = B("PINCode"), PreviousEMType = B("PreviousEMType"),
            PreviousEMNumber = B("PreviousEMNumber"), TotalEmp = B("TotalEmp"), InvestmentCost = B("InvestmentCost"),
            DicName = B("Dic_Name"), AppliedDate = B("AppliedDate"),
            Password = SecureRandom.Password(),
            ZedCertified = P("ZedCertified") is "1" or "true" or "True" or "TRUE",
            UamNumber = P("UAM_No"), IncorporationDate = B("IncorporationDate"), WhetherProdCommenced = B("WhetherProdCommenced"),
        }, ct);

        if (result[0].FirstOrDefault() is not { } row)
        {
            log.LogError("SP_MSME_INSERT_UDYAM_DETAILS returned no row for {RegNo} plant {Plant}", s.RegistrationNo, P("PlantIdNo"));
            return this.Problem400("Registrtion failed. Try again after some time.");
        }

        var zedId = row.Text("ZedId");
        var unitName = P("UnitName") ?? "";
        await sessions.RemoveAsync(s.Id, ct);

        var emailSent = await SendPledgeCertificate(new PledgeCertificateData(
            zedId, string.IsNullOrEmpty(unitName) ? B("EnterpriseName") ?? "" : unitName, row.Text("CertificateNo"),
            row.Text("DateOfPledge"), row.Text("Address"), B("UdyogAadharNo") ?? "", row.Text("QrCodeNo")),
            unitName, row.Text("Password"), s.Email, ct);

        await HttpContext.SignInZedUserAsync(new ZedUser(zedId, B("EnterpriseName") ?? "", (int)UserRole.Msme,
            B("EmailId"), s.MobileNo, B("State_Id"), B("District_Id"), unitName));

        return new SubmitResponse(zedId, unitName, emailSent);
    }

    /// <summary>SP_MSME_VALIDATE_UDYAM_DETAILS: [0] plant already registered, [1] eligible activity, [2] e-mail usage limit.</summary>
    private async Task<string?> CheckEligibility(RegistrationSession s, string? email, CancellationToken ct)
    {
        var sets = await db.QueryProcMultipleAsync("SP_MSME_VALIDATE_UDYAM_DETAILS", new
        {
            UdyogAadharNo = s.Lookup.BasicDetails.GetValueOrDefault("UdyogAadharNo"),
            PlantIdNo = s.Plant!.GetValueOrDefault("PlantIdNo"),
            TwoDigitActivity = s.Activity!.GetValueOrDefault("Two_DigitActivity"),
            IpAddress = ClientIp,
            EmailId = email,
        }, ct);

        if (sets[0].Count > 0) return "Selected Plant already registered.";
        if (sets[1].Count == 0) return "Currently this scheme is not applicable for the selected plant activity.";
        if (email is not null && sets[2].FirstOrDefault() is { } limit && limit.Text("EmailCountStatus") == "1")
            return limit.Text("ErrorMessage");
        return null;
    }

    private async Task<bool> SendPledgeCertificate(PledgeCertificateData cert, string unitName, string password, string to, CancellationToken ct)
    {
        try
        {
            var pdf = certificates.Render(cert);
            await certificates.SaveAsync(cert, pdf, ct);

            var html = await templates.RenderAsync<PledgeCertificateEmail>(new Dictionary<string, object?>
            {
                [nameof(PledgeCertificateEmail.UnitName)] = unitName,
                [nameof(PledgeCertificateEmail.ZedId)] = cert.ZedId,
                [nameof(PledgeCertificateEmail.Password)] = password,
                [nameof(PledgeCertificateEmail.PublicBaseUrl)] = portal.Value.PublicBaseUrl,
            });
            var cc = emailOptions.Value.RegistrationCc is { Length: > 0 } c ? new[] { c } : null;
            await email.SendAsync(new EmailMessage(to,
                "Registration Details and Pledge Certificate for “MSME Sustainable (ZED) Certification” Scheme - " + cert.ZedId,
                html, EmailProfiles.Registration, cc, [new EmailAttachment("Pledge.pdf", pdf)]), ct);
            return true;
        }
        catch (Exception ex)
        {
            // The MSME is registered at this point; a mail or PDF failure must not undo that.
            log.LogError(ex, "Pledge certificate or registration mail failed for {ZedId}", cert.ZedId);
            return false;
        }
    }

    private ObjectResult SessionExpired() =>
        Problem(title: "Your registration session has expired. Please start again.", statusCode: StatusCodes.Status410Gone);
}
