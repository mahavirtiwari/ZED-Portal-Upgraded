using System.Data;
using Microsoft.Data.SqlClient;

namespace Zed.Jobs;

/// <summary>
/// What every scheduled job shares: the per-job application lock and dbo.V4JobRuns (the run history,
/// database/migrations/0004_job_runs.sql), both in the Main database.
/// </summary>
internal static class JobRuns
{
    /// <summary>
    /// An open connection holding the job's exclusive application lock (released when it is disposed), or null when
    /// another service instance is running the job.
    /// </summary>
    public static async Task<SqlConnection?> TryLockAsync(string? mainConnectionString, string job, CancellationToken ct)
    {
        var conn = new SqlConnection(mainConnectionString);
        try
        {
            await conn.OpenAsync(ct);
            await using var cmd = new SqlCommand("sp_getapplock", conn) { CommandType = CommandType.StoredProcedure };
            cmd.Parameters.AddWithValue("@Resource", "zed-job:" + job);
            cmd.Parameters.AddWithValue("@LockMode", "Exclusive");
            cmd.Parameters.AddWithValue("@LockOwner", "Session");
            cmd.Parameters.AddWithValue("@LockTimeout", 0);
            var rc = cmd.Parameters.Add("@rc", SqlDbType.Int);
            rc.Direction = ParameterDirection.ReturnValue;
            await cmd.ExecuteNonQueryAsync(ct);
            if ((int)rc.Value >= 0) return conn;
        }
        catch
        {
            await conn.DisposeAsync();
            throw;
        }
        await conn.DisposeAsync();
        return null;
    }

    /// <summary>Last start per job name, from dbo.V4JobRuns.</summary>
    public static async Task<Dictionary<string, DateTime>> LastStartsAsync(string? mainConnectionString, CancellationToken ct)
    {
        var result = new Dictionary<string, DateTime>(StringComparer.OrdinalIgnoreCase);
        await using var conn = new SqlConnection(mainConnectionString);
        await conn.OpenAsync(ct);
        await using var cmd = new SqlCommand("SELECT JobName, MAX(StartedAt) FROM dbo.V4JobRuns GROUP BY JobName", conn);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) result[reader.GetString(0)] = reader.GetDateTime(1);
        return result;
    }

    /// <param name="started">Start time in the schedule's time zone (what dbo.V4JobRuns stores).</param>
    public static async Task RecordAsync(string? mainConnectionString, string job, string databases, string procedures,
        DateTime started, int elapsedMs, string? error, ILogger log, CancellationToken ct)
    {
        try
        {
            if (error is { Length: > 2000 }) error = error[..2000];
            await using var conn = new SqlConnection(mainConnectionString);
            await conn.OpenAsync(ct);
            await using var cmd = new SqlCommand("""
                INSERT INTO dbo.V4JobRuns (JobName, DatabaseName, ProcedureName, StartedAt, FinishedAt, Succeeded, Error)
                VALUES (@Job, @Db, @Proc, @Started, DATEADD(millisecond, @Elapsed, @Started), @Ok, @Error)
                """, conn);
            cmd.Parameters.AddWithValue("@Job", job);
            cmd.Parameters.AddWithValue("@Db", databases.Length > 50 ? databases[..50] : databases);
            cmd.Parameters.AddWithValue("@Proc", procedures.Length > 128 ? procedures[..128] : procedures);
            cmd.Parameters.AddWithValue("@Started", started);
            cmd.Parameters.AddWithValue("@Elapsed", elapsedMs);
            cmd.Parameters.AddWithValue("@Ok", error is null);
            cmd.Parameters.AddWithValue("@Error", (object?)error ?? DBNull.Value);
            await cmd.ExecuteNonQueryAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Could not record the run of {Job}", job);
        }
    }
}
