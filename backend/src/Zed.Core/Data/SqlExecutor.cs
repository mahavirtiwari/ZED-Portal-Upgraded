using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;

namespace Zed.Core.Data;

/// <summary>
/// Thin wrapper over the existing stored procedures. Business rules stay in SQL Server;
/// this class only opens connections, passes parameters and maps result sets.
/// </summary>
public interface ISqlExecutor
{
    Task<IReadOnlyList<T>> QueryProcAsync<T>(string procedure, object? parameters = null, CancellationToken ct = default);

    /// <summary>For procedures that return several result sets (the legacy DataSet pattern).</summary>
    Task<ResultSets> QueryProcMultipleAsync(string procedure, object? parameters = null, CancellationToken ct = default);

    Task<int> ExecuteProcAsync(string procedure, object? parameters = null, CancellationToken ct = default);

    /// <summary>
    /// Parameterised inline SQL, for the few places the legacy code did not use a procedure. Database names in it
    /// (ZED_CONSULTANT.dbo.X) get the <c>Database:Prefix</c> of a prefixed test set (<see cref="ZedDatabaseNames"/>).
    /// </summary>
    Task<int> ExecuteSqlAsync(string sql, object? parameters = null, CancellationToken ct = default);

    Task<IReadOnlyList<T>> QuerySqlAsync<T>(string sql, object? parameters = null, CancellationToken ct = default);

    /// <summary>
    /// An exclusive lock named <paramref name="resource"/>, held until the result is disposed: one holder at a time across every
    /// process and server on this database (<see cref="SqlExecutor"/>: sp_getapplock), so a double click, a retry, or the web and
    /// the mobile API acting on one case together cannot both pass a "current status" check before either has written. The
    /// default (test doubles) is a lock of this process only.
    /// </summary>
    Task<IAsyncDisposable> LockAsync(string resource, CancellationToken ct = default) => ProcessLocks.TakeAsync(resource, ct);
}

/// <summary>Named exclusive locks of this process (<see cref="ISqlExecutor.LockAsync"/> without a database).</summary>
public static class ProcessLocks
{
    private sealed class Entry
    {
        public readonly SemaphoreSlim Gate = new(1, 1);
        public int Users;
    }

    private static readonly Dictionary<string, Entry> Entries = new(StringComparer.OrdinalIgnoreCase);

    public static async Task<IAsyncDisposable> TakeAsync(string resource, CancellationToken ct = default)
    {
        Entry entry;
        lock (Entries)
        {
            if (!Entries.TryGetValue(resource, out entry!)) Entries[resource] = entry = new Entry();
            entry.Users++;
        }
        try
        {
            await entry.Gate.WaitAsync(ct);
        }
        catch
        {
            Leave(resource, entry);
            throw;
        }
        return new Held(resource, entry);
    }

    private static void Leave(string resource, Entry entry)
    {
        lock (Entries)
            if (--entry.Users == 0) Entries.Remove(resource);
    }

    private sealed class Held(string resource, Entry entry) : IAsyncDisposable
    {
        private int _done;

        public ValueTask DisposeAsync()
        {
            if (Interlocked.Exchange(ref _done, 1) == 0)
            {
                entry.Gate.Release();
                Leave(resource, entry);
            }
            return ValueTask.CompletedTask;
        }
    }
}

/// <summary>A database lock (<see cref="ISqlExecutor.LockAsync"/>) not granted within <see cref="SqlExecutor.LockWait"/>.</summary>
public sealed class DbLockTimeoutException(string resource)
    : TimeoutException($"Another request is still working on this ({resource}). Please try again in a minute.");

public sealed class SqlExecutor(string connectionString, int commandTimeoutSeconds = 120) : ISqlExecutor
{
    public async Task<IReadOnlyList<T>> QueryProcAsync<T>(string procedure, object? parameters = null, CancellationToken ct = default)
    {
        await using var conn = new SqlConnection(connectionString);
        var rows = await conn.QueryAsync<T>(Command(procedure, parameters, CommandType.StoredProcedure, ct));
        return rows.AsList();
    }

    public async Task<ResultSets> QueryProcMultipleAsync(string procedure, object? parameters = null, CancellationToken ct = default)
    {
        await using var conn = new SqlConnection(connectionString);
        await using var grid = await conn.QueryMultipleAsync(Command(procedure, parameters, CommandType.StoredProcedure, ct));
        var sets = new List<IReadOnlyList<IDictionary<string, object?>>>();
        while (!grid.IsConsumed)
        {
            var rows = (await grid.ReadAsync())
                .Select(r =>
                {
                    // Some procedures select a column twice (e.g. ZED_SURVEILLANCE SP_MSME_GET_DETAILS:
                    // ApplicationReceived). The old DataTable kept the first and renamed the rest; keep the first.
                    var d = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
                    foreach (var (k, v) in (IDictionary<string, object?>)r) d.TryAdd(k, v);
                    return (IDictionary<string, object?>)d;
                })
                .ToList();
            sets.Add(rows);
        }
        return new ResultSets(sets);
    }

    public async Task<int> ExecuteProcAsync(string procedure, object? parameters = null, CancellationToken ct = default)
    {
        await using var conn = new SqlConnection(connectionString);
        return await conn.ExecuteAsync(Command(procedure, parameters, CommandType.StoredProcedure, ct));
    }

    public async Task<int> ExecuteSqlAsync(string sql, object? parameters = null, CancellationToken ct = default)
    {
        await using var conn = new SqlConnection(connectionString);
        return await conn.ExecuteAsync(Command(ZedDatabaseNames.Map(sql), parameters, CommandType.Text, ct));
    }

