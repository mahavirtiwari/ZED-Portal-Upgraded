using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Zed.Portal.Features.Incentives;

namespace Zed.Main.MobileApi.Controllers;

/// <summary>
/// The rules of the onsite visit of an incentive scheme application (docs/INCENTIVE-SCHEMES.md, "Phase 2: onsite
/// verification"), kept apart from the controller so they can be tested on their own: what Recommend needs, the eligible
/// amount on the verified claim, the representative's mobile, the checks the assessor may write and the stored photo names.
/// </summary>
public static partial class SchemeVisitRules
{
    public const string Valid = "Yes";
    public const string NotValid = "No";
    public const string Recommend = "recommend";
    public const string Reject = "reject";

    public const int MaxRemarks = 1000;
    public const int MaxOverallRemarks = 4000;
    public const int MaxName = 200;
    public const string SelfieSlot = "onsite/selfie";
    public const string SiteSlot = "onsite/site";
    public const string SlotPrefix = "onsite/";

    /// <summary>A 10-digit Indian mobile number (the app's rule: it cannot begin with 0–5).</summary>
    public static bool IsMobile(string? value) => value is not null && MobilePattern().IsMatch(value);

    /// <summary>A person's name or a remark: trimmed, at most <paramref name="max"/> characters, no control characters but new lines.</summary>
    public static string? Text(string? value, int max, bool lines = false)
    {
        var s = value?.Trim();
        if (string.IsNullOrEmpty(s) || s.Length > max) return null;
        if (s.Any(c => char.IsControl(c) && !(lines && c is '\n' or '\r' or '\t'))) return null;
        return s;
    }

    /// <summary>
    /// Eligible = share % of the verified claim (whole rupees of the claim, as the desktop recommendation and the FA / TU
    /// pages: truncate, then the share), at most the maximum; nothing without a grade.
    /// </summary>
    public static decimal Eligible(decimal claim, decimal? sharePercent, decimal? maxAmount) =>
        sharePercent is not { } share || maxAmount is not { } max ? 0m : Math.Min(decimal.Round(decimal.Truncate(claim) * share / 100m, 2), max);

    /// <summary>The grade of a row (its share and maximum, set at submit); else the definition's by-level row of the level (or "All").</summary>
    public static (decimal? Share, decimal? Max) Grade(SchemeApplications.Row row, SchemeDefinition? def)
    {
        if (row.SharePercent is { } s && row.MaxAmount is { } m) return (s, m);
        if (def?.Grading is { Mode: SchemeRules.ByLevel } g)
        {
            var hit = g.Rows.FirstOrDefault(r => string.Equals(r.Key, row.SchemeLevel?.Trim(), StringComparison.OrdinalIgnoreCase))
                ?? g.Rows.FirstOrDefault(r => string.Equals(r.Key, "All", StringComparison.OrdinalIgnoreCase));
            if (hit is not null) return (hit.SharePercent, hit.MaxAmount);
        }
        return (null, null);
    }

    /// <summary>An amount as the history entries and EligibleAmount write it ("150000.00").</summary>
    public static string Money(decimal v) => v.ToString("0.00", CultureInfo.InvariantCulture);

    /// <summary>The verified claim's problem, or null: 0 up to the claimed amount, at most two decimals.</summary>
    public static string? VerifiedClaimProblem(decimal? verified, decimal? claimed)
    {
        if (verified is not { } v) return "Please enter the verified claim amount.";
        if (v < 0 || decimal.Round(v, 2) != v) return "The verified claim is an amount in rupees (up to two decimals).";
        if (v > (claimed ?? 0)) return $"The verified claim cannot be more than the claimed amount (Rs. {Money(claimed ?? 0)}).";
        return null;
    }

    /// <summary>The onsite checks of the application, by path (the "onsite:" keys of FormChecks).</summary>
    public static Dictionary<string, FieldCheck> OnsiteChecks(IReadOnlyDictionary<string, FieldCheck> checks) =>
        checks.Where(c => c.Key.StartsWith(SchemeApplications.OnsiteCheckPrefix, StringComparison.Ordinal))
            .ToDictionary(c => c.Key[SchemeApplications.OnsiteCheckPrefix.Length..], c => c.Value, StringComparer.Ordinal);

