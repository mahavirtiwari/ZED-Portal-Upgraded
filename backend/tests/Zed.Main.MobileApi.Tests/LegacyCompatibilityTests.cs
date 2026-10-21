using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Zed.Core.Data;
using Zed.Core.Mobile;

namespace Zed.Main.MobileApi.Tests;

/// <summary>The MVC 5 binding and response behaviour the installed apps depend on.</summary>
public sealed class LegacyCompatibilityTests : IClassFixture<MobileTestHost>
{
    private readonly MobileTestHost _host;
    private readonly HttpClient _client;

    public LegacyCompatibilityTests(MobileTestHost host)
    {
        _host = host;
        _client = host.CreateClient();
    }

    private static StringContent Json(string json) => new(json, Encoding.UTF8, "application/json");

    private async Task<JsonElement> Post(string url, HttpContent? content)
    {
        var r = await _client.PostAsync(url, content);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        return JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement;
    }

    [Fact]
    public async Task Json_body_binds_any_case_with_strings_for_numbers_and_numbers_for_strings()
    {
        var e = await Post("/probe/echo", Json("""
            {"UserName":"ZEDMSME000001","zedid":12345,"count":"7","optional":"","amount":"2360.50","flag":"true",
             "deviceInfo":{"DeviceId":"abc","apiLevel":"33"},"photos":[{"photoId":"p1","isPdf":1}],"tags":"one"}
            """));
        Assert.Equal("ZEDMSME000001", e.GetProperty("userName").GetString());
        Assert.Equal("12345", e.GetProperty("zedId").GetString());
        Assert.Equal(7, e.GetProperty("count").GetInt32());
        Assert.Equal(JsonValueKind.Null, e.GetProperty("optional").ValueKind);
        Assert.Equal(2360.50m, e.GetProperty("amount").GetDecimal());
        Assert.True(e.GetProperty("flag").GetBoolean());
        Assert.Equal("abc", e.GetProperty("deviceId").GetString());
        Assert.Equal(33, e.GetProperty("apiLevel").GetInt32());
        Assert.True(e.GetProperty("photos")[0].GetProperty("isPdf").GetBoolean());
        Assert.Equal("one", e.GetProperty("tags")[0].GetString());
    }

