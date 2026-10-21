using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;

namespace Zed.Jobs;

public enum FolderRenameMode { Report, Apply }

/// <summary>
/// Jobs:FolderRename. Replaces SP_JOB_TO_CREATE_RENAMING_BATCH_FILES, which used xp_cmdshell and bcp to write a .bat
/// of REN commands that someone then ran by hand (SECURITY-FINDINGS #12). When a unit is rejected its rows are
/// archived under ZedId_D_{Id} (ZedId_D for the old auto-reject), and the unit can apply again under its own ZED ID;
/// moving its folders to the archived name keeps the rejected application's files with the rejected record and out
/// of the new application. Schedule fields as in Jobs:Schedules.
/// </summary>
public sealed class FolderRenameOptions
{
    public const string JobName = "Folder rename (rejected units)";
    public const string PendingProcedure = "SP_V4_FOLDER_RENAME_PENDING";
    public const string RecordProcedure = "SP_V4_FOLDER_RENAME_RECORD";

    public bool Enabled { get; set; }

    /// <summary>Report (default): logs what Apply would do and changes nothing. Apply: moves the folders.</summary>
    public FolderRenameMode Mode { get; set; } = FolderRenameMode.Report;

    public List<string> DailyAt { get; set; } = [];
    public int? EveryMinutes { get; set; }
    public string? WindowStart { get; set; }
    public string? WindowEnd { get; set; }
    public List<string> DaysOfWeek { get; set; } = [];
    public List<int> DaysOfMonth { get; set; } = [];

    /// <summary>A rejection is picked up once it is this old (the old job: 2 hours).</summary>
    public int DelayHours { get; set; } = 2;

    /// <summary>MsmeHistory certification types to pick up. Empty = Bronze (the old job).</summary>
    public List<string> CertificationTypes { get; set; } = [];

    /// <summary>Only while dbo.FolderRenameHIstory has no row marked 'Yes': start after this MsmeHistory Id (the
    /// old job collected nothing at all then).</summary>
    public int? StartAfterId { get; set; }

    /// <summary>Files written this long after the rejection still count as the rejected application's (a report the
    /// rejection itself wrote). Anything later means the unit applied again: that folder is not moved.</summary>
    public int GraceMinutes { get; set; } = 10;

    /// <summary>Folders whose per-unit subfolders are renamed.</summary>
    public List<FolderRenameRoot> Roots { get; set; } = [];

    public string? Note { get; set; }

    internal IReadOnlyList<string> Types => CertificationTypes.Count > 0 ? CertificationTypes : ["Bronze"];

    internal JobDefinition AsJob() => new()
    {
        Name = JobName,
        Database = "Main",
        Procedure = PendingProcedure,
        DailyAt = DailyAt,
        EveryMinutes = EveryMinutes,
        WindowStart = WindowStart,
        WindowEnd = WindowEnd,
        DaysOfWeek = DaysOfWeek,
        DaysOfMonth = DaysOfMonth,
        Enabled = Enabled,
    };
}

public sealed class FolderRenameRoot
{
    public string Name { get; set; } = "";

    /// <summary>Absolute path of the folder that holds one subfolder per ZED ID.</summary>
    public string Path { get; set; } = "";

    /// <summary>False: {Path}\{ZedId} is moved to {Path}\{ArchivedId} (the old job). True: only the rejected level,
    /// {Path}\{ZedId}\{Level} to {Path}\{ArchivedId}\{Level}, so files of the unit's other levels stay.</summary>
    public bool PerLevel { get; set; }
}

/// <summary>A row of SP_V4_FOLDER_RENAME_PENDING.</summary>
public sealed class PendingRename
{
    public int Id { get; set; }

    /// <summary>The archived ZED ID (ZEDMSME000123_D_45).</summary>
    public string? ZedId { get; set; }

    public string? CertificationType { get; set; }

    /// <summary>False: a new rejection Report mode found but did not add to dbo.FolderRenameHIstory.</summary>
    public bool InTable { get; set; }

    public int? MinutesSinceRejection { get; set; }

    /// <summary>Certification rows using the unit's own ZED ID again ("Bronze:1,Silver:5"), or null.</summary>
    public string? BaseCertifications { get; set; }
}

