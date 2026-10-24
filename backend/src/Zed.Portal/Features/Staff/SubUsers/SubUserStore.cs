using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Caching.Memory;
using Zed.Core.Data;

namespace Zed.Portal.Features.Staff.SubUsers;

/// <summary>A row of dbo.V4SubUsers (migration 0012).</summary>
public sealed record SubUserRow(
    string UserId, string OwnerUserId, int OwnerRoleId, string UserName, string? Email, string? MobileNo, string Permissions,
    bool IsActive, string? PasswordHash, int FailedLogins, DateTime? LockedUntil, DateTime? LastLoginAt,
    string? CreatedBy, DateTime CreatedAt);

/// <summary>Reads and writes dbo.V4SubUsers of the host's database. A missing table (0012 not run) reads as "no sub-users".</summary>
public sealed class SubUserStore(ISqlExecutor db, IMemoryCache cache, ILogger<SubUserStore> log)
{
    private const string Columns =
        "UserId, OwnerUserId, OwnerRoleId, UserName, Email, MobileNo, Permissions, IsActive, PasswordHash, FailedLogins, LockedUntil, LastLoginAt, CreatedBy, CreatedAt";
    private static readonly TimeSpan CacheLifetime = TimeSpan.FromSeconds(30);

    public const int MaxFailedLogins = 5;
    public static readonly TimeSpan LockTime = TimeSpan.FromMinutes(15);

    public async Task<SubUserRow?> FindAsync(string userId, CancellationToken ct)
    {
        try
        {
            var rows = await db.QuerySqlAsync<SubUserRow>($"SELECT {Columns} FROM dbo.V4SubUsers WHERE UserId = @UserId;", new { UserId = userId }, ct);
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
        await db.QuerySqlAsync<SubUserRow>($"SELECT {Columns} FROM dbo.V4SubUsers WHERE OwnerUserId = @OwnerUserId ORDER BY CreatedAt, UserId;",
            new { OwnerUserId = ownerUserId }, ct);

    /// <summary>Whether <paramref name="userId"/> is taken by a Users row or a sub-user.</summary>
    public async Task<bool> IdTakenAsync(string userId, CancellationToken ct)
    {
        var users = await db.QuerySqlAsync<string>("SELECT TOP (1) UserId FROM Users WHERE UserId = @UserId;", new { UserId = userId }, ct);
        return users.Count > 0 || await FindAsync(userId, ct) is not null;
    }

    public Task CreateAsync(SubUserRow row, CancellationToken ct) =>
        db.ExecuteSqlAsync(
            "INSERT INTO dbo.V4SubUsers (UserId, OwnerUserId, OwnerRoleId, UserName, Email, MobileNo, Permissions, IsActive, PasswordHash, CreatedBy) " +
            "VALUES (@UserId, @OwnerUserId, @OwnerRoleId, @UserName, @Email, @MobileNo, @Permissions, @IsActive, @PasswordHash, @CreatedBy);",
            new { row.UserId, row.OwnerUserId, row.OwnerRoleId, row.UserName, row.Email, row.MobileNo, row.Permissions, row.IsActive, row.PasswordHash, row.CreatedBy }, ct);

    public async Task UpdateAsync(string userId, string userName, string? email, string? mobileNo, string permissions, bool isActive, string updatedBy, CancellationToken ct)
    {
        await db.ExecuteSqlAsync(
            "UPDATE dbo.V4SubUsers SET UserName = @UserName, Email = @Email, MobileNo = @MobileNo, Permissions = @Permissions, IsActive = @IsActive, " +
            "UpdatedBy = @UpdatedBy, UpdatedAt = SYSUTCDATETIME() WHERE UserId = @UserId;",
            new { UserId = userId, UserName = userName, Email = email, MobileNo = mobileNo, Permissions = permissions, IsActive = isActive, UpdatedBy = updatedBy }, ct);
        Forget(userId);
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
}
