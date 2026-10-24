using Zed.Core.Http;

namespace Zed.Core.Content;

/// <summary>
/// The texts the Admin can edit (Admin → Texts), with their standard wording. The web pages and the apps show them
/// through api/content (portal) and Content/Texts (mobile hosts); a page keeps its own copy only as the offline
/// fallback. Keys never change: the saved versions (dbo.V4ContentBlocks) are found by them.
/// </summary>
public static class ContentCatalogue
{
    private static readonly PortalSystem[] All = [PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance];

    public static IReadOnlyList<ContentBlock> Blocks { get; } = [];

    public static IEnumerable<ContentBlock> For(PortalSystem system) => Blocks.Where(b => b.Systems.Contains(system));

    public static ContentBlock? Find(PortalSystem system, string key) =>
        For(system).FirstOrDefault(b => string.Equals(b.Key, key, StringComparison.OrdinalIgnoreCase));
}
