using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Core.Assessment;
using Zed.Portal.Features.Staff.Settings;

namespace Zed.Main.Api.Tests.Staff;

public sealed class SiteTourSectionsTests : IDisposable
{
    private const string Url = "/api/staff/settings/site-tour-sections";
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);
    private readonly TestHost _host = new();

    public SiteTourSectionsTests() => UsersMastersLogin.Setup(_host);

    public void Dispose() => _host.Dispose();

    private List<(string Name, object? Args)> SettingWrites() =>
        _host.Sql.Calls.Where(c => c.Name.StartsWith("MERGE dbo.V4Settings") || c.Name.StartsWith("DELETE FROM dbo.V4Settings")).ToList();

    private static object Section(string id, string title, int min, int max, string[]? levels = null, string[]? sectors = null, bool active = true) =>
        new { id, title, hint = "what", min, max, levels = levels ?? [], nicSectors = sectors ?? [], active };

    [Fact]
    public async Task Only_the_admin_sees_and_saves_the_sections()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await (await _host.CreateBrowserAsync()).GetAsync(Url)).StatusCode);
        foreach (var user in new[] { "MASTER1", "SUPER1" })
        {
            var other = await UsersMastersLogin.SignInAsync(_host, user);
            Assert.Equal(HttpStatusCode.Forbidden, (await other.GetAsync(Url)).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await other.PutAsJsonAsync(Url, new { sections = new[] { Section("a", "A", 1, 2) } })).StatusCode);
        }
        Assert.Empty(SettingWrites());
    }

    [Fact]
    public async Task Without_a_saved_list_the_ten_standard_sections()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var r = (await admin.GetFromJsonAsync<SiteTourSectionsController.SectionsResponse>(Url))!;
        Assert.False(r.Customised);
        Assert.Equal(10, r.Sections.Count);
        Assert.Equal("Production / Machine Shop", r.Sections[2].Title);
        Assert.Equal(19, r.Sections.Sum(s => s.Min));
        Assert.Equal(30, r.Sections.Sum(s => s.Max));
    }

    [Fact]
    public async Task Saves_the_list_with_levels_and_sectors_and_refuses_invalid_ones()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        async Task<string?> Refused(params object[] sections) => await (await admin.PutAsJsonAsync(Url, new { sections })).ProblemTitle();

        Assert.Equal("Add at least one section.", await Refused());
        Assert.Equal("\"Gate\": the minimum cannot be more than the maximum.", await Refused(Section("gate", "Gate", 3, 2)));
        Assert.Equal("\"gate\" is used twice.", await Refused(Section("gate", "Gate", 1, 2), Section("gate2", "gate", 1, 2)));
        Assert.Equal("\"3 Shop\": a section name cannot start with a number or contain \" - \".", await Refused(Section("s", "3 Shop", 1, 2)));
        Assert.Equal("At least one section must be in use.", await Refused(Section("gate", "Gate", 1, 2, active: false)));
        Assert.Empty(SettingWrites());

        var r = await admin.PutAsJsonAsync(Url, new { sections = new[] { Section("gate", "Gate", 1, 2), Section("forge", "Forge shop", 2, 4, ["Gold"], ["24", "25"]) } });
        r.EnsureSuccessStatusCode();
        var write = Assert.Single(SettingWrites());
        var value = (string)write.Args!.GetType().GetProperty("SettingValue")!.GetValue(write.Args)!;
        var saved = JsonSerializer.Deserialize<List<SiteTourSection>>(value, Web)!;
        Assert.Equal(["gate", "forge"], saved.Select(s => s.Id));
        Assert.Equal(["Gold"], saved[1].Levels);
        Assert.Equal(["24", "25"], saved[1].NicSectors);

        Assert.Equal(HttpStatusCode.OK, (await admin.DeleteAsync(Url)).StatusCode);
        Assert.StartsWith("DELETE FROM dbo.V4Settings", SettingWrites().Last().Name);
    }
}
