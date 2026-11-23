using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Channels;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Zed.Core.Logging;

/// <summary>
/// 2026-11-21 (the user: "add logger"): the server's own log, readable from the browser (Admin → Server Logs) when nobody has
/// access to the server. Every portal and mobile API host writes its warnings and errors (with the exception, the request
/// path, the signed-in user and the trace id an error answer shows) as one JSON line each to
/// <c>{content root}\logs\zed-yyyyMMdd.jsonl</c>: the folder the deploy keeps across updates and lets the pool write
/// (Install-ZedIis.ps1). Files are kept <see cref="FileLogOptions.RetentionDays"/> days and capped per day. No database: the
/// log keeps working when the database does not.
/// </summary>
public sealed class FileLogOptions
{
    public const string Section = "Logging:File";

    public bool Enabled { get; set; } = true;
    /// <summary>The folder; default <c>{content root}\logs</c>.</summary>
    public string? Folder { get; set; }
    public LogLevel MinLevel { get; set; } = LogLevel.Warning;
    public int RetentionDays { get; set; } = 30;
    /// <summary>A day's file stops growing at this size (one line says so) until the next day.</summary>
    public long MaxFileBytes { get; set; } = 50L * 1024 * 1024;
    /// <summary>The host's name in the log (main, consultancy, surveillance, mobile-main…); default from the application.</summary>
    public string? Source { get; set; }
}

/// <summary>One line of the log (short JSON names: the files stay small).</summary>
public sealed record LogEntry(
    [property: JsonPropertyName("t")] DateTime Time,
    [property: JsonPropertyName("l")] string Level,
    [property: JsonPropertyName("s")] string Source,
    [property: JsonPropertyName("c")] string Category,
    [property: JsonPropertyName("e")] int EventId,
    [property: JsonPropertyName("m")] string Message,
    [property: JsonPropertyName("x")] string? Exception,
    [property: JsonPropertyName("r")] string? TraceId,
    [property: JsonPropertyName("p")] string? Path,
    [property: JsonPropertyName("u")] string? User);

public static class FileLog
{
    public const string FilePrefix = "zed-";
    public const string FileSuffix = ".jsonl";
    public const int MaxMessage = 8000;
    public const int MaxException = 30000;

    internal static readonly JsonSerializerOptions Json = new() { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };

    public static string FileName(DateTime utcDay) => FilePrefix + utcDay.ToString("yyyyMMdd", CultureInfo.InvariantCulture) + FileSuffix;

    /// <summary>The day of a log file's name, or null for another file.</summary>
    public static DateTime? DayOf(string fileName) =>
        fileName.StartsWith(FilePrefix, StringComparison.OrdinalIgnoreCase) && fileName.EndsWith(FileSuffix, StringComparison.OrdinalIgnoreCase)
        && DateTime.TryParseExact(fileName[FilePrefix.Length..^FileSuffix.Length], "yyyyMMdd", CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var d) ? d.Date : null;

    /// <summary>The folder of a host: the option, else <c>{content root}\logs</c>.</summary>
    public static string FolderOf(FileLogOptions options, string contentRoot) =>
        string.IsNullOrWhiteSpace(options.Folder) ? Path.Combine(contentRoot, "logs") : options.Folder;

    /// <summary>The host's name: the option, else from the application (Zed.Main.Api → main; the mobile hosts by Mobile:System).</summary>
    public static string SourceOf(FileLogOptions options, IHostEnvironment env, IConfiguration config)
    {
        if (!string.IsNullOrWhiteSpace(options.Source)) return options.Source.Trim();
        var app = env.ApplicationName ?? "";
        if (app.Contains("MobileApi", StringComparison.OrdinalIgnoreCase))
            return "mobile-" + (config["Mobile:System"] ?? "Main").Trim().ToLowerInvariant();
        if (app.Contains("Consultancy", StringComparison.OrdinalIgnoreCase)) return "consultancy";
        if (app.Contains("Surveillance", StringComparison.OrdinalIgnoreCase)) return "surveillance";
        if (app.Contains("Jobs", StringComparison.OrdinalIgnoreCase)) return "jobs";
        return "main";
    }

