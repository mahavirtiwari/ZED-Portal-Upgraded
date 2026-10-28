using Zed.Core.Data;

namespace Zed.Core.Http;

/// <summary>
/// V4: addresses outside the portal that its pages link to, which the Admin can change or switch off (Administration →
/// Links), kept per system in its own database (dbo.V4Settings, migration 0011): "{UrlKey}" = the address (no row: the
/// default), "{EnabledKey}" = "0" when switched off (no row: shown). The pages get them from /api/config.
/// </summary>
public static class PortalLinks
{
    /// <param name="Key">The pages' name for it (/api/config "links").</param>
    /// <param name="ShownOn">Where the pages show it, and what switching it off does.</param>
    /// <param name="DefaultUrl">Used while no address is saved (Contact ZED: <see cref="PortalOptions.ContactUrl"/>).</param>
    public sealed record Link(string Key, string Name, string ShownOn, string UrlKey, string EnabledKey, string DefaultUrl);

    public const string ContactUrlKey = "Portal.ContactUrl";
    public const string ContactEnabledKey = "Portal.ContactEnabled";

    /// <summary>The links, in the order of the Admin page.</summary>
    public static readonly IReadOnlyList<Link> All =
    [
        new("contact", "Contact ZED", "The MSME menu and the registration page. Switched off: not shown.",
            ContactUrlKey, ContactEnabledKey, ""),
        new("ministry", "Ministry of MSME", "The Ministry's logo at the top of every page. Switched off: the logo is shown without a link.",
            "Portal.MinistryUrl", "Portal.MinistryEnabled", "https://msme.gov.in/"),
        new("playStore", "ZED MSME app on Google Play", "\"Get it on Google Play\" on the MSME dashboard, certification, payment result and registration pages. Switched off: not shown.",
            "Portal.PlayStoreUrl", "Portal.PlayStoreEnabled", "https://play.google.com/store/apps/details?id=com.qci.zed.msme"),
        new("appStore", "ZED MSME app on the App Store", "\"Download on the App Store\" on the MSME dashboard, certification and registration pages. Switched off: not shown.",
            "Portal.AppStoreUrl", "Portal.AppStoreEnabled", "https://apps.apple.com/in/app/zed-msme/id1631537071"),
        new("kawach", "MSME KAWACH", "\"Avail\" on the MSME KAWACH card of the MSME dashboard. Switched off: the card is not shown.",
            "Portal.KawachUrl", "Portal.KawachEnabled", "https://msmekawach.org.in/Msme/login"),
        new("lgd", "LGD Directory", "Admin → Masters → LG Directory, where to download the list of districts. Switched off: shown as text.",
            "Portal.LgdUrl", "Portal.LgdEnabled", "https://lgdirectory.gov.in/downloadDirectory.do"),
    ];

    public static Link? Find(string key) => All.FirstOrDefault(l => string.Equals(l.Key, key, StringComparison.OrdinalIgnoreCase));

    public static string DefaultUrl(Link link, PortalOptions portal) => link.Key == "contact" ? portal.ContactUrl : link.DefaultUrl;

    /// <summary>For the pages: each link's address, or null when the Admin switched it off.</summary>
    public static async Task<IReadOnlyDictionary<string, string?>> ForPagesAsync(IPortalSettings settings, PortalOptions portal, CancellationToken ct)
    {
        var links = new Dictionary<string, string?>();
        foreach (var l in All)
            links[l.Key] = await settings.GetAsync(l.EnabledKey, ct) == "0" ? null
                : await settings.GetAsync(l.UrlKey, ct) is { Length: > 0 } saved ? saved : DefaultUrl(l, portal);
        return links;
    }

    /// <summary>A web address the pages may link to (http or https, absolute, at most 500 characters), or the problem.</summary>
    public static string? Problem(string? value)
    {
        var v = (value ?? "").Trim();
        if (v.Length == 0) return null;
        if (v.Length > 500) return "The address is too long (500 characters at most).";
        return Uri.TryCreate(v, UriKind.Absolute, out var u) && (u.Scheme == Uri.UriSchemeHttps || u.Scheme == Uri.UriSchemeHttp) && u.Host.Contains('.')
            ? null
            : $"'{v}' is not a web address (e.g. https://zed.msme.gov.in/contact-us).";
    }
}
