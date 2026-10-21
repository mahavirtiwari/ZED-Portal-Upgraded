using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;

namespace Zed.Main.MobileApi.Tests;

/// <summary>Msme/SubmitSurveillancePhoto on the Surveillance deployment (finding #108).</summary>
public sealed class SurveillancePhotoTests : IDisposable
{
    private const string Zed = "ZEDMSME000001";
    private static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 4];
    private readonly SurveillanceAppHost _t = new();

    public SurveillancePhotoTests()
    {
        _t.Fake.Procs["SP_APP_SYNC_SUVEILLANCE_PHOTOS"] = _ => FakeSql.Sets([new { StatusCode = 1, Message = "Success" }]);
    }

    public void Dispose() => _t.Dispose();

    private static MultipartFormDataContent Form(byte[] file, string field = "exterior", string photoId = "p1", string cert = "Silver", string? name = null)
    {
        var form = new MultipartFormDataContent
        {
            { new StringContent(Zed), "userName" },
            { new StringContent(cert), "certificationType" },
            { new StringContent(JsonSerializer.Serialize(new { photoId, name, timeStamp = "t", latitude = "1", longitude = "2" })), field },
            { new StringContent("dev-1"), "deviceInfo.deviceId" },
        };
        var content = new ByteArrayContent(file);
        content.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
        form.Add(content, "file_data", "photo.jpg");
        return form;
    }

    private static void AssertFail(JsonElement e, string message)
    {
        Assert.Equal("0", e.GetProperty("status").GetString());
        Assert.Equal(message, e.GetProperty("errorMessage").GetString());
    }

    [Fact]
    public async Task A_photo_for_an_open_site_surveillance_is_stored_and_recorded()
    {
        _t.Sql.Unit(Zed, "Silver", null, status: 13, siteAssessor: "ZEDAS0001");
        var (e, _) = await _t.Send("/msme/submitsurveillancephoto", Form(Jpeg));
        Assert.Equal("1", e.GetProperty("status").GetString());
        Assert.Equal("Success", e.GetProperty("errorMessage").GetString());
        Assert.Equal(Jpeg, File.ReadAllBytes(_t.FileUnderRoot("SaPhotos", Zed, "Silver", "SiteTour", "p1.jpg")));
        var args = _t.Args("SP_APP_SYNC_SUVEILLANCE_PHOTOS");
        Assert.Equal(Zed, SurveillanceAppHost.Arg(args, "AssessorId"));
        Assert.Equal("SiteTour", SurveillanceAppHost.Arg(args, "PhotoType"));
        var row = SurveillanceAppHost.Tvp(args, "PhotoList")!.Rows[0];
        Assert.Equal("p1", row["PhotoId"]);
        Assert.Equal("Site Exterior Photo", row["Name"]);
    }

    [Fact]
    public async Task A_file_that_is_not_an_image_is_refused()
    {
        _t.Sql.Unit(Zed, "Silver", null, status: 9, siteAssessor: "ZEDAS0001");
        var (e, _) = await _t.Send("/Msme/SubmitSurveillancePhoto", Form("<html>"u8.ToArray()));
        AssertFail(e, "Invalid File Data.");
        Assert.Empty(_t.AllFiles());
        Assert.Empty(_t.CallsTo("SP_APP_SYNC_SUVEILLANCE_PHOTOS"));
    }

    [Theory]
    [InlineData(8, "Cannot Sync Now. Please check with Assessor as final submission done from their end.")]
    [InlineData(14, "Cannot Sync Now. Please check with Assessor as final submission done from their end.")]
    public async Task Outside_the_meeting_window_nothing_is_written(int status, string message)
    {
        _t.Sql.Unit(Zed, "Silver", null, status: status, siteAssessor: "ZEDAS0001");
        AssertFail((await _t.Send("/Msme/SubmitSurveillancePhoto", Form(Jpeg))).Body, message);
        Assert.Empty(_t.AllFiles());
    }

    [Fact]
    public async Task A_unit_without_a_site_assessment_or_a_bronze_level_is_refused()
    {
        _t.Sql.Unit(Zed, "Bronze", "ZEDBAS0001", status: 9);
        AssertFail((await _t.Send("/Msme/SubmitSurveillancePhoto", Form(Jpeg))).Body, "Invalid Details.");
        AssertFail((await _t.Send("/Msme/SubmitSurveillancePhoto", Form(Jpeg, cert: "Bronze"))).Body, "Invalid Details.");
        Assert.Empty(_t.AllFiles());
        Assert.Empty(_t.CallsTo("SP_APP_SYNC_SUVEILLANCE_PHOTOS"));
    }

    [Fact]
    public async Task A_photo_id_that_leaves_the_folder_is_refused()
    {
        _t.Sql.Unit(Zed, "Silver", null, status: 9, siteAssessor: "ZEDAS0001");
        AssertFail((await _t.Send("/Msme/SubmitSurveillancePhoto", Form(Jpeg, photoId: "../../evil"))).Body, "Invalid Data.");
        Assert.Empty(_t.AllFiles());
    }

    [Fact]
    public async Task Missing_file_or_photo_information_keeps_the_old_messages()
    {
        var noFile = new MultipartFormDataContent { { new StringContent(Zed), "userName" } };
        AssertFail((await _t.Send("/Msme/SubmitSurveillancePhoto", noFile)).Body, "Invalid File Data.");
        var form = Form(Jpeg, photoId: "");
        AssertFail((await _t.Send("/Msme/SubmitSurveillancePhoto", form)).Body, "Invalid Photo Information.");
    }

    [Fact]
    public async Task The_controller_is_served_only_at_its_old_address()
    {
        var r = await _t.Client.PostAsync("/SurveillancePhoto/Submit", Form(Jpeg));
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }
}