    public static string Cut(string? s, int max) => string.IsNullOrEmpty(s) || s.Length <= max ? s ?? "" : s[..max] + " …";
}

[ProviderAlias("File")]
public sealed class FileLoggerProvider : ILoggerProvider, ISupportExternalScope
{
    private readonly FileLogOptions _options;
    private readonly string _folder;
    private readonly string _source;
    private readonly Channel<LogEntry> _queue = Channel.CreateBounded<LogEntry>(new BoundedChannelOptions(20000)
    {
        FullMode = BoundedChannelFullMode.DropWrite, SingleReader = true,
    });
    private readonly Task _writer;
    private IExternalScopeProvider _scopes = new LoggerExternalScopeProvider();

    public FileLoggerProvider(Microsoft.Extensions.Options.IOptions<FileLogOptions> options, IHostEnvironment env, IConfiguration config)
    {
        _options = options.Value;
        _folder = FileLog.FolderOf(_options, env.ContentRootPath);
        _source = FileLog.SourceOf(_options, env, config);
        _writer = _options.Enabled ? Task.Run(WriteLoopAsync) : Task.CompletedTask;
    }

    public string Folder => _folder;
    public string Source => _source;

    /// <summary>
    /// 2026-11-23 (Admin → Server Logs was empty on every portal): why the last write to the folder failed (null when the last
    /// write or <see cref="Probe"/> worked). The logger cannot log its own failures, so the page shows this instead.
    /// </summary>
    public string? WriteProblem { get; private set; }

    /// <summary>Checks that the folder can be created and written (a file made and removed); returns the problem or null.</summary>
    public string? Probe()
    {
        if (!_options.Enabled) return WriteProblem = "File logging is switched off (Logging:File:Enabled).";
        try
        {
            Directory.CreateDirectory(_folder);
            var test = Path.Combine(_folder, ".write-test-" + Environment.ProcessId);
            File.WriteAllText(test, "");
            File.Delete(test);
            return WriteProblem = null;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return WriteProblem = ex.Message;
        }
    }

    public ILogger CreateLogger(string categoryName) => new FileLogger(this, categoryName);

    public void SetScopeProvider(IExternalScopeProvider scopeProvider) => _scopes = scopeProvider;

    internal bool IsEnabled(LogLevel level) => _options.Enabled && level != LogLevel.None && level >= _options.MinLevel;

    internal void Add(LogLevel level, string category, EventId eventId, string message, Exception? exception)
    {
        string? path = null, user = null;
        _scopes.ForEachScope((scope, _) =>
        {
            if (scope is not IEnumerable<KeyValuePair<string, object?>> pairs) return;
            foreach (var (k, v) in pairs)
            {
                if (path is null && k == "RequestPath") path = v?.ToString();
                else if (user is null && k == "ZedUser") user = v?.ToString();
            }
        }, (object?)null);
        var trace = Activity.Current?.TraceId.ToHexString();
        var entry = new LogEntry(DateTime.UtcNow, level.ToString(), _source, category, eventId.Id,
            FileLog.Cut(message, FileLog.MaxMessage), exception is null ? null : FileLog.Cut(exception.ToString(), FileLog.MaxException),
            trace is null || trace.All(c => c == '0') ? null : trace, path, user);
        _queue.Writer.TryWrite(entry);
    }

