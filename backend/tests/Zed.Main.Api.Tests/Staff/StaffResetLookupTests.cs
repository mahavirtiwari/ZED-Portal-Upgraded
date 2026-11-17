using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Zed.Portal.Features.Staff.Users;
using Zed.TestSupport;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>
/// 2026-11-17: the Password Reset Link page's lookup (GET api/staff/password-reset/{userId}): who the link would go to and
/// why it cannot be sent, scoped like the send and never showing more than its answer (the masked address only).
/// </summary>
public sealed class StaffResetLookupTests : IDisposable
{
    private readonly TestHost _host = new();
    private readonly FakeStaffResets _resets;

    public StaffResetLookupTests()
    {
        UsersMastersLogin.Setup(_host);
        _resets = new FakeStaffResets().Attach(_host.Sql.Procs);
        new FakePasswords().Attach(_host.Sql.Procs);
        _resets.Add("ZEDAA0001", 2, "spoc@acme.test");
        _resets.Add("NOMAIL1", 2, email: "not an address");
        _resets.Add("BLOCKED1", 3, "blocked@zed.test", active: false);
        _resets.Add("MASTER1", 7, "master1@zed.test");
        _resets.Add("MASTER2", 7, "master2@zed.test");
        _resets.Add("ZEDMSME000001", 5, "unit@zed.test");
    }

    public void Dispose() => _host.Dispose();

    private static async Task<JsonElement> Json(HttpResponseMessage r)
    {
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        return await r.Content.ReadFromJsonAsync<JsonElement>();
    }

    [Fact]
    public async Task Shows_who_gets_the_link_with_the_masked_address_only_and_sends_nothing()
    {
        var master = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        var r = await master.GetAsync("/api/staff/password-reset/zedaa0001");
        var raw = await r.Content.ReadAsStringAsync();
        var t = await Json(r);
        Assert.Equal("ZEDAA0001", t.GetProperty("userId").GetString());
        Assert.Equal(2, t.GetProperty("roleId").GetInt32());
        Assert.Equal("Assessment agency", t.GetProperty("role").GetString());
        Assert.True(t.GetProperty("isActive").GetBoolean());
        Assert.Equal("s***@acme.test", t.GetProperty("maskedEmail").GetString()); // as the send masks it
        Assert.True(t.GetProperty("canSend").GetBoolean());
        Assert.Equal(JsonValueKind.Null, t.GetProperty("reason").ValueKind);
        Assert.DoesNotContain("spoc@acme.test", raw);
        // Read-only: no link created, nothing mailed.
        Assert.Empty(_resets.Rows);
        Assert.Empty(_host.Email.Sent);
    }

    [Fact]
    public async Task Gives_the_sends_refusals_up_front()
    {
        var master = await UsersMastersLogin.SignInAsync(_host, "MASTER1");

        var blocked = await Json(await master.GetAsync("/api/staff/password-reset/BLOCKED1"));
        Assert.False(blocked.GetProperty("canSend").GetBoolean());
        Assert.False(blocked.GetProperty("isActive").GetBoolean());
        Assert.Equal("This user is blocked. Unblock the account first.", blocked.GetProperty("reason").GetString());

        var noMail = await Json(await master.GetAsync("/api/staff/password-reset/NOMAIL1"));
        Assert.False(noMail.GetProperty("canSend").GetBoolean());
        Assert.Equal(JsonValueKind.Null, noMail.GetProperty("maskedEmail").ValueKind);
        Assert.Equal("This user has no valid registered e-mail address. Update it first.", noMail.GetProperty("reason").GetString());

        var own = await Json(await master.GetAsync("/api/staff/password-reset/MASTER1"));
        Assert.Equal("Please use Change Password for your own account.", own.GetProperty("reason").GetString());

        // Another MasterAdmin can be sent a link (as the send allows).
        Assert.True((await Json(await master.GetAsync("/api/staff/password-reset/MASTER2"))).GetProperty("canSend").GetBoolean());

        // MSMEs and unknown IDs are not found, as for the send.
        Assert.Equal(HttpStatusCode.NotFound, (await master.GetAsync("/api/staff/password-reset/ZEDMSME000001")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await master.GetAsync("/api/staff/password-reset/NOBODY")).StatusCode);
        Assert.Empty(_resets.Rows);
    }

