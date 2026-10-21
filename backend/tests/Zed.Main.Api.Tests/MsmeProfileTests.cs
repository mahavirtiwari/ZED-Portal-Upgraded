using System.Collections.Concurrent;
using System.Data.Common;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Zed.Portal.Features.Msme;

namespace Zed.Main.Api.Tests;

public sealed class MsmeProfileTests : IDisposable
{
    private const string Me = "ZEDMSME000001";
    private const string MyUdyam = "UDYAM-UP-29-0003915";

    private readonly TestHost _host = new();
    private readonly RecordingUdyam _udyam = new();
    private readonly WebApplicationFactory<Program> _app;

    public MsmeProfileTests()
    {
        _app = _host.WithWebHostBuilder(b => b.ConfigureServices(s =>
        {
            s.RemoveAll<IUdyamClient>();
            s.AddSingleton<IUdyamClient>(_udyam);
        }));

        _host.Sql.Procs["SP_GET_USER_DETAILS"] = _ => FakeSql.Sets(
            [new { UserId = Me, UserName = "Acme Castings", RoleId = 5, Email = "a@acme.test", MobileNo = "9999999999", StateCode = "9", DistrictCode = "160" }],
            [new { ERRORMSG = "SUCCESS" }]);
        // Answers only for the signed-in MSME, so a request served for another ZED ID shows up as 404.
        _host.Sql.Procs["SP_MSME_GET_DETAILS"] = args => FakeSql.Arg(args, "ZedId") == Me
            ? FakeSql.Sets(
                [new Dictionary<string, object?>
                {
                    ["ZedId"] = Me, ["MobileNo"] = "9999999999", ["PUnitName"] = "Acme Unit 1", ["PAddress"] = "Plot 4",
                    ["PDistrictName"] = "KANPUR NAGAR", ["PStateName"] = "UTTAR PRADESH", ["PPin"] = "208022",
                    ["Activity"] = "Manufacturing", ["TwoDigitActivity"] = "24", ["FourDigitActivity"] = "2431", ["FiveDigitActivity"] = "24311",
                    ["PledgeEmailId"] = "pledge@acme.test", ["Password"] = "secret",
                }],
                [new { UdyogAadharNo = MyUdyam, OwnerName = "A Kumar", EnterpriseName = "Acme Castings", MobileNo = "9999999999", InvestmentCost = "100" }],
                [new { BronzeStatus = 1 }])
            : FakeSql.Sets([], [], []);
        _host.Sql.Procs["SP_MSME_VALIDATE_UDYAM_DETAILS"] = _ =>
            FakeSql.Sets([], [new { SectorCode = "24" }], [new { EmailCountStatus = "1", ErrorMessage = "Invalid Email" }]);
    }

    public void Dispose() => _host.Dispose();

    private async Task<HttpClient> SignedInAsync()
    {
        var client = await BrowserAsync();
        (await client.PostAsJsonAsync("/api/msme/auth/login", new { userId = Me, password = "Right#Pass1" })).EnsureSuccessStatusCode();
        (await client.GetAsync("/api/auth/me")).EnsureSuccessStatusCode(); // XSRF token for the signed-in user
        return client;
    }

    private (string Name, object? Args) SingleCall(string proc) => Assert.Single(_host.Sql.Calls, c => c.Name == proc);

