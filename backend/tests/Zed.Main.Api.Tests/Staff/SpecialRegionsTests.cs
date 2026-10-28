using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Zed.Portal.Features.Staff.Masters;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>Admin → Masters → Subsidy Regions and LG Directory.</summary>
public sealed class SpecialRegionsTests : IDisposable
{
    private const string Url = "/api/staff/masters/regions";
    private readonly TestHost _host = new();
    private readonly List<SpecialRegionsController.RegionRow> _regions = [];

    public SpecialRegionsTests()
    {
        UsersMastersLogin.Setup(_host);
        _host.Sql.Queries["SELECT x.Category, x.StateCode"] = _ => _regions.Cast<object>();
        _host.Sql.Queries["SELECT LTRIM(RTRIM(StateCode)) AS Code, StateName AS Name FROM dbo.States"] = _ =>
            [new SpecialRegionsController.Option("9", "UTTAR PRADESH"), new SpecialRegionsController.Option("35", "ANDAMAN AND NICOBAR ISLANDS")];
        _host.Sql.Queries["SELECT LTRIM(RTRIM(DistrictCode)) AS Code, DistrictName AS Name FROM dbo.Districts"] = args =>
            FakeSql.Arg(args, "State") == "9" ? [new SpecialRegionsController.Option("164", "KANPUR NAGAR"), new SpecialRegionsController.Option("170", "SONBHADRA")] : [];
        _host.Sql.Queries["SELECT COUNT(*) AS Total FROM dbo.Districts"] = _ => [new SpecialRegionsController.CountRow(112)];
        _host.Sql.Queries["SELECT LTRIM(RTRIM(StateCode)) AS StateCode, StateName FROM dbo.States"] = _ =>
            [new LgdDirectoryController.StateRow("9", "UTTAR PRADESH"), new LgdDirectoryController.StateRow("37", "LADAKH")];
        _host.Sql.Queries["SELECT LTRIM(RTRIM(StateCode)) AS StateCode, LTRIM(RTRIM(DistrictCode)) AS DistrictCode"] = _ =>
        [
            new LgdDirectoryController.DistrictRow("9", "164", "KANPUR NAGAR", true),
            new LgdDirectoryController.DistrictRow("9", "170", "SONEBHADRA", true),
            new LgdDirectoryController.DistrictRow("9", "999", "OLD DISTRICT", true),
        ];
    }

    public void Dispose() => _host.Dispose();

    private List<string> Writes(string prefix) => _host.Sql.Calls.Where(c => c.Name.StartsWith(prefix, StringComparison.Ordinal)).Select(c => c.Name).ToList();

