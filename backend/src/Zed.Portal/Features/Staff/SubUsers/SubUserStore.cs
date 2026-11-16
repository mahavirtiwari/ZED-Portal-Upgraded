using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Caching.Memory;
using Zed.Core.Data;

namespace Zed.Portal.Features.Staff.SubUsers;

/// <summary>
/// A row of dbo.V4SubUsers (migration 0012). 2026-11-16 (migration 0087): <see cref="ScopeStates"/> (state codes) and
/// <see cref="ScopeAgencies"/> (agency user IDs), comma-separated, null = no limit.
/// </summary>
public sealed record SubUserRow(
    string UserId, string OwnerUserId, int OwnerRoleId, string UserName, string? Email, string? MobileNo, string Permissions,
    bool IsActive, string? PasswordHash, int FailedLogins, DateTime? LockedUntil, DateTime? LastLoginAt,
    string? CreatedBy, DateTime CreatedAt, string? ScopeStates, string? ScopeAgencies)
{
    /// <summary>A row read before migration 0087 (no scope columns; Dapper takes non-public constructors, JSON only the public one).</summary>
    internal SubUserRow(
        string UserId, string OwnerUserId, int OwnerRoleId, string UserName, string? Email, string? MobileNo, string Permissions,
        bool IsActive, string? PasswordHash, int FailedLogins, DateTime? LockedUntil, DateTime? LastLoginAt,
        string? CreatedBy, DateTime CreatedAt)
        : this(UserId, OwnerUserId, OwnerRoleId, UserName, Email, MobileNo, Permissions, IsActive, PasswordHash, FailedLogins, LockedUntil,
            LastLoginAt, CreatedBy, CreatedAt, null, null) { }
}

/// <summary>Reads and writes dbo.V4SubUsers of the host's database. A missing table (0012 not run) reads as "no sub-users".</summary>
public sealed class SubUserStore(ISqlExecutor db, IMemoryCache cache, ILogger<SubUserStore> log)
{
    private const string BaseColumns =
        "UserId, OwnerUserId, OwnerRoleId, UserName, Email, MobileNo, Permissions, IsActive, PasswordHash, FailedLogins, LockedUntil, LastLoginAt, CreatedBy, CreatedAt";
    internal const string ScopeColumns = ", ScopeStates, ScopeAgencies";

    /// <summary>Before migration 0087 the scope columns are missing: read without them (no scope), and save no scope.</summary>
    private static volatile bool _noScopeColumns;

    private static string Columns => _noScopeColumns ? BaseColumns : BaseColumns + ScopeColumns;

    /// <summary>Runs a read with the scope columns, and once more without them when the database has none yet (error 207).</summary>
    private async Task<T> ReadAsync<T>(Func<string, Task<T>> read)
    {
        try
        {
            return await read(Columns);
        }
        catch (SqlException ex) when (ex.Number == 207 && !_noScopeColumns)
        {
            log.LogWarning("dbo.V4SubUsers has no ScopeStates / ScopeAgencies (is migration 0087 applied?); sub-users have no state limit");
            _noScopeColumns = true;
            return await read(Columns);
        }
    }
    private static readonly TimeSpan CacheLifetime = TimeSpan.FromSeconds(30);

    public const int MaxFailedLogins = 5;
    public static readonly TimeSpan LockTime = TimeSpan.FromMinutes(15);

    public async Task<SubUserRow?> FindAsync(string userId, CancellationToken ct)
    {
        try
        {
            var rows = await ReadAsync(cols => db.QuerySqlAsync<SubUserRow>($"SELECT {cols} FROM dbo.V4SubUsers WHERE UserId = @UserId;", new { UserId = userId }, ct));
            return rows.Count > 0 ? rows[0] : null;
        }
        catch (SqlException ex)
        {
            log.LogWarning(ex, "Could not read dbo.V4SubUsers (is migration 0012 applied?)");
            return null;
        }
    }

    /// <summary>As <see cref="FindAsync"/>, cached for 30 seconds: the per-request check of a signed-in sub-user.</summary>
    public Task<SubUserRow?> FindCachedAsync(string userId, CancellationToken ct) =>
        cache.GetOrCreateAsync("subuser:" + userId.ToUpperInvariant(), e =>
        {
            e.AbsoluteExpirationRelativeToNow = CacheLifetime;
            return FindAsync(userId, ct);
        });

    public async Task<IReadOnlyList<SubUserRow>> ListAsync(string ownerUserId, CancellationToken ct) =>
        await ReadAsync(cols => db.QuerySqlAsync<SubUserRow>($"SELECT {cols} FROM dbo.V4SubUsers WHERE OwnerUserId = @OwnerUserId ORDER BY CreatedAt, UserId;",
            new { OwnerUserId = ownerUserId }, ct));

    /// <summary>Whether <paramref name="userId"/> is taken by a Users row or a sub-user.</summary>
    public async Task<bool> IdTakenAsync(string userId, CancellationToken ct)
    {
        var users = await db.QuerySqlAsync<string>("SELECT TOP (1) UserId FROM Users WHERE UserId = @UserId;", new { UserId = userId }, ct);
        return users.Count > 0 || await FindAsync(userId, ct) is not null;
    }

