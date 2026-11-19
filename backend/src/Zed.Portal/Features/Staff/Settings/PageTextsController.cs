using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Zed.Core.Content;
using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Settings;

/// <summary>
/// Admin → Texts → Page wording (2026-11-19, the user: "All page wording"): every heading, line, button, label, placeholder,
/// empty-state and message of this system's web pages (<see cref="PageTextCatalogue"/>, listed even before anyone changes
/// one), with the Admin's own wording or the standard one. Plain text with the wording's {values}; saved per system's
/// database where the Admin's Texts are (dbo.V4ContentBlocks, migration 0016), shown through api/content. Saving the
/// standard wording, or Reset, removes the Admin's.
/// </summary>
[Route("api/staff/settings/page-texts")]
[StaffRoles(UserRole.Admin)]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed class PageTextsController(IContentBlockStore store, PortalHost host, ILogger<PageTextsController> log) : StaffApiController
{
    /// <summary>A wording: the standard one, the Admin's (null: the standard one shows), and who changed it last and when (UTC).</summary>
    public sealed record PageTextItem(string Key, string Portal, string Page, string PageName, string Kind, string Standard, string? Text,
        IReadOnlyList<string> Placeholders, int MaxLength, string? UpdatedBy, DateTime? UpdatedOn);

    public sealed record PageTextRequest(string? Text);

    [HttpGet]
    public async Task<IReadOnlyList<PageTextItem>> List(CancellationToken ct)
    {
        var saved = await store.AllAsync(ct);
        return PageTextCatalogue.For(host.System).Select(t => Item(t, saved.GetValueOrDefault(t.Key))).ToList();
    }

    [HttpPut("{key}")]
    public async Task<ActionResult<PageTextItem>> Save(string key, PageTextRequest req, CancellationToken ct)
    {
        if (PageTextCatalogue.Find(host.System, key) is not { } t) return NotFound();
        if (req.Text is { Length: > 10_000 }) return this.Problem400("The wording is too long.");
        var text = PageTextCatalogue.Clean(req.Text);
        // The standard wording is not stored: saving it shows the standard wording again (and later changes to it).
        if (text == t.Standard) return await Reset(key, ct);
        if (PageTextCatalogue.Problem(t, text) is { } problem) return this.Problem400(problem);
        try
        {
            await store.SaveAsync(t.Key, true, text, UserId, ct);
        }
        catch (SqlException ex)
        {
            log.LogError(ex, "Could not save the page wording {Key} (is migration 0016 applied?)", t.Key);
            return this.Problem400("The wording could not be saved. Please ask the administrator to apply database migration 0016.");
        }
        log.LogInformation("Page wording {Key} changed by {UserId}", t.Key, UserId);
        return Item(t, new ContentBlockOverride(t.Key, true, text, UserId, DateTime.UtcNow));
    }

    [HttpDelete("{key}")]
    public async Task<ActionResult<PageTextItem>> Reset(string key, CancellationToken ct)
    {
        if (PageTextCatalogue.Find(host.System, key) is not { } t) return NotFound();
        try
        {
            await store.ResetAsync(t.Key, ct);
        }
        catch (SqlException ex)
        {
            log.LogError(ex, "Could not reset the page wording {Key} (is migration 0016 applied?)", t.Key);
            return this.Problem400("The wording could not be reset. Please ask the administrator to apply database migration 0016.");
        }
        log.LogInformation("Page wording {Key} reset to the standard wording by {UserId}", t.Key, UserId);
        return Item(t, null);
    }

    private static PageTextItem Item(PageText t, ContentBlockOverride? saved)
    {
        var own = saved is { Enabled: true, BodyHtml: { Length: > 0 } body } ? body : null;
        // Saved with SYSUTCDATETIME(): sent as UTC so that the page shows the Admin's local time.
        var on = own is null || saved?.UpdatedOn is not { } d ? (DateTime?)null : DateTime.SpecifyKind(d, DateTimeKind.Utc);
        return new(t.Key, t.Portal, t.Page, t.PageName, t.Kind, t.Standard, own, t.Placeholders, PageTextCatalogue.MaxLength(t),
            own is null ? null : saved!.UpdatedBy, on);
    }
}
