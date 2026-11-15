using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.Extensions.DependencyInjection;
using Zed.Core.Data;
using Zed.Core.Http;
using System.Reflection;
using Zed.Core.Maintenance;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>2026-11-15: Admin → Settings → Maintenance mode, and the portals and apps that are down.</summary>
public sealed class MaintenanceTests : IDisposable
{
    private const string SettingsQuery = "SELECT SettingKey, SettingValue FROM dbo.V4Settings";
    private readonly TestHost _host = new();

    public MaintenanceTests() => UsersMastersLogin.Setup(_host);

    public void Dispose() => _host.Dispose();

    private async Task StoredAsync(params (string Key, string Value)[] rows)
    {
        _host.Sql.Queries[SettingsQuery] = _ => rows.Select(r => new { SettingKey = r.Key, SettingValue = r.Value }).ToArray();
        await _host.Services.GetRequiredService<IPortalSettings>().SetAsync("Test.Unused", null, "TEST");   // empties the cache
    }

    private IReadOnlyList<(string Key, string? Value)> Merges() =>
        _host.Sql.Calls.Where(c => c.Name.StartsWith("MERGE dbo.V4Settings", StringComparison.Ordinal))
            .Select(c => (FakeSql.Arg(c.Args, "SettingKey")!, FakeSql.Arg(c.Args, "SettingValue"))).ToList();

    [Fact]
    public async Task The_admin_lists_every_portal_and_app_and_saves_a_window()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var rows = JsonDocument.Parse(await admin.GetStringAsync("/api/staff/settings/maintenance")).RootElement;
        Assert.Equal(6, rows.GetArrayLength());
        Assert.Equal("app-consultant", rows[5].GetProperty("key").GetString());
        Assert.False(rows[0].GetProperty("downNow").GetBoolean());

        const string Url = "/api/staff/settings/maintenance";
        Assert.Equal("Consultancy portal: please enter when the window ends.",
            await (await admin.PutAsJsonAsync(Url, new[] { new { key = "consultancy", down = false, from = "2026-11-20T14:00" } })).ProblemTitle());
        Assert.Equal("Consultancy portal: the window must end after it starts.",
            await (await admin.PutAsJsonAsync(Url, new[] { new { key = "consultancy", down = false, from = "2026-11-20T14:00", until = "2026-11-20T13:00" } })).ProblemTitle());
        Assert.Equal("Consultancy portal: the message must be up to 300 characters, without < or >.",
            await (await admin.PutAsJsonAsync(Url, new[] { new { key = "consultancy", down = true, message = "<b>x</b>" } })).ProblemTitle());
        Assert.Empty(Merges());

        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync(Url, new[]
        {
            new { key = "consultancy", down = false, message = "Upgrade. Back by 6 pm.", from = "2026-11-20T14:00", until = "2026-11-20T18:00:00" },
            new { key = "app-msme", down = true, message = "", from = "", until = "" },
        })).StatusCode);
        var merges = Merges();
        Assert.Contains(("Maintenance.consultancy.Message", "Upgrade. Back by 6 pm."), merges);
        Assert.Contains(("Maintenance.consultancy.Until", "2026-11-20T18:00"), merges);
        Assert.Contains(("Maintenance.app-msme.Down", "true"), merges);
    }

    [Fact]
    public async Task A_down_portal_answers_with_its_message_but_the_admin_and_the_sign_in_pass()
    {
        var anon = _host.CreateClient();
        Assert.False(JsonDocument.Parse(await anon.GetStringAsync("/api/public/maintenance")).RootElement.GetProperty("down").GetBoolean());

        await StoredAsync(("Maintenance.main.Down", "true"), ("Maintenance.main.Message", "Back at 6 pm."));
        var status = JsonDocument.Parse(await anon.GetStringAsync("/api/public/maintenance")).RootElement;
        Assert.True(status.GetProperty("down").GetBoolean());
        Assert.Equal("Back at 6 pm.", status.GetProperty("message").GetString());

        var refused = await anon.GetAsync("/api/public/levels");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, refused.StatusCode);
        Assert.Equal("Back at 6 pm.", await refused.ProblemTitle());
        Assert.Equal(HttpStatusCode.OK, (await anon.GetAsync("/api/config")).StatusCode);

        // The Admin signs in and works; another staff login signs in but is refused.
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync("/api/staff/settings/maintenance")).StatusCode);
        var agency = await UsersMastersLogin.SignInAsync(_host, "AGENCY1");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await agency.GetAsync("/api/public/levels")).StatusCode);
    }

    [Fact]
    public async Task A_window_takes_the_portal_down_only_inside_it()
    {
        var now = DateTime.Now;
        string T(DateTime t) => t.ToString(MaintenanceEntry.TimeFormat);
        await StoredAsync(("Maintenance.main.From", T(now.AddHours(1))), ("Maintenance.main.Until", T(now.AddHours(2))));
        Assert.Equal(HttpStatusCode.OK, (await _host.CreateClient().GetAsync("/api/public/levels")).StatusCode);
        await StoredAsync(("Maintenance.main.From", T(now.AddHours(-1))), ("Maintenance.main.Until", T(now.AddHours(1))));
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await _host.CreateClient().GetAsync("/api/public/levels")).StatusCode);
        // Switched down with an end: up again after it.
        await StoredAsync(("Maintenance.main.Down", "true"), ("Maintenance.main.Until", T(now.AddMinutes(-5))));
        Assert.Equal(HttpStatusCode.OK, (await _host.CreateClient().GetAsync("/api/public/levels")).StatusCode);
    }

    [Fact]
    public async Task A_down_app_gets_the_apps_failure_body_with_the_message_while_the_portal_works()
    {
        await StoredAsync(("Maintenance.app-msme.Down", "true"));
        var r = await _host.CreateClient().GetAsync("/Msme/AppCertificationStatus?certification=silver");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var body = JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal(MaintenanceEntry.DefaultAppMessage, body.GetProperty("errorMessage").GetString());
        Assert.Equal(HttpStatusCode.OK, (await _host.CreateClient().GetAsync("/api/public/levels")).StatusCode);
    }

    [Theory]
    [InlineData("MsmeAppStatus", true, PortalSystem.Main, MaintenanceTargets.MsmeApp)]
    [InlineData("AssessorApp", true, PortalSystem.Main, MaintenanceTargets.AssessorApp)]
    [InlineData("SA", true, PortalSystem.Surveillance, MaintenanceTargets.AssessorApp)]
    [InlineData("ConsultancySA", true, PortalSystem.Consultancy, MaintenanceTargets.ConsultantApp)]
    [InlineData("Content", true, PortalSystem.Consultancy, MaintenanceTargets.ConsultantApp)]
    [InlineData("Content", true, PortalSystem.Main, null)]
    [InlineData("Fees", false, PortalSystem.Surveillance, MaintenanceTargets.Surveillance)]
    public void Each_call_belongs_to_its_portal_or_app(string controller, bool app, PortalSystem system, string? target)
    {
        var action = new ControllerActionDescriptor
        {
            ControllerName = controller,
            ControllerTypeInfo = (app ? typeof(Zed.Portal.Features.Msme.MsmeAppStatusController) : typeof(MaintenanceStatusControllerProbe)).Assembly
                .GetType(app ? typeof(Zed.Portal.Features.Msme.MsmeAppStatusController).FullName! : typeof(MaintenanceStatusControllerProbe).FullName!)!
                .GetTypeInfo(),
        };
        Assert.Equal(target, MaintenanceFilter.Target(action, system));
    }

    private sealed class MaintenanceStatusControllerProbe;
}
