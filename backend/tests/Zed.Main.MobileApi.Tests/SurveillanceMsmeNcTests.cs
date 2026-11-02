using System.Net;
using System.Reflection;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Mvc.ApplicationParts;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Zed.Core.Http;
using Zed.Core.Mobile;
using Zed.Core.Security;
using Zed.Main.MobileApi.Controllers;

namespace Zed.Main.MobileApi.Tests;

/// <summary>
/// The ZED MSME app's replies to a Bronze surveillance NC on the Surveillance host (<c>/surveillancemobileapi/msme/*</c>,
/// <see cref="SurveillanceMsmeController"/>): the MSME signs in on Main, so the calls carry Main's MSME token, read with
/// the shared Mobile:AppTokenKey and checked against main's session stamp; writes only while the surveillance NC is open.
/// </summary>
public sealed class SurveillanceMsmeNcTests : IDisposable
{
    private const string Zed = "ZEDMSME000001";
    private const string Other = "ZEDMSME000002";
    private const string Assessor = "ZEDBAS0001";
    private const string Expired = AppTokens.ExpiredMessage;
    private readonly SurveillanceAppHost _t = new();
    private readonly FakeSql _main = new();

    public SurveillanceMsmeNcTests()
    {
        _t.Settings["Mobile:AppTokenKey"] = AppTokenTests.Key;
        _t.Main = _main;
    }

    public void Dispose() => _t.Dispose();

    private static string Png => Convert.ToBase64String([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0]);

    /// <summary>The token service of a deployment (Main unless said otherwise), as its login would issue the token.</summary>
    private AppTokens Issuer(PortalSystem system = PortalSystem.Main) => Issuer(system, AppTokenTests.Key);

    private AppTokens Issuer(PortalSystem system, string? key) =>
        new(Options.Create(new MobileOptions { AppTokenKey = key }), new EphemeralDataProtectionProvider(), _main,
            new MemoryCache(new MemoryCacheOptions()), NullLogger<AppTokens>.Instance, new PortalHost(system));

    private Task<string> MainToken(string zedId = Zed, string app = MobileApps.Msme) => Issuer().IssueAsync(app, zedId, zedId);

