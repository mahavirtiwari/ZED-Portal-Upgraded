using System.Collections.Concurrent;
using Zed.Core.Data;

namespace Zed.TestSupport;

/// <summary>
/// dbo.Users (staff and MSME columns) and dbo.V4PasswordResets as the procedures of migrations 0008 and 0009 see them, attached to a fake
/// executor's procedure table. Shared by the API test projects.
/// </summary>
public sealed class FakeStaffResets
{
    public sealed record User(string UserId, int RoleId, bool IsActive, string? Email, string UserName = "Staff User");

    public sealed class Row
    {
        public required string UserId { get; init; }
        public required byte[] TokenHash { get; init; }
        public DateTime CreatedAt { get; set; }
        public DateTime ExpiresAt { get; set; }
        public DateTime? UsedAt { get; set; }
        public DateTime? InvalidatedAt { get; set; }
        public string? RequestedBy { get; init; }
        public bool IsOpen(DateTime now) => UsedAt is null && InvalidatedAt is null && ExpiresAt > now;
    }

    public ConcurrentDictionary<string, User> Users { get; } = new(StringComparer.OrdinalIgnoreCase);
    public List<Row> Rows { get; } = [];
    public ConcurrentQueue<string> FailedLoginsCleared { get; } = new();

    /// <summary>Waited on by SP_V4_STAFF_RESET_ACCOUNT when set (proves the lookup is not on the request path).</summary>
    public SemaphoreSlim? HoldAccountLookup { get; set; }

    private readonly Lock gate = new();

    public FakeStaffResets Attach(ConcurrentDictionary<string, Func<object?, ResultSets>> procs)
    {
        procs["SP_V4_STAFF_RESET_ACCOUNT"] = args =>
        {
            HoldAccountLookup?.Wait(TimeSpan.FromSeconds(10));
            return Users.TryGetValue(Text(args, "UserId") ?? "", out var u) && u.RoleId != 5
                ? Sets(new Dictionary<string, object?> { ["UserId"] = u.UserId, ["UserName"] = u.UserName, ["RoleId"] = u.RoleId, ["Email"] = u.Email, ["IsActive"] = u.IsActive })
                : Sets();
        };
        procs["SP_V4_STAFF_RESET_CREATE"] = args =>
        {
            var userId = Text(args, "UserId")!;
            var by = Text(args, "RequestedBy");
            var now = DateTime.UtcNow;
            lock (gate)
            {
                if (by is null && Rows.Count(r => Same(r.UserId, userId) && r.RequestedBy is null && r.CreatedAt > now.AddHours(-1)) >= int.Parse(Text(args, "MaxPerHour")!))
                    return Sets(new Dictionary<string, object?> { ["Created"] = false });
                foreach (var r in Rows.Where(r => Same(r.UserId, userId) && r.UsedAt is null && r.InvalidatedAt is null)) r.InvalidatedAt = now;
                Rows.Add(new Row
                {
                    UserId = userId, TokenHash = (byte[])Value(args, "TokenHash")!, CreatedAt = now,
                    ExpiresAt = now.AddMinutes(int.Parse(Text(args, "ValidMinutes")!)), RequestedBy = by,
                });
            }
            return Sets(new Dictionary<string, object?> { ["Created"] = true });
        };
        procs["SP_V4_STAFF_RESET_FIND"] = args =>
        {
            lock (gate)
            {
                var row = Open(args);
                return row is not null && ActiveUser(row.UserId) is { } u
                    ? Sets(new Dictionary<string, object?> { ["UserId"] = u.UserId, ["UserName"] = u.UserName, ["RoleId"] = u.RoleId, ["Email"] = u.Email, ["RequestedBy"] = row.RequestedBy })
                    : Sets();
            }
        };
        procs["SP_V4_STAFF_RESET_USE"] = args =>
        {
            lock (gate)
            {
                var row = Open(args);
                if (row is null || ActiveUser(row.UserId) is not { } u) return Sets();
                var now = DateTime.UtcNow;
                row.UsedAt = now;
                foreach (var r in Rows.Where(r => Same(r.UserId, u.UserId) && r.UsedAt is null && r.InvalidatedAt is null)) r.InvalidatedAt = now;
                FailedLoginsCleared.Enqueue(u.UserId);
                return Sets(new Dictionary<string, object?> { ["UserId"] = u.UserId, ["UserName"] = u.UserName, ["RoleId"] = u.RoleId, ["Email"] = u.Email });
            }
        };
        // MSME accounts (migration 0009): RoleId 5 only; the link rows are shared with the staff procedures.
        procs["SP_V4_MSME_RESET_ACCOUNT"] = args =>
        {
            HoldAccountLookup?.Wait(TimeSpan.FromSeconds(10));
            return Users.TryGetValue(Text(args, "ZedId") ?? "", out var u) && u.RoleId == 5
                ? Sets(new Dictionary<string, object?> { ["ZedId"] = u.UserId, ["EnterpriseName"] = u.UserName, ["Email"] = u.Email, ["IsActive"] = u.IsActive })
                : Sets();
        };
        procs["SP_V4_MSME_RESET_FIND"] = args =>
        {
            lock (gate)
            {
                var row = Open(args);
                return row is not null && ActiveMsme(row.UserId) is { } u
                    ? Sets(new Dictionary<string, object?> { ["ZedId"] = u.UserId, ["EnterpriseName"] = u.UserName, ["Email"] = u.Email })
                    : Sets();
            }
        };
        procs["SP_V4_MSME_RESET_USE"] = args =>
        {
            lock (gate)
            {
                var row = Open(args);
                if (row is null || ActiveMsme(row.UserId) is not { } u) return Sets();
                var now = DateTime.UtcNow;
                row.UsedAt = now;
                foreach (var r in Rows.Where(r => Same(r.UserId, u.UserId) && r.UsedAt is null && r.InvalidatedAt is null)) r.InvalidatedAt = now;
                FailedLoginsCleared.Enqueue(u.UserId);
                return Sets(new Dictionary<string, object?> { ["ZedId"] = u.UserId, ["EnterpriseName"] = u.UserName, ["Email"] = u.Email });
            }
        };
        return this;
    }

