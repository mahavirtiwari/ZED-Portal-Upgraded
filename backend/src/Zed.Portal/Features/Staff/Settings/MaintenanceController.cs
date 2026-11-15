using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Maintenance;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Settings;

/// <summary>
/// 2026-11-15 (the user, design approved): Admin → Settings → Maintenance mode, on the main portal only. For each portal
/// and app: Up / Down, the message shown, and an optional window (down from its start to its end, by itself). Saved in
/// main's dbo.V4Settings (<see cref="MaintenanceState"/>); the other portals and the app API read it within half a minute.
/// </summary>
[Route("api/staff/settings/maintenance")]
[StaffRoles(UserRole.Admin)]
[PortalSystems(PortalSystem.Main)]
public sealed partial class MaintenanceController(IPortalSettings settings, MaintenanceState state, ILogger<MaintenanceController> log) : StaffApiController
{
    public sealed record MaintenanceRow(string Key, string Name, bool Down, string? Message, string? From, string? Until, bool DownNow, string DefaultMessage);

    public sealed record MaintenanceRequest(string Key, bool Down, string? Message, string? From, string? Until);

    [GeneratedRegex(@"^[^<>]{1,300}$")] private static partial Regex MessagePattern();

    [HttpGet]
    public async Task<IReadOnlyList<MaintenanceRow>> List(CancellationToken ct)
    {
        var now = DateTime.Now;
        return (await state.AllAsync(ct)).Select(e => new MaintenanceRow(e.Target, MaintenanceTargets.All.First(t => t.Key == e.Target).Name,
            e.Down, e.Message, e.From?.ToString(MaintenanceEntry.TimeFormat), e.Until?.ToString(MaintenanceEntry.TimeFormat), e.IsDownAt(now),
            (e with { Message = null }).MessageText)).ToList();
    }

    [HttpPut]
    public async Task<IActionResult> Save(IReadOnlyList<MaintenanceRequest> rows, CancellationToken ct)
    {
        var values = new List<(string Key, string? Value)>();
        foreach (var row in rows ?? [])
        {
            if (!MaintenanceTargets.IsKnown(row.Key)) return this.Problem400("Unknown portal or app.");
            var name = MaintenanceTargets.All.First(t => t.Key == row.Key).Name;
            var message = string.IsNullOrWhiteSpace(row.Message) ? null : row.Message.Trim();
            if (message is not null && !MessagePattern().IsMatch(message)) return this.Problem400($"{name}: the message must be up to 300 characters, without < or >.");
            var from = Time(row.From, out var badFrom);
            var until = Time(row.Until, out var badUntil);
            if (badFrom || badUntil) return this.Problem400($"{name}: please enter the window's times as date and time.");
            if (from is not null && until is null) return this.Problem400($"{name}: please enter when the window ends.");
            if (from is not null && until <= from) return this.Problem400($"{name}: the window must end after it starts.");
            values.Add((MaintenanceTargets.Key(row.Key, "Down"), row.Down ? "true" : null));
            values.Add((MaintenanceTargets.Key(row.Key, "Message"), message));
            values.Add((MaintenanceTargets.Key(row.Key, "From"), from?.ToString(MaintenanceEntry.TimeFormat)));
            values.Add((MaintenanceTargets.Key(row.Key, "Until"), until?.ToString(MaintenanceEntry.TimeFormat)));
        }
        try
        {
            foreach (var (key, value) in values) await settings.SetAsync(key, value, UserId, ct);
        }
        catch (SqlException ex)
        {
            log.LogError(ex, "Could not save the maintenance settings");
            return this.Problem400("The settings could not be saved. Please try again.");
        }
        log.LogWarning("Maintenance set by {Actor}: {Down}", UserId,
            string.Join(", ", (rows ?? []).Select(r => $"{r.Key} {(r.Down ? "down" : "up")}{(r.From is { Length: > 0 } ? $" window {r.From}-{r.Until}" : "")}")));
        return Ok(new MessageResponse("Maintenance saved. The portals and apps follow it within half a minute."));
    }

    private static DateTime? Time(string? value, out bool bad)
    {
        bad = false;
        if (string.IsNullOrWhiteSpace(value)) return null;
        var t = value.Trim();
        if (t.Length > 16) t = t[..16];   // a browser may send seconds
        var parsed = MaintenanceEntry.ParseTime(t);
        bad = parsed is null;
        return parsed;
    }
}

/// <summary>2026-11-15: whether this portal is down (its pages show the maintenance page). Answers while it is down.</summary>
[ApiController]
[AllowAnonymous]
[AllowDuringMaintenance]
[Route("api/public/maintenance")]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed class MaintenanceStatusController(MaintenanceState state, PortalHost host) : ControllerBase
{
    public sealed record MaintenanceStatus(bool Down, string? Message, string? Until);

    [HttpGet]
    public async Task<MaintenanceStatus> Get(CancellationToken ct)
    {
        var e = await state.GetAsync(MaintenanceTargets.Of(host.System), ct);
        Response.Headers.CacheControl = "no-store";
        return e.IsDownAt(DateTime.Now)
            ? new MaintenanceStatus(true, e.MessageText, e.Until?.ToString(MaintenanceEntry.TimeFormat))
            : new MaintenanceStatus(false, null, null);
    }
}
