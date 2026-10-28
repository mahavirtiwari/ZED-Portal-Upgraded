using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Portal.Features.ExternalApi;
using Zed.Portal.Features.Staff.Settings;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>Administration → API Integrations: the partners, their access and the Enable / Disable switches.</summary>
public sealed class ApiIntegrationsTests : IDisposable
{
    private const string Url = "/api/staff/settings/integrations";
    private readonly TestHost _host = new();

    public ApiIntegrationsTests()
    {
        UsersMastersLogin.Setup(_host);
        _host.Sql.Queries["SELECT c.Id, c.Client, c.ClientId"] = _ =>
        [
            new ApiIntegrationsController.ClientRow(1, "RAMP", "4947838", new DateTime(2024, 1, 5), null, false, true, new DateTime(2026, 10, 20)),
            new ApiIntegrationsController.ClientRow(2, "Saathi", null, null, "https://saathi.example", null, false, null, IsEnabled: false, UpdatedBy: "ADMIN1"),
            new ApiIntegrationsController.ClientRow(3, " ", "STATE01", null, null, true, false, null),
        ];
    }

    public void Dispose() => _host.Dispose();

    private List<(string Name, object? Args)> SettingWrites() =>
        _host.Sql.Calls.Where(c => c.Name.StartsWith("MERGE dbo.V4Settings") || c.Name.StartsWith("DELETE FROM dbo.V4Settings")).ToList();

    [Fact]
    public async Task Only_the_admin_sees_and_switches_the_integrations()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await (await _host.CreateBrowserAsync()).GetAsync($"{Url}/clients")).StatusCode);
        foreach (var user in new[] { "MASTER1", "SUPER1" })
        {
            var other = await UsersMastersLogin.SignInAsync(_host, user);
            Assert.Equal(HttpStatusCode.Forbidden, (await other.GetAsync($"{Url}/clients")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await other.PutAsJsonAsync($"{Url}/clients/1", new { enabled = false })).StatusCode);
        }
        Assert.Empty(SettingWrites());
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == ApiIntegrationsController.SwitchSql);
    }

    [Fact]
    public async Task Lists_the_clients_with_their_access_and_no_secrets()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var r = await admin.GetAsync($"{Url}/clients");
        var raw = await r.Content.ReadAsStringAsync();
        Assert.DoesNotContain("\"token\"", raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("aesKey", raw, StringComparison.OrdinalIgnoreCase);
        var items = JsonDocument.Parse(raw).RootElement.EnumerateArray().ToList();
        Assert.Equal(["RAMP", "Saathi", "Client #3"], items.Select(i => i.GetProperty("name").GetString()));
        Assert.Contains("Encrypted lists (RAMP dashboard)", items[0].GetProperty("access").EnumerateArray().Select(a => a.GetString()));
        Assert.Contains("Certificate lookups (static token)", items[1].GetProperty("access").EnumerateArray().Select(a => a.GetString()));
        Assert.Contains("Incentive submission", items[2].GetProperty("access").EnumerateArray().Select(a => a.GetString()));
        Assert.Equal([true, false, true], items.Select(i => i.GetProperty("enabled").GetBoolean()));
        Assert.Equal([false, false, true], items.Select(i => i.GetProperty("maySubmitIncentives").GetBoolean()));
    }

    [Fact]
    public async Task Disabling_and_enabling_a_client_writes_its_column_and_an_api_group_the_settings()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"{Url}/clients/2", new { enabled = false })).StatusCode);
        var off = Assert.Single(_host.Sql.Calls, c => c.Name == ApiIntegrationsController.SwitchSql);
        Assert.Equal(("2", "False", "ADMIN1"), (FakeSql.Arg(off.Args, "Id"), FakeSql.Arg(off.Args, "Enabled"), FakeSql.Arg(off.Args, "UpdatedBy")));
        var on = await admin.PutAsJsonAsync($"{Url}/clients/2", new { enabled = true });
        Assert.Contains("Saathi is enabled", await on.Content.ReadAsStringAsync());
        Assert.Equal("True", FakeSql.Arg(_host.Sql.Calls.Last(c => c.Name == ApiIntegrationsController.SwitchSql).Args, "Enabled"));
        Assert.Empty(SettingWrites());
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PutAsJsonAsync($"{Url}/clients/99", new { enabled = false })).StatusCode);

        var groups = await admin.GetFromJsonAsync<JsonElement>($"{Url}/groups");
        Assert.Equal(PartnerApiGroups.All.Count, groups.GetArrayLength());
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"{Url}/groups/{PartnerApiGroups.Incentives}", new { enabled = false })).StatusCode);
        Assert.Equal(PartnerApiGroups.EnabledKey(PartnerApiGroups.Incentives), FakeSql.Arg(SettingWrites()[^1].Args, "SettingKey"));
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PutAsJsonAsync($"{Url}/groups/nope", new { enabled = false })).StatusCode);

        var outbound = await admin.GetFromJsonAsync<JsonElement>($"{Url}/outbound");
        Assert.Contains(outbound.EnumerateArray(), o => o.GetProperty("name").GetString() == "CCAvenue payment gateway" && o.GetProperty("inV4").GetBoolean());
    }

    [Fact]
    public async Task The_admin_edits_a_partner_but_not_its_client_id_or_key()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        Assert.Equal(HttpStatusCode.Forbidden, (await (await UsersMastersLogin.SignInAsync(_host, "MASTER1"))
            .PutAsJsonAsync($"{Url}/clients/3/details", new { name = "X", baseUrl = "", maySubmitIncentives = true })).StatusCode);
        foreach (var bad in new object[]
        {
            new { name = " ", baseUrl = "", maySubmitIncentives = false },
            new { name = "State portal", baseUrl = "javascript:alert(1)", maySubmitIncentives = false },
            new { name = new string('x', 201), baseUrl = "", maySubmitIncentives = false },
        })
            Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync($"{Url}/clients/3/details", bad)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PutAsJsonAsync($"{Url}/clients/99/details", new { name = "X", baseUrl = "", maySubmitIncentives = false })).StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == ApiIntegrationsController.EditSql);

        var r = await admin.PutAsJsonAsync($"{Url}/clients/3/details", new { name = " State portal ", baseUrl = " https://state.example.in ", maySubmitIncentives = false });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Contains("State portal saved.", await r.Content.ReadAsStringAsync());
        var edit = Assert.Single(_host.Sql.Calls, c => c.Name == ApiIntegrationsController.EditSql);
        Assert.Equal(("3", "State portal", "https://state.example.in", "False"),
            (FakeSql.Arg(edit.Args, "Id"), FakeSql.Arg(edit.Args, "Name"), FakeSql.Arg(edit.Args, "BaseUrl"), FakeSql.Arg(edit.Args, "ReverseToken")));
        Assert.DoesNotContain("ClientId", ApiIntegrationsController.EditSql);
        Assert.DoesNotContain(" Token =", ApiIntegrationsController.EditSql);
    }
}
