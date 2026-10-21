using System.Net;
using System.Text;

namespace Zed.Main.MobileApi.Tests;

/// <summary>The site assessor app (SA/*) on the Surveillance deployment (Mobile:System = Surveillance).</summary>
public sealed class SurveillanceSaTests : IDisposable
{
    private const string Zed = "ZEDMSME000001";
    private const string Lead = "ZEDAS0001";
    private readonly AssessorTestHost _t = new();

    public SurveillanceSaTests()
    {
        _t.Settings["Mobile:System"] = "Surveillance";
        _t.Sql.Allot(Zed, "Silver", Lead);
        _t.Fake.Procs["SP_SA_APP_CHECK_STATUS"] = _ => FakeSql.Sets([new Dictionary<string, object?>
        {
            ["OpenMeetingSubmitted"] = false, ["AllParametersSyncedByLead"] = true, ["AllParametersSyncedByCo"] = true,
            ["FinalSubmissionDone"] = false, ["ClosingMeetingSubmitted"] = false,
        }]);
    }

    public void Dispose() => _t.Dispose();

    [Fact]
    public async Task Login_returns_the_surveillance_flag_and_minimum_parameters()
    {
        _t.Fake.Procs["SP_APP_SA_CHECK_LOGIN"] = _ => FakeSql.Sets(
            [new { UserId = Lead, RoleId = 3, Password = "pw" }],
            [new { CertificationStatus = 9, UserType = 1, CertificationType = "Silver", ZedId = Zed, IsSurveillance = true, MinimumParameters = 7,
                   LeadAssessorId = Lead, LeadAssessorName = "Lead", EnergySources = "Solar" }],
            [], [], [], [], [], [],
            [new { SelfieSubmitted = false, OpenMeetingSubmitted = false, AllowFinalSubmitManual = false }]);
        var e = await _t.Json("/SA/Login", new { assessorId = Lead, zedId = Zed, password = "pw", deviceInfo = new { deviceId = "d1" } });
        Assert.Equal("1", e.GetProperty("status").GetString());
        Assert.True(e.GetProperty("isSurveillance").GetBoolean());
        Assert.Equal(7, e.GetProperty("minimumParameters").GetInt32());
    }

    [Fact]
    public async Task Meeting_photos_are_named_after_the_photo_name_only()
    {
        var e = await _t.Json("/SA/SubmitStartAssessment", new
        {
            userType = 1, saId = Lead, zedId = Zed, certificationType = "Silver", latitude = "1", longitude = "2", inputComment = "start",
            assessmentPhotos = new[] { new { photoId = "m1", name = "Opening Meeting Photo", photo = "aGVsbG8=", timeStamp = "t" } },
        });
        Assert.Equal("1", e.GetProperty("status").GetString());
        Assert.True(File.Exists(_t.FileUnderRoot("SaPhotos", Zed, "Silver", "Opening Meeting Photo.jpg")));
        Assert.False(File.Exists(_t.FileUnderRoot("SaPhotos", Zed, "Silver", "Opening Meeting Photo_m1.jpg")));
        Assert.Equal("m1", AssessorTestHost.Tvp(_t.LastArgs("SP_SA_APP_INSERT_OPEN_MEETING"), "PhotoList")!.Rows[0]["PhotoId"]);
    }

    [Fact]
    public async Task Allotment_is_still_checked()
    {
        var e = await _t.Json("/SA/SubmitStartAssessment", new
        {
            userType = 1, saId = "ZEDAS0099", zedId = Zed, certificationType = "Silver",
            assessmentPhotos = new[] { new { photoId = "m1", name = "Opening Meeting Photo", photo = "aGVsbG8=" } },
        });
        Assert.Equal("Site Assessment data not yet allocated for the ZEDID: " + Zed, e.GetProperty("errorMessage").GetString());
        Assert.Empty(_t.AllFiles());
    }

    [Theory]
    [InlineData("/Msme/Login")]
    [InlineData("/RA/Login")]
    public async Task The_msme_and_remote_assessment_apps_are_not_served(string path)
    {
        var r = await _t.Client.PostAsync(path, new StringContent("{}", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }
}

/// <summary>The Main deployment does not serve the surveillance-only controllers.</summary>
public sealed class SurveillanceMainHostTests : IDisposable
{
    private readonly MobileTestHost _host = new();

    public void Dispose() => _host.Dispose();

    [Theory]
    [InlineData("/Surveillance/Login")]
    [InlineData("/Msme/SubmitSurveillancePhoto")]
    public async Task Surveillance_actions_are_not_served_on_main(string path)
    {
        var r = await _host.CreateClient().PostAsync(path, new StringContent("{}", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task Main_meeting_photos_keep_name_and_photo_id()
    {
        using var t = new AssessorTestHost();
        t.Sql.Allot("ZEDMSME000001", "Silver", "ZEDAS0001");
        t.Fake.Procs["SP_SA_APP_CHECK_STATUS"] = _ => FakeSql.Sets([new Dictionary<string, object?> { ["OpenMeetingSubmitted"] = false }]);
        var e = await t.Json("/SA/SubmitStartAssessment", new
        {
            userType = 1, saId = "ZEDAS0001", zedId = "ZEDMSME000001", certificationType = "Silver",
            assessmentPhotos = new[] { new { photoId = "m1", name = "Opening Meeting Photo", photo = "aGVsbG8=" } },
        });
        Assert.Equal("1", e.GetProperty("status").GetString());
        Assert.True(File.Exists(t.FileUnderRoot("SaPhotos", "ZEDMSME000001", "Silver", "Opening Meeting Photo_m1.jpg")));
    }
}
