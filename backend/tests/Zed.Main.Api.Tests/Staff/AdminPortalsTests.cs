using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Portal.Features.Staff.AdminPortals;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>One Admin (V4): the main host hands the Admin's sign-in to the Consultancy and Surveillance portals.</summary>
public sealed class AdminPortalsTests : IDisposable
{
    private readonly TestHost _host = new();

    public AdminPortalsTests() => UsersMastersLogin.Setup(_host);

    public void Dispose() => _host.Dispose();

    [Fact]
    public async Task The_admin_gets_a_one_time_pass_per_portal_stored_hashed_in_the_otp_table()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var portals = await admin.GetFromJsonAsync<JsonElement>("/api/staff/admin-portals");
        Assert.Equal(["main", "consultancy", "surveillance"], portals.EnumerateArray().Select(p => p.GetProperty("key").GetString()));

        var r = await admin.PostAsync("/api/staff/admin-portals/consultancy/handoff", null);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var token = (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString()!;
        var stored = _host.Sql.Calls.Single(c => c.Name == AdminPortalsController.InsertSql);
        Assert.Equal(("AdminHandoff:Consultancy", "ADMIN1"), (FakeSql.Arg(stored.Args, "OtpType"), FakeSql.Arg(stored.Args, "UserId")));
        // Only the hash is stored, never the pass.
        Assert.Equal(AdminPortalsController.Hash(token), FakeSql.Arg(stored.Args, "Hash"));
        Assert.DoesNotContain(token, stored.Args!.ToString() ?? "");

        Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsync("/api/staff/admin-portals/main/handoff", null)).StatusCode);
        // The main host does not take passes.
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsJsonAsync("/api/staff/admin-portals/handoff", new { token })).StatusCode);
    }

    [Fact]
    public async Task Other_roles_get_no_pass()
    {
        var master = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        Assert.Equal(HttpStatusCode.Forbidden, (await master.PostAsync("/api/staff/admin-portals/surveillance/handoff", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await (await _host.CreateBrowserAsync()).PostAsync("/api/staff/admin-portals/surveillance/handoff", null)).StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == AdminPortalsController.InsertSql);
    }
}
