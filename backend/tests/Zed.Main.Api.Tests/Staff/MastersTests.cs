using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace Zed.Main.Api.Tests.Staff;

public sealed class MastersTests : IDisposable
{
    private readonly TestHost _host = new();
    private readonly List<Dictionary<string, object?>> _documents = [];

    private static readonly byte[] PdfBytes = "%PDF-1.4\n%test\n"u8.ToArray();
    private static readonly byte[] PngBytes = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0x0D];

    public MastersTests()
    {
        UsersMastersLogin.Setup(_host);
        _host.Sql.Procs["SP_MASTER_GET_SECTORS"] = _ => FakeSql.Sets([new { Id = 1, SectorCode = "24", SectorName = "Basic metals", OrderNo = 1 }]);
        _host.Sql.Procs["SP_MASTER_GET_CATEGORIES"] = _ => FakeSql.Sets([new { Id = 5, CategoryCode = "C1", CategoryName = "Energy", OrderNo = 1 }]);
        _host.Sql.Procs["SP_MASTER_GET_TECHNOLOGIES"] = _ => FakeSql.Sets([new
        {
            Id = 9, TechnologyCode = "T1", TechnologyName = "Solar", Description = "", Sectors = "24-Basic metals", Categories = "C1 -Energy", IsActive = true,
        }]);
        _host.Sql.Procs["SP_MASTER_ACTIVE__DEACTIVE_TECHNOLOGIES"] = _ => FakeSql.Sets([new { StatusCode = 200, Message = "OK" }]);
        _host.Sql.Procs["SP_MASTER_GET_MY_DOCUMENTS"] = _ => FakeSql.Sets(_documents.Cast<object>());
        _host.Sql.Procs["SP_MASTER_GET_SECTIONS"] = _ => FakeSql.Sets([new { Id = 3, SectionType = "Bronze", SectionCode = "P1", SectionName = "Leadership", iButton = "<b>x</b>" }]);
    }

    public void Dispose() => _host.Dispose();

    private (string Name, object? Args) Call(string proc) => _host.Sql.Calls.Last(c => c.Name == proc);

    private static MultipartFormDataContent Upload(byte[] content, string fileName, string contentType, string? documentName = "Guidelines")
    {
        var form = new MultipartFormDataContent();
        if (documentName is not null) form.Add(new StringContent(documentName), "documentName");
        var file = new ByteArrayContent(content);
        file.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        form.Add(file, "file", fileName);
        return form;
    }

    [Theory]
    [InlineData("/api/staff/masters/sectors")]
    [InlineData("/api/staff/masters/categories")]
    [InlineData("/api/staff/masters/technologies")]
    [InlineData("/api/staff/masters/documents")]
    [InlineData("/api/staff/masters/page-settings")]
    [InlineData("/api/staff/masters/parameters/Bronze")]
    public async Task Anonymous_gets_401_and_other_roles_403(string url)
    {
        var anonymous = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(url)).StatusCode);
        foreach (var user in new[] { "MASTER1", "AGENCY1", "SUPER1" })
        {
            var client = await UsersMastersLogin.SignInAsync(_host, user);
            Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync(url)).StatusCode);
        }
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync(url)).StatusCode);
    }

    [Fact]
    public async Task Non_admins_cannot_change_masters_or_upload()
    {
        var client = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync("/api/staff/masters/categories", new { code = "C2", name = "x" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsync("/api/staff/masters/documents", Upload(PdfBytes, "a.pdf", "application/pdf"))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsync("/api/staff/masters/page-settings/banner", Upload(PngBytes, "b.png", "image/png", null))).StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.StartsWith("SP_MASTER_INSERT", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Sector_codes_are_unique_and_unknown_ids_are_404()
    {
        var client = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var dup = await client.PostAsJsonAsync("/api/staff/masters/sectors", new { code = "24", name = "Again" });
        Assert.Equal("A sector with this code already exists.", await dup.ProblemTitle());
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/staff/masters/sectors", new { code = "26", name = "Electronics" })).StatusCode);
        Assert.Equal("26", FakeSql.Arg(Call("SP_MASTER_INSERT_SECTOR").Args, "SectorCode"));
        Assert.Equal(HttpStatusCode.NotFound, (await client.PutAsJsonAsync("/api/staff/masters/sectors/77", new { name = "x" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync("/api/staff/masters/sectors/1", new { name = "Metals" })).StatusCode);
        Assert.Equal("24", FakeSql.Arg(Call("SP_MASTER_UPDATE_SECTOR").Args, "SectorCode"));
    }

    [Fact]
    public async Task Technologies_only_accept_listed_sectors_and_categories()
    {
        var client = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var bad = await client.PostAsJsonAsync("/api/staff/masters/technologies",
            new { technologyCode = "T2", technologyName = "Wind", sectors = new[] { "99-Fake" }, categories = Array.Empty<string>() });
        Assert.Equal("Please select valid NIC sectors.", await bad.ProblemTitle());

        var ok = await client.PostAsJsonAsync("/api/staff/masters/technologies",
            new { technologyCode = "T2", technologyName = "Wind", description = "d", sectors = new[] { "24-Basic metals" }, categories = new[] { "C1 -Energy" } });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var insert = Call("SP_MASTER_INSERT_TECHNOLOGY");
        Assert.Equal("24-Basic metals", FakeSql.Arg(insert.Args, "Sectors"));
        Assert.Equal("C1 -Energy", FakeSql.Arg(insert.Args, "Categories"));

        var list = await client.GetFromJsonAsync<JsonElement>("/api/staff/masters/technologies");
        Assert.Equal("24-Basic metals", list[0].GetProperty("sectors")[0].GetString());
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/staff/masters/technologies/9/active", new { isActive = false })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync("/api/staff/masters/technologies/10/active", new { isActive = false })).StatusCode);
    }

    [Fact]
    public async Task Parameters_are_per_level_and_unknown_levels_are_404()
    {
        var client = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/staff/masters/parameters/Hotel")).StatusCode);
        var list = await client.GetFromJsonAsync<JsonElement>("/api/staff/masters/parameters/bronze");
        Assert.Equal("Leadership", list[0].GetProperty("sectionName").GetString());
        Assert.Equal("Bronze", FakeSql.Arg(Call("SP_MASTER_GET_SECTIONS").Args, "SectionType"));
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync("/api/staff/masters/parameters/Bronze/3", new { sectionName = "Lead", description = "Text" })).StatusCode);
        Assert.Equal("P1", FakeSql.Arg(Call("SP_MASTER_UPDATE_SECTION").Args, "SectionCode"));
    }

    [Fact]
    public async Task Document_upload_stores_a_server_named_file_in_the_legacy_folder()
    {
        var client = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var r = await client.PostAsync("/api/staff/masters/documents", Upload(PdfBytes, "..\\..\\web.config.pdf", "application/pdf"));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);

        var insert = Call("SP_MASTER_INSERT_MY_DOCUMENT");
        var stored = FakeSql.Arg(insert.Args, "DocumentPath")!;
        Assert.Matches(@"^Uploads\\Documents\\Document_\d{14}_[0-9a-f]{8}\.pdf$", stored);
        Assert.Equal("Guidelines", FakeSql.Arg(insert.Args, "DocumentName"));
        var file = Path.Combine(_host.StorageRoot, stored.Replace('\\', Path.DirectorySeparatorChar));
        Assert.Equal(PdfBytes, await File.ReadAllBytesAsync(file));

        // The row as SP_MASTER_GET_MY_DOCUMENTS returns it can be downloaded by the admin.
        _documents.Add(new() { ["Id"] = 4, ["DocumentName"] = "Guidelines", ["DocumentPath"] = stored });
        var list = await client.GetFromJsonAsync<JsonElement>("/api/staff/masters/documents");
        Assert.Equal("/api/staff/masters/documents/4/file", list[0].GetProperty("downloadUrl").GetString());
        var download = await client.GetAsync("/api/staff/masters/documents/4/file");
        Assert.Equal(HttpStatusCode.OK, download.StatusCode);
        Assert.Equal(PdfBytes, await download.Content.ReadAsByteArrayAsync());
    }

    [Theory]
    [InlineData("tool.exe", "application/pdf", "File type is not allowed")]
    [InlineData("report.pdf", "text/html", "File type is not allowed")]
    [InlineData("report.pdf", "application/pdf", "does not match")] // HTML content named .pdf
    [InlineData("page.html", "text/html", "File type is not allowed")]
    public async Task Document_upload_refuses_other_types(string fileName, string contentType, string message)
    {
        var client = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var r = await client.PostAsync("/api/staff/masters/documents", Upload("<script>alert(1)</script>"u8.ToArray(), fileName, contentType));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Contains(message, await r.ProblemTitle());
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_MASTER_INSERT_MY_DOCUMENT");
        Assert.False(Directory.Exists(Path.Combine(_host.StorageRoot, "Uploads")));
    }

    [Fact]
    public async Task Document_upload_refuses_large_files_and_missing_names()
    {
        var client = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var big = new byte[5 * 1024 * 1024 + 1];
        PdfBytes.CopyTo(big, 0);
        var r = await client.PostAsync("/api/staff/masters/documents", Upload(big, "big.pdf", "application/pdf"));
        Assert.Contains("too large", await r.ProblemTitle());
        r = await client.PostAsync("/api/staff/masters/documents", Upload(PdfBytes, "a.pdf", "application/pdf", " "));
        Assert.Contains("Document Name required", await r.ProblemTitle());
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_MASTER_INSERT_MY_DOCUMENT");
    }

    [Fact]
    public async Task Documents_outside_the_guideline_folders_are_not_served()
    {
        Directory.CreateDirectory(Path.Combine(_host.StorageRoot, "Certificates", "ZEDMSME1"));
        await File.WriteAllBytesAsync(Path.Combine(_host.StorageRoot, "Certificates", "ZEDMSME1", "Pledge.pdf"), PdfBytes);
        _documents.Add(new() { ["Id"] = 6, ["DocumentName"] = "Bad", ["DocumentPath"] = "Certificates/ZEDMSME1/Pledge.pdf" });
        _documents.Add(new() { ["Id"] = 7, ["DocumentName"] = "Worse", ["DocumentPath"] = "Uploads/Documents/../../Certificates/ZEDMSME1/Pledge.pdf" });
        var client = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/staff/masters/documents/6/file")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/staff/masters/documents/7/file")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.DeleteAsync("/api/staff/masters/documents/99")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.DeleteAsync("/api/staff/masters/documents/6")).StatusCode);
        Assert.Equal("6", FakeSql.Arg(Call("SP_MASTER_DELETE_MY_DOCUMENT").Args, "Id"));
    }

    [Fact]
    public async Task Banner_must_be_a_real_png_and_is_stored_under_images_homepage()
    {
        var client = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var jpg = await client.PostAsync("/api/staff/masters/page-settings/banner", Upload([0xFF, 0xD8, 0xFF, 0xE0], "b.jpg", "image/jpeg", null));
        Assert.Equal(HttpStatusCode.BadRequest, jpg.StatusCode);
        var fake = await client.PostAsync("/api/staff/masters/page-settings/banner", Upload(PdfBytes, "b.png", "image/png", null));
        Assert.Equal(HttpStatusCode.BadRequest, fake.StatusCode);

        var ok = await client.PostAsync("/api/staff/masters/page-settings/banner", Upload(PngBytes, "x.png", "image/png", null));
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var insert = Call("SP_MASTER_INSERT_HOME_PAGE_SETTINGS");
        Assert.Equal("HomePageBanner", FakeSql.Arg(insert.Args, "FileName"));
        var stored = FakeSql.Arg(insert.Args, "FilePath")!;
        Assert.Matches(@"^Images\\HomePage\\Banner_\d{14}_[0-9a-f]{8}\.png$", stored);

        _host.Sql.Procs["SP_MASTER_GET_HOME_PAGE_SETTINGS"] = _ => FakeSql.Sets([new
        {
            FileName = "HomePageBanner", FilePath = "https://loginzed.msme.gov.in/" + stored.Replace('\\', '/'), CreatedDate = new DateTime(2026, 10, 1, 9, 30, 0),
        }]);
        var settings = await client.GetFromJsonAsync<JsonElement>("/api/staff/masters/page-settings");
        Assert.True(settings.GetProperty("hasBanner").GetBoolean());
        var image = await client.GetAsync(settings.GetProperty("imageUrl").GetString());
        Assert.Equal(HttpStatusCode.OK, image.StatusCode);
        Assert.Equal("image/png", image.Content.Headers.ContentType?.MediaType);

        // The public login page gets the same file from the storage root, not the old site's URL (not served by V4).
        var anonymous = _host.CreateClient();
        var banner = (await anonymous.GetFromJsonAsync<JsonElement>("/api/msme/auth/banner")).GetProperty("imageUrl").GetString()!;
        Assert.StartsWith("/api/msme/auth/banner/image?v=Banner_", banner);
        var publicImage = await anonymous.GetAsync(banner);
        Assert.Equal(HttpStatusCode.OK, publicImage.StatusCode);
        Assert.Equal("image/png", publicImage.Content.Headers.ContentType?.MediaType);

        // A recorded banner whose file is not in the storage root (only on the old site): no URL, the page's default shows.
        _host.Sql.Procs["SP_MASTER_GET_HOME_PAGE_SETTINGS"] = _ => FakeSql.Sets([new
        {
            FileName = "HomePageBanner", FilePath = "https://zedstaging.qcin.org/Images/HomePage/Banner_20260820121144.png", CreatedDate = new DateTime(2026, 8, 20),
        }]);
        Assert.Equal(JsonValueKind.Null, (await anonymous.GetFromJsonAsync<JsonElement>("/api/msme/auth/banner")).GetProperty("imageUrl").ValueKind);
        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync("/api/msme/auth/banner/image")).StatusCode);
    }
}
