using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Zed.Core.Security;
using Zed.Main.Api.Tests;
using Zed.Portal.Features.Documents;

namespace Zed.Consultancy.Api.Tests;

/// <summary>Stand-in for the certificate/report service (package D).</summary>
public sealed class MilestoneFakeDocuments : IAssessmentDocuments
{
    public static readonly byte[] Pdf = Encoding.ASCII.GetBytes("%PDF-1.4\n%%EOF");
    public ConcurrentQueue<(string Kind, string ZedId, string Certification)> Calls { get; } = new();
    public bool FailReports { get; set; }

    public Task<DocumentFile> IssueCertificateAsync(string zedId, string certification, CancellationToken ct)
    {
        Calls.Enqueue(("certificate", zedId, certification));
        return Task.FromResult(new DocumentFile($"Certificates/SA/{zedId}/{certification}.pdf", Pdf));
    }

    public Task<DocumentFile> RenderReportAsync(string zedId, string certification, CancellationToken ct)
    {
        Calls.Enqueue(("report", zedId, certification));
        if (FailReports) throw new NotSupportedException("Report generation is not ported yet.");
        return Task.FromResult(new DocumentFile($"PDFs/SA/{zedId}/{certification}_Report.pdf", Pdf));
    }
}

/// <summary>
/// Signs a test user in directly (the staff sign-in controller is enabled for this host by another package), so these
/// tests depend only on the milestone feature.
/// </summary>
[ApiController]
[Route("test/milestone-sign-in")]
[IgnoreAntiforgeryToken]
public sealed class MilestoneSignInController : ControllerBase
{
    public sealed record SignIn(string UserId, int RoleId, string[]? SubRoles);

    [HttpPost]
    public async Task<IActionResult> Post(SignIn req)
    {
        await HttpContext.SignInZedUserAsync(new ZedUser(req.UserId, req.UserId + " name", req.RoleId, req.UserId + "@x.test", null, null, null,
            SubRoles: req.SubRoles ?? Zed.Core.Security.SubRoles.All));
        return NoContent();
    }
}

public static class MilestoneTestHost
{
    public static WebApplicationFactory<Program> With(TestHost host, MilestoneFakeDocuments documents) =>
        host.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.RemoveAll<IAssessmentDocuments>();
            s.AddSingleton<IAssessmentDocuments>(documents);
            s.AddControllers().AddApplicationPart(typeof(MilestoneSignInController).Assembly);
        }));

    public static async Task<HttpClient> SignInAsync(WebApplicationFactory<Program> app, string? userId, UserRole role = UserRole.DesktopAssessor, string[]? subRoles = null)
    {
        var cookies = new CookieContainer();
        var client = app.CreateDefaultClient(new Xsrf(cookies, app.Server.BaseAddress));
        (await client.GetAsync("/api/auth/me")).EnsureSuccessStatusCode();
        if (userId is null) return client;
        (await client.PostAsJsonAsync("/test/milestone-sign-in", new { userId, roleId = (int)role, subRoles })).EnsureSuccessStatusCode();
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
