using System.Net;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Zed.Core.Security;
using Zed.Main.Api.Tests;

namespace Zed.Surveillance.Api.Tests;

/// <summary>
/// Test-only sign-in for this host (the staff sign-in controller is enabled for this system by another package):
/// issues the same cookie as /api/staff/auth/login for the given user, role and sub-roles.
/// </summary>
[ApiController]
[Route("test/assessment-sign-in")]
public sealed class AssessmentSignInController : ControllerBase
{
    [HttpGet]
    [AllowAnonymous]
    public async Task<IActionResult> SignIn(string userId, int roleId, string? subRoles)
    {
        var subs = (subRoles ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries);
        await HttpContext.SignInZedUserAsync(new ZedUser(userId, userId + " name", roleId, userId + "@x.test", null, null, null, SubRoles: subs));
        return NoContent();
    }
}

/// <summary>The host plus the test sign-in, and a browser client that echoes the XSRF cookie like the Angular app.</summary>
public sealed class AssessmentStaff : IDisposable
{
    public TestHost Host { get; } = new();
    public WebApplicationFactory<Program> Factory { get; }

    public AssessmentStaff() =>
        Factory = Host.WithWebHostBuilder(b => b.ConfigureServices(s => s.AddControllers().AddApplicationPart(typeof(AssessmentSignInController).Assembly)));

    public FakeSql Sql => Host.Sql;
    public FakeEmail Email => Host.Email;

    public async Task<HttpClient> SignInAsync(string userId, int roleId, params string[] subRoles)
    {
        var cookies = new CookieContainer();
        var client = Factory.CreateDefaultClient(new Xsrf(cookies, Factory.Server.BaseAddress));
        (await client.GetAsync("/api/auth/me")).EnsureSuccessStatusCode();
        (await client.GetAsync($"/test/assessment-sign-in?userId={userId}&roleId={roleId}&subRoles={string.Join(',', subRoles)}")).EnsureSuccessStatusCode();
        (await client.GetAsync("/api/auth/me")).EnsureSuccessStatusCode();
        return client;
    }

    public void Dispose()
    {
        Factory.Dispose();
        Host.Dispose();
    }

    private sealed class Xsrf(CookieContainer cookies, Uri baseAddress) : DelegatingHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var uri = request.RequestUri!.IsAbsoluteUri ? request.RequestUri : new Uri(baseAddress, request.RequestUri);
            var header = cookies.GetCookieHeader(uri);
            if (header.Length > 0) request.Headers.Add("Cookie", header);
            if (request.Method != HttpMethod.Get && cookies.GetCookies(uri)["XSRF-TOKEN"] is { } xsrf)
                request.Headers.Add("X-XSRF-TOKEN", Uri.UnescapeDataString(xsrf.Value));
            var response = await base.SendAsync(request, ct);
            if (response.Headers.TryGetValues("Set-Cookie", out var setCookies))
                foreach (var c in setCookies) cookies.SetCookies(uri, c);
            return response;
        }
    }
}
