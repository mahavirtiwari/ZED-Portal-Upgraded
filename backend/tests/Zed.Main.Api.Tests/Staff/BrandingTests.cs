using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Zed.Core.Data;
using Zed.Core.Maintenance;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>2026-11-15: Admin → Settings → Branding (logos and colour themes of each portal and app).</summary>
public sealed class BrandingTests : IDisposable
{
    private const string SettingsQuery = "SELECT SettingKey, SettingValue FROM dbo.V4Settings";
    private static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4];
    private readonly TestHost _host = new();

    public BrandingTests() => UsersMastersLogin.Setup(_host);

    public void Dispose() => _host.Dispose();

    private async Task StoredAsync(params (string Key, string Value)[] rows)
    {
        _host.Sql.Queries[SettingsQuery] = _ => rows.Select(r => new { SettingKey = r.Key, SettingValue = r.Value }).ToArray();
        await _host.Services.GetRequiredService<IPortalSettings>().SetAsync("Test.Unused", null, "TEST");
    }

    private IReadOnlyList<(string Key, string? Value)> Merges() =>
        _host.Sql.Calls.Where(c => c.Name.StartsWith("MERGE dbo.V4Settings", StringComparison.Ordinal))
            .Select(c => (FakeSql.Arg(c.Args, "SettingKey")!, FakeSql.Arg(c.Args, "SettingValue"))).ToList();

    private static MultipartFormDataContent File(byte[] content, string name, string type)
    {
        var form = new MultipartFormDataContent();
        var file = new ByteArrayContent(content);
        file.Headers.ContentType = new MediaTypeHeaderValue(type);
        form.Add(file, "file", name);
        return form;
    }

    [Fact]
    public async Task A_logo_is_checked_stored_and_shown_and_a_theme_is_saved()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var page = JsonDocument.Parse(await admin.GetStringAsync("/api/staff/settings/branding")).RootElement;
        Assert.Equal(6, page.GetProperty("targets").GetArrayLength());
        Assert.Equal(7, page.GetProperty("targets")[0].GetProperty("logos").GetArrayLength());
        Assert.Single(page.GetProperty("targets")[3].GetProperty("logos").EnumerateArray());
        Assert.Equal(5, page.GetProperty("themes").GetArrayLength());

        Assert.Equal("The file content does not match its type. Please upload a valid .png file.",
            await (await admin.PostAsync("/api/staff/settings/branding/main/logos/header-right", File("<svg/>"u8.ToArray(), "x.png", "image/png"))).ProblemTitle());
        Assert.Equal("Unknown portal, app or logo.",
            await (await admin.PostAsync("/api/staff/settings/branding/app-msme/logos/footer", File(Png, "x.png", "image/png"))).ProblemTitle());

        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsync("/api/staff/settings/branding/main/logos/header-right", File(Png, "logo.png", "image/png"))).StatusCode);
        var saved = Merges().Single(m => m.Key == "Branding.main.header-right").Value!;
        Assert.Matches(Branding.FileNamePattern(), saved);
        Assert.True(System.IO.File.Exists(Path.Combine(_host.StorageRoot, "Branding", saved)));

        Assert.Equal("Please choose one of the colour themes.",
            await (await admin.PutAsJsonAsync("/api/staff/settings/branding/main/theme", new { theme = "pink" })).ProblemTitle());
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync("/api/staff/settings/branding/main/theme", new { theme = "navy" })).StatusCode);
        Assert.Contains(("Branding.main.Theme", "navy"), Merges());

        // The pages: the saved logo and theme, and the file itself (anyone may read it).
        await StoredAsync(("Branding.main.header-right", saved), ("Branding.main.Theme", "navy"), ("Branding.app-msme.Theme", "forest"));
        var anon = _host.CreateClient();
        var pub = JsonDocument.Parse(await anon.GetStringAsync("/api/public/branding")).RootElement;
        Assert.Equal("navy", pub.GetProperty("theme").GetProperty("key").GetString());
        Assert.Equal("#1f3b73", pub.GetProperty("theme").GetProperty("dark").GetString());
        var url = pub.GetProperty("logos").GetProperty("header-right").GetString()!;
        Assert.Equal("/api/public/branding/file/" + saved, url);
        var image = await anon.GetAsync(url);
        Assert.Equal("image/png", image.Content.Headers.ContentType!.MediaType);
        Assert.Equal(Png, await image.Content.ReadAsByteArrayAsync());
        Assert.Equal(HttpStatusCode.NotFound, (await anon.GetAsync("/api/public/branding/file/..%2Fsecret.png")).StatusCode);

        var app = JsonDocument.Parse(await anon.GetStringAsync("/api/public/branding/app/msme")).RootElement;
        Assert.Equal("forest", app.GetProperty("theme").GetProperty("key").GetString());
        Assert.Equal(JsonValueKind.Null, app.GetProperty("logoUrl").ValueKind);

        // Reset: today's logo again.
        Assert.Equal(HttpStatusCode.OK, (await admin.DeleteAsync("/api/staff/settings/branding/main/logos/header-right")).StatusCode);
        Assert.Contains(_host.Sql.Calls, c => c.Name.StartsWith("DELETE FROM dbo.V4Settings", StringComparison.Ordinal) && FakeSql.Arg(c.Args, "SettingKey") == "Branding.main.header-right");
    }

    [Fact]
    public async Task The_mails_logo_address_answers_with_the_saved_email_logo_but_the_pages_keep_theirs()
    {
        var name = "Branding_main_email_20261115120000_0a1b2c3d.png";
        Directory.CreateDirectory(Path.Combine(_host.StorageRoot, "Branding"));
        await System.IO.File.WriteAllBytesAsync(Path.Combine(_host.StorageRoot, "Branding", name), Png);
        await StoredAsync(("Branding.main.email", name));
        var anon = _host.CreateClient();
        var mail = await anon.GetAsync("/Images/header/zed-logo.png");
        Assert.Equal(Png, await mail.Content.ReadAsByteArrayAsync());
        var ui = await anon.GetAsync("/Images/header/zed-logo.png?ui=1");
        Assert.NotEqual(Png, ui.StatusCode == HttpStatusCode.OK ? await ui.Content.ReadAsByteArrayAsync() : []);
    }

    [Fact]
    public async Task Only_the_admin_changes_the_branding()
    {
        var agency = await UsersMastersLogin.SignInAsync(_host, "AGENCY1");
        Assert.Equal(HttpStatusCode.Forbidden, (await agency.GetAsync("/api/staff/settings/branding")).StatusCode);
    }
}
