using System.Security.Cryptography;
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
    IEmailSender email,
    IHtmlTemplateRenderer templates,
    EmailAddresses addresses,
    IOptions<PortalOptions> portal,
    ILogger<MsmeRegistrationService> log)
{
    public const string AlreadyRegistered = "Selected Plant already registered.";
    public const string NotApplicable = "Currently this scheme is not applicable for the selected plant activity.";
    /// <summary>The selected activity's NIC sector has no type in Masters → Sectors: the new ZED ID (ZEDM / ZEDS) cannot be made.</summary>
    public const string SectorTypeMissing =
        "The sector (Manufacturing / Services) of the selected plant activity is not set yet. Please contact the ZED team.";
    public const string RegistrationFailed = "Registrtion failed. Try again after some time.";
    public const string RegistrationSubject = "Registration Details and Pledge Certificate for “MSME Sustainable (ZED) Certification” Scheme - ";

    /// <summary>The MSME created by <see cref="CompleteAsync"/>.</summary>
    public sealed record Registered(string ZedId, string UnitName, bool EmailSent, ZedUser User);

    /// <summary>SP_MSME_VALIDATE_UDYAM_DETAILS: [0] plant already registered, [1] eligible activity (with its sector type), [2] e-mail usage limit.</summary>
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
        // Migration 0051: the ZED ID carries the sector (ZEDM / ZEDS), taken only from Masters → Sectors (SectorType).
        if (!sets[1].Any(r => r.Text("SectorType") is "Manufacturing" or "Services")) return SectorTypeMissing;
        if (emailId is not null && sets.Count > 2 && sets[2].FirstOrDefault() is { } limit && limit.Text("EmailCountStatus") == "1")
            return limit.Text("ErrorMessage");
        return null;
    }

    /// <summary>Set on a plant of the shown Udyam record when it is registered already: its ZED ID, partly hidden.</summary>
    public const string PlantRegisteredKey = "V4RegisteredZedId";
    /// <summary>Set on an activity of the shown Udyam record when it cannot be registered: the reason.</summary>
    public const string ActivityRefusedKey = "V4NotEligible";

    /// <summary>
    /// New (2026-11-07): copies of the Udyam record's plants and activities for the plant / activity choice (web and app),
    /// marked with <see cref="PlantRegisteredKey"/> and <see cref="ActivityRefusedKey"/>, so that a registered plant or an
    /// activity the scheme does not cover is greyed out with the reason before the applicant goes on (the checks at
    /// each step stay). The same procedure as <see cref="CheckEligibilityAsync"/>, once per plant and per activity.
    /// </summary>
    public async Task<(List<Dictionary<string, string>> Plants, List<Dictionary<string, string>> Activities)> MarkChoicesAsync(
        string regNo, UdyamLookup lookup, CancellationToken ct)
    {
        var plants = new List<Dictionary<string, string>>();
        foreach (var p in lookup.Plants)
        {
            var copy = new Dictionary<string, string>(p);
            if (p.GetValueOrDefault("PlantIdNo") is { Length: > 0 } plantId)
            {
                var sets = await db.QueryProcMultipleAsync("SP_MSME_VALIDATE_UDYAM_DETAILS", new
                {
                    UdyogAadharNo = regNo, PlantIdNo = plantId, TwoDigitActivity = (string?)null, IpAddress = (string?)null, EmailId = (string?)null,
                }, ct);
                if (sets[0].FirstOrDefault() is { } registered)
                    copy[PlantRegisteredKey] = registered.Text("ZedId") is { Length: > 0 } z ? MsmeAccountFinder.MaskZedId(z) : "";
            }
            plants.Add(copy);
        }

        var reasons = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        var activities = new List<Dictionary<string, string>>();
        foreach (var a in lookup.Activities)
        {
            var copy = new Dictionary<string, string>(a);
            var two = a.GetValueOrDefault("Two_DigitActivity") ?? "";
            if (!reasons.TryGetValue(two, out var reason))
            {
                if (two.Trim().Length == 0) reason = NotApplicable;
                else
                {
                    var sets = await db.QueryProcMultipleAsync("SP_MSME_VALIDATE_UDYAM_DETAILS", new
                    {
                        UdyogAadharNo = regNo, PlantIdNo = (string?)null, TwoDigitActivity = two, IpAddress = (string?)null, EmailId = (string?)null,
                    }, ct);
                    reason = sets.Count < 2 || sets[1].Count == 0 ? NotApplicable
                        : !sets[1].Any(r => r.Text("SectorType") is "Manufacturing" or "Services") ? SectorTypeMissing
                        : null;
                }
                reasons[two] = reason;
            }
            if (reason is not null) copy[ActivityRefusedKey] = reason;
            activities.Add(copy);
        }
        return (plants, activities);
    }

    /// <summary>The chosen plant and activity of a session, checked as <see cref="CheckEligibilityAsync"/>.</summary>
    public Task<string?> CheckEligibilityAsync(RegistrationSession s, string? emailId, string? ip, CancellationToken ct) =>
        CheckEligibilityAsync(s.Lookup.BasicDetails.GetValueOrDefault("UdyogAadharNo"), s.Plant!.GetValueOrDefault("PlantIdNo"),
            s.Activity!.GetValueOrDefault("Two_DigitActivity"), emailId, ip, ct);

    /// <summary>Start of the value V4 writes to OTP.OTP for a pledge OTP: never the OTP itself.</summary>
    public const string OtpPlaceholderPrefix = "V4!";

    /// <summary>Records that an OTP was mailed (the legacy OTP table) and mails it; false when the mail could not be sent.</summary>
    public async Task<bool> SendOtpMailAsync(string address, string otp, CancellationToken ct)
    {
        // Kept for the audit trail the legacy code wrote (OTP.MobileNo holds the e-mail for pledge OTPs). V4 checks the
        // OTP against the hash in its own state, and nothing reads this row's OTP back (the old site's
        // VerifyPledgeEmailOtp only matches the OTPs it wrote itself), so the column gets a random value, not the OTP.
        await db.ExecuteSqlAsync(
            "INSERT INTO OTP (OtpType, MobileNo, OTP, CreatedDate) VALUES ('Pledge', @Email, @Otp, GETDATE())",
            new { Email = new Dapper.DbString { Value = address, IsAnsi = true, Length = 50 }, Otp = new Dapper.DbString { Value = OtpPlaceholder(), IsAnsi = true, Length = 50 } }, ct);

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
    /// verified e-mail, sets the initial password (PasswordStore), and mails the pledge certificate (drawn for the mail, not
    /// stored). Null when the procedure returned no row.
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

        // No certificate attached: the mail links to the pledge certificate page, which draws it (V4).
        var emailSent = await SendRegistrationMailAsync(zedId, unitName, initialPassword, s.Email!, ct);

        var user = new ZedUser(zedId, B("EnterpriseName") ?? "", (int)UserRole.Msme, B("EmailId"), s.MobileNo, B("State_Id"), B("District_Id"), unitName);
        return new Registered(zedId, unitName, emailSent, user);
    }

    private async Task<bool> SendRegistrationMailAsync(string zedId, string unitName, string password, string to, CancellationToken ct)
    {
        Task<string> Render(bool officeCopy) => templates.RenderAsync<PledgeCertificateEmail>(new Dictionary<string, object?>
        {
            [nameof(PledgeCertificateEmail.UnitName)] = unitName,
            [nameof(PledgeCertificateEmail.ZedId)] = zedId,
            [nameof(PledgeCertificateEmail.Password)] = officeCopy ? null : password,
            [nameof(PledgeCertificateEmail.OfficeCopy)] = officeCopy,
            [nameof(PledgeCertificateEmail.PublicBaseUrl)] = portal.Value.PublicBaseUrl,
        });

        bool sent;
        try
        {
            // To the unit only: the office mailbox gets its own copy below, without the password (old: Cc of this mail).
            await email.SendAsync(new EmailMessage(to, RegistrationSubject + zedId, await Render(officeCopy: false), EmailProfiles.Registration), ct);
            sent = true;
        }
        catch (Exception ex)
        {
            // The MSME is registered at this point; a mail failure must not undo that.
            log.LogError(ex, "Registration mail failed for {ZedId}", zedId);
            sent = false;
        }

        try
        {
            if (await addresses.GetAsync(EmailAddresses.RegistrationCc, ct) is { } office)
                await email.SendAsync(new EmailMessage(office, RegistrationSubject + zedId, await Render(officeCopy: true), EmailProfiles.Registration), ct);
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Office copy of the registration mail failed for {ZedId}", zedId);
        }
        return sent;
    }

    /// <summary>The value written to OTP.OTP for a pledge OTP: random, so no OTP typed on the old site can match it.</summary>
    private static string OtpPlaceholder() => OtpPlaceholderPrefix + Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
}
