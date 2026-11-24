using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Http;
using Zed.Core.Logging;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.Reports;

namespace Zed.Portal.Features.Staff.Settings;

/// <summary>
/// 2026-11-21 (the user: "add logger"; often no access to the server): Admin → Server Logs reads the portal's own log files
/// (<see cref="FileLoggerProvider"/>: warnings and errors with the exception, request path, user and trace id) and those of
/// the other applications beside it (the mobile API hosts) where this host can read them. Each portal keeps its own: the
/// main pages reach the other portals through the portal switch. Read-only; a day's file can be downloaded.
/// 2026-11-24 (the user: "add pagination", "Provide excel download"): the page loads up to <see cref="PageSize"/> entries and pages
/// them in the browser; the chosen days, level and search download as an Excel workbook (up to <see cref="ExcelRows"/> rows).
/// </summary>
[Route("api/staff/settings/server-logs")]
[StaffRoles(UserRole.Admin)]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed class ServerLogsController(FileLoggerProvider files) : StaffApiController
{
    public const int MaxDays = 31;
    public const int PageSize = 2000;
    public const int ExcelRows = 50000;

    public sealed record SourceDto(string Name, IReadOnlyList<string> Days);

    /// <param name="Folder">This host's log folder on the server.</param>
    /// <param name="WriteProblem">Why this host cannot write its log (2026-11-23), null when it can.</param>
    public sealed record ListResponse(string Source, IReadOnlyList<SourceDto> Sources, IReadOnlyList<LogEntry> Entries, bool More, string From, string To,
        string? Folder = null, string? WriteProblem = null);

    /// <summary>2026-11-21 (review): the folders are scanned once a minute, not on every search.</summary>
    private static (DateTime At, IReadOnlyList<FileLogReader.Source> List)? _sources;

    private IReadOnlyList<FileLogReader.Source> Sources()
    {
        var kept = _sources;
        if (kept is { } k && DateTime.UtcNow - k.At < TimeSpan.FromMinutes(1) && k.List.Count > 0 && k.List[0].Folder == files.Folder) return k.List;
        var list = FileLogReader.Sources(files.Folder, files.Source);
        files.Probe();
        _sources = (DateTime.UtcNow, list);
        return list;
    }

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

    private sealed record Filter(FileLogReader.Source Chosen, IReadOnlyList<FileLogReader.Source> Sources, DateTime FromDay, DateTime ToDay, LogLevel Min, string? Text);

    /// <summary>The days (UTC), level, search text and log of a list or an Excel download; a 400 answer when one is not valid.</summary>
    private ActionResult? TryFilter(string? source, string? from, string? to, string? level, string? q, out Filter filter)
    {
        filter = null!;
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
        filter = new Filter(chosen, sources, fromDay, toDay, min.Value, q);
        return null;
    }

    /// <summary>
    /// GET api/staff/settings/server-logs?source=&amp;from=yyyy-MM-dd&amp;to=yyyy-MM-dd&amp;level=Warning|Error|Critical&amp;q= — the entries,
    /// newest first (at most <see cref="PageSize"/>; More when there are others: narrow the dates or the text). Days are UTC.
    /// </summary>
    [HttpGet]
    public ActionResult<ListResponse> List(string? source, string? from, string? to, string? level, string? q, CancellationToken ct = default)
    {
        if (TryFilter(source, from, to, level, q, out var f) is { } bad) return bad;
        try
        {
            var (entries, more) = FileLogReader.Read(f.Chosen.Folder, new FileLogReader.Query(f.FromDay, f.ToDay, f.Min, f.Text, PageSize), ct);
            return new ListResponse(f.Chosen.Name, f.Sources.Select(s => new SourceDto(s.Name, DaysOf(s.Folder))).ToList(), entries, more,
                f.FromDay.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), f.ToDay.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                files.Folder, files.WriteProblem);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return this.Problem400("The log could not be read: " + ex.Message);
        }
    }

    private static readonly TimeZoneInfo India = FindIndia();

    private static TimeZoneInfo FindIndia()
    {
        foreach (var id in new[] { "Asia/Kolkata", "India Standard Time" })
        {
            try { return TimeZoneInfo.FindSystemTimeZoneById(id); }
            catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException) { }
        }
        return TimeZoneInfo.CreateCustomTimeZone("IST", TimeSpan.FromMinutes(330), "IST", "IST");
    }

    /// <summary>Excel keeps at most 32,767 characters in a cell.</summary>
    private static string? Cell(string? text) => text is { Length: > 32000 } ? text[..32000] + " …" : text;

    /// <summary>
    /// GET api/staff/settings/server-logs/excel?source=&amp;from=&amp;to=&amp;level=&amp;q= — the entries of the same filters as the list (newest
    /// first, up to <see cref="ExcelRows"/>) as an .xlsx workbook: time (IST), level, message, error details, address, user, reference, source.
    /// </summary>
    [HttpGet("excel")]
    public IActionResult Excel(string? source, string? from, string? to, string? level, string? q, CancellationToken ct = default)
    {
        if (TryFilter(source, from, to, level, q, out var f) is { } bad) return bad;
        IReadOnlyList<LogEntry> entries;
        try
        {
            (entries, _) = FileLogReader.Read(f.Chosen.Folder, new FileLogReader.Query(f.FromDay, f.ToDay, f.Min, f.Text, ExcelRows), ct);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return this.Problem400("The log could not be read: " + ex.Message);
        }
        var rows = entries.Select(e => (IReadOnlyList<object?>)
        [
            TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(e.Time, DateTimeKind.Utc), India).ToString("dd-MM-yyyy HH:mm:ss", CultureInfo.InvariantCulture),
            e.Level, Cell(e.Message), Cell(e.Exception), e.Path, e.User, e.TraceId, e.EventId == 0 ? e.Category : $"{e.Category} ({e.EventId})",
        ]);
        var bytes = XlsxWriter.Write([new XlsxSheet("Server logs",
            ["Time (IST)", "Level", "Message", "Error details", "Address", "User", "Reference", "Source"], rows)]);
        var name = $"{f.Chosen.Name}-server-logs-{f.FromDay:yyyyMMdd}-{f.ToDay:yyyyMMdd}.xlsx";
        return File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", name);
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
