using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Templates;

namespace Zed.Portal.Features.Msme;

/// <summary>
/// The server side of a new MSME registration, shared by the web pages (<see cref="MsmeRegistrationController"/>) and the
/// MSME app (<see cref="MsmeAppRegistrationController"/>): the eligibility check, the e-mail OTP mail and the final
/// insert with the pledge certificate. Both callers pass Udyam data the server fetched itself, never data from the client.
/// </summary>
public sealed class MsmeRegistrationService(
    ISqlExecutor db,
    IServiceProvider services,
    PledgeCertificateService certificates,
    IEmailSender email,
    IHtmlTemplateRenderer templates,
    EmailAddresses addresses,
    IOptions<PortalOptions> portal,
    ILogger<MsmeRegistrationService> log)
{
    public const string AlreadyRegistered = "Selected Plant already registered.";
    public const string NotApplicable = "Currently this scheme is not applicable for the selected plant activity.";
    public const string RegistrationFailed = "Registrtion failed. Try again after some time.";

    /// <summary>The MSME created by <see cref="CompleteAsync"/>.</summary>
    public sealed record Registered(string ZedId, string UnitName, bool EmailSent, ZedUser User);

    /// <summary>SP_MSME_VALIDATE_UDYAM_DETAILS: [0] plant already registered, [1] eligible activity, [2] e-mail usage limit.</summary>
    public async Task<string?> CheckEligibilityAsync(string? udyogAadharNo, string? plantIdNo, string? twoDigitActivity,
        string? emailId, string? ip, CancellationToken ct)
    {
        var sets = await db.QueryProcMultipleAsync("SP_MSME_VALIDATE_UDYAM_DETAILS", new
        {
            UdyogAadharNo = udyogAadharNo,
            PlantIdNo = plantIdNo,
            TwoDigitActivity = twoDigitActivity,
            IpAddress = ip,
            EmailId = emailId,
        }, ct);

        if (sets[0].Count > 0) return AlreadyRegistered;
        if (sets[1].Count == 0) return NotApplicable;
        if (emailId is not null && sets.Count > 2 && sets[2].FirstOrDefault() is { } limit && limit.Text("EmailCountStatus") == "1")
            return limit.Text("ErrorMessage");
        return null;
    }

    /// <summary>The chosen plant and activity of a session, checked as <see cref="CheckEligibilityAsync"/>.</summary>
    public Task<string?> CheckEligibilityAsync(RegistrationSession s, string? emailId, string? ip, CancellationToken ct) =>
        CheckEligibilityAsync(s.Lookup.BasicDetails.GetValueOrDefault("UdyogAadharNo"), s.Plant!.GetValueOrDefault("PlantIdNo"),
            s.Activity!.GetValueOrDefault("Two_DigitActivity"), emailId, ip, ct);

    /// <summary>Records the OTP (the legacy OTP table) and mails it; false when the mail could not be sent.</summary>
    public async Task<bool> SendOtpMailAsync(string address, string otp, CancellationToken ct)
    {
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
            return true;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "Registration OTP mail to {Email} failed", address);
            return false;
        }
    }

    /// <summary>
    /// Creates the MSME (SP_MSME_INSERT_UDYAM_DETAILS) from the session's server-side Udyam data, plant, activity and
    /// verified e-mail, sets the initial password (PasswordStore), and mails the pledge certificate. Null when the
    /// procedure returned no row.
    /// </summary>
    public async Task<Registered?> CompleteAsync(RegistrationSession s, string registrationFrom, string? ip, CancellationToken ct)
    {
        var plant = s.Plant!;
        var activity = s.Activity!;
        var b = s.Lookup.BasicDetails;
        // Missing or empty Udyam fields go to the procedure as NULL, as the legacy code did; an empty
        // string would fail on the numeric columns (TotalEmp, InvestmentCost, ...).
        static string? Value(Dictionary<string, string> row, string k) => row.GetValueOrDefault(k) is { Length: > 0 } v ? v : null;
        string? B(string k) => Value(b, k);
        string? P(string k) => Value(plant, k);
        string? A(string k) => Value(activity, k);

        // The procedure stores (and echoes) the value it is given; the pledge mail carries the generated password.
        var initialPassword = SecureRandom.Password();
        var passwords = PasswordStore.For(db, services);
        var result = await db.QueryProcMultipleAsync("SP_MSME_INSERT_UDYAM_DETAILS", new
        {
            IpAddress = ip,
            RegistrationFrom = registrationFrom,
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
            Password = passwords.StoredValueFor(initialPassword),
            ZedCertified = P("ZedCertified") is "1" or "true" or "True" or "TRUE",
            UamNumber = P("UAM_No"), IncorporationDate = B("IncorporationDate"), WhetherProdCommenced = B("WhetherProdCommenced"),
        }, ct);

        if (result[0].FirstOrDefault() is not { } row)
        {
            log.LogError("SP_MSME_INSERT_UDYAM_DETAILS returned no row for {RegNo} plant {Plant}", s.RegistrationNo, P("PlantIdNo"));
            return null;
        }

        var zedId = row.Text("ZedId");
        await passwords.SetAsync(zedId, initialPassword, ct);
        var unitName = P("UnitName") ?? "";

        var emailSent = await SendPledgeCertificateAsync(new PledgeCertificateData(
            zedId, string.IsNullOrEmpty(unitName) ? B("EnterpriseName") ?? "" : unitName, row.Text("CertificateNo"),
            row.Text("DateOfPledge"), row.Text("Address"), B("UdyogAadharNo") ?? "", row.Text("QrCodeNo")),
            unitName, initialPassword, s.Email!, ct);

        var user = new ZedUser(zedId, B("EnterpriseName") ?? "", (int)UserRole.Msme, B("EmailId"), s.MobileNo, B("State_Id"), B("District_Id"), unitName);
        return new Registered(zedId, unitName, emailSent, user);
    }

    private async Task<bool> SendPledgeCertificateAsync(PledgeCertificateData cert, string unitName, string password, string to, CancellationToken ct)
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
            var cc = await addresses.CopyAsync(EmailAddresses.RegistrationCc, ct);
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
}
