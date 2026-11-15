using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Maintenance;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.Masters;

namespace Zed.Portal.Features.Staff.Settings;

/// <summary>
/// 2026-11-15 (the user, design approved): Admin → Settings → Branding, on the main portal only: the logos of each portal
/// and app (<see cref="Branding"/>), and its colour theme. A logo is checked (PNG or JPG by extension, type and signature,
/// up to 1 MB), stored under a server-made name, and used at once; Reset goes back to today's logo.
/// </summary>
[Route("api/staff/settings/branding")]
[StaffRoles(UserRole.Admin)]
[PortalSystems(PortalSystem.Main)]
public sealed class BrandingController(
    IPortalSettings settings, IOptions<PortalOptions> portal, IWebHostEnvironment env, ILogger<BrandingController> log) : StaffApiController
{
    public sealed record LogoView(string Slot, string Label, string Hint, string? Url);

    public sealed record TargetView(string Key, string Name, bool IsApp, string Theme, IReadOnlyList<LogoView> Logos);

    public sealed record BrandingView(IReadOnlyList<TargetView> Targets, IReadOnlyList<Branding.Theme> Themes);

    public sealed record ThemeRequest(string? Theme);

    private static readonly MasterUploads.FileType[] LogoTypes =
        MasterUploads.DocumentTypes.Where(t => t.Extension is ".png" or ".jpg").ToArray();

    [HttpGet]
    public async Task<BrandingView> Get(CancellationToken ct)
    {
        var targets = new List<TargetView>();
        foreach (var (key, name) in MaintenanceTargets.All)
        {
            var logos = new List<LogoView>();
            foreach (var slot in Branding.SlotsOf(key))
            {
                var file = await settings.GetAsync(Branding.Key(key, slot.Key), ct);
                logos.Add(new LogoView(slot.Key, slot.Label, slot.Hint,
                    Branding.FileOf(file, portal.Value, env) is not null ? Request.PathBase + BrandingFilesController.Path + file : null));
            }
            targets.Add(new TargetView(key, name, key.StartsWith("app-", StringComparison.Ordinal),
                Branding.ThemeOf(await settings.GetAsync(Branding.Key(key, "Theme"), ct)).Key, logos));
        }
        return new BrandingView(targets, Branding.Themes);
    }

    [HttpPost("{target}/logos/{slot}")]
    [RequestSizeLimit(Branding.MaxBytes + 64 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = Branding.MaxBytes + 64 * 1024)]
    public async Task<IActionResult> Upload(string target, string slot, IFormFile? file, CancellationToken ct)
    {
        if (!Known(target, slot)) return this.Problem400("Unknown portal, app or logo.");
        var (type, error) = await MasterUploads.CheckAsync(file, LogoTypes, Branding.MaxBytes, ct);
        if (error is not null) return this.Problem400(error);
        var name = MasterUploads.NewFileName($"Branding_{target}_{slot}", type!.Extension);
        try
        {
            await MasterUploads.SaveAsync(file!, Path.GetDirectoryName(Branding.StorageFolder(portal.Value, env))!, Branding.Folder, name, ct);
            await settings.SetAsync(Branding.Key(target, slot), name, UserId, ct);
        }
        catch (SqlException ex)
        {
            log.LogError(ex, "Could not save the logo setting");
            return this.Problem400("The logo could not be saved. Please try again.");
        }
        log.LogWarning("Branding: {Target} {Slot} logo {File} saved by {Actor}", target, slot, name, UserId);
        return Ok(new MessageResponse("Logo saved. The pages show it from their next opening."));
    }

    [HttpDelete("{target}/logos/{slot}")]
    public async Task<IActionResult> Reset(string target, string slot, CancellationToken ct)
    {
        if (!Known(target, slot)) return this.Problem400("Unknown portal, app or logo.");
        await settings.SetAsync(Branding.Key(target, slot), null, UserId, ct);
        log.LogWarning("Branding: {Target} {Slot} logo reset by {Actor}", target, slot, UserId);
        return Ok(new MessageResponse("Today's logo is used again."));
    }

    [HttpPut("{target}/theme")]
    public async Task<IActionResult> SaveTheme(string target, ThemeRequest req, CancellationToken ct)
    {
        if (!MaintenanceTargets.IsKnown(target)) return this.Problem400("Unknown portal or app.");
        if (Branding.Themes.All(t => t.Key != req.Theme)) return this.Problem400("Please choose one of the colour themes.");
        await settings.SetAsync(Branding.Key(target, "Theme"), req.Theme == Branding.DefaultTheme ? null : req.Theme, UserId, ct);
        log.LogWarning("Branding: {Target} theme {Theme} set by {Actor}", target, req.Theme, UserId);
        return Ok(new MessageResponse("Colour theme saved. The pages use it from their next opening."));
    }

    private static bool Known(string target, string slot) =>
        MaintenanceTargets.IsKnown(target) && Branding.SlotsOf(target).Any(s => s.Key == slot);
}

