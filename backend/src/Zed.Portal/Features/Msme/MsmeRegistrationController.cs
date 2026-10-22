using System.ComponentModel.DataAnnotations;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Portal.Features.Msme;

/// <summary>
/// New MSME registration (Udyam). Port of MsmeController.Register / ValidateUam /
/// ValidatePlantAndActivity / SendPledgeEmailOtp / VerifyPledgeEmailOtp / FinalSubmit.
/// Each step is checked on the server, in order. The MSME app's registration uses the same
/// <see cref="MsmeRegistrationService"/> (<see cref="MsmeAppRegistrationController"/>).
/// </summary>
[ApiController]
[Route("api/msme/registration")]
[AllowAnonymous]
public sealed partial class MsmeRegistrationController(
    ICaptchaVerifier captcha,
    IUdyamClient udyam,
    RegistrationSessionStore sessions,
    MsmeRegistrationService registration,
    ILogger<MsmeRegistrationController> log) : ControllerBase
{
    private const int MaxOtpSends = 5, MaxOtpFailures = 5;
    private static readonly TimeSpan OtpLifetime = TimeSpan.FromMinutes(10);

    [GeneratedRegex(@"^UDYAM-[A-Z]{2}-\d{2}-\d{7}$")] internal static partial Regex UdyamPattern();
    [GeneratedRegex(@"^\d{10}$")] internal static partial Regex MobilePattern();

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

        var (lookup, error) = await LookupUdyamAsync(udyam, regNo, mobile, log, ct);
        if (lookup is null)
            return error == UdyamUnavailable
                ? Problem(title: error, statusCode: StatusCodes.Status502BadGateway)
                : this.Problem400(error!);

        var session = new RegistrationSession { RegistrationNo = regNo, MobileNo = mobile, Lookup = lookup };
        await sessions.SaveAsync(session, ct);
        return new LookupResponse(session.Id, lookup.BasicDetails, lookup.Plants, lookup.Activities);
    }

    internal const string UdyamUnavailable = "Unexpected error occured. Please try after some time.";

    /// <summary>The Udyam record of the number and mobile, or the message the user sees (legacy wording).</summary>
    internal static async Task<(UdyamLookup? Lookup, string? Error)> LookupUdyamAsync(IUdyamClient udyam, string regNo, string mobile,
        ILogger log, CancellationToken ct)
    {
        UdyamLookup lookup;
        try
        {
            lookup = await udyam.GetUdyamAsync(regNo, mobile, ct);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or System.Xml.XmlException or InvalidOperationException)
        {
            log.LogWarning(ex, "Udyam lookup failed for {RegNo}", regNo);
            return (null, UdyamUnavailable);
        }

        if (lookup.BasicDetails.Count == 0)
            return (null, "It seems that the Registration Number provided is either not approved/verified OR does not exist in the UDYAM Database.");
        if (lookup.BasicDetails.GetValueOrDefault("UdyogAadharNo") == "NO")
            return (null, "It seems that the Registration Number does not exist in the UDYAM Database.");
        if (lookup.Plants.Count == 0)
            return (null, "It seems that the Plant Details are missing in your Udyam file, Please update the same on the Udyam portal and then try again here.");
        if (lookup.Activities.Count == 0)
            return (null, "It seems that the Activity Details are missing in your Udyam file, Please update the same on the Udyam portal and then try again here.");
        return (lookup, null);
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

        if (await registration.CheckEligibilityAsync(s, emailId: null, ClientIp, ct) is { } error) return this.Problem400(error);
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
        if (await registration.CheckEligibilityAsync(s, address, ClientIp, ct) is { } error) return this.Problem400(error);

        var otp = SecureRandom.Otp();
        s.Email = address;
        s.EmailVerified = false;
        s.OtpHash = RegistrationSession.HashOtp(s.Id, otp);
        s.OtpIssuedUtc = DateTimeOffset.UtcNow;
        s.OtpSends++;
        s.OtpFailures = 0;

        if (!await registration.SendOtpMailAsync(address, otp, ct))
            return Problem(title: "We could not send the OTP email right now. Please try again after some time.",
                statusCode: StatusCodes.Status502BadGateway);
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
        if (s.Plant is null || s.Activity is null) return this.Problem400("Please select one Plant location and its activity.");
        if (!s.EmailVerified || s.Email is null) return this.Problem400("Please verify your Email ID.");
        if (await registration.CheckEligibilityAsync(s, s.Email, ClientIp, ct) is { } error) return this.Problem400(error);

        // The legacy page never set RegistrationFrom, so web registrations were stored as "App".
        if (await registration.CompleteAsync(s, "App", ClientIp, ct) is not { } done)
            return this.Problem400(MsmeRegistrationService.RegistrationFailed);

        await sessions.RemoveAsync(s.Id, ct);
        await HttpContext.SignInZedUserAsync(done.User);
        return new SubmitResponse(done.ZedId, done.UnitName, done.EmailSent);
    }

    private ObjectResult SessionExpired() =>
        Problem(title: "Your registration session has expired. Please start again.", statusCode: StatusCodes.Status410Gone);
}
