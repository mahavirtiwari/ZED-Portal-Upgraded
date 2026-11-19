using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Zed.Core.Http;

namespace Zed.Core.Maintenance;

/// <summary>
/// 2026-11-15 (the user, design approved): Admin → Settings → Branding. The logos of each portal and app, and its colour
/// theme (one of <see cref="Themes"/>). Kept in main's dbo.V4Settings (<c>Branding.{target}.{slot}</c> = the stored file's
/// name, <c>Branding.{target}.Theme</c>); the files in the shared storage folder <c>Branding</c>. No value = today's logo
/// and colours. Targets are those of <see cref="MaintenanceTargets"/>.
/// </summary>
public static partial class Branding
{
    public sealed record Slot(string Key, string Label, string Hint);

    /// <summary>The logos of a web portal.</summary>
    public static readonly IReadOnlyList<Slot> WebSlots =
    [
        new("header-left", "Header: Ministry logo (left)", "The menu pages' top bar, left."),
        new("header-right", "Header: ZED logo (right)", "The menu pages' top bar, right."),
        new("login-left", "Sign-in page: left logo", "The sign-in and registration pages."),
        new("login-right", "Sign-in page: right logo", "The sign-in and registration pages."),
        new("footer", "Footer logo", "The bottom bar of the pages."),
        new("email", "E-mail header logo", "The top of every e-mail of this portal."),
        new("favicon", "Browser tab icon", "Square, 32 × 32 or 64 × 64 pixels."),
    ];

    /// <summary>The logo of an app (its sign-in and home screens).</summary>
    public static readonly IReadOnlyList<Slot> AppSlots = [new("app-logo", "App logo", "The app's sign-in and home screens, from its next start.")];

    public static IReadOnlyList<Slot> SlotsOf(string target) => target.StartsWith("app-", StringComparison.Ordinal) ? AppSlots : WebSlots;

    public sealed record Theme(string Key, string Name, string Dark, string Mid, string Accent);

    public const string DefaultTheme = "teal";

    public static readonly IReadOnlyList<Theme> Themes =
    [
        // 2026-11-19 (admin audit): no "(today)" in the name; the Branding page marks the theme saved for a portal or app as current.
        new(DefaultTheme, "ZED Teal", "#23656b", "#45a5ad", "#c9e8a0"),
        new("navy", "Navy", "#1f3b73", "#3c6fc4", "#f2c14e"),
        new("forest", "Forest", "#1e5e3a", "#3f9a63", "#e8d48a"),
        new("maroon", "Maroon", "#6b1f2a", "#a8424f", "#f0c9a0"),
        new("slate", "Slate", "#3a3f47", "#6c7684", "#ffb347"),
    ];

    public static Theme ThemeOf(string? key) => Themes.FirstOrDefault(t => t.Key == key) ?? Themes[0];

    public static string Key(string target, string part) => $"Branding.{target}.{part}";

    public const string Folder = "Branding";
    public const long MaxBytes = 1024 * 1024;

    /// <summary>A stored logo's name (server-made: Branding_{target}_{slot}_{time}_{random}.png|.jpg).</summary>
    [GeneratedRegex(@"^Branding_[a-z-]{3,20}_[a-z-]{3,20}_\d{14}_[0-9a-f]{8}\.(png|jpg)$")]
    public static partial Regex FileNamePattern();

    public static string StorageFolder(PortalOptions portal, IWebHostEnvironment env) =>
        Path.Combine(Path.GetFullPath(Path.Combine(env.ContentRootPath, portal.StorageRoot)), Folder);

    /// <summary>The stored file of a name, or null when the name is not one of ours or the file is gone.</summary>
    public static string? FileOf(string? name, PortalOptions portal, IWebHostEnvironment env)
    {
        if (name is null || !FileNamePattern().IsMatch(name)) return null;
        var full = Path.Combine(StorageFolder(portal, env), name);
        return File.Exists(full) ? full : null;
    }

    public static string ContentType(string name) => name.EndsWith(".png", StringComparison.OrdinalIgnoreCase) ? "image/png" : "image/jpeg";

    /// <summary>
    /// The e-mails show <c>{PublicBaseUrl}/Images/header/zed-logo.png</c>: with an e-mail logo saved for this portal, that
    /// address answers with it. The pages ask for the same file with <c>?ui=1</c> (their own header logo), which stays.
    /// </summary>
    public static IApplicationBuilder UseZedBrandedEmailLogo(this IApplicationBuilder app) => app.Use(async (context, next) =>
    {
        if (HttpMethods.IsGet(context.Request.Method)
            && context.Request.Path.Equals("/Images/header/zed-logo.png", StringComparison.OrdinalIgnoreCase)
            && !context.Request.Query.ContainsKey("ui")
            && context.RequestServices.GetService<PortalHost>() is { } host
            && context.RequestServices.GetService<IMainSettings>() is { } settings)
        {
            var name = await settings.GetAsync(Key(MaintenanceTargets.Of(host.System), "email"), context.RequestAborted);
            var portal = context.RequestServices.GetRequiredService<IOptions<PortalOptions>>().Value;
            if (FileOf(name, portal, context.RequestServices.GetRequiredService<IWebHostEnvironment>()) is { } file)
            {
                context.Response.ContentType = ContentType(file);
                context.Response.Headers.CacheControl = "public, max-age=3600";
                await context.Response.SendFileAsync(file, context.RequestAborted);
                return;
            }
        }
        await next();
    });
}
