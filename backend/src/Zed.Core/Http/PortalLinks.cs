using Zed.Core.Data;

namespace Zed.Core.Http;

/// <summary>
/// V4: addresses outside the portal that its pages link to, which the Admin can change (Administration → Links), kept per
/// system in its own database (dbo.V4Settings, migration 0011). An empty value goes back to the server configuration.
/// </summary>
public static class PortalLinks
{
    /// <summary>"Contact ZED" (MSME menu, registration and login pages): default <see cref="PortalOptions.ContactUrl"/>.</summary>
    public const string ContactUrlKey = "Portal.ContactUrl";

    public static async Task<string> ContactUrlAsync(IPortalSettings settings, PortalOptions portal, CancellationToken ct) =>
        await settings.GetAsync(ContactUrlKey, ct) is { Length: > 0 } saved ? saved : portal.ContactUrl;

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