    private async Task<JsonElement> Post(string path, object body, string? token)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, path)
        {
            Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"),
        };
        if (token is not null) request.Headers.Add(AppTokens.Header, token);
        var r = await _t.Client.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        return JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement;
    }

    private async Task<JsonElement> Multipart(string path, MultipartFormDataContent content, string? token)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = content };
        if (token is not null) request.Headers.Add(AppTokens.Header, token);
        var r = await _t.Client.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        return JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement;
    }

    private static void AssertFail(JsonElement e, string message)
    {
        Assert.Equal("0", e.GetProperty("status").GetString());
        Assert.Equal(message, e.GetProperty("errorMessage").GetString());
    }

    private static void AssertOk(JsonElement e) => Assert.Equal("1", e.GetProperty("status").GetString());

    /// <summary>A Bronze surveillance with NC 1 raised by the desktop assessor (status 4).</summary>
    private void OpenNc() => _t.Sql.Unit(Zed, "Bronze", Assessor, status: 4, ncCount: 1, ncStatus: 1);

    private static object SiteReply => new
    {
        userName = Zed, certificationType = "Bronze", msmeRemarks = "repainted", version = "2.0",
        photos = new[] { new { photoId = "sx1", photo = Png, timeStamp = "t" } },
    };

    // ---------------------------------------------------------------- Status

    [Fact]
    public async Task GetMsmeStatus_answers_the_surveillance_databases_status_for_mains_token()
    {
        _t.Fake.Procs["SP_APP_MSME_STATUS"] = _ => FakeSql.Sets([new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase)
        {
            ["BronzeStatus"] = 2, ["SilverStatus"] = 0, ["GoldStatus"] = 0, ["BronzeStatusOfNc"] = 1, ["BronzeStatusOfNc1"] = 1,
            ["Nc1StatusTextBronze"] = "NC 1 raised", ["FinancialAssistanceStatus"] = 0,
        }]);
        var e = await Post("/Msme/GetMsmeStatus", new { userName = Zed, version = "2.0" }, await MainToken());
        AssertOk(e);
        var bronze = e.GetProperty("bronze");
        Assert.Equal(2, bronze.GetProperty("status").GetInt32());
        Assert.Equal(1, bronze.GetProperty("nc1Status").GetInt32());
        Assert.Equal("NC 1 raised", bronze.GetProperty("nc1StatusText").GetString());
        Assert.Equal(Zed, SurveillanceAppHost.Arg(_t.Args("SP_APP_MSME_STATUS"), "ZedId"));
    }

    [Fact]
    public async Task GetMsmeStatus_of_a_unit_without_a_surveillance_row_keeps_the_old_failure()
    {
        _t.Fake.Procs["SP_APP_MSME_STATUS"] = _ => FakeSql.Sets([new Dictionary<string, object?> { ["BronzeStatus"] = null }]);
        AssertFail(await Post("/Msme/GetMsmeStatus", new { userName = Zed }, await MainToken()), "Invalid ZED ID.");
    }

    // ---------------------------------------------------------------- Token

    [Fact]
    public async Task Calls_without_mains_msme_token_for_this_zed_id_are_refused_even_in_monitor()
    {
        OpenNc();
        var refused = new[]
        {
            null,
            "h1.rubbish.rubbish",
            await MainToken(Other),
            await MainToken(Zed, MobileApps.RemoteAssessor),
            // Issued by this deployment, or by Main without the shared key (Data Protection: readable by Main only).
            await Issuer(PortalSystem.Surveillance).IssueAsync(MobileApps.Msme, Zed, Zed),
            await Issuer(PortalSystem.Main, null).IssueAsync(MobileApps.Msme, Zed, Zed),
            await Issuer(PortalSystem.Main, Convert.ToBase64String(new byte[32])).IssueAsync(MobileApps.Msme, Zed, Zed),
        };
        foreach (var token in refused)
        {
            AssertFail(await Post("/Msme/SubmitSiteExteriorInfo", SiteReply, token), Expired);
            AssertFail(await Post("/Msme/GetMsmeStatus", new { userName = Zed }, token), Expired);
        }
        Assert.Empty(_t.CallsTo("SP_APP_MSME_INSERT_SITE_EXTERIOR"));
        Assert.Empty(_t.CallsTo("SP_APP_MSME_STATUS"));
        Assert.Empty(_t.AllFiles());
        Assert.Contains(_t.Devices.TokenEvents, ev => ev.App == MobileApps.Msme && ev.User == Zed && ev.Outcome == AppTokenCheck.OtherUser && ev.Refused);
        Assert.Contains(_t.Devices.TokenEvents, ev => ev.Outcome == AppTokenCheck.Invalid && ev.Refused);
        Assert.Contains(_t.Devices.TokenEvents, ev => ev.Outcome == AppTokenCheck.OtherApp && ev.Refused);
    }

    [Fact]
    public async Task A_token_ended_by_a_new_session_stamp_on_main_is_refused()
    {
        OpenNc();
        var token = await MainToken();
        _main.Queries[SessionStamps.SelectSql[..30]] = _ => ["changed-on-main"];
        AssertFail(await Post("/Msme/SubmitSiteExteriorInfo", SiteReply, token), Expired);
        Assert.Contains(_t.Devices.TokenEvents, ev => ev.Outcome == AppTokenCheck.Revoked && ev.Refused);
        // A fresh login on main carries the new stamp.
        AssertOk(await Post("/Msme/SubmitSiteExteriorInfo", SiteReply, await MainToken()));
    }

    // ---------------------------------------------------------------- NC replies

    [Fact]
    public async Task Nc_replies_are_stored_on_the_surveillance_host_while_the_nc_is_open()
    {
        OpenNc();
        var token = await MainToken();
        _t.Fake.Procs["SP_APP_MSME_GET_NC_DETAILS_BY_TYPE"] = _ => FakeSql.Sets(
            [new { AssessorRemarks = "faded board", PhotoPath = "https://x/s.jpg" }], [], []);
        var details = await Post("/Msme/GetNcDetailsByType", new { userName = Zed, certificationType = "Bronze", ncCount = "1" }, token);
        Assert.Equal("faded board", details.GetProperty("assessorRemarksSite").GetString());
        Assert.Equal("1", SurveillanceAppHost.Arg(_t.Args("SP_APP_MSME_GET_NC_DETAILS_BY_TYPE"), "NcCount"));

        AssertOk(await Post("/Msme/SubmitSiteExteriorInfo", SiteReply, token));
        Assert.True(File.Exists(_t.FileUnderRoot("Photos", Zed, "Bronze", "SiteExteriorPhotos", "sx1.jpg")));
        var site = _t.Args("SP_APP_MSME_INSERT_SITE_EXTERIOR");
        Assert.Equal(Zed, SurveillanceAppHost.Arg(site, "ZedId"));
        Assert.Equal("repainted", SurveillanceAppHost.Arg(site, "MsmeRemarks"));

        _t.Fake.Procs["SP_APP_MSME_GET_EVIDENCE_ID"] = _ => FakeSql.Sets([new { EvidenceId = "77001" }]);
        var requirement = new MultipartFormDataContent
        {
            { new StringContent(Zed), "userName" },
            { new StringContent("Bronze"), "certificationType" },
            { new StringContent("220"), "requirementId" },
            { new StringContent("A"), "requirementCode" },
            { new StringContent("fixed"), "msmeRemarks" },
            { new StringContent("true"), "isFirst" },
            { new StringContent("false"), "isLast" },
            { new StringContent($$"""{"photoId":"r1","photo":"{{Png}}"}"""), "photo" },
        };
        AssertOk(await Multipart("/Msme/SubmitNcRequirement", requirement, token));
        Assert.True(File.Exists(_t.FileUnderRoot("Photos", Zed, "Bronze", "Evidences", "r1.jpg")));
        Assert.Equal("220", SurveillanceAppHost.Arg(_t.Args("SP_APP_MSME_INSERT_REQUIREMENT"), "Id"));

        var product = new MultipartFormDataContent
        {
            { new StringContent(Zed), "userName" },
            { new StringContent("Bronze"), "certificationType" },
            { new StringContent("""{"productId":7,"msmeRemarks":"new label","productPhoto":{"photoId":"pp1"},"productDescriptionPhoto":{"photoId":"pd1"}}"""), "productDetailsNc" },
            { new ByteArrayContent(Convert.FromBase64String(Png)), "files", "pp1.jpg" },
        };
        AssertOk(await Multipart("/Msme/SubmitNcProduct", product, token));
        Assert.True(File.Exists(_t.FileUnderRoot("Photos", Zed, "Bronze", "BasicInfo", "pp1.jpg")));
        Assert.Equal("7", SurveillanceAppHost.Arg(_t.Args("SP_APP_MSME_INSERT_PRODUCT_INFO"), "ProductId"));
    }

    /// <summary>MsmeEntry's rule: status 4 (or 14), NC 1 to 5 and that NC raised; NcCount 6 is the rejection (status 7).</summary>
    [Theory]
    [InlineData(4, 1, 2)]
    [InlineData(7, 6, 0)]
    [InlineData(4, 6, 0)]
    [InlineData(2, 0, 0)]
    [InlineData(5, 1, 1)]
    public async Task Writes_are_refused_unless_the_current_surveillance_nc_is_open(int status, int ncCount, int ncStatus)
    {
        _t.Sql.Unit(Zed, "Bronze", Assessor, status, ncCount, ncStatus);
        var token = await MainToken();
        AssertFail(await Post("/Msme/SubmitSiteExteriorInfo", SiteReply, token), "Invalid Details.");
        AssertFail(await Post("/Msme/FinalSubmit", new { userName = Zed, certificationType = "Bronze" }, token), "Invalid Details.");
        Assert.Empty(_t.CallsTo("SP_APP_MSME_INSERT_SITE_EXTERIOR"));
        Assert.Empty(_t.CallsTo("SP_APP_MSME_FINAL_SUBMIT"));
        Assert.Empty(_t.AllFiles());
    }

    [Fact]
    public async Task Another_level_or_a_unit_without_a_surveillance_is_refused()
    {
        OpenNc();
        var token = await MainToken();
        AssertFail(await Post("/Msme/SubmitSiteExteriorInfo", new { userName = Zed, certificationType = "Silver", photos = Array.Empty<object>() }, token),
            "Invalid Details.");
        AssertFail(await Post("/Msme/GetNcDetailsByType", new { userName = Other, certificationType = "Bronze", ncCount = "1" }, await MainToken(Other)),
            "Invalid Details.");
        Assert.Empty(_t.CallsTo("SP_APP_MSME_GET_NC_DETAILS_BY_TYPE"));
    }

    [Fact]
    public async Task The_surveillance_assessors_own_nc_replies_follow_the_same_rule()
    {
        // The Bronze surveillance app (SURV, Monitor): NcCount 6 is the rejection, no longer an open NC.
        _t.Sql.Unit(Zed, "Bronze", Assessor, status: 7, ncCount: 6);
        var e = await Post("/Surveillance/SubmitSiteExteriorInfo", SiteReply, null);
        AssertFail(e, "Invalid Details.");
        Assert.Empty(_t.CallsTo("SP_APP_MSME_INSERT_SITE_EXTERIOR"));
    }

    // ---------------------------------------------------------------- Close

    [Fact]
    public async Task FinalSubmit_closes_the_open_nc_for_the_desktop_assessors_review_and_mails_the_reply()
    {
        OpenNc();
        _t.Fake.Procs["SP_EMAIL_GET_DETAILS"] = _ => FakeSql.Sets([new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase)
        {
            ["EmailId"] = "unit@example.com", ["EnterpriseName"] = "Acme", ["NcCount"] = 1, ["AssessorEmailId"] = "da@example.com",
            ["AgencyEmailId"] = "agency@example.com", ["Password"] = "AssessorSecret1",
        }]);
        AssertOk(await Post("/Msme/FinalSubmit", new { userName = Zed, certificationType = "bronze", version = "2.0" }, await MainToken()));

        var args = _t.Args("SP_APP_MSME_FINAL_SUBMIT");
        Assert.Equal(Zed, SurveillanceAppHost.Arg(args, "ZedId"));
        Assert.Equal("Bronze", SurveillanceAppHost.Arg(args, "CertificationType"));
        // The NC close only: not the assessor's surveillance answers, and no pre-submit check of the first submission.
        Assert.Null(SurveillanceAppHost.Arg(args, "SuitableForSilverUpgrade"));
        Assert.Empty(_t.CallsTo("SP_APP_CHECK_DATA_SYNC_FINAL_SUBMIT"));
        Assert.Single(_t.CallsTo("SP_ASSESSMENT_CHECK_NC_PHOTO_AVAILABILITY"));
        var mail = Assert.Single(_t.Host.Email.Sent);
        Assert.StartsWith("Submission of response to Non-conformance(s)", mail.Subject);
        Assert.Contains("da@example.com", mail.Cc!);
        Assert.DoesNotContain("Secret1", mail.HtmlBody);
    }

    [Fact]
    public async Task FinalSubmit_is_refused_while_a_reply_photo_is_missing()
    {
        OpenNc();
        _t.Fake.Procs["SP_ASSESSMENT_CHECK_NC_PHOTO_AVAILABILITY"] = _ => FakeSql.Sets(
            [new { PhotoPath = @"E:\Publish\SurveillanceServices\Photos\" + Zed + @"\Bronze\SiteExteriorPhotos\gone.jpg" }], [], []);
        AssertFail(await Post("/Msme/FinalSubmit", new { userName = Zed, certificationType = "Bronze" }, await MainToken()), "Site Exterior Photos not synced.");
        Assert.Empty(_t.CallsTo("SP_APP_MSME_FINAL_SUBMIT"));
    }

    // ---------------------------------------------------------------- What is served where

    [Theory]
    [InlineData("/Msme/Login")]
    [InlineData("/Msme/ChangePassword")]
    [InlineData("/Msme/ResetPassword")]
    [InlineData("/Msme/GetMyDocuments")]
    [InlineData("/Msme/GetParametersByType")]
    [InlineData("/Msme/SubmitBasicInformation")]
    [InlineData("/Msme/SubmitEvidenceV2")]
    [InlineData("/Msme/SubmitPhotos")]
    [InlineData("/Msme/SubmitFinancialData")]
    [InlineData("/Msme/SubmitFacilitatorDetails")]
    public async Task The_rest_of_the_msme_app_is_not_served_on_the_surveillance_host(string path)
    {
        var r = await _t.Client.PostAsync(path, new StringContent($$"""{"userName":"{{Zed}}"}""", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
        Assert.Empty(_t.Fake.Calls);
    }

    [Theory]
    [InlineData(PortalSystem.Main, false)]
    [InlineData(PortalSystem.Consultancy, false)]
    [InlineData(PortalSystem.Surveillance, true)]
    public void The_controller_is_served_by_the_surveillance_deployment_only(PortalSystem system, bool served)
    {
        var feature = new ControllerFeature();
        feature.Controllers.Add(typeof(SurveillanceMsmeController).GetTypeInfo());
        feature.Controllers.Add(typeof(MsmeController).GetTypeInfo());
        new PortalControllerFilter(system, typeof(SurveillanceMsmeController).Assembly).PopulateFeature(Array.Empty<ApplicationPart>(), feature);
        Assert.Equal(served, feature.Controllers.Contains(typeof(SurveillanceMsmeController).GetTypeInfo()));
        Assert.Equal(system == PortalSystem.Main, feature.Controllers.Contains(typeof(MsmeController).GetTypeInfo()));
    }
}
