using System.Collections.Concurrent;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Portal.Features.Msme;

namespace Zed.Main.Api.Tests;

/// <summary>Runs the real API pipeline with the database, Udyam service and SMTP replaced by fakes.</summary>
public sealed class TestHost : WebApplicationFactory<Program>
{
    public FakeSql Sql { get; } = new();
    public FakeEmail Email { get; } = new();
    public FakeUdyam Udyam { get; } = new();
    public const string WorkingKey = "ABCDEF0123456789ABCDEF0123456789";
    public const string ReconciliationKey = "0123456789ABCDEF0123456789ABCDEF";
    public FakeGstin Gstin { get; } = new();

    public string StorageRoot { get; } = Path.Combine(Path.GetTempPath(), "zed-tests-" + Guid.NewGuid().ToString("N"));

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        builder.UseSetting("ConnectionStrings:Main", "Server=unused;Database=unused");
        builder.UseSetting("Recaptcha:Enabled", "false");
        builder.UseSetting("Portal:StorageRoot", StorageRoot);
        builder.UseSetting("Email:ContactInbox", "zed.support@example.test");
        builder.UseSetting("CcAvenue:MerchantId", "12345");
        builder.UseSetting("CcAvenue:AccessCode", "AVTEST");
        builder.UseSetting("CcAvenue:WorkingKey", WorkingKey);
        builder.UseSetting("CcAvenue:ReconciliationWorkingKey", ReconciliationKey);
        builder.ConfigureServices(s =>
        {
            s.RemoveAll<ISqlExecutor>(); s.AddSingleton<ISqlExecutor>(Sql);
            // As in production, the Admin's Email Templates apply before the message reaches the (fake) SMTP sender.
            s.RemoveAll<IEmailSender>(); s.AddSingleton<IEmailSender>(sp => new TemplatedEmailSender(Email, sp.GetRequiredService<ILogger<TemplatedEmailSender>>()));
            s.RemoveAll<IUdyamClient>(); s.AddSingleton<IUdyamClient>(Udyam);
            s.RemoveAll<Zed.Portal.Features.Payments.IGstinVerifier>(); s.AddSingleton<Zed.Portal.Features.Payments.IGstinVerifier>(Gstin);
        });
    }

    /// <summary>Client that behaves like the Angular app: fetches the XSRF cookie and echoes it in a header.</summary>
    public async Task<HttpClient> CreateBrowserAsync()
    {
        var cookies = new System.Net.CookieContainer();
        var client = CreateDefaultClient(new XsrfHandler(cookies, Server.BaseAddress));
        (await client.GetAsync("/api/auth/me")).EnsureSuccessStatusCode();
        return client;
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (Directory.Exists(StorageRoot)) Directory.Delete(StorageRoot, recursive: true);
    }

    private sealed class XsrfHandler(System.Net.CookieContainer cookies, Uri baseAddress) : DelegatingHandler
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

public sealed class FakeSql : ISqlExecutor
{
    public ConcurrentDictionary<string, Func<object?, ResultSets>> Procs { get; } = new(StringComparer.OrdinalIgnoreCase);
    public ConcurrentQueue<(string Name, object? Args)> Calls { get; } = new();

    public static ResultSets Sets(params IEnumerable<object>[] sets) =>
        new(sets.Select(rows => (IReadOnlyList<IDictionary<string, object?>>)rows.Select(ToDict).ToList()).ToList());

    private static IDictionary<string, object?> ToDict(object row) => row is IDictionary<string, object?> d ? d :
        row.GetType().GetProperties().ToDictionary(p => p.Name, p => p.GetValue(row), StringComparer.OrdinalIgnoreCase);

    private ResultSets Run(string name, object? args)
    {
        Calls.Enqueue((name, args));
        return Procs.TryGetValue(name, out var f) ? f(args) : Sets();
    }

