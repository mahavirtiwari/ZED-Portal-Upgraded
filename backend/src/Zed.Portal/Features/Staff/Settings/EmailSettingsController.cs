using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Settings;

/// <summary>
/// Admin → Email Settings (new in V4): the office mailboxes this system's mails go to (<see cref="EmailAddresses"/>), the
/// portal's and the database procedures' (sent by Zed.Jobs). Per system, in its own database (dbo.V4Settings, migration
/// 0011). An empty value goes back to the server configuration, shown as the default.
/// </summary>
[Route("api/staff/settings/email")]
[StaffRoles(UserRole.Admin)]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed class EmailSettingsController(IPortalSettings settings, EmailAddresses addresses, PortalHost host, ILogger<EmailSettingsController> log)
    : StaffApiController
{
    public sealed record EmailSettingItem(string Key, string Label, string Help, bool Database, string? Value, string? Default);

    public sealed record EmailSettingsRequest(Dictionary<string, string?>? Values);

    private IEnumerable<EmailAddressSetting> Mine => EmailAddresses.All.Where(s => s.Systems.Contains(host.System));

    [HttpGet]
    public async Task<IReadOnlyList<EmailSettingItem>> Get(CancellationToken ct)
    {
        var items = new List<EmailSettingItem>();
        foreach (var s in Mine)
            items.Add(new(s.Key, s.Label, s.Help, s.Database, await settings.GetAsync(s.Key, ct), addresses.Default(s.Key)));
        return items;
    }

    [HttpPut]
    public async Task<IActionResult> Save(EmailSettingsRequest req, CancellationToken ct)
    {
        var mine = Mine.ToDictionary(s => s.Key, StringComparer.Ordinal);
        if (req.Values is not { Count: > 0 } values || values.Keys.Any(k => !mine.ContainsKey(k)))
            return this.Problem400("Please enter the e-mail addresses.");

        var changes = new List<(string Key, string? Value)>();
        foreach (var (key, raw) in values)
        {
            var (value, error) = EmailAddresses.Normalise(raw);
            if (error is not null) return this.Problem400($"{mine[key].Label}: {error}");
            if (value != await settings.GetAsync(key, ct)) changes.Add((key, value));
        }
        try
        {
            foreach (var (key, value) in changes)
            {
                await settings.SetAsync(key, value, UserId, ct);
                log.LogInformation("Email setting {Key} {Action} by {UserId}", key, value is null ? "reset to the configuration" : "set", UserId);
            }
        }
        catch (SqlException ex)
        {
            log.LogError(ex, "Could not save the email settings (is migration 0011 applied?)");
            return this.Problem400("The settings could not be saved. Please ask the administrator to apply database migration 0011.");
        }
        return Ok(new MessageResponse("Email settings saved."));
    }
}
