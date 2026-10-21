using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Zed.Core.Data;
using Zed.Core.Security;
using Zed.Main.Api.Tests;
using Zed.Portal.Features.Documents;

namespace Zed.Surveillance.Api.Tests;

/// <summary>Stand-in for the certificate/report service (package D makes it surveillance-aware).</summary>
public sealed class ReviewFakeDocuments : IAssessmentDocuments
{
    public static readonly byte[] Pdf = Encoding.ASCII.GetBytes("%PDF-1.4\n%%EOF");
    public ConcurrentQueue<(string Kind, string ZedId, string Certification)> Calls { get; } = new();

    public Task<DocumentFile> IssueCertificateAsync(string zedId, string certification, CancellationToken ct)
    {
        Calls.Enqueue(("certificate", zedId, certification));
        return Task.FromResult(new DocumentFile($"Surveillance/Certificates/SA/{zedId}/{certification}.pdf", Pdf));
    }

    public Task<DocumentFile> RenderReportAsync(string zedId, string certification, CancellationToken ct)
    {
        Calls.Enqueue(("report", zedId, certification));
        return Task.FromResult(new DocumentFile($"PDFs/SA/{zedId}/{certification}_Report.pdf", Pdf));
    }
}

[ApiController]
[Route("test/review-sign-in")]
[IgnoreAntiforgeryToken]
public sealed class ReviewSignInController : ControllerBase
{
    public sealed record SignIn(string UserId, int RoleId, string[]? SubRoles);

    [HttpPost]
    public async Task<IActionResult> Post(SignIn req)
    {
        await HttpContext.SignInZedUserAsync(new ZedUser(req.UserId, req.UserId + " name", req.RoleId, req.UserId + "@x.test", null, null, null,
            SubRoles: req.SubRoles ?? SubRoles.All));
        return NoContent();
    }
}

public static class ReviewTestHost
{
    /// <summary>
    /// The surveillance host with the documents faked. <paramref name="main"/>: a fake of the read-only main connection
    /// (keyed "Main"); null removes the main connection string, so the cross-database wrappers are used.
    /// </summary>
    public static WebApplicationFactory<Program> With(TestHost host, ReviewFakeDocuments documents, FakeSql? main) =>
        host.WithWebHostBuilder(b =>
        {
            if (main is null) b.UseSetting("ConnectionStrings:Main", "");
            b.ConfigureTestServices(s =>
            {
                s.RemoveAll<IAssessmentDocuments>();
                s.AddSingleton<IAssessmentDocuments>(documents);
                if (main is not null) s.AddKeyedSingleton<ISqlExecutor>(ZedDatabases.Main, main);
                s.AddControllers().AddApplicationPart(typeof(ReviewSignInController).Assembly);
            });
        });

    public static async Task<HttpClient> SignInAsync(WebApplicationFactory<Program> app, string? userId, UserRole role, string[]? subRoles = null)
    {
        var cookies = new CookieContainer();
        var client = app.CreateDefaultClient(new Xsrf(cookies, app.Server.BaseAddress));
        (await client.GetAsync("/api/auth/me")).EnsureSuccessStatusCode();
        if (userId is null) return client;
        (await client.PostAsJsonAsync("/test/review-sign-in", new { userId, roleId = (int)role, subRoles })).EnsureSuccessStatusCode();
        (await client.GetAsync("/api/auth/me")).EnsureSuccessStatusCode();
        return client;
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
