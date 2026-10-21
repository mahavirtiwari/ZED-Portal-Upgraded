using System.Data;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Options;

namespace Zed.Jobs;

/// <summary>
/// Runs the former SQL Agent jobs. Each run is recorded in dbo.V4JobRuns of the Main database
/// (database/migrations/0004_job_runs.sql), and an application lock per job stops two service instances from
/// running the same job at once.
/// </summary>
public sealed class ProcedureJobWorker(
    IConfiguration config, IOptions<JobsOptions> options, JobChecker checker, ILogger<ProcedureJobWorker> log, TimeProvider clock) : BackgroundService
{
    private readonly Dictionary<string, DateTime> lastStart = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Checked calls per job; a job whose database was unreachable at start is checked again before it runs.</summary>
    private readonly Dictionary<string, IReadOnlyList<PreparedCall>> prepared = new(StringComparer.OrdinalIgnoreCase);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var o = options.Value;
        var zone = TimeZoneInfo.FindSystemTimeZoneById(o.TimeZone);
        var jobs = new List<JobDefinition>();
        foreach (var job in o.Schedules.Where(j => j.Enabled))
        {
            var check = await checker.CheckAsync(job, stoppingToken);
            foreach (var w in check.Warnings) log.LogWarning("Job {Job}: {Warning}", job.Name, w);
            if (check.State == JobCheckState.Invalid)
            {
                log.LogError("Job {Job} is not scheduled: {Errors}", job.Name, string.Join(" ", check.Errors));
                continue;
            }
            if (check.State == JobCheckState.Ok) prepared[job.Name] = check.Calls;
            jobs.Add(job);
        }
        if (jobs.Count == 0)
        {
            log.LogInformation("No scheduled jobs enabled (Jobs:Schedules)");
            return;
        }

        await LoadHistoryAsync(jobs, zone, stoppingToken);
        log.LogInformation("Scheduled jobs: {Jobs}", string.Join(", ", jobs.Select(j => $"{j.Name} ({JobSchedule.Describe(j)})")));
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        do
        {
            var now = TimeZoneInfo.ConvertTime(clock.GetUtcNow(), zone).DateTime;
            foreach (var job in jobs)
            {
                lastStart.TryGetValue(job.Name, out var last);
                if (!JobSchedule.IsDue(job, now, last == default ? null : last)) continue;
                lastStart[job.Name] = now;
                await RunAsync(job, now, stoppingToken);
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    /// <summary>Last start per job; a job that never ran here waits for its next scheduled time (no catch-up on first start).</summary>
    private async Task LoadHistoryAsync(List<JobDefinition> jobs, TimeZoneInfo zone, CancellationToken ct)
    {
        var now = TimeZoneInfo.ConvertTime(clock.GetUtcNow(), zone).DateTime;
        foreach (var job in jobs) lastStart[job.Name] = now;
        try
        {
            await using var conn = new SqlConnection(config.GetConnectionString("Main"));
            await conn.OpenAsync(ct);
            await using var cmd = new SqlCommand("SELECT JobName, MAX(StartedAt) FROM dbo.V4JobRuns GROUP BY JobName", conn);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
                if (jobs.Any(j => string.Equals(j.Name, reader.GetString(0), StringComparison.OrdinalIgnoreCase)))
                    lastStart[reader.GetString(0)] = reader.GetDateTime(1);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Could not read dbo.V4JobRuns; jobs start from their next scheduled time");
        }
    }

    /// <param name="started">Start time in the schedule's time zone (what dbo.V4JobRuns stores).</param>
    private async Task RunAsync(JobDefinition job, DateTime started, CancellationToken ct)
    {
        var watch = System.Diagnostics.Stopwatch.StartNew();
        var errors = new List<string>();
        try
        {
            if (!prepared.TryGetValue(job.Name, out var calls))
            {
                var check = await checker.CheckAsync(job, ct);
                if (check.State != JobCheckState.Ok)
                    throw new InvalidOperationException(string.Join(" ", check.Errors.Concat(check.Warnings)));
                prepared[job.Name] = calls = check.Calls;
            }

            // The lock is taken in Main (where dbo.V4JobRuns is), whatever databases the steps use.
            await using var lockConn = new SqlConnection(config.GetConnectionString("Main"));
            await lockConn.OpenAsync(ct);
            await using (var lockCmd = new SqlCommand("sp_getapplock", lockConn) { CommandType = CommandType.StoredProcedure })
            {
                lockCmd.Parameters.AddWithValue("@Resource", "zed-job:" + job.Name);
                lockCmd.Parameters.AddWithValue("@LockMode", "Exclusive");
                lockCmd.Parameters.AddWithValue("@LockOwner", "Session");
                lockCmd.Parameters.AddWithValue("@LockTimeout", 0);
                var rc = lockCmd.Parameters.Add("@rc", SqlDbType.Int);
                rc.Direction = ParameterDirection.ReturnValue;
                await lockCmd.ExecuteNonQueryAsync(ct);
                if ((int)rc.Value < 0)
                {
                    log.LogInformation("Job {Job} is already running elsewhere; skipped", job.Name);
                    return;
                }
            }

            for (var i = 0; i < calls.Count; i++)
            {
                var call = calls[i];
                var label = calls.Count > 1 ? $"step {i + 1} ({call.Database}.{call.Procedure})" : $"{call.Database}.{call.Procedure}";
                try
                {
                    log.LogInformation("Job {Job}: {Step} started", job.Name, label);
                    await using var conn = new SqlConnection(config.GetConnectionString(call.Database)
                        ?? throw new InvalidOperationException($"ConnectionStrings:{call.Database} is not configured."));
                    await conn.OpenAsync(ct);
                    // The names were checked against ^[A-Za-z0-9_]+$ and against the database (JobChecker).
                    await using var cmd = new SqlCommand("dbo." + call.Procedure, conn)
                    {
                        CommandType = CommandType.StoredProcedure,
                        CommandTimeout = options.Value.CommandTimeoutSeconds,
                    };
                    foreach (var (name, value) in call.Parameters) cmd.Parameters.AddWithValue("@" + name, value);
                    await cmd.ExecuteNonQueryAsync(ct);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    errors.Add($"{label}: {ex.Message}");
                    log.LogError(ex, "Job {Job}: {Step} failed", job.Name, label);
                    if (!call.ContinueOnFailure) break;
                }
            }
            if (errors.Count == 0) log.LogInformation("Job {Job} finished in {Seconds:0}s", job.Name, watch.Elapsed.TotalSeconds);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            errors.Add(ex.Message);
            log.LogError(ex, "Job {Job} failed", job.Name);
        }
        var error = errors.Count == 0 ? null : string.Join(" | ", errors);
        if (error is { Length: > 2000 }) error = error[..2000];
        await RecordAsync(job, started, (int)Math.Min(int.MaxValue, watch.ElapsedMilliseconds), error, ct);
    }

    private async Task RecordAsync(JobDefinition job, DateTime started, int elapsedMs, string? error, CancellationToken ct)
    {
        try
        {
            await using var conn = new SqlConnection(config.GetConnectionString("Main"));
            await conn.OpenAsync(ct);
            await using var cmd = new SqlCommand("""
                INSERT INTO dbo.V4JobRuns (JobName, DatabaseName, ProcedureName, StartedAt, FinishedAt, Succeeded, Error)
                VALUES (@Job, @Db, @Proc, @Started, DATEADD(millisecond, @Elapsed, @Started), @Ok, @Error)
                """, conn);
            cmd.Parameters.AddWithValue("@Job", job.Name);
            var calls = JobSchedule.Calls(job);
            var procedures = string.Join(",", calls.Select(c => c.Procedure));
            cmd.Parameters.AddWithValue("@Db", string.Join(",", calls.Select(c => c.Database).Distinct(StringComparer.OrdinalIgnoreCase)) is var db && db.Length > 50 ? db[..50] : db);
            cmd.Parameters.AddWithValue("@Proc", procedures.Length > 128 ? procedures[..128] : procedures);
            cmd.Parameters.AddWithValue("@Started", started);
            cmd.Parameters.AddWithValue("@Elapsed", elapsedMs);
            cmd.Parameters.AddWithValue("@Ok", error is null);
            cmd.Parameters.AddWithValue("@Error", (object?)error ?? DBNull.Value);
            await cmd.ExecuteNonQueryAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Could not record the run of {Job}", job.Name);
        }
    }
}
