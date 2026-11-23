using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Zed.Core.Logging;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>2026-11-21 (the user: "add logger"): the file log and Admin → Server Logs.</summary>
public sealed class ServerLogsTests : IDisposable
{
    private const string Url = "/api/staff/settings/server-logs";
    private readonly string _folder = Path.Combine(Path.GetTempPath(), "zed-logs-" + Guid.NewGuid().ToString("N"));
    private readonly TestHost _host = new();

    public ServerLogsTests() => UsersMastersLogin.Setup(_host);

    public void Dispose()
    {
        _host.Dispose();
        if (Directory.Exists(_folder)) Directory.Delete(_folder, recursive: true);
    }

    private sealed class Env(string root) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = "Production";
        public string ApplicationName { get; set; } = "Zed.Consultancy.Api";
        public string ContentRootPath { get; set; } = root;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }

    private FileLoggerProvider Provider(LogLevel min = LogLevel.Warning) =>
        new(Microsoft.Extensions.Options.Options.Create(new FileLogOptions { Folder = _folder, MinLevel = min }), new Env(_folder),
            new ConfigurationBuilder().Build());

    [Fact]
    public void Warnings_and_errors_are_written_as_json_lines_with_the_request_and_the_user()
    {
        var provider = Provider();
        var factory = LoggerFactory.Create(b => b.AddProvider(provider).SetMinimumLevel(LogLevel.Trace));
        var log = factory.CreateLogger("Zed.Portal.Features.Staff.Users.StaffAgenciesController");
        using (log.BeginScope(new Dictionary<string, object?> { ["RequestPath"] = "/api/staff/users/agencies" }))
        using (log.BeginScope(new Dictionary<string, object?> { ["ZedUser"] = "ZEDV4MA01 (7)" }))
        {
            log.LogInformation("not kept: below Warning");
            log.LogError(new InvalidOperationException("Sequence contains no elements"), "Agencies of {UserId} not listed", "ZEDV4MA01");
            log.LogWarning("Slow query");
        }
        factory.Dispose();
        provider.Dispose();   // flushes and closes the day's file

        var file = Path.Combine(_folder, FileLog.FileName(DateTime.UtcNow));
        var lines = File.ReadAllLines(file);
        Assert.Equal(2, lines.Length);
        var error = FileLogReader.Parse(lines[0])!;
        Assert.Equal(("Error", "consultancy", "/api/staff/users/agencies", "ZEDV4MA01 (7)"), (error.Level, error.Source, error.Path, error.User));
        Assert.Contains("Agencies of ZEDV4MA01 not listed", error.Message);
        Assert.Contains("InvalidOperationException: Sequence contains no elements", error.Exception);

        // Newest first, by level and by text (message, error, path, user, trace id).
        var today = DateTime.UtcNow.Date;
        var (all, more) = FileLogReader.Read(_folder, new(today, today, LogLevel.Warning, null, 100));
        Assert.Equal(["Slow query", "Agencies of ZEDV4MA01 not listed"], all.Select(e => e.Message));
        Assert.False(more);
        Assert.Single(FileLogReader.Read(_folder, new(today, today, LogLevel.Error, null, 100)).Entries);
        Assert.Single(FileLogReader.Read(_folder, new(today, today, LogLevel.Warning, "no elements", 100)).Entries);
        Assert.True(FileLogReader.Read(_folder, new(today, today, LogLevel.Warning, null, 1)).More);
    }

    [Fact]
    public void The_provider_says_why_it_cannot_write_its_folder()
    {
        // 2026-11-23: Server Logs was empty on every portal; a folder the host cannot write must not look like "no problems".
        using var ok = Provider();
        Assert.Null(ok.Probe());
        Assert.Empty(Directory.EnumerateFiles(_folder));   // the probe leaves nothing behind

        var blocker = Path.Combine(_folder, "not-a-folder");
        File.WriteAllText(blocker, "");
        using var bad = new FileLoggerProvider(Microsoft.Extensions.Options.Options.Create(new FileLogOptions { Folder = blocker }), new Env(_folder),
            new ConfigurationBuilder().Build());
        Assert.NotNull(bad.Probe());
        Assert.NotNull(bad.WriteProblem);

        using var off = new FileLoggerProvider(Microsoft.Extensions.Options.Options.Create(new FileLogOptions { Folder = _folder, Enabled = false }), new Env(_folder),
            new ConfigurationBuilder().Build());
        Assert.Contains("switched off", off.Probe());
    }

    [Fact]
    public void A_search_stops_after_its_byte_budget_and_skips_lines_of_other_levels()
    {
        Directory.CreateDirectory(_folder);
        var now = DateTime.UtcNow;
        File.WriteAllLines(Path.Combine(_folder, FileLog.FileName(now)), Enumerable.Range(0, 50).Select(i =>
            JsonSerializer.Serialize(new LogEntry(now, i % 2 == 0 ? "Warning" : "Error", "main", "c", 0, "entry " + i, null, null, null, null))));
        var today = now.Date;
        Assert.Equal(25, FileLogReader.Read(_folder, new(today, today, LogLevel.Error, null, 100)).Entries.Count);
        var (few, more) = FileLogReader.Read(_folder, new(today, today, LogLevel.Warning, null, 100, MaxBytes: 1000));
        Assert.True(more);
        Assert.InRange(few.Count, 1, 49);
        Assert.Single(FileLogReader.Read(_folder, new(today, today, LogLevel.Warning, "entry 7", 100)).Entries);
    }

    [Fact]
    public void A_full_day_stops_at_the_size_limit_with_one_line_saying_so()
    {
        var provider = new FileLoggerProvider(Microsoft.Extensions.Options.Options.Create(new FileLogOptions { Folder = _folder, MaxFileBytes = 300 }),
            new Env(_folder), new ConfigurationBuilder().Build());
        var factory = LoggerFactory.Create(b => b.AddProvider(provider));
        var log = factory.CreateLogger("x");
        for (var i = 0; i < 20; i++) log.LogWarning("Entry {N} with some text to fill the file", i);
        factory.Dispose();
        provider.Dispose();
        var lines = File.ReadAllLines(Path.Combine(_folder, FileLog.FileName(DateTime.UtcNow)));
        Assert.True(lines.Length < 20);
        Assert.Contains("size limit", lines[^1]);
    }

    private void WriteLog(string folder, params LogEntry[] entries)
    {
        Directory.CreateDirectory(folder);
        // Shared, as the host's own logger may have the day's file open.
        using var stream = new FileStream(Path.Combine(folder, FileLog.FileName(DateTime.UtcNow)), FileMode.Append, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete);
        using var writer = new StreamWriter(stream);
        foreach (var e in entries) writer.WriteLine(JsonSerializer.Serialize(e));
    }

    [Fact]
    public async Task Admin_reads_the_portals_log_filters_it_and_downloads_a_day()
    {
        var folder = Path.Combine(_host.StorageRoot, "logs");
        var now = DateTime.UtcNow;
        WriteLog(folder,
            new LogEntry(now.AddMinutes(-2), "Warning", "main", "Zed.Request", 0, "Slow", null, null, "/api/x", null),
            new LogEntry(now.AddMinutes(-1), "Error", "main", "Microsoft.AspNetCore.Diagnostics.ExceptionHandlerMiddleware", 1,
                "An unhandled exception has occurred while executing the request.", "System.Data.SqlClient.SqlException: insufficient system memory",
                "0af7651916cd43dd8448eb211c80319c", "/api/staff/users/agencies", "ZEDV4MA01 (7)"));
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");

        var list = await admin.GetFromJsonAsync<JsonElement>(Url);
        Assert.Equal("main", list.GetProperty("source").GetString());
        // 2026-11-23: the folder and whether this host can write it.
        Assert.Equal(Path.GetFullPath(folder), Path.GetFullPath(list.GetProperty("folder").GetString()!));
        Assert.Equal(JsonValueKind.Null, list.GetProperty("writeProblem").ValueKind);
        // (The test portal's own warnings may be in the file too.)
        var messages = list.GetProperty("entries").EnumerateArray().Select(e => e.GetProperty("m").GetString()).ToList();
        Assert.True(messages.IndexOf("An unhandled exception has occurred while executing the request.") < messages.IndexOf("Slow"));   // newest first

        // By the reference an error answer shows (the trace id) and by level.
        var byTrace = await admin.GetFromJsonAsync<JsonElement>(Url + "?q=0af76519");
        Assert.Equal(1, byTrace.GetProperty("entries").GetArrayLength());
        var errors = await admin.GetFromJsonAsync<JsonElement>(Url + "?level=Error&q=insufficient");
        Assert.Equal(1, errors.GetProperty("entries").GetArrayLength());

        Assert.Equal(HttpStatusCode.BadRequest, (await admin.GetAsync(Url + "?level=Debug")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.GetAsync(Url + "?from=2026-11-20&to=2026-10-01")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.GetAsync(Url + "?source=elsewhere")).StatusCode);

        var file = await admin.GetAsync(Url + "/download");
        file.EnsureSuccessStatusCode();
        Assert.Contains("insufficient system memory", await file.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Only_the_admin_reads_the_logs()
    {
        var anonymous = _host.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(Url)).StatusCode);
    }
}