    private async Task WriteLoopAsync()
    {
        DateTime day = default;
        FileStream? file = null;
        StreamWriter? writer = null;
        var capped = false;
        var pruned = DateTime.MinValue;
        try
        {
            while (await _queue.Reader.WaitToReadAsync())
            {
                while (_queue.Reader.TryRead(out var e))
                {
                    try
                    {
                        if (writer is null || e.Time.Date != day)
                        {
                            writer?.Dispose();
                            file = null;
                            day = e.Time.Date;
                            Directory.CreateDirectory(_folder);
                            file = new FileStream(Path.Combine(_folder, FileLog.FileName(day)), FileMode.Append, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete);
                            writer = new StreamWriter(file, new UTF8Encoding(false));
                            capped = false;
                            if (pruned.Date != day) { Prune(day); pruned = day; }
                        }
                        if (capped) continue;
                        if (file!.Length >= _options.MaxFileBytes)
                        {
                            capped = true;
                            await writer.WriteLineAsync(JsonSerializer.Serialize(e with
                            {
                                Level = nameof(LogLevel.Warning), Category = "Zed.Core.Logging", Message = "The day's log reached its size limit; further entries of the day are left out.",
                                Exception = null,
                            }, FileLog.Json));
                            continue;
                        }
                        await writer.WriteLineAsync(JsonSerializer.Serialize(e, FileLog.Json));
                        WriteProblem = null;
                    }
                    catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { WriteProblem = ex.Message; writer?.Dispose(); writer = null; }
                }
                try { if (writer is not null) await writer.FlushAsync(); }
                catch (IOException) { writer?.Dispose(); writer = null; }
            }
        }
        finally
        {
            try { writer?.Dispose(); } catch (IOException) { /* closing */ }
        }
    }

    private void Prune(DateTime today)
    {
        try
        {
            foreach (var f in Directory.EnumerateFiles(_folder, FileLog.FilePrefix + "*" + FileLog.FileSuffix))
                if (FileLog.DayOf(Path.GetFileName(f)) is { } d && d < today.AddDays(-Math.Max(1, _options.RetentionDays)))
                    File.Delete(f);
        }
        catch (IOException) { /* next day */ }
        catch (UnauthorizedAccessException) { /* next day */ }
    }

    public void Dispose()
    {
        _queue.Writer.TryComplete();
        try { _writer.Wait(TimeSpan.FromSeconds(3)); } catch (AggregateException) { /* stopping */ }
    }

    private sealed class FileLogger(FileLoggerProvider provider, string category) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => provider._scopes.Push(state);

        public bool IsEnabled(LogLevel logLevel) => provider.IsEnabled(logLevel);

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            if (!IsEnabled(logLevel)) return;
            provider.Add(logLevel, category, eventId, formatter(state, exception), exception);
        }
    }
}

/// <summary>Reads the log files for Admin → Server Logs: this host's folder and the other hosts' beside it (when readable).</summary>
public static class FileLogReader
{
    public sealed record Source(string Name, string Folder);

    /// <summary>
    /// This host's folder first, then the logs folders of the other applications in the same install folder (the portals and
    /// mobile hosts are siblings under the install root) that this host can read. Named by the source their files carry.
    /// </summary>
    public static IReadOnlyList<Source> Sources(string ownFolder, string ownSource)
    {
        var list = new List<Source> { new(ownSource, ownFolder) };
        try
        {
            var appRoot = Directory.GetParent(Path.GetFullPath(ownFolder))?.FullName;
            var installRoot = appRoot is null ? null : Directory.GetParent(appRoot)?.FullName;
            if (installRoot is null) return list;
            foreach (var app in Directory.EnumerateDirectories(installRoot))
            {
                var folder = Path.Combine(app, "logs");
                if (string.Equals(Path.GetFullPath(folder), Path.GetFullPath(ownFolder), StringComparison.OrdinalIgnoreCase) || !Directory.Exists(folder)) continue;
                try
                {
                    var newest = Directory.EnumerateFiles(folder, FileLog.FilePrefix + "*" + FileLog.FileSuffix).OrderByDescending(f => f).FirstOrDefault();
                    if (newest is null) continue;
                    var name = SourceInFile(newest) ?? Path.GetFileName(app).ToLowerInvariant();
                    if (list.All(s => s.Name != name)) list.Add(new(name, folder));
                }
                catch (UnauthorizedAccessException) { /* not readable by this host */ }
                catch (IOException) { /* in use */ }
            }
        }
        catch (UnauthorizedAccessException) { /* only this host's */ }
        catch (IOException) { /* only this host's */ }
        return list;
    }

