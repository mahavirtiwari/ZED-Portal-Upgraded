using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Msme;

namespace Zed.Portal.Features.Staff;

/// <summary>
/// Staff sign-in. Port of UserController.Login (SP_GET_USER_DETAILS, SP_UPDATE_LOGIN) plus the sub-roles
/// UserHelper.CheckSubRole read on every request (SP_GET_SUB_ROLE); here they are read once at sign-in
/// and carried in the cookie, so a change takes effect at the next sign-in.
/// </summary>
[ApiController]
[Route("api/staff/auth")]
public sealed class StaffAuthController(ISqlExecutor db, ICaptchaVerifier captcha, ILogger<StaffAuthController> log) : ControllerBase
{
    public sealed record LoginRequest(string UserId, string Password, string? CaptchaToken);

    [HttpPost("login")]
    [AllowAnonymous]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<ActionResult<CurrentUserResponse>> Login(LoginRequest req, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.UserId) || string.IsNullOrEmpty(req.Password))
            return this.Problem400("Please enter your User ID and password.");
        if (!await captcha.VerifyAsync(req.CaptchaToken, HttpContext.Connection.RemoteIpAddress?.ToString(), ct))
            return this.Problem400("Invalid Captcha.");
        var sets = await db.QueryProcMultipleAsync("SP_GET_USER_DETAILS", new { UserId = req.UserId.Trim(), req.Password }, ct);
        var row = sets[0].FirstOrDefault();
        if (row is null)
        {
            // The procedure's own message (e.g. "ACCOUNT LOCKED ...") when it gives one.
            var message = sets.Scalar(1);
            return this.Problem400(string.IsNullOrEmpty(message) || message.StartsWith("INVALID", StringComparison.OrdinalIgnoreCase) ? "Invalid credentials." : message);
        }
        if (!LegacyPasswords.MatchesStored(row, req.Password))
        {
            log.LogWarning("Blocked staff login with a procedure master password for {UserId}", req.UserId);
            return this.Problem400("Invalid credentials.");
        }

        var roleId = int.TryParse(row.Text("RoleId"), out var r) ? r : 0;
        if (roleId == (int)UserRole.Msme)
            return this.Problem400("This login is for ZED staff, agencies and assessors. MSMEs please use the MSME login.");
        if (!StaffRoles.IsStaff(roleId))
        {
            log.LogWarning("Sign-in refused for {UserId}: role {RoleId} has no access to this portal", row.Text("UserId"), roleId);
            return this.Problem400("Invalid credentials.");
        }

        var userId = row.Text("UserId");
        var sub = (await db.QueryProcMultipleAsync("SP_GET_SUB_ROLE", new { UserId = userId, RoleId = roleId.ToString() }, ct))[0].FirstOrDefault();
        var subRoles = SubRoles.All.Where(s => sub?.Text(s) == "1").ToList();

        await db.ExecuteProcAsync("SP_UPDATE_LOGIN",
            new { UserId = userId, IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString(), RoleId = roleId.ToString() }, ct);

        var user = new ZedUser(userId, row.Text("UserName"), roleId, row.Text("Email"), row.Text("MobileNo"),
            row.Text("StateCode"), row.Text("DistrictCode"), SubRoles: subRoles);
        await HttpContext.SignInZedUserAsync(user);
        return CurrentUserResponse.From(user);
    }
}
