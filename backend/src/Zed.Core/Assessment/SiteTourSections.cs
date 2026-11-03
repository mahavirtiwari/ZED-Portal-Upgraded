using System.Text.Json;
using System.Text.RegularExpressions;
using Zed.Core.Data;
using Zed.Core.Forms;

namespace Zed.Core.Assessment;

/// <summary>
/// One site tour section of the site assessor app (new in V4): the photos of the tour are filed under it, and the unit's
/// tour needs at least <see cref="Min"/> and at most <see cref="Max"/> of its photos. <see cref="Levels"/> and
/// <see cref="NicSectors"/> limit it to units of those certification levels and NIC 2-digit sectors; empty = all.
/// </summary>
public sealed record SiteTourSection(string Id, string Title, string? Hint, int Min, int Max, IReadOnlyList<string> Levels,
    IReadOnlyList<string> NicSectors, bool Active = true)
{
    /// <summary>Whether the section is asked of the unit (as App Forms' fields: an unknown sector does not exclude).</summary>
    public bool AppliesTo(AppFormUnit unit) =>
        Active
        && (Levels.Count == 0 || Levels.Contains(unit.Level, StringComparer.OrdinalIgnoreCase))
        && (NicSectors.Count == 0 || unit.NicSector is null || NicSectors.Contains(unit.NicSector, StringComparer.Ordinal));
}

/// <summary>
/// Admin → Site Tour Sections: the sections of the site tour, their photo limits and the levels / NIC sectors they are asked
/// of, per system in dbo.V4Settings (key <see cref="Key"/>, JSON; migration 0011). Without a saved value the ten sections of
/// the redesigned app (manufacturing flow, inward to outward). The mobile API answers the unit's sections with the photos
/// already uploaded, refuses a site tour photo beyond a section's maximum and the closing meeting before every section has
/// its minimum. A photo's section is kept in its name (SaPhotos.Name, shown on the web): "3. Utilities - DG set".
/// </summary>
public static partial class SiteTourSections
{
    public const string Key = "SiteTour.Sections";

    public const int MaxSections = 30;
    public const int MaxTitle = 100;
    public const int MaxHint = 200;
    public const int MaxPhotos = 50;

    /// <summary>SaPhotos.Name is varchar(200).</summary>
    public const int MaxName = 200;

    public static readonly IReadOnlyList<SiteTourSection> Defaults =
    [
        new("entrance", "Unit Entrance & Signage", "Gate, unit name board, premises", 1, 2, [], []),
        new("inward", "Raw Material Inward & Store", "Receipt, GRN area, RM racks", 2, 3, [], []),
        new("production", "Production / Machine Shop", "Process lines, machines, operators", 3, 5, [], []),
        new("inprocess", "In-process Inspection", "Gauges, check points, control charts", 2, 3, [], []),
        new("assembly", "Assembly & Packing", "Assembly bay, packing, labelling", 2, 3, [], []),
        new("fgstore", "Finished Goods Store", "FG racks, identification, FIFO", 2, 3, [], []),
        new("dispatch", "Dispatch / Outward", "Loading bay, dispatch register", 1, 2, [], []),
        new("utilities", "Utilities", "Power, compressor, boiler, DG set", 2, 3, [], []),
        new("safety", "Safety & Fire", "PPE, extinguishers, assembly point", 2, 3, [], []),
        new("environment", "Environment & Housekeeping", "Scrap yard, effluent, waste, 5S", 2, 3, [], []),
    ];

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>The saved sections in their order, or <see cref="Defaults"/> (also when the saved text cannot be read).</summary>
    public static async Task<IReadOnlyList<SiteTourSection>> LoadAsync(IPortalSettings settings, CancellationToken ct)
    {
        var text = await settings.GetAsync(Key, ct);
        if (string.IsNullOrWhiteSpace(text)) return Defaults;
        try
        {
            var list = JsonSerializer.Deserialize<List<SiteTourSection>>(text, Json);
            return list is { Count: > 0 } ? list.Select(Clean).ToList() : Defaults;
        }
        catch (JsonException)
        {
            return Defaults;
        }
    }

    public static Task SaveAsync(IPortalSettings settings, IReadOnlyList<SiteTourSection> sections, string userId, CancellationToken ct) =>
        settings.SetAsync(Key, JsonSerializer.Serialize(sections.Select(Clean), Json), userId, ct);

    /// <summary>The sections asked of the unit, in order.</summary>
    public static IReadOnlyList<SiteTourSection> For(IReadOnlyList<SiteTourSection> all, AppFormUnit unit) => all.Where(s => s.AppliesTo(unit)).ToList();

