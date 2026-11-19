using System.Text.Json;
using System.Text.RegularExpressions;
using Zed.Core.Data;

namespace Zed.Portal.Features.Staff.Assessment;

/// <summary>A reason an agency picks when it rejects a unit allotted to it, and what then happens to the unit.</summary>
/// <param name="Action"><see cref="RejectionReasons.Auto"/>: the unit goes to another agency by round robin
/// (<see cref="AgencyRejections"/>); <see cref="RejectionReasons.MasterAdmin"/>: it waits on the Master Admin's Allot list.</param>
public sealed record RejectionReason(string Id, string Text, string Action, bool Active = true)
{
    public bool AutoReallot => Action == RejectionReasons.Auto;
}

/// <summary>
/// Admin → Rejection Reasons (2026-11-19, approved): the reasons an assessment agency picks (drop-down, with optional remarks)
/// when it rejects a desktop or site allotment, on main and Surveillance, each saying whether the unit is re-allotted
/// automatically or allotted by the Master Admin. Per system in the system's own dbo.V4Settings (JSON, migration 0011), managed
/// from the main portal through the portal switch, as the observation reasons. Without a saved list: <see cref="Defaults"/>.
/// A rejection keeps the reason's wording it was made with (MsmeCertifications.ReasonForRejection, RejectionReasonId).
/// </summary>
public static partial class RejectionReasons
{
    public const string Key = "Allotment.RejectionReasons";
    public const string Auto = "Auto";
    public const string MasterAdmin = "MasterAdmin";
    public static readonly IReadOnlyList<string> Actions = [Auto, MasterAdmin];

    public const int MaxReasons = 40;
    public const int MaxText = 150;
    /// <summary>MsmeCertifications.RejectionRemarks (migration 0103).</summary>
    public const int MaxRemarks = 1000;

    public static readonly IReadOnlyList<RejectionReason> Defaults =
    [
        new("conflict", "Conflict of interest with the unit", Auto),
        new("no-assessor", "No assessor available for this location", Auto),
        new("sector", "Unit's sector outside our expertise", Auto),
        new("workload", "Workload: cannot take more units now", Auto),
        new("unit-details", "Unit details incorrect / not reachable", MasterAdmin),
        new("other", "Other", MasterAdmin),
    ];

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>The saved reasons in their order, or the defaults (also when the saved text cannot be read).</summary>
    public static async Task<IReadOnlyList<RejectionReason>> LoadAsync(IPortalSettings settings, CancellationToken ct)
    {
        var text = await settings.GetAsync(Key, ct);
        if (string.IsNullOrWhiteSpace(text)) return Defaults;
        try
        {
            var list = JsonSerializer.Deserialize<List<RejectionReason>>(text, Json);
            return list is { Count: > 0 } ? list.Select(Clean).ToList() : Defaults;
        }
        catch (JsonException)
        {
            return Defaults;
        }
    }

    public static Task SaveAsync(IPortalSettings settings, IReadOnlyList<RejectionReason> reasons, string userId, CancellationToken ct) =>
        settings.SetAsync(Key, JsonSerializer.Serialize(reasons.Select(Clean), Json), userId, ct);

    /// <summary>An active reason by its key.</summary>
    public static RejectionReason? Find(IReadOnlyList<RejectionReason> reasons, string? id)
    {
        var s = id?.Trim();
        return string.IsNullOrEmpty(s) ? null : reasons.FirstOrDefault(r => r.Active && string.Equals(r.Id, s, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>The first problem of a list the Admin saves, or null.</summary>
    public static string? Problem(IReadOnlyList<RejectionReason>? reasons)
    {
        if (reasons is null || reasons.Count == 0) return "Add at least one reason.";
        if (reasons.Count > MaxReasons) return $"At most {MaxReasons} reasons.";
        if (!reasons.Any(r => r.Active)) return "At least one reason must be in use.";
        var texts = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var r in reasons)
        {
            var text = r.Text?.Trim() ?? "";
            if (text.Length == 0) return "Every reason needs its wording.";
            if (text.Length > MaxText) return $"A reason can have at most {MaxText} characters.";
            if (text.Any(c => char.IsControl(c))) return $"\"{text}\": the wording cannot contain line breaks or control characters.";
            if (!texts.Add(text)) return $"\"{text}\" is listed twice.";
            if (string.IsNullOrWhiteSpace(r.Id) || !IdPattern().IsMatch(r.Id) || !ids.Add(r.Id)) return $"\"{text}\": invalid reason key.";
            if (!Actions.Contains(r.Action?.Trim() ?? "", StringComparer.OrdinalIgnoreCase))
                return $"\"{text}\": choose Auto re-allot or Master Admin allots.";
        }
        return null;
    }

    /// <summary>The value given to the legacy procedures (ReasonForRejection varchar(100)): the reason, then the remarks.</summary>
    public static string LegacyText(RejectionReason reason, string? remarks, int max = 100)
    {
        var text = string.IsNullOrWhiteSpace(remarks) ? reason.Text : $"{reason.Text} – {remarks.Trim()}";
        text = string.Join(' ', text.Split(['\r', '\n', '\t'], StringSplitOptions.RemoveEmptyEntries));
        return text.Length <= max ? text : text[..(max - 1)] + "…";
    }

    /// <summary>Remarks as stored (trimmed, empty → null), or an error.</summary>
    public static bool TryRemarks(string? value, out string? remarks, out string? error)
    {
        remarks = string.IsNullOrWhiteSpace(value) ? null : value.Trim();
        error = null;
        if (remarks is null) return true;
        if (remarks.Length > MaxRemarks) error = $"The remarks can be at most {MaxRemarks} characters.";
        else if (remarks.Any(c => char.IsControl(c) && c is not '\r' and not '\n' and not '\t')) error = "Please enter valid remarks.";
        return error is null;
    }

    private static RejectionReason Clean(RejectionReason r) => r with
    {
        Id = r.Id?.Trim() ?? "",
        Text = r.Text?.Trim() ?? "",
        Action = Actions.FirstOrDefault(a => string.Equals(a, r.Action?.Trim(), StringComparison.OrdinalIgnoreCase)) ?? MasterAdmin,
    };

    [GeneratedRegex(@"^[a-z0-9][a-z0-9_-]{0,39}$", RegexOptions.IgnoreCase)]
    private static partial Regex IdPattern();
}
