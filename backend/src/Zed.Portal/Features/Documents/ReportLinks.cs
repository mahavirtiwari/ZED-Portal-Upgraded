using System.Globalization;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Options;
using Zed.Core.Http;
using Zed.Portal.Features.Staff.Assessment;

namespace Zed.Portal.Features.Documents;

/// <summary>What a signed report link opens: the report kind, the record (its ZED ID, or a rejected copy's), the level and the milestone.</summary>
public sealed record ReportLinkTarget(string Kind, string ZedId, string Level, int? Milestone);

/// <summary>
/// Short-lived signed tokens of the report page (2026-11-15), with this host's Data Protection keys (the keys that protect its
/// sign-in cookies; authenticated encryption with HMAC-SHA256, never in a config file):
/// <list type="bullet">
/// <item>Report links (<see cref="Link"/>, 10 minutes): the apps have no web sign-in, so an app-token endpoint
/// (Msme/AppReportLink, SA/AppReportLink) checks the user and hands out the page address with a token bound to the ZED ID, the
/// report kind, the level and the milestone; the page and its API accept it instead of the cookie, read-only.</item>
/// <item>Photo addresses (<see cref="Photo"/>, 2 hours): the page model is built only for a reader allowed to see the report,
/// and names each photo by a token bound to the record and the photo's path in the record's own folder, so an &lt;img&gt;
/// needs no cookie and no other file can be asked for.</item>
/// </list>
/// The tokens are this host's own (the Main, Consultancy and Surveillance portals each check what they issued).
/// </summary>
public sealed partial class ReportLinks(IDataProtectionProvider protection, IOptions<PortalOptions> portal)
{
    public static readonly TimeSpan LinkLifetime = TimeSpan.FromMinutes(10);
    public static readonly TimeSpan PhotoLifetime = TimeSpan.FromHours(2);

    public const string Assessment = "assessment";
    public const string Surveillance = "surveillance";
    public const string Milestone = "milestone";

    private const int MaxToken = 2048;

    private ITimeLimitedDataProtector LinkProtector => protection.CreateProtector("Zed.ReportLink.v1").ToTimeLimitedDataProtector();
    private ITimeLimitedDataProtector PhotoProtector => protection.CreateProtector("Zed.ReportPhoto.v1").ToTimeLimitedDataProtector();

    public static bool IsKind(string? kind) => kind is Assessment or Surveillance or Milestone;

    // ------------------------------------------------------------------ report links

    /// <summary>A token for <paramref name="target"/>, valid for <see cref="LinkLifetime"/>.</summary>
    public string Link(ReportLinkTarget target) =>
        LinkProtector.Protect(string.Join('|', "1", target.Kind, target.ZedId, target.Level,
            target.Milestone?.ToString(CultureInfo.InvariantCulture) ?? ""), LinkLifetime);

    /// <summary>The page address of a link token on this portal ({PublicBaseUrl}/report/link?t=...).</summary>
    public string PageUrl(ReportLinkTarget target) =>
        portal.Value.PublicBaseUrl.TrimEnd('/') + "/report/link?t=" + Uri.EscapeDataString(Link(target));

    /// <summary>The target of a genuine, unexpired link token, else null.</summary>
    public ReportLinkTarget? ReadLink(string? token)
    {
        if (Unprotect(LinkProtector, token) is not { } payload) return null;
        var parts = payload.Split('|');
        if (parts.Length != 5 || parts[0] != "1" || !IsKind(parts[1]) || !AssessmentInput.IsId(parts[2])) return null;
        int? milestone = parts[4].Length == 0 ? null
            : int.TryParse(parts[4], NumberStyles.None, CultureInfo.InvariantCulture, out var m) && m is >= 1 and <= DocumentLevels.Milestones ? m : -1;
        if (milestone == -1 || (parts[1] == Milestone) != milestone.HasValue) return null;
        return new ReportLinkTarget(parts[1], parts[2], parts[3], milestone);
    }

    // ------------------------------------------------------------------ photos

    /// <summary>A photo of the record (a path <see cref="ReportPhotos.Locate"/> gave): its address on the report page.</summary>
    public string Photo(string recordZedId, string relative) => PhotoUrl("p", recordZedId, relative);

    /// <summary>The static map the old application kept ({system}GoogleMaps/{ZedId}_{Level}.jpg).</summary>
    public string Map(string recordZedId, string relative) => PhotoUrl("m", recordZedId, relative);

    private string PhotoUrl(string type, string recordZedId, string relative) =>
        "/api/report-pages/photo?t=" + Uri.EscapeDataString(PhotoProtector.Protect(string.Join('|', type, recordZedId, relative), PhotoLifetime));

    /// <summary>The file of a genuine photo token, checked again against the record's folder; null otherwise.</summary>
    public string? OpenPhoto(string? token, string storageRoot, Func<string, string?> findStored)
    {
        if (Unprotect(PhotoProtector, token) is not { } payload) return null;
        var parts = payload.Split('|', 3);
        if (parts.Length != 3 || !AssessmentInput.IsId(parts[1])) return null;
        return parts[0] switch
        {
            "p" => ReportPhotos.Open(storageRoot, parts[1], parts[2]),
            "m" when MapPattern().Match(parts[2]) is { Success: true } m &&
                     string.Equals(m.Groups["id"].Value, AssessmentInput.BaseZedId(parts[1]), StringComparison.OrdinalIgnoreCase) => findStored(parts[2]),
            _ => null,
        };
    }

    [GeneratedRegex(@"^(?:(?:Surveillance|Consultancy)/)?GoogleMaps/(?<id>[A-Za-z0-9]{1,50})(?:_[A-Za-z0-9]+)*_[A-Za-z0-9]{2,20}\.jpg$")]
    private static partial Regex MapPattern();

    private static string? Unprotect(ITimeLimitedDataProtector protector, string? token)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Length > MaxToken) return null;
        try
        {
            return protector.Unprotect(token.Trim(), out _);
        }
        catch (CryptographicException)
        {
            // Tampered, expired or from another host's keys.
            return null;
        }
        catch (FormatException)
        {
            return null;
        }
    }
}
