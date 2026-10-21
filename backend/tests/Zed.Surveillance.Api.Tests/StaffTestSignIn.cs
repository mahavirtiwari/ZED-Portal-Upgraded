using System.Net;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Zed.Core.Security;
using Zed.Main.Api.Tests;

namespace Zed.Surveillance.Api.Tests;

/// <summary>
/// Signs a staff user in on this system's host without depending on the staff login controller being served here:
/// a test-only endpoint issues the same cookie (<see cref="ZedAuthenticationExtensions.SignInZedUserAsync"/>).
/// The rest of the pipeline (roles, sub-roles, XSRF, controller filter) is the real one.
/// </summary>
public static class StaffTestSignIn
{
    public static WebApplicationFactory<Program> WithTestSignIn(this TestHost host) =>
        host.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
            s.AddControllers().AddApplicationPart(typeof(TestSignInController).Assembly)));

    /// <summary>A browser-like client (cookies + XSRF header); signed in when <paramref name="userId"/> is given.</summary>
    public static async Task<HttpClient> BrowserAsync(WebApplicationFactory<Program> factory, string? userId, int roleId, params string[] subRoles)
    {
        var cookies = new CookieContainer();
        var client = factory.CreateDefaultClient(new Xsrf(cookies, factory.Server.BaseAddress));
        (await client.GetAsync("/api/auth/me")).EnsureSuccessStatusCode();
        if (userId is not null)
            (await client.PostAsync($"/api/test-sign-in?userId={Uri.EscapeDataString(userId)}&roleId={roleId}&subRoles={string.Join(",", subRoles)}", null)).EnsureSuccessStatusCode();
        return client;
    }

    private sealed class Xsrf(CookieContainer cookies, Uri baseAddress) : DelegatingHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var uri = request.RequestUri!.IsAbsoluteUri ? request.RequestUri : new Uri(baseAddress, request.RequestUri);
            var header = cookies.GetCookieHeader(uri);
            if (header.Length > 0) request.Headers.Add("Cookie", header);
            if (request.Method != HttpMethod.Get && cookies.GetCookies(uri)["XSRF-TOKEN"] is { } x)
                request.Headers.Add("X-XSRF-TOKEN", Uri.UnescapeDataString(x.Value));
            var response = await base.SendAsync(request, ct);
            if (response.Headers.TryGetValues("Set-Cookie", out var set))
                foreach (var c in set) cookies.SetCookies(uri, c);
            return response;
        }
    }
}

[ApiController]
[Route("api/test-sign-in")]
public sealed class TestSignInController : ControllerBase
{
    [HttpPost]
    [AllowAnonymous]
    public async Task<IActionResult> SignIn(string userId, int roleId, string? subRoles)
    {
        var user = new ZedUser(userId, userId + " name", roleId, "x@y.test", null, null, null,
            SubRoles: (subRoles ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries));
        await HttpContext.SignInZedUserAsync(user);
        return NoContent();
    }
}