    private static string? SourceInFile(string file)
    {
        foreach (var line in ReadLines(file).Take(1))
            if (Parse(line) is { } e) return e.Source;
        return null;
    }

    public static LogEntry? Parse(string line)
    {
        if (string.IsNullOrWhiteSpace(line)) return null;
        try { return JsonSerializer.Deserialize<LogEntry>(line, FileLog.Json); }
        catch (JsonException) { return null; }
    }

    /// <summary>The lines of a file another process is writing (shared read).</summary>
    public static IEnumerable<string> ReadLines(string file)
    {
        using var stream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        using var reader = new StreamReader(stream, Encoding.UTF8);
        while (reader.ReadLine() is { } line) yield return line;
    }

    /// <param name="MaxBytes">2026-11-21 (review): the most text read for one search (then More: narrow the days or the text).</param>
    public sealed record Query(DateTime FromDay, DateTime ToDay, LogLevel MinLevel, string? Text, int Take, long MaxBytes = 200L * 1024 * 1024);

    /// <summary>The level names at or above <paramref name="min"/> as they appear in a line (<c>"l":"Error"</c>).</summary>
    private static string[] LevelTokens(LogLevel min) =>
        Enum.GetValues<LogLevel>().Where(l => l >= min && l != LogLevel.None).Select(l => $"\"l\":\"{l}\"").ToArray();

    /// <summary>
    /// The entries of the days (newest first) at or above the level and containing the text (message, error, path, user, trace
    /// id, category). Lines that cannot match are skipped before they are decoded; the search stops after
    /// <see cref="Query.MaxBytes"/> or when <paramref name="ct"/> is cancelled.
    /// </summary>
    public static (IReadOnlyList<LogEntry> Entries, bool More) Read(string folder, Query q, CancellationToken ct = default)
    {
        var result = new List<LogEntry>();
        var text = q.Text?.Trim();
        var levels = LevelTokens(q.MinLevel);
        // The text is looked for in the raw line first only when JSON writes it as it is (no quotes, backslashes or non-ASCII).
        var rawText = !string.IsNullOrEmpty(text) && text.All(c => c >= ' ' && c < 127 && c != '"' && c != '\\') ? text : null;
        long read = 0;
        for (var day = q.ToDay.Date; day >= q.FromDay.Date; day = day.AddDays(-1))
        {
            var file = Path.Combine(folder, FileLog.FileName(day));
            if (!File.Exists(file)) continue;
            var dayEntries = new List<LogEntry>();
            foreach (var line in ReadLines(file))
            {
                ct.ThrowIfCancellationRequested();
                read += line.Length + 1;
                if (read > q.MaxBytes) { dayEntries.Reverse(); result.AddRange(dayEntries.Take(Math.Max(0, q.Take - result.Count))); return (result, true); }
                if (!levels.Any(t => line.Contains(t, StringComparison.Ordinal))) continue;
                if (rawText is not null && !line.Contains(rawText, StringComparison.OrdinalIgnoreCase)) continue;
                if (Parse(line) is not { } e) continue;
                if (!Enum.TryParse<LogLevel>(e.Level, out var level) || level < q.MinLevel) continue;
                if (!string.IsNullOrEmpty(text) && !Matches(e, text)) continue;
                dayEntries.Add(e);
            }
            dayEntries.Reverse();
            foreach (var e in dayEntries)
            {
                if (result.Count >= q.Take) return (result, true);
                result.Add(e);
            }
        }
        return (result, false);
    }

    private static bool Matches(LogEntry e, string text)
    {
        bool Has(string? s) => s?.Contains(text, StringComparison.OrdinalIgnoreCase) == true;
        return Has(e.Message) || Has(e.Exception) || Has(e.Path) || Has(e.User) || Has(e.TraceId) || Has(e.Category);
    }
}
