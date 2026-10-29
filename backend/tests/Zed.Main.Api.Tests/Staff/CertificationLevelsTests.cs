using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Portal.Features.CertLevels;
using Zed.Portal.Features.Staff.Masters;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>Administration → Certification Levels (ZED-X and the boxes), certificate numbers, and NIC sector-wise parameters.</summary>
public sealed class CertificationLevelsTests : IDisposable
{
    private const string Url = "/api/staff/settings/levels";
    private readonly TestHost _host = new();

    private static readonly CertificationLevel[] Stored =
    [
        new("Bronze", "Bronze", 10, "First step", null, null, true, "Desktop", 36, true, 15, "{DDMMYYYY}_{ZEDNO}", null, null, null),
        new("Gold", "Gold", 30, null, null, null, true, "Site", 36, true, 12, "{DDMMYYYY}_{ZEDNO}", null, null, null),
        new("ZEDX", "ZED-X", 40, "Open to every MSME", null, null, false, "Site", 36, true, 12, "{DDMMYYYY}_{ZEDNO}", null, null, 75000),
    ];

    public CertificationLevelsTests()
    {
        UsersMastersLogin.Setup(_host);
        _host.Sql.Queries[CertificationLevels.Sql] = _ => Stored.Cast<object>().ToList();
        _host.Sql.Procs["SP_MASTER_GET_SECTORS"] = _ => FakeSql.Sets(
            [new { Id = 1, SectorCode = "24", SectorName = "Basic metals", OrderNo = 1 }, new { Id = 2, SectorCode = "62", SectorName = "IT services", OrderNo = 2 }]);
        _host.Sql.Procs["SP_MASTER_GET_SECTIONS"] = args => FakeSql.Arg(args, "SectionType") == "ZEDX"
            ? FakeSql.Sets([new { Id = 7, SectionType = "ZEDX", SectionCode = "X1", SectionName = "Digital", iButton = "", NicSectors = "24,62" }])
            : FakeSql.Sets([]);
    }

    public void Dispose() => _host.Dispose();

    private static object Level(string name = "ZED-X", string format = "ZX/{YYYY}/{ZEDNO}", object? extra = null) => new
    {
        name, description = "Open to every MSME", comment = "Fee Rs. 75,000", isEnabled = true, assessmentMode = "Site", validityMonths = 36,
        surveillanceEnabled = true, firstSurveillanceMonths = 12, certNoFormat = format, certNoFormatManufacturing = "ZXM/{YYYY}/{ZEDNO}",
        certNoFormatService = "", fee = 75000,
    };

    [Fact]
    public void Certificate_numbers_follow_the_format_and_its_category()
    {
        var date = new DateTime(2026, 10, 29);
        Assert.Equal("29102026_129350", CertificateNumbers.Format(CertificateNumbers.Default, date, "ZEDMSME129350", "Bronze", null));
        Assert.Equal("ZX-M-2026-ZEDMSME129350", CertificateNumbers.Format("ZX-{CAT}-{YYYY}-{ZEDID}", date, "ZEDMSME129350", "ZEDX", "Manufacturing"));
        var level = Stored[2] with { CertNoFormatManufacturing = "ZXM/{ZEDNO}" };
        Assert.Equal("ZXM/{ZEDNO}", CertificateNumbers.FormatFor(level, "Manufacturing"));
        Assert.Equal("{DDMMYYYY}_{ZEDNO}", CertificateNumbers.FormatFor(level, "Services"));
        Assert.Null(CertificateNumbers.Problem("{DD}{MM}{YY}-{LEVEL}-{ZEDNO}"));
        Assert.Contains("{ZEDID} or {ZEDNO}", CertificateNumbers.Problem("{DDMMYYYY}"));
        Assert.Contains("not a known part", CertificateNumbers.Problem("{DATE}_{ZEDNO}"));
        Assert.Contains("letters, digits", CertificateNumbers.Problem("<b>{ZEDNO}"));
    }

