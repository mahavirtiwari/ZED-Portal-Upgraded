using System.Text.Json;
using System.Text.RegularExpressions;
using Zed.Core.Http;

namespace Zed.Core.Content;

/// <summary>
/// One wording of a page the Admin can change (2026-11-19, the user: "All page wording"): a heading, line, button, label,
/// placeholder, empty-state or message, with the page's own wording (<paramref name="Standard"/>) and the {values} the page
/// fills in. Plain text: the page shows it as text, never as HTML.
/// </summary>
public sealed record PageText(string Key, string Standard, string Kind, string Portal, string Page, string PageName, string[] Placeholders);

/// <summary>
/// The page wording of the web pages (PageTexts.json, embedded): written by frontend/tools/extract-texts.mjs from the pages'
/// <c>'…' | t: 'key'</c> and <c>t('key', '…')</c> (docs/TEXTS-GUIDE.md), never by hand. The Admin's wording is saved where
/// the Admin's Texts are (dbo.V4ContentBlocks, by key; the keys never clash with <see cref="ContentCatalogue"/>'s) and served
/// with them by api/content. MSME pages are in the main build only; staff, public and common wording in every build.
/// </summary>
public static partial class PageTextCatalogue
{
    private static readonly PortalSystem[] All = [PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance];
    private static readonly PortalSystem[] MainOnly = [PortalSystem.Main];

    private sealed record File(List<PageText> Texts);

    private static readonly Lazy<IReadOnlyList<PageText>> Loaded = new(Load);
    private static readonly Lazy<Dictionary<string, PageText>> ByKey =
        new(() => Loaded.Value.ToDictionary(t => t.Key, StringComparer.OrdinalIgnoreCase));

    public static IReadOnlyList<PageText> Texts => Loaded.Value;

    /// <summary>The builds a wording shows in.</summary>
    public static PortalSystem[] SystemsOf(PageText text) => text.Portal == "msme" ? MainOnly : All;

    public static IEnumerable<PageText> For(PortalSystem system) => Texts.Where(t => SystemsOf(t).Contains(system));

    public static PageText? Find(PortalSystem system, string key) =>
        ByKey.Value.TryGetValue(key, out var t) && SystemsOf(t).Contains(system) ? t : null;

    /// <summary>The longest wording the Admin may save: short for headings, buttons and labels, longer for lines and messages.</summary>
    public static int MaxLength(PageText text) => text.Kind is "note" or "message" or "text" ? 2000 : 300;

    /// <summary>
    /// The Admin's wording as it is saved: plain text, one space for runs of spaces and tabs, line breaks kept (at most one
    /// empty line), control characters removed, trimmed.
    /// </summary>
    public static string Clean(string? text)
    {
        var s = (text ?? "").Replace("\r\n", "\n").Replace('\r', '\n');
        s = ControlChars().Replace(s, "");
        s = Spaces().Replace(s, " ");
        s = string.Join('\n', s.Split('\n').Select(l => l.Trim()));
        return BlankLines().Replace(s, "\n\n").Trim();
    }

    /// <summary>What is wrong with the Admin's (cleaned) wording, or null.</summary>
    public static string? Problem(PageText text, string cleaned)
    {
        if (cleaned.Length == 0) return "Enter the wording, or use Reset to show the standard wording.";
        if (cleaned.Length > MaxLength(text)) return $"The wording is too long (at most {MaxLength(text)} characters).";
        if (Tag().IsMatch(cleaned)) return "Use plain text: HTML tags are not allowed in page wording.";
        var unknown = Placeholders(cleaned).Where(p => !text.Placeholders.Contains(p, StringComparer.Ordinal)).ToList();
        if (unknown.Count > 0)
        {
            var allowed = text.Placeholders.Length > 0 ? " Values of this wording: " + string.Join(", ", text.Placeholders.Select(p => "{" + p + "}")) + "." : " This wording has no values.";
            return $"{{{unknown[0]}}} is not a value of this wording.{allowed}";
        }
        return null;
    }

    /// <summary>The {values} a wording uses.</summary>
    public static IEnumerable<string> Placeholders(string text) => Placeholder().Matches(text).Select(m => m.Groups[1].Value).Distinct();

    private static IReadOnlyList<PageText> Load()
    {
        using var stream = typeof(PageTextCatalogue).Assembly.GetManifestResourceStream("Zed.Core.Content.PageTexts.json");
        if (stream is null) return [];
        var file = JsonSerializer.Deserialize<File>(stream, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        return file?.Texts ?? [];
    }

    [GeneratedRegex(@"[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​  ]")] private static partial Regex ControlChars();
    [GeneratedRegex(@"[ \t ]+")] private static partial Regex Spaces();
    [GeneratedRegex(@"\n{3,}")] private static partial Regex BlankLines();
    // A real tag (<b>, </p>, <a href="…">, <br/>, <!-- … -->), not an address in angle brackets ("ZED <noreply@example.org>")
    // or a comparison ("< 2MB"); the wording is always shown as plain text anyway.
    [GeneratedRegex(@"<!--|<\s*/?\s*[A-Za-z][A-Za-z0-9-]*(?:\s+[^<>@]*)?\s*/?>")] private static partial Regex Tag();
    [GeneratedRegex(@"\{([A-Za-z][A-Za-z0-9_]*)\}")] private static partial Regex Placeholder();
}
