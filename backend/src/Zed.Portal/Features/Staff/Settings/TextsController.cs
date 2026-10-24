using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Zed.Core.Content;
using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Settings;

/// <summary>
/// Admin → Texts (new in V4): the disclaimers, instructions, undertakings and pledges of this system's web pages and
/// mobile apps (<see cref="ContentCatalogue"/>): hide one, or give it the Admin's own HTML text with its {{Fields}}.
/// Saved per system's database (dbo.V4ContentBlocks, migration 0016). Reset goes back to the standard text.
/// </summary>
[Route("api/staff/settings/texts")]
[StaffRoles(UserRole.Admin)]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed partial class TextsController(IContentBlockStore store, PortalHost host, ILogger<TextsController> log) : StaffApiController
{
    public sealed record TextItem(string Key, string Name, string Group, string Channel, bool Enabled, bool Customised,
        IReadOnlyList<string> Placeholders, string? UpdatedBy, DateTime? UpdatedOn);

    public sealed record TextDetails(TextItem Item, string BodyHtml, string StandardHtml);

    public sealed record TextRequest(bool Enabled, string? BodyHtml);

    [HttpGet]
    public async Task<IReadOnlyList<TextItem>> List(CancellationToken ct)
    {
        var saved = await store.AllAsync(ct);
        return ContentCatalogue.For(host.System).Select(b => Item(b, saved.GetValueOrDefault(b.Key))).ToList();
    }

    [HttpGet("{key}")]
    public async Task<ActionResult<TextDetails>> Get(string key, CancellationToken ct)
    {
        if (ContentCatalogue.Find(host.System, key) is not { } b) return NotFound();
        var saved = (await store.AllAsync(ct)).GetValueOrDefault(b.Key);
        return new TextDetails(Item(b, saved), saved?.BodyHtml is { Length: > 0 } html ? html : b.DefaultHtml, b.DefaultHtml);
    }

    [HttpPut("{key}")]
    public async Task<ActionResult<MessageResponse>> Save(string key, TextRequest req, CancellationToken ct)
    {
        if (ContentCatalogue.Find(host.System, key) is not { } b) return NotFound();
        if (req.BodyHtml is { Length: > 100_000 }) return this.Problem400("The text is too long.");
        if (ContentTexts.UnknownPlaceholders(b, req.BodyHtml).FirstOrDefault() is { } unknown)
            return this.Problem400($"{{{{{unknown}}}}} is not a field of this text.");
        if (req.BodyHtml is { } body && ScriptPattern().IsMatch(body)) return this.Problem400("Scripts are not allowed in texts.");

        // The standard text as it was offered is not stored: only a changed text is.
        var bodyToSave = string.IsNullOrWhiteSpace(req.BodyHtml) || req.BodyHtml.Trim() == b.DefaultHtml.Trim() ? null : req.BodyHtml;
        await store.SaveAsync(b.Key, req.Enabled, bodyToSave, UserId, ct);
        log.LogInformation("Text {Key} saved by {UserId}: shown {Enabled}, own text {Body}", b.Key, UserId, req.Enabled, bodyToSave is not null);
        return new MessageResponse(req.Enabled ? "Text saved." : "Text saved. It is not shown.");
    }

    [HttpDelete("{key}")]
    public async Task<ActionResult<MessageResponse>> Reset(string key, CancellationToken ct)
    {
        if (ContentCatalogue.Find(host.System, key) is not { } b) return NotFound();
        try
        {
            await store.ResetAsync(b.Key, ct);
        }
        catch (SqlException ex)
        {
            log.LogError(ex, "Could not reset the text {Key} (is migration 0016 applied?)", b.Key);
            return this.Problem400("The text could not be reset. Please ask the administrator to apply database migration 0016.");
        }
        log.LogInformation("Text {Key} reset to the standard text by {UserId}", b.Key, UserId);
        return new MessageResponse("The standard text is shown again.");
    }

    private static TextItem Item(ContentBlock b, ContentBlockOverride? saved) =>
        new(b.Key, b.Name, b.Group, b.Channel == ContentChannel.App ? "Mobile app" : "Website", saved?.Enabled ?? true, saved is not null,
            b.Placeholders, saved?.UpdatedBy, saved?.UpdatedOn);

    [GeneratedRegex(@"<\s*(script|iframe|object|embed)|javascript:|\son[a-z]+\s*=", RegexOptions.IgnoreCase)] private static partial Regex ScriptPattern();
}