/// <summary>
/// 2026-11-15: the branding of this portal for its pages, of an app for the app, and the logo files. Read from main's
/// settings (<see cref="IMainSettings"/>), so every portal shows what the Admin set on the main portal.
/// </summary>
[ApiController]
[AllowAnonymous]
[AllowDuringMaintenance]
[Route("api/public/branding")]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed class BrandingFilesController(IMainSettings settings, PortalHost host, IOptions<PortalOptions> portal, IWebHostEnvironment env) : ControllerBase
{
    public const string Path = "/api/public/branding/file/";

    public sealed record ThemeColours(string Key, string Dark, string Mid, string Accent);

    public sealed record PortalBranding(ThemeColours Theme, IReadOnlyDictionary<string, string> Logos);

    public sealed record AppBranding(ThemeColours Theme, string? LogoUrl);

    /// <summary>This portal's theme and its saved logos (slot → address); a slot not listed keeps today's logo.</summary>
    [HttpGet]
    public async Task<PortalBranding> Get(CancellationToken ct)
    {
        var target = MaintenanceTargets.Of(host.System);
        var logos = new Dictionary<string, string>();
        foreach (var slot in Branding.WebSlots)
            if (await settings.GetAsync(Branding.Key(target, slot.Key), ct) is { } name && Branding.FileOf(name, portal.Value, env) is not null)
                logos[slot.Key] = Request.PathBase + Path + name;
        Response.Headers.CacheControl = "no-cache";
        return new PortalBranding(await ColoursAsync(target, ct), logos);
    }

    /// <summary>An app's theme colours and logo (an absolute address), for the app at its start.</summary>
    [HttpGet("app/{app}")]
    public async Task<ActionResult<AppBranding>> App(string app, CancellationToken ct)
    {
        var target = app.StartsWith("app-", StringComparison.Ordinal) ? app : "app-" + app;
        if (!MaintenanceTargets.IsKnown(target) || !target.StartsWith("app-", StringComparison.Ordinal)) return NotFound();
        var name = await settings.GetAsync(Branding.Key(target, "app-logo"), ct);
        var url = Branding.FileOf(name, portal.Value, env) is not null ? portal.Value.PublicBaseUrl.TrimEnd('/') + Path + name : null;
        Response.Headers.CacheControl = "no-cache";
        return new AppBranding(await ColoursAsync(target, ct), url);
    }

    [HttpGet("file/{name}")]
    public IActionResult File(string name)
    {
        if (Branding.FileOf(name, portal.Value, env) is not { } file) return NotFound();
        Response.Headers[HeaderNames.CacheControl] = "public, max-age=86400, immutable";   // a new logo gets a new name
        return PhysicalFile(file, Branding.ContentType(name));
    }

    private async Task<ThemeColours> ColoursAsync(string target, CancellationToken ct)
    {
        var t = Branding.ThemeOf(await settings.GetAsync(Branding.Key(target, "Theme"), ct));
        return new ThemeColours(t.Key, t.Dark, t.Mid, t.Accent);
    }
}