    [Fact]
    public async Task Only_the_admin_sees_and_changes_the_regions()
    {
        foreach (var user in new[] { "MASTER1", "SUPER1" })
        {
            var other = await UsersMastersLogin.SignInAsync(_host, user);
            Assert.Equal(HttpStatusCode.Forbidden, (await other.GetAsync(Url)).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await other.PutAsJsonAsync(Url, new { category = "NER", stateCode = "12", enabled = true })).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await other.PostAsync("/api/staff/masters/lgd/apply", JsonContent.Create(new { changes = Array.Empty<object>() }))).StatusCode);
        }
        Assert.Empty(Writes("UPDATE d SET IsAspirationalDt"));
    }

    [Fact]
    public async Task Lists_the_categories_entries_and_the_districts_that_get_the_subsidy()
    {
        _regions.Add(new SpecialRegionsController.RegionRow("ASPIRATIONAL", "9", "170", true, "migration-0024", null, "UTTAR PRADESH", "SONBHADRA"));
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var body = await admin.GetFromJsonAsync<JsonElement>(Url);
        Assert.Equal(["ASPIRATIONAL", "LWE", "HIMALAYAN", "ISLAND", "NER"], body.GetProperty("categories").EnumerateArray().Select(c => c.GetProperty("key").GetString()));
        Assert.Equal(112, body.GetProperty("subsidyDistricts").GetInt32());
        Assert.Equal("SONBHADRA", body.GetProperty("regions")[0].GetProperty("districtName").GetString());
        Assert.Equal(2, (await admin.GetFromJsonAsync<JsonElement>($"{Url}/districts?state=9")).GetArrayLength());
    }

    [Fact]
    public async Task Enabling_adding_and_removing_recompute_the_subsidy_flags()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        // A whole state: the region's column of dbo.States.
        var put = await admin.PutAsJsonAsync(Url, new { category = "ISLAND", stateCode = "35", districtCode = "", enabled = true });
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        Assert.Contains("112 districts now get the additional subsidy", await put.Content.ReadAsStringAsync());
        var state = _host.Sql.Calls.Last(c => c.Name.StartsWith("UPDATE dbo.States SET SubsidyIsland = @Value", StringComparison.Ordinal));
        Assert.Contains("SubsidyIsland IS NOT NULL", state.Name);
        Assert.Equal(("35", "True", "ADMIN1"), (FakeSql.Arg(state.Args, "StateCode"), FakeSql.Arg(state.Args, "Value"), FakeSql.Arg(state.Args, "UpdatedBy")));
        Assert.Single(Writes("UPDATE d SET IsAspirationalDt"));

        // A district: the region's column of dbo.Districts, from NULL (not listed).
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync(Url, new { category = "LWE", stateCode = "9", districtCode = "170", enabled = true })).StatusCode);
        var added = _host.Sql.Calls.Last(c => c.Name.StartsWith("UPDATE dbo.Districts SET SubsidyLwe = @Value", StringComparison.Ordinal));
        Assert.Contains("SubsidyLwe IS NULL", added.Name);
        Assert.Equal(("9", "170", "True"), (FakeSql.Arg(added.Args, "StateCode"), FakeSql.Arg(added.Args, "DistrictCode"), FakeSql.Arg(added.Args, "Value")));

        // Removing sets it back to NULL; the district stays.
        Assert.Equal(HttpStatusCode.OK, (await admin.DeleteAsync($"{Url}?category=LWE&stateCode=9&districtCode=170")).StatusCode);
        var removed = _host.Sql.Calls.Last(c => c.Name.StartsWith("UPDATE dbo.Districts SET SubsidyLwe = @Value", StringComparison.Ordinal));
        Assert.Null(FakeSql.Arg(removed.Args, "Value"));
        Assert.Equal(3, Writes("UPDATE d SET IsAspirationalDt").Count);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.Contains("V4SpecialRegions", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("LWE", "9", "", "please choose the district")]
    [InlineData("NER", "99", "", "valid state")]
    [InlineData("ASPIRATIONAL", "9", "555", "district of that state")]
    [InlineData("OTHER", "9", "164", "category")]
    public async Task Refuses_entries_that_do_not_fit(string category, string state, string district, string message)
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var r = await admin.PostAsJsonAsync(Url, new { category, stateCode = state, districtCode = district, enabled = true });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Contains(message, await r.ProblemTitle(), StringComparison.OrdinalIgnoreCase);
        Assert.Empty(Writes("UPDATE dbo.Districts SET Subsidy"));
        Assert.Empty(Writes("UPDATE dbo.States SET Subsidy"));
    }

    private static MultipartFormDataContent File(string name, string content)
    {
        var bytes = new ByteArrayContent(Encoding.UTF8.GetBytes(content));
        bytes.Headers.ContentType = new MediaTypeHeaderValue("text/csv");
        return new MultipartFormDataContent { { bytes, "file", name } };
    }

    [Fact]
    public async Task The_lgd_list_is_compared_with_the_masters()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        const string csv =
            "S.No.,State Code,State Name (In English),District Code,District Name (In English),District Name (In Local),Census 2011 Code\n" +
            "1,9,Uttar Pradesh,164,Kanpur Nagar,,\n" +
            "2,9,Uttar Pradesh,170,Sonbhadra,,\n" +
            "3,9,Uttar Pradesh,780,\"New District, East\",,\n" +
            "4,38,The Dadra And Nagar Haveli And Daman And Diu,800,Dadra And Nagar Haveli,,\n";
        var r = await admin.PostAsync("/api/staff/masters/lgd/preview", File("districts.csv", csv));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var body = await r.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(4, body.GetProperty("districtsInFile").GetInt32());
        var changes = body.GetProperty("changes").EnumerateArray().Select(c => $"{c.GetProperty("kind").GetString()} {c.GetProperty("districtCode").GetString() ?? c.GetProperty("stateCode").GetString()}").ToList();
        // Kanpur Nagar is the same name; Sonbhadra was spelt Sonebhadra; 999 is gone from LGD; Ladakh is not in the file (left alone).
        Assert.Equal(["addDistrict 780", "addDistrict 800", "addState 38", "deactivateDistrict 999", "renameDistrict 170"], changes.Order());
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.StartsWith("INSERT INTO dbo.Districts", StringComparison.Ordinal));

        var bad = await admin.PostAsync("/api/staff/masters/lgd/preview", File("x.csv", "a,b,c\n1,2,3\n"));
        Assert.Contains("not the LGD district list", await bad.ProblemTitle());
    }

    [Fact]
    public async Task Only_the_ticked_changes_are_applied_in_capitals()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var r = await admin.PostAsJsonAsync("/api/staff/masters/lgd/apply", new
        {
            changes = new object[]
            {
                new { kind = "addDistrict", stateCode = "9", stateName = "Uttar Pradesh", districtCode = "780", districtName = "New District, East" },
                new { kind = "renameDistrict", stateCode = "9", stateName = "Uttar Pradesh", districtCode = "170", districtName = "Sonbhadra" },
                new { kind = "deactivateDistrict", stateCode = "9", districtCode = "999" },
                // Already in the masters: skipped.
                new { kind = "addDistrict", stateCode = "9", stateName = "Uttar Pradesh", districtCode = "164", districtName = "Kanpur Nagar" },
            },
        });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Contains("3 change(s) applied", await r.Content.ReadAsStringAsync());
        var insert = _host.Sql.Calls.Single(c => c.Name.StartsWith("INSERT INTO dbo.Districts", StringComparison.Ordinal));
        Assert.Equal("NEW DISTRICT, EAST", FakeSql.Arg(insert.Args, "DistrictName"));
        Assert.Equal("UTTAR PRADESH", FakeSql.Arg(insert.Args, "StateName"));
        Assert.Equal("SONBHADRA", FakeSql.Arg(_host.Sql.Calls.Single(c => c.Name.StartsWith("UPDATE dbo.Districts SET DistrictName", StringComparison.Ordinal)).Args, "DistrictName"));
        Assert.Single(_host.Sql.Calls, c => c.Name.StartsWith("UPDATE dbo.Districts SET IsActive = 0", StringComparison.Ordinal));

        var bad = await admin.PostAsJsonAsync("/api/staff/masters/lgd/apply", new { changes = new[] { new { kind = "dropTable", stateCode = "9" } } });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
    }
}
