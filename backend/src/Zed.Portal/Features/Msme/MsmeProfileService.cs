using System.ComponentModel.DataAnnotations;
using System.Data.Common;
using System.Text.Json;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Templates;

namespace Zed.Portal.Features.Msme;

/// <summary>
/// The MSME profile behind the web page (<see cref="MsmeProfileController"/>) and, since 2026-11-07, the ZED MSME app
/// (<see cref="MsmeAppProfileController"/>): the details, the activity change (from the unit's own Udyam record) and the
/// change of the registered e-mail with an OTP sent to the new address.
/// </summary>
public sealed class MsmeProfileService(
    ISqlExecutor db,
    IUdyamClient udyam,
    IDistributedCache cache,
    IEmailSender email,
    IHtmlTemplateRenderer templates,
    IOptions<PortalOptions> portal,
    IMsmeEditHistory history,
    ILogger<MsmeProfileService> log)
{
    // Only the columns the page shows (the legacy action sent every result set, SELECT * on Msme etc.).
    private static readonly string[] MsmeFields =
    [
        "ZedId", "IncorporationDate", "WhetherProdCommenced",
        "PUnitName", "PAddress", "PDistrictName", "PStateName", "PPin",
        "Activity", "TwoDigitActivity", "FourDigitActivity", "FiveDigitActivity",
    ];

    private static readonly string[] BasicInfoFields =
    [
        "UdyogAadharNo", "OwnerName", "EnterpriseName", "OrganisationTypeName", "SocialCategoryName", "Gender",
        "EmailId", "MobileNo", "PH", "PanNo", "Address", "StateName", "DistrictName", "Pincode",
        "MajorActivityName", "EnterpriseTypee", "CommmenceDate", "TotalEmp", "DicName", "AppliedDate",
    ];

    private static readonly string[] ActivityFields = ["Activity", "Two_DigitActivity", "Four_DigitActivity", "Five_DigitActivity"];

    public const string UdyamUnavailable = "Unexpected error occured. Please try after some time.";

    /// <summary>The outcome of a call: a value, or the message and whether it is "not found" / "Udyam down".</summary>
    public sealed record Result<T>(T? Value, string? Error, bool NotFound = false, bool Unavailable = false)
    {
        public static Result<T> Ok(T value) => new(value, null);
        public static Result<T> Fail(string error) => new(default, error);
    }

    public sealed record Profile(Dictionary<string, object?> Msme, Dictionary<string, object?> BasicInfo, string? RegisteredEmail);

    // ---------------------------------------------------------------- details

    /// <summary>Basic information, selected unit and activity (SP_MSME_GET_DETAILS sets 0 and 1) and the registered e-mail.</summary>
    public async Task<Result<Profile>> GetAsync(string zedId, CancellationToken ct)
    {
        var sets = await Details(zedId, ct);
        if (sets[0].FirstOrDefault() is not { } msme) return new(null, "Not found.", NotFound: true);
        var account = await PasswordResetTokens.FindMsmeAccountAsync(db, zedId, ct);
        return Result<Profile>.Ok(new Profile(Pick(msme, MsmeFields), Pick(sets[1].FirstOrDefault(), BasicInfoFields), account?.MailAddress));
    }

    // ---------------------------------------------------------------- activity

    /// <summary>"Edit Activity": the activities of the unit's own Udyam record, read from the Ministry service.</summary>
    public async Task<Result<List<Dictionary<string, string>>>> ActivitiesAsync(string zedId, CancellationToken ct)
    {
        var own = await OwnUdyamAsync(zedId, ct);
        if (own.Value is null) return new(null, own.Error, own.NotFound, own.Unavailable);
        return Result<List<Dictionary<string, string>>>.Ok(
            own.Value.Activities.Select(a => ActivityFields.ToDictionary(f => f, f => a.GetValueOrDefault(f) ?? "")).ToList());
    }

    /// <summary>
    /// "Update": the chosen activity must be in the unit's Udyam record and eligible for the scheme; then
    /// SP_MSME_UPDATE_UDYAM_DETAILS (ModifiedDataType 'Activity') updates it in all ZED databases.
    /// </summary>
    public async Task<Result<string>> UpdateActivityAsync(string zedId, string? fiveDigitActivity, string? ip, CancellationToken ct)
    {
        var chosen = (fiveDigitActivity ?? "").Trim();
        if (chosen.Length == 0) return Result<string>.Fail("Please select the activity.");

        var own = await OwnUdyamAsync(zedId, ct);
        if (own.Value is null) return new(null, own.Error, own.NotFound, own.Unavailable);
        var activity = own.Value.Activities.FirstOrDefault(a => a.GetValueOrDefault("Five_DigitActivity") == chosen);
        if (activity is null) return Result<string>.Fail("The selected activity is not in your Udyam registration.");

        var udyamNumber = own.Value.UdyamNumber;
        // The legacy page sent PlantIdNo '123' so the "plant already registered" check (set 0) never matched;
        // only the sector eligibility (set 1) applies when changing the activity of an existing unit.
        var check = await db.QueryProcMultipleAsync("SP_MSME_VALIDATE_UDYAM_DETAILS", new
        {
            UdyogAadharNo = udyamNumber,
            PlantIdNo = (string?)null,
            TwoDigitActivity = activity.GetValueOrDefault("Two_DigitActivity"),
            IpAddress = ip,
        }, ct);
        if (check[1].Count == 0) return Result<string>.Fail("Currently this scheme is not applicable for the selected plant activity.");

        static string? Value(Dictionary<string, string> row, string k) => row.GetValueOrDefault(k) is { Length: > 0 } v ? v : null;
        try
        {
            await db.ExecuteProcAsync("SP_MSME_UPDATE_UDYAM_DETAILS", new
            {
                UdyamNumber = udyamNumber,
                // The legacy action substituted this literal when no enterprise type was sent; unused for 'Activity'.
                EnterpriseType = "EnterpriseType",
                PaymentModule = "ZED LIVE",
                ModifiedDataType = "Activity",
                Activity = Value(activity, "Activity"),
                TwoDigitActivity = Value(activity, "Two_DigitActivity"),
                FourDigitActivity = Value(activity, "Four_DigitActivity"),
                FiveDigitActivity = Value(activity, "Five_DigitActivity"),
                // The legacy page sent activity.Id, which the Udyam rows do not have, so this was always cleared.
                // Registration stores ActivityDetail_Id; keep the column consistent with that.
                ActivityDetailId = Value(activity, "ActivityDetail_Id"),
                ZedId = zedId,
            }, ct);
        }
        catch (DbException ex)
        {
            log.LogError(ex, "SP_MSME_UPDATE_UDYAM_DETAILS failed for {ZedId}", zedId);
            return Result<string>.Fail("Unable to update the activity. Please try after some time.");
        }
        return Result<string>.Ok("Activity updated successfully.");
    }

    // ---------------------------------------------------------------- registered e-mail

    public const int MaxOtpSends = 5, MaxOtpFailures = 5;
    public static readonly TimeSpan OtpLifetime = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan SendWindow = TimeSpan.FromMinutes(30);
    private static readonly DistributedCacheEntryOptions StateLifetime = new() { AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(1) };

    public sealed class EmailChangeState
    {
        public string NewEmail { get; set; } = "";
        public string? OtpHash { get; set; }
        public DateTimeOffset? OtpIssuedUtc { get; set; }
        public DateTimeOffset? WindowStartUtc { get; set; }
        public int Sends { get; set; }
        public int Failures { get; set; }
    }

    private static string StateKey(string zedId) => "v4:msme-email-change:" + zedId.Trim().ToUpperInvariant();
    private static string HashOtp(string zedId, string newEmail, string otp) => RegistrationSession.HashOtp(zedId.ToUpperInvariant() + "|" + newEmail.ToLowerInvariant(), otp);

    /// <summary>
    /// "Change e-mail", step 1: a 6-digit OTP to the new address (10 minutes, 5 mails in 30 minutes). Returns the address
    /// the OTP went to, or the message to show.
    /// </summary>
    public async Task<Result<string>> SendEmailOtpAsync(string zedId, string? newEmail, CancellationToken ct)
    {
        var address = (newEmail ?? "").Trim();
        if (address.Length > 100 || !new EmailAddressAttribute().IsValid(address)) return Result<string>.Fail("Please enter a valid e-mail address.");
        var account = await PasswordResetTokens.FindMsmeAccountAsync(db, zedId, ct);
        if (account is null) return new(null, "Not found.", NotFound: true);
        if (string.Equals(account.MailAddress, address, StringComparison.OrdinalIgnoreCase))
            return Result<string>.Fail("This is already your registered e-mail.");
        // The same rule as at registration: an address of a staff login (assessor, consultant, trainee) is refused.
        var check = await db.QueryProcMultipleAsync("SP_MSME_VALIDATE_UDYAM_DETAILS",
            new { UdyogAadharNo = (string?)null, PlantIdNo = (string?)null, TwoDigitActivity = (string?)null, IpAddress = (string?)null, EmailId = address }, ct);
        if (check.Count > 2 && check[2].FirstOrDefault() is { } limit && limit.Text("EmailCountStatus") == "1")
            return Result<string>.Fail(limit.Text("ErrorMessage") is { Length: > 0 } m ? m : "This e-mail address cannot be used.");

        var key = StateKey(zedId);
        var now = DateTimeOffset.UtcNow;
        var state = await ReadAsync(key, ct) ?? new EmailChangeState();
        if (state.WindowStartUtc is null || now - state.WindowStartUtc > SendWindow)
        {
            state.WindowStartUtc = now;
            state.Sends = 0;
        }
        if (state.Sends >= MaxOtpSends) return Result<string>.Fail("Too many OTP requests. Please try again after 30 minutes.");

        var otp = SecureRandom.Otp();
        state.NewEmail = address;
        state.OtpHash = HashOtp(zedId, address, otp);
        state.OtpIssuedUtc = now;
        state.Sends++;
        state.Failures = 0;
        try
        {
            var html = await templates.RenderAsync<EmailChangeOtpEmail>(new Dictionary<string, object?>
            {
                [nameof(EmailChangeOtpEmail.Otp)] = otp,
                [nameof(EmailChangeOtpEmail.ZedId)] = account.ZedId,
                [nameof(EmailChangeOtpEmail.PublicBaseUrl)] = portal.Value.PublicBaseUrl,
            });
            await email.SendAsync(new EmailMessage(address, "OTP to change your registered e-mail on ZED - " + account.ZedId, html, EmailProfiles.Otp), ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "E-mail change OTP for {ZedId} could not be sent", zedId);
            return Result<string>.Fail("We could not send the OTP right now. Please try again after some time.");
        }
        await cache.SetAsync(key, JsonSerializer.SerializeToUtf8Bytes(state), StateLifetime, ct);
        return Result<string>.Ok(address);
    }

    /// <summary>
    /// "Change e-mail", step 2: the OTP of the last mail (10 minutes, 5 attempts) makes the new address the registered
    /// e-mail (Msme.PledgeEmailId: ZED mails and password links); the old address is told. Recorded in the edit history.
    /// </summary>
    public async Task<Result<string>> VerifyEmailOtpAsync(string zedId, string? otp, string channel, string? ip, CancellationToken ct)
    {
        var key = StateKey(zedId);
        var state = await ReadAsync(key, ct);
        if (state?.OtpHash is null || state.OtpIssuedUtc is null) return Result<string>.Fail("Please request an OTP first.");
        if (DateTimeOffset.UtcNow - state.OtpIssuedUtc > OtpLifetime) return Result<string>.Fail("The OTP has expired. Please request a new one.");
        if (state.Failures >= MaxOtpFailures) return Result<string>.Fail("Too many wrong attempts. Please request a new OTP.");
        var typed = (otp ?? "").Trim();
        if (typed.Length == 0 || !string.Equals(HashOtp(zedId, state.NewEmail, typed), state.OtpHash, StringComparison.Ordinal))
        {
            state.Failures++;
            await cache.SetAsync(key, JsonSerializer.SerializeToUtf8Bytes(state), StateLifetime, ct);
            return Result<string>.Fail(state.Failures >= MaxOtpFailures ? "Too many wrong attempts. Please request a new OTP." : "Invalid OTP.");
        }
        await cache.RemoveAsync(key, ct);

        var account = await PasswordResetTokens.FindMsmeAccountAsync(db, zedId, ct);
        var old = account?.MailAddress;
        await db.ExecuteSqlAsync("UPDATE dbo.Msme SET PledgeEmailId = @Email WHERE ZedId = @ZedId;", new { Email = state.NewEmail, ZedId = zedId }, ct);
        // The unit's copies in the consultancy and surveillance databases, where it has them (their mails read their own copy).
        foreach (var other in new[] { "ZED_CONSULTANT", "ZED_SURVEILLANCE" })
        {
            try
            {
                await db.ExecuteSqlAsync($"UPDATE {other}.dbo.Msme SET PledgeEmailId = @Email WHERE ZedId = @ZedId;", new { Email = state.NewEmail, ZedId = zedId }, ct);
            }
            catch (DbException ex)
            {
                log.LogWarning(ex, "The registered e-mail of {ZedId} could not be updated in {Database}", zedId, other);
            }
        }

        await history.RecordAsync(new MsmeEdit
        {
            Channel = channel, ZedId = zedId, Action = "Profile: e-mail changed", Path = "/profile/email", Success = true,
            Data = JsonSerializer.Serialize(new { email = new { from = old is null ? "(none)" : MsmeAccountFinder.MaskEmail(old), to = MsmeAccountFinder.MaskEmail(state.NewEmail) } }),
            IpAddress = ip,
        }, ct);

        if (old is not null)
        {
            try
            {
                var html = await templates.RenderAsync<EmailChangedEmail>(new Dictionary<string, object?>
                {
                    [nameof(EmailChangedEmail.ZedId)] = zedId,
                    [nameof(EmailChangedEmail.NewEmail)] = MsmeAccountFinder.MaskEmail(state.NewEmail),
                    [nameof(EmailChangedEmail.ChangedOn)] = DateTime.Now.ToString("dd-MM-yyyy HH:mm"),
                    [nameof(EmailChangedEmail.PublicBaseUrl)] = portal.Value.PublicBaseUrl,
                });
                await email.SendAsync(new EmailMessage(old, "Your registered e-mail on ZED was changed - " + zedId, html, EmailProfiles.Login), ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogWarning(ex, "The e-mail change notice for {ZedId} could not be sent to the old address", zedId);
            }
        }
        return Result<string>.Ok(state.NewEmail);
    }

    private async Task<EmailChangeState?> ReadAsync(string key, CancellationToken ct)
    {
        var bytes = await cache.GetAsync(key, ct);
        return bytes is null ? null : JsonSerializer.Deserialize<EmailChangeState>(bytes);
    }

    // ---------------------------------------------------------------- helpers

    private Task<ResultSets> Details(string zedId, CancellationToken ct) =>
        db.QueryProcMultipleAsync("SP_MSME_GET_DETAILS", new { ZedId = zedId, CertificationType = (string?)null }, ct);

    private sealed record OwnUdyam(string UdyamNumber, List<Dictionary<string, string>> Activities);

    /// <summary>Udyam record for the unit's own Udyam number and registered mobile.</summary>
    private async Task<Result<OwnUdyam>> OwnUdyamAsync(string zedId, CancellationToken ct)
    {
        var sets = await Details(zedId, ct);
        if (sets[0].FirstOrDefault() is not { } msme) return new(null, "Not found.", NotFound: true);
        var basic = sets[1].FirstOrDefault();
        var udyamNumber = basic?.Text("UdyogAadharNo") ?? "";
        var mobile = msme.Text("MobileNo") is { Length: > 0 } m ? m : basic?.Text("MobileNo") ?? "";
        if (udyamNumber.Length == 0 || mobile.Length == 0) return Result<OwnUdyam>.Fail("Udyam details are not available for this unit.");

        UdyamLookup lookup;
        try
        {
            lookup = await udyam.GetUdyamAsync(udyamNumber, mobile, ct);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or System.Xml.XmlException or InvalidOperationException)
        {
            log.LogWarning(ex, "Udyam lookup failed for {ZedId}", zedId);
            return new(null, UdyamUnavailable, Unavailable: true);
        }

        if (lookup.BasicDetails.Count == 0 || lookup.BasicDetails.GetValueOrDefault("UdyogAadharNo") == "NO")
            return Result<OwnUdyam>.Fail("It seems that the Registration Number provided is either not approved/verified OR does not exist in the UDYAM Database.");
        if (lookup.Activities.Count == 0)
            return Result<OwnUdyam>.Fail("It seems that the Activity Details are missing in your Udyam file, Please update the same on the Udyam portal and then try again here.");
        return Result<OwnUdyam>.Ok(new OwnUdyam(udyamNumber, lookup.Activities));
    }

    /// <summary>Copies the listed columns (null when the procedure did not return them).</summary>
    private static Dictionary<string, object?> Pick(IDictionary<string, object?>? row, string[] fields) =>
        fields.ToDictionary(f => f, f => row is not null && row.TryGetValue(f, out var v) && v is not DBNull ? v : null);
}
