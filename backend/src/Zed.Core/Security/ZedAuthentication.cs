using System.Security.Claims;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using PortalOptions = Zed.Core.Http.PortalOptions;

namespace Zed.Core.Security;

/// <summary>Claim types carried in the auth cookie (replaces Session["CurrentUser"]).</summary>
public static class ZedClaims
{
    public const string UserId = ClaimTypes.NameIdentifier;
    public const string UserName = ClaimTypes.Name;
    public const string Role = ClaimTypes.Role;
    public const string RoleId = "zed:role_id";
    public const string Email = ClaimTypes.Email;
    public const string MobileNo = "zed:mobile";
    public const string StateCode = "zed:state";
    public const string DistrictCode = "zed:district";
    public const string UnitName = "zed:unit";
    public const string SubRole = "zed:subrole";
    /// <summary>A sub-user working as the signed-in owner (dbo.V4SubUsers): its own ID and name.</summary>
    public const string ActingUserId = "zed:acting_user";
    public const string ActingUserName = "zed:acting_name";
    /// <summary>Staff screens (Angular routes) a sub-user may open; the API checks its permissions on every call.</summary>
    public const string PermissionRoute = "zed:route";
    /// <summary>Users.SessionStamp at sign-in (<see cref="SessionStamps"/>); absent while the column is NULL.</summary>
    public const string SessionStamp = "zed:stamp";
    /// <summary>"Main" when the stamp is the main database's (the Admin handed over to the Consultancy / Surveillance portal).</summary>
    public const string SessionStampSource = "zed:stamp_db";
    /// <summary>A sub-user's own stamp (its password and permissions, SubUserStore.SessionStamp), checked by SubUserAccessFilter.</summary>
    public const string ActingStamp = "zed:acting_stamp";
}

/// <summary>
/// Sub-roles of agencies and assessors (Users.DesktopVerification / SiteVerification / FinancialVerification,
/// read by SP_GET_SUB_ROLE). Other staff roles have all three.
/// </summary>
public static class SubRoles
{
    public const string DesktopVerification = "DesktopVerification";
    public const string SiteVerification = "SiteVerification";
    public const string FinancialVerification = "FinancialVerification";
    public static readonly string[] All = [DesktopVerification, SiteVerification, FinancialVerification];
}

public sealed record ZedUser(
    string UserId, string UserName, int RoleId, string? Email, string? MobileNo,
    string? StateCode, string? DistrictCode, string? UnitName = null, IReadOnlyList<string>? SubRoles = null,
    string? ActingUserId = null, string? ActingUserName = null, IReadOnlyList<string>? PermissionRoutes = null,
    string? ActingStamp = null)
{
    public bool HasSubRole(string subRole) => SubRoles?.Contains(subRole) == true;

    /// <summary>
    /// Signed in as a sub-user (<see cref="ActingUserId"/>) working as its owner: <see cref="UserId"/>, the role and the
    /// sub-roles are the owner's, so every procedure and check sees the owner.
    /// </summary>
    public bool IsSubUser => !string.IsNullOrEmpty(ActingUserId);

    public string RoleName => Enum.IsDefined(typeof(UserRole), RoleId) ? ((UserRole)RoleId).ToString() : "None";

    public ClaimsPrincipal ToPrincipal()
    {
        var claims = new List<Claim>
        {
            new(ZedClaims.UserId, UserId),
            new(ZedClaims.UserName, UserName),
            new(ZedClaims.RoleId, RoleId.ToString()),
            new(ZedClaims.Role, RoleName),
        };
        void Add(string type, string? value) { if (!string.IsNullOrEmpty(value)) claims.Add(new Claim(type, value)); }
        Add(ZedClaims.Email, Email);
        Add(ZedClaims.MobileNo, MobileNo);
        Add(ZedClaims.StateCode, StateCode);
        Add(ZedClaims.DistrictCode, DistrictCode);
        Add(ZedClaims.UnitName, UnitName);
        foreach (var sub in SubRoles ?? []) claims.Add(new Claim(ZedClaims.SubRole, sub));
        Add(ZedClaims.ActingUserId, ActingUserId);
        Add(ZedClaims.ActingUserName, ActingUserName);
        foreach (var route in PermissionRoutes ?? []) claims.Add(new Claim(ZedClaims.PermissionRoute, route));
        Add(ZedClaims.ActingStamp, ActingStamp);
        return new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme));
    }

    public static ZedUser? FromPrincipal(ClaimsPrincipal principal)
    {
        if (principal.Identity?.IsAuthenticated != true) return null;
        string? Get(string t) => principal.FindFirst(t)?.Value;
        return new ZedUser(
            Get(ZedClaims.UserId) ?? "", Get(ZedClaims.UserName) ?? "",
            int.TryParse(Get(ZedClaims.RoleId), out var r) ? r : 0,
            Get(ZedClaims.Email), Get(ZedClaims.MobileNo), Get(ZedClaims.StateCode),
            Get(ZedClaims.DistrictCode), Get(ZedClaims.UnitName),
            principal.FindAll(ZedClaims.SubRole).Select(c => c.Value).ToList(),
            Get(ZedClaims.ActingUserId), Get(ZedClaims.ActingUserName),
            Get(ZedClaims.ActingUserId) is null ? null : principal.FindAll(ZedClaims.PermissionRoute).Select(c => c.Value).ToList(),
            Get(ZedClaims.ActingStamp));
    }
}

