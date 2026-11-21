using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Http;
using Zed.Core.Logging;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Settings;

/// <summary>
/// 2026-11-21 (the user: "add logger"; often no access to the server): Admin → Server Logs reads the portal's own log files
/// (<see cref="FileLoggerProvider"/>: warnings and errors with the exception, request path, user and trace id) and those of
/// the other applications beside it (the mobile API hosts) where this host can read them. Each portal keeps its own: the
/// main pages reach the other portals through the portal switch. Read-only; a day's file can be downloaded.
/// </summary>
[Route("api/staff/settings/server-logs")]
[StaffRoles(UserRole.Admin)]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed class ServerLogsController(FileLoggerProvider files) : StaffApiController
{
    public const int MaxDays = 31;
    public const int PageSize = 300;

    public sealed record SourceDto(string Name, IReadOnlyList<string> Days);

    public sealed record ListResponse(string Source, IReadOnlyList<SourceDto> Sources, IReadOnlyList<LogEntry> Entries, bool More, string From, string To);

    private IReadOnlyList<FileLogReader.Source> Sources() => FileLogReader.Sources(files.Folder, files.Source);

    private static IReadOnlyList<string> DaysOf(string folder)
    {
        try
        {
            return Directory.Exists(folder)
                ? Directory.EnumerateFiles(folder, FileLog.FilePrefix + "*" + FileLog.FileSuffix)
                    .Select(f => FileLog.DayOf(Path.GetFileName(f))).OfType<DateTime>().OrderByDescending(d => d)
                    .Select(d => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)).ToList()
                : [];
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { return []; }
    }

    private static bool TryDay(string? text, DateTime fallback, out DateTime day)
    {
        if (string.IsNullOrWhiteSpace(text)) { day = fallback; return true; }
        return DateTime.TryParseExact(text, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out day);
    }

    /// <summary>
    /// GET api/staff/settings/server-logs?source=&amp;from=yyyy-MM-dd&amp;to=yyyy-MM-dd&amp;level=Warning|Error|Critical&amp;q= — the entries,
    /// newest first (at most <see cref="PageSize"/>; More when there are others: narrow the dates or the text). Days are UTC.
    /// </summary>
    [HttpGet]
    public ActionResult<ListResponse> List(string? source, string? from, string? to, string? level, string? q)
    {
        var today = DateTime.UtcNow.Date;
        if (!TryDay(to, today, out var toDay) || !TryDay(from, toDay, out var fromDay) || fromDay > toDay)
            return this.Problem400("Please choose valid dates (from on or before to).");
        if ((toDay - fromDay).TotalDays >= MaxDays) return this.Problem400($"Please choose at most {MaxDays} days.");
        var min = string.IsNullOrWhiteSpace(level) ? LogLevel.Warning : Enum.TryParse<LogLevel>(level, true, out var l) && l is >= LogLevel.Warning and <= LogLevel.Critical ? l : (LogLevel?)null;
        if (min is null) return this.Problem400("Please choose Warning, Error or Critical.");
        if (q?.Length > 200) return this.Problem400("The search text can be up to 200 characters.");
        var sources = Sources();
        var chosen = string.IsNullOrWhiteSpace(source) ? sources[0] : sources.FirstOrDefault(s => string.Equals(s.Name, source.Trim(), StringComparison.OrdinalIgnoreCase));
        if (chosen is null) return this.Problem400("Unknown log.");
        try
        {
            var (entries, more) = FileLogReader.Read(chosen.Folder, new FileLogReader.Query(fromDay, toDay, min.Value, q, PageSize));
            return new ListResponse(chosen.Name, sources.Select(s => new SourceDto(s.Name, DaysOf(s.Folder))).ToList(), entries, more,
                fromDay.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), toDay.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return this.Problem400("The log could not be read: " + ex.Message);
        }
    }

    /// <summary>GET api/staff/settings/server-logs/download?source=&amp;day=yyyy-MM-dd — a day's file as it is (JSON lines).</summary>
    [HttpGet("download")]
    public IActionResult Download(string? source, string? day)
    {
        if (!TryDay(day, DateTime.UtcNow.Date, out var d)) return this.Problem400("Please choose a valid day.");
        var chosen = string.IsNullOrWhiteSpace(source) ? Sources()[0] : Sources().FirstOrDefault(s => string.Equals(s.Name, source.Trim(), StringComparison.OrdinalIgnoreCase));
        if (chosen is null) return this.Problem400("Unknown log.");
        var path = Path.Combine(chosen.Folder, FileLog.FileName(d));
        if (!System.IO.File.Exists(path)) return NotFound();
        var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        return File(stream, "application/x-ndjson", $"{chosen.Name}-{FileLog.FileName(d)}");
    }
}
