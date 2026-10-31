using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Caching.Distributed;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Msme;
using Zed.Portal.Features.Staff.SubUsers;
using Zed.Portal.Features.Staff.Users;

namespace Zed.Portal.Features.Staff;

/// <summary>
/// Staff sign-in. Port of UserController.Login (SP_GET_USER_DETAILS, SP_UPDATE_LOGIN) plus the sub-roles
/// UserHelper.CheckSubRole read on every request (SP_GET_SUB_ROLE); here they are read once at sign-in
/// and carried in the cookie, so a change takes effect at the next sign-in.
/// <para>
/// The legacy procedure locks an account after 11 wrong passwords in 30 minutes (FailedLogins), whoever typed them. V4
/// passes at most <see cref="FailuresPerAddress"/> wrong passwords per client address and account to it in that time,
/// so one address cannot lock someone else's account (the single Admin's included); further attempts from that
/// address are refused before the procedure records them.
/// </para>
/// </summary>
[ApiController]
[Route("api/staff/auth")]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed class StaffAuthController(ISqlExecutor db, ICaptchaVerifier captcha, IDistributedCache cache, ILogger<StaffAuthController> log) : ControllerBase
{
    public sealed record LoginRequest(string UserId, string Password, string? CaptchaToken);

    /// <summary>Wrong passwords per client address and account in <see cref="FailureWindow"/> (the procedure locks at 11).</summary>
    public const int FailuresPerAddress = 5;
    public static readonly TimeSpan FailureWindow = TimeSpan.FromMinutes(30);
    public const string TooManyFailures = "Too many failed sign-in attempts. Please try again after 30 minutes.";

    [HttpPost("login")]
    [AllowAnonymous]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    [LoginAudit(LoginChannels.Web, "Staff")]
    public async Task<ActionResult<CurrentUserResponse>> Login(LoginRequest req, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.UserId) || string.IsNullOrEmpty(req.Password))
            return this.Problem400("Please enter your User ID and password.");
        if (!await captcha.VerifyAsync(req.CaptchaToken, HttpContext.Connection.RemoteIpAddress?.ToString(), ct))
            return this.Problem400("Invalid Captcha.");
        var subUsers = HttpContext.RequestServices.GetRequiredService<SubUserStore>();
        if (await subUsers.FindAsync(req.UserId.Trim(), ct) is { } subUser)
            return await SubUserLoginAsync(subUsers, subUser, req.Password, ct);
        var failures = new FailureBudget(cache, FailureKey(req.UserId.Trim()));
        if (await failures.CountAsync(ct) >= FailuresPerAddress)
        {
            // Not passed to the procedure, so not written to FailedLogins: this address cannot lock the account.
            log.LogWarning("Staff login for {UserId} from {Ip} refused: {Max} wrong passwords from this address", req.UserId, ClientIp, FailuresPerAddress);
            return this.Problem400(TooManyFailures);
        }
        var passwords = PasswordStore.For(db, HttpContext.RequestServices);
        var login = await passwords.BeginLoginAsync(req.UserId.Trim(), req.Password, ct);
        var sets = await db.QueryProcMultipleAsync("SP_GET_USER_DETAILS", new { UserId = req.UserId.Trim(), Password = login.ProcedurePassword }, ct);
        var row = sets[0].FirstOrDefault();
        if (row is null)
        {
            await failures.AddAsync(ct);
            // The procedure's own message (e.g. "ACCOUNT LOCKED ...") when it gives one.
            var message = sets.Scalar(1);
            return this.Problem400(string.IsNullOrEmpty(message) || message.StartsWith("INVALID", StringComparison.OrdinalIgnoreCase) ? "Invalid credentials." : message);
        }
        if (!await passwords.CompleteLoginAsync(login, row, ct))
        {
            await failures.AddAsync(ct);
            log.LogWarning("Blocked staff login for {UserId}: the password is not the account's own", req.UserId);
            return this.Problem400("Invalid credentials.");
        }
        await failures.ClearAsync(ct);

        var roleId = int.TryParse(row.Text("RoleId"), out var r) ? r : 0;
        if (roleId == (int)UserRole.Msme)
            return this.Problem400("This login is for ZED staff, agencies and assessors. MSMEs please use the MSME login.");
        if (!StaffRoles.IsStaff(roleId))
        {
            log.LogWarning("Sign-in refused for {UserId}: role {RoleId} has no access to this portal", row.Text("UserId"), roleId);
            return this.Problem400("Invalid credentials.");
        }

        if (AdminOnMain(roleId) is { } moved) return moved;

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

    private string? ClientIp => HttpContext.Connection.RemoteIpAddress?.ToString();

    private string FailureKey(string userId)
    {
        var system = HttpContext.RequestServices.GetRequiredService<PortalHost>().System;
        var id = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes((ClientIp ?? "unknown") + "|" + userId.ToUpperInvariant()));
        return "staff-login-failures:" + system + ":" + Convert.ToHexString(id);
    }

    /// <summary>
    /// The wrong passwords of one client address for one account, in the distributed cache for <see cref="FailureWindow"/>
    /// from the first. Read and written without a lock: parallel requests (at most 10 a minute per address) can pass a
    /// few more, still fewer than the procedure's 11.
    /// </summary>
    private sealed class FailureBudget(IDistributedCache cache, string key)
    {
        private sealed record Window(int Count, DateTimeOffset StartUtc);

        public async Task<int> CountAsync(CancellationToken ct) => (await ReadAsync(ct))?.Count ?? 0;

        public async Task AddAsync(CancellationToken ct)
        {
            var now = DateTimeOffset.UtcNow;
            var window = await ReadAsync(ct) is { } w && now - w.StartUtc < FailureWindow ? w with { Count = w.Count + 1 } : new Window(1, now);
            var left = window.StartUtc + FailureWindow - now;
            await cache.SetAsync(key, System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(window),
                new DistributedCacheEntryOptions { AbsoluteExpirationRelativeToNow = left > TimeSpan.FromSeconds(1) ? left : TimeSpan.FromSeconds(1) }, ct);
        }

        public Task ClearAsync(CancellationToken ct) => cache.RemoveAsync(key, ct);

        private async Task<Window?> ReadAsync(CancellationToken ct)
        {
            var bytes = await cache.GetAsync(key, ct);
            var window = bytes is null ? null : System.Text.Json.JsonSerializer.Deserialize<Window>(bytes);
            return window is not null && DateTimeOffset.UtcNow - window.StartUtc < FailureWindow ? window : null;
        }
    }

    /// <summary>
    /// One Admin (V4): the Consultancy and Surveillance portals' Admin works from the main portal (its portal switch and
    /// the sign-in hand-over, AdminPortalsController), so the Admin role (and its sub-users) no longer signs in here with a
    /// password. The problem carries adminOnMainPortal for the sign-in page's link.
    /// </summary>
    private ObjectResult? AdminOnMain(int roleId)
    {
        if (roleId != (int)UserRole.Admin || HttpContext.RequestServices.GetRequiredService<PortalHost>().System == PortalSystem.Main) return null;
        log.LogInformation("Admin sign-in on the {System} portal sent to the main portal", HttpContext.RequestServices.GetRequiredService<PortalHost>().System);
        var problem = new ProblemDetails
        {
            Status = StatusCodes.Status400BadRequest,
            Title = "The Admin of every portal now signs in on the main portal and chooses this portal there.",
        };
        problem.Extensions["adminOnMainPortal"] = true;
        return new ObjectResult(problem) { StatusCode = StatusCodes.Status400BadRequest };
    }

    /// <summary>
    /// A sub-user (dbo.V4SubUsers) signs in with its own password and then works as its owner: the owner's Users row, role
    /// and sub-roles, limited to the screens of its permissions (SubUserAccessFilter). The owner must still be active.
    /// </summary>
    private async Task<ActionResult<CurrentUserResponse>> SubUserLoginAsync(SubUserStore store, SubUserRow sub, string password, CancellationToken ct)
    {
        if (sub.LockedUntil is { } until && until > DateTime.UtcNow)
            return this.Problem400("ACCOUNT LOCKED. PLEASE LOGIN AFTER 15 MINUTES.");
        if (sub.PasswordHash is not { Length: > 0 } hash || PasswordStore.Verify(hash, password) == PasswordVerificationResult.Failed)
        {
            await store.LoginFailedAsync(sub.UserId, ct);
            log.LogWarning("Sub-user login failed for {UserId}", sub.UserId);
            return this.Problem400("Invalid credentials.");
        }
        if (!sub.IsActive) return this.Problem400("Invalid credentials.");

        var owner = (await db.QueryProcMultipleAsync("SP_GET_USER_DETAILS_BY_USER_ID", new { UserId = sub.OwnerUserId }, ct))[0].FirstOrDefault();
        var roleId = int.TryParse(owner?.Text("RoleId"), out var r) ? r : 0;
        if (owner is null || !StaffUserRules.Bool(owner, "IsActive") || roleId != sub.OwnerRoleId || !SubUserPermissions.CanOwn(roleId))
        {
            log.LogWarning("Sub-user {UserId} refused: owner {Owner} is not active", sub.UserId, sub.OwnerUserId);
            return this.Problem400("The account you work for is not active. Please contact your administrator.");
        }

        if (AdminOnMain(roleId) is { } moved) return moved;

        var ownerId = owner.Text("UserId");
        var subRow = (await db.QueryProcMultipleAsync("SP_GET_SUB_ROLE", new { UserId = ownerId, RoleId = roleId.ToString() }, ct))[0].FirstOrDefault();
        var subRoles = SubRoles.All.Where(s => subRow?.Text(s) == "1").ToList();
        var routes = SubUserPermissions.Granted(sub.Permissions, roleId, subRoles, HttpContext.RequestServices.GetRequiredService<PortalHost>().System)
            .SelectMany(p => p.Routes).Distinct().ToList();
        await store.LoginSucceededAsync(sub.UserId, ct);
        log.LogInformation("Sub-user {UserId} signed in for {Owner}", sub.UserId, ownerId);

        var user = new ZedUser(ownerId, owner.Text("UserName"), roleId, owner.Text("Email"), owner.Text("MobileNo"),
            owner.Text("StateCode"), owner.Text("DistrictCode"), SubRoles: subRoles,
            ActingUserId: sub.UserId, ActingUserName: sub.UserName, PermissionRoutes: routes);
        await HttpContext.SignInZedUserAsync(user);
        return CurrentUserResponse.From(user);
    }
}