    /// <summary>
    /// What still stops Recommend (empty when it may go): every onsite place checked, none Not valid, at least the minimum of
    /// photos for every item, the representative's name and mobile.
    /// </summary>
    public static List<string> RecommendProblems(SchemeDefinition def, FormAnswers answers, IReadOnlyDictionary<string, FieldCheck> formChecks,
        IReadOnlyCollection<string> photoSlots, string? representativeName, string? representativeMobile)
    {
        var problems = new List<string>();
        var onsite = OnsiteChecks(formChecks);
        var places = SchemeApplications.OnsitePlacesOf(def, answers);
        var open = places.Where(p => !onsite.ContainsKey(p.Path)).ToList();
        if (open.Count > 0) problems.Add($"Please check every answer first ({open.Count} left, e.g. \"{open[0].Label}\").");
        var notValid = places.Where(p => onsite.TryGetValue(p.Path, out var c) && c.Status == NotValid).ToList();
        if (notValid.Count > 0) problems.Add($"{notValid.Count} answer(s) are marked Not valid (e.g. \"{notValid[0].Label}\"): reject the application instead.");
        var min = Math.Max(0, def.Verification.OnsitePhotosMin);
        foreach (var item in SchemeApplications.OnsiteItemsOf(def, answers))
        {
            var name = SchemeApplications.OnsitePhotoName(item.Section, item.Index);
            var n = photoSlots.Count(s => string.Equals(s, name, StringComparison.Ordinal));
            if (n < min) problems.Add($"\"{item.Title}\": take at least {min} photo(s) ({n} taken).");
        }
        if (Text(representativeName, MaxName) is null) problems.Add("Please enter the name of the unit's representative.");
        if (!IsMobile(representativeMobile)) problems.Add("Please enter the representative's 10-digit mobile number.");
        return problems;
    }

    /// <summary>
    /// The stored name of an onsite photo: the time (17 digits) and 8 hex of a hash of the application and the app's photo id, so
    /// a retried send is recognised (<see cref="SameUpload"/>) and the name has the scheme uploads' form (SchemeUploads.IsGenerated).
    /// </summary>
    public static string PhotoFileName(int applicationId, string appPhotoId, DateTime now) =>
        now.ToString("yyyyMMddHHmmssfff", CultureInfo.InvariantCulture) + Tag(applicationId, appPhotoId) + ".jpg";

    public static string Tag(int applicationId, string appPhotoId) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes($"{applicationId}:{appPhotoId}")))[..8];

    /// <summary>The stored file of the app's photo id (a retried send), by its tag.</summary>
    public static bool SameUpload(string? storedName, int applicationId, string appPhotoId) =>
        storedName is { Length: 29 } && storedName.EndsWith(Tag(applicationId, appPhotoId) + ".jpg", StringComparison.Ordinal);

    /// <summary>A stored scheme file name (an upload of the applicant or an onsite photo): 17 digits, 8 hex, .pdf / .jpg / .png.</summary>
    public static bool IsStoredName(string? name) => name is not null && StoredName().IsMatch(name);

    /// <summary>The file names a document or photo answer holds (a JSON list), or none.</summary>
    public static List<string> FilesOf(string? value)
    {
        var v = value?.Trim();
        if (string.IsNullOrEmpty(v) || !v.StartsWith('[')) return [];
        try { return JsonSerializer.Deserialize<List<string?>>(v)?.Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => x!.Trim()).ToList() ?? []; }
        catch (JsonException) { return []; }
    }

    /// <summary>An answer as text: a JSON list joined with commas, else the value.</summary>
    public static string? Display(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var v = value.Trim();
        if (v.StartsWith('['))
        {
            try { return string.Join(", ", JsonSerializer.Deserialize<List<string?>>(v)?.Where(x => !string.IsNullOrWhiteSpace(x)) ?? []); }
            catch (JsonException) { /* plain text */ }
        }
        return v;
    }

    /// <summary>Every document and photo of the answers (the files the app may open).</summary>
    public static HashSet<string> AllFiles(SchemeDefinition? def, FormAnswers answers)
    {
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var (key, items) in answers.Sections)
        {
            var section = def?.Form.Sections.FirstOrDefault(s => s.Key == key);
            foreach (var item in items)
                foreach (var (field, value) in item.Values)
                {
                    var type = section?.Fields.FirstOrDefault(f => f.Key == field)?.Type;
                    if (type is null or "document" or "photo") set.UnionWith(FilesOf(value));
                }
        }
        return set;
    }

    /// <summary>"yyyy-MM-ddTHH:mm:ss" (the dates the assessor app reads).</summary>
    public static string? Iso(DateTime? d) => d?.ToString("yyyy-MM-dd'T'HH:mm:ss", CultureInfo.InvariantCulture);

    /// <summary>A GPS fix as the app sends it: a latitude and a longitude that read as numbers in range.</summary>
    public static bool HasGps(string? latitude, string? longitude) =>
        double.TryParse(latitude, NumberStyles.Float, CultureInfo.InvariantCulture, out var lat) && lat is >= -90 and <= 90 &&
        double.TryParse(longitude, NumberStyles.Float, CultureInfo.InvariantCulture, out var lon) && lon is >= -180 and <= 180 &&
        !(lat == 0 && lon == 0);

    [GeneratedRegex(@"^[6-9][0-9]{9}$")] private static partial Regex MobilePattern();

    [GeneratedRegex(@"^\d{17}[0-9a-f]{8}\.(pdf|jpg|png)$")] private static partial Regex StoredName();
}