    [Theory]
    [InlineData("GET", "/api/msme/profile")]
    [InlineData("GET", "/api/msme/profile/activities")]
    [InlineData("POST", "/api/msme/profile/activity")]
    public async Task Requires_a_signed_in_msme(string method, string url)
    {
        var client = await BrowserAsync();
        var request = new HttpRequestMessage(new HttpMethod(method), url);
        if (method != "GET") request.Content = JsonContent.Create(new { zedId = Me, fiveDigitActivity = "24311", disableRemarks = "x" });

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.StartsWith("SP_MSME"));
        Assert.Empty(_udyam.Calls);
    }

    [Fact]
    public async Task Profile_is_read_for_the_signed_in_zed_id_and_only_shows_page_fields()
    {
        var client = await SignedInAsync();

        var response = await client.GetAsync("/api/msme/profile?zedId=ZEDMSME999999");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(Me, FakeSql.Arg(SingleCall("SP_MSME_GET_DETAILS").Args, "ZedId"));
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Acme Unit 1", json.GetProperty("msme").GetProperty("PUnitName").GetString());
        Assert.Equal("24311", json.GetProperty("msme").GetProperty("FiveDigitActivity").GetString());
        Assert.Equal(MyUdyam, json.GetProperty("basicInfo").GetProperty("UdyogAadharNo").GetString());
        var body = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("secret", body);
        Assert.DoesNotContain("PledgeEmailId", body);
        Assert.DoesNotContain("InvestmentCost", body);
        Assert.DoesNotContain("BronzeStatus", body);
    }

    [Fact]
    public async Task Activities_come_from_the_msme_own_udyam_record()
    {
        var client = await SignedInAsync();

        var response = await client.GetAsync("/api/msme/profile/activities?registrationNo=UDYAM-XX-00-0000000&mobileNumber=8888888888");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal((MyUdyam, "9999999999"), Assert.Single(_udyam.Calls));
        var rows = await response.Content.ReadFromJsonAsync<List<Dictionary<string, string>>>();
        Assert.Equal(2, rows!.Count);
        Assert.Equal("26101", rows[1]["Five_DigitActivity"]);
        Assert.False(rows[0].ContainsKey("ActivityDetail_Id"));
    }

    [Fact]
    public async Task Udyam_service_failure_is_a_502_without_details()
    {
        _udyam.Fail = true;
        var client = await SignedInAsync();

        var response = await client.GetAsync("/api/msme/profile/activities");

        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
        Assert.Equal("Unexpected error occured. Please try after some time.", await response.ProblemTitle());
    }

    [Fact]
    public async Task Update_activity_validates_and_updates_the_signed_in_msme_with_the_udyam_values()
    {
        var client = await SignedInAsync();

        var response = await client.PostAsJsonAsync("/api/msme/profile/activity", new
        {
            fiveDigitActivity = "26101",
            // Ignored: the legacy action took these from the browser.
            zedId = "ZEDMSME999999", udyamNumber = "UDYAM-XX-00-0000000", activity = "Forged", twoDigitActivity = "99",
        });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var validate = SingleCall("SP_MSME_VALIDATE_UDYAM_DETAILS").Args;
        Assert.Equal(MyUdyam, FakeSql.Arg(validate, "UdyogAadharNo"));
        Assert.Equal("26 - Manufacture of electronics", FakeSql.Arg(validate, "TwoDigitActivity"));

        var update = SingleCall("SP_MSME_UPDATE_UDYAM_DETAILS").Args;
        Assert.Equal(Me, FakeSql.Arg(update, "ZedId"));
        Assert.Equal(MyUdyam, FakeSql.Arg(update, "UdyamNumber"));
        Assert.Equal("Activity", FakeSql.Arg(update, "ModifiedDataType"));
        Assert.Equal("ZED LIVE", FakeSql.Arg(update, "PaymentModule"));
        Assert.Equal("Manufacturing", FakeSql.Arg(update, "Activity"));
        Assert.Equal("26 - Manufacture of electronics", FakeSql.Arg(update, "TwoDigitActivity"));
        Assert.Equal("2610 - Manufacture of electronic components", FakeSql.Arg(update, "FourDigitActivity"));
        Assert.Equal("26101", FakeSql.Arg(update, "FiveDigitActivity"));
        Assert.Equal("A2", FakeSql.Arg(update, "ActivityDetailId"));
    }

    [Fact]
    public async Task Update_activity_refuses_an_activity_not_in_the_udyam_record()
    {
        var client = await SignedInAsync();

        var response = await client.PostAsJsonAsync("/api/msme/profile/activity", new { fiveDigitActivity = "99999" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_MSME_UPDATE_UDYAM_DETAILS");
    }

    [Fact]
    public async Task Update_activity_refuses_a_sector_outside_the_scheme()
    {
        _host.Sql.Procs["SP_MSME_VALIDATE_UDYAM_DETAILS"] = _ => FakeSql.Sets([], [], []);
        var client = await SignedInAsync();

        var response = await client.PostAsJsonAsync("/api/msme/profile/activity", new { fiveDigitActivity = "26101" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("Currently this scheme is not applicable for the selected plant activity.", await response.ProblemTitle());
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_MSME_UPDATE_UDYAM_DETAILS");
    }

    [Fact]
    public async Task Update_activity_procedure_error_is_a_400_without_the_exception_text()
    {
        _host.Sql.Procs["SP_MSME_UPDATE_UDYAM_DETAILS"] = _ => throw new FakeDbException("Invalid column name 'Secret'");
        var client = await SignedInAsync();

        var response = await client.PostAsJsonAsync("/api/msme/profile/activity", new { fiveDigitActivity = "26101" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.DoesNotContain("Secret", await response.Content.ReadAsStringAsync());
    }


    private sealed class FakeDbException(string message) : DbException(message);

    private sealed class RecordingUdyam : IUdyamClient
    {
        public ConcurrentQueue<(string RegistrationNo, string MobileNo)> Calls { get; } = new();
        public bool Fail { get; set; }

        public Task<UdyamLookup> GetUdyamAsync(string registrationNo, string mobileNo, CancellationToken ct = default)
        {
            Calls.Enqueue((registrationNo, mobileNo));
            if (Fail) throw new HttpRequestException("udyogaadhaar.gov.in unreachable");
            return Task.FromResult(new UdyamLookup(
                new() { ["UdyogAadharNo"] = registrationNo, ["EnterpriseName"] = "Acme Castings" },
                [new() { ["PlantIdNo"] = "P1", ["UnitName"] = "Acme Unit 1" }],
                [
                    new() { ["Activity"] = "Manufacturing", ["Two_DigitActivity"] = "24 - Manufacture of basic metals", ["Four_DigitActivity"] = "2431 - Casting of iron and steel", ["Five_DigitActivity"] = "24311", ["ActivityDetail_Id"] = "A1" },
                    new() { ["Activity"] = "Manufacturing", ["Two_DigitActivity"] = "26 - Manufacture of electronics", ["Four_DigitActivity"] = "2610 - Manufacture of electronic components", ["Five_DigitActivity"] = "26101", ["ActivityDetail_Id"] = "A2" },
                ]));
        }
    }

    /// <summary>Browser-like client for the factory with the recording Udyam client (cookies + XSRF header, as TestHost does).</summary>
    private async Task<HttpClient> BrowserAsync()
    {
        var cookies = new CookieContainer();
        var client = _app.CreateDefaultClient(new XsrfHandler(cookies, _app.Server.BaseAddress));
        (await client.GetAsync("/api/auth/me")).EnsureSuccessStatusCode();
        return client;
    }

    private sealed class XsrfHandler(CookieContainer cookies, Uri baseAddress) : DelegatingHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var uri = request.RequestUri!.IsAbsoluteUri ? request.RequestUri : new Uri(baseAddress, request.RequestUri);
            var header = cookies.GetCookieHeader(uri);
            if (header.Length > 0) request.Headers.Add("Cookie", header);
            if (request.Method != HttpMethod.Get && cookies.GetCookies(uri)["XSRF-TOKEN"] is { } xsrf)
                request.Headers.Add("X-XSRF-TOKEN", Uri.UnescapeDataString(xsrf.Value));

            var response = await base.SendAsync(request, ct);
            if (response.Headers.TryGetValues("Set-Cookie", out var setCookies))
                foreach (var c in setCookies) cookies.SetCookies(uri, c);
            return response;
        }
    }
}
