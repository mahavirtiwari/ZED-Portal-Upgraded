using Zed.Core.Data;

namespace Zed.Main.Api.Tests;

/// <summary>
/// 2026-11-27 (review suggestion 5: double-click protection across processes): ISqlExecutor.LockAsync. The case-changing steps
/// (desktop / remote final submit, monitoring and milestone decisions, the scheme workflows, the CCAvenue response) took a lock of
/// their own process only, so the web and the mobile API (or two web processes during an IIS recycle) could both pass the status
/// check. The real executor now takes sp_getapplock; test doubles keep a lock of the process.
/// </summary>
public sealed class DbLockTests
{
    [Fact]
    public async Task A_process_lock_admits_one_holder_at_a_time_per_name()
    {
        var first = await ProcessLocks.TakeAsync("t-one");
        var second = ProcessLocks.TakeAsync("t-one");
        var other = await ProcessLocks.TakeAsync("t-two");   // another name is not held up
        await Task.Delay(50);
        Assert.False(second.IsCompleted);
        await first.DisposeAsync();
        await (await second.WaitAsync(TimeSpan.FromSeconds(5))).DisposeAsync();
        await other.DisposeAsync();
        await first.DisposeAsync();   // a second dispose releases nothing more
        await (await ProcessLocks.TakeAsync("t-one").WaitAsync(TimeSpan.FromSeconds(5))).DisposeAsync();
    }

    [Fact]
    public async Task A_cancelled_wait_leaves_the_lock_usable()
    {
        var held = await ProcessLocks.TakeAsync("t-cancel");
        using var cts = new CancellationTokenSource(30);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => ProcessLocks.TakeAsync("t-cancel", cts.Token));
        await held.DisposeAsync();
        await (await ProcessLocks.TakeAsync("t-cancel").WaitAsync(TimeSpan.FromSeconds(5))).DisposeAsync();
    }

    [Fact]
    public async Task A_test_double_without_its_own_lock_uses_the_process_lock()
    {
        ISqlExecutor db = new FakeSql();
        var first = await db.LockAsync("t-fake");
        var second = db.LockAsync("t-fake");
        await Task.Delay(50);
        Assert.False(second.IsCompleted);
        await first.DisposeAsync();
        await (await second.WaitAsync(TimeSpan.FromSeconds(5))).DisposeAsync();
    }

    /// <summary>
    /// On a real database (ZED_TEST_SQL = a connection string, e.g. the local ZEDV4CHK_ZEDCS_V2_LIVE): two executors stand for two
    /// processes; the process lock cannot join them, only the database's.
    /// </summary>
    [Fact]
    public async Task On_the_database_a_second_process_waits_for_the_first()
    {
        if (Environment.GetEnvironmentVariable("ZED_TEST_SQL") is not { Length: > 0 } cs) return;
        var name = "t-db-" + Guid.NewGuid().ToString("N");
        var web = new SqlExecutor(cs);
        var mobile = new SqlExecutor(cs);
        var first = await web.LockAsync(name);
        // The second "process": its own lock of the process would be free, so wait on the database only.
        var second = Task.Run(async () =>
        {
            await using var conn = new Microsoft.Data.SqlClient.SqlConnection(cs);
            await conn.OpenAsync();
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = "DECLARE @r int; EXEC @r = sp_getapplock @Resource = @n, @LockMode = 'Exclusive', @LockOwner = 'Session', @LockTimeout = 0; SELECT @r;";
            cmd.Parameters.AddWithValue("@n", SqlExecutorLockName(name));
            return (int)(await cmd.ExecuteScalarAsync())!;
        });
        Assert.True(await second < 0);   // held by the first: refused at once
        await first.DisposeAsync();
        await using (await mobile.LockAsync(name).WaitAsync(TimeSpan.FromSeconds(10))) { }
    }

    private static string SqlExecutorLockName(string resource) => "ZEDV4:" + resource;
}