/// <summary>Same role ids as the legacy UserRoleEnum (Users.RoleId column).</summary>
public enum UserRole
{
    None = 0, Admin = 1, Agency = 2, DesktopAssessor = 3, SiteAssessor = 4,
    /// <summary>MSME users. The legacy name was "Ulb".</summary>
    Msme = 5,
    StateCoordinator = 6, MasterAdmin = 7, Ministry = 8, Scorer = 9, SuperAdmin = 10,
    CitizenFeedback = 11, CallCenter = 12, Sampling = 13, RegionalManager = 14, CourierReceiver = 15,
    Expert = 16, QC = 17, Special = 18, ShortlistPhotos = 19, Helpdesk = 20, ScanningCenter = 21,
    ScanningSeparator = 22, ScanningHead = 23, InformalWastePickers = 24, SpecialPhotos = 25,
    Innovation = 26, SlpQc = 27, Ranking = 28, ODFUsers = 29, GFCUsers = 30, SSUsers = 31,
    CallCenterCfb = 32, IVR = 33
}

public static class ZedAuthenticationExtensions
{
    public const string XsrfCookieName = "XSRF-TOKEN";
    public const string XsrfHeaderName = "X-XSRF-TOKEN";

    /// <summary>
    /// Cookie authentication for the Angular front end (HttpOnly, SameSite=Strict, 120 min sliding,
    /// matching the old sessionState timeout) plus Angular-compatible anti-forgery.
    /// </summary>
    public static IServiceCollection AddZedAuthentication(this IServiceCollection services, string cookieName)
    {
        services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
            .AddCookie(o =>
            {
                o.Cookie.Name = cookieName;
                o.Cookie.HttpOnly = true;
                o.Cookie.SameSite = SameSiteMode.Strict;
                o.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
                o.ExpireTimeSpan = TimeSpan.FromMinutes(120);
                o.SlidingExpiration = true;
                // An API returns status codes; the Angular app decides where to navigate.
                o.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = StatusCodes.Status401Unauthorized; return Task.CompletedTask; };
                o.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = StatusCodes.Status403Forbidden; return Task.CompletedTask; };
                // M12: a session ends on the server when the user's access changed (Users.SessionStamp, SessionStamps).
                o.Events.OnValidatePrincipal = ctx => ctx.HttpContext.RequestServices.GetRequiredService<SessionStampValidator>().ValidateAsync(ctx);
            });
        services.AddMemoryCache();
        services.TryAddSingleton<SessionStampValidator>();
        services.AddAuthorization(o =>
        {
            foreach (var sub in SubRoles.All)
                o.AddPolicy(SubRoleAttribute.PolicyPrefix + sub, p => p.RequireAuthenticatedUser().RequireClaim(ZedClaims.SubRole, sub));
        });

        services.AddAntiforgery(o =>
        {
            o.HeaderName = XsrfHeaderName;
            o.Cookie.Name = cookieName + ".AF";
            o.Cookie.SameSite = SameSiteMode.Strict;
        });
        // Behind a load balancer that ends TLS the request arrives as http: when the portal's public address is https,
        // the sign-in cookie is Secure whatever the request says. The anti-forgery cookie keeps its default policy (with
        // Always, antiforgery refuses every plain-http request); UseZedPlatform's cookie policy makes it Secure instead.
        services.AddOptions<CookieAuthenticationOptions>(CookieAuthenticationDefaults.AuthenticationScheme)
            .Configure<IOptions<PortalOptions>>((o, portal) => { if (HttpsOnly(portal.Value)) o.Cookie.SecurePolicy = CookieSecurePolicy.Always; });
        services.AddScoped<ValidateAntiforgeryFilter>();
        return services;
    }

    /// <summary>
    /// Issues the readable XSRF-TOKEN cookie that Angular's HttpClient echoes back in X-XSRF-TOKEN.
    /// Called on API GETs, and again after sign-in/out because the token is bound to the user.
    /// </summary>
    public static void IssueXsrfCookie(this HttpContext context)
    {
        var antiforgery = context.RequestServices.GetRequiredService<IAntiforgery>();
        var tokens = antiforgery.GetAndStoreTokens(context);
        context.Response.Cookies.Append(XsrfCookieName, tokens.RequestToken!, new CookieOptions
        {
            HttpOnly = false,
            SameSite = SameSiteMode.Strict,
            Secure = context.SecureCookies(),
            // Scoped to the app's folder (/Consultancy, /surveillance) so the three systems' tokens on one domain
            // don't overwrite each other; main's path base is empty, so "/".
            Path = context.Request.PathBase.HasValue ? context.Request.PathBase.Value : "/",
        });
    }

    /// <summary>True when the portal's public address (<c>Portal:PublicBaseUrl</c>) is https: every cookie is then Secure.</summary>
    public static bool HttpsOnly(PortalOptions portal) =>
        Uri.TryCreate(portal.PublicBaseUrl, UriKind.Absolute, out var url) && url.Scheme == Uri.UriSchemeHttps;

    /// <summary>The Secure flag of a cookie set by hand: the request came over https, or the portal's public address is https.</summary>
    public static bool SecureCookies(this HttpContext context) =>
        context.Request.IsHttps || context.RequestServices.GetService<IOptions<PortalOptions>>() is { } portal && HttpsOnly(portal.Value);

    public static IApplicationBuilder UseXsrfCookie(this IApplicationBuilder app) =>
        app.Use(async (ctx, next) =>
        {
            if (HttpMethods.IsGet(ctx.Request.Method) && ctx.Request.Path.StartsWithSegments("/api"))
                ctx.IssueXsrfCookie();
            await next();
        });

    /// <summary>
    /// Issues the sign-in cookie, with the user's session stamp (<see cref="SessionStamps"/>). <paramref name="stampOnMain"/>:
    /// the main portal's Admin handed over to this portal, whose stamp is in the main database.
    /// </summary>
    public static async Task SignInZedUserAsync(this HttpContext context, ZedUser user, bool stampOnMain = false)
    {
        var principal = user.ToPrincipal();
        if (context.RequestServices.GetService<SessionStampValidator>() is { } stamps)
            await stamps.StampAsync(principal, user.UserId, stampOnMain, context.RequestAborted);
        await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, principal);
        context.User = principal;
        context.IssueXsrfCookie();
    }

    public static async Task SignOutZedUserAsync(this HttpContext context)
    {
        await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        context.User = new ClaimsPrincipal(new ClaimsIdentity());
        context.IssueXsrfCookie();
    }

    /// <summary>
    /// The other two portals' sign-in cookies and the folders they run under (Portal:PathBase, as the hosts' Program.cs
    /// name them). Cookie paths are case-sensitive in browsers: the usual spellings of each folder are listed, and "/"
    /// for a portal run without a folder (development).
    /// </summary>
    public static readonly IReadOnlyList<(string CookieName, string[] Paths)> OtherPortalCookies =
    [
        ("zed.consultancy", ["/Consultancy", "/consultancy", "/"]),
        ("zed.surveillance", ["/surveillance", "/Surveillance", "/"]),
    ];

    /// <summary>
    /// One Admin (H11): main's logout also ends the Consultancy and Surveillance sessions in this browser (the Admin's from
    /// the hand-over, or anyone's). The three portals share one domain, so main can expire the other portals' sign-in
    /// cookies (and their anti-forgery and XSRF cookies) by name and path. Harmless when they do not exist. The session
    /// stamp is not changed: the user's sessions on other devices stay signed in.
    /// </summary>
    public static void ExpireOtherPortalCookies(this HttpContext context)
    {
        var secure = context.SecureCookies();
        void Expire(string name, string path, bool httpOnly) =>
            context.Response.Cookies.Append(name, "", new CookieOptions
            {
                Path = path, Expires = DateTimeOffset.UnixEpoch, HttpOnly = httpOnly, Secure = secure, SameSite = SameSiteMode.Strict,
            });
        foreach (var (name, paths) in OtherPortalCookies)
            foreach (var path in paths)
            {
                Expire(name, path, httpOnly: true);
                Expire(name + ".AF", path, httpOnly: true);
                // Main's own XSRF-TOKEN is at "/" (just issued again by the sign-out): only the other portals' folders.
                if (path != "/") Expire(XsrfCookieName, path, httpOnly: false);
            }
    }
}

/// <summary>
/// Validates the anti-forgery header on every state-changing request. Registered globally;
/// mark an action with [IgnoreAntiforgeryToken] to opt out (e.g. server-to-server callbacks).
/// </summary>
public sealed class ValidateAntiforgeryFilter(IAntiforgery antiforgery) : IAsyncAuthorizationFilter
{
    public async Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var method = context.HttpContext.Request.Method;
        if (HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method)) return;
        if (context.ActionDescriptor.EndpointMetadata.OfType<IgnoreAntiforgeryTokenAttribute>().Any()) return;

        try
        {
            await antiforgery.ValidateRequestAsync(context.HttpContext);
        }
        catch (AntiforgeryValidationException)
        {
            context.Result = new ObjectResult(new ProblemDetails
            {
                Status = StatusCodes.Status400BadRequest,
                Title = "Your session token has expired. Please refresh the page and try again.",
            }) { StatusCode = StatusCodes.Status400BadRequest };
        }
    }
}
