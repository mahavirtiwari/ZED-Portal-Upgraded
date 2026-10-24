using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Msme;
using static Zed.Main.Api.Tests.MsmeSchemesTestSupport;

namespace Zed.Main.Api.Tests;

public sealed class MsmeEditHistoryTests : IDisposable
{
    private readonly TestHost _host = new();

    public MsmeEditHistoryTests() => RegisterUsers(_host);

    public void Dispose() => _host.Dispose();

    private List<(string Name, object? Args)> Edits() =>
        _host.Sql.Calls.Where(c => c.Name.StartsWith("INSERT INTO ZEDCS_V2_LIVE.dbo.V4MsmeEditHistory")).ToList();

    [Fact]
    public async Task An_applicants_change_is_recorded_with_its_values_and_secrets_masked()
    {
        var msme = await MsmeAsync(_host);
        var r = await msme.PostAsJsonAsync("/api/account/change-password", new { oldPassword = "Wrong#Pass9", newPassword = "New#Pass123", confirmPassword = "New#Pass123" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);

        var e = Assert.Single(Edits()).Args;
        Assert.Equal(Me, FakeSql.Arg(e, "ZedId"));
        Assert.Equal("Password changed", FakeSql.Arg(e, "Action"));
        Assert.Equal("Web", FakeSql.Arg(e, "Channel"));
        Assert.Equal("Failed", FakeSql.Arg(e, "Result"));
        Assert.Equal("Invalid Old Password.", FakeSql.Arg(e, "Message"));
        Assert.Equal("/api/account/change-password", FakeSql.Arg(e, "Path"));
        var data = FakeSql.Arg(e, "Data")!;
        Assert.DoesNotContain("Pass", data.Replace("Password\"", "").Replace("password\"", ""), StringComparison.Ordinal);
        Assert.Contains("***", data);
    }

    [Fact]
    public async Task Staff_changes_are_not_in_the_applicant_history()
    {
        var staff = await StaffAsync(_host);
        await staff.PostAsJsonAsync("/api/account/change-password", new { oldPassword = "Wrong#Pass9", newPassword = "New#Pass123", confirmPassword = "New#Pass123" });
        Assert.Empty(Edits());
    }

    [Fact]
    public async Task The_applicant_and_the_overseeing_staff_read_the_history()
    {
        _host.Sql.Queries["SELECT Id, At, Channel, ZedId, Action"] = args => FakeSql.Arg(args, "ZedId") == Me
            ? [new { Id = 7L, At = new DateTime(2026, 10, 24, 5, 0, 0), Channel = "Web", ZedId = Me, Action = "Profile: activity updated", Path = "/api/msme/profile/activity",
                     Result = "Success", Message = (string?)null, Data = "{}", IpAddress = "203.0.113.9", DeviceId = "abc" }]
            : [];
        _host.Sql.Queries["SELECT COUNT(*) FROM ZEDCS_V2_LIVE.dbo.V4MsmeEditHistory"] = _ => [1];

        var msme = await MsmeAsync(_host);
        var mine = await msme.GetFromJsonAsync<JsonElement>("/api/msme/edit-history?pageSize=20");
        Assert.Equal(1, mine.GetProperty("total").GetInt32());
        Assert.Equal(20, mine.GetProperty("pageSize").GetInt32());
        Assert.Equal("Profile: activity updated", mine.GetProperty("rows")[0].GetProperty("action").GetString());
        Assert.EndsWith("Z", mine.GetProperty("rows")[0].GetProperty("at").GetString());
        var listed = _host.Sql.Calls.Last(c => c.Name.StartsWith("SELECT Id, At"));
        Assert.Equal(Me, FakeSql.Arg(listed.Args, "ZedId"));

        var staff = await StaffAsync(_host);
        var theirs = await staff.GetFromJsonAsync<JsonElement>($"/api/staff/msme-edit-history/{Me}");
        Assert.Equal(1, theirs.GetProperty("rows").GetArrayLength());
        Assert.Equal(HttpStatusCode.BadRequest, (await staff.GetAsync("/api/staff/msme-edit-history/ZED%25")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await msme.GetAsync($"/api/staff/msme-edit-history/{Me}")).StatusCode);
    }

    [Fact]
    public void Snapshots_mask_secrets_list_files_and_shorten_long_values()
    {
        var file = new FormFile(new MemoryStream(new byte[42]), 0, 42, "file", "invoice.pdf");
        var json = MsmeEditAuditAttribute.Snapshot(new Dictionary<string, object?>
        {
            ["req"] = new { Gstin = "09AAAAA0000A1Z5", Password = "Secret#1", Otp = "123456", Photo = new string('x', 900), Nested = new { CaptchaToken = "t" } },
            ["file"] = file,
            ["ct"] = CancellationToken.None,
        })!;
        using var doc = JsonDocument.Parse(json);
        var req = doc.RootElement.GetProperty("req");
        Assert.Equal("09AAAAA0000A1Z5", req.GetProperty("Gstin").GetString());
        Assert.Equal("***", req.GetProperty("Password").GetString());
        Assert.Equal("***", req.GetProperty("Otp").GetString());
        Assert.Equal("[900 characters]", req.GetProperty("Photo").GetString());
        Assert.Equal("***", req.GetProperty("Nested").GetProperty("CaptchaToken").GetString());
        Assert.Equal("invoice.pdf", doc.RootElement.GetProperty("file").GetProperty("file").GetString());
        Assert.False(doc.RootElement.TryGetProperty("ct", out _));
    }
}
