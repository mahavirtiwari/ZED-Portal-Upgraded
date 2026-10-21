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
    IConfiguration config, IOptions<JobsOptions> options, ILogger<ProcedureJobWorker> log, TimeProvider clock) : BackgroundService
{
    private readonly Dictionary<string, DateTime> lastStart = new(StringComparer.OrdinalIgnoreCase);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var o = options.Value;
        var zone = TimeZoneInfo.FindSystemTimeZoneById(o.TimeZone);
        var jobs = new List<JobDefinition>();
        foreach (var job in o.Schedules.Where(j => j.Enabled))
        {
            var errors = JobSchedule.Validate(job).ToList();
            if (errors.Count > 0) log.LogError("Job {Job} is not scheduled: {Errors}", job.Name, string.Join(" ", errors));
            else jobs.Add(job);
        }
        if (jobs.Count == 0)
        {
            log.LogInformation("No scheduled jobs enabled (Jobs:Schedules)");
            return;
        }

        await LoadHistoryAsync(jobs, zone, stoppingToken);
        log.LogInformation("Scheduled jobs: {Jobs}", string.Join(", ", jobs.Select(j => j.Name)));
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
        string? error = null;
        try
        {
            await using var conn = new SqlConnection(config.GetConnectionString(job.Database)
                ?? throw new InvalidOperationException($"ConnectionStrings:{job.Database} is not configured."));
            await conn.OpenAsync(ct);
            await using (var lockCmd = new SqlCommand("sp_getapplock", conn) { CommandType = CommandType.StoredProcedure })
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
            log.LogInformation("Job {Job} started ({Database}.{Procedure})", job.Name, job.Database, job.Procedure);
            // The name was checked against ^[A-Za-z0-9_]+$ (JobSchedule.Validate).
            await using var cmd = new SqlCommand("dbo." + job.Procedure, conn)
            {
                CommandType = CommandType.StoredProcedure,
                CommandTimeout = options.Value.CommandTimeoutSeconds,
            };
            await cmd.ExecuteNonQueryAsync(ct);
            log.LogInformation("Job {Job} finished in {Seconds:0}s", job.Name, watch.Elapsed.TotalSeconds);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            error = ex.Message.Length > 2000 ? ex.Message[..2000] : ex.Message;
            log.LogError(ex, "Job {Job} failed", job.Name);
        }
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
            cmd.Parameters.AddWithValue("@Db", job.Database);
            cmd.Parameters.AddWithValue("@Proc", job.Procedure);
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
