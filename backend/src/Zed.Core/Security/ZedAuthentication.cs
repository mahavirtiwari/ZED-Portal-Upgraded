using System.Security.Claims;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.DependencyInjection;

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
    string? StateCode, string? DistrictCode, string? UnitName = null, IReadOnlyList<string>? SubRoles = null)
{
    public bool HasSubRole(string subRole) => SubRoles?.Contains(subRole) == true;

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
            principal.FindAll(ZedClaims.SubRole).Select(c => c.Value).ToList());
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
            });
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
            Secure = context.Request.IsHttps,
            // Scoped to the app's folder (/Consultancy, /surveillance) so the three systems' tokens on one domain
            // don't overwrite each other; main's path base is empty, so "/".
            Path = context.Request.PathBase.HasValue ? context.Request.PathBase.Value : "/",
        });
    }

    public static IApplicationBuilder UseXsrfCookie(this IApplicationBuilder app) =>
        app.Use(async (ctx, next) =>
        {
            if (HttpMethods.IsGet(ctx.Request.Method) && ctx.Request.Path.StartsWithSegments("/api"))
                ctx.IssueXsrfCookie();
            await next();
        });

    public static async Task SignInZedUserAsync(this HttpContext context, ZedUser user)
    {
        var principal = user.ToPrincipal();
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
