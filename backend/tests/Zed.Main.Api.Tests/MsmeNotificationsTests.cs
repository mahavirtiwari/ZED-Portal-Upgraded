using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Portal.Features.Msme;

namespace Zed.Main.Api.Tests;

/// <summary>2026-11-17 (the user): the applicant's notification bell.</summary>
public sealed class MsmeNotificationsTests : IDisposable
{
    private const string Me = "ZEDMSME000001";
    private readonly TestHost _host = new();

    public MsmeNotificationsTests()
    {
        _host.Sql.Procs["SP_GET_USER_DETAILS"] = _ =>
            FakeSql.Sets([new { UserId = Me, UserName = "Acme", RoleId = 5, Email = "a@acme.test" }], [new { ERRORMSG = "SUCCESS" }]);
        _host.Sql.Queries[MsmeNotificationsController.ListSql] = _ =>
        [
            new { CreatedDate = new DateTime(2026, 11, 17, 10, 0, 0), Descrip = " Payment of Rs. 0 successfully received ", CertificationType = "ZEDX", Module = "Handholding" },
            new { CreatedDate = new DateTime(2026, 11, 14, 10, 0, 0), Descrip = "Desktop verification completed", CertificationType = "Bronze", Module = "Certification" },
        ];
        _host.Sql.Queries[MsmeNotificationsController.SeenSql] = _ => [new { NotificationsSeenOn = (DateTime?)new DateTime(2026, 11, 15) }];
    }

    public void Dispose() => _host.Dispose();

    private async Task<HttpClient> SignedInAsync()
    {
        var client = await _host.CreateBrowserAsync();
        (await client.PostAsJsonAsync("/api/msme/auth/login", new { userId = Me, password = "Right#Pass1" })).EnsureSuccessStatusCode();
        (await client.GetAsync("/api/auth/me")).EnsureSuccessStatusCode();
        return client;
    }

    [Fact]
    public async Task Lists_the_unit_s_history_newest_first_with_the_lines_since_last_opened_unread()
    {
        var client = await SignedInAsync();
        var r = await client.GetFromJsonAsync<JsonElement>("/api/msme/notifications");
        Assert.Equal(1, r.GetProperty("unread").GetInt32());
        var first = r.GetProperty("items")[0];
        Assert.Equal(("Payment of Rs. 0 successfully received", "ZED-X", "Handholding"),
            (first.GetProperty("text").GetString(), first.GetProperty("level").GetString(), first.GetProperty("module").GetString()));
        var list = Assert.Single(_host.Sql.Calls, c => c.Name == MsmeNotificationsController.ListSql);
        Assert.Equal(Me, FakeSql.Arg(list.Args, "ZedId"));
    }

    [Fact]
    public async Task Opening_the_bell_marks_everything_read_for_the_signed_in_unit_only()
    {
        var client = await SignedInAsync();
        var r = await client.PostAsync("/api/msme/notifications/seen", null);
        Assert.Equal(HttpStatusCode.NoContent, r.StatusCode);
        Assert.Equal(Me, FakeSql.Arg(Assert.Single(_host.Sql.Calls, c => c.Name == MsmeNotificationsController.MarkSql).Args, "ZedId"));
    }

    [Fact]
    public async Task Needs_a_signed_in_msme()
    {
        var client = await _host.CreateBrowserAsync();
        var r = await client.GetAsync("/api/msme/notifications");
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }
}