    [Fact]
    public async Task The_admin_lists_edits_switches_and_adds_levels()
    {
        Assert.Equal(HttpStatusCode.Forbidden, (await (await UsersMastersLogin.SignInAsync(_host, "MASTER1")).GetAsync(Url)).StatusCode);
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var list = await admin.GetFromJsonAsync<JsonElement>(Url);
        Assert.True(list.GetProperty("stored").GetBoolean());
        var zedx = list.GetProperty("levels")[2];
        Assert.Equal("ZED-X", zedx.GetProperty("level").GetProperty("name").GetString());
        Assert.Matches(@"^\d{8}_129350$", zedx.GetProperty("sample").GetString());
        Assert.Equal("/Images/Dashboard/bronze.png", list.GetProperty("levels")[0].GetProperty("logoUrl").GetString());

        Assert.Equal(HttpStatusCode.NotFound, (await admin.PutAsJsonAsync($"{Url}/Platinum", Level())).StatusCode);
        Assert.Contains("{ZEDID} or {ZEDNO}", await (await admin.PutAsJsonAsync($"{Url}/zedx", Level(format: "ZX-{YYYY}"))).ProblemTitle());
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == CertificationLevelsController.UpdateSql);

        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"{Url}/zedx", Level())).StatusCode);
        var update = Assert.Single(_host.Sql.Calls, c => c.Name == CertificationLevelsController.UpdateSql);
        Assert.Equal(("ZEDX", "ZX/{YYYY}/{ZEDNO}", "ZXM/{YYYY}/{ZEDNO}", null, "ADMIN1"),
            (FakeSql.Arg(update.Args, "Code"), FakeSql.Arg(update.Args, "CertNoFormat"), FakeSql.Arg(update.Args, "CertNoFormatManufacturing"),
             FakeSql.Arg(update.Args, "CertNoFormatService"), FakeSql.Arg(update.Args, "UpdatedBy")));

        var off = await admin.PutAsJsonAsync($"{Url}/Gold/enabled", new { enabled = false });
        Assert.Contains("Gold is disabled", await off.Content.ReadAsStringAsync());
        Assert.Equal("False", FakeSql.Arg(Assert.Single(_host.Sql.Calls, c => c.Name == CertificationLevelsController.SwitchSql).Args, "Enabled"));

        var bad = new Dictionary<string, object?>(JsonSerializer.Deserialize<Dictionary<string, object?>>(JsonSerializer.Serialize(Level("Platinum")))!) { ["code"] = "9X" };
        Assert.Contains("2 to 20 letters", await (await admin.PostAsJsonAsync(Url, bad)).ProblemTitle());
        bad["code"] = "ZedX";
        Assert.Contains("already exists", await (await admin.PostAsJsonAsync(Url, bad)).ProblemTitle());
        bad["code"] = "Platinum";
        var added = await admin.PostAsJsonAsync(Url, bad);
        Assert.Equal(HttpStatusCode.OK, added.StatusCode);
        Assert.Contains("Add its questionnaire", await added.Content.ReadAsStringAsync());
        Assert.Equal("Platinum", FakeSql.Arg(Assert.Single(_host.Sql.Calls, c => c.Name == CertificationLevelsController.InsertSql).Args, "Code"));
    }

    [Fact]
    public async Task A_logo_must_be_a_real_image_and_msmes_see_only_enabled_levels()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var fake = new MultipartFormDataContent { { new ByteArrayContent("<svg/>"u8.ToArray()) { Headers = { ContentType = new MediaTypeHeaderValue("image/png") } }, "file", "x.png" } };
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsync($"{Url}/ZEDX/logo", fake)).StatusCode);
        byte[] png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0x0D];
        var logo = new MultipartFormDataContent { { new ByteArrayContent(png) { Headers = { ContentType = new MediaTypeHeaderValue("image/png") } }, "file", "zedx.png" } };
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsync($"{Url}/ZEDX/logo", logo)).StatusCode);
        Assert.Equal(png, File.ReadAllBytes(Path.Combine(_host.StorageRoot, "Uploads", "Levels", "ZEDX.png")));
        Assert.Equal("Uploads/Levels/ZEDX.png", FakeSql.Arg(Assert.Single(_host.Sql.Calls, c => c.Name == CertificationLevelsController.LogoSql).Args, "LogoPath"));

        var levels = await (await _host.CreateBrowserAsync()).GetFromJsonAsync<JsonElement>("/api/public/levels");
        Assert.Equal(["Bronze", "Gold"], levels.EnumerateArray().Select(l => l.GetProperty("code").GetString()));
    }

    [Fact]
    public async Task Zedx_parameters_are_sector_wise()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var levels = await admin.GetFromJsonAsync<JsonElement>("/api/staff/masters/parameter-levels");
        Assert.Contains(levels.EnumerateArray(), l => l.GetProperty("code").GetString() == "ZEDX" && !l.GetProperty("isEnabled").GetBoolean());

        var list = await admin.GetFromJsonAsync<JsonElement>("/api/staff/masters/parameters/zedx");
        Assert.Equal(["24", "62"], list[0].GetProperty("nicSectors").EnumerateArray().Select(s => s.GetString()));
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync("/api/staff/masters/parameters/Platinum")).StatusCode);

        Assert.Contains("NIC sector 99", await (await admin.PostAsJsonAsync("/api/staff/masters/parameters/ZEDX",
            new { sectionCode = "X2", sectionName = "Energy", nicSectors = new[] { "99" } })).ProblemTitle());
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/staff/masters/parameters/ZEDX",
            new { sectionCode = "X2", sectionName = "Energy", nicSectors = new[] { "62", "24", "62" } })).StatusCode);
        var byCode = Assert.Single(_host.Sql.Calls, c => c.Name == StaffMastersController.NicSectorsByCodeSql);
        Assert.Equal(("ZEDX", "X2", "24,62"), (FakeSql.Arg(byCode.Args, "SectionType"), FakeSql.Arg(byCode.Args, "SectionCode"), FakeSql.Arg(byCode.Args, "NicSectors")));

        // No sectors chosen: all sectors (NULL).
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync("/api/staff/masters/parameters/ZEDX/7", new { sectionName = "Digital", nicSectors = Array.Empty<string>() })).StatusCode);
        var byId = Assert.Single(_host.Sql.Calls, c => c.Name == StaffMastersController.NicSectorsByIdSql);
        Assert.Equal(("7", null), (FakeSql.Arg(byId.Args, "Id"), FakeSql.Arg(byId.Args, "NicSectors")));
    }
}
