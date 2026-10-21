using System.Collections.Concurrent;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Zed.Core.Data;
using Zed.Core.Security;

namespace Zed.TestSupport;

/// <summary>
/// dbo.V4UserPasswords and the Users.Password column as SP_V4_GET_PASSWORD / SP_V4_SET_PASSWORD_HASH see them
/// (migration 0005), attached to a fake executor's procedure table. Shared by the API and mobile test projects.
/// </summary>
public sealed class FakePasswords
{
    public sealed record Account(string? RoleId, string? Stored, string? Hash);
    public sealed record Write(string UserId, string? Hash, string? Replace);

    public ConcurrentDictionary<string, Account> Accounts { get; } = new(StringComparer.OrdinalIgnoreCase);
    public ConcurrentQueue<Write> Writes { get; } = new();

    public FakePasswords Attach(ConcurrentDictionary<string, Func<object?, ResultSets>> procs)
    {
        procs[PasswordStore.GetProcedure] = args =>
        {
            var id = Arg(args, "UserId") ?? "";
            return Accounts.TryGetValue(id, out var a)
                ? Sets(new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase)
                    { ["UserId"] = id, ["RoleId"] = a.RoleId, ["StoredPassword"] = a.Stored, ["PasswordHash"] = a.Hash })
                : Sets();
        };
        procs[PasswordStore.SetProcedure] = args =>
        {
            var id = Arg(args, "UserId")!;
            var write = new Write(id, Arg(args, "PasswordHash"), Arg(args, "ReplacePassword"));
            Writes.Enqueue(write);
            Accounts.AddOrUpdate(id, _ => new Account(null, write.Replace, write.Hash),
                (_, a) => a with { Hash = write.Hash ?? a.Hash, Stored = write.Replace ?? a.Stored });
            return Sets();
        };
        return this;
    }

    /// <summary>An account with a plain value and, optionally, the hash of <paramref name="hashOf"/>.</summary>
    public void Add(string userId, string roleId, string? stored, string? hashOf = null) =>
        Accounts[userId] = new Account(roleId, stored, hashOf is null ? null : PasswordStore.Hash(hashOf));

    public Write? LastWrite(string userId) => Writes.LastOrDefault(w => string.Equals(w.UserId, userId, StringComparison.OrdinalIgnoreCase));

    public bool HashMatches(string userId, string password) =>
        Accounts.TryGetValue(userId, out var a) && a.Hash is { } h && PasswordStore.Verify(h, password) != Microsoft.AspNetCore.Identity.PasswordVerificationResult.Failed;

    /// <summary>Switches <c>Security:Passwords</c> on a running host (read on every request).</summary>
    public static void SetMode(IServiceProvider services, PasswordMode mode) =>
        services.GetRequiredService<IConfiguration>()[PasswordStore.Setting] = mode.ToString();

    private static string? Arg(object? args, string name) => args?.GetType().GetProperty(name)?.GetValue(args)?.ToString();

    private static ResultSets Sets(params IDictionary<string, object?>[] rows) => new([rows]);
}
