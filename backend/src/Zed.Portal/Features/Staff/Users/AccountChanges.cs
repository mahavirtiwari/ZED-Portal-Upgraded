using System.Text.Json;
using System.Text.Json.Serialization;

namespace Zed.Portal.Features.Staff.Users;

/// <summary>
/// One field of a staff account that changed (2026-11-21, the product owner: "profile edit histories are missing"): a single
/// value as old → new, or a list as the items added and removed. Long lists keep their first <see cref="AccountChanges.ListShown"/>
/// items and the full count, long texts their first <see cref="AccountChanges.TextShown"/> characters. <see cref="Field"/> is a key
/// (e.g. "mobile", "states") that the History panel turns into a label through the Texts mechanism.
/// </summary>
public sealed record AccountChange(
    string Field,
    string? Old = null,
    string? New = null,
    IReadOnlyList<string>? Added = null,
    IReadOnlyList<string>? Removed = null,
    int? AddedCount = null,
    int? RemovedCount = null);

/// <summary>
/// The profile of a staff account as the fields the History records (<see cref="AccountChanges.Diff"/>): keys in the order they are
/// shown, each a single value or a list. Built by each controller from what it saves, before and after.
/// </summary>
public sealed class AccountProfile
{
    internal readonly List<(string Key, object? Value)> Items = [];

    public AccountProfile Add(string key, string? value)
    {
        Items.Add((key, value));
        return this;
    }

    public AccountProfile Add(string key, IEnumerable<string?>? values)
    {
        Items.Add((key, (values ?? []).ToList()));
        return this;
    }

    public AccountProfile Add(string key, bool value) => Add(key, value ? AccountChanges.Yes : AccountChanges.No);

    internal object? Get(string key) => Items.FirstOrDefault(i => i.Key == key).Value;
    internal bool Has(string key) => Items.Any(i => i.Key == key);
}

/// <summary>The change list of a profile save (pure: no database), stored as JSON in dbo.UserBlockHistory.Details (migration 0109).</summary>
public static class AccountChanges
{
    /// <summary>The items of a long list that are kept by name (the rest are counted).</summary>
    public const int ListShown = 5;

    /// <summary>A long text (an address) is kept to this many characters.</summary>
    public const int TextShown = 300;

    /// <summary>A yes / no field as stored (the panel shows its own words for them).</summary>
    public const string Yes = "true";
    public const string No = "false";

    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    /// <summary>
    /// What changed from <paramref name="before"/> to <paramref name="after"/>, in the order of <paramref name="after"/>'s fields.
    /// With no <paramref name="before"/> (a new account), every field that has a value. Fields equal before and after (texts trimmed,
    /// line ends and empty values alike; lists compared without case or order) are left out, so an unchanged save gives an empty list.
    /// A field only <paramref name="after"/> has is compared with nothing.
    /// </summary>
    public static List<AccountChange> Diff(AccountProfile? before, AccountProfile after)
    {
        var changes = new List<AccountChange>();
        foreach (var (key, value) in after.Items)
        {
            var old = before?.Get(key);
            if (value is List<string?> list || old is List<string?>)
            {
                var now = Clean(value as List<string?> ?? (value is string s ? [s] : []));
                var was = Clean(old as List<string?> ?? (old is string o ? [o] : []));
                var added = now.Where(x => !was.Contains(x, StringComparer.OrdinalIgnoreCase)).ToList();
                var removed = was.Where(x => !now.Contains(x, StringComparer.OrdinalIgnoreCase)).ToList();
                if (added.Count == 0 && removed.Count == 0) continue;
                changes.Add(new AccountChange(key,
                    Added: added.Count == 0 ? null : added.Take(ListShown).ToList(),
                    Removed: removed.Count == 0 ? null : removed.Take(ListShown).ToList(),
                    AddedCount: added.Count > ListShown ? added.Count : null,
                    RemovedCount: removed.Count > ListShown ? removed.Count : null));
            }
            else
            {
                var now = Text(value as string);
                var was = Text(old as string);
                if (string.Equals(now, was, StringComparison.Ordinal)) continue;
                changes.Add(new AccountChange(key, Old: Short(was), New: Short(now)));
            }
        }
        return changes;
    }

    /// <summary>The change list as stored (JSON, camelCase, nulls left out), or null when nothing changed.</summary>
    public static string? ToJson(IReadOnlyList<AccountChange> changes) => changes.Count == 0 ? null : JsonSerializer.Serialize(changes, Json);

    /// <summary>A stored change list (or null when it is not one).</summary>
    public static IReadOnlyList<AccountChange>? FromJson(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { return JsonSerializer.Deserialize<List<AccountChange>>(json, Json); }
        catch (JsonException) { return null; }
    }

    private static List<string> Clean(IEnumerable<string?> values) =>
        values.Select(v => v?.Trim()).Where(v => !string.IsNullOrEmpty(v)).Select(v => v!).Distinct(StringComparer.OrdinalIgnoreCase).ToList();

    private static string? Text(string? value)
    {
        var t = value?.Replace("\r\n", "\n").Trim();
        return string.IsNullOrEmpty(t) ? null : t;
    }

    private static string? Short(string? value) => value is { Length: > TextShown } ? value[..TextShown] + "…" : value;
}