    public async Task<IReadOnlyList<T>> QuerySqlAsync<T>(string sql, object? parameters = null, CancellationToken ct = default)
    {
        await using var conn = new SqlConnection(connectionString);
        var rows = await conn.QueryAsync<T>(Command(ZedDatabaseNames.Map(sql), parameters, CommandType.Text, ct));
        return rows.AsList();
    }

    private CommandDefinition Command(string text, object? parameters, CommandType type, CancellationToken ct) =>
        new(text, parameters, commandType: type, commandTimeout: commandTimeoutSeconds, cancellationToken: ct);

    /// <summary>How long <see cref="LockAsync"/> waits for another holder (a final submit runs in seconds).</summary>
    public static readonly TimeSpan LockWait = TimeSpan.FromSeconds(60);

    /// <summary>
    /// 2026-11-27: sp_getapplock owned by the session of a connection of its own, kept open while the lock is held. The connection
    /// is not pooled, so closing it (dispose, or the process ending) always frees the lock. The process's own lock is taken first,
    /// so requests of one process queue there instead of each opening a connection.
    /// </summary>
    public async Task<IAsyncDisposable> LockAsync(string resource, CancellationToken ct = default)
    {
        var local = await ProcessLocks.TakeAsync(resource, ct);
        var conn = new SqlConnection(new SqlConnectionStringBuilder(connectionString) { Pooling = false }.ConnectionString);
        try
        {
            await conn.OpenAsync(ct);
            var p = new DynamicParameters();
            p.Add("@Resource", LockName(resource));
            p.Add("@LockMode", "Exclusive");
            p.Add("@LockOwner", "Session");
            p.Add("@LockTimeout", (int)LockWait.TotalMilliseconds);
            p.Add("@Result", dbType: DbType.Int32, direction: ParameterDirection.ReturnValue);
            await conn.ExecuteAsync(new CommandDefinition("sp_getapplock", p, commandType: CommandType.StoredProcedure,
                commandTimeout: (int)LockWait.TotalSeconds + 30, cancellationToken: ct));
            if (p.Get<int>("@Result") < 0) throw new DbLockTimeoutException(resource);
            return new DbLock(conn, local);
        }
        catch
        {
            await conn.DisposeAsync();
            await local.DisposeAsync();
            throw;
        }
    }

    /// <summary>The applock resource (at most 255 characters).</summary>
    internal static string LockName(string resource) => ("ZEDV4:" + resource) is var n && n.Length > 255 ? n[..255] : n;

    private sealed class DbLock(SqlConnection conn, IAsyncDisposable local) : IAsyncDisposable
    {
        private int _done;

        public async ValueTask DisposeAsync()
        {
            if (Interlocked.Exchange(ref _done, 1) != 0) return;
            try
            {
                await conn.DisposeAsync();   // not pooled: the session ends and its lock with it
            }
            finally
            {
                await local.DisposeAsync();
            }
        }
    }
}

/// <summary>Result sets returned by a multi-select procedure, read by index like the old DataSet.Tables[n].</summary>
public sealed class ResultSets(IReadOnlyList<IReadOnlyList<IDictionary<string, object?>>> sets)
{
    public int Count => sets.Count;

    public IReadOnlyList<IDictionary<string, object?>> this[int index] =>
        index < sets.Count ? sets[index] : [];

    /// <summary>First column of the first row of a set, as text (e.g. the ERRORMSG column).</summary>
    public string? Scalar(int index) =>
        this[index].FirstOrDefault()?.Values.FirstOrDefault()?.ToString();

    /// <summary>
    /// Columns never sent to a browser, whatever a procedure selects (many legacy procedures use
    /// SELECT * on Users and similar tables).
    /// </summary>
    public static readonly IReadOnlySet<string> SensitiveColumns = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "Password", "PasswordHash", "StoredPassword", "PwdCode", "OTP", "Otp", "Token", "AccessToken", "SecretKey", "WorkingKey", "AccessCode", "MerchantKey", "Salt",
    };

    /// <summary>
    /// Result sets as a JSON-ready object: <c>{ name0: [rows], name1: [rows], ... }</c>, keeping the
    /// procedure's column names (the legacy pages bound to these names). Sensitive columns are removed.
    /// Sets beyond the given names are named Table{n}, like the old DataSet JSON.
    /// </summary>
    public Dictionary<string, IReadOnlyList<IDictionary<string, object?>>> ToClient(params string[] names)
    {
        var result = new Dictionary<string, IReadOnlyList<IDictionary<string, object?>>>();
        for (var i = 0; i < Math.Max(Count, names.Length); i++)
        {
            var name = i < names.Length ? names[i] : (i == 0 ? "Table" : "Table" + i);
            result[name] = this[i].Select(row => (IDictionary<string, object?>)row
                .Where(kv => !SensitiveColumns.Contains(kv.Key))
                .ToDictionary(kv => kv.Key, kv => kv.Value is DBNull ? null : kv.Value)).ToList();
        }
        return result;
    }
}

public static class RowExtensions
{
    public static string Text(this IDictionary<string, object?> row, string column) =>
        row.TryGetValue(column, out var v) && v is not null and not DBNull ? v.ToString() ?? "" : "";
}

/// <summary>Names of the three databases. Their procedures reference each other by these names.</summary>
public static class ZedDatabases
{
    public const string Main = "Main";
    public const string Consultancy = "Consultancy";
    public const string Surveillance = "Surveillance";

    public static string RequireConnectionString(this IConfiguration config, string name) =>
        config.GetConnectionString(name) is { Length: > 0 } cs
            ? cs
            : throw new InvalidOperationException(
                $"Connection string '{name}' is not configured. Set ConnectionStrings:{name} " +
                "(user secrets or environment variable ConnectionStrings__" + name + ").");
}
