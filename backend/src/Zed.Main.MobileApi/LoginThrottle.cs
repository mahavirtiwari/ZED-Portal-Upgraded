using System.Collections.Concurrent;

namespace Zed.Main.MobileApi;

/// <summary>
/// Failed logins per user name: after 5 failures in 15 minutes further attempts for that user are
/// refused until the window passes. The old services had no limit at all.
/// </summary>
public sealed class LoginThrottle(TimeProvider clock)
{
    public const int MaxFailures = 5;
    public static readonly TimeSpan Window = TimeSpan.FromMinutes(15);

    private readonly ConcurrentDictionary<string, (int Count, DateTimeOffset First)> failures = new(StringComparer.OrdinalIgnoreCase);

    public LoginThrottle() : this(TimeProvider.System) { }

    public bool IsLocked(string app, string? user)
    {
        if (string.IsNullOrWhiteSpace(user)) return false;
        if (!failures.TryGetValue(Key(app, user), out var f)) return false;
        if (clock.GetUtcNow() - f.First > Window)
        {
            failures.TryRemove(Key(app, user), out _);
            return false;
        }
        return f.Count >= MaxFailures;
    }

    public void Failed(string app, string? user)
    {
        if (string.IsNullOrWhiteSpace(user)) return;
        var now = clock.GetUtcNow();
        failures.AddOrUpdate(Key(app, user), _ => (1, now),
            (_, f) => now - f.First > Window ? (1, now) : (f.Count + 1, f.First));
        if (failures.Count > 100_000) failures.Clear();
    }

    public void Succeeded(string app, string? user)
    {
        if (!string.IsNullOrWhiteSpace(user)) failures.TryRemove(Key(app, user), out _);
    }

    private static string Key(string app, string user) => app + "|" + user.Trim();
}