public enum RenameOutcome
{
    /// <summary>Report mode: Apply would move the folders listed in the detail.</summary>
    WouldMove,
    Moved,
    NothingToMove,
    /// <summary>The folders are already under the archived name (moved by an earlier run or by hand).</summary>
    AlreadyArchived,
    /// <summary>The row's ZED ID has no _D suffix: there is nothing to rename to (the old job wrote a no-op REN).</summary>
    NotArchived,
    /// <summary>Both the unit's folder and the archived folder exist: not merged, left waiting.</summary>
    Conflict,
    /// <summary>The unit's folder has files newer than the rejection (the unit applied again): left waiting.</summary>
    NewerFiles,
    InvalidId,
    Error,
}

/// <param name="Done">Marked (Report mode: would be marked) RenameDone = 'Yes'.</param>
public sealed record RenameResult(PendingRename Row, RenameOutcome Outcome, bool Done, string Detail);

public sealed partial class FolderRenamer(IJobDatabases databases, IOptions<JobsOptions> options, TimeProvider clock, ILogger<FolderRenamer> log)
{
    public async Task<IReadOnlyList<RenameResult>> RunAsync(CancellationToken ct)
    {
        var o = options.Value.FolderRename;
        var problems = FolderRenameChecker.ConfigErrors(o, includeSchedule: false).ToList();
        if (problems.Count > 0) throw new InvalidOperationException(string.Join(" ", problems));

        var apply = o.Mode == FolderRenameMode.Apply;
        var db = databases["Main"];
        var rows = await db.QueryProcAsync<PendingRename>(FolderRenameOptions.PendingProcedure, new
        {
            CertificationTypes = string.Join(",", o.Types),
            o.DelayHours,
            Collect = apply,
            o.StartAfterId,
        }, ct);

        var results = new List<RenameResult>();
        var seen = new Dictionary<string, RenameResult>(StringComparer.OrdinalIgnoreCase);
        foreach (var row in rows)
        {
            ct.ThrowIfCancellationRequested();
            // Several history rows of one rejection share the archived ZED ID: the folders are handled once.
            var r = row.ZedId is { } z && seen.TryGetValue(z.Trim(), out var earlier)
                ? earlier with { Row = row }
                : Process(row, o, apply);
            if (row.ZedId is { } key) seen[key.Trim()] = r;

            if (r.Outcome is RenameOutcome.Error or RenameOutcome.Conflict or RenameOutcome.NewerFiles or RenameOutcome.InvalidId)
                log.LogWarning("Folder rename {Mode} {Id} {ZedId}: {Outcome}. {Detail}", o.Mode, row.Id, row.ZedId, r.Outcome, r.Detail);
            else
                log.LogInformation("Folder rename {Mode} {Id} {ZedId}: {Outcome}. {Detail}", o.Mode, row.Id, row.ZedId, r.Outcome, r.Detail);

            if (apply && row.InTable)
                await db.ExecuteProcAsync(FolderRenameOptions.RecordProcedure, new
                {
                    row.Id,
                    row.ZedId,
                    Outcome = r.Outcome.ToString(),
                    r.Done,
                    Detail = r.Detail.Length > 1000 ? r.Detail[..1000] : r.Detail,
                }, ct);
            results.Add(r);
        }
        return results;
    }

    private sealed record Step(FolderRenameRoot Root, string RootFull, string Source, string Target, RenameOutcome Outcome, string Detail);

