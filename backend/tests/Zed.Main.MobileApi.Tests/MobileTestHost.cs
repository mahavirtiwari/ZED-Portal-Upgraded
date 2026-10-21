using System.Collections.Concurrent;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Mobile;

namespace Zed.Main.MobileApi.Tests;

/// <summary>The real mobile API pipeline with the database, mail and device records replaced by fakes.</summary>
public sealed class MobileTestHost : WebApplicationFactory<Program>
{
    public FakeSql Sql { get; } = new();
    public FakeEmail Email { get; } = new();
    public FakeDevices Devices { get; } = new();
    public string StorageRoot { get; } = Path.Combine(Path.GetTempPath(), "zed-mobile-tests-" + Guid.NewGuid().ToString("N"));
    public Dictionary<string, string?> Settings { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        builder.UseSetting("ConnectionStrings:Main", "Server=unused;Database=unused");
        builder.UseSetting("Mobile:StorageRoot", StorageRoot);
        builder.UseSetting("Mobile:MaxFileBytes", "1000");
        foreach (var (k, v) in Settings) builder.UseSetting(k, v);
        builder.ConfigureServices(s =>
        {
            s.RemoveAll<ISqlExecutor>(); s.AddSingleton<ISqlExecutor>(Sql);
            s.RemoveAll<IEmailSender>(); s.AddSingleton<IEmailSender>(Email);
            s.RemoveAll<IDeviceBindings>(); s.AddSingleton<IDeviceBindings>(Devices);
            // Probe endpoints that echo what the legacy binder produced.
            s.AddControllers().AddApplicationPart(typeof(ProbeController).Assembly);
        });
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (Directory.Exists(StorageRoot)) Directory.Delete(StorageRoot, recursive: true);
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

    public static string? Arg(object? args, string name) => args switch
    {
        Dapper.DynamicParameters dp => dp.ParameterNames.Contains(name) ? dp.Get<object?>(name)?.ToString() : null,
        _ => args?.GetType().GetProperty(name)?.GetValue(args) switch { Dapper.DbString s => s.Value, var v => v?.ToString() },
    };

    private ResultSets Run(string name, object? args)
    {
        Calls.Enqueue((name, args));
        return Procs.TryGetValue(name, out var f) ? f(args) : Sets();
    }

    public Task<IReadOnlyList<T>> QueryProcAsync<T>(string procedure, object? parameters = null, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<ResultSets> QueryProcMultipleAsync(string procedure, object? parameters = null, CancellationToken ct = default) => Task.FromResult(Run(procedure, parameters));
    public Task<int> ExecuteProcAsync(string procedure, object? parameters = null, CancellationToken ct = default) { Run(procedure, parameters); return Task.FromResult(1); }
    public Task<int> ExecuteSqlAsync(string sql, object? parameters = null, CancellationToken ct = default) { Run(sql, parameters); return Task.FromResult(1); }
    public Task<IReadOnlyList<T>> QuerySqlAsync<T>(string sql, object? parameters = null, CancellationToken ct = default)
    {
        Calls.Enqueue((sql, parameters));
        return Task.FromResult<IReadOnlyList<T>>([]);
    }
}

public sealed class FakeEmail : IEmailSender
{
    public ConcurrentQueue<EmailMessage> Sent { get; } = new();
    public Task SendAsync(EmailMessage message, CancellationToken ct = default) { Sent.Enqueue(message); return Task.CompletedTask; }
}

public sealed class FakeDevices : IDeviceBindings
{
    public ConcurrentDictionary<(string App, string User), ConcurrentBag<string>> Known { get; } = new();
    public ConcurrentQueue<(string App, string User, string? Device, string Path, DeviceCheck Outcome, bool Refused)> Events { get; } = new();

    public Task RememberAsync(string app, string userKey, DeviceInfo? device, string? ip, CancellationToken ct = default)
    {
        if (!string.IsNullOrWhiteSpace(device?.deviceId))
            Known.GetOrAdd((app, userKey.ToUpperInvariant()), _ => []).Add(device.deviceId);
        return Task.CompletedTask;
    }

    public Task<DeviceCheck> CheckAsync(string app, string userKey, string? deviceId, CancellationToken ct = default)
    {
        if (!Known.TryGetValue((app, userKey.ToUpperInvariant()), out var ids)) return Task.FromResult(DeviceCheck.NoBinding);
        if (string.IsNullOrWhiteSpace(deviceId)) return Task.FromResult(DeviceCheck.Missing);
        return Task.FromResult(ids.Contains(deviceId) ? DeviceCheck.Known : DeviceCheck.Unknown);
    }

    public Task RecordAsync(string app, string userKey, string? deviceId, string path, string? ip, DeviceCheck outcome, bool refused, CancellationToken ct = default)
    {
        Events.Enqueue((app, userKey, deviceId, path, outcome, refused));
        return Task.CompletedTask;
    }
}

// ---- Probe endpoints (test assembly only) ----

public sealed class ProbeRequest
{
    public string? userName { get; set; }
    public string? zedId { get; set; }
    public int count { get; set; }
    public int? optional { get; set; }
    public decimal amount { get; set; }
    public bool flag { get; set; }
    public DateTime? when { get; set; }
    public DeviceInfo? deviceInfo { get; set; }
    public List<ProbePhoto>? photos { get; set; }
    public List<string>? tags { get; set; }
}

public sealed class ProbePhoto
{
    public string? photoId { get; set; }
    public bool isPdf { get; set; }
    public Microsoft.AspNetCore.Http.IFormFile? file_data { get; set; }
}

public sealed class ProbeController : LegacyMobileController
{
    [HttpPost]
    public IActionResult Echo(ProbeRequest request) => LegacyJson(new
    {
        request.userName, request.zedId, request.count, request.optional, request.amount, request.flag, request.when,
        deviceId = request.deviceInfo?.deviceId,
        apiLevel = request.deviceInfo?.apiLevel,
        photos = request.photos?.Select(p => new { p.photoId, p.isPdf, file = p.file_data?.FileName }),
        request.tags,
    });

    [HttpPost]
    public IActionResult Simple(string userName, string? version, int ncCount) => LegacyJson(new { userName, version, ncCount });

    [HttpPost]
    public IActionResult Files(ProbeRequest request, List<Microsoft.AspNetCore.Http.IFormFile>? files, Microsoft.AspNetCore.Http.IFormFile? video_data) =>
        LegacyJson(new { request.userName, files = files?.Select(f => f.FileName), video = video_data?.FileName });

    [HttpPost]
    [DeviceBound(MobileApps.Msme)]
    public IActionResult Guarded(ProbeRequest request) => LegacyJson(ServiceResponse.Ok());

    [HttpPost]
    public IActionResult Boom() => throw new InvalidOperationException("secret detail");

    [HttpPost]
    public IActionResult Traverse(string name, [FromServices] MobileStorage storage) => LegacyJson(new { path = storage.Folder("Photos", name) });

    [HttpPost]
    public IActionResult Dates() => LegacyJson(new { at = new DateTime(2024, 1, 2, 3, 4, 5, DateTimeKind.Utc), none = (DateTime?)null, text = "<b>हिन्दी</b>" });
}
