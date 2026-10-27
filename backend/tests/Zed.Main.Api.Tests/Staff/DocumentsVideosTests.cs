using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Core.Content;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>Admin → Documents/Videos: description, video links and the roles that may open each document; staff see theirs.</summary>
public sealed class DocumentsVideosTests : IDisposable
{
    private const string Url = "/api/staff/masters/documents";
    private readonly TestHost _host = new();
    private readonly List<Dictionary<string, object?>> _documents = [];
    private readonly List<DocumentAccessRow> _access = [];

    public DocumentsVideosTests()
    {
        UsersMastersLogin.Setup(_host);
        _host.Sql.Procs["SP_MASTER_GET_MY_DOCUMENTS"] = _ => FakeSql.Sets(_documents.Cast<object>());
        _host.Sql.Procs["SP_MASTER_INSERT_MY_DOCUMENT"] = args =>
        {
            _documents.Add(new() { ["Id"] = 20 + _documents.Count, ["DocumentName"] = FakeSql.Arg(args, "DocumentName"), ["DocumentPath"] = FakeSql.Arg(args, "DocumentPath"), ["OrderNo"] = _documents.Count + 1 });
            return FakeSql.Sets();
        };
        _host.Sql.Queries["SELECT a.DocumentId, d.OrderNo"] = _ => _access.Cast<object>();
    }

    public void Dispose() => _host.Dispose();

    private (string Name, object? Args) Merge() => _host.Sql.Calls.Last(c => c.Name.StartsWith("MERGE dbo.V4DocumentAccess", StringComparison.Ordinal));

    private static MultipartFormDataContent Video(string name = "How to apply", string? roles = "assessor,msme", string? url = "https://www.youtube.com/watch?v=abc", string? description = "A short tour")
    {
        var form = new MultipartFormDataContent { { new StringContent(name), "documentName" } };
        if (roles is not null) form.Add(new StringContent(roles), "roles");
        if (url is not null) form.Add(new StringContent(url), "videoUrl");
        if (description is not null) form.Add(new StringContent(description), "description");
        return form;
    }

    [Fact]
    public async Task A_video_link_is_listed_without_a_file_and_given_to_the_roles_ticked()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var r = await admin.PostAsync(Url, Video());
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);

        var insert = _host.Sql.Calls.Last(c => c.Name == "SP_MASTER_INSERT_MY_DOCUMENT");
        Assert.Null(FakeSql.Arg(insert.Args, "DocumentPath"));
        var merge = Merge();
        Assert.Equal("20", FakeSql.Arg(merge.Args, "DocumentId"));
        // Stored in the page's order of the roles.
        Assert.Equal("msme,assessor", FakeSql.Arg(merge.Args, "Roles"));
        Assert.Equal("https://www.youtube.com/watch?v=abc", FakeSql.Arg(merge.Args, "VideoUrl"));
        Assert.Equal("A short tour", FakeSql.Arg(merge.Args, "Description"));

        var body = await admin.GetFromJsonAsync<JsonElement>(Url);
        Assert.Contains(body.GetProperty("roles").EnumerateArray(), r => r.GetProperty("key").GetString() == "msme" && r.GetProperty("label").GetString() == "MSME Enterprises");
        // A document from before V4 (no row) goes to the MSMEs only.
        Assert.Equal(["msme"], body.GetProperty("documents")[0].GetProperty("roles").EnumerateArray().Select(x => x.GetString()));
    }

    [Theory]
    [InlineData(null, "https://www.youtube.com/watch?v=abc", "x", "at least one role")]
    [InlineData("msme,dfo", "https://www.youtube.com/watch?v=abc", "x", "not a role of this portal")]
    [InlineData("msme", "http://www.youtube.com/watch?v=abc", "x", "https://")]
    [InlineData("msme", "javascript:alert(1)", "x", "https://")]
    [InlineData("msme", "https://www.youtube.com/watch?v=abc", "long", "up to 300 characters")]
    public async Task Refuses_what_cannot_be_shown(string? roles, string url, string description, string message)
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var r = await admin.PostAsync(Url, Video(roles: roles, url: url, description: description == "long" ? new string('a', 301) : description));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Contains(message, await r.ProblemTitle());
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_MASTER_INSERT_MY_DOCUMENT");
    }

    [Fact]
    public async Task Edit_renames_and_changes_the_roles()
    {
        _documents.Add(new() { ["Id"] = 7, ["DocumentName"] = "Guide", ["DocumentPath"] = "Uploads\\Documents\\g.pdf", ["OrderNo"] = 1 });
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var r = await admin.PutAsJsonAsync($"{Url}/7", new { documentName = "ZED Guide", description = "Updated", roles = new[] { "agency", "msme" } });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Contains(_host.Sql.Calls, c => c.Name.StartsWith("UPDATE MyDocuments SET DocumentName", StringComparison.Ordinal) && FakeSql.Arg(c.Args, "DocumentName") == "ZED Guide");
        Assert.Equal("msme,agency", FakeSql.Arg(Merge().Args, "Roles"));
        // A file document has no video link.
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync($"{Url}/7", new { documentName = "G", roles = new[] { "msme" }, videoUrl = "https://x.in/v" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PutAsJsonAsync($"{Url}/99", new { documentName = "G", roles = new[] { "msme" } })).StatusCode);
    }

    [Fact]
    public async Task Staff_see_the_documents_given_to_their_role_only()
    {
        Directory.CreateDirectory(Path.Combine(_host.StorageRoot, "Uploads", "Documents"));
        await File.WriteAllTextAsync(Path.Combine(_host.StorageRoot, "Uploads", "Documents", "a.pdf"), "%PDF-1.4 a");
        _documents.Add(new() { ["Id"] = 7, ["DocumentName"] = "For assessors", ["DocumentPath"] = "Uploads\\Documents\\a.pdf", ["OrderNo"] = 1 });
        _documents.Add(new() { ["Id"] = 8, ["DocumentName"] = "For MSMEs", ["DocumentPath"] = "Uploads\\Documents\\a.pdf", ["OrderNo"] = 2 });
        _documents.Add(new() { ["Id"] = 9, ["DocumentName"] = "Tour", ["DocumentPath"] = null, ["OrderNo"] = 3 });
        _access.Add(new DocumentAccessRow(7, 1, "Read me", null, "assessor", "ADMIN1", null));
        _access.Add(new DocumentAccessRow(9, 3, null, "https://www.youtube.com/watch?v=t", "assessor,msme", "ADMIN1", null));

        var assessor = await UsersMastersLogin.SignInAsync(_host, "ASSESSOR1");
        var mine = await assessor.GetFromJsonAsync<JsonElement>("/api/staff/documents");
        Assert.Equal(["For assessors", "Tour"], mine.EnumerateArray().Select(d => d.GetProperty("documentName").GetString()));
        Assert.Equal("/api/staff/documents/7/file", mine[0].GetProperty("downloadUrl").GetString());
        Assert.Equal("https://www.youtube.com/watch?v=t", mine[1].GetProperty("videoUrl").GetString());
        Assert.Equal(HttpStatusCode.OK, (await assessor.GetAsync("/api/staff/documents/7/file")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await assessor.GetAsync("/api/staff/documents/8/file")).StatusCode);

        var master = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        Assert.Empty((await master.GetFromJsonAsync<JsonElement>("/api/staff/documents")).EnumerateArray());
        Assert.Equal(HttpStatusCode.Unauthorized, (await (await _host.CreateBrowserAsync()).GetAsync("/api/staff/documents")).StatusCode);
    }
}
