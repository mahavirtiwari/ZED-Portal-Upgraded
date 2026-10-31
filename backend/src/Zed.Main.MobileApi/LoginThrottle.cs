using System.Collections.Concurrent;

namespace Zed.Main.MobileApi;

/// <summary>
/// Failed logins per user id: after 5 failures in 15 minutes further attempts for that user are
/// refused until the window passes. The old services had no limit at all. One counter per user id
/// for all the apps of this deployment (MSME, site and remote assessor apps share it), with the id
/// trimmed, upper-cased and full-width letters folded, so "zedmsme1" and "ＺＥＤＭＳＭＥ1" are the same user.
/// Password reset requests have their own counter. Logins are also limited per client IP
/// (<see cref="Zed.Core.Http.RateLimitPolicies.Sensitive"/>).
/// </summary>
public sealed class LoginThrottle(TimeProvider clock)
{
    public const int MaxFailures = 5;
    public static readonly TimeSpan Window = TimeSpan.FromMinutes(15);

    /// <summary>Above this many users the expired entries are dropped, then the oldest unlocked ones.</summary>
    public const int MaxEntries = 100_000;

    /// <summary>Failure text when the per-IP limit of logins and resets is reached (Program.cs).</summary>
    public const string TooManyRequests = "Too many attempts. Please try again after a minute.";

    public enum Counter { Login, PasswordReset }

    private readonly ConcurrentDictionary<string, (int Count, DateTimeOffset First)> failures = new(StringComparer.Ordinal);
    private int evicting;

    public LoginThrottle() : this(TimeProvider.System) { }

    public int Count => failures.Count;

    public bool IsLocked(string? user, Counter counter = Counter.Login)
    {
        if (Key(counter, user) is not { } key) return false;
        if (!failures.TryGetValue(key, out var f)) return false;
        if (clock.GetUtcNow() - f.First > Window)
        {
            failures.TryRemove(key, out _);
            return false;
        }
        return f.Count >= MaxFailures;
    }

    public void Failed(string? user, Counter counter = Counter.Login)
    {
        if (Key(counter, user) is not { } key) return;
        var now = clock.GetUtcNow();
        failures.AddOrUpdate(key, _ => (1, now),
            (_, f) => now - f.First > Window ? (1, now) : (f.Count + 1, f.First));
        if (failures.Count > MaxEntries) Evict(now);
    }

    public void Succeeded(string? user, Counter counter = Counter.Login)
    {
        if (Key(counter, user) is { } key) failures.TryRemove(key, out _);
    }

    /// <summary>
    /// Flooding with made-up names must not wipe real lockouts (the old code cleared the whole table):
    /// expired entries go first, then the oldest entries below the lock, and locked users only when
    /// they alone exceed the limit.
    /// </summary>
    private void Evict(DateTimeOffset now)
    {
        if (Interlocked.Exchange(ref evicting, 1) == 1) return;
        try
        {
            foreach (var (key, f) in failures)
                if (now - f.First > Window) failures.TryRemove(key, out _);

            var excess = failures.Count - MaxEntries * 9 / 10;
            if (excess <= 0) return;
            var oldest = failures.ToArray()
                .OrderBy(e => e.Value.Count >= MaxFailures ? 1 : 0)
                .ThenBy(e => e.Value.First)
                .Take(excess);
            foreach (var e in oldest) failures.TryRemove(e.Key, out _);
        }
        finally
        {
            Volatile.Write(ref evicting, 0);
        }
    }

    /// <summary>One spelling per user id: trimmed, full-width forms folded to ASCII, upper case.</summary>
    public static string? NormalizeUser(string? user)
    {
        if (string.IsNullOrWhiteSpace(user)) return null;
        var chars = user.Trim().ToCharArray();
        for (var i = 0; i < chars.Length; i++)
        {
            var c = chars[i];
            if (c is >= '\uFF01' and <= '\uFF5E') chars[i] = (char)(c - 0xFEE0);
            else if (c == '\u3000') chars[i] = ' ';
        }
        var folded = new string(chars).Trim();
        return folded.Length == 0 ? null : folded.ToUpperInvariant();
    }

    private static string? Key(Counter counter, string? user) =>
        NormalizeUser(user) is { } id ? (counter == Counter.Login ? "L|" : "R|") + id : null;
}