    [Fact]
    public async Task Form_fields_with_dotted_and_indexed_names_become_nested_objects_and_lists()
    {
        var e = await Post("/Probe/Echo", new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["userName"] = "U1",
            ["deviceInfo.deviceId"] = "dev-1",
            ["photos[0].photoId"] = "a",
            ["photos[1][photoId]"] = "b",
            ["photos[1].isPdf"] = "true,false",
            ["count"] = "not a number",
        }));
        Assert.Equal("U1", e.GetProperty("userName").GetString());
        Assert.Equal("dev-1", e.GetProperty("deviceId").GetString());
        Assert.Equal("a", e.GetProperty("photos")[0].GetProperty("photoId").GetString());
        Assert.Equal("b", e.GetProperty("photos")[1].GetProperty("photoId").GetString());
        Assert.True(e.GetProperty("photos")[1].GetProperty("isPdf").GetBoolean());
        Assert.Equal(0, e.GetProperty("count").GetInt32());
    }

    [Fact]
    public async Task Simple_parameters_read_query_string_and_form_with_form_taking_precedence()
    {
        var e = await Post("/probe/simple?userName=FromQuery&version=1.0.0&ncCount=2",
            new FormUrlEncodedContent(new Dictionary<string, string> { ["USERNAME"] = "FromForm" }));
        Assert.Equal("FromForm", e.GetProperty("userName").GetString());
        Assert.Equal("1.0.0", e.GetProperty("version").GetString());
        Assert.Equal(2, e.GetProperty("ncCount").GetInt32());
    }

    [Fact]
    public async Task Complex_parameter_is_never_null_even_for_an_empty_or_broken_body()
    {
        Assert.Equal(JsonValueKind.Null, (await Post("/probe/echo", null)).GetProperty("userName").ValueKind);
        Assert.Equal(JsonValueKind.Null, (await Post("/probe/echo", Json("{not json"))).GetProperty("userName").ValueKind);
    }

    [Fact]
    public async Task Multipart_files_bind_to_list_parameters_single_parameters_and_nested_model_properties()
    {
        var form = new MultipartFormDataContent
        {
            { new StringContent("U2"), "userName" },
            { new StringContent("p1"), "photos[0].photoId" },
            { File("a.jpg"), "files", "a.jpg" },
            { File("b.jpg"), "files", "b.jpg" },
            { File("v.mp4"), "video_data", "v.mp4" },
        };
        var e = await Post("/probe/files", form);
        Assert.Equal("U2", e.GetProperty("userName").GetString());
        Assert.Equal(["a.jpg", "b.jpg"], e.GetProperty("files").EnumerateArray().Select(x => x.GetString()));
        Assert.Equal("v.mp4", e.GetProperty("video").GetString());

        var nested = new MultipartFormDataContent
        {
            { new StringContent("p1"), "photos[0].photoId" },
            { File("n.pdf"), "photos[0].file_data", "n.pdf" },
        };
        var n = await Post("/probe/echo", nested);
        Assert.Equal("n.pdf", n.GetProperty("photos")[0].GetProperty("file").GetString());

        static ByteArrayContent File(string name)
        {
            var c = new ByteArrayContent([1, 2, 3]);
            c.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
            return c;
        }
    }

    [Fact]
    public async Task Json_output_matches_JavaScriptSerializer_dates_nulls_and_names()
    {
        var r = await _client.PostAsync("/probe/dates", null);
        Assert.Equal("application/json; charset=utf-8", r.Content.Headers.ContentType!.ToString());
        var text = await r.Content.ReadAsStringAsync();
        Assert.Contains("\"at\":\"\\/Date(1704164645000)\\/\"", text);
        Assert.Contains("\"none\":null", text);
        // HTML-sensitive characters escaped, Hindi text left readable, as JavaScriptSerializer did.
        // (STJ writes < where JavaScriptSerializer wrote <; JSON parsers read both the same.)
        Assert.Contains("\\u003cb\\u003eहिन्दी\\u003c/b\\u003e", text, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Unhandled_errors_return_the_legacy_failure_body_without_the_exception_text()
    {
        var r = await _client.PostAsync("/probe/boom", null);
        Assert.Equal(HttpStatusCode.InternalServerError, r.StatusCode);
        var text = await r.Content.ReadAsStringAsync();
        Assert.Contains("\"status\":\"0\"", text);
        Assert.DoesNotContain("secret detail", text);
    }

    [Theory]
    [InlineData("..")]
    [InlineData("../../etc")]
    [InlineData("a\\b")]
    [InlineData("C:")]
    [InlineData("")]
    public async Task Storage_refuses_request_values_that_are_not_plain_names(string name)
    {
        var e = await Post("/probe/traverse", new FormUrlEncodedContent(new Dictionary<string, string> { ["name"] = name }));
        Assert.Equal("0", e.GetProperty("status").GetString());
        Assert.Equal("Invalid Data.", e.GetProperty("errorMessage").GetString());
    }

    [Fact]
    public async Task Storage_accepts_a_plain_name_under_the_root()
    {
        var e = await Post("/probe/traverse", new FormUrlEncodedContent(new Dictionary<string, string> { ["name"] = "ZEDMSME000001" }));
        Assert.StartsWith(Path.GetFullPath(_host.StorageRoot), e.GetProperty("path").GetString());
    }

    [Fact]
    public async Task Home_page_answers_at_the_root()
    {
        Assert.Equal(HttpStatusCode.OK, (await _client.GetAsync("/")).StatusCode);
    }
}

public sealed class LegacyResultsTests
{
    [Fact]
    public void DataSet_json_names_tables_drops_password_columns_and_uses_Newtonsoft_formats()
    {
        var sets = FakeSql.Sets(
            [new Dictionary<string, object?> { ["ZedId"] = "Z1", ["Password"] = "x", ["Amount"] = 2360m, ["Rate"] = 1.5m, ["At"] = new DateTime(2024, 5, 1, 10, 0, 0), ["Note"] = DBNull.Value }],
            [],
            [new Dictionary<string, object?> { ["Ok"] = true }]);
        var json = LegacyResults.DataSetJson(sets, ["Guidelines", "Certificates"]);
        Assert.Equal("""{"Guidelines":[{"ZedId":"Z1","Amount":2360.0,"Rate":1.5,"At":"2024-05-01T10:00:00","Note":null}],"Certificates":[],"Table2":[{"Ok":true}]}""", json);
    }

    [Fact]
    public void Legacy_date_text_is_read_back()
    {
        var d = JsonSerializer.Deserialize<DateTime?>("\"\\/Date(1704164645000)\\/\"", LegacyJson.Read);
        Assert.Equal(new DateTime(2024, 1, 2, 3, 4, 5, DateTimeKind.Utc), d!.Value.ToUniversalTime());
    }
}
