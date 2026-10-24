using Zed.Core.Http;

namespace Zed.Core.Content;

/// <summary>
/// The texts the Admin can edit (Admin → Texts), with their standard wording. The web pages and the apps show them
/// through api/content (portal) and Content/Texts (mobile hosts); the standard wording lives only here (an app keeps
/// its own copy as the offline fallback). Keys never change: the saved versions (dbo.V4ContentBlocks) are found by them.
/// The texts are listed by part: MSME pages, staff pages (ContentCatalogue.Web.cs) and the apps (ContentCatalogue.Apps.cs).
/// </summary>
public static partial class ContentCatalogue
{
    // Declared before Blocks: the parts below use them while Blocks is built.
    private static readonly PortalSystem[] All = [PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance];
    private static readonly PortalSystem[] Main = [PortalSystem.Main];
    private static readonly PortalSystem[] Consultancy = [PortalSystem.Consultancy];
    private static readonly PortalSystem[] MainAndSurveillance = [PortalSystem.Main, PortalSystem.Surveillance];

    public static IReadOnlyList<ContentBlock> Blocks { get; } = [.. MsmeWeb(), .. StaffWeb(), .. Apps()];

    public static IEnumerable<ContentBlock> For(PortalSystem system) => Blocks.Where(b => b.Systems.Contains(system));

    public static ContentBlock? Find(PortalSystem system, string key) =>
        For(system).FirstOrDefault(b => string.Equals(b.Key, key, StringComparison.OrdinalIgnoreCase));

    private static ContentBlock Web(string key, string name, string group, PortalSystem[] systems, string html, params string[] placeholders) =>
        new(key, name, group, ContentChannel.Web, systems, html, placeholders);

    private static ContentBlock App(string key, string name, string group, PortalSystem[] systems, string html, params string[] placeholders) =>
        new(key, name, group, ContentChannel.App, systems, html, placeholders);
}