    private RenameResult Process(PendingRename row, FolderRenameOptions o, bool apply)
    {
        var archived = row.ZedId?.Trim() ?? "";
        var m = ArchivedId().Match(archived);
        if (!m.Success)
            return BaseId().IsMatch(archived)
                ? new(row, RenameOutcome.NotArchived, true, "Not an archived ZED ID (no _D suffix): nothing to rename.")
                : new(row, RenameOutcome.InvalidId, false, "The ZED ID is not a ZED ID or an archived one; not touched. Fix or mark the row by hand.");
        var baseId = m.Groups["base"].Value;
        var level = row.CertificationType?.Trim() ?? "";
        if (o.Roots.Any(r => r.PerLevel) && !Level().IsMatch(level))
            return new(row, RenameOutcome.InvalidId, false, "The certification type is not a level name; not touched.");

        // The rejection time comes from the database clock (minutes ago), so the two servers' clocks need not agree.
        DateTime? cutoffUtc = row.MinutesSinceRejection is int minutes
            ? clock.GetUtcNow().UtcDateTime.AddMinutes(-minutes + o.GraceMinutes)
            : null;
        var inUse = string.IsNullOrWhiteSpace(row.BaseCertifications) ? "" : $" The unit's own ZED ID is in use again ({row.BaseCertifications}).";

        var steps = new List<Step>();
        foreach (var root in o.Roots)
            steps.Add(Plan(root, baseId, archived, level, cutoffUtc));

        string Describe() => string.Join("; ", steps.Select(s => $"{s.Root.Name}: {s.Detail}")) + inUse;

        foreach (var blocking in new[] { RenameOutcome.InvalidId, RenameOutcome.Error, RenameOutcome.Conflict, RenameOutcome.NewerFiles })
            if (steps.Any(s => s.Outcome == blocking))
                return new(row, blocking, false, Describe());

        var moves = steps.Where(s => s.Outcome == RenameOutcome.Moved).ToList();
        if (moves.Count == 0)
            return new(row, steps.Any(s => s.Outcome == RenameOutcome.AlreadyArchived) ? RenameOutcome.AlreadyArchived : RenameOutcome.NothingToMove,
                true, Describe());
        if (!apply)
        {
            for (var i = 0; i < steps.Count; i++)
                if (steps[i].Outcome == RenameOutcome.Moved) steps[i] = steps[i] with { Detail = "would move " + steps[i].Detail };
            return new(row, RenameOutcome.WouldMove, true, Describe());
        }

        for (var i = 0; i < steps.Count; i++)
        {
            var s = steps[i];
            if (s.Outcome != RenameOutcome.Moved) continue;
            try
            {
                Move(s);
                steps[i] = s with { Detail = "moved " + s.Detail };
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                steps[i] = s with { Outcome = RenameOutcome.Error, Detail = $"could not move {s.Detail}: {ex.Message}" };
                // The folders moved so far are found as AlreadyArchived on the next run.
                return new(row, RenameOutcome.Error, false, Describe());
            }
        }
        return new(row, RenameOutcome.Moved, true, Describe());
    }

    private static Step Plan(FolderRenameRoot root, string baseId, string archived, string level, DateTime? cutoffUtc)
    {
        var rootFull = Path.TrimEndingDirectorySeparator(Path.GetFullPath(root.Path));
        string[] from = root.PerLevel ? [baseId, level] : [baseId];
        string[] to = root.PerLevel ? [archived, level] : [archived];
        var label = $"{string.Join('\\', from)} -> {string.Join('\\', to)}";
        var source = Inside(rootFull, from);
        var target = Inside(rootFull, to);
        if (source is null || target is null)
            return new(root, rootFull, "", "", RenameOutcome.InvalidId, $"{label} would leave the folder; not touched");
        try
        {
            var sourceExists = Directory.Exists(source);
            var targetExists = Directory.Exists(target) || File.Exists(target);
            if (!sourceExists)
                return new(root, rootFull, source, target, targetExists ? RenameOutcome.AlreadyArchived : RenameOutcome.NothingToMove,
                    targetExists ? $"{string.Join('\\', to)} already there" : $"no {string.Join('\\', from)} folder");
            if (targetExists)
                return new(root, rootFull, source, target, RenameOutcome.Conflict,
                    $"both {string.Join('\\', from)} and {string.Join('\\', to)} exist; not merged, move the files by hand");
            if (cutoffUtc is { } cutoff && Newest(source) is { } newest && newest > cutoff)
                return new(root, rootFull, source, target, RenameOutcome.NewerFiles,
                    $"{string.Join('\\', from)} has files written after the rejection (latest {newest:yyyy-MM-dd HH:mm} UTC): the unit has probably applied again; separate the files by hand");
            return new(root, rootFull, source, target, RenameOutcome.Moved, label);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return new(root, rootFull, source, target, RenameOutcome.Error, $"{label}: {ex.Message}");
        }
    }

    private static void Move(Step s)
    {
        if (s.Root.PerLevel) Directory.CreateDirectory(Path.GetDirectoryName(s.Target)!);
        Directory.Move(s.Source, s.Target);
        if (!s.Root.PerLevel) return;
        // The unit's folder held only this level: remove the empty folder, as the old whole-folder REN left none.
        var parent = Path.GetDirectoryName(s.Source)!;
        if (!string.Equals(parent, s.RootFull, StringComparison.OrdinalIgnoreCase) && !Directory.EnumerateFileSystemEntries(parent).Any())
            Directory.Delete(parent);
    }