    public void Add(string userId, int roleId, string? email = "staff@zed.test", bool active = true) =>
        Users[userId] = new User(userId, roleId, active, email, userId + " name");

    /// <summary>An open link for <paramref name="userId"/>, as if mailed; returns its token.</summary>
    public string Issue(string userId, int validMinutes = 60)
    {
        var token = Zed.Core.Security.PasswordResetTokens.NewToken();
        var now = DateTime.UtcNow;
        lock (gate) Rows.Add(new Row { UserId = userId, TokenHash = Zed.Core.Security.PasswordResetTokens.Hash(token), CreatedAt = now, ExpiresAt = now.AddMinutes(validMinutes) });
        return token;
    }

    /// <summary>Moves every link's expiry into the past.</summary>
    public void ExpireAll()
    {
        lock (gate) foreach (var r in Rows) r.ExpiresAt = DateTime.UtcNow.AddMinutes(-1);
    }

    private Row? Open(object? args)
    {
        var hash = (byte[])Value(args, "TokenHash")!;
        return Rows.FirstOrDefault(r => r.TokenHash.AsSpan().SequenceEqual(hash) && r.IsOpen(DateTime.UtcNow));
    }

    private User? ActiveMsme(string userId) => Users.TryGetValue(userId, out var u) && u.IsActive && u.RoleId == 5 ? u : null;

    private User? ActiveUser(string userId) => Users.TryGetValue(userId, out var u) && u.IsActive && u.RoleId != 5 ? u : null;

    private static bool Same(string a, string b) => string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
    private static object? Value(object? args, string name) => args?.GetType().GetProperty(name)?.GetValue(args);
    private static string? Text(object? args, string name) => Value(args, name)?.ToString();
    private static ResultSets Sets(params IDictionary<string, object?>[] rows) => new([rows]);
}
