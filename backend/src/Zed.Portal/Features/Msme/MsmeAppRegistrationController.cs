using System.ComponentModel.DataAnnotations;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Caching.Distributed;
using Zed.Core.Http;
using Zed.Core.Mobile;
using Zed.Core.Security;

namespace Zed.Portal.Features.Msme;

/// <summary>Settings <c>MsmeAppRegistration:*</c> (docs/MOBILE-API.md, "MSME app registration").</summary>
public sealed class MsmeAppRegistrationOptions
{
    public const string Section = "MsmeAppRegistration";

    /// <summary>
    /// The plant check and the OTP mail are accepted only from an address whose captcha passed in the last 30 minutes.
    /// The app sends no session, so the address is the only link between its calls; switch off only if users behind
    /// changing carrier addresses cannot finish (the per-e-mail and per-address limits still apply).
    /// </summary>
    public bool RequireCaptchaFromSameIp { get; set; } = true;
}

/// <summary>
/// The MSME app's registration (store app code base, docs/mobile/MSME-APP.md): <c>Msme/ValidateCaptcha</c>,
/// <c>Msme/ValidatePlantAndActivity</c>, <c>Msme/SendPledgeEmailOtp</c>, <c>Msme/VerifyPledgeEmailOtp</c> and
/// <c>Msme/FinalSubmit</c> on the main portal, JSON bodies, <c>{status, errorMessage}</c> answers, no cookies or session.
/// <para>
/// The legacy actions trusted the app: FinalSubmit stored whatever Udyam details, plant and activity it posted, without
/// checking that the pledge e-mail had been verified. Here FinalSubmit needs an OTP-verified pledge e-mail, fetches the
/// Udyam record itself (the number and mobile from the request; the app's own Udyam copy is ignored), finds the chosen
/// plant and activity in it, re-checks eligibility and registers through <see cref="MsmeRegistrationService"/>, the same
/// code as the web pages. The OTP is 4 characters (the app's field takes 4 capitals), valid 10 minutes, 5 wrong attempts,
/// 5 mails per address in 30 minutes; the state lives on the server, keyed by the e-mail address, as the app sends nothing else.
/// </para>
/// </summary>
public sealed class MsmeAppRegistrationController(
    IAppCaptchaVerifier captcha,
    IUdyamClient udyam,
    AppRegistrationStore store,
    MsmeRegistrationService registration,
    IConfiguration config,
    ILoggerFactory loggers) : LegacyMobileController
{
    public const string AuditCategory = "Zed.Audit.MsmeAppRegistration";
    public const string InvalidData = "Invalid Data, please select details again";
    public const string CaptchaFirst = "Please verify the captcha again.";
    public const string EmailNotVerified = "Please verify your Email ID.";
    public const string UamNotSupported = "Registration with Udyog Aadhaar (UAM) is no longer supported. Please register with your Udyam Registration Number.";

    private const int MaxOtpSends = 5, MaxOtpFailures = 5;
    private static readonly TimeSpan OtpLifetime = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan SendWindow = TimeSpan.FromMinutes(30);
    private static readonly TimeSpan VerifiedFor = TimeSpan.FromMinutes(30);

    private readonly ILogger audit = loggers.CreateLogger(AuditCategory);
    private readonly ILogger log = loggers.CreateLogger<MsmeAppRegistrationController>();

    private MsmeAppRegistrationOptions Options =>
        config.GetSection(MsmeAppRegistrationOptions.Section).Get<MsmeAppRegistrationOptions>() ?? new();

    private static ContentResult Success() => LegacyJson(ServiceResponse.Ok());

    /// <summary>MsmeController.ValidateCaptcha: the app's SafetyNet reCAPTCHA token (Recaptcha:AppSecretKey).</summary>
    [HttpPost("/Msme/ValidateCaptcha")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<IActionResult> ValidateCaptcha(string? token, CancellationToken ct)
    {
        if (!await captcha.VerifyAsync(token, ClientIp, ct))
        {
            Audit("captcha refused", null);
            return Fail("Invalid Captcha.");
        }
        await store.MarkCaptchaAsync(ClientIp, ct);
        return Success();
    }

    /// <summary>MsmeController.ValidatePlantAndActivity: SP_MSME_VALIDATE_UDYAM_DETAILS for the chosen plant and activity.</summary>
    [HttpPost("/Msme/ValidatePlantAndActivity")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<IActionResult> ValidatePlantAndActivity(string? udyogAadharNo, string? plantIdNo, string? twoDigitActivity, CancellationToken ct)
    {
        if (!await CaptchaPassedAsync(ct)) return Fail(CaptchaFirst);
        var regNo = (udyogAadharNo ?? "").Trim().ToUpperInvariant();
        if (!MsmeRegistrationController.UdyamPattern().IsMatch(regNo) || Clean(plantIdNo, 50) is not { } plant || Clean(twoDigitActivity, 200) is not { } activity)
            return Fail(InvalidData);

        if (await registration.CheckEligibilityAsync(regNo, plant, activity, emailId: null, ClientIp, ct) is { } error)
        {
            Audit($"plant check refused: {error}", regNo);
            return Fail(error);
        }
        return Success();
    }

    /// <summary>MsmeController.SendPledgeEmailOtp: a 4-character OTP to the pledge e-mail.</summary>
    [HttpPost("/Msme/SendPledgeEmailOtp")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<IActionResult> SendPledgeEmailOtp(string? email, CancellationToken ct)
    {
        if (!await CaptchaPassedAsync(ct)) return Fail(CaptchaFirst);
        if (Email(email) is not { } address) return Fail("Invalid email.");

        var now = DateTimeOffset.UtcNow;
        var state = await store.GetAsync(address, ct) ?? new AppRegistrationState();
        if (state.WindowStartUtc is null || now - state.WindowStartUtc > SendWindow)
        {
            state.WindowStartUtc = now;
            state.Sends = 0;
        }
        if (state.Sends >= MaxOtpSends)
        {
            Audit("OTP refused (too many requests)", address);
            return Fail("Too many OTP requests. Please try again after 30 minutes.");
        }

        var otp = SecureRandom.UpperCode(4);
        state.OtpHash = AppRegistrationState.HashOtp(address, otp);
        state.OtpIssuedUtc = now;
        state.Sends++;
        state.Failures = 0;
        state.VerifiedUtc = null;
        if (!await registration.SendOtpMailAsync(address, otp, ct))
            return Fail("We could not send the OTP email right now. Please try again after some time.");
        await store.SaveAsync(address, state, ct);
        Audit("OTP sent", address);
        return Success();
    }

    /// <summary>MsmeController.VerifyPledgeEmailOtp: the OTP of the last mail, once, within 10 minutes, 5 attempts.</summary>
    [HttpPost("/Msme/VerifyPledgeEmailOtp")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<IActionResult> VerifyPledgeEmailOtp(string? email, string? otp, CancellationToken ct)
    {
        if (Email(email) is not { } address || await store.GetAsync(address, ct) is not { } state
            || state.OtpHash is null || state.OtpIssuedUtc is null || DateTimeOffset.UtcNow - state.OtpIssuedUtc > OtpLifetime)
            return Fail("The OTP has expired. Please request a new one.");
        if (state.Failures >= MaxOtpFailures) return Fail("Too many wrong attempts. Please request a new OTP.");

        var given = AppRegistrationState.HashOtp(address, (otp ?? "").Trim());
        if (!CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(given), Encoding.ASCII.GetBytes(state.OtpHash)))
        {
            state.Failures++;
            await store.SaveAsync(address, state, ct);
            Audit("OTP wrong", address);
            return Fail("Invalid OTP.");
        }

        state.OtpHash = null;
        state.VerifiedUtc = DateTimeOffset.UtcNow;
        await store.SaveAsync(address, state, ct);
        Audit("e-mail verified", address);
        return Success();
    }

    /// <summary>The app's registration request (RegistrationRequest): only the identifiers are used.</summary>
    public sealed class AppRegistrationRequest
    {
        public string? PledgeEmailId { get; set; }
        public string? RegistrationType { get; set; }
        public string? RegistrationFrom { get; set; }
        public JsonObject? BasicDetails { get; set; }
        public JsonObject? PlantDetails { get; set; }
        public JsonObject? ActivityDetails { get; set; }
    }

    /// <summary>MsmeController.FinalSubmit (app): registers the MSME from the server's own Udyam lookup.</summary>
    [HttpPost("/Msme/FinalSubmit")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<IActionResult> FinalSubmit(AppRegistrationRequest req, CancellationToken ct)
    {
        if (req.RegistrationType is { Length: > 0 } type && !type.Equals("UDYAM", StringComparison.OrdinalIgnoreCase))
            return Fail(UamNotSupported);

        var regNo = (Field(req.BasicDetails, "UdyogAadharNo") ?? "").ToUpperInvariant();
        var mobile = Field(req.BasicDetails, "MobileNo") ?? "";
        var plantId = Clean(Field(req.PlantDetails, "PlantIdNo"), 50);
        if (!MsmeRegistrationController.UdyamPattern().IsMatch(regNo) || !MsmeRegistrationController.MobilePattern().IsMatch(mobile) || plantId is null)
            return Fail(InvalidData);
        if (Email(req.PledgeEmailId) is not { } address) return Fail("Invalid email.");

        if (await store.GetAsync(address, ct) is not { VerifiedUtc: { } verified } || DateTimeOffset.UtcNow - verified > VerifiedFor)
        {
            Audit("registration refused (e-mail not verified)", regNo);
            return Fail(EmailNotVerified);
        }

        var (lookup, error) = await MsmeRegistrationController.LookupUdyamAsync(udyam, regNo, mobile, log, ct);
        if (lookup is null)
        {
            Audit($"registration refused (Udyam: {error})", regNo);
            return Fail(error!);
        }

        // The plant and activity the user chose, found in the server's copy of the Udyam record.
        var plantIndex = lookup.Plants.FindIndex(p => Same(p.GetValueOrDefault("PlantIdNo"), plantId));
        var activityIndex = FindActivity(lookup, req.ActivityDetails);
        if (plantIndex < 0 || activityIndex < 0)
        {
            Audit("registration refused (plant or activity not in the Udyam record)", regNo);
            return Fail(InvalidData);
        }

        var session = new RegistrationSession
        {
            RegistrationNo = regNo, MobileNo = mobile, Lookup = lookup,
            PlantIndex = plantIndex, ActivityIndex = activityIndex, Email = address, EmailVerified = true,
        };
        if (await registration.CheckEligibilityAsync(session, address, ClientIp, ct) is { } refused)
        {
            Audit($"registration refused: {refused}", regNo);
            return Fail(refused);
        }

        // The app sends RegistrationFrom "Android"; the legacy action stored it as given.
        if (await registration.CompleteAsync(session, "Android", ClientIp, ct) is not { } done)
            return Fail(MsmeRegistrationService.RegistrationFailed);

        await store.RemoveAsync(address, ct); // the verification is single use
        audit.LogInformation("MSME app registration: {ZedId} registered for {RegNo} plant {Plant} from {Ip}", done.ZedId, regNo, plantId, ClientIp);
        return Success();
    }

    private static int FindActivity(UdyamLookup lookup, JsonObject? chosen)
    {
        if (Field(chosen, "ActivityDetail_Id") is { Length: > 0 } id)
        {
            var byId = lookup.Activities.FindIndex(a => Same(a.GetValueOrDefault("ActivityDetail_Id"), id));
            if (byId >= 0) return byId;
        }
        var two = Field(chosen, "Two_DigitActivity");
        var four = Field(chosen, "Four_DigitActivity");
        var five = Field(chosen, "Five_DigitActivity");
        if (two is null) return -1;
        return lookup.Activities.FindIndex(a => Same(a.GetValueOrDefault("Two_DigitActivity"), two)
            && (four is null || Same(a.GetValueOrDefault("Four_DigitActivity"), four))
            && (five is null || Same(a.GetValueOrDefault("Five_DigitActivity"), five)));
    }

    private async Task<bool> CaptchaPassedAsync(CancellationToken ct)
    {
        if (!Options.RequireCaptchaFromSameIp) return true;
        if (await store.CaptchaPassedAsync(ClientIp, ct)) return true;
        Audit("refused (no captcha from this address)", null);
        return false;
    }

    private static bool Same(string? a, string? b) => a is not null && b is not null && string.Equals(a.Trim(), b.Trim(), StringComparison.OrdinalIgnoreCase);

    private static string? Clean(string? value, int max)
    {
        var v = (value ?? "").Trim();
        return v.Length is > 0 && v.Length <= max && !v.Any(char.IsControl) ? v : null;
    }

    private static string? Email(string? value)
    {
        var v = (value ?? "").Trim();
        return v.Length is > 0 and <= 100 && new EmailAddressAttribute().IsValid(v) ? v : null;
    }

    /// <summary>A field of the app's JSON object, case-insensitively, as text.</summary>
    private static string? Field(JsonObject? o, string name)
    {
        if (o is null) return null;
        foreach (var (key, value) in o)
        {
            if (!string.Equals(key, name, StringComparison.OrdinalIgnoreCase) || value is not JsonValue v) continue;
            var text = v.GetValueKind() == JsonValueKind.String ? v.GetValue<string>() : v.ToJsonString();
            return string.IsNullOrWhiteSpace(text) ? null : text.Trim();
        }
        return null;
    }

    private void Audit(string outcome, string? subject) =>
        audit.LogInformation("MSME app registration from {Ip}: {Outcome} ({Subject})", ClientIp, outcome, subject ?? "-");
}

/// <summary>The app's OTP and verification state for one pledge e-mail address.</summary>
public sealed class AppRegistrationState
{
    public string? OtpHash { get; set; }
    public DateTimeOffset? OtpIssuedUtc { get; set; }
    public DateTimeOffset? WindowStartUtc { get; set; }
    public int Sends { get; set; }
    public int Failures { get; set; }
    public DateTimeOffset? VerifiedUtc { get; set; }

    public static string HashOtp(string email, string otp) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("msme-app:" + email.ToUpperInvariant() + ":" + otp.ToUpperInvariant())));
}

/// <summary>Server-side state of the app's registration (distributed cache): per e-mail address, and captcha passes per client address.</summary>
public sealed class AppRegistrationStore(IDistributedCache cache)
{
    private static readonly DistributedCacheEntryOptions StateLifetime = new() { AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(1) };
    private static readonly DistributedCacheEntryOptions CaptchaLifetime = new() { AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(30) };

    public async Task<AppRegistrationState?> GetAsync(string email, CancellationToken ct)
    {
        var bytes = await cache.GetAsync(StateKey(email), ct);
        return bytes is null ? null : JsonSerializer.Deserialize<AppRegistrationState>(bytes);
    }

    public Task SaveAsync(string email, AppRegistrationState state, CancellationToken ct) =>
        cache.SetAsync(StateKey(email), JsonSerializer.SerializeToUtf8Bytes(state), StateLifetime, ct);

    public Task RemoveAsync(string email, CancellationToken ct) => cache.RemoveAsync(StateKey(email), ct);

    public Task MarkCaptchaAsync(string? ip, CancellationToken ct) => cache.SetAsync(CaptchaKey(ip), [1], CaptchaLifetime, ct);

    public async Task<bool> CaptchaPassedAsync(string? ip, CancellationToken ct) => await cache.GetAsync(CaptchaKey(ip), ct) is not null;

    private static string StateKey(string email) =>
        "msme-app-reg:" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(email.Trim().ToUpperInvariant())));

    private static string CaptchaKey(string? ip) => "msme-app-captcha:" + (ip ?? "unknown");
}