    [Fact]
    public async Task Only_a_MasterAdmin_may_look_up_and_not_when_reset_is_switched_off()
    {
        var anonymous = await _host.CreateBrowserAsync();
        Assert.Contains((await anonymous.GetAsync("/api/staff/password-reset/ZEDAA0001")).StatusCode, new[] { HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden });
        foreach (var id in new[] { "AGENCY1", "ADMIN1", "SUPER1" })
        {
            var other = await UsersMastersLogin.SignInAsync(_host, id);
            Assert.Equal(HttpStatusCode.Forbidden, (await other.GetAsync("/api/staff/password-reset/ZEDAA0001")).StatusCode);
        }

        _host.Services.GetRequiredService<IConfiguration>()["StaffPasswordReset:Enabled"] = "false";
        var master = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        Assert.Equal("Password reset is switched off on this portal.", await (await master.GetAsync("/api/staff/password-reset/ZEDAA0001")).ProblemTitle());
    }
}

/// <summary>2026-11-17: an agency's block / unblock history for the history side panel (GET api/staff/users/agencies/{id}/history).</summary>
public sealed class StaffAgencyHistoryTests : IDisposable
{
    private readonly TestHost _host = new();

    public StaffAgencyHistoryTests()
    {
        UsersMastersLogin.Setup(_host);
        _host.Sql.Procs["SP_GET_USER_DETAILS_BY_USER_ID"] = args => (UsersMastersLogin.Arg(args, "UserId") ?? "").ToUpperInvariant() switch
        {
            "ZEDAA0001" => FakeSql.Sets([new { Id = 11, UserId = "ZEDAA0001", UserName = "Acme", RoleId = 2, IsActive = true, Email = "spoc@acme.test", CreatedBy = "MASTER1" }], [], [], []),
            "ZEDAS0001" => FakeSql.Sets([new { Id = 21, UserId = "ZEDAS0001", UserName = "A1", RoleId = 3, IsActive = true, Email = "a1@zed.test", CreatedBy = "AGENCY1" }], [], [], []),
            _ => FakeSql.Sets([], [], [], []),
        };
        _host.Sql.Queries[UserBlockHistory.ListSql] = args => UsersMastersLogin.Arg(args, "UserId") == "ZEDAA0001"
            ? [new UserBlockHistory.Entry("Unblocked", "Documents verified", "MASTER1", 7, new DateTime(2026, 11, 8, 10, 15, 0)),
               new UserBlockHistory.Entry("Blocked", "Accreditation lapsed", "MASTER1", 7, new DateTime(2026, 11, 6, 17, 30, 0))]
            : [];
    }

    public void Dispose() => _host.Dispose();

    [Fact]
    public async Task Master_admin_reads_an_agencys_history_latest_first()
    {
        var master = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        var history = (await master.GetFromJsonAsync<JsonElement>("/api/staff/users/agencies/ZEDAA0001/history")).EnumerateArray().ToList();
        Assert.Equal(["Unblocked", "Blocked"], history.Select(e => e.GetProperty("action").GetString()));
        Assert.Equal("Accreditation lapsed", history[1].GetProperty("reason").GetString());
    }

    [Fact]
    public async Task Only_agencies_and_only_for_a_MasterAdmin()
    {
        var master = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        Assert.Equal(HttpStatusCode.NotFound, (await master.GetAsync("/api/staff/users/agencies/ZEDAS0001/history")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await master.GetAsync("/api/staff/users/agencies/NOBODY/history")).StatusCode);
        var agency = await UsersMastersLogin.SignInAsync(_host, "AGENCY1");
        Assert.Equal(HttpStatusCode.Forbidden, (await agency.GetAsync("/api/staff/users/agencies/ZEDAA0001/history")).StatusCode);
    }
}
