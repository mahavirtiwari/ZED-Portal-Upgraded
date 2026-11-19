using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Portal.Features.Staff.Assessment;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>2026-11-19 (approved): Admin → Rejection Reasons (the agency's reasons when it rejects an allotment).</summary>
public sealed class RejectionReasonsTests : IDisposable
{
    private const string Url = "/api/staff/settings/rejection-reasons";
    private readonly TestHost _host = new();

    public RejectionReasonsTests() => UsersMastersLogin.Setup(_host);

    public void Dispose() => _host.Dispose();

    private List<(string Name, object? Args)> SettingWrites() =>
        _host.Sql.Calls.Where(c => c.Name.StartsWith("MERGE dbo.V4Settings") || c.Name.StartsWith("DELETE FROM dbo.V4Settings")).ToList();

    private static object Reason(string id, string text, string action, bool active = true) => new { id, text, action, active };

    [Fact]
    public async Task The_admin_sees_the_standard_reasons_with_what_each_does()
    {
        var client = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var body = await client.GetFromJsonAsync<JsonElement>(Url);
        Assert.False(body.GetProperty("customised").GetBoolean());
        Assert.Equal(["Auto", "MasterAdmin"], body.GetProperty("actions").EnumerateArray().Select(a => a.GetString()));
        var reasons = body.GetProperty("reasons").EnumerateArray().ToList();
        Assert.Equal(RejectionReasons.Defaults.Count, reasons.Count);
        Assert.Equal("Auto", reasons[0].GetProperty("action").GetString());
        Assert.Equal("MasterAdmin", reasons[^1].GetProperty("action").GetString());
    }

    [Fact]
    public async Task The_admin_saves_and_resets_the_reasons()
    {
        var client = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var ok = await client.PutAsJsonAsync(Url, new { reasons = new[] { Reason("busy", "Busy this month", "Auto"), Reason("other", "Other", "MasterAdmin", false), Reason("x2", "Unit closed", "masteradmin") } });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var value = (string)SettingWrites().Last().Args!.GetType().GetProperty("SettingValue")!.GetValue(SettingWrites().Last().Args)!;
        Assert.Contains("\"action\":\"MasterAdmin\"", value);
        Assert.Contains("Busy this month", value);

        Assert.Equal(HttpStatusCode.OK, (await client.DeleteAsync(Url)).StatusCode);
        Assert.StartsWith("DELETE FROM dbo.V4Settings", SettingWrites().Last().Name);
    }

    [Theory]
    [InlineData("Auto", "", true, "Every reason needs its wording.")]
    [InlineData("Later", "Busy", true, "\"Busy\": choose Auto re-allot or Master Admin allots.")]
    [InlineData("Auto", "Busy", false, "At least one reason must be in use.")]
    public async Task Bad_lists_are_refused(string action, string text, bool active, string message)
    {
        var client = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var r = await client.PutAsJsonAsync(Url, new { reasons = new[] { Reason("busy", text, action, active) } });
        Assert.Equal(message, await r.ProblemTitle());
        Assert.Empty(SettingWrites());
    }

    [Fact]
    public async Task Only_the_admin_manages_them()
    {
        var client = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync(Url)).StatusCode);
    }

    [Theory]
    [InlineData("Conflict", null, "Conflict")]
    [InlineData("Conflict", "  Our lead\r\nassessor  ", "Conflict – Our lead assessor")]
    public void The_procedures_get_the_reason_then_the_remarks_on_one_line(string text, string? remarks, string expected) =>
        Assert.Equal(expected, RejectionReasons.LegacyText(new RejectionReason("c", text, RejectionReasons.Auto), remarks));
}
