using System.Data;
using System.Net;
using System.Net.Http.Json;
using System.Reflection;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Zed.Main.Api.Tests;
using Zed.Portal.Features.Remote;

namespace Zed.Surveillance.Api.Tests;

/// <summary>The surveillance remote page: meeting link instead of Twilio, recording links, uploaded meeting photos and selfie.</summary>
public sealed class SurveillanceRemoteTests : IDisposable
{
    private const string Zed = "ZEDMSME000001";
    private const string Base = "/api/staff/remote/" + Zed + "/Silver";
    private const string Link = "https://meet.example/abc-defg-hij";

    private readonly TestHost _host = new();
    private readonly WebApplicationFactory<Program> _app;
    private int _status = 9;
    private string _mode = "Onsite Assessment";
    private int _recordings = 1;
    private readonly List<string> _photoNames = [];

    private static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01];
    private static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00];
    private static string DataUrl(byte[] b, string type = "jpeg") => $"data:image/{type};base64," + Convert.ToBase64String(b);

    public SurveillanceRemoteTests()
    {
        _app = _host.WithTestSignIn();
        _host.Sql.Queries[RemoteAssessmentController.RecordSql[..60]] = args => FakeSql.Arg(args, "ZedId") == Zed && FakeSql.Arg(args, "Certification") == "Silver"
            ? [new { Id = 5L, ZedId = Zed, Certification = "Silver", CertificationStatus = _status, NcCount = 0, SiteAssessorId = "ASR1", CoAssessorId = "ASR2", ModeOfAssessment = _mode }]
            : [];
        _host.Sql.Queries["SELECT TOP 1 CAST(Id AS bigint) AS Id, MeetingType FROM Meetings"] = args => FakeSql.Arg(args, "Id") switch
        {
            "71" => [new { Id = 71L, MeetingType = "Open Meeting" }],
            "72" => [new { Id = 72L, MeetingType = "Close Meeting" }],
            _ => [],
        };
        _host.Sql.Queries[RemoteAssessmentController.RecordingLinksSql[..50]] = _ => Enumerable.Range(1, _recordings).Select(i => (object)new { Id = (long)i });
        _host.Sql.Queries[RemoteAssessmentController.SurveillancePhotosSql[..50]] = args =>
            _photoNames.Where(n => n.StartsWith(FakeSql.Arg(args, "Name")!.TrimEnd('%'), StringComparison.Ordinal)).Select(n => (object)new { Id = 1L });
        _host.Sql.Queries[RemoteAssessmentController.SurveillanceTourPhotoSql[..60]] = args =>
            FakeSql.Arg(args, "Id") == "85" && FakeSql.Arg(args, "ZedId") == Zed ? [new { Id = 85L, PhotoId = "20261021101010123", Name = "Shop floor" }] : [];
        _host.Sql.Queries["SELECT TOP 1 CAST(Id AS bigint) AS Id, NcCount FROM MsmeRequirements"] = args =>
            FakeSql.Arg(args, "Id") == "51" ? [new { Id = 51L, NcCount = 0 }] : [];
        _host.Sql.Queries["SELECT TOP 1 CAST(Id AS bigint) AS Id FROM SaPhotos"] = args =>
            FakeSql.Arg(args, "Id") is "61" or "62" && FakeSql.Arg(args, "UserId") == "ASR1" ? [new { Id = long.Parse(FakeSql.Arg(args, "Id")!) }] : [];
        _host.Sql.Queries[RemoteAssessmentController.RequirementPhotoSql[..50]] = args =>
            FakeSql.Arg(args, "Id") == "62" ? [new { Id = 62L }] : [];

        _host.Sql.Procs["SP_ASSESSMENT_DA_DETAILS"] = _ => FakeSql.Sets(
            [new { ZedId = Zed, Certification = "Silver", EnterpriseName = "Acme", CertificationStatus = _status, MeetingLink = Link, PhotosPath = (string?)null }]);
        _host.Sql.Procs["SP_ASSESSMENT_SA_DETAILS"] = _ =>
        {
            var sets = Enumerable.Range(0, 16).Select(_ => (IEnumerable<object>)[]).ToArray();
            sets[1] = [new { Id = 71L, MeetingType = "Open Meeting", Comments = "Hello" }];
            sets[3] = [new { Id = 72L, MeetingType = "Close Meeting", Comments = (string?)null }];
            sets[5] = [new { Id = 61L, name = "Opening Meeting Photo_1", AssessorId = "ASR1",
                             src = "https://loginzed.msme.gov.in/surveillancemobileapi/SaPhotos/ZEDMSME000001/Silver/Opening Meeting Photo_1.jpg" }];
            sets[6] = [new { Id = 85L, name = "Shop floor", AssessorId = (string?)null,
                             src = "https://loginzed.msme.gov.in/surveillancemobileapi/SaPhotos/ZEDMSME000001/Silver/SiteTour/20261021101010123.jpg" }];
            sets[12] = [new { Id = 63L, AssessorId = "ASR1", src = (string?)null,
                              PhotoPath = "https://loginzed.msme.gov.in/surveillancemobileapi/SaPhotos/ZEDMSME000001/Silver/Selfie on Site_2.jpg" }];
            sets[15] = [new { Id = 1, RecordingLink = "https://rec.example/1" }, new { Id = 2, RecordingLink = "javascript:alert(1)" }];
            return FakeSql.Sets(sets);
        };
    }

    public void Dispose()
    {
        _app.Dispose();
        _host.Dispose();
    }

    private Task<HttpClient> Assessor(string user = "ASR1") => StaffTestSignIn.BrowserAsync(_app, user, 3, "SiteVerification");
    private IEnumerable<object?> CallsTo(string proc) => _host.Sql.Calls.Where(c => c.Name == proc).Select(c => c.Args);

    private static DataTable? Tvp(object? args, string name)
    {
        var tvp = args?.GetType().GetProperty(name)?.GetValue(args);
        return tvp?.GetType().GetFields(BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public)
            .Select(f => f.GetValue(tvp)).OfType<DataTable>().FirstOrDefault();
    }

    // ----- page -----

    [Fact]
    public async Task Opens_for_onsite_units_with_the_meeting_link_and_safe_recording_links()
    {
        var json = await (await Assessor()).GetFromJsonAsync<JsonElement>(Base);
        Assert.True(json.GetProperty("usesMeetingLink").GetBoolean());
        Assert.Equal(Link, json.GetProperty("meetingLink").GetString());
        var links = json.GetProperty("recordingLinks");
        Assert.Equal("https://rec.example/1", Assert.Single(links.EnumerateArray()).GetProperty("url").GetString());
        Assert.False(json.GetProperty("permissions").GetProperty("videoConfigured").GetBoolean());
        Assert.True(json.GetProperty("permissions").GetProperty("canAssess").GetBoolean());

        // Photos of the surveillance app are served through the page's file endpoint.
        var photo = json.GetProperty("openMeeting").GetProperty("photos")[0];
        Assert.Equal(Base + "/files/surveillancemobileapi/SaPhotos/" + Zed + "/Silver/Opening%20Meeting%20Photo_1.jpg", photo.GetProperty("url").GetString());
        Assert.True(photo.GetProperty("deletable").GetBoolean());
        Assert.EndsWith("Selfie%20on%20Site_2.jpg", json.GetProperty("selfies")[0].GetProperty("url").GetString());
        Assert.NotNull(json.GetProperty("siteTourPhotos")[0].GetProperty("url").GetString());
    }

    [Fact]
    public async Task Units_in_other_modes_or_of_other_assessors_are_not_found()
    {
        Assert.Equal(HttpStatusCode.NotFound, (await (await Assessor("ASR3")).GetAsync(Base)).StatusCode);
        _mode = "Desktop";
        Assert.Equal(HttpStatusCode.NotFound, (await (await Assessor()).GetAsync(Base)).StatusCode);
    }

    [Fact]
    public async Task Photos_are_served_from_the_surveillance_app_folder()
    {
        var path = Path.Combine(_host.StorageRoot, "surveillancemobileapi", "SaPhotos", Zed, "Silver");
        Directory.CreateDirectory(path);
        await File.WriteAllBytesAsync(Path.Combine(path, "Opening Meeting Photo_1.jpg"), Jpeg);
        var client = await Assessor("ASR2");
        var r = await client.GetAsync(Base + "/files/surveillancemobileapi/SaPhotos/" + Zed + "/Silver/Opening%20Meeting%20Photo_1.jpg");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(Base + "/files/surveillancemobileapi/SaPhotos/ZEDMSME000002/Silver/x.jpg")).StatusCode);
    }

    [Fact]
    public async Task There_is_no_video_room()
    {
        var r = await (await Assessor()).PostAsJsonAsync(Base + "/join", new { });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Empty(CallsTo("SP_ASSESSMENT_RA_UPDATE_JOIN_ROOM_STATUS"));
    }

    // ----- recording links -----

    [Fact]
    public async Task Lead_adds_a_recording_link_to_the_closing_meeting()
    {
        var r = await (await Assessor()).PostAsJsonAsync(Base + "/meetings/72/recording-links", new { link = "https://rec.example/2" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var args = Assert.Single(CallsTo("SP_ASSESSMENT_RA_UPDATE_COMMENTS"));
        Assert.Equal("MeetingRecordingLink", FakeSql.Arg(args, "TableName"));
        Assert.Equal("72", FakeSql.Arg(args, "Id"));
        Assert.Equal("https://rec.example/2", FakeSql.Arg(args, "Comments"));
        Assert.Equal("Silver", FakeSql.Arg(args, "Certification"));
    }

    [Fact]
    public async Task Recording_links_are_checked()
    {
        var lead = await Assessor();
        Assert.Equal(HttpStatusCode.BadRequest, (await lead.PostAsJsonAsync(Base + "/meetings/72/recording-links", new { link = "javascript:alert(1)" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await lead.PostAsJsonAsync(Base + "/meetings/71/recording-links", new { link = "https://rec.example/2" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await (await Assessor("ASR2")).PostAsJsonAsync(Base + "/meetings/72/recording-links", new { link = "https://rec.example/2" })).StatusCode);
        _recordings = 6;
        Assert.Equal(HttpStatusCode.BadRequest, (await lead.PostAsJsonAsync(Base + "/meetings/72/recording-links", new { link = "https://rec.example/7" })).StatusCode);
        _recordings = 1;
        _status = 14;
        Assert.Equal(HttpStatusCode.Forbidden, (await lead.PostAsJsonAsync(Base + "/meetings/72/recording-links", new { link = "https://rec.example/2" })).StatusCode);
        Assert.Empty(CallsTo("SP_ASSESSMENT_RA_UPDATE_COMMENTS"));
    }

    // ----- uploaded photos -----

    [Theory]
    [InlineData("OpenMeeting", 71, "Opening Meeting Photo_", "Open Meeting")]
    [InlineData("CloseMeeting", 72, "Closing Meeting Photo_", "Close Meeting")]
    [InlineData("Selfie", null, "Selfie on Site_", "Open Meeting")]
    public async Task Uploads_are_stored_with_the_legacy_names_through_the_SA_photo_procedure(string target, int? targetId, string prefix, string photoType)
    {
        var r = await (await Assessor()).PostAsJsonAsync(Base + "/photos", new { target, targetId, image = DataUrl(Jpeg) });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);

        var args = Assert.Single(CallsTo("SP_APP_SA_SAVE_PHOTOS"));
        Assert.Equal(Zed, FakeSql.Arg(args, "ZedId"));
        Assert.Equal("ASR1", FakeSql.Arg(args, "AssessorId"));
        Assert.Equal("Silver", FakeSql.Arg(args, "CertificationType"));
        Assert.Equal(photoType, FakeSql.Arg(args, "PhotoType"));
        var row = Assert.Single(Tvp(args, "PhotoList")!.Rows.Cast<DataRow>());
        var name = (string)row["Name"];
        Assert.StartsWith(prefix, name);
        Assert.Equal(name, prefix + (string)row["PhotoId"]);

        var file = Path.Combine(_host.StorageRoot, "surveillancemobileapi", "SaPhotos", Zed, "Silver", name + ".jpg");
        Assert.Equal(Jpeg, await File.ReadAllBytesAsync(file));
        Assert.Empty(CallsTo("SP_ASSESSMENT_RA_UPDATE_PHOTOS"));
    }

    [Fact]
    public async Task Uploads_are_checked()
    {
        var lead = await Assessor();
        Assert.Equal(HttpStatusCode.BadRequest, (await lead.PostAsJsonAsync(Base + "/photos", new { target = "OpenMeeting", targetId = 71, image = DataUrl(Png, "png") })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await lead.PostAsJsonAsync(Base + "/photos", new { target = "OpenMeeting", targetId = 71, image = "data:image/jpeg;base64,PHNjcmlwdD4=" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await lead.PostAsJsonAsync(Base + "/photos", new { target = "OpenMeeting", targetId = 72, image = DataUrl(Jpeg) })).StatusCode);
        // Frame captures of the Twilio page do not exist here.
        Assert.Equal(HttpStatusCode.BadRequest, (await lead.PostAsJsonAsync(Base + "/photos", new { target = "SiteTour", image = DataUrl(Jpeg) })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await (await Assessor("ASR2")).PostAsJsonAsync(Base + "/photos", new { target = "Selfie", image = DataUrl(Jpeg) })).StatusCode);
        _photoNames.Add("Selfie on Site_20261021");
        Assert.Equal(HttpStatusCode.BadRequest, (await lead.PostAsJsonAsync(Base + "/photos", new { target = "Selfie", image = DataUrl(Jpeg) })).StatusCode);
        Assert.Empty(CallsTo("SP_APP_SA_SAVE_PHOTOS"));
        Assert.False(Directory.Exists(Path.Combine(_host.StorageRoot, "surveillancemobileapi")));
    }

    [Fact]
    public async Task Site_tour_photo_as_evidence_uses_the_address_the_surveillance_procedure_expects()
    {
        var r = await (await Assessor()).PostAsJsonAsync(Base + "/photos", new { target = "Requirement", targetId = 51, fromPhotoId = 85 });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var args = Assert.Single(CallsTo("SP_ASSESSMENT_RA_UPDATE_PHOTOS"));
        Assert.Equal("MsmeRequirements", FakeSql.Arg(args, "TableName"));
        Assert.Equal("51", FakeSql.Arg(args, "Id"));
        Assert.Equal("mobileapi/SaPhotos/ZEDMSME000001/Silver/SiteTour/20261021101010123.jpg", FakeSql.Arg(args, "Url"));
        Assert.Equal("Shop floor", FakeSql.Arg(args, "Name"));

        Assert.Equal(HttpStatusCode.NotFound, (await (await Assessor()).PostAsJsonAsync(Base + "/photos", new { target = "Requirement", targetId = 51, fromPhotoId = 99 })).StatusCode);
    }

    [Fact]
    public async Task Deleting_a_photo_that_shares_its_id_with_an_evidence_row_is_refused()
    {
        var lead = await Assessor();
        Assert.Equal(HttpStatusCode.OK, (await lead.DeleteAsync(Base + "/photos/61")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await lead.DeleteAsync(Base + "/photos/62")).StatusCode);
        Assert.Single(CallsTo("SP_ASSESSMENT_RA_DELETE_PHOTOS"));
    }
}
