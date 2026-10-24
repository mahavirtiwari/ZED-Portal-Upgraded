using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.Masters;

namespace Zed.Portal.Features.Msme;

/// <summary>MSME login and password reset (<see cref="MsmePasswordResets"/>). Port of MsmeController Login / ResetPassword / ChangePassword.</summary>
[ApiController]
[Route("api/msme/auth")]
public sealed class MsmeAuthController(
    ISqlExecutor db,
    ICaptchaVerifier captcha,
    IWebHostEnvironment env,
    IOptions<PortalOptions> portal,
    ILogger<MsmeAuthController> log) : ControllerBase
{
    private static readonly FileExtensionContentTypeProvider ContentTypes = new();

    public sealed record LoginRequest(string UserId, string Password, string? CaptchaToken);

    [HttpPost("login")]
    [AllowAnonymous]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    [LoginAudit(LoginChannels.Web, "MSME")]
    public async Task<ActionResult<CurrentUserResponse>> Login(LoginRequest req, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.UserId) || string.IsNullOrEmpty(req.Password))
            return this.Problem400("Please enter your ZED ID and password.");
        if (!await captcha.VerifyAsync(req.CaptchaToken, HttpContext.Connection.RemoteIpAddress?.ToString(), ct))
            return this.Problem400("Invalid Captcha.");
        var userId = req.UserId.Trim();
        var passwords = PasswordStore.For(db, HttpContext.RequestServices);
        var login = await passwords.BeginLoginAsync(userId, req.Password, ct);
        var sets = await db.QueryProcMultipleAsync("SP_GET_USER_DETAILS", new { UserId = userId, Password = login.ProcedurePassword }, ct);
        var row = sets[0].FirstOrDefault();
        if (row is null)
            return this.Problem400(sets.Scalar(1) ?? "Invalid credentials.");
        if (!await passwords.CompleteLoginAsync(login, row, ct))
        {
            log.LogWarning("Blocked login for {UserId}: the password is not the account's own", userId);
            return this.Problem400("Invalid credentials.");
        }

        var roleId = int.TryParse(row.Text("RoleId"), out var r) ? r : 0;
        // This page is for MSME users only, as before; other roles sign in on the staff login.
        if (roleId != (int)UserRole.Msme)
            return this.Problem400("This login is for MSME users. Please use the staff login page.");

        await db.ExecuteProcAsync("SP_UPDATE_LOGIN",
            new { UserId = row.Text("UserId"), IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString(), RoleId = roleId.ToString() }, ct);

        var user = new ZedUser(row.Text("UserId"), row.Text("UserName"), roleId, row.Text("Email"),
            row.Text("MobileNo"), row.Text("StateCode"), row.Text("DistrictCode"));
        await HttpContext.SignInZedUserAsync(user);
        return CurrentUserResponse.From(user);
    }

    public sealed record BannerResponse(string? ImageUrl);

    /// <summary>
    /// Banner image shown on the login page (SP_MASTER_GET_HOME_PAGE_SETTINGS, as before). The old site stored it as a
    /// full URL into its own Images/HomePage folder, which V4 does not serve: the file is read from the storage root
    /// (where the Admin's Home Page Settings screen saves it) and served by <see cref="BannerImage"/>. Null when no
    /// stored file exists: the page then shows its built-in default banner.
    /// </summary>
    [HttpGet("banner")]
    [AllowAnonymous]
    public async Task<BannerResponse> Banner(CancellationToken ct) =>
        new(await StoredBannerAsync(ct) is { } path ? "/api/msme/auth/banner/image?v=" + Uri.EscapeDataString(Path.GetFileNameWithoutExtension(path)) : null);

    [HttpGet("banner/image")]
    [AllowAnonymous]
    public async Task<IActionResult> BannerImage(CancellationToken ct)
    {
        if (await StoredBannerAsync(ct) is not { } path) return NotFound();
        var full = MsmeFilePaths.Resolve(StorageRoot, path)!;
        Response.Headers.XContentTypeOptions = "nosniff";
        Response.Headers.CacheControl = "public, max-age=3600";
        return PhysicalFile(full, ContentTypes.TryGetContentType(full, out var type) ? type : "application/octet-stream");
    }

    private string StorageRoot => Path.GetFullPath(Path.Combine(env.ContentRootPath, portal.Value.StorageRoot));

    /// <summary>The current banner's relative path when its file is in the storage root, else null.</summary>
    private async Task<string?> StoredBannerAsync(CancellationToken ct)
    {
        var row = (await db.QueryProcMultipleAsync("SP_MASTER_GET_HOME_PAGE_SETTINGS", new { FileName = StaffDocumentsController.BannerSetting }, ct))[0].FirstOrDefault();
        var path = StaffDocumentsController.BannerPath(row?.Text("FilePath"));
        var full = path is null ? null : MsmeFilePaths.Resolve(StorageRoot, path);
        return full is not null && System.IO.File.Exists(full) ? path : null;
    }

    public sealed record ForgotPasswordRequest(string UserId);

    public const string ForgotPasswordAnswer = "If the ZED ID is registered, a reset link has been sent to the registered Email ID.";

    /// <summary>
    /// Sends a reset link to the registered e-mail. The answer is the same for every ZED ID and is sent before the
    /// lookup: the lookup, the link and the mail run in the background (<see cref="MsmePasswordResets"/>), so neither
    /// the answer nor its timing tells whether a ZED ID exists.
    /// </summary>
    [HttpPost("forgot-password")]
    [AllowAnonymous]
    [EnableRateLimiting(RateLimitPolicies.PasswordReset)]
    public ActionResult<MessageResponse> ForgotPassword(ForgotPasswordRequest req, [FromServices] IBackgroundWork background)
    {
        var zedId = req.UserId?.Trim();
        if (string.IsNullOrEmpty(zedId)) return this.Problem400("Please enter your ZED ID.");
        if (zedId.Length > 50) return new MessageResponse(ForgotPasswordAnswer);
        var ip = HttpContext.Connection.RemoteIpAddress?.ToString();
        background.Enqueue("MSME password reset request", (sp, stop) => sp.GetRequiredService<MsmePasswordResets>().RequestAsync(zedId, ip, stop));
        return new MessageResponse(ForgotPasswordAnswer);
    }

    public sealed record TokenRequest(string? Token);

    /// <summary>Whether a link can still be used (the reset page asks before showing the form). The token travels in the body.</summary>
    [HttpPost("reset-password/check")]
    [AllowAnonymous]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<ActionResult<MessageResponse>> CheckResetLink(TokenRequest req, [FromServices] MsmePasswordResets resets, CancellationToken ct) =>
        await resets.IsOpenAsync(req.Token, ct)
            ? new MessageResponse("Valid")
            : this.Problem400(PasswordResetTokens.InvalidLink);

    public sealed record ResetPasswordRequest(string? Token, string? NewPassword, string? ConfirmPassword);

    [HttpPost("reset-password")]
    [AllowAnonymous]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<ActionResult<MessageResponse>> ResetPassword(ResetPasswordRequest req, [FromServices] MsmePasswordResets resets, CancellationToken ct)
    {
        if (req.NewPassword != req.ConfirmPassword)
            return this.Problem400("NewPassword and ConfirmPassword should be same.");
        if (PasswordPolicy.Validate(req.NewPassword) is { } policyError)
            return this.Problem400(policyError);

        var error = await resets.ResetAsync(req.Token, req.NewPassword!, HttpContext.Connection.RemoteIpAddress?.ToString(), ct);
        return error is null ? new MessageResponse("Password reset successful.") : this.Problem400(error);
    }
}
