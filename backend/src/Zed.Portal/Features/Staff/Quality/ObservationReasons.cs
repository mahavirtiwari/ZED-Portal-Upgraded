using System.Text.Json;
using System.Text.RegularExpressions;
using Zed.Core.Data;

namespace Zed.Portal.Features.Staff.Quality;

/// <summary>A reason an operation admin picks for a quality observation, with the severity it carries.</summary>
public sealed record ObservationReason(string Id, string Text, string Severity, bool Active = true);

/// <summary>
/// Admin → Observation reasons (2026-11-17, approved): the reasons of the quality observations and their severity (Minor / Major /
/// Critical), per system in the system's own dbo.V4Settings (JSON, migration 0011), managed from the main portal through the
/// portal switch. The reason decides the severity (the user, 2026-11-17: the operation admin cannot change it) and covers all
/// levels. Without a saved list: the categories the feature started with (the handholding ones on the Consultancy portal).
/// The three severities and what they do stay fixed (<see cref="QualityObservations.Severities"/>: points 1 / 3 / 5, major and
/// critical hold the final submit). An observation keeps the reason's wording and severity it was raised with (QoCategory,
/// QoSeverity), so renaming or switching off a reason changes nothing already raised.
/// </summary>
public static partial class ObservationReasons
{
    public const string Key = "Quality.Reasons";

    public const int MaxReasons = 40;

    /// <summary>AssessorComments.QoCategory is nvarchar(150) since migration 0095 (varchar(60) before).</summary>
    public const int MaxText = 150;

    public static readonly IReadOnlyList<ObservationReason> Defaults =
    [
        new("evidence", "Evidence not checked properly", "Major"),
        new("conformance", "Conformance not justified", "Major"),
        new("photo", "Photo / location issue", "Critical"),
        new("remarks", "Remarks incomplete", "Minor"),
        new("attendance", "Attendance / timeline", "Minor"),
        new("conduct", "Conduct", "Critical"),
        new("other", "Other", "Minor"),
    ];

    public static readonly IReadOnlyList<ObservationReason> HandholdingDefaults =
    [
        new("baseline", "Baseline not assessed properly", "Major"),
        new("checkpoint", "Checkpoint answer not justified", "Major"),
        new("action-plan", "Action plan not adequate", "Major"),
        new("review", "Progress review not verified", "Minor"),
        new("photo", "Photo / location issue", "Critical"),
        new("remarks", "Remarks incomplete", "Minor"),
        new("attendance", "Attendance / timeline", "Minor"),
        new("conduct", "Conduct", "Critical"),
        new("other", "Other", "Minor"),
    ];

    public static IReadOnlyList<ObservationReason> DefaultsFor(bool handholding) => handholding ? HandholdingDefaults : Defaults;

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>The saved reasons in their order, or the defaults (also when the saved text cannot be read).</summary>
    public static async Task<IReadOnlyList<ObservationReason>> LoadAsync(IPortalSettings settings, bool handholding, CancellationToken ct)
    {
        var text = await settings.GetAsync(Key, ct);
        if (string.IsNullOrWhiteSpace(text)) return DefaultsFor(handholding);
        try
        {
            var list = JsonSerializer.Deserialize<List<ObservationReason>>(text, Json);
            return list is { Count: > 0 } ? list.Select(Clean).ToList() : DefaultsFor(handholding);
        }
        catch (JsonException)
        {
            return DefaultsFor(handholding);
        }
    }

    public static Task SaveAsync(IPortalSettings settings, IReadOnlyList<ObservationReason> reasons, string userId, CancellationToken ct) =>
        settings.SetAsync(Key, JsonSerializer.Serialize(reasons.Select(Clean), Json), userId, ct);

    /// <summary>The reason an observation is raised with: in use, by its key or its wording.</summary>
    public static ObservationReason? Find(IReadOnlyList<ObservationReason> reasons, string? idOrText)
    {
        var s = idOrText?.Trim();
        if (string.IsNullOrEmpty(s)) return null;
        return reasons.Where(r => r.Active).FirstOrDefault(r => string.Equals(r.Id, s, StringComparison.OrdinalIgnoreCase))
            ?? reasons.Where(r => r.Active).FirstOrDefault(r => string.Equals(r.Text, s, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>The first problem of a list the Admin saves, or null.</summary>
    public static string? Problem(IReadOnlyList<ObservationReason>? reasons)
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
            if (!texts.Add(text)) return $"\"{text}\" is listed twice.";
            if (string.IsNullOrWhiteSpace(r.Id) || !IdPattern().IsMatch(r.Id) || !ids.Add(r.Id)) return $"\"{text}\": invalid reason key.";
            if (!QualityObservations.Severities.Contains(r.Severity?.Trim() ?? "", StringComparer.OrdinalIgnoreCase))
                return $"\"{text}\": choose Minor, Major or Critical.";
        }
        return null;
    }

    private static ObservationReason Clean(ObservationReason r) => r with
    {
        Id = r.Id?.Trim() ?? "",
        Text = r.Text?.Trim() ?? "",
        Severity = QualityObservations.Severities.FirstOrDefault(s => string.Equals(s, r.Severity?.Trim(), StringComparison.OrdinalIgnoreCase)) ?? "Minor",
    };

    [GeneratedRegex(@"^[a-z0-9][a-z0-9_-]{0,39}$", RegexOptions.IgnoreCase)]
    private static partial Regex IdPattern();
}