    /// <summary>The first problem of a list the Admin saves, or null.</summary>
    public static string? Problem(IReadOnlyList<SiteTourSection>? sections)
    {
        if (sections is null || sections.Count == 0) return "Add at least one section.";
        if (sections.Count > MaxSections) return $"At most {MaxSections} sections.";
        if (!sections.Any(s => s.Active)) return "At least one section must be in use.";
        var titles = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var s in sections)
        {
            var title = s.Title?.Trim() ?? "";
            if (title.Length == 0) return "Every section needs a name.";
            if (title.Length > MaxTitle) return $"A section name can have at most {MaxTitle} characters.";
            if (title.Contains(" - ", StringComparison.Ordinal) || char.IsAsciiDigit(title[0]))
                return $"\"{title}\": a section name cannot start with a number or contain \" - \".";
            if (!titles.Add(title)) return $"\"{title}\" is used twice.";
            if (string.IsNullOrWhiteSpace(s.Id) || !IdPattern().IsMatch(s.Id) || !ids.Add(s.Id)) return $"\"{title}\": invalid section key.";
            if (s.Hint?.Trim().Length > MaxHint) return $"\"{title}\": what to capture can have at most {MaxHint} characters.";
            if (s.Min < 0 || s.Max < 1 || s.Max > MaxPhotos) return $"\"{title}\": the maximum must be 1 to {MaxPhotos} photos and the minimum 0 or more.";
            if (s.Min > s.Max) return $"\"{title}\": the minimum cannot be more than the maximum.";
        }
        return null;
    }

    /// <summary>"3. Production / Machine Shop": the section's number in the unit's list and its name.</summary>
    public static string Label(IReadOnlyList<SiteTourSection> unitSections, SiteTourSection section) =>
        $"{IndexOf(unitSections, section) + 1}. {section.Title}";

    /// <summary>A photo's section as the app sends it: the key, the name (any case) or the number in the unit's list.</summary>
    public static SiteTourSection? Find(IReadOnlyList<SiteTourSection> unitSections, string? section)
    {
        var s = section?.Trim();
        if (string.IsNullOrEmpty(s)) return null;
        if (int.TryParse(s, out var n)) return n >= 1 && n <= unitSections.Count ? unitSections[n - 1] : null;
        return unitSections.FirstOrDefault(x => string.Equals(x.Id, s, StringComparison.OrdinalIgnoreCase))
            ?? unitSections.FirstOrDefault(x => string.Equals(x.Title, s, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>The name stored: the label, then the assessor's remark, cut to <see cref="MaxName"/> characters.</summary>
    public static string Name(string label, string? comment)
    {
        var name = string.IsNullOrWhiteSpace(comment) ? label : label + " - " + comment.Trim();
        return name.Length <= MaxName ? name : name[..MaxName];
    }

    /// <summary>
    /// The section a stored photo name belongs to ("3. Utilities - DG set" → Utilities), by its name whatever its number
    /// (the Admin may have reordered the sections since); null for a photo without a section.
    /// </summary>
    public static SiteTourSection? SectionOfName(IReadOnlyList<SiteTourSection> unitSections, string? name)
    {
        var m = NamePattern().Match(name ?? "");
        if (!m.Success) return null;
        var rest = m.Groups[1].Value;
        return unitSections
            .Where(s => rest.StartsWith(s.Title, StringComparison.OrdinalIgnoreCase)
                        && (rest.Length == s.Title.Length || rest[s.Title.Length..].StartsWith(" - ", StringComparison.Ordinal)))
            .OrderByDescending(s => s.Title.Length)
            .FirstOrDefault();
    }

    /// <summary>The unit's site tour photos per section id (distinct photos).</summary>
    public static Dictionary<string, int> Count(IReadOnlyList<SiteTourSection> unitSections, IEnumerable<(string? PhotoId, string? Name)> photos)
    {
        var counts = unitSections.ToDictionary(s => s.Id, _ => 0, StringComparer.OrdinalIgnoreCase);
        foreach (var p in photos.DistinctBy(p => p.PhotoId ?? Guid.NewGuid().ToString()))
            if (SectionOfName(unitSections, p.Name) is { } s) counts[s.Id]++;
        return counts;
    }

    /// <summary>The unit's site tour photos stored so far (SaPhotos, PhotoType SiteTour).</summary>
    public const string PhotosSql =
        "SELECT PhotoId, Name FROM dbo.SaPhotos WHERE ZedId = @ZedId AND Certification = @Certification AND PhotoType = 'SiteTour';";

    public sealed record PhotoRow(string? PhotoId, string? Name);

    public static async Task<IReadOnlyList<PhotoRow>> PhotosAsync(ISqlExecutor db, string zedId, string certificationType, CancellationToken ct) =>
        await db.QuerySqlAsync<PhotoRow>(PhotosSql, new
        {
            ZedId = new Dapper.DbString { Value = zedId, IsAnsi = true, Length = 50 },
            Certification = new Dapper.DbString { Value = certificationType, IsAnsi = true, Length = 50 },
        }, ct);

    /// <summary>The first section short of its minimum, as the text the app shows; null when every section has its photos.</summary>
    public static string? Shortfall(IReadOnlyList<SiteTourSection> unitSections, IReadOnlyDictionary<string, int> counts)
    {
        foreach (var s in unitSections)
            if (counts.GetValueOrDefault(s.Id) < s.Min)
                return $"Site Tour: \"{s.Title}\" needs at least {s.Min} photo{(s.Min == 1 ? "" : "s")} ({counts.GetValueOrDefault(s.Id)} uploaded). Please capture and sync them before the closing meeting.";
        return null;
    }

    private static int IndexOf(IReadOnlyList<SiteTourSection> list, SiteTourSection s)
    {
        for (var i = 0; i < list.Count; i++)
            if (string.Equals(list[i].Id, s.Id, StringComparison.OrdinalIgnoreCase)) return i;
        return -1;
    }

    private static SiteTourSection Clean(SiteTourSection s) => s with
    {
        Id = s.Id?.Trim() ?? "",
        Title = s.Title?.Trim() ?? "",
        Hint = string.IsNullOrWhiteSpace(s.Hint) ? null : s.Hint.Trim(),
        Levels = (s.Levels ?? []).Select(l => l.Trim()).Where(l => l.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList(),
        NicSectors = (s.NicSectors ?? []).Select(l => l.Trim()).Where(l => l.Length > 0).Distinct(StringComparer.Ordinal).ToList(),
    };

    [GeneratedRegex(@"^[a-z0-9][a-z0-9_-]{0,39}$", RegexOptions.IgnoreCase)]
    private static partial Regex IdPattern();

    [GeneratedRegex(@"^\d+\.\s+(.+)$", RegexOptions.Singleline)]
    private static partial Regex NamePattern();
}
