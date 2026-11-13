using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Portal.Features.Staff.Fees;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>Masters → Payments: switching a subsidy category off and on again on the three portals (2026-11-13).</summary>
public sealed class SubsidySwitchTests : IDisposable
{
    private const string Url = "/api/staff/fees/subsidy-switches";
    private readonly TestHost _host = new();

    public SubsidySwitchTests() => UsersMastersLogin.Setup(_host);

    public void Dispose() => _host.Dispose();

    private List<(string Name, object? Args)> Switches() =>
        _host.Sql.Calls.Where(c => c.Name.StartsWith("UPDATE ", StringComparison.Ordinal) && c.Name.Contains(".dbo.AssessmentFee SET SubsidyOff", StringComparison.Ordinal)).ToList();

    [Fact]
    public async Task Only_the_admin_switches_a_subsidy()
    {
        foreach (var user in new[] { "MASTER1", "AGENCY1" })
        {
            var client = await UsersMastersLogin.SignInAsync(_host, user);
            Assert.Equal(HttpStatusCode.Forbidden, (await client.PutAsJsonAsync(Url + "/5", new { off = true, reason = "x" })).StatusCode);
        }
        Assert.Empty(Switches());
    }

    [Fact]
    public async Task Switching_off_needs_a_reason_and_covers_the_three_portals()
    {
        var client = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        Assert.Equal("General cannot be switched off; please choose a subsidy category.",
            await (await client.PutAsJsonAsync(Url + "/0", new { off = true, reason = "x" })).ProblemTitle());
        Assert.Equal("Please enter the reason (up to 500 characters).",
            await (await client.PutAsJsonAsync(Url + "/5", new { off = true, reason = " " })).ProblemTitle());
        Assert.Empty(Switches());

        var r = await client.PutAsJsonAsync(Url + "/5", new { off = true, reason = "Scheme closed for LWE districts" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("The LWE district subsidy is switched off on ZED Certification, Handholding and Surveillance.",
            (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("message").GetString());
        var calls = Switches();
        Assert.Equal(["ZEDCS_V2_LIVE", "ZED_CONSULTANT", "ZED_SURVEILLANCE"], calls.Select(c => c.Name.Split(' ')[1].Split('.')[0]));
        Assert.All(calls, c =>
        {
            Assert.Equal("5", FakeSql.Arg(c.Args, "Category"));
            Assert.Equal("True", FakeSql.Arg(c.Args, "Off"));
            Assert.Equal("Scheme closed for LWE districts", FakeSql.Arg(c.Args, "Reason"));
            Assert.Equal("ADMIN1", FakeSql.Arg(c.Args, "Actor"));
        });

        _host.Sql.Calls.Clear();
        r = await client.PutAsJsonAsync(Url + "/5", new { off = false });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.All(Switches(), c => Assert.Equal("False", FakeSql.Arg(c.Args, "Off")));
    }

    [Fact]
    public async Task The_page_reads_the_switched_off_categories()
    {
        _host.Sql.Queries[SubsidySwitchController.OffSql] = _ =>
            [new { Category = 5, Reason = "Scheme closed", By = "ADMIN1", On = new DateTime(2026, 11, 13, 10, 0, 0) }];
        var client = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var body = await client.GetFromJsonAsync<JsonElement>(Url);
        Assert.True(body.GetProperty("ready").GetBoolean());
        var off = Assert.Single(body.GetProperty("off").EnumerateArray());
        Assert.Equal(5, off.GetProperty("category").GetInt32());
        Assert.Equal("Scheme closed", off.GetProperty("reason").GetString());
    }
}