    private static DateTime? Newest(string folder)
    {
        DateTime? newest = null;
        foreach (var f in new DirectoryInfo(folder).EnumerateFiles("*", SearchOption.AllDirectories))
            if (newest is null || f.LastWriteTimeUtc > newest) newest = f.LastWriteTimeUtc;
        return newest;
    }

    private static string? Inside(string rootFull, string[] segments)
    {
        var path = Path.GetFullPath(Path.Combine([rootFull, .. segments]));
        return path.Length > rootFull.Length + 1
            && path.StartsWith(rootFull + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) ? path : null;
    }

    [GeneratedRegex(@"^[A-Za-z]{2,12}[0-9]{1,12}$")]
    internal static partial Regex BaseId();

    /// <summary>ZEDMSME000123_D_45 (V4 and SP_MONITORING_REJECT_CERTIFICATION) or ZEDMSME000123_D (the old auto-reject).</summary>
    [GeneratedRegex(@"^(?<base>[A-Za-z]{2,12}[0-9]{1,12})_D(?:_[0-9]{1,12})?$")]
    internal static partial Regex ArchivedId();

    [GeneratedRegex(@"^[A-Za-z]{1,20}$")]
    internal static partial Regex Level();
}

/// <summary>Checks Jobs:FolderRename: settings, folders (exist, writable) and the 0007 procedures.</summary>
public sealed class FolderRenameChecker(IProcedureCatalog catalog, IJobDatabases databases)
{
    /// <summary>Errors in the settings alone (no database or disk access).</summary>
    public static IEnumerable<string> ConfigErrors(FolderRenameOptions o, bool includeSchedule)
    {
        foreach (var e in JobSchedule.Validate(o.AsJob()))
            if (includeSchedule || e != "Set DailyAt or EveryMinutes.") yield return e;
        if (o.DelayHours is < 0 or > 720) yield return "DelayHours must be 0 to 720.";
        if (o.GraceMinutes is < 0 or > 1440) yield return "GraceMinutes must be 0 to 1440.";
        foreach (var t in o.Types)
            if (!FolderRenamer.Level().IsMatch(t)) yield return $"'{t}' is not a certification type.";
        if (o.Roots.Count == 0) yield return "Roots is empty: list the folders to rename in.";
        foreach (var r in o.Roots)
        {
            if (string.IsNullOrWhiteSpace(r.Name)) yield return "A root has no Name.";
            if (string.IsNullOrWhiteSpace(r.Path) || !Path.IsPathFullyQualified(r.Path)) yield return $"Root '{r.Name}': Path must be an absolute folder path.";
        }
        foreach (var dup in o.Roots.GroupBy(r => r.Name, StringComparer.OrdinalIgnoreCase).Where(g => g.Count() > 1))
            yield return $"Root name '{dup.Key}' is used twice.";
    }

    public async Task<(List<string> Errors, List<string> Warnings)> CheckAsync(FolderRenameOptions o, bool includeSchedule, CancellationToken ct)
    {
        var errors = ConfigErrors(o, includeSchedule).ToList();
        var warnings = new List<string>();
        foreach (var r in o.Roots.Where(r => !string.IsNullOrWhiteSpace(r.Path) && Path.IsPathFullyQualified(r.Path)))
        {
            if (!Directory.Exists(r.Path))
            {
                errors.Add($"Root '{r.Name}': {r.Path} does not exist or is not reachable.");
                continue;
            }
            var probe = Path.Combine(r.Path, $".zed-jobs-write-check-{Guid.NewGuid():N}.tmp");
            try
            {
                await File.WriteAllTextAsync(probe, "", ct);
                File.Delete(probe);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                errors.Add($"Root '{r.Name}': the service account cannot write in {r.Path} ({ex.Message}).");
            }
        }
        if (!databases.Names.Contains("Main", StringComparer.OrdinalIgnoreCase))
            errors.Add("ConnectionStrings:Main is not configured.");
        else
            foreach (var procedure in new[] { FolderRenameOptions.PendingProcedure, FolderRenameOptions.RecordProcedure })
                try
                {
                    if (await catalog.GetAsync("Main", procedure, ct) is null)
                        errors.Add($"Main.dbo.{procedure} does not exist: run database/migrations/0007_folder_rename.sql.");
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    warnings.Add($"Main database not reachable ({ex.Message}).");
                    break;
                }
        return (errors, warnings);
    }