    internal const string CreateSql =
        "INSERT INTO dbo.V4SubUsers (UserId, OwnerUserId, OwnerRoleId, UserName, Email, MobileNo, Permissions, IsActive, PasswordHash, CreatedBy) " +
        "VALUES (@UserId, @OwnerUserId, @OwnerRoleId, @UserName, @Email, @MobileNo, @Permissions, @IsActive, @PasswordHash, @CreatedBy);";

    /// <summary>2026-11-16: the sub-user's states and agencies (migration 0087).</summary>
    internal const string ScopeSql = "UPDATE dbo.V4SubUsers SET ScopeStates = @ScopeStates, ScopeAgencies = @ScopeAgencies WHERE UserId = @UserId;";

    public async Task CreateAsync(SubUserRow row, CancellationToken ct)
    {
        await db.ExecuteSqlAsync(CreateSql,
            new { row.UserId, row.OwnerUserId, row.OwnerRoleId, row.UserName, row.Email, row.MobileNo, row.Permissions, row.IsActive, row.PasswordHash, row.CreatedBy }, ct);
        await SaveScopeAsync(row.UserId, row.ScopeStates, row.ScopeAgencies, ct);
    }

    public async Task UpdateAsync(string userId, string userName, string? email, string? mobileNo, string permissions, bool isActive, string updatedBy, CancellationToken ct,
        string? scopeStates = null, string? scopeAgencies = null)
    {
        await db.ExecuteSqlAsync(
            "UPDATE dbo.V4SubUsers SET UserName = @UserName, Email = @Email, MobileNo = @MobileNo, Permissions = @Permissions, IsActive = @IsActive, " +
            "UpdatedBy = @UpdatedBy, UpdatedAt = SYSUTCDATETIME() WHERE UserId = @UserId;",
            new { UserId = userId, UserName = userName, Email = email, MobileNo = mobileNo, Permissions = permissions, IsActive = isActive, UpdatedBy = updatedBy }, ct);
        await SaveScopeAsync(userId, scopeStates, scopeAgencies, ct);
        Forget(userId);
    }

    /// <summary>A scope cannot be kept before migration 0087: refused rather than silently dropped.</summary>
    private async Task SaveScopeAsync(string userId, string? states, string? agencies, CancellationToken ct)
    {
        try
        {
            await db.ExecuteSqlAsync(ScopeSql, new { UserId = userId, ScopeStates = states, ScopeAgencies = agencies }, ct);
        }
        catch (SqlException ex) when (ex.Number == 207)
        {
            if (states is not null || agencies is not null) throw new InvalidOperationException("Migration 0087 is not applied: states and agencies cannot be saved.", ex);
        }
    }

    public async Task SetPasswordAsync(string userId, string passwordHash, string updatedBy, CancellationToken ct)
    {
        await db.ExecuteSqlAsync(
            "UPDATE dbo.V4SubUsers SET PasswordHash = @PasswordHash, FailedLogins = 0, LockedUntil = NULL, UpdatedBy = @UpdatedBy, UpdatedAt = SYSUTCDATETIME() WHERE UserId = @UserId;",
            new { UserId = userId, PasswordHash = passwordHash, UpdatedBy = updatedBy }, ct);
        Forget(userId);
    }

    public Task LoginSucceededAsync(string userId, CancellationToken ct) =>
        db.ExecuteSqlAsync("UPDATE dbo.V4SubUsers SET FailedLogins = 0, LockedUntil = NULL, LastLoginAt = SYSUTCDATETIME() WHERE UserId = @UserId;",
            new { UserId = userId }, ct);

    /// <summary>Counts a wrong password; the fifth in a row locks the sub-user for 15 minutes.</summary>
    public Task LoginFailedAsync(string userId, CancellationToken ct) =>
        db.ExecuteSqlAsync(
            "UPDATE dbo.V4SubUsers SET FailedLogins = CASE WHEN FailedLogins + 1 >= @Max THEN 0 ELSE FailedLogins + 1 END, " +
            "LockedUntil = CASE WHEN FailedLogins + 1 >= @Max THEN DATEADD(MINUTE, @LockMinutes, SYSUTCDATETIME()) ELSE LockedUntil END WHERE UserId = @UserId;",
            new { UserId = userId, Max = MaxFailedLogins, LockMinutes = (int)LockTime.TotalMinutes }, ct);

    private void Forget(string userId) => cache.Remove("subuser:" + userId.ToUpperInvariant());

    /// <summary>
    /// A sub-user's own session stamp (M12; sub-users have no Users row): derived from its password hash and permissions,
    /// so a new password (reset by the owner, changed by the sub-user or set through a link) or a change of its screens
    /// ends its sessions (<see cref="SubUserAccessFilter"/>). Its owner's Users.SessionStamp applies as well.
    /// </summary>
    public static string SessionStamp(SubUserRow row)
    {
        // 2026-11-16: its states and agencies too (a narrower scope must not wait for the session to end).
        var hash = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(
            (row.PasswordHash ?? "") + "|" + row.Permissions + (row.ScopeStates is null && row.ScopeAgencies is null ? "" : "|" + row.ScopeStates + "|" + row.ScopeAgencies)));
        return Convert.ToHexString(hash, 0, 12);
    }
}