    public static string? Arg(object? args, string name) => args switch
    {
        Dapper.DynamicParameters dp => dp.ParameterNames.Contains(name) ? dp.Get<object?>(name)?.ToString() : null,
        _ => args?.GetType().GetProperty(name)?.GetValue(args) switch { Dapper.DbString s => s.Value, var v => v?.ToString() },
    };

    public Task<IReadOnlyList<T>> QueryProcAsync<T>(string procedure, object? parameters = null, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<ResultSets> QueryProcMultipleAsync(string procedure, object? parameters = null, CancellationToken ct = default) => Task.FromResult(Run(procedure, parameters));
    public Task<int> ExecuteProcAsync(string procedure, object? parameters = null, CancellationToken ct = default) { Run(procedure, parameters); return Task.FromResult(1); }
    public Task<int> ExecuteSqlAsync(string sql, object? parameters = null, CancellationToken ct = default) { Run(sql, parameters); return Task.FromResult(1); }
    /// <summary>Rows for inline SQL, keyed by the start of the statement; converted to T through JSON.</summary>
    public ConcurrentDictionary<string, Func<object?, IEnumerable<object>>> Queries { get; } = new(StringComparer.OrdinalIgnoreCase);

    public Task<IReadOnlyList<T>> QuerySqlAsync<T>(string sql, object? parameters = null, CancellationToken ct = default)
    {
        Calls.Enqueue((sql, parameters));
        var match = Queries.FirstOrDefault(q => sql.StartsWith(q.Key, StringComparison.OrdinalIgnoreCase));
        var rows = match.Value?.Invoke(parameters) ?? [];
        IReadOnlyList<T> result = rows.Select(r => System.Text.Json.JsonSerializer.Deserialize<T>(System.Text.Json.JsonSerializer.Serialize(r))!).ToList();
        return Task.FromResult(result);
    }
}

public sealed class FakeEmail : IEmailSender
{
    public ConcurrentQueue<EmailMessage> Sent { get; } = new();
    public Task SendAsync(EmailMessage message, CancellationToken ct = default) { Sent.Enqueue(message); return Task.CompletedTask; }
}

public sealed class FakeUdyam : IUdyamClient
{
    public UdyamLookup Result { get; set; } = new(
        new() { ["UdyogAadharNo"] = "UDYAM-UP-29-0003915", ["EnterpriseName"] = "Acme Castings", ["OwnerName"] = "A Kumar", ["State_Id"] = "9", ["District_Id"] = "160", ["EmailId"] = "owner@acme.test", ["EnterpriseType"] = "Micro" },
        [new() { ["PlantIdNo"] = "P1", ["UnitName"] = "Acme Unit 1", ["PAddress"] = "Plot 4, Industrial Area", ["ZedCertified"] = "false" }],
        [new() { ["Activity"] = "Manufacturing", ["Two_DigitActivity"] = "24", ["Four_DigitActivity"] = "2431", ["Five_DigitActivity"] = "24311" }]);

    public Task<UdyamLookup> GetUdyamAsync(string registrationNo, string mobileNo, CancellationToken ct = default) => Task.FromResult(Result);
}

public static class HttpExtensions
{
    public static async Task<string?> ProblemTitle(this HttpResponseMessage r) =>
        (await r.Content.ReadFromJsonAsync<Microsoft.AspNetCore.Mvc.ProblemDetails>())?.Title;
}

public sealed class FakeGstin : Zed.Portal.Features.Payments.IGstinVerifier
{
    public bool Valid { get; set; } = true;
    public ConcurrentQueue<string> Calls { get; } = new();

    public Task<Zed.Portal.Features.Payments.GstinResult> VerifyAsync(string zedId, string certification, string gstin, CancellationToken ct)
    {
        Calls.Enqueue(gstin);
        return Task.FromResult(new Zed.Portal.Features.Payments.GstinResult(Valid, Valid ? "GSTIN verified." : "Invalid GSTIN."));
    }
}