    /// <summary>The --check section. Returns 1 when the job is enabled and has a problem.</summary>
    public async Task<int> ReportAsync(FolderRenameOptions o, TextWriter output, CancellationToken ct)
    {
        if (!o.Enabled && o.Roots.Count == 0)
        {
            output.WriteLine("Folder rename (Jobs:FolderRename): not configured.");
            return 0;
        }
        var (errors, warnings) = await CheckAsync(o, includeSchedule: o.Enabled, ct);
        var status = errors.Count > 0 ? "ERROR" : warnings.Count > 0 ? "WARN" : "OK";
        if (!o.Enabled && status != "OK") status = "(disabled) " + status;
        output.WriteLine($"{status,-22} {FolderRenameOptions.JobName}  [Main.{FolderRenameOptions.PendingProcedure}]  " +
            $"{(o.Enabled ? "enabled" : "disabled")}, mode {o.Mode}, {JobSchedule.Describe(o.AsJob())}, " +
            $"roots: {string.Join(", ", o.Roots.Select(r => r.Name + (r.PerLevel ? " (per level)" : "")))}");
        foreach (var e in errors) output.WriteLine("    error: " + e);
        foreach (var w in warnings) output.WriteLine("    warning: " + w);
        return o.Enabled && errors.Count > 0 ? 1 : 0;
    }
}

/// <summary>Runs <see cref="FolderRenamer"/> on its schedule, under the same per-job lock and run history as the other jobs.</summary>
public sealed class FolderRenameWorker(
    IConfiguration config, IOptions<JobsOptions> options, FolderRenamer renamer, FolderRenameChecker checker,
    ILogger<FolderRenameWorker> log, TimeProvider clock) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var o = options.Value.FolderRename;
        if (!o.Enabled) return;
        var (errors, warnings) = await checker.CheckAsync(o, includeSchedule: true, stoppingToken);
        foreach (var w in warnings) log.LogWarning("Job {Job}: {Warning}", FolderRenameOptions.JobName, w);
        if (errors.Count > 0)
        {
            log.LogError("Job {Job} is not scheduled: {Errors}", FolderRenameOptions.JobName, string.Join(" ", errors));
            return;
        }

        var job = o.AsJob();
        var zone = TimeZoneInfo.FindSystemTimeZoneById(options.Value.TimeZone);
        DateTime last = TimeZoneInfo.ConvertTime(clock.GetUtcNow(), zone).DateTime;
        try
        {
            if ((await JobRuns.LastStartsAsync(config.GetConnectionString("Main"), stoppingToken)).TryGetValue(job.Name, out var started))
                last = started;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Could not read dbo.V4JobRuns; {Job} starts from its next scheduled time", job.Name);
        }
        log.LogInformation("Scheduled job: {Job} ({Schedule}), mode {Mode}", job.Name, JobSchedule.Describe(job), o.Mode);

        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        do
        {
            var now = TimeZoneInfo.ConvertTime(clock.GetUtcNow(), zone).DateTime;
            if (!JobSchedule.IsDue(job, now, last)) continue;
            last = now;
            await RunOnceAsync(now, stoppingToken);
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    private async Task RunOnceAsync(DateTime started, CancellationToken ct)
    {
        var watch = System.Diagnostics.Stopwatch.StartNew();
        string? error = null;
        var main = config.GetConnectionString("Main");
        try
        {
            await using var lockConn = await JobRuns.TryLockAsync(main, FolderRenameOptions.JobName, ct);
            if (lockConn is null)
            {
                log.LogInformation("Job {Job} is already running elsewhere; skipped", FolderRenameOptions.JobName);
                return;
            }
            var results = await renamer.RunAsync(ct);
            var failed = results.Where(r => r.Outcome == RenameOutcome.Error).ToList();
            var waiting = results.Count(r => !r.Done);
            log.LogInformation("Job {Job} finished: {Rows} row(s), {Waiting} left waiting, {Failed} error(s)",
                FolderRenameOptions.JobName, results.Count, waiting, failed.Count);
            if (failed.Count > 0)
                error = $"{failed.Count} unit(s) could not be moved: " + string.Join(" | ", failed.Select(f => $"{f.Row.ZedId}: {f.Detail}"));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            error = ex.Message;
            log.LogError(ex, "Job {Job} failed", FolderRenameOptions.JobName);
        }
        await JobRuns.RecordAsync(main, FolderRenameOptions.JobName, "Main", FolderRenameOptions.PendingProcedure,
            started, (int)Math.Min(int.MaxValue, watch.ElapsedMilliseconds), error, log, ct);
    }
}
